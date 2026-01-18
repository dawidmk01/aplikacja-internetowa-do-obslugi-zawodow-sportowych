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
    Tournament,
    TournamentRegistration,
    TeamNameChangeRequest,
)
from ..serializers import TeamSerializer, TeamUpdateSerializer, TournamentSerializer
from ..services.match_generation import ensure_matches_generated

# NOWA STRATEGIA: podgląd != edycja
from ._helpers import (
    user_can_view_tournament,
    can_edit_teams,
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
    - team.registered_user == user (legacy)
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

        # PATCH = edycja -> granularnie
        if not can_edit_teams(request.user, tournament):
            return Response(
                {"detail": "Nie masz uprawnień do edycji uczestników. Dostępny jest tylko podgląd."},
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
    - Asystent: tylko jeśli ma perm teams_edit i tylko w trybie MANAGER.
      W ORGANIZER_ONLY asystent ma podgląd, ale edycja jest wyłączona.
    """
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, pk):
        tournament = get_object_or_404(Tournament, pk=pk)

        if not can_edit_teams(request.user, tournament):
            return Response(
                {"detail": "Nie masz uprawnień do edycji uczestników. Dostępny jest tylko podgląd."},
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
# NAME CHANGE REQUESTS: QUEUE (PENDING) + PARTICIPANT CREATE/READ
# ============================================================

class TournamentTeamNameChangeRequestListView(APIView):
    """
    GET /api/tournaments/<pk>/teams/name-change-requests/

    - organizer/asystent (teams_edit): kolejka (domyślnie PENDING, ale można filtrować status/team_id)
    - uczestnik: tylko swoje prośby (requested_by=user) — żeby frontend mógł pobrać PENDING

    POST /api/tournaments/<pk>/teams/name-change-requests/
    - uczestnik tworzy prośbę (frontend wysyła POST na ten URL)
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

        # organizer/asystent queue (panel)
        if can_edit_teams(request.user, tournament):
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
    (zostawione jako kompatybilność / alternatywna ścieżka)
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

        if not can_edit_teams(request.user, tournament):
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

        if not can_edit_teams(request.user, tournament):
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
