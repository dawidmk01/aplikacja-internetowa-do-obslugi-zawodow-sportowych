from __future__ import annotations

# ============================================================
# IMPORTY
# ============================================================

from typing import Optional

from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404

from rest_framework import status
from rest_framework.generics import (
    ListAPIView,
    ListCreateAPIView,
    RetrieveUpdateAPIView,
)
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from tournaments.services.generators.league import generate_league_stage
from tournaments.services.generators.knockout import (
    generate_knockout_stage,
    generate_next_knockout_stage,
)
from tournaments.services.match_result import MatchResultService

from .models import (
    Match,
    Stage,
    Team,
    Tournament,
    TournamentMembership,
)
from .permissions import IsTournamentOrganizer
from .serializers import (
    AddAssistantSerializer,
    GenerateTournamentSerializer,
    MatchResultUpdateSerializer,
    MatchSerializer,
    TeamSerializer,
    TeamUpdateSerializer,
    TournamentAssistantSerializer,
    TournamentSerializer,
)


# ============================================================
# FUNKCJE POMOCNICZE – UPRAWNIENIA
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
# FUNKCJE POMOCNICZE – KO (ROLLBACK / PROPAGACJA)
# ============================================================

def _knockout_downstream_stages(tournament: Tournament, after_order: int):
    """
    Zwraca kolejne etapy KO po danym etapie (po order).
    """
    return Stage.objects.filter(
        tournament=tournament,
        stage_type=Stage.StageType.KNOCKOUT,
        order__gt=after_order,
    ).order_by("order")


def _knockout_downstream_has_results(tournament: Tournament, after_order: int) -> bool:
    """
    Sprawdza, czy w kolejnych etapach KO istnieją jakiekolwiek wyniki
    (czyli realne dane, których nie wolno "cicho" nadpisać).
    """
    qs = Match.objects.filter(
        tournament=tournament,
        stage__stage_type=Stage.StageType.KNOCKOUT,
        stage__order__gt=after_order,
    )
    return qs.filter(
        Q(status=Match.Status.FINISHED)
        | Q(home_score__isnull=False)
        | Q(away_score__isnull=False)
        | Q(winner__isnull=False)
    ).exists()


def _soft_propagate_knockout_winner_change(
    tournament: Tournament,
    after_order: int,
    old_team_id: Optional[int],
    new_team: Optional[Team],
) -> None:
    """
    Soft-propagacja (bez kasowania etapów):
    - tylko jeśli downstream KO nie ma wyników.
    - podmieniamy wystąpienia starej drużyny na nową w meczach KO "w przyszłości".
    """
    if not old_team_id:
        return
    if new_team is None:
        # Zwycięzca został "wyczyszczony" (np. remis/niekompletne).
        # Bezpieczniej jest w takim wypadku zrobić hard rollback,
        # ale tę decyzję podejmuje warstwa wyżej.
        return

    downstream_matches = Match.objects.filter(
        tournament=tournament,
        stage__stage_type=Stage.StageType.KNOCKOUT,
        stage__order__gt=after_order,
    ).select_related("stage")

    # Podmieniamy home/away tam, gdzie występuje stara drużyna.
    to_update = []
    for m in downstream_matches:
        changed = False

        if m.home_team_id == old_team_id:
            m.home_team = new_team
            changed = True

        if m.away_team_id == old_team_id:
            m.away_team = new_team
            changed = True

        if not changed:
            continue

        # Ochrona przed złamaniem constraintu home != away
        if m.home_team_id == m.away_team_id:
            # W razie kolizji lepiej nie próbować naprawiać "na siłę".
            raise ValueError("Kolizja w KO: po podmianie drużyn mecz stał się home==away.")

        # Downstream i tak jest bez wyników, więc czyścimy ewentualne pola.
        m.home_score = None
        m.away_score = None
        m.winner = None
        m.status = Match.Status.SCHEDULED

        to_update.append(m)

    if to_update:
        Match.objects.bulk_update(
            to_update,
            ["home_team", "away_team", "home_score", "away_score", "winner", "status"],
        )

    # Re-open downstream stages (żeby auto-progres mógł działać spójnie)
    Stage.objects.filter(
        tournament=tournament,
        stage_type=Stage.StageType.KNOCKOUT,
        order__gt=after_order,
    ).exclude(status=Stage.Status.OPEN).update(status=Stage.Status.OPEN)

    # Jeśli turniej był zakończony (FINISHED), a my zmieniamy drabinkę,
    # to trzeba go logicznie "odkończyć".
    if tournament.status == Tournament.Status.FINISHED:
        tournament.status = Tournament.Status.CONFIGURED
        tournament.save(update_fields=["status"])


