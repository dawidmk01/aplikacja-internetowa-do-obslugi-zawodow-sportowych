# backend/tournaments/views/incidents.py
# Plik obsługuje odczyt, tworzenie, edycję i usuwanie incydentów meczowych.

from __future__ import annotations

from django.db import transaction
from django.db.models import Case, F, IntegerField, Value, When
from django.shortcuts import get_object_or_404
from django.utils import timezone

from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from tournaments.access import can_edit_results
from tournaments.models import Match, MatchIncident, TeamPlayer, Tournament

from ..realtime import ws_emit_tournament


def _require_can_manage_incidents(user, match: Match) -> None:
    # Incydenty są traktowane jako część live/results.
    if can_edit_results(user, match.tournament):
        return
    raise PermissionError("Brak uprawnień do rejestrowania incydentów.")


def _kind_display(kind: str, discipline: str) -> str:
    # Opis jest jawnie mapowany, aby nie polegać na label z choices.
    if discipline == Tournament.Discipline.BASKETBALL:
        mapping = {"GOAL": "Punkt", "FOUL": "Faul", "TIMEOUT": "Timeout"}
        return mapping.get(kind, kind)

    if discipline == Tournament.Discipline.HANDBALL:
        mapping = {
            "GOAL": "Bramka",
            "FOUL": "Faul",
            "TIMEOUT": "Timeout",
            "HANDBALL_TWO_MINUTES": "Kara 2 min",
            "SUBSTITUTION": "Zmiana",
        }
        return mapping.get(kind, kind)

    if discipline == Tournament.Discipline.TENNIS:
        mapping = {
            "TENNIS_POINT": "Punkt",
            "TENNIS_CODE_VIOLATION": "Naruszenie przepisów",
            "TIMEOUT": "Przerwa/timeout",
        }
        return mapping.get(kind, kind)

    mapping = {
        "GOAL": "Bramka",
        "YELLOW_CARD": "Żółta kartka",
        "RED_CARD": "Czerwona kartka",
        "FOUL": "Faul",
        "SUBSTITUTION": "Zmiana",
        "TIMEOUT": "Przerwa/timeout",
    }
    return mapping.get(kind, kind)


def _allowed_kinds_for_discipline(discipline: str) -> set[str]:
    if discipline == Tournament.Discipline.FOOTBALL:
        return {"GOAL", "YELLOW_CARD", "RED_CARD", "FOUL", "SUBSTITUTION", "TIMEOUT"}

    if discipline == Tournament.Discipline.HANDBALL:
        return {"GOAL", "FOUL", "TIMEOUT", "HANDBALL_TWO_MINUTES", "SUBSTITUTION"}

    if discipline == Tournament.Discipline.BASKETBALL:
        return {"GOAL", "FOUL", "TIMEOUT"}

    if discipline == Tournament.Discipline.TENNIS:
        return {"TENNIS_POINT", "TENNIS_CODE_VIOLATION", "TIMEOUT"}

    return {"GOAL", "FOUL", "TIMEOUT"}


_TIMEOUT_KIND = getattr(MatchIncident.Kind, "TIMEOUT", "TIMEOUT")


def _should_timeout_pause_clock(discipline: str) -> bool:
    return discipline in (Tournament.Discipline.HANDBALL, Tournament.Discipline.BASKETBALL)


def _pause_clock_if_running(match: Match, *, now) -> None:
    # Timeout w sportach stop-clock zatrzymuje zegar bez osobnego endpointu.
    if match.clock_state != Match.ClockState.RUNNING:
        return

    if match.clock_started_at:
        delta = now - match.clock_started_at
        match.clock_elapsed_seconds = int(match.clock_elapsed_seconds or 0) + max(0, int(delta.total_seconds()))

    match.clock_started_at = None
    match.clock_state = Match.ClockState.PAUSED
    match.save(update_fields=["clock_elapsed_seconds", "clock_started_at", "clock_state"])


SCORE_SCOPE_REGULAR = "REGULAR"
SCORE_SCOPE_EXTRA_TIME = "EXTRA_TIME"


def _norm_score_scope(scope: str | None) -> str:
    value = (scope or SCORE_SCOPE_REGULAR).strip().upper()
    return SCORE_SCOPE_EXTRA_TIME if value == SCORE_SCOPE_EXTRA_TIME else SCORE_SCOPE_REGULAR


def _is_extra_time_period(period: str | None) -> bool:
    value = (period or "").strip().upper()
    if not value:
        return False
    return value in ("ET1", "ET2", "ET", "OT", SCORE_SCOPE_EXTRA_TIME)


