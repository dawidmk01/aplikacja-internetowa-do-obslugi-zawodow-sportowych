# ============================================================
# IMPORTY
# ============================================================

from django.db.models import Q
from django.shortcuts import get_object_or_404

from rest_framework.generics import (
    ListCreateAPIView,
    ListAPIView,
    RetrieveUpdateAPIView,
)
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework import status

from .models import (
    Tournament,
    TournamentMembership,
    Team,
    Match,
)
from .serializers import (
    TournamentSerializer,
    AddAssistantSerializer,
    TournamentAssistantSerializer,
    TeamSerializer,
    TeamUpdateSerializer,
    GenerateTournamentSerializer,
    MatchSerializer,
)
from .permissions import IsTournamentOrganizer

from tournaments.services.generators.league import generate_league_stage
from tournaments.services.generators.knockout import generate_knockout_stage


# ============================================================
# FUNKCJE POMOCNICZE
# ============================================================

def user_can_manage_tournament(user, tournament: Tournament) -> bool:
    if not user or not user.is_authenticated:
        return False

    if tournament.organizer_id == user.id:
        return True

    return tournament.memberships.filter(
        user=user,
        role=TournamentMembership.Role.ASSISTANT,
    ).exists()


# ============================================================
# LISTY TURNIEJÓW
# ============================================================

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
            Q(organizer=user) |
            Q(memberships__user=user)
        ).distinct()


# ============================================================
# SZCZEGÓŁY TURNIEJU
# ============================================================

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
            return Response(
                {"detail": "Turniej nie jest dostępny."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if tournament.access_code:
            if request.query_params.get("code") != tournament.access_code:
                return Response(
                    {"detail": "Wymagany poprawny kod dostępu."},
                    status=status.HTTP_403_FORBIDDEN,
                )

        return super().retrieve(request, *args, **kwargs)


# ============================================================
# WSPÓŁORGANIZATORZY
# ============================================================

class TournamentAssistantListView(ListAPIView):
    serializer_class = TournamentAssistantSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        tournament = get_object_or_404(Tournament, pk=self.kwargs["pk"])
        if not user_can_manage_tournament(self.request.user, tournament):
            return TournamentMembership.objects.none()

        return tournament.memberships.filter(
            role=TournamentMembership.Role.ASSISTANT
        )


class AddAssistantView(APIView):
    permission_classes = [IsAuthenticated, IsTournamentOrganizer]

    def post(self, request, pk):
        tournament = get_object_or_404(Tournament, pk=pk)
        self.check_object_permissions(request, tournament)

        serializer = AddAssistantSerializer(
            data=request.data,
            context={"tournament": tournament},
        )
        serializer.is_valid(raise_exception=True)

        TournamentMembership.objects.create(
            tournament=tournament,
            user=serializer.validated_data["user"],
            role=TournamentMembership.Role.ASSISTANT,
        )

        return Response(status=status.HTTP_201_CREATED)


class RemoveAssistantView(APIView):
    permission_classes = [IsAuthenticated, IsTournamentOrganizer]

    def delete(self, request, pk, user_id):
        tournament = get_object_or_404(Tournament, pk=pk)
        self.check_object_permissions(request, tournament)

        TournamentMembership.objects.filter(
            tournament=tournament,
            user_id=user_id,
            role=TournamentMembership.Role.ASSISTANT,
        ).delete()

        return Response(status=status.HTTP_204_NO_CONTENT)


# ============================================================
# UCZESTNICY TURNIEJU
# ============================================================

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
            return Response(
                {"detail": "Brak uprawnień."},
                status=status.HTTP_403_FORBIDDEN,
            )

        team = get_object_or_404(
            Team,
            pk=team_id,
            tournament=tournament,
            is_active=True,
        )

        serializer = TeamUpdateSerializer(team, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()

        return Response(TeamSerializer(team).data)


# ============================================================
# KONFIGURACJA UCZESTNIKÓW
# ============================================================

class TournamentTeamSetupView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        tournament = get_object_or_404(Tournament, pk=pk)

        if not user_can_manage_tournament(request.user, tournament):
            return Response(
                {"detail": "Brak uprawnień."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if tournament.status != Tournament.Status.DRAFT:
            return Response(
                {"detail": "Nie można zmieniać uczestników po wygenerowaniu rozgrywek."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = TournamentSerializer(
            tournament,
            data=request.data,
            partial=True,
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()

        Team.objects.filter(tournament=tournament).delete()

        participants_count = serializer.validated_data.get(
            "participants_count",
            tournament.participants_count,
        )

        name_prefix = (
            "Zawodnik"
            if tournament.competition_type == Tournament.CompetitionType.INDIVIDUAL
            else "Drużyna"
        )

        Team.objects.bulk_create(
            [
                Team(
                    tournament=tournament,
                    name=f"{name_prefix} {i + 1}",
                )
                for i in range(participants_count)
            ]
        )

        return Response(
            {"detail": "Uczestnicy zostali utworzeni."},
            status=status.HTTP_200_OK,
        )


# ============================================================
# GENEROWANIE ROZGRYWEK
# ============================================================

class GenerateTournamentView(APIView):
    permission_classes = [IsAuthenticated, IsTournamentOrganizer]

    def post(self, request, pk):
        tournament = get_object_or_404(Tournament, pk=pk)
        self.check_object_permissions(request, tournament)

        # 🔒 BLOKADA WIELOKROTNEGO GENEROWANIA
        if tournament.status != Tournament.Status.DRAFT:
            return Response(
                {"detail": "Rozgrywki zostały już wygenerowane."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = GenerateTournamentSerializer(
            data=request.data,
            context={"tournament": tournament},
        )
        serializer.is_valid(raise_exception=True)

        if tournament.tournament_format == Tournament.TournamentFormat.LEAGUE:
            generate_league_stage(tournament)

        elif tournament.tournament_format == Tournament.TournamentFormat.CUP:
            generate_knockout_stage(tournament)

        tournament.status = Tournament.Status.CONFIGURED
        tournament.save(update_fields=["status"])

        return Response(
            {"detail": "Rozgrywki zostały wygenerowane."},
            status=status.HTTP_200_OK,
        )


# ============================================================
# MECZE TURNIEJU
# ============================================================

class TournamentMatchListView(ListAPIView):
    serializer_class = MatchSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        tournament = get_object_or_404(Tournament, pk=self.kwargs["pk"])

        if not user_can_manage_tournament(self.request.user, tournament):
            return Match.objects.none()

        return (
            Match.objects
            .filter(tournament=tournament)
            .select_related("home_team", "away_team", "stage")
            .order_by("round_number", "id")
        )
