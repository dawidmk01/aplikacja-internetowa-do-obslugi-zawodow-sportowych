from __future__ import annotations

from django.db import transaction
from django.shortcuts import get_object_or_404

from rest_framework import status
from rest_framework.generics import ListAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from ..models import Match, Stage, Team, Tournament
from ..serializers import TeamSerializer, TeamUpdateSerializer, TournamentSerializer
from ._helpers import user_can_manage_tournament


class TournamentTeamListView(ListAPIView):
    serializer_class = TeamSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        tournament = get_object_or_404(Tournament, pk=self.kwargs["pk"])
        if not user_can_manage_tournament(self.request.user, tournament):
            return Team.objects.none()
        return tournament.teams.filter(is_active=True).order_by("id")


class TournamentTeamUpdateView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk, team_id):
        tournament = get_object_or_404(Tournament, pk=pk)
        if not user_can_manage_tournament(request.user, tournament):
            return Response({"detail": "Brak uprawnień."}, status=status.HTTP_403_FORBIDDEN)

        team = get_object_or_404(Team, pk=team_id, tournament=tournament, is_active=True)

        serializer = TeamUpdateSerializer(team, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()

        return Response(TeamSerializer(team).data)


class TournamentTeamSetupView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, pk):
        tournament = get_object_or_404(Tournament, pk=pk)

        if not user_can_manage_tournament(request.user, tournament):
            return Response({"detail": "Brak uprawnień."}, status=status.HTTP_403_FORBIDDEN)

        # walidujemy PATCH-em turnieju tylko participants_count (reszta i tak jest blokowana przez serializer)
        serializer = TournamentSerializer(
            tournament,
            data=request.data,
            partial=True,
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)

        requested_count = serializer.validated_data.get(
            "participants_count",
            tournament.participants_count,
        )

        # Bezpiecznik
        if requested_count < 2:
            return Response({"detail": "Liczba uczestników musi wynosić co najmniej 2."}, status=status.HTTP_400_BAD_REQUEST)

        reset_done = False
        if tournament.status != Tournament.Status.DRAFT:
            # UWAGA: u Ciebie Match ma FK tournament i FK stage, więc najbezpieczniej kasować po tournament
            Match.objects.filter(tournament=tournament).delete()
            Stage.objects.filter(tournament=tournament).delete()
            tournament.status = Tournament.Status.DRAFT
            tournament.save(update_fields=["status"])
            reset_done = True

        # zapisujemy participants_count w turnieju
        serializer.save()

        # pobierz WSZYSTKIE teamy (aktywne i nieaktywne), żeby móc reaktywować przy zwiększeniu
        all_teams = list(tournament.teams.order_by("id"))
        existing_total = len(all_teams)

        name_prefix = (
            "Zawodnik"
            if tournament.competition_type == Tournament.CompetitionType.INDIVIDUAL
            else "Drużyna"
        )

        # jeżeli brakuje rekordów, dobijamy nowe
        if existing_total < requested_count:
            Team.objects.bulk_create(
                [
                    Team(tournament=tournament, name=f"{name_prefix} {i}", is_active=True)
                    for i in range(existing_total + 1, requested_count + 1)
                ]
            )
            all_teams = list(tournament.teams.order_by("id"))

        # ustaw aktywność dokładnie pod requested_count
        changed = []
        for idx, team in enumerate(all_teams):
            should_be_active = idx < requested_count
            if team.is_active != should_be_active:
                team.is_active = should_be_active
                changed.append(team)

        if changed:
            Team.objects.bulk_update(changed, ["is_active"])

        detail = "Uczestnicy zostali zaktualizowani."
        if reset_done:
            detail += " Turniej został zresetowany."

        # KLUCZOWE: zwróć od razu aktualny turniej i listę aktywnych teamów (bez dodatkowych GET w FE)
        active_teams = tournament.teams.filter(is_active=True).order_by("id")
        return Response(
            {
                "detail": detail,
                "reset_done": reset_done,
                "tournament": TournamentSerializer(tournament, context={"request": request}).data,
                "teams": TeamSerializer(active_teams, many=True).data,
            },
            status=status.HTTP_200_OK,
        )
