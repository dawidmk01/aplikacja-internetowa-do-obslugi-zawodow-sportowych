from __future__ import annotations

# ============================================================
# IMPORTY
# ============================================================

from typing import Optional, Tuple

from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404

from rest_framework import status
from rest_framework.generics import ListAPIView, ListCreateAPIView, RetrieveUpdateAPIView
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from tournaments.services.generators.league import generate_league_stage
from tournaments.services.generators.knockout import (
    generate_knockout_stage,
    generate_next_knockout_stage,
)
from tournaments.services.match_result import MatchResultService

from .models import Match, Stage, Team, Tournament, TournamentMembership
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
# FUNKCJE POMOCNICZE – KO (KONFIG + KLUCZE PAR)
# ============================================================

def _get_cup_matches(tournament: Tournament) -> int:
    """
    Liczba meczów na parę w KO.
    Wspierane: 1 lub 2. Inne wartości -> 1.
    """
    cfg = tournament.format_config or {}
    raw = cfg.get("cup_matches", 1)

    try:
        n = int(raw)
    except (TypeError, ValueError):
        n = 1

    return n if n in (1, 2) else 1


def _pair_key_ids(home_id: int, away_id: int) -> Tuple[int, int]:
    return (home_id, away_id) if home_id < away_id else (away_id, home_id)


def _sync_two_leg_pair_winner_if_possible(stage: Stage, tournament: Tournament, match: Match) -> None:
    """
    Dla cup_matches=2:
    - jeśli para ma 2 mecze i oba są FINISHED, liczymy agregat bramek,
    - jeśli agregat rozstrzyga -> ustawiamy winner na OBU meczach pary (spójnie),
    - jeśli agregat remisowy -> czyścimy winner na OBU meczach (żeby nie dało się awansować).
    """
    if _get_cup_matches(tournament) != 2:
        return

    key = _pair_key_ids(match.home_team_id, match.away_team_id)

    group = list(
        Match.objects.filter(stage=stage)
        .only("id", "status", "winner_id", "home_team_id", "away_team_id", "home_score", "away_score")
    )
    group = [m for m in group if _pair_key_ids(m.home_team_id, m.away_team_id) == key]

    # BYE/walkower w Twoim generatorze ma tylko 1 mecz w parze — nie liczymy agregatu.
    if len(group) == 1:
        return

    # Muszą być dokładnie 2 mecze.
    if len(group) != 2:
        return

    # Oba muszą być FINISHED.
    if any(m.status != Match.Status.FINISHED for m in group):
        return

    goals: dict[int, int] = {}

    for m in group:
        hs = int(m.home_score or 0)
        a_s = int(m.away_score or 0)
        goals[m.home_team_id] = goals.get(m.home_team_id, 0) + hs
        goals[m.away_team_id] = goals.get(m.away_team_id, 0) + a_s

    team_ids = list({group[0].home_team_id, group[0].away_team_id})
    if len(team_ids) != 2:
        return

    t1, t2 = team_ids[0], team_ids[1]
    g1, g2 = goals.get(t1, 0), goals.get(t2, 0)

    ids = [group[0].id, group[1].id]

    if g1 == g2:
        # Brak rozstrzygnięcia agregatem -> czyścimy zwycięzców, żeby KO nie awansowało "przypadkiem".
        Match.objects.filter(id__in=ids).update(winner=None)
        return

    winner_id = t1 if g1 > g2 else t2
    Match.objects.filter(id__in=ids).update(winner_id=winner_id)


# ============================================================
# FUNKCJE POMOCNICZE – KO (ROLLBACK / PROPAGACJA)
# ============================================================

def _knockout_downstream_stages(tournament: Tournament, after_order: int):
    """Zwraca kolejne etapy KO po danym etapie (po order)."""
    return Stage.objects.filter(
        tournament=tournament,
        stage_type=Stage.StageType.KNOCKOUT,
        order__gt=after_order,
    ).order_by("order")