def rollback_knockout_after_stage(stage: Stage) -> int:
    """
    Hard rollback KO:
    - usuwa wszystkie KO etapy po wskazanym etapie (order > stage.order),
    - usuwa ich mecze,
    - koryguje status turnieju (jeśli był FINISHED).
    Zwraca liczbę usuniętych etapów.
    """
    tournament = stage.tournament
    downstream_stages = _knockout_downstream_stages(tournament, stage.order)

    if not downstream_stages.exists():
        return 0

    # usuwamy mecze downstream, potem etapy
    Match.objects.filter(stage__in=downstream_stages).delete()
    deleted_count = downstream_stages.count()
    downstream_stages.delete()

    if tournament.status == Tournament.Status.FINISHED:
        tournament.status = Tournament.Status.CONFIGURED
        tournament.save(update_fields=["status"])

    return deleted_count


def _try_auto_advance_knockout(stage: Stage) -> None:
    """
    Auto-progres KO:
    - jeśli etap KO ma komplet rozstrzygniętych meczów (FINISHED + winner),
      i nie ma jeszcze następnego etapu KO,
      generujemy kolejny etap.
    """
    tournament = stage.tournament

    # jeśli już istnieje downstream KO, nie generujemy ponownie
    if _knockout_downstream_stages(tournament, stage.order).exists():
        return

    matches = list(stage.matches.all())

    if not matches:
        return

    # musi być pełne rozstrzygnięcie
    if any(m.status != Match.Status.FINISHED or not m.winner_id for m in matches):
        return

    # generator wymaga OPEN – urealniamy status
    if stage.status != Stage.Status.OPEN:
        stage.status = Stage.Status.OPEN
        stage.save(update_fields=["status"])

    generate_next_knockout_stage(stage)


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
            Q(organizer=user) | Q(memberships__user=user)
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
# ARCHIWIZACJA / COFNIĘCIE ARCHIWIZACJI
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
            .order_by("stage__order", "round_number", "id")
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
            Q(tournament__organizer=user) | Q(tournament__memberships__user=user)
        ).distinct()

    def update(self, request, *args, **kwargs):
        allowed_fields = {"scheduled_date", "scheduled_time", "location"}

        data = {k: v for k, v in request.data.items() if k in allowed_fields}

        serializer = self.get_serializer(self.get_object(), data=data, partial=True)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)

        return Response(serializer.data, status=status.HTTP_200_OK)


# ============================================================
# WYNIK MECZU
# ============================================================

class MatchResultUpdateView(RetrieveUpdateAPIView):
    serializer_class = MatchResultUpdateSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        return Match.objects.filter(
            Q(tournament__organizer=user) | Q(tournament__memberships__user=user)
        ).select_related("stage", "tournament").distinct()

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        match = self.get_object()
        stage = match.stage
        tournament = match.tournament

        old_winner_id = match.winner_id  # klucz do rollbacku

        serializer = self.get_serializer(match, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)

        match = serializer.save()

        # Ustal status/winner deterministycznie (bez rzucania dla stanów przejściowych)
        MatchResultService.apply_result(match)

        new_winner_id = match.winner_id

        # KO: rollback / propagacja TYLKO gdy zmienił się zwycięzca
        if stage.stage_type == Stage.StageType.KNOCKOUT and old_winner_id != new_winner_id:
            # jeśli nie ma downstream – nic nie robimy
            if _knockout_downstream_stages(tournament, stage.order).exists():
                if _knockout_downstream_has_results(tournament, stage.order):
                    # downstream ma wyniki -> hard rollback
                    rollback_knockout_after_stage(stage)
                else:
                    # downstream bez wyników -> soft propagacja
                    new_team = Team.objects.filter(pk=new_winner_id).first() if new_winner_id else None
                    try:
                        _soft_propagate_knockout_winner_change(
                            tournament=tournament,
                            after_order=stage.order,
                            old_team_id=old_winner_id,
                            new_team=new_team,
                        )
                    except ValueError:
                        # jeżeli soft update powoduje kolizję, robimy hard rollback
                        rollback_knockout_after_stage(stage)

        # Auto-progres KO: jeśli etap jest kompletny i nie ma jeszcze następnego etapu -> generujemy
        if stage.stage_type == Stage.StageType.KNOCKOUT and tournament.status != Tournament.Status.FINISHED:
            _try_auto_advance_knockout(stage)

        return Response(MatchSerializer(match).data, status=status.HTTP_200_OK)


# ============================================================
# (Opcjonalne) ZATWIERDZANIE ETAPU KO – zostawione dla kompatybilności
# ============================================================

class ConfirmStageView(APIView):
    """
    Jeśli przechodzisz na pełne auto-generowanie, docelowo ten endpoint możesz usunąć.
    """
    permission_classes = [IsAuthenticated]

    @transaction.atomic
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

        # generator wymaga OPEN
        if stage.status != Stage.Status.OPEN:
            stage.status = Stage.Status.OPEN
            stage.save(update_fields=["status"])

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
