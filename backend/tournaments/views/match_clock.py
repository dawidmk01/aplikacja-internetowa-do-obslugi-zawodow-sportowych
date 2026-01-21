# backend/tournaments/views/match_clock.py

from __future__ import annotations

from django.utils import timezone
from django.shortcuts import get_object_or_404

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework import status

from tournaments.models import Match, Tournament, TournamentMembership

# =========================
# Konfiguracja
# =========================

MAX_CLOCK_SECONDS = 3 * 60 * 60  # 3h cap na zegar (żeby nie dobijał do 900+ min)
BREAK_WARN_SECONDS = 13 * 60     # ~2 min przed 15 min -> "ostrzeżenie" (np. żółty)
BREAK_DANGER_SECONDS = 15 * 60   # >= 15 min -> "przekroczona" (np. czerwony)




def _minute_from_seconds(sec: int) -> int:
    """Minuta 1..N (jak w sporcie): 0 sekund => 0, inaczej sufit(sec/60)."""
    sec = max(0, int(sec or 0))
    if sec <= 0:
        return 0
    return (sec + 59) // 60
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
        return {
            Match.ClockPeriod.FH,
            Match.ClockPeriod.SH,
            Match.ClockPeriod.ET1,
            Match.ClockPeriod.ET2,
            Match.ClockPeriod.NONE,
        }
    if d == Tournament.Discipline.HANDBALL:
        return {Match.ClockPeriod.H1, Match.ClockPeriod.H2, Match.ClockPeriod.NONE}
    return {Match.ClockPeriod.NONE}


def _is_break_active(match: Match) -> bool:
    """
    Przerwa techniczna = PAUSED + clock_started_at ustawione.
    (clock_started_at jest wtedy momentem rozpoczęcia przerwy)
    """
    return match.clock_state == Match.ClockState.PAUSED and bool(match.clock_started_at)


def _break_seconds(match: Match, now) -> int:
    if not _is_break_active(match):
        return 0
    try:
        delta = now - match.clock_started_at
        return max(0, int(delta.total_seconds()))
    except Exception:
        return 0


def _break_level(break_seconds: int) -> str:
    """
    NORMAL: < warn
    WARN:   warn..danger-1
    DANGER: >= danger
    """
    if break_seconds >= BREAK_DANGER_SECONDS:
        return "DANGER"
    if break_seconds >= BREAK_WARN_SECONDS:
        return "WARN"
    return "NORMAL"


def _clock_running_elapsed_seconds(match: Match, now) -> int:
    """
    Zegar meczu (bez doliczonego) liczony defensywnie na podstawie pól:
    elapsed + (now-started_at) gdy RUNNING.
    """
    base = int(match.clock_elapsed_seconds or 0)
    if match.clock_state == Match.ClockState.RUNNING and match.clock_started_at:
        try:
            delta = now - match.clock_started_at
            base += max(0, int(delta.total_seconds()))
        except Exception:
            pass
    return base


def _maybe_apply_clock_cap(match: Match, now) -> bool:
    """
    Jeśli zegar jest RUNNING i przekroczył limit 3h:
    - clamp elapsed do MAX_CLOCK_SECONDS
    - STOPPED + started_at=None
    Zwraca True jeśli cap zadziałał (zmieniliśmy obiekt).
    """
    # Jeżeli ktoś już "nabijał" > MAX w elapsed, też clampujemy
    changed = False
    elapsed_now = _clock_running_elapsed_seconds(match, now)

    if elapsed_now <= MAX_CLOCK_SECONDS:
        if int(match.clock_elapsed_seconds or 0) > MAX_CLOCK_SECONDS:
            match.clock_elapsed_seconds = MAX_CLOCK_SECONDS
            changed = True
        return changed

    # przekroczony cap
    match.clock_elapsed_seconds = MAX_CLOCK_SECONDS
    match.clock_started_at = None
    match.clock_state = Match.ClockState.STOPPED
    changed = True
    return changed


def _maybe_set_status(match: Match, desired: str) -> bool:
    """
    Ustaw status meczu, ale tylko jeśli enum zawiera taką wartość.
    Zwraca True jeśli ustawiono.
    """
    if not hasattr(match, "status"):
        return False

    # tekst/choices: desired jest stringiem
    # spróbujmy znaleźć po nazwach w Match.Status
    if not hasattr(Match, "Status"):
        return False

    # jeśli desired jest już realną wartością, ustawiamy
    try:
        current = match.status
    except Exception:
        current = None

    if current == desired:
        return False

    match.status = desired
    return True


