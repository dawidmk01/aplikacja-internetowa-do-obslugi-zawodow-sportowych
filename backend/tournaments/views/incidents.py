# backend/tournaments/views/incidents.py

from __future__ import annotations

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework import status

from tournaments.models import (
    Match,
    MatchIncident,
    TeamPlayer,
    Tournament,
    TournamentMembership,
)

from tournaments.serializers.incidents import MatchIncidentSerializer


def _get_membership_perms(user, tournament: Tournament) -> dict | None:
    if not user or user.is_anonymous:
        return None
    if user.id == tournament.organizer_id:
        return {"__organizer__": True}
    m = TournamentMembership.objects.filter(tournament=tournament, user=user).first()
    if not m:
        return None
    return m.effective_permissions()


def _require_can_manage_incidents(user, match: Match) -> None:
    """
    Incydenty to „live / przebieg meczu”, więc opieramy to o results_edit.
    """
    tournament = match.tournament
    perms = _get_membership_perms(user, tournament)
    if not perms:
        raise PermissionError("Brak uprawnień.")
    if perms.get("__organizer__"):
        return
    if perms.get(TournamentMembership.PERM_RESULTS_EDIT):
        return
    raise PermissionError("Brak uprawnień do rejestrowania incydentów.")


def _kind_display(kind: str, discipline: str) -> str:
    # Celowo nie polegamy na label z choices, bo dla kosza/ręcznej GOAL to „punkt”.
    if discipline == Tournament.Discipline.BASKETBALL:
        mapping = {
            "GOAL": "Punkt",
            "FOUL": "Faul",
            "TIMEOUT": "Timeout",
        }
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
    # Football default
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
        # GOAL = punkt (meta.points = 1/2/3)
        return {"GOAL", "FOUL", "TIMEOUT"}
    if discipline == Tournament.Discipline.TENNIS:
        return {"TENNIS_POINT", "TENNIS_CODE_VIOLATION", "TIMEOUT"}
    # fallback
    return {"GOAL", "FOUL", "TIMEOUT"}


# --- AUTO CLOCK RULES ---

_TIMEOUT_KIND = getattr(MatchIncident.Kind, "TIMEOUT", "TIMEOUT")


def _should_timeout_pause_clock(discipline: str) -> bool:
    # stop-clock sports
    return discipline in (Tournament.Discipline.HANDBALL, Tournament.Discipline.BASKETBALL)


def _pause_clock_if_running(match: Match, *, now) -> None:
    """
    Ta sama logika co MatchClockPauseView – bez duplikacji endpointu.
    """
    if match.clock_state != Match.ClockState.RUNNING:
        return

    if match.clock_started_at:
        delta = now - match.clock_started_at
        match.clock_elapsed_seconds = int(match.clock_elapsed_seconds or 0) + max(0, int(delta.total_seconds()))

    match.clock_started_at = None
    match.clock_state = Match.ClockState.PAUSED
    match.save(update_fields=["clock_elapsed_seconds", "clock_started_at", "clock_state"])


def _serialize_incident(i: MatchIncident) -> dict:
    d = i.match.tournament.discipline
    return {
        "id": i.id,
        "match_id": i.match_id,
        "team_id": i.team_id,
        "kind": i.kind,
        "kind_display": _kind_display(i.kind, d),
        "period": i.period,
        "time_source": i.time_source,
        "minute": i.minute,
        "minute_raw": i.minute_raw,
        "player_id": i.player_id,
        "player_name": i.player.display_name if i.player else None,
        "player_in_id": i.player_in_id,
        "player_in_name": i.player_in.display_name if i.player_in else None,
        "player_out_id": i.player_out_id,
        "player_out_name": i.player_out.display_name if i.player_out else None,
        "meta": i.meta or {},
        "created_by": i.created_by_id,
        "created_at": i.created_at.isoformat() if i.created_at else None,
    }


def _parse_int(v, field: str, allow_none: bool = True) -> int | None:
    if v is None or v == "":
        return None if allow_none else 0
    try:
        return int(v)
    except (TypeError, ValueError):
        raise ValueError(f"{field} musi być liczbą całkowitą.")


