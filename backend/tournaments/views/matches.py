from __future__ import annotations

from typing import Optional, List, Tuple

from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404

from rest_framework import status
from rest_framework.generics import ListAPIView, RetrieveUpdateAPIView
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from tournaments.services.match_result import MatchResultService
from tournaments.services.match_outcome import (
    knockout_winner_id,
    validate_extra_time_consistency,
    validate_penalties_consistency,
)

from ..models import Match, Stage, Tournament, MatchIncident
from ..serializers import MatchResultUpdateSerializer, MatchSerializer
from ._helpers import (
    # PODGLĄD/ROLE (NOWA STRATEGIA)
    user_is_assistant,
    user_can_view_tournament,
    can_edit_schedule,
    can_edit_results,
    public_access_or_403,  # <-- NOWE: wspólna kontrola dostępu do TournamentPublic

    # KO helpers (bez zmian)
    _get_cup_matches,
    _sync_two_leg_pair_winner_if_possible,
    _try_auto_advance_knockout,
    handle_knockout_winner_change,
)

# ============================================================
# Local Helpers
# ============================================================

def _third_place_value() -> str:
    """Safely retrieves the value for Third Place stage type."""
    return getattr(Stage.StageType, "THIRD_PLACE", "THIRD_PLACE")


def _is_third_place_stage(stage: Stage) -> bool:
    return str(stage.stage_type) == str(_third_place_value())


def _is_tennis(tournament: Tournament) -> bool:
    return (getattr(tournament, "discipline", "") or "").lower() == "tennis"


def _get_pair_matches(stage: Stage, match: Match) -> List[Match]:
    """
    Returns matches belonging to the same pair (Home vs Away or Away vs Home) in the same stage.
    Used for two-legged ties.
    """
    if not match.home_team_id or not match.away_team_id:
        return [match]

    qs = Match.objects.filter(
        Q(home_team_id=match.home_team_id, away_team_id=match.away_team_id) |
        Q(home_team_id=match.away_team_id, away_team_id=match.home_team_id),
        stage=stage
    ).only(
        "id", "status", "winner_id",
        "home_team_id", "away_team_id",
        "home_score", "away_score",
        "tennis_sets",
        "went_to_extra_time", "home_extra_time_score", "away_extra_time_score",
        "decided_by_penalties", "home_penalty_score", "away_penalty_score",
        "result_entered",
    )
    return list(qs)


def _pair_is_complete_two_leg(group: List[Match]) -> bool:
    return len(group) == 2 and all(m.status == Match.Status.FINISHED for m in group)


def _pair_winner_id(group: List[Match]) -> Optional[int]:
    """
    Assumes _sync_two_leg_pair_winner_if_possible sets winner_id on BOTH matches when possible.
    """
    if not group:
        return None
    ids = {m.winner_id for m in group}
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
    """
    Applies only to the main KNOCKOUT tree (not Third Place).
    """
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
        return "; ".join(str(x) for x in detail)
    if isinstance(detail, dict):
        for k in ("non_field_errors", "tennis_sets", "detail"):
            v = detail.get(k)
            if v:
                if isinstance(v, list):
                    return "; ".join(str(x) for x in v)
                return str(v)
        return "; ".join(f"{k}: {v}" for k, v in detail.items())
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
    except Exception as e:
        detail = getattr(e, "detail", None)
        if detail is not None:
            return _stringify_validation_detail(detail)
        return str(e)

    hs = int(match.home_score or 0)
    aws = int(match.away_score or 0)

    if hs != home_sets or aws != away_sets:
        return "Niespójność danych: wynik setów nie zgadza się z tennis_sets. Zapisz wynik ponownie."

    return None


def _tennis_winner_id_from_sets(match: Match) -> Optional[int]:
    hs = int(match.home_score or 0)
    aws = int(match.away_score or 0)
    if hs == aws:
        return None
    return match.home_team_id if hs > aws else match.away_team_id


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


# =========================
# Incidents -> score guard
# =========================

def _incident_goal_points(discipline: str, meta: object) -> int:
    """
    GOAL punktacja:
    - koszykówka: meta.points = 1/2/3 (domyślnie 1)
    - reszta: 1
    """
    if discipline == Tournament.Discipline.BASKETBALL:
        m = meta if isinstance(meta, dict) else {}
        raw = m.get("points", 1)
        try:
            pts = int(raw or 1)
        except (TypeError, ValueError):
            pts = 1
        return pts if pts in (1, 2, 3) else 1
    return 1


