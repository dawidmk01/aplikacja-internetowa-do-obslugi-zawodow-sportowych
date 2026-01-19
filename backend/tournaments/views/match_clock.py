# backend/tournaments/views/match_clock.py

from __future__ import annotations

from django.utils import timezone
from django.shortcuts import get_object_or_404

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework import status

from tournaments.models import Match, Tournament, TournamentMembership


def _get_membership_perms(user, tournament: Tournament) -> dict | None:
    if not user or user.is_anonymous:
        return None
    if user.id == tournament.organizer_id:
        # Organizer ma wszystko - nie potrzebujemy permsów z membership
        return {"__organizer__": True}
    m = TournamentMembership.objects.filter(tournament=tournament, user=user).first()
    if not m:
        return None
    return m.effective_permissions()


def _require_can_manage_clock(user, match: Match) -> None:
    """
    Zegar traktujemy jako element „live prowadzenia meczu”.
    Dopuszczamy organizatora oraz asystenta z results_edit LUB schedule_edit.
    """
    tournament = match.tournament
    perms = _get_membership_perms(user, tournament)
    if not perms:
        raise PermissionError("Brak uprawnień.")
    if perms.get("__organizer__"):
        return
    if perms.get(TournamentMembership.PERM_RESULTS_EDIT) or perms.get(TournamentMembership.PERM_SCHEDULE_EDIT):
        return
    raise PermissionError("Brak uprawnień do obsługi zegara.")


def _default_period_for_discipline(match: Match) -> str:
    d = match.tournament.discipline
    if d == Tournament.Discipline.FOOTBALL:
        return Match.ClockPeriod.FH
    if d == Tournament.Discipline.HANDBALL:
        return Match.ClockPeriod.H1
    return Match.ClockPeriod.NONE


def _allowed_periods_for_match(match: Match) -> set[str]:
    d = match.tournament.discipline
    if d == Tournament.Discipline.FOOTBALL:
        return {Match.ClockPeriod.FH, Match.ClockPeriod.SH, Match.ClockPeriod.ET1, Match.ClockPeriod.ET2, Match.ClockPeriod.NONE}
    if d == Tournament.Discipline.HANDBALL:
        return {Match.ClockPeriod.H1, Match.ClockPeriod.H2, Match.ClockPeriod.NONE}
    return {Match.ClockPeriod.NONE}


def _serialize_clock(match: Match) -> dict:
    now = timezone.now()
    return {
        "match_id": match.id,
        "clock_state": match.clock_state,
        "clock_period": match.clock_period,
        "clock_started_at": match.clock_started_at.isoformat() if match.clock_started_at else None,
        "clock_elapsed_seconds": int(match.clock_elapsed_seconds or 0),
        "clock_added_seconds": int(match.clock_added_seconds or 0),
        "seconds_in_period": match.clock_seconds_in_period(now=now),
        "seconds_total": match.clock_seconds_total(now=now),
        "minute_total": match.clock_minute_total(now=now),
        "server_time": now.isoformat(),
    }


class MatchClockGetView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, match_id: int):
        match = get_object_or_404(Match.objects.select_related("tournament"), pk=match_id)
        try:
            _require_can_manage_clock(request.user, match)
        except PermissionError as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)

        return Response(_serialize_clock(match))


class MatchClockStartView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, match_id: int):
        match = get_object_or_404(Match.objects.select_related("tournament"), pk=match_id)
        try:
            _require_can_manage_clock(request.user, match)
        except PermissionError as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)

        now = timezone.now()

        # jeśli już działa, zwróć stan
        if match.clock_state == Match.ClockState.RUNNING:
            return Response(_serialize_clock(match))

        # start ustawia RUNNING i inicjuje started_at
        match.clock_state = Match.ClockState.RUNNING
        match.clock_started_at = now

        # jeśli brak sensownego okresu – ustaw domyślny dla dyscypliny
        allowed = _allowed_periods_for_match(match)
        if match.clock_period not in allowed or match.clock_period == Match.ClockPeriod.NONE:
            match.clock_period = _default_period_for_discipline(match)

        # jeśli startujemy od zera – zostaw elapsed; jeśli użytkownik chce „nowy okres”, zrobi period endpointem
        match.save(update_fields=["clock_state", "clock_started_at", "clock_period"])

        # opcjonalnie: mecz w trakcie
        if match.status == Match.Status.SCHEDULED:
            match.status = Match.Status.IN_PROGRESS
            match.save(update_fields=["status"])

        return Response(_serialize_clock(match))


