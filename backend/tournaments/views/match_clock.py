# backend/tournaments/views/match_clock.py
# Plik obsługuje odczyt i sterowanie zegarem meczu z payloadem realtime rozszerzonym o dywizję.

from __future__ import annotations

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone

from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from tournaments.access import can_edit_results, can_edit_schedule
from tournaments.models import Match, Tournament

from ..realtime import ws_emit_tournament
from ._helpers import public_access_or_403

MAX_CLOCK_SECONDS = 3 * 60 * 60


def _division_id(match: Match):
    return getattr(match.stage, "division_id", None)


def _ws_emit_clock(match: Match) -> None:
    payload = {"match_id": match.id, "division_id": _division_id(match)}
    ws_emit_tournament(match.tournament_id, "clock_changed", payload)
    ws_emit_tournament(match.tournament_id, "matches_changed", payload)


def _p(name: str, fallback: str) -> str:
    return getattr(Match.ClockPeriod, name, fallback)


def _is_extra_time_period(period: str | None) -> bool:
    value = (period or "").strip()
    if not value:
        return False
    return value in {_p("ET1", "ET1"), _p("ET2", "ET2"), _p("ET", "ET"), _p("OT", "OT")}


def _ensure_went_to_extra_time(match: Match) -> bool:
    if not hasattr(match, "went_to_extra_time"):
        return False
    if getattr(match, "went_to_extra_time", False):
        return False
    setattr(match, "went_to_extra_time", True)
    return True


def _minute_from_seconds(seconds: int) -> int:
    seconds = max(0, int(seconds or 0))
    if seconds <= 0:
        return 0
    return (seconds + 59) // 60


def _require_can_manage_clock(user, match: Match) -> None:
    if can_edit_results(user, match.tournament) or can_edit_schedule(user, match.tournament):
        return
    raise PermissionError("Brak uprawnień do obsługi zegara.")


def _default_period_for_discipline(match: Match) -> str:
    discipline = match.tournament.discipline
    if discipline == Tournament.Discipline.FOOTBALL:
        return _p("FH", "FH")
    if discipline == Tournament.Discipline.HANDBALL:
        return _p("H1", "H1")
    return _p("NONE", "NONE")


def _allowed_periods_for_match(match: Match) -> set[str]:
    discipline = match.tournament.discipline
    allowed: set[str] = {_p("NONE", "NONE")}
    if discipline == Tournament.Discipline.FOOTBALL:
        allowed.update({_p("FH", "FH"), _p("SH", "SH"), _p("ET1", "ET1"), _p("ET2", "ET2")})
        return allowed
    if discipline == Tournament.Discipline.HANDBALL:
        allowed.update({_p("H1", "H1"), _p("H2", "H2"), _p("ET1", "ET1"), _p("ET2", "ET2")})
        return allowed
    return allowed


def _clock_running_elapsed_seconds(match: Match, now) -> int:
    base = int(match.clock_elapsed_seconds or 0)
    if match.clock_state == Match.ClockState.RUNNING and match.clock_started_at:
        try:
            delta = now - match.clock_started_at
            base += max(0, int(delta.total_seconds()))
        except Exception:
            pass
    return base


def _maybe_apply_clock_cap(match: Match, now) -> bool:
    elapsed_now = _clock_running_elapsed_seconds(match, now)
    if elapsed_now <= MAX_CLOCK_SECONDS:
        if int(match.clock_elapsed_seconds or 0) > MAX_CLOCK_SECONDS:
            match.clock_elapsed_seconds = MAX_CLOCK_SECONDS
            return True
        return False

    match.clock_elapsed_seconds = MAX_CLOCK_SECONDS
    match.clock_started_at = None
    match.clock_state = Match.ClockState.STOPPED
    return True


