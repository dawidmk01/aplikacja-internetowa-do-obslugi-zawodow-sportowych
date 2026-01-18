# backend/tournaments/views/teams.py
from __future__ import annotations

from typing import Any, Optional

from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone

from rest_framework import status
from rest_framework.generics import ListAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from ..models import (
    Match,
    Stage,
    Team,
    TeamPlayer,
    Tournament,
    TournamentRegistration,
    TeamNameChangeRequest,
)
from ..serializers import TeamSerializer, TeamUpdateSerializer, TournamentSerializer
from ..services.match_generation import ensure_matches_generated

# NOWA STRATEGIA: podgląd != edycja + brak fallbacków uprawnień
from ._helpers import (
    user_can_view_tournament,
    can_edit_teams,
    can_edit_roster,
    can_approve_name_changes,
    get_membership,
)

BYE_TEAM_NAME = "__SYSTEM_BYE__"


def _norm_name(s: str) -> str:
    return " ".join((s or "").strip().split())


def _tournament_real_started(tournament: Tournament) -> bool:
    """
    Turniej uznajemy za rozpoczęty tylko jeśli istnieje REALNY mecz (nie BYE),
    który jest IN_PROGRESS albo FINISHED.
    """
    return (
        Match.objects.filter(tournament=tournament)
        .exclude(Q(home_team__name__iexact=BYE_TEAM_NAME) | Q(away_team__name__iexact=BYE_TEAM_NAME))
        .filter(status__in=(Match.Status.IN_PROGRESS, Match.Status.FINISHED))
        .exists()
    )


def _user_is_participant(user, tournament: Tournament) -> bool:
    if not user or not user.is_authenticated:
        return False
    return TournamentRegistration.objects.filter(tournament=tournament, user=user).exists()


def _user_owns_team_slot(user, tournament: Tournament, team: Team) -> bool:
    """
    Uczestnik "jest właścicielem" slotu, jeśli:
    - ma TournamentRegistration.team == team
      albo
    - team.registered_user == user (legacy, jeśli wciąż używane)
    """
    if not user or not user.is_authenticated:
        return False

    if team.registered_user_id == user.id:
        return True

    return TournamentRegistration.objects.filter(
        tournament=tournament,
        user=user,
        team=team,
    ).exists()


def _resolve_participant_team(
    *,
    tournament: Tournament,
    user,
    payload_team_id: Optional[int],
) -> Team:
    """
    Rozwiązuje Team dla uczestnika:
    - jeśli payload ma team_id -> walidujemy ownership
    - w przeciwnym razie: bierzemy TournamentRegistration.team
    - fallback: Team.registered_user (legacy)
    """
    if payload_team_id:
        team = get_object_or_404(Team, pk=payload_team_id, tournament=tournament, is_active=True)
        if team.name == BYE_TEAM_NAME:
            raise ValueError("Nie można zmieniać nazwy BYE.")
        if not _user_owns_team_slot(user, tournament, team):
            raise PermissionError("To nie jest Twój slot uczestnika.")
        return team

    reg = (
        TournamentRegistration.objects.filter(tournament=tournament, user=user)
        .select_related("team")
        .first()
    )
    if reg and reg.team_id:
        team = get_object_or_404(Team, pk=reg.team_id, tournament=tournament, is_active=True)
        if team.name == BYE_TEAM_NAME:
            raise ValueError("Nie można zmieniać nazwy BYE.")
        return team

    team = (
        Team.objects.filter(tournament=tournament, registered_user=user, is_active=True)
        .exclude(name=BYE_TEAM_NAME)
        .order_by("id")
        .first()
    )
    if team:
        return team

    raise LookupError("Brak przypisanego uczestnika (team).")


def _roster_feature_enabled(tournament: Tournament) -> bool:
    """
    Składy mają sens tylko dla turniejów drużynowych.
    """
    return tournament.competition_type == Tournament.CompetitionType.TEAM


def _allow_team_owner_roster_edit(tournament: Tournament) -> bool:
    """
    Toggle w format_config:
      allow_team_owner_roster_edit: true/false

    Domyślnie: False (bezpieczniej).
    """
    cfg = tournament.format_config or {}
    return bool(cfg.get("allow_team_owner_roster_edit", False))