def _team_must_be_in_match(match: Match, team_id: int) -> None:
    if team_id not in (match.home_team_id, match.away_team_id):
        raise ValueError("team_id musi być jedną z drużyn tego meczu (home/away).")


def _player_must_belong_to_team(player: TeamPlayer, team_id: int) -> None:
    if player.team_id != team_id:
        raise ValueError("Zawodnik nie należy do wskazanej drużyny.")


def _team_score_value(match: Match, team_id: int) -> int:
    if team_id == match.home_team_id:
        return int(match.home_score or 0)
    if team_id == match.away_team_id:
        return int(match.away_score or 0)
    return 0


def _set_team_score_value(match: Match, team_id: int, value: int) -> None:
    v = max(0, int(value))
    if team_id == match.home_team_id:
        match.home_score = v
    elif team_id == match.away_team_id:
        match.away_score = v


def _goal_points_for_discipline(discipline: str, meta: dict) -> int:
    """
    Punktacja GOAL:
    - football/handball: 1
    - basketball: meta.points = 1/2/3 (domyślnie 1)
    """
    if discipline == Tournament.Discipline.BASKETBALL:
        raw = meta.get("points", 1)
        try:
            pts = int(raw or 1)
        except (TypeError, ValueError):
            pts = 1
        if pts not in (1, 2, 3):
            raise ValueError("Koszykówka: meta.points musi być 1, 2 lub 3.")
        return pts
    return 1


def _sum_goal_points_for_team(match_id: int, team_id: int, discipline: str, exclude_incident_id: int | None = None) -> int:
    qs = MatchIncident.objects.filter(match_id=match_id, kind="GOAL").only("team_id", "meta")
    if exclude_incident_id:
        qs = qs.exclude(id=exclude_incident_id)

    total = 0
    for i in qs:
        if i.team_id != team_id:
            continue
        meta = i.meta if isinstance(i.meta, dict) else {}
        try:
            pts = _goal_points_for_discipline(discipline, meta)
        except ValueError:
            # jeśli ktoś kiedyś wrzucił zły meta.points, traktujemy jako 1,
            # żeby nie blokować działania systemu (twarda walidacja jest na create)
            pts = 1
        total += pts
    return int(total)


class MatchIncidentListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, match_id: int):
        match = get_object_or_404(Match.objects.select_related("tournament"), pk=match_id)
        try:
            _require_can_manage_incidents(request.user, match)
        except PermissionError as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)

        qs = (
            MatchIncident.objects
            .select_related("match__tournament", "player", "player_in", "player_out")
            .filter(match_id=match_id)
            .order_by("created_at", "id")
        )
        return Response([_serialize_incident(x) for x in qs])

    def post(self, request, match_id: int):
        # UWAGA: tu robimy atomic + select_for_update, bo wprowadzamy logikę,
        # która zależy od aktualnego wyniku meczu i sumy incydentów GOAL.
        with transaction.atomic():
            match = get_object_or_404(
                Match.objects.select_related("tournament").select_for_update(),
                pk=match_id,
            )

            try:
                _require_can_manage_incidents(request.user, match)
            except PermissionError as e:
                return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)

            data = request.data or {}
            discipline = match.tournament.discipline

            kind = (data.get("kind") or "").strip()
            if not kind:
                return Response({"detail": "Wymagane pole kind."}, status=status.HTTP_400_BAD_REQUEST)

            allowed_kinds = _allowed_kinds_for_discipline(discipline)
            if kind not in allowed_kinds:
                return Response(
                    {"detail": f"kind '{kind}' nie jest dozwolony dla dyscypliny {discipline}. Dozwolone: {sorted(list(allowed_kinds))}"},
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

                # jeśli CLOCK i brak minuty -> policz z zegara
                if time_source == MatchIncident.TimeSource.CLOCK and minute is None:
                    # jeżeli zegar nie ruszył i nie ma elapsed -> brak możliwości wyliczenia
                    if match.clock_state == Match.ClockState.NOT_STARTED and int(match.clock_elapsed_seconds or 0) == 0:
                        raise ValueError("Zegar meczu nie jest uruchomiony – podaj minute ręcznie albo uruchom zegar.")
                    minute = match.clock_minute_total(now=timezone.now())

                # period: z zegara jeśli dostępny, w przeciwnym razie z payload lub NONE
                period = match.clock_period if match.clock_period else Match.ClockPeriod.NONE
                if "period" in data and data.get("period"):
                    period = str(data.get("period")).strip()

                # zawodnicy (opcjonalnie)
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

                # meta
                meta = data.get("meta")
                if meta is None:
                    meta = {}
                if not isinstance(meta, dict):
                    raise ValueError("meta musi być obiektem JSON.")

                # ułatwienie: dla kosza można wysłać points=2/3 bez ręcznego meta
                if "points" in data:
                    pts = _parse_int(data.get("points"), "points", allow_none=True)
                    if pts is not None:
                        meta = dict(meta)
                        meta["points"] = int(pts)

                # Jeśli GOAL: dopnij logikę auto-synchronizacji wyniku z incydentami
                score_update_fields: list[str] = []
                if kind == "GOAL" and discipline != Tournament.Discipline.TENNIS:
                    # walidacja + punkty
                    meta = dict(meta)
                    pts = _goal_points_for_discipline(discipline, meta)

                    # suma punktów z dotychczasowych GOAL incydentów tej drużyny
                    existing_points = _sum_goal_points_for_team(match.id, team_id, discipline)

                    current_score = _team_score_value(match, team_id)

                    # napraw invariant jeśli ktoś "ręcznie" zbił wynik poniżej incydentów
                    base_score = max(current_score, existing_points)

                    # ile punktów brakuje w incydentach do już wpisanego wyniku
                    gap = max(0, base_score - existing_points)

                    # delta = o ile ten incydent faktycznie podniesie wynik
                    # (w koszu potrafi być częściowe: np. gap=1, pts=2 => delta=1)
                    delta = max(0, pts - gap)

                    meta["_points"] = pts
                    meta["_score_delta"] = int(delta)

                    if base_score != current_score:
                        _set_team_score_value(match, team_id, base_score)
                        if team_id == match.home_team_id:
                            score_update_fields.append("home_score")
                        elif team_id == match.away_team_id:
                            score_update_fields.append("away_score")

                    if delta > 0:
                        _set_team_score_value(match, team_id, base_score + delta)
                        if team_id == match.home_team_id and "home_score" not in score_update_fields:
                            score_update_fields.append("home_score")
                        if team_id == match.away_team_id and "away_score" not in score_update_fields:
                            score_update_fields.append("away_score")

                    if score_update_fields:
                        match.save(update_fields=score_update_fields)

            except (ValueError, AssertionError) as e:
                return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)

            incident = MatchIncident.objects.create(
                match=match,
                team_id=team_id,
                kind=kind,
                period=period or Match.ClockPeriod.NONE,
                time_source=time_source,
                minute=minute,
                minute_raw=minute_raw,
                player=player,
                player_in=player_in,
                player_out=player_out,
                meta=meta,
                created_by=request.user,
            )

            # AUTO-PAUSE zegara po TIMEOUT w sportach stop-clock (handball/basketball)
            if kind == _TIMEOUT_KIND and _should_timeout_pause_clock(discipline):
                _pause_clock_if_running(match, now=timezone.now())

            incident = (
                MatchIncident.objects
                .select_related("match__tournament", "player", "player_in", "player_out")
                .get(pk=incident.id)
            )
            return Response(_serialize_incident(incident), status=status.HTTP_201_CREATED)


