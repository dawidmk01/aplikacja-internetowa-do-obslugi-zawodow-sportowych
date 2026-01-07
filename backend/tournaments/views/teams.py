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

        return Response(TeamSerializer(team).data, status=status.HTTP_200_OK)


class TournamentTeamSetupView(APIView):
    """
    Endpoint: POST /api/tournaments/<id>/teams/setup/

    Cel:
    - Ustawić faktyczną liczbę aktywnych Team (to jest źródło prawdy).
    - Jeżeli liczba aktywnych Team się zmienia -> UPGRADE rozgrywek:
      reset Stage/Match + regeneracja (ensure_matches_generated).

    Wejście:
    - Preferowane: {"teams_count": <int>}
    - Tymczasowo akceptowane: {"participants_count": <int>} (dla zgodności FE)
    """
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, pk):
        tournament = get_object_or_404(Tournament, pk=pk)

        if not user_can_manage_tournament(request.user, tournament):
            return Response({"detail": "Brak uprawnień."}, status=status.HTTP_403_FORBIDDEN)

        # Bezpieczniej: nie pozwalaj grzebać w składzie, gdy turniej trwa albo jest zarchiwizowany.
        if tournament.status in (Tournament.Status.RUNNING, Tournament.Status.FINISHED):
            return Response(
                {
                    "detail": (
                        "Nie można zmieniać liczby uczestników, gdy turniej jest w trakcie "
                        "lub zarchiwizowany. Zresetuj/odarchiwizuj turniej i spróbuj ponownie."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # 1) Wejściowy count (nowy klucz: teams_count)
        raw_count = request.data.get("teams_count", None)
        if raw_count is None:
            # kompatybilność z wcześniejszym FE
            raw_count = request.data.get("participants_count", None)

        try:
            requested_count = int(raw_count)
        except (TypeError, ValueError):
            return Response({"detail": "Nieprawidłowa liczba uczestników."}, status=status.HTTP_400_BAD_REQUEST)

        if requested_count < 2:
            return Response(
                {"detail": "Liczba uczestników musi wynosić co najmniej 2."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # 2) Stan przed zmianą (czy istnieje struktura / ile aktywnych)
        active_before = Team.objects.filter(tournament=tournament, is_active=True).count()
        had_structure = Stage.objects.filter(tournament=tournament).exists()

        # 3) Uzupełnij rekordy Team do requested_count (nie kasujemy nazw)
        all_teams = list(tournament.teams.order_by("id"))
        existing_total = len(all_teams)

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
            all_teams = list(tournament.teams.order_by("id"))

        # 4) Ustaw aktywność dokładnie pod requested_count
        changed = []
        for idx, team in enumerate(all_teams):
            should_be_active = idx < requested_count
            if team.is_active != should_be_active:
                team.is_active = should_be_active
                changed.append(team)

        if changed:
            Team.objects.bulk_update(changed, ["is_active"])

        active_after = Team.objects.filter(tournament=tournament, is_active=True).count()

        # 5) Upgrade rozgrywek tylko wtedy, gdy:
        # - zmieniła się liczba aktywnych, LUB
        # - nie ma struktury (np. świeży turniej), a mamy min. 2 aktywnych.
        count_changed = active_after != active_before
        should_upgrade = (active_after >= 2) and (count_changed or not had_structure)

        reset_done = False
        if should_upgrade and tournament.status != Tournament.Status.DRAFT:
            # Nie kasujemy tu Stage/Match ręcznie – robi to ensure_matches_generated.
            tournament.status = Tournament.Status.DRAFT
            tournament.save(update_fields=["status"])
            reset_done = True

        if should_upgrade:
            ensure_matches_generated(tournament)
            # Po wygenerowaniu struktury uznajemy turniej za skonfigurowany
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

        active_teams = tournament.teams.filter(is_active=True).order_by("id")
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