def _serialize_clock(match: Match) -> dict:
    now = timezone.now()
    if _maybe_apply_clock_cap(match, now):
        match.save(update_fields=["clock_elapsed_seconds", "clock_started_at", "clock_state"])

    elapsed_safe = min(MAX_CLOCK_SECONDS, _clock_running_elapsed_seconds(match, now))
    added = max(0, int(match.clock_added_seconds or 0))
    total_safe = min(MAX_CLOCK_SECONDS, elapsed_safe + added)

    return {
        "match_id": match.id,
        "division_id": _division_id(match),
        "match_status": getattr(match, "status", None),
        "clock_state": match.clock_state,
        "clock_period": match.clock_period,
        "clock_started_at": match.clock_started_at.isoformat() if match.clock_started_at else None,
        "clock_elapsed_seconds": int(match.clock_elapsed_seconds or 0),
        "clock_added_seconds": int(match.clock_added_seconds or 0),
        "seconds_in_period": int(elapsed_safe),
        "seconds_total": int(total_safe),
        "minute_total": _minute_from_seconds(int(total_safe)),
        "max_clock_seconds": MAX_CLOCK_SECONDS,
        "server_time": now.isoformat(),
    }


class MatchClockGetView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, match_id: int):
        match = get_object_or_404(Match.objects.select_related("tournament", "stage"), pk=match_id)
        err = public_access_or_403(request, match.tournament)
        if err is not None:
            return err
        return Response(_serialize_clock(match))


class MatchClockStartView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, match_id: int):
        match = get_object_or_404(Match.objects.select_related("tournament", "stage"), pk=match_id)

        try:
            _require_can_manage_clock(request.user, match)
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)

        now = timezone.now()

        if _maybe_apply_clock_cap(match, now):
            match.save(update_fields=["clock_elapsed_seconds", "clock_started_at", "clock_state"])
            _ws_emit_clock(match)
            return Response(_serialize_clock(match))

        if match.clock_state == Match.ClockState.RUNNING:
            return Response(_serialize_clock(match))

        status_changed = False
        if getattr(match, "status", None) == Match.Status.SCHEDULED:
            match.status = Match.Status.IN_PROGRESS
            status_changed = True

        match.clock_state = Match.ClockState.RUNNING
        match.clock_started_at = now

        allowed = _allowed_periods_for_match(match)
        if match.clock_period not in allowed or match.clock_period == _p("NONE", "NONE"):
            match.clock_period = _default_period_for_discipline(match)

        update_fields = ["clock_state", "clock_started_at", "clock_period"]
        if status_changed:
            update_fields.append("status")
        if _is_extra_time_period(match.clock_period) and _ensure_went_to_extra_time(match):
            update_fields.append("went_to_extra_time")

        match.save(update_fields=update_fields)
        _ws_emit_clock(match)
        return Response(_serialize_clock(match))


class MatchClockPauseView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, match_id: int):
        match = get_object_or_404(Match.objects.select_related("tournament", "stage"), pk=match_id)

        try:
            _require_can_manage_clock(request.user, match)
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)

        now = timezone.now()

        if match.clock_state != Match.ClockState.RUNNING:
            return Response(_serialize_clock(match))

        if match.clock_started_at:
            delta = now - match.clock_started_at
            add = max(0, int(delta.total_seconds()))
            match.clock_elapsed_seconds = min(MAX_CLOCK_SECONDS, int(match.clock_elapsed_seconds or 0) + add)

        match.clock_state = Match.ClockState.PAUSED
        match.clock_started_at = None

        match.save(update_fields=["clock_elapsed_seconds", "clock_started_at", "clock_state"])
        _ws_emit_clock(match)
        return Response(_serialize_clock(match))


class MatchClockResumeView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, match_id: int):
        match = get_object_or_404(Match.objects.select_related("tournament", "stage"), pk=match_id)

        try:
            _require_can_manage_clock(request.user, match)
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)

        now = timezone.now()

        if _maybe_apply_clock_cap(match, now):
            match.save(update_fields=["clock_elapsed_seconds", "clock_started_at", "clock_state"])
            _ws_emit_clock(match)
            return Response(_serialize_clock(match))

        if match.clock_state == Match.ClockState.RUNNING:
            return Response(_serialize_clock(match))

        status_changed = False
        if getattr(match, "status", None) == Match.Status.SCHEDULED:
            match.status = Match.Status.IN_PROGRESS
            status_changed = True

        match.clock_state = Match.ClockState.RUNNING
        match.clock_started_at = now

        update_fields = ["clock_state", "clock_started_at"]
        if status_changed:
            update_fields.append("status")
        if _is_extra_time_period(match.clock_period) and _ensure_went_to_extra_time(match):
            update_fields.append("went_to_extra_time")

        match.save(update_fields=update_fields)
        _ws_emit_clock(match)
        return Response(_serialize_clock(match))


