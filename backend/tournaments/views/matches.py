# backend/tournaments/views/matches.py
# Plik obsługuje listy meczów, harmonogram, wyniki i zmiany statusu meczu.

from __future__ import annotations

import math
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone

from rest_framework import status
from rest_framework.generics import ListAPIView, RetrieveUpdateAPIView
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from tournaments.access import (
    can_edit_results,
    can_edit_schedule,
    user_is_assistant,
)
from tournaments.services.match_outcome import (
    knockout_winner_id,
    validate_extra_time_consistency,
    validate_penalties_consistency,
)
from tournaments.services.match_result import MatchResultService

from ..models import Match, MatchCustomResult, MatchIncident, Stage, Tournament
from ..realtime import ws_emit_tournament
from ..serializers import (
    MatchCustomResultSerializer,
    MatchCustomResultUpdateSerializer,
    MatchResultUpdateSerializer,
    MatchSerializer,
)
from ._helpers import (
    _get_cup_matches,
    _sync_two_leg_pair_winner_if_possible,
    _try_auto_advance_knockout,
    handle_knockout_winner_change,
    public_access_or_403,
)

_MAX_MATCH_SECONDS = 3 * 60 * 60


def _third_place_value() -> str:
    return getattr(Stage.StageType, "THIRD_PLACE", "THIRD_PLACE")


def _is_third_place_stage(stage: Stage) -> bool:
    return str(stage.stage_type) == str(_third_place_value())


def _is_tennis(tournament: Tournament) -> bool:
    return (getattr(tournament, "discipline", "") or "").lower() == "tennis"


def _is_custom_result_mode(tournament: Tournament) -> bool:
    return getattr(tournament, "result_mode", Tournament.ResultMode.SCORE) == Tournament.ResultMode.CUSTOM


def _custom_result_config(tournament: Tournament) -> dict:
    try:
        return tournament.get_result_config()
    except Exception:
        cfg = getattr(tournament, "result_config", None)
        return cfg if isinstance(cfg, dict) else {}


def _is_custom_head_to_head_points_table(tournament: Tournament) -> bool:
    if not _is_custom_result_mode(tournament):
        return False

    cfg = _custom_result_config(tournament)
    head_mode = str(
        cfg.get("head_to_head_mode")
        or cfg.get("headToHeadMode")
        or cfg.get(Tournament.RESULTCFG_CUSTOM_MODE_KEY)
        or ""
    ).upper()
    competition_model = str(getattr(tournament, "competition_model", "") or "").upper()

    return (
        competition_model == str(Tournament.CompetitionModel.HEAD_TO_HEAD).upper()
        and head_mode in {"POINTS_TABLE", "HEAD_TO_HEAD_POINTS"}
    )


def _uses_custom_result_rows(tournament: Tournament) -> bool:
    if not _is_custom_result_mode(tournament):
        return False
    return not _is_custom_head_to_head_points_table(tournament)


def _get_pair_matches(stage: Stage, match: Match) -> List[Match]:
    if not match.home_team_id or not match.away_team_id:
        return [match]

    qs = Match.objects.filter(
        Q(home_team_id=match.home_team_id, away_team_id=match.away_team_id)
        | Q(home_team_id=match.away_team_id, away_team_id=match.home_team_id),
        stage=stage,
    ).only(
        "id",
        "status",
        "winner_id",
        "home_team_id",
        "away_team_id",
        "home_score",
        "away_score",
        "tennis_sets",
        "went_to_extra_time",
        "home_extra_time_score",
        "away_extra_time_score",
        "decided_by_penalties",
        "home_penalty_score",
        "away_penalty_score",
        "result_entered",
    )
    return list(qs)


def _pair_is_complete_two_leg(group: List[Match]) -> bool:
    return len(group) == 2 and all(match.status == Match.Status.FINISHED for match in group)


def _pair_winner_id(group: List[Match]) -> Optional[int]:
    if not group:
        return None

    ids = {match.winner_id for match in group}
    if None in ids:
        return None
    if len(ids) == 1:
        return next(iter(ids))
    return None


def _handle_knockout_progression(
    tournament: Tournament,
    stage: Stage,
    old_winner_id: Optional[int],
    new_winner_id: Optional[int],
) -> None:
    if stage.stage_type != Stage.StageType.KNOCKOUT:
        return

    handle_knockout_winner_change(
        tournament=tournament,
        stage=stage,
        old_winner_id=old_winner_id,
        new_winner_id=new_winner_id,
    )

    if tournament.status != Tournament.Status.FINISHED:
        _try_auto_advance_knockout(stage)


def _stringify_validation_detail(detail: object) -> str:
    if detail is None:
        return "Nieprawidłowe dane."
    if isinstance(detail, str):
        return detail
    if isinstance(detail, list):
        return "; ".join(str(item) for item in detail)
    if isinstance(detail, dict):
        for key in ("non_field_errors", "tennis_sets", "detail"):
            value = detail.get(key)
            if value:
                if isinstance(value, list):
                    return "; ".join(str(item) for item in value)
                return str(value)
        return "; ".join(f"{key}: {value}" for key, value in detail.items())
    return str(detail)