def _incident_counts_for_main_score(discipline: str, period: object) -> bool:
    """
    Na tym etapie pilnujemy spójności głównego wyniku (home_score/away_score)
    z incydentami GOAL. Jeżeli w przyszłości rozdzielisz ET na osobne pola,
    to ET1/ET2 nie powinny liczyć się do main-score.
    """
    p = str(period or "").strip() or "NONE"

    if discipline == Tournament.Discipline.FOOTBALL:
        return p in {"NONE", "FH", "SH"}  # ET1/ET2 pomijamy
    if discipline == Tournament.Discipline.HANDBALL:
        return p in {"NONE", "H1", "H2"}
    # kosz + pozostałe: liczymy wszystko
    return True


def _min_scores_from_goal_incidents(match: Match) -> Tuple[int, int]:
    """
    Minimalny wynik wymagany przez zarejestrowane incydenty GOAL.
    Wymusza zasadę: nie można zbić wyniku poniżej tego, co już jest opisane incydentami.
    """
    t = match.tournament
    discipline = t.discipline

    if not match.home_team_id or not match.away_team_id:
        return 0, 0

    qs = (
        MatchIncident.objects
        .filter(match_id=match.id, kind="GOAL")
        .only("team_id", "meta", "period")
    )

    home_min = 0
    away_min = 0

    for i in qs:
        if not _incident_counts_for_main_score(discipline, i.period):
            continue
        pts = _incident_goal_points(discipline, i.meta)
        if i.team_id == match.home_team_id:
            home_min += pts
        elif i.team_id == match.away_team_id:
            away_min += pts

    return int(home_min), int(away_min)


def _validate_scores_not_below_incidents(match: Match, home_score, away_score) -> Optional[str]:
    """
    Blokujemy zapis, gdy ktoś próbuje ustawić wynik < suma GOAL incydentów.
    (Dokładnie to: „korekta w dół wymaga usunięcia incydentu”.)
    """
    if _is_tennis(match.tournament):
        return None

    home_min, away_min = _min_scores_from_goal_incidents(match)

    if home_score is None:
        if home_min > 0:
            return f"Nie można wyczyścić wyniku gospodarzy: istnieją incydenty GOAL ({home_min}). Usuń incydenty lub ustaw wynik >= {home_min}."
    else:
        try:
            hs = int(home_score)
        except (TypeError, ValueError):
            return "home_score musi być liczbą."
        if hs < home_min:
            return f"Wynik gospodarzy ({hs}) nie może być mniejszy niż suma z incydentów GOAL ({home_min}). Usuń incydenty lub ustaw wynik >= {home_min}."

    if away_score is None:
        if away_min > 0:
            return f"Nie można wyczyścić wyniku gości: istnieją incydenty GOAL ({away_min}). Usuń incydenty lub ustaw wynik >= {away_min}."
    else:
        try:
            aws = int(away_score)
        except (TypeError, ValueError):
            return "away_score musi być liczbą."
        if aws < away_min:
            return f"Wynik gości ({aws}) nie może być mniejszy niż suma z incydentów GOAL ({away_min}). Usuń incydenty lub ustaw wynik >= {away_min}."

    return None


# ============================================================
# Views
# ============================================================

class TournamentMatchListView(ListAPIView):
    """
    Lista meczów dla panelu (organizator/asystent).
    NOWA STRATEGIA: asystent ma podgląd także w ORGANIZER_ONLY.
    """
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
            .select_related("home_team", "away_team", "stage")
            .order_by("stage__order", "round_number", "id")
        )


class TournamentPublicMatchListView(ListAPIView):
    """
    Publiczna lista meczów dla widza.
    """
    serializer_class = MatchSerializer
    permission_classes = [AllowAny]

    def get_queryset(self):
        tournament = get_object_or_404(Tournament, pk=self.kwargs["pk"])
        denied = public_access_or_403(self.request, tournament)
        if denied is not None:
            return Match.objects.none()

        return (
            Match.objects.filter(tournament=tournament)
            .select_related("home_team", "away_team", "stage")
            .order_by("stage__order", "round_number", "id")
        )

    def list(self, request, *args, **kwargs):
        tournament = get_object_or_404(Tournament, pk=self.kwargs["pk"])
        denied = public_access_or_403(request, tournament)
        if denied is not None:
            return denied
        return super().list(request, *args, **kwargs)


class MatchScheduleUpdateView(RetrieveUpdateAPIView):
    """
    PATCH /api/matches/<id>/
    Edycja harmonogramu – granularnie (schedule_edit).
    """
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
        data = {k: v for k, v in request.data.items() if k in allowed_fields}

        serializer = self.get_serializer(match, data=data, partial=True)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)

        return Response(serializer.data, status=status.HTTP_200_OK)