def _default_period_for_scope(discipline: str, scope: str) -> str:
    if str(scope).upper() == SCORE_SCOPE_EXTRA_TIME:
        if discipline in (Tournament.Discipline.FOOTBALL, Tournament.Discipline.HANDBALL):
            return "ET1"
        return "ET"
    return getattr(Match.ClockPeriod, "NONE", "NONE")


def _resolve_scope(match: Match, *, data: dict, meta: dict, period: str | None) -> str:
    # Scope jest wyliczany z payloadu, meta lub period.
    if "scope" in data and data.get("scope") not in (None, "", "null"):
        return _norm_score_scope(str(data.get("scope")))

    if isinstance(meta, dict) and meta.get("scope") not in (None, "", "null"):
        return _norm_score_scope(str(meta.get("scope")))

    if _is_extra_time_period(period):
        return SCORE_SCOPE_EXTRA_TIME

    return SCORE_SCOPE_REGULAR


def _incident_scope(incident_meta: dict) -> str:
    try:
        return _norm_score_scope(incident_meta.get("scope"))
    except Exception:
        return SCORE_SCOPE_REGULAR


def _goal_points_for_discipline(discipline: str, meta: dict) -> int:
    # W koszykówce GOAL może oznaczać 1, 2 lub 3 punkty.
    if discipline == Tournament.Discipline.BASKETBALL:
        raw = meta.get("points", meta.get("_points", 1))
        try:
            points = int(raw or 1)
        except (TypeError, ValueError):
            points = 1

        if points not in (1, 2, 3):
            raise ValueError("Koszykówka: meta.points musi być 1, 2 lub 3.")

        return points

    return 1


def _sum_goal_points_for_team_scoped(match_id: int, team_id: int, discipline: str, scope: str) -> int:
    scope = _norm_score_scope(scope)
    qs = MatchIncident.objects.filter(match_id=match_id, kind="GOAL", team_id=team_id).only("meta")

    total = 0
    for incident in qs:
        meta = incident.meta if isinstance(incident.meta, dict) else {}
        if _incident_scope(meta) != scope:
            continue

        try:
            total += _goal_points_for_discipline(discipline, meta)
        except ValueError:
            total += 1

    return int(total)


def _recompute_match_score_from_goal_incidents(match: Match) -> None:
    # Wynik dla sportów GOAL-based jest liczony wyłącznie z incydentów GOAL.
    discipline = match.tournament.discipline
    if discipline == Tournament.Discipline.TENNIS:
        return

    home_id = match.home_team_id
    away_id = match.away_team_id

    home_reg = _sum_goal_points_for_team_scoped(match.id, home_id, discipline, SCORE_SCOPE_REGULAR) if home_id else 0
    away_reg = _sum_goal_points_for_team_scoped(match.id, away_id, discipline, SCORE_SCOPE_REGULAR) if away_id else 0
    home_et = _sum_goal_points_for_team_scoped(match.id, home_id, discipline, SCORE_SCOPE_EXTRA_TIME) if home_id else 0
    away_et = _sum_goal_points_for_team_scoped(match.id, away_id, discipline, SCORE_SCOPE_EXTRA_TIME) if away_id else 0

    update_fields: list[str] = []

    if int(match.home_score or 0) != int(home_reg):
        match.home_score = int(home_reg)
        update_fields.append("home_score")

    if int(match.away_score or 0) != int(away_reg):
        match.away_score = int(away_reg)
        update_fields.append("away_score")

    if hasattr(match, "home_extra_time_score") and int(getattr(match, "home_extra_time_score", 0) or 0) != int(home_et):
        setattr(match, "home_extra_time_score", int(home_et))
        update_fields.append("home_extra_time_score")

    if hasattr(match, "away_extra_time_score") and int(getattr(match, "away_extra_time_score", 0) or 0) != int(away_et):
        setattr(match, "away_extra_time_score", int(away_et))
        update_fields.append("away_extra_time_score")

    if (home_et + away_et) > 0 and hasattr(match, "went_to_extra_time") and not getattr(match, "went_to_extra_time", False):
        match.went_to_extra_time = True
        update_fields.append("went_to_extra_time")

    if update_fields:
        match.save(update_fields=update_fields)