class MatchIncidentDeleteView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, incident_id: int):
        """Aktualizacja istniejącego incydentu (minuta / zawodnik / meta.note).

        Cel: umożliwić korektę danych LIVE bez usuwania i ponownego dodawania.
        Nie zmieniamy: match_id, team_id, kind (typ).
        """
        with transaction.atomic():
            incident = get_object_or_404(
                MatchIncident.objects.select_related("match__tournament").select_for_update(),
                pk=incident_id,
            )
            match = Match.objects.select_related("tournament").select_for_update().get(pk=incident.match_id)

            try:
                _require_can_manage_incidents(request.user, match)
            except PermissionError as e:
                return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)

            data = request.data or {}

            # minuta / zapis surowy
            if "minute" in data:
                v = data.get("minute")
                if v in (None, "", "null"):
                    incident.minute = None
                else:
                    try:
                        incident.minute = int(v)
                    except (TypeError, ValueError):
                        return Response({"detail": "Nieprawidłowa minuta."}, status=status.HTTP_400_BAD_REQUEST)

            if "minute_raw" in data:
                v = data.get("minute_raw")
                incident.minute_raw = (str(v).strip() if v not in (None, "") else None)

            # player single
            if "player_id" in data:
                pid = data.get("player_id")
                if pid in (None, "", "null"):
                    incident.player_id = None
                else:
                    try:
                        pid_int = int(pid)
                    except (TypeError, ValueError):
                        return Response({"detail": "Nieprawidłowy zawodnik."}, status=status.HTTP_400_BAD_REQUEST)
                    player = TeamPlayer.objects.filter(pk=pid_int).select_related("team").first()
                    if not player:
                        return Response({"detail": "Nie znaleziono zawodnika."}, status=status.HTTP_400_BAD_REQUEST)
                    if player.team_id != incident.team_id:
                        return Response({"detail": "Zawodnik nie należy do tej drużyny."}, status=status.HTTP_400_BAD_REQUEST)
                    incident.player_id = pid_int

            # substitution players
            if "player_out_id" in data:
                v = data.get("player_out_id")
                if v in (None, "", "null"):
                    incident.player_out_id = None
                else:
                    try:
                        pid_int = int(v)
                    except (TypeError, ValueError):
                        return Response({"detail": "Nieprawidłowy zawodnik schodzący."}, status=status.HTTP_400_BAD_REQUEST)
                    player = TeamPlayer.objects.filter(pk=pid_int).select_related("team").first()
                    if not player:
                        return Response({"detail": "Nie znaleziono zawodnika schodzącego."}, status=status.HTTP_400_BAD_REQUEST)
                    if player.team_id != incident.team_id:
                        return Response({"detail": "Zawodnik schodzący nie należy do tej drużyny."}, status=status.HTTP_400_BAD_REQUEST)
                    incident.player_out_id = pid_int

            if "player_in_id" in data:
                v = data.get("player_in_id")
                if v in (None, "", "null"):
                    incident.player_in_id = None
                else:
                    try:
                        pid_int = int(v)
                    except (TypeError, ValueError):
                        return Response({"detail": "Nieprawidłowy zawodnik wchodzący."}, status=status.HTTP_400_BAD_REQUEST)
                    player = TeamPlayer.objects.filter(pk=pid_int).select_related("team").first()
                    if not player:
                        return Response({"detail": "Nie znaleziono zawodnika wchodzącego."}, status=status.HTTP_400_BAD_REQUEST)
                    if player.team_id != incident.team_id:
                        return Response({"detail": "Zawodnik wchodzący nie należy do tej drużyny."}, status=status.HTTP_400_BAD_REQUEST)
                    incident.player_in_id = pid_int

            # meta.note
            if "note" in data:
                note = data.get("note")
                meta = incident.meta if isinstance(incident.meta, dict) else {}
                if note in (None, "", "null"):
                    meta.pop("note", None)
                else:
                    meta["note"] = str(note)
                incident.meta = meta

            # Walidacja constraintów SUBSTITUTION
            if incident.kind == MatchIncident.Kind.SUBSTITUTION:
                if not incident.player_in_id or not incident.player_out_id:
                    return Response({"detail": "Zmiana wymaga zawodnika schodzącego i wchodzącego."}, status=status.HTTP_400_BAD_REQUEST)
            else:
                # incydenty inne niż zmiana nie powinny mieć player_in/out
                incident.player_in_id = None
                incident.player_out_id = None

            incident.save()

            ser = MatchIncidentSerializer(incident)
            return Response(ser.data, status=status.HTTP_200_OK)

    def delete(self, request, incident_id: int):
        with transaction.atomic():
            incident = get_object_or_404(
                MatchIncident.objects.select_related("match__tournament").select_for_update(),
                pk=incident_id
            )

            # zablokuj również Match, bo będziemy zmieniać wynik
            match = Match.objects.select_related("tournament").select_for_update().get(pk=incident.match_id)

            try:
                _require_can_manage_incidents(request.user, match)
            except PermissionError as e:
                return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)

            discipline = match.tournament.discipline

            # jeśli usuwamy GOAL (poza tenisem) -> cofnij wpływ na wynik,
            # ale nigdy nie zejdź poniżej sumy pozostałych incydentów GOAL.
            if incident.kind == "GOAL" and discipline != Tournament.Discipline.TENNIS:
                meta = incident.meta if isinstance(incident.meta, dict) else {}

                try:
                    pts = _goal_points_for_discipline(discipline, meta)
                except ValueError:
                    pts = 1

                                # W nowym modelu (szybki wynik jako prawda) GOAL zawsze wpływa na wynik.
                # Nie opieramy się na _score_delta (historyczny mechanizm „doganiania”).
                delta = pts

                team_id = incident.team_id
                current_score = _team_score_value(match, team_id)

                remaining_points = _sum_goal_points_for_team(
                    match.id,
                    team_id,
                    discipline,
                    exclude_incident_id=incident.id,
                )

                new_score = max(0, int(current_score) - int(delta))
                # wynik nie może spaść poniżej sumy pozostałych incydentów
                new_score = max(new_score, int(remaining_points))

                update_fields: list[str] = []
                if new_score != current_score:
                    _set_team_score_value(match, team_id, new_score)
                    if team_id == match.home_team_id:
                        update_fields.append("home_score")
                    elif team_id == match.away_team_id:
                        update_fields.append("away_score")
                    if update_fields:
                        match.save(update_fields=update_fields)

            incident.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)