class MatchClockPauseView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, match_id: int):
        match = get_object_or_404(Match.objects.select_related("tournament"), pk=match_id)
        try:
            _require_can_manage_clock(request.user, match)
        except PermissionError as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)

        now = timezone.now()

        if match.clock_state != Match.ClockState.RUNNING:
            return Response(_serialize_clock(match))

        # zsumuj aktualny odcinek
        if match.clock_started_at:
            delta = now - match.clock_started_at
            match.clock_elapsed_seconds = int(match.clock_elapsed_seconds or 0) + max(0, int(delta.total_seconds()))

        match.clock_started_at = None
        match.clock_state = Match.ClockState.PAUSED
        match.save(update_fields=["clock_elapsed_seconds", "clock_started_at", "clock_state"])

        return Response(_serialize_clock(match))


class MatchClockResumeView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, match_id: int):
        match = get_object_or_404(Match.objects.select_related("tournament"), pk=match_id)
        try:
            _require_can_manage_clock(request.user, match)
        except PermissionError as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)

        if match.clock_state == Match.ClockState.RUNNING:
            return Response(_serialize_clock(match))

        if match.clock_state not in (Match.ClockState.PAUSED, Match.ClockState.NOT_STARTED, Match.ClockState.STOPPED):
            return Response(_serialize_clock(match))

        match.clock_state = Match.ClockState.RUNNING
        match.clock_started_at = timezone.now()
        match.save(update_fields=["clock_state", "clock_started_at"])

        return Response(_serialize_clock(match))


class MatchClockStopView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, match_id: int):
        match = get_object_or_404(Match.objects.select_related("tournament"), pk=match_id)
        try:
            _require_can_manage_clock(request.user, match)
        except PermissionError as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)

        now = timezone.now()

        if match.clock_state == Match.ClockState.RUNNING and match.clock_started_at:
            delta = now - match.clock_started_at
            match.clock_elapsed_seconds = int(match.clock_elapsed_seconds or 0) + max(0, int(delta.total_seconds()))

        match.clock_started_at = None
        match.clock_state = Match.ClockState.STOPPED
        match.save(update_fields=["clock_elapsed_seconds", "clock_started_at", "clock_state"])

        return Response(_serialize_clock(match))


class MatchClockSetPeriodView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, match_id: int):
        """
        Body: { "period": "FH" | "SH" | ... }
        Uwaga: ustawienie okresu traktujemy jako rozpoczęcie „nowego odcinka czasu”
        => reset clock_elapsed_seconds do 0.
        """
        match = get_object_or_404(Match.objects.select_related("tournament"), pk=match_id)
        try:
            _require_can_manage_clock(request.user, match)
        except PermissionError as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)

        period = (request.data or {}).get("period", None)
        if not period:
            return Response({"detail": "Wymagane pole period."}, status=status.HTTP_400_BAD_REQUEST)

        allowed = _allowed_periods_for_match(match)
        if period not in allowed:
            return Response(
                {"detail": f"Nieprawidłowy period dla tej dyscypliny. Dozwolone: {sorted(list(allowed))}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        now = timezone.now()

        # kończymy bieżący odcinek jeśli biegł
        if match.clock_state == Match.ClockState.RUNNING and match.clock_started_at:
            delta = now - match.clock_started_at
            match.clock_elapsed_seconds = int(match.clock_elapsed_seconds or 0) + max(0, int(delta.total_seconds()))

        match.clock_period = period
        match.clock_elapsed_seconds = 0
        match.clock_started_at = now if match.clock_state == Match.ClockState.RUNNING else None
        match.save(update_fields=["clock_period", "clock_elapsed_seconds", "clock_started_at"])

        return Response(_serialize_clock(match))


class MatchClockSetAddedSecondsView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, match_id: int):
        """
        Body: { "added_seconds": 0.. }
        """
        match = get_object_or_404(Match.objects.select_related("tournament"), pk=match_id)
        try:
            _require_can_manage_clock(request.user, match)
        except PermissionError as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)

        raw = (request.data or {}).get("added_seconds", None)
        try:
            added = int(raw)
        except (TypeError, ValueError):
            return Response({"detail": "added_seconds musi być liczbą całkowitą."}, status=status.HTTP_400_BAD_REQUEST)

        if added < 0:
            return Response({"detail": "added_seconds nie może być ujemne."}, status=status.HTTP_400_BAD_REQUEST)

        match.clock_added_seconds = added
        match.save(update_fields=["clock_added_seconds"])
        return Response(_serialize_clock(match))