def _roster_max_players(tournament: Tournament) -> Optional[int]:
    """
    Opcjonalny limit w format_config:
      roster_max_players: number
    """
    cfg = tournament.format_config or {}
    raw = cfg.get("roster_max_players")
    if raw is None:
        return None
    try:
        v = int(raw)
    except (TypeError, ValueError):
        return None
    return v if v > 0 else None


def _can_view_team_roster(user, tournament: Tournament, team: Team) -> bool:
    """
    Podgląd składu:
    - organizer/asystent z roster_edit -> tak
    - właściciel drużyny (slot) -> tak (swoją drużynę)
    Inni: nie (bezpieczne domyślnie).
    """
    if can_edit_roster(user, tournament):
        return True
    return _user_owns_team_slot(user, tournament, team)


def _can_edit_team_roster(user, tournament: Tournament, team: Team) -> bool:
    """
    Edycja składu:
    - organizer/asystent: tylko jeśli ma roster_edit (can_edit_roster)
    - właściciel drużyny: tylko jeśli allow_team_owner_roster_edit == True i jest ownerem
    """
    if can_edit_roster(user, tournament):
        return True

    if _allow_team_owner_roster_edit(tournament) and _user_owns_team_slot(user, tournament, team):
        return True

    return False


def _serialize_player(p: TeamPlayer) -> dict[str, Any]:
    return {
        "id": p.id,
        "team_id": p.team_id,
        "display_name": p.display_name,
        "jersey_number": p.jersey_number,
        "is_active": p.is_active,
        "created_at": p.created_at,
        "updated_at": p.updated_at,
    }


# ============================================================
# TEAMS: LIST / UPDATE / SETUP
# ============================================================

class TournamentTeamListView(ListAPIView):
    serializer_class = TeamSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        tournament = get_object_or_404(Tournament, pk=self.kwargs["pk"])

        # PODGLĄD: organizer/asystent/uczestnik z rejestracją -> widzi
        if not user_can_view_tournament(self.request.user, tournament):
            return Team.objects.none()

        return (
            tournament.teams.filter(is_active=True)
            .exclude(name=BYE_TEAM_NAME)
            .order_by("id")
        )