def _resolve_finished_status_value() -> str | None:
    """
    Defensywnie: różne projekty używają FINISHED / COMPLETED / DONE.
    Zwraca pierwszą znalezioną wartość z Match.Status.* albo None.
    """
    if not hasattr(Match, "Status"):
        return None
    for name in ("FINISHED", "COMPLETED", "DONE"):
        try:
            val = getattr(Match.Status, name)
            if val:
                return val
        except Exception:
            continue
    return None


def _serialize_clock(match: Match) -> dict:
    now = timezone.now()

    # cap na RUNNING (żeby nie pokazywać 900 min)
    cap_applied = _maybe_apply_clock_cap(match, now)
    if cap_applied:
        match.save(update_fields=["clock_elapsed_seconds", "clock_started_at", "clock_state"])

    # czas meczu (bezpieczny)
    elapsed_safe = min(MAX_CLOCK_SECONDS, _clock_running_elapsed_seconds(match, now))
    cap_reached = elapsed_safe >= MAX_CLOCK_SECONDS

    # przerwa
    bsec = _break_seconds(match, now)
    blevel = _break_level(bsec)
    write_locked = _is_break_active(match)

    # Oryginalne metody (dla kompatybilności) – mogą bazować na Twoich regułach:
    seconds_in_period_raw = match.clock_seconds_in_period(now=now)
    seconds_total_raw = match.clock_seconds_total(now=now)
    minute_total_raw = match.clock_minute_total(now=now)

    return {
        "match_id": match.id,
        "match_status": getattr(match, "status", None),

        "clock_state": match.clock_state,
        "clock_period": match.clock_period,

        # Uwaga: clock_started_at ma 2 znaczenia:
        # - RUNNING: start odcinka czasu meczu
        # - BREAK  : początek przerwy (gdy PAUSED)
        "clock_started_at": match.clock_started_at.isoformat() if match.clock_started_at else None,

        "clock_elapsed_seconds": int(match.clock_elapsed_seconds or 0),
        "clock_added_seconds": int(match.clock_added_seconds or 0),

        # legacy поля – frontend MatchLivePanel oczekuje seconds_in_period/seconds_total/minute_total
        "seconds_in_period": elapsed_safe,
        "seconds_total": min(MAX_CLOCK_SECONDS, elapsed_safe),
        "minute_total": _minute_from_seconds(min(MAX_CLOCK_SECONDS, elapsed_safe)),

        # RAW (Twoje metody)
        "seconds_in_period_raw": seconds_in_period_raw,
        "seconds_total_raw": seconds_total_raw,
        "minute_total_raw": minute_total_raw,
        "minute_total_display": _minute_from_seconds(min(MAX_CLOCK_SECONDS, elapsed_safe)),

        # SAFE (cap 3h)
        "max_clock_seconds": MAX_CLOCK_SECONDS,
        "seconds_in_period_safe": elapsed_safe,
        "seconds_total_safe": min(MAX_CLOCK_SECONDS, elapsed_safe),  # na tym etapie = per-odcinek
        "minute_total_safe": _minute_from_seconds(min(MAX_CLOCK_SECONDS, elapsed_safe)),
        "cap_reached": cap_reached,

        # Przerwa techniczna
        "is_break": write_locked,
        "break_seconds": bsec,
        "break_level": blevel,
        "break_warn_seconds": BREAK_WARN_SECONDS,
        "break_danger_seconds": BREAK_DANGER_SECONDS,

        # sygnał dla frontu i innych endpointów (matches/incidents)
        "write_locked": write_locked,

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

        # cap w razie gdyby RUNNING dobijał do kosmosu
        if _maybe_apply_clock_cap(match, now):
            match.save(update_fields=["clock_elapsed_seconds", "clock_started_at", "clock_state"])
            return Response(_serialize_clock(match))

        # jeśli już działa, zwróć stan
        if match.clock_state == Match.ClockState.RUNNING:
            return Response(_serialize_clock(match))

        # jeśli trwa przerwa (PAUSED + started_at), to "start" traktujemy jako powrót do gry
        if _is_break_active(match):
            match.clock_started_at = None

        # start ustawia RUNNING i inicjuje started_at
        match.clock_state = Match.ClockState.RUNNING
        match.clock_started_at = now

        # jeśli brak sensownego okresu – ustaw domyślny dla dyscypliny
        allowed = _allowed_periods_for_match(match)
        if match.clock_period not in allowed or match.clock_period == Match.ClockPeriod.NONE:
            match.clock_period = _default_period_for_discipline(match)

        match.save(update_fields=["clock_state", "clock_started_at", "clock_period"])

        # opcjonalnie: mecz w trakcie
        if getattr(match, "status", None) == Match.Status.SCHEDULED:
            match.status = Match.Status.IN_PROGRESS
            match.save(update_fields=["status"])

        return Response(_serialize_clock(match))


class MatchClockPauseView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, match_id: int):
        """
        Standard: pauza meczu (zatrzymuje zegar meczu)
        Przerwa techniczna: wywołaj z body np. { "break": true }
        => wtedy startujemy licznik przerwy, blokujemy edycję wyników/incydentów (po stronie API matches/incidents).
        """
        match = get_object_or_404(Match.objects.select_related("tournament"), pk=match_id)
        try:
            _require_can_manage_clock(request.user, match)
        except PermissionError as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)

        now = timezone.now()
        data = request.data or {}
        is_break = bool(
            data.get("break")
            or data.get("technical_break")
            or data.get("is_break")
            or (str(data.get("mode", "")).upper() in ("BREAK", "TECH_BREAK", "TECHNICAL_BREAK"))
        )

        # jeśli już trwa przerwa i ktoś jeszcze raz kliknie przerwę -> zwracamy stan
        if is_break and _is_break_active(match):
            return Response(_serialize_clock(match))

        # jeśli zegar nie biegł:
        # - przy przerwie: możemy rozpocząć przerwę (z punktu widzenia UI)
        # - przy normal pause: tylko zwracamy stan
        if match.clock_state != Match.ClockState.RUNNING:
            if is_break:
                match.clock_state = Match.ClockState.PAUSED
                match.clock_started_at = now  # start przerwy
                match.save(update_fields=["clock_state", "clock_started_at"])
            return Response(_serialize_clock(match))

        # RUNNING -> sumuj odcinek (z capem)
        if match.clock_started_at:
            delta = now - match.clock_started_at
            add = max(0, int(delta.total_seconds()))
            match.clock_elapsed_seconds = int(match.clock_elapsed_seconds or 0) + add
            if int(match.clock_elapsed_seconds or 0) > MAX_CLOCK_SECONDS:
                match.clock_elapsed_seconds = MAX_CLOCK_SECONDS

        match.clock_state = Match.ClockState.PAUSED

        if is_break:
            # przerwa: started_at = początek przerwy
            match.clock_started_at = now
        else:
            # zwykła pauza: started_at = None
            match.clock_started_at = None

        match.save(update_fields=["clock_elapsed_seconds", "clock_started_at", "clock_state"])
        return Response(_serialize_clock(match))


