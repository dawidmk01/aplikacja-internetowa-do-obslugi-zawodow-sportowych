from __future__ import annotations

from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404

from rest_framework import status
from rest_framework.generics import ListAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from ..models import Match, Stage, Team, Tournament, TournamentMembership
from ..serializers import TeamSerializer, TeamUpdateSerializer, TournamentSerializer
from ..services.match_generation import ensure_matches_generated

# NOWA STRATEGIA: podgląd != edycja
from ._helpers import (
    user_can_view_tournament,
    can_edit_teams,
    get_membership,
)

BYE_TEAM_NAME = "__SYSTEM_BYE__"


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

        # PODGLĄD jest osobno, ale PATCH to edycja -> granularnie
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

    Uprawnienia (NOWA STRATEGIA):
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
            return Response(
                {"detail": "Nieprawidłowa liczba uczestników."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if requested_count < 2:
            return Response(
                {"detail": "Liczba uczestników musi wynosić co najmniej 2."},
                status=status.HTTP_400_BAD_REQUEST,
            )

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
