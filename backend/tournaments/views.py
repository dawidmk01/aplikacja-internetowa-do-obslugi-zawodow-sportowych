# ============================================================
# IMPORTY
# ============================================================

from django.db import transaction
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
    Stage,
)
from .serializers import (
    TournamentSerializer,
    AddAssistantSerializer,
    TournamentAssistantSerializer,
    TeamSerializer,
    TeamUpdateSerializer,
    GenerateTournamentSerializer,
    MatchSerializer,
    MatchResultUpdateSerializer,
)
from .permissions import IsTournamentOrganizer

from tournaments.services.generators.league import generate_league_stage
from tournaments.services.generators.knockout import generate_knockout_stage
from tournaments.services.match_result import MatchResultService


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
# ARCHIWIZACJA TURNIEJU
# ============================================================

class ArchiveTournamentView(APIView):
    """
    Przeniesienie turnieju do archiwum.
    Status -> FINISHED oraz cofnięcie publikacji.
    """
    permission_classes = [IsAuthenticated, IsTournamentOrganizer]

    def post(self, request, pk):
        tournament = get_object_or_404(Tournament, pk=pk)
        self.check_object_permissions(request, tournament)

        if tournament.status == Tournament.Status.FINISHED:
            return Response(
                {"detail": "Turniej jest już zarchiwizowany."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        tournament.status = Tournament.Status.FINISHED
        tournament.is_published = False
        tournament.save(update_fields=["status", "is_published"])

        return Response(
            {"detail": "Turniej został zarchiwizowany."},
            status=status.HTTP_200_OK,
        )


# ============================================================
# COFNIĘCIE ARCHIWIZACJI
# ============================================================


class UnarchiveTournamentView(APIView):
    """
    Przywrócenie turnieju z archiwum.
    FINISHED -> CONFIGURED
    """
    permission_classes = [IsAuthenticated, IsTournamentOrganizer]

    def post(self, request, pk):
        tournament = get_object_or_404(Tournament, pk=pk)
        self.check_object_permissions(request, tournament)

        if tournament.status != Tournament.Status.FINISHED:
            return Response(
                {"detail": "Turniej nie znajduje się w archiwum."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        tournament.status = Tournament.Status.CONFIGURED
        tournament.save(update_fields=["status"])

        return Response(
            {"detail": "Turniej został przywrócony z archiwum."},
            status=status.HTTP_200_OK,
        )


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
# KONFIGURACJA UCZESTNIKÓW (SETUP)
# ============================================================

class TournamentTeamSetupView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, pk):
        tournament = get_object_or_404(Tournament, pk=pk)

        if not user_can_manage_tournament(request.user, tournament):
            return Response(
                {"detail": "Brak uprawnień."},
                status=status.HTTP_403_FORBIDDEN,
            )

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

        reset_done = False
        if tournament.status != Tournament.Status.DRAFT:
            Match.objects.filter(tournament=tournament).delete()
            Stage.objects.filter(tournament=tournament).delete()
            tournament.status = Tournament.Status.DRAFT
            tournament.save(update_fields=["status"])
            reset_done = True

        serializer.save()

        all_teams = list(tournament.teams.order_by("id"))
        existing = len(all_teams)

        name_prefix = (
            "Zawodnik"
            if tournament.competition_type == Tournament.CompetitionType.INDIVIDUAL
            else "Drużyna"
        )

        if existing < requested_count:
            Team.objects.bulk_create(
                [
                    Team(
                        tournament=tournament,
                        name=f"{name_prefix} {i}",
                        is_active=True,
                    )
                    for i in range(existing + 1, requested_count + 1)
                ]
            )
            all_teams = list(tournament.teams.order_by("id"))

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

        return Response({"detail": detail}, status=status.HTTP_200_OK)


# ============================================================
# GENEROWANIE ROZGRYWEK
# ============================================================

class GenerateTournamentView(APIView):
    permission_classes = [IsAuthenticated, IsTournamentOrganizer]

    def post(self, request, pk):
        tournament = get_object_or_404(Tournament, pk=pk)
        self.check_object_permissions(request, tournament)

        serializer = GenerateTournamentSerializer(
            data=request.data,
            context={"tournament": tournament},
        )
        serializer.is_valid(raise_exception=True)

        if tournament.tournament_format == Tournament.TournamentFormat.LEAGUE:
            generate_league_stage(tournament)
        elif tournament.tournament_format == Tournament.TournamentFormat.CUP:
            generate_knockout_stage(tournament)
        elif tournament.tournament_format == Tournament.TournamentFormat.MIXED:
            from tournaments.services.generators.groups import generate_group_stage
            generate_group_stage(tournament)

        return Response(
            {"detail": "Rozgrywki zostały wygenerowane."},
            status=status.HTTP_200_OK,
        )


# ============================================================
# MECZE TURNIEJU – LISTA
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


# ============================================================
# HARMONOGRAM MECZU
# ============================================================

class MatchScheduleUpdateView(RetrieveUpdateAPIView):
    queryset = Match.objects.all()
    serializer_class = MatchSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        return Match.objects.filter(
            Q(tournament__organizer=user)
            | Q(tournament__memberships__user=user)
        ).distinct()

    def update(self, request, *args, **kwargs):
        allowed_fields = {
            "scheduled_date",
            "scheduled_time",
            "location",
        }

        data = {
            key: value
            for key, value in request.data.items()
            if key in allowed_fields
        }

        serializer = self.get_serializer(
            self.get_object(),
            data=data,
            partial=True,
        )
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)

        return Response(serializer.data, status=status.HTTP_200_OK)


# ============================================================
# WYNIK MECZU
# ============================================================

class MatchResultUpdateView(RetrieveUpdateAPIView):
    queryset = Match.objects.all()
    serializer_class = MatchResultUpdateSerializer
    permission_classes = [IsAuthenticated]

    def update(self, request, *args, **kwargs):
        match = self.get_object()
        stage = match.stage

        serializer = self.get_serializer(
            match,
            data=request.data,
            partial=True,
        )
        serializer.is_valid(raise_exception=True)

        match = serializer.save()

        try:
            MatchResultService.apply_result(match)
        except ValueError as e:
            return Response(
                {"detail": str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # 🔥 JEŚLI TO KO → COFAMY KOLEJNE ETAPY
        if stage.stage_type == Stage.StageType.KNOCKOUT:
            rollback_knockout_after_stage(stage)

        return Response(
            MatchSerializer(match).data,
            status=status.HTTP_200_OK,
        )

from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from tournaments.models import Stage
from tournaments.services.generators.knockout import generate_next_knockout_stage


class ConfirmStageView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        stage = get_object_or_404(Stage, pk=pk)
        tournament = stage.tournament

        if not user_can_manage_tournament(request.user, tournament):
            return Response(
                {"detail": "Brak uprawnień."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if stage.stage_type != Stage.StageType.KNOCKOUT:
            return Response(
                {"detail": "Zatwierdzanie obsługiwane jest tylko dla etapu KO."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if stage.status != Stage.Status.OPEN:
            return Response(
                {"detail": "Etap został już zatwierdzony."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # 🔴 BLOKADA PO FINALE
        if tournament.status == Tournament.Status.FINISHED:
            return Response(
                {"detail": "Turniej został już zakończony."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            generate_next_knockout_stage(stage)
        except ValueError as e:
            return Response(
                {"detail": str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            {"detail": "Etap został zatwierdzony."},
            status=status.HTTP_200_OK,
        )