class MatchClockResumeView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, match_id: int):
        """
        Wznów:
        - jeżeli trwa przerwa (PAUSED + started_at) -> kończymy przerwę i przechodzimy do RUNNING
        - w pozostałych przypadkach: standardowe wznawianie
        """
        match = get_object_or_404(Match.objects.select_related("tournament"), pk=match_id)
        try:
            _require_can_manage_clock(request.user, match)
        except PermissionError as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)

        now = timezone.now()

        if _maybe_apply_clock_cap(match, now):
            match.save(update_fields=["clock_elapsed_seconds", "clock_started_at", "clock_state"])
            return Response(_serialize_clock(match))

        if match.clock_state == Match.ClockState.RUNNING:
            return Response(_serialize_clock(match))

        if match.clock_state not in (Match.ClockState.PAUSED, Match.ClockState.NOT_STARTED, Match.ClockState.STOPPED):
            return Response(_serialize_clock(match))

        # jeśli była przerwa, kończymy ją (kasujemy jej start)
        if _is_break_active(match):
            match.clock_started_at = None

        match.clock_state = Match.ClockState.RUNNING
        match.clock_started_at = now
        match.save(update_fields=["clock_state", "clock_started_at"])

        return Response(_serialize_clock(match))


class MatchClockStopView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, match_id: int):
        """
        STOP:
        - zawsze zatrzymuje zegar (STOPPED)
        - opcjonalnie może oznaczyć mecz jako zakończony (body: { "finish": true })
          Domyślnie finish=False, żeby nie rozwalić istniejącej logiki FinishMatchView.
        """
        match = get_object_or_404(Match.objects.select_related("tournament"), pk=match_id)
        try:
            _require_can_manage_clock(request.user, match)
        except PermissionError as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)

        now = timezone.now()
        data = request.data or {}
        finish = bool(data.get("finish") or data.get("end_match") or (str(data.get("mode", "")).upper() == "FINISH"))

        # jeśli RUNNING -> domykamy odcinek (z capem)
        if match.clock_state == Match.ClockState.RUNNING and match.clock_started_at:
            delta = now - match.clock_started_at
            add = max(0, int(delta.total_seconds()))
            match.clock_elapsed_seconds = int(match.clock_elapsed_seconds or 0) + add
            if int(match.clock_elapsed_seconds or 0) > MAX_CLOCK_SECONDS:
                match.clock_elapsed_seconds = MAX_CLOCK_SECONDS

        # jeżeli trwa przerwa (PAUSED + started_at) -> stop po prostu ją kończy i ustawia STOPPED
        match.clock_started_at = None
        match.clock_state = Match.ClockState.STOPPED
        match.save(update_fields=["clock_elapsed_seconds", "clock_started_at", "clock_state"])

        if finish:
            finished_val = _resolve_finished_status_value()
            if finished_val:
                match.status = finished_val
                match.save(update_fields=["status"])

        return Response(_serialize_clock(match))