class MatchIncidentRecomputeScoreView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, match_id: int):
        with transaction.atomic():
            match = get_object_or_404(Match.objects.select_related("tournament").select_for_update(), pk=match_id)

            try:
                _require_can_manage_incidents(request.user, match)
            except PermissionError as e:
                return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)

            d = match.tournament.discipline

            # tenis: na tym etapie nie przeliczamy home_score/away_score z punktów (bo to sety/gemy),
            # punkty trzymamy jako timeline; scoring tennis dopniemy osobno.
            if d == Tournament.Discipline.TENNIS:
                return Response(
                    {
                        "detail": "Tenis: punkty są przechowywane jako incydenty. Recompute wyniku (sety/gemy) dopniemy osobno.",
                    },
                    status=status.HTTP_200_OK,
                )

            # Suma punktów z incydentów GOAL (w koszu uwzględnia meta.points)
            home_points = _sum_goal_points_for_team(match.id, match.home_team_id, d) if match.home_team_id else 0
            away_points = _sum_goal_points_for_team(match.id, match.away_team_id, d) if match.away_team_id else 0

            # Nowa semantyka: recompute NIE obniża wyniku.
            # Podnosi wynik tylko do minimum wymaganego przez incydenty (naprawa spójności).
            current_home = int(match.home_score or 0)
            current_away = int(match.away_score or 0)

            new_home = max(current_home, int(home_points))
            new_away = max(current_away, int(away_points))

            update_fields: list[str] = []
            if new_home != current_home:
                match.home_score = new_home
                update_fields.append("home_score")
            if new_away != current_away:
                match.away_score = new_away
                update_fields.append("away_score")

            if update_fields:
                match.save(update_fields=update_fields)

            return Response(
                {
                    "match_id": match.id,
                    "home_score": int(match.home_score or 0),
                    "away_score": int(match.away_score or 0),
                    "incidents_min_home": int(home_points),
                    "incidents_min_away": int(away_points),
                },
                status=status.HTTP_200_OK,
            )