def _validate_tennis_match_before_finish(match: Match, cfg: dict) -> Optional[str]:
    if not match.result_entered:
        return "Nie można zakończyć meczu tenisowego bez wprowadzenia wyniku."

    if match.tennis_sets is None:
        return "Brak danych setów (tennis_sets). Uzupełnij sety w gemach."

    if match.went_to_extra_time or match.decided_by_penalties:
        return "W tenisie nie obsługujemy dogrywki ani karnych."

    if match.home_extra_time_score is not None or match.away_extra_time_score is not None:
        return "W tenisie nie obsługujemy dogrywki (pola ET muszą być puste)."

    if match.home_penalty_score is not None or match.away_penalty_score is not None:
        return "W tenisie nie obsługujemy karnych (pola karnych muszą być puste)."

    try:
        from tournaments.serializers.matches import _validate_tennis_sets_and_compute_score

        home_sets, away_sets = _validate_tennis_sets_and_compute_score(match.tennis_sets, cfg=cfg)
    except Exception as exc:
        detail = getattr(exc, "detail", None)
        if detail is not None:
            return _stringify_validation_detail(detail)
        return str(exc)

    home_score = int(match.home_score or 0)
    away_score = int(match.away_score or 0)

    if home_score != home_sets or away_score != away_sets:
        return "Niespójność danych: wynik setów nie zgadza się z tennis_sets. Zapisz wynik ponownie."

    return None


def _tennis_winner_id_from_sets(match: Match) -> Optional[int]:
    home_score = int(match.home_score or 0)
    away_score = int(match.away_score or 0)

    if home_score == away_score:
        return None

    return match.home_team_id if home_score > away_score else match.away_team_id


def _is_mixed(tournament: Tournament) -> bool:
    return str(getattr(tournament, "tournament_format", "")).upper() == "MIXED"


def _knockout_exists(tournament: Tournament) -> bool:
    return Stage.objects.filter(
        tournament=tournament,
        stage_type=Stage.StageType.KNOCKOUT,
    ).exists()


def _knockout_has_started(tournament: Tournament) -> bool:
    qs = Match.objects.filter(
        tournament=tournament,
        stage__stage_type=Stage.StageType.KNOCKOUT,
    )

    if qs.filter(result_entered=True).exists():
        return True
    if qs.exclude(status=Match.Status.SCHEDULED).exists():
        return True
    return False


def _import_advance_from_groups():
    from tournaments.services.advance_from_groups import advance_from_groups

    return advance_from_groups


def _regenerate_knockout_from_groups_if_safe(tournament: Tournament) -> None:
    if not _is_mixed(tournament):
        return
    if not _knockout_exists(tournament):
        return
    if _knockout_has_started(tournament):
        return

    third_place = _third_place_value()

    Stage.objects.filter(
        tournament=tournament,
        stage_type__in=[Stage.StageType.KNOCKOUT, third_place],
    ).delete()

    advance_from_groups = _import_advance_from_groups()
    advance_from_groups(tournament)


def _incident_goal_points(discipline: str, meta: object) -> int:
    if discipline == Tournament.Discipline.BASKETBALL:
        data = meta if isinstance(meta, dict) else {}
        raw = data.get("points", 1)
        try:
            points = int(raw or 1)
        except (TypeError, ValueError):
            points = 1
        return points if points in (1, 2, 3) else 1

    return 1


def _is_goal_based_or_basketball(discipline: str) -> bool:
    return discipline in (
        Tournament.Discipline.FOOTBALL,
        Tournament.Discipline.HANDBALL,
        Tournament.Discipline.BASKETBALL,
    )


def _incident_scope(match: Match, incident: MatchIncident) -> str:
    data = incident.meta if isinstance(getattr(incident, "meta", None), dict) else {}
    scope = str(data.get("scope") or "").strip().upper()
    if scope == "EXTRA_TIME":
        return "EXTRA_TIME"

    period = str(getattr(incident, "period", None) or "").strip().upper()
    if period in {"ET", "ET1", "ET2"}:
        return "EXTRA_TIME"

    return "REGULAR"


def _points_to_basketball_chunks(diff: int) -> List[int]:
    left = max(0, int(diff))
    out: List[int] = []

    for points in (3, 2, 1):
        while left >= points:
            out.append(points)
            left -= points

    return out


def _clock_minute_payload(match: Match) -> Tuple[str, Optional[int], Optional[str]]:
    state = str(getattr(match, "clock_state", "") or "")
    elapsed = int(getattr(match, "clock_elapsed_seconds", 0) or 0)
    started_at = getattr(match, "clock_started_at", None)

    not_started_value = str(getattr(Match.ClockState, "NOT_STARTED", "NOT_STARTED"))
    if state == not_started_value and elapsed == 0 and not started_at:
        return ("MANUAL", None, None)

    try:
        minute = match.clock_minute_total(now=timezone.now())
    except Exception:
        now = timezone.now()
        total = elapsed
        running_value = str(getattr(Match.ClockState, "RUNNING", "RUNNING"))
        if state == running_value and started_at:
            try:
                total += max(0, int((now - started_at).total_seconds()))
            except Exception:
                pass

        if total < 0:
            total = 0
        if total > _MAX_MATCH_SECONDS:
            total = _MAX_MATCH_SECONDS

        minute = int(math.ceil(total / 60.0)) if total > 0 else 0

    return ("CLOCK", int(minute), str(int(minute)))