class MatchClockSetPeriodView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, match_id: int):
        """
        Body: { "period": "FH" | "SH" | ... }
        Uwaga: ustawienie okresu traktujemy jako rozpoczęcie „nowego odcinka czasu”
        => reset clock_elapsed_seconds do 0.

        Jeżeli trwa przerwa (PAUSED + started_at):
        - zmiana periodu domyślnie KOŃCZY przerwę (kasuje started_at),
          a start meczu robisz potem Resume/Start.
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

        # jeśli biegł mecz -> domykamy odcinek (z capem)
        if match.clock_state == Match.ClockState.RUNNING and match.clock_started_at:
            delta = now - match.clock_started_at
            match.clock_elapsed_seconds = int(match.clock_elapsed_seconds or 0) + max(0, int(delta.total_seconds()))
            if int(match.clock_elapsed_seconds or 0) > MAX_CLOCK_SECONDS:
                match.clock_elapsed_seconds = MAX_CLOCK_SECONDS

        # jeśli trwa przerwa -> kasujemy jej start, bo przechodzimy do kolejnego momentu
        if _is_break_active(match):
            match.clock_started_at = None

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

class MatchClockResetPeriodView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, match_id: int):
        """
        Reset etapu (bieżącego okresu lub wskazanego w body):
        - usuwa incydenty z tego etapu (period)
        - koryguje szybki wynik o bramki/punkty z usuwanych incydentów (GOAL)
        - cofa zegar etapu do 0 i zatrzymuje (STOPPED)
        Wymaga potwierdzenia: { "confirm": true, "period": "FH" }.
        """
        match = get_object_or_404(Match.objects.select_related("tournament", "home_team", "away_team"), pk=match_id)
        try:
            _require_can_manage_clock(request.user, match)
        except PermissionError as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)

        confirm = bool(request.data.get("confirm"))
        period = request.data.get("period") or getattr(match, "clock_period", None) or Match.ClockPeriod.NONE

        if not confirm:
            return Response(
                {
                    "detail": "Reset etapu jest operacją destrukcyjną. Wyślij confirm=true, aby kontynuować.",
                    "code": "RESET_PERIOD_CONFIRM_REQUIRED",
                    "period": period,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # defensywnie: import tu, bo plik clock nie zawsze importuje incydenty
        from tournaments.models import MatchIncident

        qs = MatchIncident.objects.filter(match=match, period=period)

        # korekta wyniku o GOAL (basket: meta.points)
        home_delta = 0
        away_delta = 0
        for inc in qs.only("team_id", "kind", "meta"):
            if inc.kind != MatchIncident.Kind.GOAL:
                continue
            pts = 1
            try:
                if isinstance(inc.meta, dict) and inc.meta.get("points"):
                    pts = int(inc.meta.get("points") or 1)
            except Exception:
                pts = 1
            if inc.team_id == match.home_team_id:
                home_delta += pts
            elif inc.team_id == match.away_team_id:
                away_delta += pts

        if home_delta or away_delta:
            try:
                match.home_score = max(0, int(match.home_score or 0) - home_delta)
                match.away_score = max(0, int(match.away_score or 0) - away_delta)
            except Exception:
                pass

        # usuń incydenty etapu
        qs.delete()

        # reset zegara etapu
        match.clock_state = Match.ClockState.STOPPED
        match.clock_started_at = None
        match.clock_elapsed_seconds = 0
        match.clock_added_seconds = 0
        match.save(update_fields=["home_score", "away_score", "clock_state", "clock_started_at", "clock_elapsed_seconds", "clock_added_seconds"])

        return Response(_serialize_clock(match))