class MatchResultUpdateView(RetrieveUpdateAPIView):
    """
    PATCH /api/matches/<pk>/result/
    Edycja wyników – granularnie (results_edit).
    """
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
        # zablokuj rekord meczu na czas update
        match = self.get_object()
        match = (
            Match.objects
            .select_related("stage", "tournament")
            .select_for_update()
            .get(pk=match.pk)
        )

        tournament = match.tournament

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

        # --- GUARD: wynik nie może spaść poniżej incydentów GOAL ---
        proposed_home = serializer.validated_data.get("home_score", match.home_score)
        proposed_away = serializer.validated_data.get("away_score", match.away_score)
        err = _validate_scores_not_below_incidents(match, proposed_home, proposed_away)
        if err:
            return Response({"detail": err}, status=status.HTTP_400_BAD_REQUEST)

        match = serializer.save()

        if stage.stage_type in (Stage.StageType.LEAGUE, Stage.StageType.GROUP):
            try:
                MatchResultService.apply_result(match)
            except Exception:
                pass

            try:
                _regenerate_knockout_from_groups_if_safe(tournament)
            except Exception:
                pass

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

                _handle_knockout_progression(tournament, stage, old_single_winner_id, new_winner_id)

            elif cup_matches == 2:
                _sync_two_leg_pair_winner_if_possible(stage, tournament, match)
                new_pair_winner = _pair_winner_id(_get_pair_matches(stage, match))
                _handle_knockout_progression(tournament, stage, old_pair_winner, new_pair_winner)

        return Response(MatchSerializer(match).data, status=status.HTTP_200_OK)


class FinishMatchView(APIView):
    """
    POST /api/matches/<pk>/finish/
    Finish – także traktujemy jako edycję wyników (results_edit).
    """
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

        # --- GUARD: nie kończymy meczu, jeśli wynik < incydenty GOAL ---
        err = _validate_scores_not_below_incidents(match, match.home_score, match.away_score)
        if err:
            return Response({"detail": err}, status=status.HTTP_400_BAD_REQUEST)

        cfg = tournament.format_config or {}

        if stage.stage_type in (Stage.StageType.LEAGUE, Stage.StageType.GROUP):
            if _is_tennis(tournament):
                err2 = _validate_tennis_match_before_finish(match, cfg)
                if err2:
                    return Response({"detail": err2}, status=status.HTTP_400_BAD_REQUEST)

            try:
                MatchResultService.apply_result(match)
            except Exception:
                pass

            match.status = Match.Status.FINISHED
            match.save(update_fields=["status"])

            try:
                _regenerate_knockout_from_groups_if_safe(tournament)
            except Exception:
                pass

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
                err3 = _validate_tennis_match_before_finish(match, cfg)
                if err3:
                    return Response({"detail": err3}, status=status.HTTP_400_BAD_REQUEST)

            if match.home_score is None or match.away_score is None:
                return Response(
                    {"detail": "Brak kompletnego wyniku — uzupełnij bramki/punkty."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if cup_matches == 1:
                err4 = validate_extra_time_consistency(match) or validate_penalties_consistency(match)
                if err4 and not _is_tennis(tournament):
                    return Response({"detail": err4}, status=status.HTTP_400_BAD_REQUEST)

                winner_id = _tennis_winner_id_from_sets(match) if _is_tennis(tournament) else knockout_winner_id(match)

                if winner_id is None:
                    return Response(
                        {"detail": "Mecz pucharowy musi mieć zwycięzcę."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                old_winner_id = match.winner_id
                match.winner_id = winner_id
                match.status = Match.Status.FINISHED
                match.save(update_fields=["winner", "status"])

                _handle_knockout_progression(tournament, stage, old_winner_id, winner_id)
                return Response({"detail": "Mecz zakończony."}, status=status.HTTP_200_OK)

            elif cup_matches == 2:
                old_pair_winner = _pair_winner_id(_get_pair_matches(stage, match))

                if match.status != Match.Status.FINISHED:
                    match.status = Match.Status.FINISHED
                    match.save(update_fields=["status"])

                _sync_two_leg_pair_winner_if_possible(stage, tournament, match)

                group = _get_pair_matches(stage, match)
                if _pair_is_complete_two_leg(group):
                    new_pair_winner = _pair_winner_id(group)
                    if not new_pair_winner:
                        match.status = Match.Status.SCHEDULED
                        match.save(update_fields=["status"])
                        return Response(
                            {"detail": "Dwumecz musi być rozstrzygnięty."},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                else:
                    new_pair_winner = None

                _handle_knockout_progression(tournament, stage, old_pair_winner, new_pair_winner)
                return Response({"detail": "Mecz zakończony."}, status=status.HTTP_200_OK)

        return Response({"detail": "Nieobsługiwany typ etapu."}, status=status.HTTP_400_BAD_REQUEST)