class TournamentTeamUpdateView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk, team_id):
        tournament = get_object_or_404(Tournament, pk=pk)

        # PATCH = edycja nazw drużyn -> teams_edit (to nie jest roster)
        if not can_edit_teams(request.user, tournament):
            return Response(
                {"detail": "Nie masz uprawnień do edycji drużyn/uczestników. Dostępny jest tylko podgląd."},
                status=status.HTTP_403_FORBIDDEN,
            )

        team = get_object_or_404(
            Team,
            pk=team_id,
            tournament=tournament,
            is_active=True,
        )

        if team.name == BYE_TEAM_NAME:
            return Response(
                {"detail": "Nie można edytować zespołu technicznego BYE."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = TeamUpdateSerializer(team, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()

        return Response(TeamSerializer(team).data, status=status.HTTP_200_OK)


class TournamentTeamSetupView(APIView):
    """
    POST /api/tournaments/<id>/teams/setup/

    - Ustawia liczbę aktywnych Team (bez aktywowania __SYSTEM_BYE__).
    - Jeżeli liczba aktywnych Team się zmienia -> reset Stage/Match + regeneracja.

    Uprawnienia:
    - Organizer: może zawsze (z ostrzeżeniem, jeśli po starcie).
    - Asystent: tylko jeśli ma teams_edit i tylko w trybie MANAGER.
    """
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, pk):
        tournament = get_object_or_404(Tournament, pk=pk)

        if not can_edit_teams(request.user, tournament):
            return Response(
                {"detail": "Nie masz uprawnień do edycji drużyn/uczestników. Dostępny jest tylko podgląd."},
                status=status.HTTP_403_FORBIDDEN,
            )

        is_organizer = tournament.organizer_id == request.user.id
        is_assistant = get_membership(request.user, tournament) is not None

        if tournament.status == Tournament.Status.FINISHED:
            return Response(
                {"detail": "Nie można zmieniać liczby uczestników w zakończonym turnieju."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        real_started = _tournament_real_started(tournament)

        # Po REALNYM starcie blokujemy tylko asystenta (organizer może, ale to resetuje).
        if is_assistant and real_started:
            return Response(
                {"detail": "Turniej już się rozpoczął — asystent nie może zmieniać liczby uczestników."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        raw_count = request.data.get("teams_count", None)
        if raw_count is None:
            raw_count = request.data.get("participants_count", None)

        try:
            requested_count = int(raw_count)
        except (TypeError, ValueError):
            return Response({"detail": "Nieprawidłowa liczba uczestników."}, status=status.HTTP_400_BAD_REQUEST)

        if requested_count < 2:
            return Response({"detail": "Liczba uczestników musi wynosić co najmniej 2."}, status=status.HTTP_400_BAD_REQUEST)

        # BYE zawsze nieaktywny
        Team.objects.filter(tournament=tournament, name=BYE_TEAM_NAME).update(is_active=False)

        active_before = (
            Team.objects.filter(tournament=tournament, is_active=True)
            .exclude(name=BYE_TEAM_NAME)
            .count()
        )
        had_structure = Stage.objects.filter(tournament=tournament).exists()

        all_real_teams = list(tournament.teams.exclude(name=BYE_TEAM_NAME).order_by("id"))
        existing_total = len(all_real_teams)

        name_prefix = (
            "Zawodnik"
            if tournament.competition_type == Tournament.CompetitionType.INDIVIDUAL
            else "Drużyna"
        )

        if existing_total < requested_count:
            Team.objects.bulk_create(
                [
                    Team(tournament=tournament, name=f"{name_prefix} {i}", is_active=True)
                    for i in range(existing_total + 1, requested_count + 1)
                ]
            )
            all_real_teams = list(tournament.teams.exclude(name=BYE_TEAM_NAME).order_by("id"))

        changed = []
        for idx, team in enumerate(all_real_teams):
            should_be_active = idx < requested_count
            if team.is_active != should_be_active:
                team.is_active = should_be_active
                changed.append(team)

        if changed:
            Team.objects.bulk_update(changed, ["is_active"])

        active_after = (
            Team.objects.filter(tournament=tournament, is_active=True)
            .exclude(name=BYE_TEAM_NAME)
            .count()
        )

        count_changed = active_after != active_before
        should_upgrade = (active_after >= 2) and (count_changed or not had_structure)

        reset_done = False
        if should_upgrade and tournament.status != Tournament.Status.DRAFT:
            tournament.status = Tournament.Status.DRAFT
            tournament.save(update_fields=["status"])
            reset_done = True

        if should_upgrade:
            ensure_matches_generated(tournament)
            if tournament.status == Tournament.Status.DRAFT:
                tournament.status = Tournament.Status.CONFIGURED
                tournament.save(update_fields=["status"])

        detail = "Uczestnicy zostali zaktualizowani."
        if reset_done:
            detail += " Rozgrywki zostały przebudowane (reset etapów i meczów)."
        elif should_upgrade:
            detail += " Rozgrywki zostały wygenerowane."
        else:
            detail += " (Bez przebudowy rozgrywek.)"

        if is_organizer and real_started and should_upgrade:
            detail += (
                " UWAGA: turniej był już rozpoczęty — zmiana liczby uczestników usuwa istniejące mecze, wyniki i harmonogram."
            )

        active_teams = (
            tournament.teams.filter(is_active=True)
            .exclude(name=BYE_TEAM_NAME)
            .order_by("id")
        )

        return Response(
            {
                "detail": detail,
                "reset_done": reset_done,
                "tournament": TournamentSerializer(tournament, context={"request": request}).data,
                "teams": TeamSerializer(active_teams, many=True).data,
                "teams_count": active_after,
                "upgraded": should_upgrade,
            },
            status=status.HTTP_200_OK,
        )


# ============================================================
# TEAM ROSTER (PLAYERS): LIST / BULK REPLACE
# ============================================================

class TournamentTeamPlayersView(APIView):
    """
    GET  /api/tournaments/<pk>/teams/<team_id>/players/
    PUT  /api/tournaments/<pk>/teams/<team_id>/players/

    PUT działa jako "bulk replace":
    - lista przekazana przez klienta staje się aktualnym aktywnym składem,
    - istniejący zawodnicy nieobecni w payload -> is_active=False (historia zostaje),
    - id w payload aktualizuje istniejący rekord (o ile należy do tej drużyny),
    - bez id -> tworzy nowego zawodnika.

    Uprawnienia (bez fallbacków):
    - organizer/asystent: wymaga roster_edit (can_edit_roster)
    - właściciel drużyny: tylko jeśli allow_team_owner_roster_edit = True
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, pk: int, team_id: int):
        tournament = get_object_or_404(Tournament, pk=pk)

        if not user_can_view_tournament(request.user, tournament):
            return Response({"detail": "Brak dostępu do turnieju."}, status=status.HTTP_403_FORBIDDEN)

        if not _roster_feature_enabled(tournament):
            return Response({"detail": "Składy są dostępne tylko dla turniejów drużynowych."}, status=status.HTTP_400_BAD_REQUEST)

        team = get_object_or_404(Team, pk=team_id, tournament=tournament, is_active=True)
        if team.name == BYE_TEAM_NAME:
            return Response({"detail": "BYE nie posiada składu."}, status=status.HTTP_400_BAD_REQUEST)

        if not _can_view_team_roster(request.user, tournament, team):
            return Response({"detail": "Brak uprawnień do podglądu składu tej drużyny."}, status=status.HTTP_403_FORBIDDEN)

        players = TeamPlayer.objects.filter(team=team, is_active=True).order_by("id")
        return Response(
            {
                "team_id": team.id,
                "count": players.count(),
                "results": [_serialize_player(p) for p in players],
            },
            status=status.HTTP_200_OK,
        )

    @transaction.atomic
    def put(self, request, pk: int, team_id: int):
        tournament = get_object_or_404(Tournament, pk=pk)

        if not _roster_feature_enabled(tournament):
            return Response({"detail": "Składy są dostępne tylko dla turniejów drużynowych."}, status=status.HTTP_400_BAD_REQUEST)

        team = get_object_or_404(Team, pk=team_id, tournament=tournament, is_active=True)
        if team.name == BYE_TEAM_NAME:
            return Response({"detail": "BYE nie posiada składu."}, status=status.HTTP_400_BAD_REQUEST)

        if not _can_edit_team_roster(request.user, tournament, team):
            return Response({"detail": "Brak uprawnień do edycji składu tej drużyny."}, status=status.HTTP_403_FORBIDDEN)

        payload = request.data
        if isinstance(payload, dict) and "players" in payload:
            payload = payload.get("players")

        if payload is None:
            payload = []

        if not isinstance(payload, list):
            return Response(
                {"detail": "Nieprawidłowy format danych. Oczekiwano listy zawodników lub pola 'players'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        max_players = _roster_max_players(tournament)
        if max_players is not None and len(payload) > max_players:
            return Response(
                {"detail": f"Przekroczono limit zawodników w składzie: {max_players}."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Walidacja duplikatów numerów koszulki (tylko dla wartości nie-None)
        jersey_numbers: list[int] = []
        for item in payload:
            if not isinstance(item, dict):
                return Response({"detail": "Każdy element listy zawodników musi być obiektem JSON."}, status=status.HTTP_400_BAD_REQUEST)
            raw_j = item.get("jersey_number")
            if raw_j is None or raw_j == "":
                continue
            try:
                j = int(raw_j)
            except (TypeError, ValueError):
                return Response({"detail": "Nieprawidłowy 'jersey_number' — oczekiwano liczby."}, status=status.HTTP_400_BAD_REQUEST)
            if j <= 0:
                return Response({"detail": "Numer koszulki musi być dodatni."}, status=status.HTTP_400_BAD_REQUEST)
            jersey_numbers.append(j)

        if len(set(jersey_numbers)) != len(jersey_numbers):
            return Response(
                {"detail": "W składzie nie można mieć dwóch aktywnych zawodników z tym samym numerem koszulki."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        existing_active = list(TeamPlayer.objects.filter(team=team, is_active=True).order_by("id"))
        existing_by_id = {p.id: p for p in existing_active}

        to_update: list[TeamPlayer] = []
        to_create: list[TeamPlayer] = []
        seen_ids: set[int] = set()

        now_ts = timezone.now()

        for idx, item in enumerate(payload, start=1):
            raw_name = item.get("display_name") or item.get("name") or ""
            display_name = _norm_name(str(raw_name))
            if not display_name:
                # ignorujemy puste wiersze
                continue

            raw_id = item.get("id")
            player_id: Optional[int] = None
            if raw_id not in (None, ""):
                try:
                    player_id = int(raw_id)
                except (TypeError, ValueError):
                    return Response({"detail": f"Nieprawidłowe 'id' zawodnika (pozycja {idx})."}, status=status.HTTP_400_BAD_REQUEST)

            raw_j = item.get("jersey_number")
            jersey_number: Optional[int] = None
            if raw_j not in (None, ""):
                try:
                    jersey_number = int(raw_j)
                except (TypeError, ValueError):
                    return Response({"detail": f"Nieprawidłowy 'jersey_number' (pozycja {idx})."}, status=status.HTTP_400_BAD_REQUEST)
                if jersey_number <= 0:
                    return Response({"detail": f"Numer koszulki musi być dodatni (pozycja {idx})."}, status=status.HTTP_400_BAD_REQUEST)

            if player_id and player_id in existing_by_id:
                p = existing_by_id[player_id]
                p.display_name = display_name
                p.jersey_number = jersey_number
                p.is_active = True
                p.updated_at = now_ts
                to_update.append(p)
                seen_ids.add(p.id)
            elif player_id:
                # próba edycji rekordu spoza tej drużyny -> blokujemy
                belongs = TeamPlayer.objects.filter(id=player_id, team=team).exists()
                if belongs:
                    # rekord jest w tej drużynie, ale był nieaktywny -> reaktywacja
                    p = TeamPlayer.objects.get(id=player_id, team=team)
                    p.display_name = display_name
                    p.jersey_number = jersey_number
                    p.is_active = True
                    p.updated_at = now_ts
                    to_update.append(p)
                    seen_ids.add(p.id)
                else:
                    return Response({"detail": f"Zawodnik id={player_id} nie należy do tej drużyny."}, status=status.HTTP_400_BAD_REQUEST)
            else:
                to_create.append(
                    TeamPlayer(
                        team=team,
                        display_name=display_name,
                        jersey_number=jersey_number,
                        is_active=True,
                        created_by=request.user,
                    )
                )

        # Dezaktywuj tych, których nie ma w payload (zachowujemy historię)
        to_deactivate = [p for p in existing_active if p.id not in seen_ids]
        for p in to_deactivate:
            p.is_active = False
            p.updated_at = now_ts

        if to_update:
            TeamPlayer.objects.bulk_update(to_update, ["display_name", "jersey_number", "is_active", "updated_at"])
        if to_deactivate:
            TeamPlayer.objects.bulk_update(to_deactivate, ["is_active", "updated_at"])
        if to_create:
            TeamPlayer.objects.bulk_create(to_create)

        players = TeamPlayer.objects.filter(team=team, is_active=True).order_by("id")
        return Response(
            {
                "detail": "Skład został zapisany.",
                "team_id": team.id,
                "count": players.count(),
                "results": [_serialize_player(p) for p in players],
            },
            status=status.HTTP_200_OK,
        )


class TournamentMyTeamPlayersView(APIView):
    """
    GET/PUT /api/tournaments/<pk>/my-team/players/

    Skrót dla właściciela drużyny (uczestnika). Serwer rozwiązuje team z TournamentRegistration/legacy.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, pk: int):
        tournament = get_object_or_404(Tournament, pk=pk)

        if not user_can_view_tournament(request.user, tournament):
            return Response({"detail": "Brak dostępu do turnieju."}, status=status.HTTP_403_FORBIDDEN)

        if not _roster_feature_enabled(tournament):
            return Response({"detail": "Składy są dostępne tylko dla turniejów drużynowych."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            team = _resolve_participant_team(tournament=tournament, user=request.user, payload_team_id=None)
        except Exception:
            return Response({"detail": "Brak przypisanej drużyny."}, status=status.HTTP_400_BAD_REQUEST)

        if team.name == BYE_TEAM_NAME:
            return Response({"detail": "BYE nie posiada składu."}, status=status.HTTP_400_BAD_REQUEST)

        # właściciel może podejrzeć swój skład zawsze (edytowalność osobno)
        if not _user_owns_team_slot(request.user, tournament, team):
            return Response({"detail": "Brak uprawnień do podglądu składu."}, status=status.HTTP_403_FORBIDDEN)

        players = TeamPlayer.objects.filter(team=team, is_active=True).order_by("id")
        return Response(
            {"team_id": team.id, "count": players.count(), "results": [_serialize_player(p) for p in players]},
            status=status.HTTP_200_OK,
        )

    @transaction.atomic
    def put(self, request, pk: int):
        tournament = get_object_or_404(Tournament, pk=pk)

        if not _roster_feature_enabled(tournament):
            return Response({"detail": "Składy są dostępne tylko dla turniejów drużynowych."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            team = _resolve_participant_team(tournament=tournament, user=request.user, payload_team_id=None)
        except PermissionError as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)
        except Exception:
            return Response({"detail": "Brak przypisanej drużyny."}, status=status.HTTP_400_BAD_REQUEST)

        if team.name == BYE_TEAM_NAME:
            return Response({"detail": "BYE nie posiada składu."}, status=status.HTTP_400_BAD_REQUEST)

        if not _allow_team_owner_roster_edit(tournament):
            return Response({"detail": "Edycja składu przez właściciela drużyny jest wyłączona."}, status=status.HTTP_403_FORBIDDEN)

        if not _user_owns_team_slot(request.user, tournament, team):
            return Response({"detail": "Brak uprawnień do edycji składu."}, status=status.HTTP_403_FORBIDDEN)

        # Reużyj tej samej logiki co /teams/<team_id>/players/
        view = TournamentTeamPlayersView()
        return view.put(request, pk=pk, team_id=team.id)


# ============================================================
# NAME CHANGE REQUESTS: QUEUE (PENDING) + PARTICIPANT CREATE/READ
# ============================================================

class TournamentTeamNameChangeRequestListView(APIView):
    """
    GET /api/tournaments/<pk>/teams/name-change-requests/

    - organizer/asystent (name_change_approve): kolejka (domyślnie PENDING, ale można filtrować status/team_id)
    - uczestnik: tylko swoje prośby (requested_by=user)

    POST /api/tournaments/<pk>/teams/name-change-requests/
    - uczestnik tworzy prośbę
    Body: { requested_name: "...", team_id?: number }
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, pk: int):
        tournament = get_object_or_404(Tournament, pk=pk)

        status_q = _norm_name(str(request.query_params.get("status") or "")).upper() or None
        team_id_q = request.query_params.get("team_id")
        try:
            team_id_int = int(team_id_q) if team_id_q else None
        except (TypeError, ValueError):
            team_id_int = None

        # organizer/asystent: kolejka (bez fallbacków) -> name_change_approve
        if can_approve_name_changes(request.user, tournament):
            qs = (
                TeamNameChangeRequest.objects.filter(tournament=tournament)
                .select_related("team", "requested_by")
                .order_by("-created_at")
            )

            if status_q:
                qs = qs.filter(status=status_q)
            else:
                qs = qs.filter(status=TeamNameChangeRequest.Status.PENDING)

            if team_id_int:
                qs = qs.filter(team_id=team_id_int)

            items: list[dict[str, Any]] = [
                {
                    "id": r.id,
                    "team_id": r.team_id,
                    "old_name": r.old_name,
                    "requested_name": r.requested_name,
                    "requested_by_id": r.requested_by_id,
                    "created_at": r.created_at,
                    "status": r.status,
                }
                for r in qs
            ]
            return Response({"count": len(items), "results": items}, status=status.HTTP_200_OK)

        # uczestnik: tylko własne prośby
        if not _user_is_participant(request.user, tournament):
            return Response({"detail": "Brak uprawnień."}, status=status.HTTP_403_FORBIDDEN)

        qs = (
            TeamNameChangeRequest.objects.filter(
                tournament=tournament,
                requested_by=request.user,
            )
            .select_related("team")
            .order_by("-created_at")
        )

        if status_q:
            qs = qs.filter(status=status_q)

        if team_id_int:
            # bezpieczeństwo: team_id musi należeć do usera
            try:
                team = _resolve_participant_team(
                    tournament=tournament,
                    user=request.user,
                    payload_team_id=team_id_int,
                )
            except Exception:
                return Response({"count": 0, "results": []}, status=status.HTTP_200_OK)
            qs = qs.filter(team_id=team.id)

        items: list[dict[str, Any]] = [
            {
                "id": r.id,
                "team_id": r.team_id,
                "old_name": r.old_name,
                "requested_name": r.requested_name,
                "created_at": r.created_at,
                "status": r.status,
            }
            for r in qs
        ]
        return Response({"count": len(items), "results": items}, status=status.HTTP_200_OK)

    @transaction.atomic
    def post(self, request, pk: int):
        tournament = get_object_or_404(Tournament, pk=pk)

        # musi móc widzieć turniej
        if not user_can_view_tournament(request.user, tournament):
            return Response({"detail": "Brak dostępu do turnieju."}, status=status.HTTP_403_FORBIDDEN)

        # tylko uczestnik
        if not _user_is_participant(request.user, tournament):
            return Response(
                {"detail": "Tylko zarejestrowany uczestnik może złożyć prośbę."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # jeżeli samodzielna zmiana nazw jest włączona -> request nie ma sensu
        if getattr(tournament, "participants_self_rename_enabled", True):
            return Response(
                {"detail": "Samodzielna zmiana nazwy jest włączona — nie trzeba wysyłać prośby."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        requested_name = _norm_name(str(request.data.get("requested_name") or request.data.get("name") or ""))
        if len(requested_name) < 2:
            return Response({"detail": "Nazwa jest zbyt krótka."}, status=status.HTTP_400_BAD_REQUEST)

        payload_team_id = request.data.get("team_id")
        try:
            payload_team_id_int = int(payload_team_id) if payload_team_id is not None else None
        except (TypeError, ValueError):
            payload_team_id_int = None

        try:
            team = _resolve_participant_team(
                tournament=tournament,
                user=request.user,
                payload_team_id=payload_team_id_int,
            )
        except PermissionError as e:
            return Response({"detail": str(e)}, status=status.HTTP_403_FORBIDDEN)
        except LookupError:
            return Response({"detail": "Brak przypisanego uczestnika (team)."}, status=status.HTTP_400_BAD_REQUEST)
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        # jedna pending na team
        if TeamNameChangeRequest.objects.filter(team=team, status=TeamNameChangeRequest.Status.PENDING).exists():
            return Response(
                {"detail": "Istnieje już oczekująca prośba dla tego uczestnika."},
                status=status.HTTP_409_CONFLICT,
            )

        req = TeamNameChangeRequest.objects.create(
            tournament=tournament,
            team=team,
            requested_by=request.user,
            old_name=team.name,
            requested_name=requested_name,
            status=TeamNameChangeRequest.Status.PENDING,
        )

        return Response(
            {
                "detail": "Prośba została złożona.",
                "request": {
                    "id": req.id,
                    "team_id": req.team_id,
                    "old_name": req.old_name,
                    "requested_name": req.requested_name,
                    "status": req.status,
                    "created_at": req.created_at,
                },
            },
            status=status.HTTP_201_CREATED,
        )


class TournamentTeamNameChangeRequestCreateView(APIView):
    """
    POST /api/tournaments/<pk>/teams/<team_id>/name-change-requests/
    """
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, pk: int, team_id: int):
        tournament = get_object_or_404(Tournament, pk=pk)

        if not user_can_view_tournament(request.user, tournament):
            return Response({"detail": "Brak dostępu do turnieju."}, status=status.HTTP_403_FORBIDDEN)

        if not _user_is_participant(request.user, tournament):
            return Response(
                {"detail": "Tylko zarejestrowany uczestnik może złożyć prośbę."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if getattr(tournament, "participants_self_rename_enabled", True):
            return Response(
                {"detail": "Samodzielna zmiana nazwy jest włączona — nie trzeba wysyłać prośby."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        team = get_object_or_404(Team, pk=team_id, tournament=tournament, is_active=True)

        if team.name == BYE_TEAM_NAME:
            return Response({"detail": "Nie można zmieniać BYE."}, status=status.HTTP_400_BAD_REQUEST)

        if not _user_owns_team_slot(request.user, tournament, team):
            return Response({"detail": "To nie jest Twój slot uczestnika."}, status=status.HTTP_403_FORBIDDEN)

        requested_name = _norm_name(str(request.data.get("requested_name") or request.data.get("name") or ""))
        if len(requested_name) < 2:
            return Response({"detail": "Nazwa jest zbyt krótka."}, status=status.HTTP_400_BAD_REQUEST)

        if TeamNameChangeRequest.objects.filter(team=team, status=TeamNameChangeRequest.Status.PENDING).exists():
            return Response(
                {"detail": "Istnieje już oczekująca prośba dla tego uczestnika."},
                status=status.HTTP_409_CONFLICT,
            )

        req = TeamNameChangeRequest.objects.create(
            tournament=tournament,
            team=team,
            requested_by=request.user,
            old_name=team.name,
            requested_name=requested_name,
            status=TeamNameChangeRequest.Status.PENDING,
        )

        return Response(
            {
                "detail": "Prośba została złożona.",
                "request": {
                    "id": req.id,
                    "team_id": req.team_id,
                    "old_name": req.old_name,
                    "requested_name": req.requested_name,
                    "status": req.status,
                    "created_at": req.created_at,
                },
            },
            status=status.HTTP_201_CREATED,
        )


class TournamentTeamNameChangeRequestApproveView(APIView):
    """
    POST /api/tournaments/<pk>/teams/name-change-requests/<request_id>/approve/
    """
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, pk: int, request_id: int):
        tournament = get_object_or_404(Tournament, pk=pk)

        # bez fallbacków: wymaga name_change_approve
        if not can_approve_name_changes(request.user, tournament):
            return Response({"detail": "Brak uprawnień."}, status=status.HTTP_403_FORBIDDEN)

        r = get_object_or_404(
            TeamNameChangeRequest,
            pk=request_id,
            tournament=tournament,
        )

        if r.status != TeamNameChangeRequest.Status.PENDING:
            return Response({"detail": "Ta prośba nie jest w statusie PENDING."}, status=status.HTTP_400_BAD_REQUEST)

        team = r.team
        if team.tournament_id != tournament.id or (team.name == BYE_TEAM_NAME) or (not team.is_active):
            return Response({"detail": "Nieprawidłowy uczestnik dla prośby."}, status=status.HTTP_400_BAD_REQUEST)

        new_name = _norm_name(r.requested_name)
        if len(new_name) < 2:
            return Response({"detail": "Nazwa jest zbyt krótka."}, status=status.HTTP_400_BAD_REQUEST)

        if team.name != new_name:
            team.name = new_name
            team.save(update_fields=["name"])

        TournamentRegistration.objects.filter(tournament=tournament, team=team).update(display_name=new_name)

        r.status = TeamNameChangeRequest.Status.APPROVED
        r.decided_by = request.user
        r.decided_at = timezone.now()
        r.save(update_fields=["status", "decided_by", "decided_at"])

        return Response(
            {"detail": "Prośba zaakceptowana.", "team": TeamSerializer(team).data},
            status=status.HTTP_200_OK,
        )


class TournamentTeamNameChangeRequestRejectView(APIView):
    """
    POST /api/tournaments/<pk>/teams/name-change-requests/<request_id>/reject/
    """
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, pk: int, request_id: int):
        tournament = get_object_or_404(Tournament, pk=pk)

        # bez fallbacków: wymaga name_change_approve
        if not can_approve_name_changes(request.user, tournament):
            return Response({"detail": "Brak uprawnień."}, status=status.HTTP_403_FORBIDDEN)

        r = get_object_or_404(
            TeamNameChangeRequest,
            pk=request_id,
            tournament=tournament,
        )

        if r.status != TeamNameChangeRequest.Status.PENDING:
            return Response({"detail": "Ta prośba nie jest w statusie PENDING."}, status=status.HTTP_400_BAD_REQUEST)

        r.status = TeamNameChangeRequest.Status.REJECTED
        r.decided_by = request.user
        r.decided_at = timezone.now()
        r.save(update_fields=["status", "decided_by", "decided_at"])

        return Response({"detail": "Prośba odrzucona."}, status=status.HTTP_200_OK)
