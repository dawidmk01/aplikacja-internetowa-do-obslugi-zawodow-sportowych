from __future__ import annotations

from django.apps import apps
from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404

from rest_framework import serializers, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.generics import ListAPIView, ListCreateAPIView, RetrieveUpdateAPIView
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from tournaments.models import Team, Tournament, TournamentMembership, TournamentRegistration
from tournaments.permissions import IsTournamentOrganizer
from tournaments.serializers import TournamentSerializer, TournamentMetaUpdateSerializer
from tournaments.services.match_generation import ensure_matches_generated
from tournaments.views._helpers import user_can_manage_tournament


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


# =========================
# TENIS: dwa systemy punktacji
# =========================
TENIS_POINTS_MODES = ("NONE", "PLT")


def normalize_format_config(discipline: str | None, cfg: dict | None) -> dict:
    """
    Ujednolica format_config:
    - zawsze dict
    - dla tenisa: gwarantuje tennis_points_mode ∈ {NONE, PLT} (domyślnie NONE)
    - dla innych dyscyplin: usuwa tennis_points_mode
    """
    disc = (discipline or "").lower()

    if cfg is None:
        cfg = {}
    if not isinstance(cfg, dict):
        raise serializers.ValidationError({"format_config": "format_config musi być obiektem JSON (dict)."})
    cfg = dict(cfg)

    if disc == "tennis":
        mode = cfg.get("tennis_points_mode") or "NONE"
        if mode not in TENIS_POINTS_MODES:
            raise serializers.ValidationError(
                {"format_config": {"tennis_points_mode": f"Dozwolone: {', '.join(TENIS_POINTS_MODES)}"}}
            )
        cfg["tennis_points_mode"] = mode
    else:
        cfg.pop("tennis_points_mode", None)

    return cfg


def strip_standings_only_keys(discipline: str | None, cfg: dict | None) -> dict:
    """
    Zwraca config bez kluczy wpływających WYŁĄCZNIE na standings (bez resetu Stage/Match).
    Aktualnie: tennis_points_mode.
    """
    disc = (discipline or "").lower()
    cfg = dict(cfg or {})
    if disc == "tennis":
        cfg.pop("tennis_points_mode", None)
    return cfg


def clear_standings_cache(tournament: Tournament) -> None:
    """
    Czyści cache tabel (jeśli takie modele istnieją w projekcie).
    Bezpieczne: ignoruje brak modeli.
    """
    for model_name in ("Standing", "LeagueStanding", "TeamStanding"):
        try:
            M = apps.get_model("tournaments", model_name)
        except LookupError:
            continue

        if any(f.name == "tournament" for f in M._meta.fields):
            M.objects.filter(tournament=tournament).delete()


# =========================
# LIST / CREATE
# =========================
class TournamentListView(ListCreateAPIView):
    queryset = Tournament.objects.all()
    serializer_class = TournamentSerializer
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def perform_create(self, serializer):
        tournament: Tournament = serializer.save(organizer=self.request.user)

        # Normalizacja format_config (ważne dla tenisa: tennis_points_mode default)
        tournament.format_config = normalize_format_config(tournament.discipline, tournament.format_config or {})
        tournament.save(update_fields=["format_config"])

        # 2 domyślnych uczestników
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

        ensure_matches_generated(tournament)

        tournament.status = Tournament.Status.CONFIGURED
        tournament.save(update_fields=["status"])


class MyTournamentListView(ListAPIView):
    serializer_class = TournamentSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        # ZMIANA: Użycie Q i distinct() zamiast union(), obsługa registrations
        return (
            Tournament.objects.filter(
                Q(organizer=user)
                | Q(memberships__user=user)
                | Q(registrations__user=user)
            )
            .distinct()
            .order_by("-created_at")
        )


# =========================
# DETAIL
# =========================
class TournamentDetailView(RetrieveUpdateAPIView):
    queryset = Tournament.objects.all()
    serializer_class = TournamentSerializer

    def get_permissions(self):
        if self.request.method in ("GET", "HEAD", "OPTIONS"):
            return [AllowAny()]
        return [IsAuthenticated(), IsTournamentOrganizer()]

    def retrieve(self, request, *args, **kwargs):
        tournament = self.get_object()

        serializer = self.get_serializer(tournament, context={"request": request})

        # 1) Organizator lub asystent (w trybie MANAGER) -> pełny dostęp jak dotychczas
        if request.user.is_authenticated and user_can_manage_tournament(request.user, tournament):
            return Response(serializer.data)

        # 2) Asystent (membership) -> PODGLĄD, nawet gdy entry_mode blokuje panel
        is_member = (
            request.user.is_authenticated
            and TournamentMembership.objects.filter(tournament=tournament, user=request.user).exists()
        )
        if is_member:
            return Response(serializer.data)

        # 3) Zarejestrowany uczestnik -> podgląd
        if request.user.is_authenticated and TournamentRegistration.objects.filter(
            tournament=tournament, user=request.user
        ).exists():
            return Response(serializer.data)

        # 4) Public (opublikowany + ewentualny kod)
        if tournament.is_published:
            if tournament.access_code:
                provided_code = request.query_params.get("code")
                if provided_code != tournament.access_code:
                    raise PermissionDenied("Nieprawidłowy kod dostępu.")
            return Response(serializer.data)

        raise PermissionDenied("Brak dostępu do tego turnieju.")