class MatchClockStopView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, match_id: int):
        match = get_object_or_404(Match.objects.select_related("tournament", "stage"), pk=match_id)

        try:
            _require_can_manage_clock(request.user, match)
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)

        now = timezone.now()

        if match.clock_state == Match.ClockState.RUNNING and match.clock_started_at:
            delta = now - match.clock_started_at
            add = max(0, int(delta.total_seconds()))
            match.clock_elapsed_seconds = min(MAX_CLOCK_SECONDS, int(match.clock_elapsed_seconds or 0) + add)

        match.clock_started_at = None
        match.clock_state = Match.ClockState.STOPPED

        match.save(update_fields=["clock_elapsed_seconds", "clock_started_at", "clock_state"])
        _ws_emit_clock(match)
        return Response(_serialize_clock(match))


class MatchClockSetPeriodView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, match_id: int):
        match = get_object_or_404(Match.objects.select_related("tournament", "stage"), pk=match_id)

        try:
            _require_can_manage_clock(request.user, match)
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)

        period = (request.data or {}).get("period")
        if not period:
            return Response({"detail": "Wymagane pole period."}, status=status.HTTP_400_BAD_REQUEST)

        allowed = _allowed_periods_for_match(match)
        if period not in allowed:
            return Response({"detail": f"Nieprawidłowy period. Dozwolone: {sorted(list(allowed))}"}, status=status.HTTP_400_BAD_REQUEST)

        now = timezone.now()

        if match.clock_state == Match.ClockState.RUNNING and match.clock_started_at:
            delta = now - match.clock_started_at
            match.clock_elapsed_seconds = min(
                MAX_CLOCK_SECONDS,
                int(match.clock_elapsed_seconds or 0) + max(0, int(delta.total_seconds())),
            )

        match.clock_period = period
        match.clock_elapsed_seconds = 0
        match.clock_started_at = now if match.clock_state == Match.ClockState.RUNNING else None

        update_fields = ["clock_period", "clock_elapsed_seconds", "clock_started_at"]
        if _is_extra_time_period(period) and _ensure_went_to_extra_time(match):
            update_fields.append("went_to_extra_time")

        match.save(update_fields=update_fields)
        _ws_emit_clock(match)
        return Response(_serialize_clock(match))


class MatchClockSetAddedSecondsView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, match_id: int):
        match = get_object_or_404(Match.objects.select_related("tournament", "stage"), pk=match_id)

        try:
            _require_can_manage_clock(request.user, match)
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)

        raw = (request.data or {}).get("added_seconds")
        try:
            added = int(raw)
        except (TypeError, ValueError):
            return Response({"detail": "added_seconds musi być liczbą całkowitą."}, status=status.HTTP_400_BAD_REQUEST)

        if added < 0:
            return Response({"detail": "added_seconds nie może być ujemne."}, status=status.HTTP_400_BAD_REQUEST)

        match.clock_added_seconds = added
        match.save(update_fields=["clock_added_seconds"])
        _ws_emit_clock(match)
        return Response(_serialize_clock(match))


class MatchClockResetPeriodView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, match_id: int):
        with transaction.atomic():
            match = get_object_or_404(
                Match.objects.select_related("tournament", "stage").select_for_update(),
                pk=match_id,
            )

            try:
                _require_can_manage_clock(request.user, match)
            except PermissionError as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)

            data = request.data or {}
            allowed = _allowed_periods_for_match(match)

            period = match.clock_period or Match.ClockPeriod.NONE
            if data.get("period") not in (None, "", "null"):
                period = str(data.get("period")).strip()

            if period not in allowed:
                return Response({"detail": f"Nieprawidłowy period. Dozwolone: {sorted(list(allowed))}"}, status=status.HTTP_400_BAD_REQUEST)

            match.clock_state = Match.ClockState.NOT_STARTED
            match.clock_started_at = None
            match.clock_elapsed_seconds = 0
            match.clock_added_seconds = 0
            match.clock_period = period

            match.save(
                update_fields=[
                    "clock_state",
                    "clock_started_at",
                    "clock_elapsed_seconds",
                    "clock_added_seconds",
                    "clock_period",
                ]
            )

            _ws_emit_clock(match)
            return Response(_serialize_clock(match), status=status.HTTP_200_OK)
