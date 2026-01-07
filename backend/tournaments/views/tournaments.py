from __future__ import annotations

from django.apps import apps
from django.db import transaction
from django.shortcuts import get_object_or_404

from rest_framework import serializers, status
from rest_framework.generics import ListAPIView, ListCreateAPIView, RetrieveUpdateAPIView
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

# 1️⃣ IMPORT: Potrzebujemy Team i ensure_matches_generated do inicjalizacji turnieju
from ..models import Tournament, Team
from ..permissions import IsTournamentOrganizer
from ..serializers import TournamentSerializer
from ._helpers import user_can_manage_tournament
from tournaments.services.match_generation import ensure_matches_generated


# =========================
# HELPERY MODEL-LOOKUP
# =========================
def get_model_any(app_label: str, names: list[str]):
    for n in names:
        try:
            return apps.get_model(app_label, n)
        except LookupError:
            continue
    raise LookupError(f"Nie znaleziono żadnego modelu z listy: {names}")


class TournamentListView(ListCreateAPIView):
    queryset = Tournament.objects.all()
    serializer_class = TournamentSerializer
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def perform_create(self, serializer):
        # 1. Zapis turnieju
        tournament = serializer.save(organizer=self.request.user)

        # 2. Utworzenie 2 domyślnych uczestników (minimalna wymagana liczba)
        name_prefix = (
            "Zawodnik"
            if tournament.competition_type == Tournament.CompetitionType.INDIVIDUAL
            else "Drużyna"
        )

        Team.objects.bulk_create(
            [
                Team(tournament=tournament, name=f"{name_prefix} 1", is_active=True),
                Team(tournament=tournament, name=f"{name_prefix} 2", is_active=True),
            ]
        )

        # 3. Pierwsze generowanie meczów (dla tych 2 uczestników)
        ensure_matches_generated(tournament)

        # 4. Aktualizacja statusu na CONFIGURED (bo mamy już strukturę)
        tournament.status = Tournament.Status.CONFIGURED
        tournament.save(update_fields=["status"])