# =========================
# META (SCHEDULE + DESCRIPTION)
# =========================
class TournamentMetaUpdateView(APIView):
    """
    Edycja metadanych turnieju (harmonogram + opis) bez otwierania pełnego PATCH.

    Endpoint:
      PATCH /api/tournaments/<id>/meta/

    Uprawnienia:
    - organizator LUB asystent (user_can_manage_tournament)

    Obsługiwane pola:
    - start_date, end_date, location, description
    """

    permission_classes = [IsAuthenticated]

    def patch(self, request, pk: int, *args, **kwargs):
        tournament = get_object_or_404(Tournament, pk=pk)

        if not user_can_manage_tournament(request.user, tournament):
            return Response({"detail": "Brak uprawnień."}, status=status.HTTP_403_FORBIDDEN)

        serializer = TournamentMetaUpdateSerializer(
            tournament,
            data=request.data,
            partial=True,
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()

        # Zwracamy pełny widok turnieju (spójny z resztą UI)
        return Response(TournamentSerializer(tournament, context={"request": request}).data)


# =========================
# ARCHIVE / UNARCHIVE
# =========================
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


# =========================
# CHANGE DISCIPLINE
# =========================
class ChangeDisciplineSerializer(serializers.Serializer):
    discipline = serializers.ChoiceField(choices=Tournament.Discipline.choices, required=True)


class ChangeDisciplineView(APIView):
    """
    TEAM -> TEAM:
      - czyści wyniki + standings
      - zostawia konfigurację i nazwy

    TEAM <-> INDIVIDUAL:
      - FULL RESET: usuwa etapy/mecze/uczestników i resetuje setup.
    """
    permission_classes = [IsAuthenticated, IsTournamentOrganizer]

    @transaction.atomic
    def post(self, request, pk):
        tournament: Tournament = get_object_or_404(Tournament, pk=pk)
        self.check_object_permissions(request, tournament)

        serializer = ChangeDisciplineSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        new_discipline = serializer.validated_data["discipline"]
        old_discipline = tournament.discipline

        if new_discipline == old_discipline:
            return Response({"detail": "Dyscyplina nie uległa zmianie."}, status=status.HTTP_200_OK)

        allowed_formats = Tournament.allowed_formats_for_discipline(new_discipline)
        if tournament.tournament_format and tournament.tournament_format not in allowed_formats:
            return Response(
                {
                    "detail": (
                        "Zmiana dyscypliny wymaga większego resetu, ponieważ aktualny format "
                        "nie jest dostępny dla nowej dyscypliny."
                    ),
                    "reset_level": "FORMAT_INCOMPATIBLE",
                    "next_step": "setup",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        new_comp_type = Tournament.infer_default_competition_type(new_discipline)
        comp_type_changed = new_comp_type != tournament.competition_type

        MatchModel = get_model_any("tournaments", ["Match"])
        StageModel = get_model_any("tournaments", ["Stage"])
        TeamModel = get_model_any("tournaments", ["Team"])

        if comp_type_changed:
            MatchModel.objects.filter(tournament=tournament).delete()
            StageModel.objects.filter(tournament=tournament).delete()
            TeamModel.objects.filter(tournament=tournament).delete()

            tournament.discipline = new_discipline
            tournament.competition_type = new_comp_type
            tournament.tournament_format = Tournament.TournamentFormat.LEAGUE
            tournament.format_config = normalize_format_config(new_discipline, {})
            tournament.status = Tournament.Status.DRAFT
            tournament.save(update_fields=["discipline", "competition_type", "tournament_format", "format_config", "status"])

            name_prefix = "Zawodnik" if new_comp_type == Tournament.CompetitionType.INDIVIDUAL else "Drużyna"
            TeamModel.objects.bulk_create(
                [TeamModel(tournament=tournament, name=f"{name_prefix} {i}", is_active=True) for i in range(1, 3)]
            )

            return Response(
                {
                    "detail": (
                        "Zmieniono dyscyplinę. Ponieważ zmienił się typ rozgrywki "
                        "(drużynowy/indywidualny), wykonano pełny reset."
                    ),
                    "reset_level": "FULL_RESET",
                    "next_step": "setup",
                },
                status=status.HTTP_200_OK,
            )

        # minimalny reset (wyniki out), typ bez zmiany
        tournament.discipline = new_discipline
        tournament.competition_type = new_comp_type
        tournament.format_config = normalize_format_config(new_discipline, tournament.format_config or {})

        # defensywnie czyścimy pola „specyficzne”
        MatchModel.objects.filter(tournament=tournament).update(
            home_score=0,
            away_score=0,
            tennis_sets=None,
            went_to_extra_time=False,
            home_extra_time_score=None,
            away_extra_time_score=None,
            decided_by_penalties=False,
            home_penalty_score=None,
            away_penalty_score=None,
            winner=None,
            status=MatchModel.Status.SCHEDULED,
            result_entered=False,
        )

        clear_standings_cache(tournament)

        if tournament.status == Tournament.Status.FINISHED:
            tournament.status = Tournament.Status.CONFIGURED

        tournament.save(update_fields=["discipline", "competition_type", "format_config", "status"])

        return Response(
            {
                "detail": "Zmieniono dyscyplinę. Wyniki oraz dane pochodne zostały wyczyszczone.",
                "reset_level": "RESULTS_ONLY",
                "next_step": "results",
            },
            status=status.HTTP_200_OK,
        )


# =========================
# CHANGE SETUP
# =========================
class ChangeSetupSerializer(serializers.Serializer):
    tournament_format = serializers.ChoiceField(choices=Tournament.TournamentFormat.choices)
    format_config = serializers.JSONField(required=False)

    def validate(self, attrs):
        tournament: Tournament = self.context["tournament"]

        allowed_formats = Tournament.allowed_formats_for_discipline(tournament.discipline)
        if attrs["tournament_format"] not in allowed_formats:
            raise serializers.ValidationError({"tournament_format": "Wybrany format nie jest dostępny dla tej dyscypliny."})

        attrs["format_config"] = normalize_format_config(
            tournament.discipline,
            attrs.get("format_config") or {},
        )
        return attrs


class ChangeSetupView(APIView):
    """
    - zmiana FORMAT lub struktury config -> reset Stage/Match
    - zmiana tennis_points_mode (tenis) -> bez resetu Stage/Match, tylko czyszczenie cache standings
    - dry_run=true zwraca requires_reset / reset_needed
    """
    permission_classes = [IsAuthenticated, IsTournamentOrganizer]

    @transaction.atomic
    def post(self, request, pk):
        tournament: Tournament = get_object_or_404(Tournament, pk=pk)
        self.check_object_permissions(request, tournament)

        serializer = ChangeSetupSerializer(data=request.data, context={"tournament": tournament})
        serializer.is_valid(raise_exception=True)

        new_format = serializer.validated_data["tournament_format"]
        new_cfg = serializer.validated_data.get("format_config") or {}

        dry_run = str(request.query_params.get("dry_run", "")).lower() in ("1", "true", "yes")

        old_cfg = normalize_format_config(tournament.discipline, tournament.format_config or {})
        new_cfg = normalize_format_config(tournament.discipline, new_cfg)

        fmt_changed = tournament.tournament_format != new_format
        cfg_changed = old_cfg != new_cfg
        changed = fmt_changed or cfg_changed

        old_struct = strip_standings_only_keys(tournament.discipline, old_cfg)
        new_struct = strip_standings_only_keys(tournament.discipline, new_cfg)
        structure_changed = old_struct != new_struct

        requires_reset = fmt_changed or structure_changed

        StageModel = get_model_any("tournaments", ["Stage"])
        MatchModel = get_model_any("tournaments", ["Match"])

        reset_needed = StageModel.objects.filter(tournament=tournament).exists() or MatchModel.objects.filter(tournament=tournament).exists()

        if dry_run:
            return Response(
                {
                    "changed": changed,
                    "requires_reset": bool(requires_reset and changed),
                    "reset_needed": bool(reset_needed and requires_reset and changed),
                    "detail": "Sprawdzenie zakończone.",
                },
                status=status.HTTP_200_OK,
            )

        reset_performed = False

        if changed and requires_reset and reset_needed:
            StageModel.objects.filter(tournament=tournament).delete()
            MatchModel.objects.filter(tournament=tournament).delete()
            reset_performed = True
            clear_standings_cache(tournament)

        # jeśli nie resetujemy, ale zmienił się cfg (np. tennis_points_mode) -> czyścimy cache tabel
        if changed and (not reset_performed) and cfg_changed:
            clear_standings_cache(tournament)

        if changed:
            tournament.tournament_format = new_format
            tournament.format_config = new_cfg

            if tournament.status == Tournament.Status.FINISHED:
                tournament.status = Tournament.Status.CONFIGURED
            elif reset_performed:
                tournament.status = Tournament.Status.DRAFT

            tournament.save(update_fields=["tournament_format", "format_config", "status"])

        return Response(
            {
                "detail": "Konfiguracja zapisana.",
                "changed": changed,
                "requires_reset": bool(requires_reset and changed),
                "reset_performed": reset_performed,
                "next_step": "teams",
            },
            status=status.HTTP_200_OK,
        )
