# backend/tournaments/views/tournaments.py
# Plik udostępnia widoki listy, szczegółów i zmian konfiguracji turnieju.

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

from tournaments.access import (
    can_edit_tournament_detail,
    get_membership,
    participant_can_view_public_preview,
    user_is_organizer,
    user_is_registered_participant,
)
from tournaments.models import Team, Tournament
from tournaments.permissions import IsTournamentOrganizer
from tournaments.serializers import TournamentSerializer, TournamentMetaUpdateSerializer
from tournaments.services.match_generation import ensure_matches_generated


def get_model_any(app_label: str, names: list[str]):
    for name in names:
        try:
            return apps.get_model(app_label, name)
        except LookupError:
            continue
    raise LookupError(f"Nie znaleziono żadnego modelu z listy: {names}")


TENIS_POINTS_MODES = ("NONE", "PLT")


def normalize_format_config(discipline: str | None, cfg: dict | None) -> dict:
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
    disc = (discipline or "").lower()
    cfg = dict(cfg or {})
    if disc == "tennis":
        cfg.pop("tennis_points_mode", None)
    return cfg


def clear_standings_cache(tournament: Tournament) -> None:
    for model_name in ("Standing", "LeagueStanding", "TeamStanding"):
        try:
            model = apps.get_model("tournaments", model_name)
        except LookupError:
            continue

        if any(field.name == "tournament" for field in model._meta.fields):
            model.objects.filter(tournament=tournament).delete()


class TournamentListView(ListCreateAPIView):
    queryset = Tournament.objects.all()
    serializer_class = TournamentSerializer
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def perform_create(self, serializer):
        tournament: Tournament = serializer.save(organizer=self.request.user)

        # Normalizacja ma domknąć domyślne pola konfiguracyjne.
        tournament.format_config = normalize_format_config(tournament.discipline, tournament.format_config or {})
        tournament.save(update_fields=["format_config"])

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
        return (
            Tournament.objects.filter(
                Q(organizer=user)
                | Q(memberships__user=user)
                | Q(registrations__user=user)
            )
            .distinct()
            .order_by("-created_at")
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
        serializer = self.get_serializer(tournament, context={"request": request})

        if user_is_organizer(user, tournament):
            return Response(serializer.data)

        if get_membership(user, tournament):
            return Response(serializer.data)

        if user_is_registered_participant(user, tournament):
            if participant_can_view_public_preview(tournament):
                return Response(serializer.data)
            raise PermissionDenied("Podgląd dla uczestników jest wyłączony. Poczekaj na publikację turnieju.")

        if tournament.is_published:
            if tournament.access_code:
                provided_code = request.query_params.get("code")
                if provided_code != tournament.access_code:
                    raise PermissionDenied("Nieprawidłowy kod dostępu.")
            return Response(serializer.data)

        raise PermissionDenied("Brak dostępu do tego turnieju.")


class TournamentMetaUpdateView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk: int, *args, **kwargs):
        tournament = get_object_or_404(Tournament, pk=pk)

        if not can_edit_tournament_detail(request.user, tournament):
            return Response({"detail": "Brak uprawnień."}, status=status.HTTP_403_FORBIDDEN)

        serializer = TournamentMetaUpdateSerializer(
            tournament,
            data=request.data,
            partial=True,
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()

        return Response(TournamentSerializer(tournament, context={"request": request}).data)


class ArchiveTournamentView(APIView):
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
    permission_classes = [IsAuthenticated, IsTournamentOrganizer]

    def post(self, request, pk):
        tournament = get_object_or_404(Tournament, pk=pk)
        self.check_object_permissions(request, tournament)

        if tournament.status != Tournament.Status.FINISHED:
            return Response({"detail": "Turniej nie znajduje się w archiwum."}, status=status.HTTP_400_BAD_REQUEST)

        tournament.status = Tournament.Status.CONFIGURED
        tournament.save(update_fields=["status"])
        return Response({"detail": "Turniej został przywrócony z archiwum."}, status=status.HTTP_200_OK)


class ChangeDisciplineSerializer(serializers.Serializer):
    discipline = serializers.ChoiceField(choices=Tournament.Discipline.choices, required=True)


class ChangeDisciplineView(APIView):
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

        match_model = get_model_any("tournaments", ["Match"])
        stage_model = get_model_any("tournaments", ["Stage"])
        team_model = get_model_any("tournaments", ["Team"])

        if comp_type_changed:
            match_model.objects.filter(tournament=tournament).delete()
            stage_model.objects.filter(tournament=tournament).delete()
            team_model.objects.filter(tournament=tournament).delete()

            tournament.discipline = new_discipline
            tournament.competition_type = new_comp_type
            tournament.tournament_format = Tournament.TournamentFormat.LEAGUE
            tournament.format_config = normalize_format_config(new_discipline, {})
            tournament.status = Tournament.Status.DRAFT
            tournament.save(update_fields=["discipline", "competition_type", "tournament_format", "format_config", "status"])

            name_prefix = "Zawodnik" if new_comp_type == Tournament.CompetitionType.INDIVIDUAL else "Drużyna"
            team_model.objects.bulk_create(
                [team_model(tournament=tournament, name=f"{name_prefix} {i}", is_active=True) for i in range(1, 3)]
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

        tournament.discipline = new_discipline
        tournament.competition_type = new_comp_type
        tournament.format_config = normalize_format_config(new_discipline, tournament.format_config or {})

        match_model.objects.filter(tournament=tournament).update(
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
            status=match_model.Status.SCHEDULED,
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

        stage_model = get_model_any("tournaments", ["Stage"])
        match_model = get_model_any("tournaments", ["Match"])

        reset_needed = stage_model.objects.filter(tournament=tournament).exists() or match_model.objects.filter(tournament=tournament).exists()

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
            stage_model.objects.filter(tournament=tournament).delete()
            match_model.objects.filter(tournament=tournament).delete()
            reset_performed = True
            clear_standings_cache(tournament)

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