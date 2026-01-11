# backend/tournaments/views/teams.py
from __future__ import annotations

from django.db import transaction
from django.shortcuts import get_object_or_404

from rest_framework import status
from rest_framework.generics import ListAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from ..models import Stage, Team, Tournament
from ..serializers import TeamSerializer, TeamUpdateSerializer, TournamentSerializer
from ..services.match_generation import ensure_matches_generated
from ._helpers import user_can_manage_tournament

BYE_TEAM_NAME = "__SYSTEM_BYE__"


class TournamentTeamListView(ListAPIView):
    serializer_class = TeamSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        tournament = get_object_or_404(Tournament, pk=self.kwargs["pk"])
        if not user_can_manage_tournament(self.request.user, tournament):
            return Team.objects.none()
        return (
            tournament.teams
            .filter(is_active=True)
            .exclude(name=BYE_TEAM_NAME)
            .order_by("id")
        )


class TournamentTeamUpdateView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk, team_id):
        tournament = get_object_or_404(Tournament, pk=pk)
        if not user_can_manage_tournament(request.user, tournament):
            return Response({"detail": "Brak uprawnień."}, status=status.HTTP_403_FORBIDDEN)

        team = get_object_or_404(
            Team,
            pk=team_id,
            tournament=tournament,
            is_active=True,
        )

        if team.name == BYE_TEAM_NAME:
            return Response({"detail": "Nie można edytować zespołu technicznego BYE."}, status=status.HTTP_400_BAD_REQUEST)

        serializer = TeamUpdateSerializer(team, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()

        return Response(TeamSerializer(team).data, status=status.HTTP_200_OK)


class TournamentTeamSetupView(APIView):
    """
    Endpoint: POST /api/tournaments/<id>/teams/setup/

    Cel:
    - Ustawić faktyczną liczbę aktywnych Team (źródło prawdy),
      ale NIGDY nie aktywować __SYSTEM_BYE__.
    - Jeżeli liczba aktywnych Team się zmienia -> UPGRADE rozgrywek:
      reset Stage/Match + regeneracja (ensure_matches_generated).

    Wejście:
    - Docelowo: {"teams_count": <int>}
    """

    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, pk):
        tournament = get_object_or_404(Tournament, pk=pk)

        if not user_can_manage_tournament(request.user, tournament):
            return Response({"detail": "Brak uprawnień."}, status=status.HTTP_403_FORBIDDEN)

        if tournament.status in (Tournament.Status.RUNNING, Tournament.Status.FINISHED):
            return Response(
                {"detail": "Nie można zmieniać liczby uczestników, gdy turniej jest w trakcie lub zarchiwizowany."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        raw_count = request.data.get("teams_count", None)
        # Jeżeli chcesz całkowicie wyczyścić participants_count, usuń 2 linie niżej:
        if raw_count is None:
            raw_count = request.data.get("participants_count", None)

        try:
            requested_count = int(raw_count)
        except (TypeError, ValueError):
            return Response({"detail": "Nieprawidłowa liczba uczestników."}, status=status.HTTP_400_BAD_REQUEST)

        if requested_count < 2:
            return Response({"detail": "Liczba uczestników musi wynosić co najmniej 2."}, status=status.HTTP_400_BAD_REQUEST)

        # Wymuś: BYE zawsze nieaktywny (naprawia wcześniejsze “zepsucie”)
        Team.objects.filter(tournament=tournament, name=BYE_TEAM_NAME).update(is_active=False)

        # Liczymy i modyfikujemy WYŁĄCZNIE zwykłe teamy (bez BYE)
        active_before = Team.objects.filter(tournament=tournament, is_active=True).exclude(name=BYE_TEAM_NAME).count()
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

        active_after = Team.objects.filter(tournament=tournament, is_active=True).exclude(name=BYE_TEAM_NAME).count()

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
            detail += " Rozgrywki zostały przebudowane (upgrade)."
        elif should_upgrade:
            detail += " Rozgrywki zostały wygenerowane."
        else:
            detail += " (Bez przebudowy rozgrywek.)"

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