def _default_period_for_scope(discipline: str, scope: str) -> str:
    if str(scope).upper() == "EXTRA_TIME":
        if discipline in (Tournament.Discipline.FOOTBALL, Tournament.Discipline.HANDBALL):
            return "ET1"
        return "ET"
    return "NONE"


def _custom_sort_value(result: MatchCustomResult):
    if result.value_kind == MatchCustomResult.ValueKind.TIME:
        return int(result.time_ms or 0)
    if result.numeric_value is None:
        return Decimal("0")
    return Decimal(result.numeric_value)


def _recalculate_custom_match_ranks(match: Match) -> Optional[int]:
    tournament = match.tournament
    if not tournament.uses_custom_results():
        return None

    results = list(
        match.custom_results.select_related("team")
        .filter(is_active=True)
        .order_by("id")
    )

    if not results:
        if match.result_entered:
            match.result_entered = False
            match.winner = None
            match.save(update_fields=["result_entered", "winner"])
        return None

    lower_is_better = tournament.custom_result_lower_is_better()
    allow_ties = tournament.get_result_config().get(Tournament.RESULTCFG_ALLOW_TIES_KEY, True)

    ordered = sorted(
        results,
        key=lambda item: (_custom_sort_value(item), item.id),
        reverse=not lower_is_better,
    )

    previous_value = None
    previous_rank = None
    winner_id = None

    for index, result in enumerate(ordered, start=1):
        current_value = _custom_sort_value(result)
        if allow_ties and previous_value is not None and current_value == previous_value:
            rank = previous_rank
        else:
            rank = index

        if result.rank != rank:
            result.rank = rank
            result.save(update_fields=["rank", "updated_at"])

        if rank == 1 and winner_id is None:
            winner_id = result.team_id

        previous_value = current_value
        previous_rank = rank

    if not match.result_entered or match.winner_id != winner_id:
        match.result_entered = True
        match.winner_id = winner_id
        match.save(update_fields=["result_entered", "winner"])

    return winner_id


SCORE_SYNC_CONFIRM_REQUIRED = "SCORE_SYNC_CONFIRM_REQUIRED"