class MyTournamentListView(ListAPIView):
    serializer_class = TournamentSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        return Tournament.objects.filter(organizer=user).union(
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


# ==========================================================
# ZMIANA DYSCYPLINY
# - TEAM->TEAM: wyniki out, konfiguracja + nazwy zostają
# - TEAM<->INDIVIDUAL: FULL RESET (usuń wszystko, odbuduj uczestników)
# ==========================================================

class ChangeDisciplineSerializer(serializers.Serializer):
    discipline = serializers.ChoiceField(choices=Tournament.Discipline.choices, required=True)


class ChangeDisciplineView(APIView):
    """
    TEAM -> TEAM (np. football -> volleyball):
      - czyści wyniki meczów + standings
      - zostawia konfigurację i nazwy drużyn

    TEAM <-> INDIVIDUAL (np. football -> tennis):
      - FULL RESET: usuwa rozgrywki i uczestników (nazwy),
        resetuje konfigurację, ustawia DRAFT i tworzy nowych uczestników
    """
    permission_classes = [IsAuthenticated, IsTournamentOrganizer]

    @transaction.atomic
    def post(self, request, pk):
        tournament = get_object_or_404(Tournament, pk=pk)
        self.check_object_permissions(request, tournament)

        serializer = ChangeDisciplineSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        new_discipline = serializer.validated_data["discipline"]
        old_discipline = tournament.discipline

        if new_discipline == old_discipline:
            return Response({"detail": "Dyscyplina nie uległa zmianie."}, status=status.HTTP_200_OK)

        # Sprawdź dozwolone formaty
        allowed_formats = Tournament.allowed_formats_for_discipline(new_discipline)
        if tournament.tournament_format and tournament.tournament_format not in allowed_formats:
            return Response(
                {
                    "detail": (
                        "Zmiana dyscypliny wymaga większego resetu, ponieważ aktualny format "
                        "turnieju nie jest dostępny dla nowej dyscypliny. "
                        "Należy ponownie skonfigurować format i wygenerować rozgrywki."
                    ),
                    "reset_level": "FORMAT_INCOMPATIBLE",
                    "next_step": "setup",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Typ rozgrywki zależny od dyscypliny
        new_comp_type = Tournament.infer_default_competition_type(new_discipline)
        old_comp_type = tournament.competition_type
        comp_type_changed = new_comp_type != old_comp_type

        Match = get_model_any("tournaments", ["Match"])
        Stage = get_model_any("tournaments", ["Stage"])
        Team = get_model_any("tournaments", ["Team"])

        # ------------------------------------------------------
        # FULL RESET, gdy zmienia się TEAM <-> INDIVIDUAL
        # ------------------------------------------------------
        if comp_type_changed:
            # usuń rozgrywki
            Match.objects.filter(tournament=tournament).delete()
            Stage.objects.filter(tournament=tournament).delete()

            # usuń uczestników => usuwasz nazwy
            Team.objects.filter(tournament=tournament).delete()

            # reset konfiguracji
            tournament.discipline = new_discipline
            tournament.competition_type = new_comp_type
            tournament.tournament_format = Tournament.TournamentFormat.LEAGUE
            tournament.format_config = {}
            tournament.status = Tournament.Status.DRAFT

            tournament.save(
                update_fields=[
                    "discipline",
                    "competition_type",
                    "tournament_format",
                    "format_config",
                    "status",
                ]
            )

            # odbuduj uczestników z prefiksem (domyślne 2 drużyny)
            name_prefix = "Zawodnik" if new_comp_type == Tournament.CompetitionType.INDIVIDUAL else "Drużyna"

            Team.objects.bulk_create(
                [
                    Team(tournament=tournament, name=f"{name_prefix} {i}", is_active=True)
                    for i in range(1, 3)
                ]
            )

            return Response(
                {
                    "detail": (
                        "Zmieniono dyscyplinę. Ponieważ zmienił się typ rozgrywki (drużynowy/indywidualny), "
                        "turniej został zresetowany: usunięto etapy, mecze oraz listę uczestników (nazwy)."
                    ),
                    "reset_level": "FULL_RESET",
                    "next_step": "setup",
                },
                status=status.HTTP_200_OK,
            )

        # ------------------------------------------------------
        # Minimalny reset (wyniki out), gdy typ się nie zmienia
        # ------------------------------------------------------
        tournament.discipline = new_discipline
        tournament.competition_type = new_comp_type  # spójność, nawet jeśli bez zmiany

        Match.objects.filter(tournament=tournament).update(
            home_score=0,
            away_score=0,
            winner=None,
            status=Match.Status.SCHEDULED,
            result_entered=False,
        )

        # standings/cache
        for model_name in ("Standing", "LeagueStanding", "TeamStanding"):
            try:
                M = apps.get_model("tournaments", model_name)
                if "tournament" in [f.name for f in M._meta.fields]:
                    M.objects.filter(tournament=tournament).delete()
            except LookupError:
                pass

        if tournament.status == Tournament.Status.FINISHED:
            tournament.status = Tournament.Status.CONFIGURED

        tournament.save(update_fields=["discipline", "competition_type", "status"])

        return Response(
            {
                "detail": "Zmieniono dyscyplinę. Wyniki oraz dane pochodne zostały wyczyszczone.",
                "reset_level": "RESULTS_ONLY",
                "next_step": "results",
            },
            status=status.HTTP_200_OK,
        )


# ==========================================================
# ZMIANA SETUP (format/config) – reset rozgrywek, drużyny zostają
# ==========================================================

class ChangeSetupSerializer(serializers.Serializer):
    tournament_format = serializers.ChoiceField(choices=Tournament.TournamentFormat.choices)
    format_config = serializers.JSONField(required=False)

    def validate(self, attrs):
        tournament: Tournament = self.context["tournament"]

        allowed_formats = Tournament.allowed_formats_for_discipline(tournament.discipline)
        if attrs["tournament_format"] not in allowed_formats:
            raise serializers.ValidationError(
                {"tournament_format": "Wybrany format nie jest dostępny dla tej dyscypliny."}
            )
        return attrs


class ChangeSetupView(APIView):
    """
    Zmiana konfiguracji turnieju (FORMAT + FORMAT_CONFIG).

    Zasady:
    - NIE dotyka liczby uczestników
    - jeśli istnieją etapy/mecze → reset (Stage/Match)
    - uczestnicy (Team) ZOSTAJĄ
    - obsługuje dry_run=true
    """
    permission_classes = [IsAuthenticated, IsTournamentOrganizer]

    @transaction.atomic
    def post(self, request, pk):
        tournament = get_object_or_404(Tournament, pk=pk)
        self.check_object_permissions(request, tournament)

        serializer = ChangeSetupSerializer(
            data=request.data,
            context={"tournament": tournament},
        )
        serializer.is_valid(raise_exception=True)

        new_format = serializer.validated_data["tournament_format"]
        new_cfg = serializer.validated_data.get("format_config") or {}

        dry_run = str(request.query_params.get("dry_run", "")).lower() in ("1", "true", "yes")

        changed = (
            tournament.tournament_format != new_format
            or (tournament.format_config or {}) != new_cfg
        )

        # --------------------------------------------
        # Czy istnieją rozgrywki do resetu?
        # --------------------------------------------
        reset_needed = False

        try:
            StageModel = get_model_any("tournaments", ["Stage"])
            reset_needed = StageModel.objects.filter(tournament=tournament).exists()
        except LookupError:
            pass

        if not reset_needed:
            try:
                MatchModel = get_model_any("tournaments", ["Match"])
                reset_needed = MatchModel.objects.filter(tournament=tournament).exists()
            except LookupError:
                pass

        # --------------------------------------------
        # DRY RUN
        # --------------------------------------------
        if dry_run:
            return Response(
                {
                    "changed": changed,
                    "reset_needed": bool(reset_needed and changed),
                    "detail": "Sprawdzenie zakończone.",
                },
                status=status.HTTP_200_OK,
            )

        reset_performed = False

        # --------------------------------------------
        # RESET ROZGRYWEK (jeśli trzeba)
        # --------------------------------------------
        if changed and reset_needed:
            try:
                StageModel = get_model_any("tournaments", ["Stage"])
                StageModel.objects.filter(tournament=tournament).delete()
                reset_performed = True
            except LookupError:
                try:
                    MatchModel = get_model_any("tournaments", ["Match"])
                    MatchModel.objects.filter(tournament=tournament).delete()
                    reset_performed = True
                except LookupError:
                    pass

            # standings / cache
            for model_name in ("Standing", "LeagueStanding", "TeamStanding"):
                try:
                    M = apps.get_model("tournaments", model_name)
                    if any(f.name == "tournament" for f in M._meta.fields):
                        M.objects.filter(tournament=tournament).delete()
                except LookupError:
                    pass

        # --------------------------------------------
        # ZAPIS SETUPU
        # --------------------------------------------
        if changed:
            tournament.tournament_format = new_format
            tournament.format_config = new_cfg

            if tournament.status == Tournament.Status.FINISHED:
                tournament.status = Tournament.Status.CONFIGURED
            elif reset_performed:
                tournament.status = Tournament.Status.DRAFT

            tournament.save(
                update_fields=["tournament_format", "format_config", "status"]
            )

        return Response(
            {
                "detail": "Konfiguracja zapisana.",
                "changed": changed,
                "reset_performed": reset_performed,
                "next_step": "teams",
            },
            status=status.HTTP_200_OK,
        )