def _knockout_downstream_has_results(tournament: Tournament, after_order: int) -> bool:
    """
    Sprawdza, czy w kolejnych etapach KO istnieją jakiekolwiek wyniki
    (czyli dane, których nie wolno "cicho" nadpisać).
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
    - tylko jeśli downstream KO nie ma wyników,
    - podmieniamy wystąpienia starej drużyny na nową w przyszłych meczach KO.
    """
    if not old_team_id:
        return
    if new_team is None:
        return

    downstream_matches = Match.objects.filter(
        tournament=tournament,
        stage__stage_type=Stage.StageType.KNOCKOUT,
        stage__order__gt=after_order,
    ).select_related("stage")

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

        if m.home_team_id == m.away_team_id:
            raise ValueError("Kolizja w KO: po podmianie drużyn mecz stał się home==away.")

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

    Stage.objects.filter(
        tournament=tournament,
        stage_type=Stage.StageType.KNOCKOUT,
        order__gt=after_order,
    ).exclude(status=Stage.Status.OPEN).update(status=Stage.Status.OPEN)

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

    Ważne: generator może rzucić ValueError (np. niespójni zwycięzcy w dwumeczu).
    To NIE może robić 500.
    """
    tournament = stage.tournament

    if _knockout_downstream_stages(tournament, stage.order).exists():
        return

    matches = list(stage.matches.all())
    if not matches:
        return

    if any(m.status != Match.Status.FINISHED or not m.winner_id for m in matches):
        return

    if stage.status != Stage.Status.OPEN:
        stage.status = Stage.Status.OPEN
        stage.save(update_fields=["status"])

    try:
        generate_next_knockout_stage(stage)
    except ValueError:
        # Nie generujemy i nie wywalamy serwera.
        return


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
    """Przeniesienie turnieju do archiwum: Status -> FINISHED oraz cofnięcie publikacji."""
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

        return Response({"detail": "Turniej został zarchiwizowany."}, status=status.HTTP_200_OK)


class UnarchiveTournamentView(APIView):
    """Przywrócenie turnieju z archiwum: FINISHED -> CONFIGURED"""
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

        return Response({"detail": "Turniej został przywrócony z archiwum."}, status=status.HTTP_200_OK)


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
        return tournament.memberships.filter(role=TournamentMembership.Role.ASSISTANT)


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
            return Response({"detail": "Brak uprawnień."}, status=status.HTTP_403_FORBIDDEN)

        team = get_object_or_404(Team, pk=team_id, tournament=tournament, is_active=True)

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
            return Response({"detail": "Brak uprawnień."}, status=status.HTTP_403_FORBIDDEN)

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
                    Team(tournament=tournament, name=f"{name_prefix} {i}", is_active=True)
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

        return Response({"detail": "Rozgrywki zostały wygenerowane."}, status=status.HTTP_200_OK)


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
            Match.objects.filter(tournament=tournament)
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
# WYNIK MECZU (PATCH /result/)
# ============================================================

class MatchResultUpdateView(RetrieveUpdateAPIView):
    serializer_class = MatchResultUpdateSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        return (
            Match.objects.filter(
                Q(tournament__organizer=user) | Q(tournament__memberships__user=user)
            )
            .select_related("stage", "tournament")
            .distinct()
        )

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        match = self.get_object()
        stage = match.stage
        tournament = match.tournament

        old_winner_id = match.winner_id
        old_status = match.status

        serializer = self.get_serializer(match, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        match = serializer.save()

        # Ustal status/winner deterministycznie (ale nie chcemy przypadkiem wymuszać FINISHED tutaj).
        try:
            MatchResultService.apply_result(match)
        except Exception:
            # jeżeli serwis rzuca (np. KO + remis), to nie wywalamy PATCH-a
            pass

        # Jeżeli serwis ustawił FINISHED, a wcześniej nie było FINISHED – cofamy status.
        if old_status != Match.Status.FINISHED and match.status == Match.Status.FINISHED:
            match.status = old_status
            match.save(update_fields=["status"])

        # cup_matches=2: jeśli oba mecze pary są FINISHED, zsynchronizuj zwycięzcę agregatem
        if stage.stage_type == Stage.StageType.KNOCKOUT and _get_cup_matches(tournament) == 2:
            _sync_two_leg_pair_winner_if_possible(stage, tournament, match)
            match.refresh_from_db(fields=["winner_id"])

        new_winner_id = match.winner_id

        # KO: rollback / propagacja TYLKO gdy zmienił się zwycięzca
        if stage.stage_type == Stage.StageType.KNOCKOUT and old_winner_id != new_winner_id:
            if _knockout_downstream_stages(tournament, stage.order).exists():
                if _knockout_downstream_has_results(tournament, stage.order):
                    rollback_knockout_after_stage(stage)
                else:
                    new_team = Team.objects.filter(pk=new_winner_id).first() if new_winner_id else None
                    try:
                        _soft_propagate_knockout_winner_change(
                            tournament=tournament,
                            after_order=stage.order,
                            old_team_id=old_winner_id,
                            new_team=new_team,
                        )
                    except ValueError:
                        rollback_knockout_after_stage(stage)

        # Auto-progres KO (bez 500)
        if stage.stage_type == Stage.StageType.KNOCKOUT and tournament.status != Tournament.Status.FINISHED:
            _try_auto_advance_knockout(stage)

        return Response(MatchSerializer(match).data, status=status.HTTP_200_OK)


# ============================================================
# ZAKOŃCZENIE MECZU (POST /finish/)
# ============================================================

class FinishMatchView(APIView):
    """
    POST /api/matches/<pk>/finish/  (albo <id>/finish/)
    Jedyne miejsce, które logicznie ustawia FINISHED (idempotentnie).
    """
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, *args, **kwargs):
        match_id = kwargs.get("pk") or kwargs.get("id")
        if not match_id:
            return Response({"detail": "Brak identyfikatora meczu."}, status=status.HTTP_400_BAD_REQUEST)

        match = get_object_or_404(
            Match.objects.select_related("stage", "tournament", "home_team", "away_team"),
            pk=match_id,
        )
        tournament = match.tournament
        stage = match.stage

        if not user_can_manage_tournament(request.user, tournament):
            return Response({"detail": "Brak uprawnień."}, status=status.HTTP_403_FORBIDDEN)

        if match.status == Match.Status.FINISHED:
            return Response({"detail": "Mecz jest już zakończony."}, status=status.HTTP_200_OK)

        cup_matches = _get_cup_matches(tournament)

        # ===============================
        # LIGA / GRUPA
        # ===============================
        if stage.stage_type in (Stage.StageType.LEAGUE, Stage.StageType.GROUP):
            match.status = Match.Status.FINISHED
            match.save(update_fields=["status"])
            return Response({"detail": "Mecz zakończony."}, status=status.HTTP_200_OK)

        # ===============================
        # KO
        # ===============================
        if stage.stage_type == Stage.StageType.KNOCKOUT:
            # KO: nie kończymy „domyślnego” 0:0 bez dotknięcia wyniku
            if not match.result_entered:
                return Response(
                    {"detail": "Nie można zakończyć meczu KO bez wprowadzenia wyniku."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # Próbuj ustalić zwycięzcę z serwisu (jeśli serwis nie toleruje remisów KO, nie wywalamy endpointu).
            try:
                MatchResultService.apply_result(match)
            except Exception:
                pass

            # cup_matches=1: remis zabroniony i winner musi istnieć
            if cup_matches == 1:
                if match.home_score == match.away_score:
                    return Response(
                        {"detail": "Nie można zakończyć meczu KO remisem (cup_matches=1)."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                if not match.winner_id:
                    return Response(
                        {"detail": "Brak zwycięzcy — nie można zakończyć meczu KO."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

            match.status = Match.Status.FINISHED
            match.save(update_fields=["status"])

            # cup_matches=2: po zakończeniu meczu spróbuj ustalić winner pary agregatem
            if cup_matches == 2:
                _sync_two_leg_pair_winner_if_possible(stage, tournament, match)

            # Auto-progres KO (bez 500)
            _try_auto_advance_knockout(stage)

            return Response({"detail": "Mecz zakończony."}, status=status.HTTP_200_OK)

        return Response({"detail": "Nieobsługiwany typ etapu."}, status=status.HTTP_400_BAD_REQUEST)


# ============================================================
# ZATWIERDZANIE ETAPU KO (KOMPATYBILNOŚĆ)
# ============================================================

class ConfirmStageView(APIView):
    """
    Jeśli przechodzisz na pełne auto-generowanie, docelowo możesz to usunąć.
    """
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, *args, **kwargs):
        stage_id = kwargs.get("pk") or kwargs.get("id")
        if not stage_id:
            return Response({"detail": "Brak identyfikatora etapu."}, status=status.HTTP_400_BAD_REQUEST)

        stage = get_object_or_404(Stage, pk=stage_id)
        tournament = stage.tournament

        if not user_can_manage_tournament(request.user, tournament):
            return Response({"detail": "Brak uprawnień."}, status=status.HTTP_403_FORBIDDEN)

        if stage.stage_type != Stage.StageType.KNOCKOUT:
            return Response(
                {"detail": "Zatwierdzanie obsługiwane jest tylko dla etapu KO."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if stage.status != Stage.Status.OPEN:
            stage.status = Stage.Status.OPEN
            stage.save(update_fields=["status"])

        try:
            generate_next_knockout_stage(stage)
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        return Response({"detail": "Etap został zatwierdzony."}, status=status.HTTP_200_OK)