def _serialize_incident(incident: MatchIncident) -> dict:
    discipline = incident.match.tournament.discipline
    return {
        "id": incident.id,
        "match_id": incident.match_id,
        "team_id": incident.team_id,
        "kind": incident.kind,
        "kind_display": _kind_display(incident.kind, discipline),
        "period": incident.period,
        "time_source": incident.time_source,
        "minute": incident.minute,
        "minute_raw": incident.minute_raw,
        "player_id": incident.player_id,
        "player_name": incident.player.display_name if incident.player else None,
        "player_in_id": incident.player_in_id,
        "player_in_name": incident.player_in.display_name if incident.player_in else None,
        "player_out_id": incident.player_out_id,
        "player_out_name": incident.player_out.display_name if incident.player_out else None,
        "meta": incident.meta or {},
        "created_by": incident.created_by_id,
        "created_at": incident.created_at.isoformat() if incident.created_at else None,
    }


def _parse_int(value, field: str, allow_none: bool = True) -> int | None:
    if value is None or value == "":
        return None if allow_none else 0

    try:
        return int(value)
    except (TypeError, ValueError):
        raise ValueError(f"{field} musi być liczbą całkowitą.")


def _team_must_be_in_match(match: Match, team_id: int) -> None:
    if team_id not in (match.home_team_id, match.away_team_id):
        raise ValueError("team_id musi być jedną z drużyn tego meczu (home/away).")


def _player_must_belong_to_team(player: TeamPlayer, team_id: int) -> None:
    if player.team_id != team_id:
        raise ValueError("Zawodnik nie należy do wskazanej drużyny.")


class MatchIncidentListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get_permissions(self):
        # Publiczny odczyt jest dozwolony, zapis pozostaje prywatny.
        if self.request.method in ("GET", "HEAD", "OPTIONS"):
            return [AllowAny()]
        return [IsAuthenticated()]

    def get(self, request, match_id: int):
        match = get_object_or_404(Match.objects.select_related("tournament"), pk=match_id)

        can_manage = False
        if request.user and getattr(request.user, "is_authenticated", False):
            try:
                _require_can_manage_incidents(request.user, match)
                can_manage = True
            except PermissionError:
                can_manage = False

        if not can_manage:
            tournament = match.tournament

            if not getattr(tournament, "is_published", False):
                return Response({"detail": "Brak uprawnień."}, status=status.HTTP_403_FORBIDDEN)

            access_code = getattr(tournament, "access_code", None)
            if access_code:
                provided = request.query_params.get("code")
                if provided != access_code:
                    return Response({"detail": "Nieprawidłowy kod dostępu."}, status=status.HTTP_403_FORBIDDEN)

        # Incydenty bez czasu są wyżej, potem minute DESC, potem id DESC.
        qs = (
            MatchIncident.objects.select_related("match__tournament", "player", "player_in", "player_out")
            .filter(match_id=match_id)
            .annotate(
                _no_minute=Case(
                    When(minute__isnull=True, then=Value(0)),
                    default=Value(1),
                    output_field=IntegerField(),
                )
            )
            .order_by("_no_minute", F("minute").desc(nulls_last=True), F("id").desc())
        )

        return Response([_serialize_incident(item) for item in qs])

    def post(self, request, match_id: int):
        with transaction.atomic():
            match = get_object_or_404(
                Match.objects.select_related("tournament").select_for_update(),
                pk=match_id,
            )

            try:
                _require_can_manage_incidents(request.user, match)
            except PermissionError as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)

            data = request.data or {}
            discipline = match.tournament.discipline

            kind = (data.get("kind") or "").strip()
            if not kind:
                return Response({"detail": "Wymagane pole kind."}, status=status.HTTP_400_BAD_REQUEST)

            allowed_kinds = _allowed_kinds_for_discipline(discipline)
            if kind not in allowed_kinds:
                return Response(
                    {
                        "detail": (
                            f"kind '{kind}' nie jest dozwolony dla dyscypliny {discipline}. "
                            f"Dozwolone: {sorted(list(allowed_kinds))}"
                        )
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

            try:
                team_id = _parse_int(data.get("team_id"), "team_id", allow_none=False)
                assert team_id is not None
                _team_must_be_in_match(match, team_id)

                time_source = (data.get("time_source") or MatchIncident.TimeSource.CLOCK).strip()
                if time_source not in (MatchIncident.TimeSource.CLOCK, MatchIncident.TimeSource.MANUAL):
                    raise ValueError("time_source musi być CLOCK albo MANUAL.")

                minute = _parse_int(data.get("minute"), "minute", allow_none=True)
                minute_raw = (data.get("minute_raw") or "").strip() or None

                if time_source == MatchIncident.TimeSource.CLOCK and minute is None:
                    if match.clock_state == Match.ClockState.NOT_STARTED and int(match.clock_elapsed_seconds or 0) == 0:
                        raise ValueError("Zegar meczu nie jest uruchomiony - podaj minute ręcznie albo uruchom zegar.")
                    minute = match.clock_minute_total(now=timezone.now())

                period = match.clock_period if match.clock_period else getattr(Match.ClockPeriod, "NONE", "NONE")
                if "period" in data and data.get("period"):
                    period = str(data.get("period")).strip()

                player_id = _parse_int(data.get("player_id"), "player_id", allow_none=True)
                player_in_id = _parse_int(data.get("player_in_id"), "player_in_id", allow_none=True)
                player_out_id = _parse_int(data.get("player_out_id"), "player_out_id", allow_none=True)

                player = None
                player_in = None
                player_out = None

                if player_id:
                    player = get_object_or_404(TeamPlayer, pk=player_id)
                    _player_must_belong_to_team(player, team_id)

                if kind == MatchIncident.Kind.SUBSTITUTION:
                    if not player_in_id or not player_out_id:
                        raise ValueError("Dla SUBSTITUTION wymagane są player_in_id oraz player_out_id.")

                    player_in = get_object_or_404(TeamPlayer, pk=player_in_id)
                    player_out = get_object_or_404(TeamPlayer, pk=player_out_id)

                    _player_must_belong_to_team(player_in, team_id)
                    _player_must_belong_to_team(player_out, team_id)

                meta = data.get("meta")
                if meta is None:
                    meta = {}
                if not isinstance(meta, dict):
                    raise ValueError("meta musi być obiektem JSON.")

                if "points" in data:
                    points = _parse_int(data.get("points"), "points", allow_none=True)
                    if points is not None:
                        meta = dict(meta)
                        meta["points"] = int(points)

                if kind == "GOAL" and discipline != Tournament.Discipline.TENNIS:
                    meta = dict(meta)
                    scope = _resolve_scope(match, data=data, meta=meta, period=period)
                    meta["scope"] = scope
                    _goal_points_for_discipline(discipline, meta)

                    if scope == SCORE_SCOPE_EXTRA_TIME and not _is_extra_time_period(period):
                        period = _default_period_for_scope(discipline, scope)

            except (ValueError, AssertionError) as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

            incident = MatchIncident.objects.create(
                match=match,
                team_id=team_id,
                kind=kind,
                period=period or getattr(Match.ClockPeriod, "NONE", "NONE"),
                time_source=time_source,
                minute=minute,
                minute_raw=minute_raw,
                player=player,
                player_in=player_in,
                player_out=player_out,
                meta=meta,
                created_by=request.user,
            )

            if kind == _TIMEOUT_KIND and _should_timeout_pause_clock(discipline):
                _pause_clock_if_running(match, now=timezone.now())

            if kind == "GOAL" and discipline != Tournament.Discipline.TENNIS:
                scope = _incident_scope(meta if isinstance(meta, dict) else {})
                if scope == SCORE_SCOPE_EXTRA_TIME and hasattr(match, "went_to_extra_time") and not getattr(match, "went_to_extra_time", False):
                    match.went_to_extra_time = True
                    match.save(update_fields=["went_to_extra_time"])

                _recompute_match_score_from_goal_incidents(match)

            ws_emit_tournament(
                match.tournament_id,
                {"v": 1, "type": "incidents.changed", "tournamentId": match.tournament_id, "matchId": match.id},
            )
            ws_emit_tournament(
                match.tournament_id,
                {"v": 1, "type": "matches.changed", "tournamentId": match.tournament_id, "matchId": match.id},
            )

            incident = (
                MatchIncident.objects.select_related("match__tournament", "player", "player_in", "player_out")
                .get(pk=incident.id)
            )
            return Response(_serialize_incident(incident), status=status.HTTP_201_CREATED)


class MatchIncidentDeleteView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, incident_id: int):
        # Aktualizacja nie zmienia match_id, team_id ani kind.
        with transaction.atomic():
            incident = get_object_or_404(
                MatchIncident.objects.select_related("match__tournament").select_for_update(),
                pk=incident_id,
            )
            match = Match.objects.select_related("tournament").select_for_update().get(pk=incident.match_id)

            try:
                _require_can_manage_incidents(request.user, match)
            except PermissionError as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)

            data = request.data or {}
            discipline = match.tournament.discipline

            if "minute" in data:
                value = data.get("minute")
                if value in (None, "", "null"):
                    incident.minute = None
                else:
                    try:
                        incident.minute = int(value)
                    except (TypeError, ValueError):
                        return Response({"detail": "Nieprawidłowa minuta."}, status=status.HTTP_400_BAD_REQUEST)

            if "minute_raw" in data:
                value = data.get("minute_raw")
                incident.minute_raw = str(value).strip() if value not in (None, "") else None

            if "player_id" in data:
                value = data.get("player_id")
                if value in (None, "", "null"):
                    incident.player_id = None
                else:
                    try:
                        player_id = int(value)
                    except (TypeError, ValueError):
                        return Response({"detail": "Nieprawidłowy zawodnik."}, status=status.HTTP_400_BAD_REQUEST)

                    player = TeamPlayer.objects.filter(pk=player_id).select_related("team").first()
                    if not player:
                        return Response({"detail": "Nie znaleziono zawodnika."}, status=status.HTTP_400_BAD_REQUEST)
                    if player.team_id != incident.team_id:
                        return Response({"detail": "Zawodnik nie należy do tej drużyny."}, status=status.HTTP_400_BAD_REQUEST)

                    incident.player_id = player_id

            if "player_out_id" in data:
                value = data.get("player_out_id")
                if value in (None, "", "null"):
                    incident.player_out_id = None
                else:
                    try:
                        player_id = int(value)
                    except (TypeError, ValueError):
                        return Response({"detail": "Nieprawidłowy zawodnik schodzący."}, status=status.HTTP_400_BAD_REQUEST)

                    player = TeamPlayer.objects.filter(pk=player_id).select_related("team").first()
                    if not player:
                        return Response({"detail": "Nie znaleziono zawodnika schodzącego."}, status=status.HTTP_400_BAD_REQUEST)
                    if player.team_id != incident.team_id:
                        return Response(
                            {"detail": "Zawodnik schodzący nie należy do tej drużyny."},
                            status=status.HTTP_400_BAD_REQUEST,
                        )

                    incident.player_out_id = player_id

            if "player_in_id" in data:
                value = data.get("player_in_id")
                if value in (None, "", "null"):
                    incident.player_in_id = None
                else:
                    try:
                        player_id = int(value)
                    except (TypeError, ValueError):
                        return Response({"detail": "Nieprawidłowy zawodnik wchodzący."}, status=status.HTTP_400_BAD_REQUEST)

                    player = TeamPlayer.objects.filter(pk=player_id).select_related("team").first()
                    if not player:
                        return Response({"detail": "Nie znaleziono zawodnika wchodzącego."}, status=status.HTTP_400_BAD_REQUEST)
                    if player.team_id != incident.team_id:
                        return Response(
                            {"detail": "Zawodnik wchodzący nie należy do tej drużyny."},
                            status=status.HTTP_400_BAD_REQUEST,
                        )

                    incident.player_in_id = player_id

            if "note" in data:
                note = data.get("note")
                meta = incident.meta if isinstance(incident.meta, dict) else {}
                meta = dict(meta)

                if note in (None, "", "null"):
                    meta.pop("note", None)
                else:
                    meta["note"] = str(note)

                incident.meta = meta

            if "scope" in data and incident.kind == "GOAL" and discipline != Tournament.Discipline.TENNIS:
                meta = incident.meta if isinstance(incident.meta, dict) else {}
                meta = dict(meta)
                meta["scope"] = _norm_score_scope(str(data.get("scope")))
                incident.meta = meta

                if meta["scope"] == SCORE_SCOPE_EXTRA_TIME and not _is_extra_time_period(incident.period):
                    incident.period = _default_period_for_scope(discipline, SCORE_SCOPE_EXTRA_TIME)

            if "points" in data and incident.kind == "GOAL":
                if discipline != Tournament.Discipline.BASKETBALL:
                    return Response(
                        {"detail": "Pole points jest dozwolone tylko dla koszykówki."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                try:
                    points = int(data.get("points"))
                except (TypeError, ValueError):
                    return Response({"detail": "Nieprawidłowe points."}, status=status.HTTP_400_BAD_REQUEST)

                meta = incident.meta if isinstance(incident.meta, dict) else {}
                meta = dict(meta)
                meta["points"] = points

                try:
                    _goal_points_for_discipline(discipline, meta)
                except ValueError as exc:
                    return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

                incident.meta = meta

            if incident.kind == MatchIncident.Kind.SUBSTITUTION:
                if not incident.player_in_id or not incident.player_out_id:
                    return Response(
                        {"detail": "Zmiana wymaga zawodnika schodzącego i wchodzącego."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
            else:
                incident.player_in_id = None
                incident.player_out_id = None

            incident.save()

            if incident.kind == "GOAL" and discipline != Tournament.Discipline.TENNIS and ("scope" in data or "points" in data):
                if hasattr(match, "went_to_extra_time"):
                    meta = incident.meta if isinstance(incident.meta, dict) else {}
                    if _incident_scope(meta) == SCORE_SCOPE_EXTRA_TIME and not getattr(match, "went_to_extra_time", False):
                        match.went_to_extra_time = True
                        match.save(update_fields=["went_to_extra_time"])

                _recompute_match_score_from_goal_incidents(match)

            ws_emit_tournament(
                match.tournament_id,
                {"v": 1, "type": "incidents.changed", "tournamentId": match.tournament_id, "matchId": match.id},
            )
            ws_emit_tournament(
                match.tournament_id,
                {"v": 1, "type": "matches.changed", "tournamentId": match.tournament_id, "matchId": match.id},
            )

            incident = (
                MatchIncident.objects.select_related("match__tournament", "player", "player_in", "player_out")
                .get(pk=incident.id)
            )
            return Response(_serialize_incident(incident), status=status.HTTP_200_OK)

    def delete(self, request, incident_id: int):
        with transaction.atomic():
            incident = get_object_or_404(
                MatchIncident.objects.select_related("match__tournament").select_for_update(),
                pk=incident_id,
            )
            match = Match.objects.select_related("tournament").select_for_update().get(pk=incident.match_id)

            try:
                _require_can_manage_incidents(request.user, match)
            except PermissionError as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)

            discipline = match.tournament.discipline
            was_goal = incident.kind == "GOAL" and discipline != Tournament.Discipline.TENNIS

            incident.delete()

            if was_goal:
                _recompute_match_score_from_goal_incidents(match)

            ws_emit_tournament(
                match.tournament_id,
                {"v": 1, "type": "incidents.changed", "tournamentId": match.tournament_id, "matchId": match.id},
            )
            ws_emit_tournament(
                match.tournament_id,
                {"v": 1, "type": "matches.changed", "tournamentId": match.tournament_id, "matchId": match.id},
            )

            return Response(status=status.HTTP_204_NO_CONTENT)


class MatchIncidentRecomputeScoreView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, match_id: int):
        with transaction.atomic():
            match = get_object_or_404(
                Match.objects.select_related("tournament").select_for_update(),
                pk=match_id,
            )

            try:
                _require_can_manage_incidents(request.user, match)
            except PermissionError as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)

            discipline = match.tournament.discipline
            if discipline == Tournament.Discipline.TENNIS:
                return Response(
                    {"detail": "Tenis: punkty są przechowywane jako incydenty. Recompute setów/gemów dopniemy osobno."},
                    status=status.HTTP_200_OK,
                )

            _recompute_match_score_from_goal_incidents(match)

            home_reg = (
                _sum_goal_points_for_team_scoped(match.id, match.home_team_id, discipline, SCORE_SCOPE_REGULAR)
                if match.home_team_id
                else 0
            )
            away_reg = (
                _sum_goal_points_for_team_scoped(match.id, match.away_team_id, discipline, SCORE_SCOPE_REGULAR)
                if match.away_team_id
                else 0
            )
            home_et = (
                _sum_goal_points_for_team_scoped(match.id, match.home_team_id, discipline, SCORE_SCOPE_EXTRA_TIME)
                if match.home_team_id
                else 0
            )
            away_et = (
                _sum_goal_points_for_team_scoped(match.id, match.away_team_id, discipline, SCORE_SCOPE_EXTRA_TIME)
                if match.away_team_id
                else 0
            )

            return Response(
                {
                    "match_id": match.id,
                    "home_score": int(match.home_score or 0),
                    "away_score": int(match.away_score or 0),
                    "home_extra_time_score": int(getattr(match, "home_extra_time_score", 0) or 0),
                    "away_extra_time_score": int(getattr(match, "away_extra_time_score", 0) or 0),
                    "incidents_regular_home": int(home_reg),
                    "incidents_regular_away": int(away_reg),
                    "incidents_extra_time_home": int(home_et),
                    "incidents_extra_time_away": int(away_et),
                },
                status=status.HTTP_200_OK,
            )