def _apply_manual_result_via_goal_incidents_or_409(
    match: Match,
    *,
    force: bool,
    created_by_id: Optional[int] = None,
) -> Optional[Response]:
    tournament = match.tournament
    discipline = tournament.discipline

    if _uses_custom_result_rows(tournament):
        return Response(
            {"detail": "Dla customowego wyniku mierzalnego użyj endpointu zapisu rezultatu."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if _is_tennis(tournament):
        return None
    if not _is_goal_based_or_basketball(discipline):
        return None
    if not match.home_team_id or not match.away_team_id:
        return None

    match = Match.objects.select_related("tournament").select_for_update().get(pk=match.pk)

    desired_regular_home = int(match.home_score or 0)
    desired_regular_away = int(match.away_score or 0)

    desired_et_home = int(getattr(match, "home_extra_time_score", 0) or 0)
    desired_et_away = int(getattr(match, "away_extra_time_score", 0) or 0)

    et_enabled = bool(getattr(match, "went_to_extra_time", False)) or (
        desired_et_home > 0 or desired_et_away > 0
    )
    if et_enabled and not getattr(match, "went_to_extra_time", False):
        match.went_to_extra_time = True
        match.save(update_fields=["went_to_extra_time"])
        ws_emit_tournament(match.tournament_id, "matches_changed", {"match_id": match.id})

    if not et_enabled:
        desired_et_home = 0
        desired_et_away = 0

    desired_map: Dict[Tuple[int, str], int] = {
        (match.home_team_id, "REGULAR"): desired_regular_home,
        (match.away_team_id, "REGULAR"): desired_regular_away,
        (match.home_team_id, "EXTRA_TIME"): desired_et_home,
        (match.away_team_id, "EXTRA_TIME"): desired_et_away,
    }

    qs = (
        MatchIncident.objects.select_for_update()
        .filter(match_id=match.id, kind="GOAL")
        .only("id", "team_id", "meta", "period")
        .order_by("-id")
    )

    by_key: Dict[Tuple[int, str], List[MatchIncident]] = {
        (match.home_team_id, "REGULAR"): [],
        (match.away_team_id, "REGULAR"): [],
        (match.home_team_id, "EXTRA_TIME"): [],
        (match.away_team_id, "EXTRA_TIME"): [],
    }

    for incident in qs:
        if incident.team_id not in (match.home_team_id, match.away_team_id):
            continue
        scope = _incident_scope(match, incident)
        key = (incident.team_id, scope)
        if key in by_key:
            by_key[key].append(incident)

    def _points(incident: MatchIncident) -> int:
        return int(_incident_goal_points(discipline, incident.meta))

    current_points: Dict[Tuple[int, str], int] = {}
    for key, items in by_key.items():
        total = 0
        for incident in items:
            total += _points(incident)
        current_points[key] = int(total)

    delete_ids: List[int] = []
    remaining_points: Dict[Tuple[int, str], int] = dict(current_points)

    for key, desired in desired_map.items():
        current = int(remaining_points.get(key, 0))
        if current <= int(desired):
            continue

        for incident in by_key.get(key, []):
            if current <= int(desired):
                break
            current -= _points(incident)
            delete_ids.append(int(incident.id))

        remaining_points[key] = int(current)

    delete_ids = sorted(set(delete_ids), reverse=True)
    if delete_ids and not force:
        return Response(
            {
                "detail": (
                    f"Zmiana wyniku spowoduje usunięcie {len(delete_ids)} istniejących incydentów GOAL. "
                    "Czy chcesz kontynuować?"
                ),
                "code": SCORE_SYNC_CONFIRM_REQUIRED,
                "delete_count": len(delete_ids),
                "delete_ids": delete_ids,
            },
            status=status.HTTP_409_CONFLICT,
        )

    if delete_ids:
        MatchIncident.objects.filter(id__in=delete_ids).delete()

    time_source, minute, minute_raw = _clock_minute_payload(match)

    def _period_for_new_goal(scope: str) -> str:
        if str(scope or "REGULAR").upper() == "EXTRA_TIME":
            return _default_period_for_scope(discipline, "EXTRA_TIME")
        return "NONE"

    def _meta_for_new_goal(scope: str, points: Optional[int] = None) -> Dict[str, Any]:
        meta: Dict[str, Any] = {}
        if str(scope).upper() == "EXTRA_TIME":
            meta["scope"] = "EXTRA_TIME"
        if points is not None:
            meta["points"] = int(points)
        return meta

    creates: List[MatchIncident] = []

    for (team_id, scope), desired in desired_map.items():
        desired = int(desired)
        current = int(remaining_points.get((team_id, scope), 0))
        need = desired - current
        if need <= 0:
            continue

        period = _period_for_new_goal(scope)

        if discipline == Tournament.Discipline.BASKETBALL:
            for points in _points_to_basketball_chunks(need):
                creates.append(
                    MatchIncident(
                        match_id=match.id,
                        team_id=team_id,
                        kind="GOAL",
                        period=period,
                        time_source=time_source,
                        minute=minute,
                        minute_raw=minute_raw,
                        player_id=None,
                        meta=_meta_for_new_goal(scope, points=points),
                        created_by_id=created_by_id,
                    )
                )
        else:
            for _ in range(int(need)):
                creates.append(
                    MatchIncident(
                        match_id=match.id,
                        team_id=team_id,
                        kind="GOAL",
                        period=period,
                        time_source=time_source,
                        minute=minute,
                        minute_raw=minute_raw,
                        player_id=None,
                        meta=_meta_for_new_goal(scope),
                        created_by_id=created_by_id,
                    )
                )

    if creates:
        MatchIncident.objects.bulk_create(creates)

    return None


def _stop_match_clock(match: Match) -> None:
    now = timezone.now()
    elapsed = int(getattr(match, "clock_elapsed_seconds", 0) or 0)

    started_at = getattr(match, "clock_started_at", None)
    if started_at:
        try:
            delta = int((now - started_at).total_seconds())
        except Exception:
            delta = 0
        if delta < 0:
            delta = 0
        elapsed += delta

    if elapsed > _MAX_MATCH_SECONDS:
        elapsed = _MAX_MATCH_SECONDS

    match.clock_elapsed_seconds = elapsed
    match.clock_started_at = None
    match.clock_state = Match.ClockState.STOPPED


def _continue_match_clock(match: Match) -> None:
    now = timezone.now()

    if int(getattr(match, "clock_elapsed_seconds", 0) or 0) >= _MAX_MATCH_SECONDS:
        match.clock_state = Match.ClockState.STOPPED
        match.clock_started_at = None
        return

    match.clock_state = Match.ClockState.RUNNING
    match.clock_started_at = now


class TournamentMatchListView(ListAPIView):
    serializer_class = MatchSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        tournament = get_object_or_404(Tournament, pk=self.kwargs["pk"])

        user = self.request.user
        is_panel_user = (tournament.organizer_id == user.id) or user_is_assistant(user, tournament)
        if not is_panel_user:
            return Match.objects.none()

        return (
            Match.objects.filter(tournament=tournament)
            .select_related("home_team", "away_team", "stage", "winner")
            .prefetch_related("custom_results__team")
            .order_by("stage__order", "round_number", "id")
        )


class TournamentPublicMatchListView(ListAPIView):
    serializer_class = MatchSerializer
    permission_classes = [AllowAny]

    def get_queryset(self):
        tournament = get_object_or_404(Tournament, pk=self.kwargs["pk"])
        denied = public_access_or_403(self.request, tournament)
        if denied is not None:
            return Match.objects.none()

        return (
            Match.objects.filter(tournament=tournament)
            .select_related("home_team", "away_team", "stage", "winner")
            .prefetch_related("custom_results__team")
            .order_by("stage__order", "round_number", "id")
        )

    def list(self, request, *args, **kwargs):
        tournament = get_object_or_404(Tournament, pk=self.kwargs["pk"])
        denied = public_access_or_403(request, tournament)
        if denied is not None:
            return denied
        return super().list(request, *args, **kwargs)


class MatchScheduleUpdateView(RetrieveUpdateAPIView):
    queryset = Match.objects.all()
    serializer_class = MatchSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        return Match.objects.filter(
            Q(tournament__organizer=user) | Q(tournament__memberships__user=user)
        ).distinct()

    def update(self, request, *args, **kwargs):
        match = self.get_object()
        tournament = match.tournament

        if not can_edit_schedule(request.user, tournament):
            return Response(
                {"detail": "Nie masz uprawnień do edycji harmonogramu. Dostępny jest tylko podgląd."},
                status=status.HTTP_403_FORBIDDEN,
            )

        allowed_fields = {"scheduled_date", "scheduled_time", "location"}
        data = {key: value for key, value in request.data.items() if key in allowed_fields}

        serializer = self.get_serializer(match, data=data, partial=True)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)

        return Response(serializer.data, status=status.HTTP_200_OK)


class MatchCustomResultUpdateView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, *args, **kwargs):
        match_id = kwargs.get("pk") or kwargs.get("id")
        if not match_id:
            return Response({"detail": "Brak identyfikatora meczu."}, status=status.HTTP_400_BAD_REQUEST)

        match = get_object_or_404(
            Match.objects.select_related("stage", "tournament", "home_team", "away_team").select_for_update(),
            pk=match_id,
        )
        tournament = match.tournament
        stage = match.stage

        if not _is_custom_result_mode(tournament):
            return Response(
                {"detail": "Ten endpoint jest dostępny tylko dla trybu CUSTOM."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if _is_custom_head_to_head_points_table(tournament):
            return Response(
                {"detail": "Dla customowego systemu punktowego użyj standardowego endpointu zapisu wyniku meczu."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not can_edit_results(request.user, tournament):
            return Response(
                {"detail": "Nie masz uprawnień do edycji wyników. Dostępny jest tylko podgląd."},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = MatchCustomResultUpdateSerializer(
            data=request.data,
            context={"match": match, "user": request.user},
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()

        winner_id = _recalculate_custom_match_ranks(match)

        if match.status == Match.Status.SCHEDULED:
            match.status = Match.Status.IN_PROGRESS
            match.save(update_fields=["status"])

        if stage.stage_type in (Stage.StageType.LEAGUE, Stage.StageType.GROUP):
            try:
                MatchResultService.apply_result(match)
            except Exception:
                pass

            try:
                _regenerate_knockout_from_groups_if_safe(tournament)
            except Exception:
                pass

        elif stage.stage_type == Stage.StageType.KNOCKOUT or _is_third_place_stage(stage):
            if winner_id is not None and winner_id != match.winner_id:
                match.winner_id = winner_id
                match.save(update_fields=["winner"])

        ws_emit_tournament(match.tournament_id, "matches_changed", {"match_id": match.id})

        response_payload = {
            "detail": "Wynik niestandardowy zapisany.",
            "match": MatchSerializer(match).data,
            "custom_results": MatchCustomResultSerializer(
                match.custom_results.select_related("team").filter(is_active=True).order_by("rank", "id"),
                many=True,
            ).data,
        }
        return Response(response_payload, status=status.HTTP_200_OK)


class MatchResultUpdateView(RetrieveUpdateAPIView):
    serializer_class = MatchResultUpdateSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        return (
            Match.objects.filter(
                Q(tournament__organizer=user) | Q(tournament__memberships__user=user)
            )
            .select_related("stage", "tournament")
            .distinct()
        )

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        match = self.get_object()
        match = Match.objects.select_related("stage", "tournament").select_for_update().get(pk=match.pk)

        tournament = match.tournament

        if _is_custom_result_mode(tournament):
            return Response(
                {"detail": "Dla trybu CUSTOM użyj endpointu zapisu rezultatu."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not can_edit_results(request.user, tournament):
            return Response(
                {"detail": "Nie masz uprawnień do edycji wyników. Dostępny jest tylko podgląd."},
                status=status.HTTP_403_FORBIDDEN,
            )

        stage = match.stage

        old_single_winner_id = match.winner_id
        cup_matches = _get_cup_matches(tournament)
        is_knockout_like = stage.stage_type == Stage.StageType.KNOCKOUT or _is_third_place_stage(stage)

        if is_knockout_like and _is_tennis(tournament) and cup_matches == 2:
            return Response(
                {"detail": "Tenis nie wspiera trybu dwumeczu (cup_matches=2)."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        old_pair_winner = None
        if is_knockout_like and cup_matches == 2:
            old_pair_winner = _pair_winner_id(_get_pair_matches(stage, match))

        serializer = self.get_serializer(match, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)

        force = str(request.query_params.get("force") or "").strip().lower() in {"1", "true", "yes"}

        match = serializer.save()

        if match.status == Match.Status.SCHEDULED:
            touched = False
            for key in (
                "home_score",
                "away_score",
                "tennis_sets",
                "went_to_extra_time",
                "home_extra_time_score",
                "away_extra_time_score",
                "decided_by_penalties",
                "home_penalty_score",
                "away_penalty_score",
            ):
                if key in (request.data or {}):
                    touched = True
                    break

            if touched:
                match.status = Match.Status.IN_PROGRESS
                match.save(update_fields=["status"])
                ws_emit_tournament(match.tournament_id, "matches_changed", {"match_id": match.id})

        resp = _apply_manual_result_via_goal_incidents_or_409(
            match,
            force=force,
            created_by_id=request.user.id,
        )
        if resp is not None:
            if transaction.get_connection().in_atomic_block:
                transaction.set_rollback(True)
            return resp

        if stage.stage_type in (Stage.StageType.LEAGUE, Stage.StageType.GROUP):
            try:
                MatchResultService.apply_result(match)
            except Exception:
                pass

            try:
                _regenerate_knockout_from_groups_if_safe(tournament)
            except Exception:
                pass

            transaction.on_commit(
                lambda: ws_emit_tournament(
                    match.tournament_id,
                    "matches_changed",
                    {"match_id": match.id},
                )
            )
            return Response(MatchSerializer(match).data, status=status.HTTP_200_OK)

        if is_knockout_like:
            if cup_matches == 1:
                if _is_tennis(tournament):
                    new_winner_id = _tennis_winner_id_from_sets(match)
                else:
                    new_winner_id = knockout_winner_id(match)

                if new_winner_id != match.winner_id:
                    match.winner_id = new_winner_id
                    match.save(update_fields=["winner"])
                    ws_emit_tournament(match.tournament_id, "matches_changed", {"match_id": match.id})

                _handle_knockout_progression(tournament, stage, old_single_winner_id, new_winner_id)

            elif cup_matches == 2:
                _sync_two_leg_pair_winner_if_possible(stage, tournament, match)
                new_pair_winner = _pair_winner_id(_get_pair_matches(stage, match))
                _handle_knockout_progression(tournament, stage, old_pair_winner, new_pair_winner)

        transaction.on_commit(
            lambda: ws_emit_tournament(
                match.tournament_id,
                "matches_changed",
                {"match_id": match.id},
            )
        )
        return Response(MatchSerializer(match).data, status=status.HTTP_200_OK)


class FinishMatchView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, *args, **kwargs):
        match_id = kwargs.get("pk") or kwargs.get("id")
        if not match_id:
            return Response({"detail": "Brak identyfikatora meczu."}, status=status.HTTP_400_BAD_REQUEST)

        match = get_object_or_404(
            Match.objects.select_related("stage", "tournament", "home_team", "away_team").select_for_update(),
            pk=match_id,
        )
        tournament = match.tournament
        stage = match.stage

        if not can_edit_results(request.user, tournament):
            return Response(
                {"detail": "Nie masz uprawnień do zatwierdzania wyników. Dostępny jest tylko podgląd."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if _uses_custom_result_rows(tournament):
            winner_id = _recalculate_custom_match_ranks(match)
            if not match.result_entered:
                return Response(
                    {"detail": "Nie można zakończyć meczu custom bez zapisania wyników."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if stage.stage_type == Stage.StageType.KNOCKOUT and winner_id is None:
                return Response(
                    {"detail": "Mecz pucharowy musi mieć zwycięzcę."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            old_winner_id = match.winner_id
            match.status = Match.Status.FINISHED
            _stop_match_clock(match)
            match.save(
                update_fields=[
                    "status",
                    "clock_state",
                    "clock_started_at",
                    "clock_elapsed_seconds",
                ]
            )

            if stage.stage_type in (Stage.StageType.LEAGUE, Stage.StageType.GROUP):
                try:
                    MatchResultService.apply_result(match)
                except Exception:
                    pass

                try:
                    _regenerate_knockout_from_groups_if_safe(tournament)
                except Exception:
                    pass

            elif stage.stage_type == Stage.StageType.KNOCKOUT or _is_third_place_stage(stage):
                _handle_knockout_progression(tournament, stage, old_winner_id, winner_id)

            transaction.on_commit(
                lambda: ws_emit_tournament(
                    match.tournament_id,
                    "matches_changed",
                    {"match_id": match.id},
                )
            )
            return Response({"detail": "Mecz zakończony."}, status=status.HTTP_200_OK)

        force = str(request.query_params.get("force") or "").strip().lower() in {"1", "true", "yes"}

        resp = _apply_manual_result_via_goal_incidents_or_409(
            match,
            force=force,
            created_by_id=request.user.id,
        )
        if resp is not None:
            if transaction.get_connection().in_atomic_block:
                transaction.set_rollback(True)
            return resp

        cfg = tournament.format_config or {}

        if stage.stage_type in (Stage.StageType.LEAGUE, Stage.StageType.GROUP):
            if _is_tennis(tournament):
                err = _validate_tennis_match_before_finish(match, cfg)
                if err:
                    return Response({"detail": err}, status=status.HTTP_400_BAD_REQUEST)

            try:
                MatchResultService.apply_result(match)
            except Exception:
                pass

            match.status = Match.Status.FINISHED
            _stop_match_clock(match)
            match.save(
                update_fields=["status", "clock_state", "clock_started_at", "clock_elapsed_seconds"]
            )
            ws_emit_tournament(match.tournament_id, "matches_changed", {"match_id": match.id})

            try:
                _regenerate_knockout_from_groups_if_safe(tournament)
            except Exception:
                pass

            transaction.on_commit(
                lambda: ws_emit_tournament(
                    match.tournament_id,
                    "matches_changed",
                    {"match_id": match.id},
                )
            )
            return Response({"detail": "Mecz zakończony."}, status=status.HTTP_200_OK)

        cup_matches = _get_cup_matches(tournament)
        is_knockout_like = stage.stage_type == Stage.StageType.KNOCKOUT or _is_third_place_stage(stage)

        if is_knockout_like:
            if not match.result_entered:
                return Response(
                    {"detail": "Nie można zakończyć meczu KO bez wprowadzenia wyniku."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if _is_tennis(tournament):
                if cup_matches == 2:
                    return Response(
                        {"detail": "Tenis nie wspiera trybu dwumeczu (cup_matches=2)."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                err = _validate_tennis_match_before_finish(match, cfg)
                if err:
                    return Response({"detail": err}, status=status.HTTP_400_BAD_REQUEST)

            if match.home_score is None or match.away_score is None:
                return Response(
                    {"detail": "Brak kompletnego wyniku - uzupełnij bramki/punkty."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if cup_matches == 1:
                err = validate_extra_time_consistency(match) or validate_penalties_consistency(match)
                if err and not _is_tennis(tournament):
                    return Response({"detail": err}, status=status.HTTP_400_BAD_REQUEST)

                winner_id = (
                    _tennis_winner_id_from_sets(match)
                    if _is_tennis(tournament)
                    else knockout_winner_id(match)
                )
                if winner_id is None:
                    return Response(
                        {"detail": "Mecz pucharowy musi mieć zwycięzcę."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                old_winner_id = match.winner_id
                match.winner_id = winner_id
                match.status = Match.Status.FINISHED
                _stop_match_clock(match)
                match.save(
                    update_fields=[
                        "winner",
                        "status",
                        "clock_state",
                        "clock_started_at",
                        "clock_elapsed_seconds",
                    ]
                )
                ws_emit_tournament(match.tournament_id, "matches_changed", {"match_id": match.id})

                _handle_knockout_progression(tournament, stage, old_winner_id, winner_id)

                transaction.on_commit(
                    lambda: ws_emit_tournament(
                        match.tournament_id,
                        "matches_changed",
                        {"match_id": match.id},
                    )
                )
                return Response({"detail": "Mecz zakończony."}, status=status.HTTP_200_OK)

            if cup_matches == 2:
                old_pair_winner = _pair_winner_id(_get_pair_matches(stage, match))

                if match.status != Match.Status.FINISHED:
                    match.status = Match.Status.FINISHED
                    _stop_match_clock(match)
                    match.save(
                        update_fields=[
                            "status",
                            "clock_state",
                            "clock_started_at",
                            "clock_elapsed_seconds",
                        ]
                    )
                    ws_emit_tournament(match.tournament_id, "matches_changed", {"match_id": match.id})

                _sync_two_leg_pair_winner_if_possible(stage, tournament, match)

                group = _get_pair_matches(stage, match)
                if _pair_is_complete_two_leg(group):
                    new_pair_winner = _pair_winner_id(group)
                    if not new_pair_winner:
                        match.status = Match.Status.SCHEDULED
                        match.save(update_fields=["status"])
                        ws_emit_tournament(match.tournament_id, "matches_changed", {"match_id": match.id})
                        return Response(
                            {"detail": "Dwumecz musi być rozstrzygnięty."},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                else:
                    new_pair_winner = None

                _handle_knockout_progression(tournament, stage, old_pair_winner, new_pair_winner)

                transaction.on_commit(
                    lambda: ws_emit_tournament(
                        match.tournament_id,
                        "matches_changed",
                        {"match_id": match.id},
                    )
                )
                return Response({"detail": "Mecz zakończony."}, status=status.HTTP_200_OK)

        return Response({"detail": "Nieobsługiwany typ etapu."}, status=status.HTTP_400_BAD_REQUEST)


class ContinueMatchView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, *args, **kwargs):
        match_id = kwargs.get("pk") or kwargs.get("id")
        if not match_id:
            return Response({"detail": "Brak identyfikatora meczu."}, status=status.HTTP_400_BAD_REQUEST)

        match = get_object_or_404(
            Match.objects.select_related("stage", "tournament", "home_team", "away_team").select_for_update(),
            pk=match_id,
        )
        tournament = match.tournament

        if _uses_custom_result_rows(tournament):
            return Response(
                {"detail": "Kontynuacja jest dostępna po zapisaniu wyniku także dla trybu CUSTOM."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not can_edit_results(request.user, tournament):
            return Response(
                {"detail": "Nie masz uprawnień do kontynuowania meczu. Dostępny jest tylko podgląd."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if match.status != Match.Status.FINISHED:
            return Response(
                {"detail": "Mecz nie jest zakończony - nie ma czego kontynuować."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        match.status = Match.Status.IN_PROGRESS
        _continue_match_clock(match)

        match.save(update_fields=["status", "clock_state", "clock_started_at"])
        ws_emit_tournament(match.tournament_id, "matches_changed", {"match_id": match.id})

        return Response(MatchSerializer(match).data, status=status.HTTP_200_OK)


class SetScheduledMatchView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, *args, **kwargs):
        match_id = kwargs.get("pk") or kwargs.get("id")
        if not match_id:
            return Response({"detail": "Brak identyfikatora meczu."}, status=status.HTTP_400_BAD_REQUEST)

        match = get_object_or_404(
            Match.objects.select_related("stage", "tournament").select_for_update(),
            pk=match_id,
        )
        tournament = match.tournament

        if _uses_custom_result_rows(tournament):
            has_custom_results = match.custom_results.filter(is_active=True).exists()
            if has_custom_results:
                return Response(
                    {
                        "detail": "Nie można ustawić meczu jako zaplanowany: najpierw usuń zapisane wyniki custom.",
                        "code": "CANNOT_SET_SCHEDULED_WITH_CUSTOM_RESULTS",
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            if not (can_edit_results(request.user, tournament) or can_edit_schedule(request.user, tournament)):
                return Response(
                    {"detail": "Nie masz uprawnień do zmiany statusu meczu. Dostępny jest tylko podgląd."},
                    status=status.HTTP_403_FORBIDDEN,
                )

            match.status = Match.Status.SCHEDULED
            match.result_entered = False
            match.winner = None
            match.clock_state = Match.ClockState.NOT_STARTED
            match.clock_started_at = None
            match.clock_elapsed_seconds = 0
            if hasattr(match, "clock_added_seconds"):
                match.clock_added_seconds = 0
            match.clock_period = Match.ClockPeriod.NONE

            update_fields = [
                "status",
                "result_entered",
                "winner",
                "clock_state",
                "clock_started_at",
                "clock_elapsed_seconds",
                "clock_period",
            ]
            if hasattr(match, "clock_added_seconds"):
                update_fields.append("clock_added_seconds")

            match.save(update_fields=update_fields)
            ws_emit_tournament(match.tournament_id, "matches_changed", {"match_id": match.id})
            return Response(MatchSerializer(match).data, status=status.HTTP_200_OK)

        has_incidents = MatchIncident.objects.filter(match_id=match.id).exists()

        score_home = int(match.home_score or 0)
        score_away = int(match.away_score or 0)
        has_any_score = (score_home != 0) or (score_away != 0)

        if getattr(match, "went_to_extra_time", False):
            has_any_score = True
        if getattr(match, "decided_by_penalties", False):
            has_any_score = True
        if int(getattr(match, "home_extra_time_score", 0) or 0) != 0:
            has_any_score = True
        if int(getattr(match, "away_extra_time_score", 0) or 0) != 0:
            has_any_score = True
        if int(getattr(match, "home_penalty_score", 0) or 0) != 0:
            has_any_score = True
        if int(getattr(match, "away_penalty_score", 0) or 0) != 0:
            has_any_score = True
        if hasattr(match, "tennis_sets") and match.tennis_sets:
            has_any_score = True

        if has_incidents or has_any_score:
            return Response(
                {
                    "detail": "Nie można ustawić meczu jako zaplanowany: wymagany jest wynik 0:0 oraz brak incydentów.",
                    "code": "CANNOT_SET_SCHEDULED_WITH_DATA",
                    "has_incidents": bool(has_incidents),
                    "has_score": bool(has_any_score),
                },
                status=status.HTTP_409_CONFLICT,
            )

        if not (can_edit_results(request.user, tournament) or can_edit_schedule(request.user, tournament)):
            return Response(
                {"detail": "Nie masz uprawnień do zmiany statusu meczu. Dostępny jest tylko podgląd."},
                status=status.HTTP_403_FORBIDDEN,
            )

        match.status = Match.Status.SCHEDULED
        match.clock_state = Match.ClockState.NOT_STARTED
        match.clock_started_at = None
        match.clock_elapsed_seconds = 0
        if hasattr(match, "clock_added_seconds"):
            match.clock_added_seconds = 0
        match.clock_period = Match.ClockPeriod.NONE

        update_fields = [
            "status",
            "clock_state",
            "clock_started_at",
            "clock_elapsed_seconds",
            "clock_period",
        ]
        if hasattr(match, "clock_added_seconds"):
            update_fields.append("clock_added_seconds")

        match.save(update_fields=update_fields)
        ws_emit_tournament(match.tournament_id, "matches_changed", {"match_id": match.id})

        return Response(MatchSerializer(match).data, status=status.HTTP_200_OK)