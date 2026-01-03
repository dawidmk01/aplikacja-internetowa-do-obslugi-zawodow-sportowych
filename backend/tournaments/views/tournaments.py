from __future__ import annotations

from django.shortcuts import get_object_or_404

from rest_framework import status
from rest_framework.generics import ListAPIView, ListCreateAPIView, RetrieveUpdateAPIView
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from tournaments.services.generators.league import generate_league_stage
from tournaments.services.generators.knockout import generate_knockout_stage

from ..models import Tournament
from ..permissions import IsTournamentOrganizer
from ..serializers import GenerateTournamentSerializer, TournamentSerializer
from ._helpers import user_can_manage_tournament


class TournamentListView(ListCreateAPIView):
    queryset = Tournament.objects.all()
    serializer_class = TournamentSerializer
    permission_classes = [IsAuthenticated]

    def perform_create(self, serializer):
        serializer.save(organizer=self.request.user)


class MyTournamentListView(ListAPIView):
    serializer_class = TournamentSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        return Tournament.objects.filter(
            organizer=user
        ).union(
            Tournament.objects.filter(memberships__user=user)
        )


class TournamentDetailView(RetrieveUpdateAPIView):
    queryset = Tournament.objects.all()
    serializer_class = TournamentSerializer

    def get_permissions(self):
        if self.request.method in ("GET", "HEAD", "OPTIONS"):
            return [AllowAny()]
        return [IsAuthenticated(), IsTournamentOrganizer()]

    def retrieve(self, request, *args, **kwargs):
        tournament = self.get_object()
        user = request.user if request.user.is_authenticated else None

        if user and user_can_manage_tournament(user, tournament):
            return super().retrieve(request, *args, **kwargs)

        if not tournament.is_published:
            return Response({"detail": "Turniej nie jest dostępny."}, status=status.HTTP_403_FORBIDDEN)

        if tournament.access_code:
            if request.query_params.get("code") != tournament.access_code:
                return Response({"detail": "Wymagany poprawny kod dostępu."}, status=status.HTTP_403_FORBIDDEN)

        return super().retrieve(request, *args, **kwargs)


class ArchiveTournamentView(APIView):
    """Przeniesienie turnieju do archiwum: Status -> FINISHED oraz cofnięcie publikacji."""
    permission_classes = [IsAuthenticated, IsTournamentOrganizer]

    def post(self, request, pk):
        tournament = get_object_or_404(Tournament, pk=pk)
        self.check_object_permissions(request, tournament)

        if tournament.status == Tournament.Status.FINISHED:
            return Response({"detail": "Turniej jest już zarchiwizowany."}, status=status.HTTP_400_BAD_REQUEST)

        tournament.status = Tournament.Status.FINISHED
        tournament.is_published = False
        tournament.save(update_fields=["status", "is_published"])

        return Response({"detail": "Turniej został zarchiwizowany."}, status=status.HTTP_200_OK)


class UnarchiveTournamentView(APIView):
    """Przywrócenie turnieju z archiwum: FINISHED -> CONFIGURED"""
    permission_classes = [IsAuthenticated, IsTournamentOrganizer]

    def post(self, request, pk):
        tournament = get_object_or_404(Tournament, pk=pk)
        self.check_object_permissions(request, tournament)

        if tournament.status != Tournament.Status.FINISHED:
            return Response({"detail": "Turniej nie znajduje się w archiwum."}, status=status.HTTP_400_BAD_REQUEST)

        tournament.status = Tournament.Status.CONFIGURED
        tournament.save(update_fields=["status"])

        return Response({"detail": "Turniej został przywrócony z archiwum."}, status=status.HTTP_200_OK)


class GenerateTournamentView(APIView):
    permission_classes = [IsAuthenticated, IsTournamentOrganizer]

    def post(self, request, pk):
        tournament = get_object_or_404(Tournament, pk=pk)
        self.check_object_permissions(request, tournament)

        serializer = GenerateTournamentSerializer(data=request.data, context={"tournament": tournament})
        serializer.is_valid(raise_exception=True)

        if tournament.tournament_format == Tournament.TournamentFormat.LEAGUE:
            generate_league_stage(tournament)
        elif tournament.tournament_format == Tournament.TournamentFormat.CUP:
            generate_knockout_stage(tournament)
        elif tournament.tournament_format == Tournament.TournamentFormat.MIXED:
            from tournaments.services.generators.groups import generate_group_stage
            generate_group_stage(tournament)

        return Response({"detail": "Rozgrywki zostały wygenerowane."}, status=status.HTTP_200_OK)
