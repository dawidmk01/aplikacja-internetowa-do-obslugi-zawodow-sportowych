# backend/tournaments/views/tournaments.py
# Plik udostępnia widoki listy, szczegółów i zmian konfiguracji turnieju z obsługą aktywnej dywizji.

from __future__ import annotations

import re

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
from tournaments.models import Division, Stage, StageMassStartEntry, StageMassStartResult, Team, Tournament, TournamentMembership
from tournaments.permissions import IsTournamentOrganizer
from tournaments.serializers import TournamentMetaUpdateSerializer, TournamentSerializer
from tournaments.services.match_generation import ensure_matches_generated


TENIS_POINTS_MODES = ("NONE", "PLT")


def get_model_any(app_label: str, names: list[str]):
    for name in names:
        try:
            return apps.get_model(app_label, name)
        except LookupError:
            continue
    raise LookupError(f"Nie znaleziono żadnego modelu z listy: {names}")


def _resolve_division_from_request(request, tournament: Tournament) -> Division | None:
    raw_id = (
        request.query_params.get("division_id")
        or request.query_params.get("active_division_id")
        or request.query_params.get("division")
    )
    raw_slug = (
        request.query_params.get("division_slug")
        or request.query_params.get("active_division_slug")
    )

    divisions_qs = tournament.divisions.all().order_by("order", "id")

    if raw_id:
        try:
            division_id = int(raw_id)
        except (TypeError, ValueError):
            return None
        return divisions_qs.filter(pk=division_id).first()

    if raw_slug:
        return divisions_qs.filter(slug=str(raw_slug).strip()).first()

    return tournament.get_default_division()


def normalize_format_config(discipline: str | None, cfg: dict | None) -> dict:
    disc = (discipline or "").lower()

    if cfg is None:
        cfg = {}
    if not isinstance(cfg, dict):
        raise serializers.ValidationError(
            {"format_config": "format_config musi być obiektem JSON (dict)."}
        )

    cfg = dict(cfg)

    if disc == Tournament.Discipline.TENNIS:
        mode = str(cfg.get("tennis_points_mode") or "NONE").upper()
        if mode not in TENIS_POINTS_MODES:
            raise serializers.ValidationError(
                {
                    "format_config": {
                        "tennis_points_mode": f"Dozwolone: {', '.join(TENIS_POINTS_MODES)}"
                    }
                }
            )
        cfg["tennis_points_mode"] = mode
    else:
        cfg.pop("tennis_points_mode", None)

    return cfg


def normalize_result_config(result_mode: str | None, cfg: dict | None) -> dict:
    try:
        return Tournament.normalize_result_config(result_mode, cfg)
    except ValueError as exc:
        raise serializers.ValidationError({"result_config": str(exc)}) from exc


def strip_standings_only_keys(discipline: str | None, cfg: dict | None) -> dict:
    disc = (discipline or "").lower()
    cfg = dict(cfg or {})

    if disc == Tournament.Discipline.TENNIS:
        cfg.pop("tennis_points_mode", None)

    return cfg


def clear_standings_cache(
    tournament: Tournament,
    *,
    division: Division | None = None,
) -> None:
    for model_name in ("Standing", "LeagueStanding", "TeamStanding"):
        try:
            model = apps.get_model("tournaments", model_name)
        except LookupError:
            continue

        field_names = {field.name for field in model._meta.fields}
        filters: dict = {}

        if "tournament" in field_names:
            filters["tournament"] = tournament
        elif "stage" in field_names:
            filters["stage__tournament"] = tournament
        else:
            continue

        # Jeżeli model klasyfikacji wspiera dywizje, czyszczenie pozostaje lokalne dla aktywnej dywizji.
        if division is not None:
            if "division" in field_names:
                filters["division"] = division
            elif "stage" in field_names:
                filters["stage__division"] = division

        model.objects.filter(**filters).delete()


def reset_match_results(match_model, tournament: Tournament, *, division: Division | None = None) -> None:
    qs = match_model.objects.filter(tournament=tournament)
    if division is not None:
        qs = qs.filter(stage__division=division)

    qs.update(
        home_score=0,
        away_score=0,
        tennis_sets=None,
        tennis_state=None,
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


def get_default_slot_prefix_for_competition_type(competition_type: str | None) -> str:
    if competition_type == Tournament.CompetitionType.INDIVIDUAL:
        return "Zawodnik"
    return "Drużyna"


def rename_default_team_names_for_division_competition_type_change(
    tournament: Tournament,
    division: Division,
    previous_competition_type: str | None,
) -> None:
    previous_prefix = get_default_slot_prefix_for_competition_type(previous_competition_type)
    current_prefix = get_default_slot_prefix_for_competition_type(division.competition_type)

    if previous_prefix == current_prefix:
        return

    pattern = re.compile(rf"^{re.escape(previous_prefix)}\s+(\d+)$", re.IGNORECASE)
    team_model = get_model_any("tournaments", ["Team"])

    to_update = []
    for team in team_model.objects.filter(tournament=tournament, division=division).order_by("id"):
        normalized_name = str(team.name or "").strip()
        match = pattern.match(normalized_name)
        if not match:
            continue

        team.name = f"{current_prefix} {int(match.group(1))}"
        to_update.append(team)

    if to_update:
        team_model.objects.bulk_update(to_update, ["name"])


def _stage_name_for_mass_start(index: int, cfg: dict) -> str:
    raw_name = str(cfg.get(Tournament.RESULTCFG_STAGE_NAME_KEY) or "").strip()
    if raw_name:
        return raw_name

    defaults = {1: "Kwalifikacje", 2: "Półfinał", 3: "Finał"}
    return defaults.get(index, f"Etap {index}")


def _group_name_for_index(index: int) -> str:
    return f"Grupa {index}"


def _default_mass_start_stage_status(index: int) -> str:
    return Stage.Status.OPEN if index == 1 else Stage.Status.PLANNED


def _sync_mass_start_stage_entries(
    tournament: Tournament,
    division: Division,
    stage,
    groups: list,
    cfg: dict,
) -> None:
    if stage.order != 1:
        return

    stage_has_progress = (
        stage.status != Stage.Status.OPEN
        or StageMassStartResult.objects.filter(stage=stage, is_active=True).exists()
    )
    if stage_has_progress:
        return

    active_team_ids = list(
        Team.objects.filter(tournament=tournament, division=division, is_active=True)
        .order_by("id")
        .values_list("id", flat=True)
    )

    participants_count_raw = cfg.get(Tournament.RESULTCFG_STAGE_PARTICIPANTS_COUNT_KEY)
    participants_count = int(participants_count_raw) if participants_count_raw else None
    selected_team_ids = active_team_ids[:participants_count] if participants_count else active_team_ids

    target_groups = groups[:]
    if not target_groups:
        StageMassStartEntry.objects.filter(stage=stage).delete()
        return

    if len(target_groups) == 1:
        assignment = {team_id: target_groups[0].id for team_id in selected_team_ids}
    else:
        count = len(target_groups)
        base = len(selected_team_ids) // count
        extra = len(selected_team_ids) % count
        assignment: dict[int, int] = {}
        cursor = 0

        for index, group in enumerate(target_groups):
            size = base + (1 if index < extra else 0)
            for team_id in selected_team_ids[cursor : cursor + size]:
                assignment[team_id] = group.id
            cursor += size

    existing_entries = {
        entry.team_id: entry
        for entry in StageMassStartEntry.objects.filter(stage=stage).order_by("id")
    }
    keep_entry_ids: list[int] = []

    for seed, team_id in enumerate(selected_team_ids, start=1):
        group_id = assignment.get(team_id)
        entry = existing_entries.get(team_id)

        if entry is None:
            entry = StageMassStartEntry(
                stage=stage,
                team_id=team_id,
                group_id=group_id,
                seed=seed,
                is_active=True,
            )
        else:
            entry.group_id = group_id
            entry.seed = seed
            entry.is_active = True

        entry.save()
        keep_entry_ids.append(entry.id)

    StageMassStartEntry.objects.filter(stage=stage).exclude(id__in=keep_entry_ids).delete()


def sync_custom_mass_start_structure_for_division(tournament: Tournament, division: Division) -> None:
    stage_model = get_model_any("tournaments", ["Stage"])
    group_model = get_model_any("tournaments", ["Group"])
    match_model = get_model_any("tournaments", ["Match"])

    is_custom_mass_start = (
        tournament.discipline == Tournament.Discipline.CUSTOM
        and division.result_mode == Tournament.ResultMode.CUSTOM
        and division.competition_model == Tournament.CompetitionModel.MASS_START
    )

    existing_mass_stages = list(
        stage_model.objects.filter(
            tournament=tournament,
            division=division,
            stage_type=stage_model.StageType.MASS_START,
        ).order_by("order", "id")
    )

    if not is_custom_mass_start:
        if existing_mass_stages:
            match_model.objects.filter(tournament=tournament, stage__in=existing_mass_stages).delete()
            StageMassStartEntry.objects.filter(stage__in=existing_mass_stages).delete()
            stage_model.objects.filter(id__in=[stage.id for stage in existing_mass_stages]).delete()
        return

    stage_cfgs = list(division.get_mass_start_stages() or [])

    stale_stages = stage_model.objects.filter(tournament=tournament, division=division).exclude(
        stage_type=stage_model.StageType.MASS_START
    )
    if stale_stages.exists():
        match_model.objects.filter(tournament=tournament, stage__in=stale_stages).delete()
        stale_stages.delete()

    match_model.objects.filter(
        tournament=tournament,
        stage__division=division,
        stage__stage_type=stage_model.StageType.MASS_START,
    ).delete()

    active_stage_ids: list[int] = []

    for index, cfg in enumerate(stage_cfgs, start=1):
        stage = existing_mass_stages[index - 1] if index - 1 < len(existing_mass_stages) else None
        is_new_stage = stage is None

        if stage is None:
            stage = stage_model(
                tournament=tournament,
                division=division,
                stage_type=stage_model.StageType.MASS_START,
                order=index,
                status=_default_mass_start_stage_status(index),
            )

        stage.stage_type = stage_model.StageType.MASS_START
        stage.division = division
        stage.order = index

        if is_new_stage:
            stage.status = _default_mass_start_stage_status(index)

        if hasattr(stage, "name"):
            stage.name = _stage_name_for_mass_start(index, cfg)

        stage.save()
        active_stage_ids.append(stage.id)

        groups_count = int(cfg.get(Tournament.RESULTCFG_STAGE_GROUPS_COUNT_KEY) or 1)
        groups_count = max(1, groups_count)
        existing_groups = list(stage.groups.all().order_by("id"))
        keep_group_ids: list[int] = []
        stage_groups: list = []

        for group_index in range(1, groups_count + 1):
            group = existing_groups[group_index - 1] if group_index - 1 < len(existing_groups) else None
            group_name = _group_name_for_index(group_index)

            if group is None:
                group = group_model(stage=stage, name=group_name)
            else:
                group.name = group_name

            group.save()
            keep_group_ids.append(group.id)
            stage_groups.append(group)

        stage.groups.exclude(id__in=keep_group_ids).delete()

        _sync_mass_start_stage_entries(
            tournament=tournament,
            division=division,
            stage=stage,
            groups=stage_groups,
            cfg=cfg,
        )

    if active_stage_ids:
        stale_mass_stages = stage_model.objects.filter(
            tournament=tournament,
            division=division,
            stage_type=stage_model.StageType.MASS_START,
        ).exclude(id__in=active_stage_ids)
        if stale_mass_stages.exists():
            match_model.objects.filter(tournament=tournament, stage__in=stale_mass_stages).delete()
            StageMassStartEntry.objects.filter(stage__in=stale_mass_stages).delete()
            stale_mass_stages.delete()


def sync_custom_mass_start_structure(tournament: Tournament, *, division: Division | None = None) -> None:
    if division is not None:
        sync_custom_mass_start_structure_for_division(tournament, division)
        return

    for current_division in tournament.divisions.all().order_by("order", "id"):
        sync_custom_mass_start_structure_for_division(tournament, current_division)


class TournamentListView(ListCreateAPIView):
    queryset = Tournament.objects.all()
    serializer_class = TournamentSerializer
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def perform_create(self, serializer):
        tournament: Tournament = serializer.save(organizer=self.request.user)
        division = tournament.get_default_division()

        tournament.format_config = normalize_format_config(
            tournament.discipline,
            tournament.format_config or {},
        )
        tournament.result_config = normalize_result_config(
            tournament.result_mode,
            tournament.result_config,
        )
        tournament.save(update_fields=["format_config", "result_config"])

        competition_type = division.competition_type if division else tournament.competition_type
        name_prefix = get_default_slot_prefix_for_competition_type(competition_type)
        Team.objects.bulk_create(
            [
                Team(tournament=tournament, division=division, name=f"{name_prefix} 1", is_active=True),
                Team(tournament=tournament, division=division, name=f"{name_prefix} 2", is_active=True),
            ]
        )

        sync_custom_mass_start_structure(tournament, division=division)
        ensure_matches_generated(tournament, division=division)

        if division is not None:
            division.status = Tournament.Status.CONFIGURED
            division.save(update_fields=["status"])

        tournament.status = Tournament.Status.CONFIGURED
        tournament.save(update_fields=["status"])


class MyTournamentListView(ListAPIView):
    serializer_class = TournamentSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        normalized_email = str(getattr(user, "email", "") or "").strip().lower()

        filters = Q(organizer=user) | Q(
            memberships__user=user,
            memberships__role=TournamentMembership.Role.ASSISTANT,
            memberships__status=TournamentMembership.Status.ACCEPTED,
        ) | Q(registrations__user=user)

        if normalized_email:
            filters |= Q(
                assistant_invites__normalized_email=normalized_email,
                assistant_invites__status="PENDING",
            )

        return Tournament.objects.filter(filters).distinct().order_by("-created_at")

    def get_serializer_context(self):
        context = super().get_serializer_context()
        return context


class TournamentDetailView(RetrieveUpdateAPIView):
    queryset = Tournament.objects.all()
    serializer_class = TournamentSerializer

    def _ensure_mass_start_structure(self, tournament: Tournament) -> None:
        division = _resolve_division_from_request(self.request, tournament)
        if division is None:
            return

        if not (
            tournament.discipline == Tournament.Discipline.CUSTOM
            and division.result_mode == Tournament.ResultMode.CUSTOM
            and division.competition_model == Tournament.CompetitionModel.MASS_START
        ):
            return

        sync_custom_mass_start_structure(tournament, division=division)

    def get_serializer_context(self):
        context = super().get_serializer_context()
        return context

    def perform_update(self, serializer):
        tournament = serializer.instance
        division = _resolve_division_from_request(self.request, tournament)
        previous_competition_type = division.competition_type if division else tournament.competition_type

        tournament = serializer.save()
        self._ensure_mass_start_structure(tournament)

        if division is not None:
            division.refresh_from_db()
            rename_default_team_names_for_division_competition_type_change(
                tournament,
                division,
                previous_competition_type,
            )

    def get_permissions(self):
        if self.request.method in ("GET", "HEAD", "OPTIONS"):
            return [AllowAny()]
        return [IsAuthenticated(), IsTournamentOrganizer()]

    def retrieve(self, request, *args, **kwargs):
        tournament = self.get_object()
        self._ensure_mass_start_structure(tournament)
        user = request.user if request.user.is_authenticated else None
        serializer = self.get_serializer(tournament, context={"request": request})

        if user_is_organizer(user, tournament):
            return Response(serializer.data)

        if get_membership(user, tournament):
            return Response(serializer.data)

        if user_is_registered_participant(user, tournament):
            if participant_can_view_public_preview(tournament):
                return Response(serializer.data)
            raise PermissionDenied(
                "Podgląd dla uczestników jest wyłączony. Poczekaj na publikację turnieju."
            )

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
            return Response(
                {"detail": "Turniej jest już zarchiwizowany."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        tournament.status = Tournament.Status.FINISHED
        tournament.is_published = False
        tournament.save(update_fields=["status", "is_published"])

        tournament.divisions.update(status=Tournament.Status.FINISHED)

        return Response(
            {"detail": "Turniej został zarchiwizowany."},
            status=status.HTTP_200_OK,
        )


class UnarchiveTournamentView(APIView):
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

        tournament.divisions.filter(is_archived=False).update(status=Tournament.Status.CONFIGURED)

        return Response(
            {"detail": "Turniej został przywrócony z archiwum."},
            status=status.HTTP_200_OK,
        )


class ChangeDisciplineSerializer(serializers.Serializer):
    discipline = serializers.ChoiceField(choices=Tournament.Discipline.choices, required=True)
    custom_discipline_name = serializers.CharField(
        required=False,
        allow_blank=True,
        allow_null=True,
    )
    competition_type = serializers.ChoiceField(
        choices=Tournament.CompetitionType.choices,
        required=False,
    )
    competition_model = serializers.ChoiceField(
        choices=Tournament.CompetitionModel.choices,
        required=False,
    )
    result_mode = serializers.ChoiceField(
        choices=Tournament.ResultMode.choices,
        required=False,
    )
    result_config = serializers.JSONField(required=False)

    def validate(self, attrs):
        discipline = attrs["discipline"]
        custom_name = (attrs.get("custom_discipline_name") or "").strip()
        result_mode = attrs.get("result_mode")
        competition_model = attrs.get(
            "competition_model",
            Tournament.CompetitionModel.MASS_START,
        )
        result_config = attrs.get("result_config")

        if discipline == Tournament.Discipline.CUSTOM:
            competition_type = attrs.get(
                "competition_type",
                Tournament.CompetitionType.INDIVIDUAL,
            )
            result_mode = result_mode or Tournament.ResultMode.CUSTOM

            if competition_type not in (
                Tournament.CompetitionType.INDIVIDUAL,
                Tournament.CompetitionType.TEAM,
            ):
                raise serializers.ValidationError(
                    {
                        "competition_type": (
                            "Dla dyscypliny niestandardowej wybierz typ uczestnictwa: "
                            "INDIVIDUAL albo TEAM."
                        )
                    }
                )

            if competition_model not in (
                Tournament.CompetitionModel.HEAD_TO_HEAD,
                Tournament.CompetitionModel.MASS_START,
            ):
                raise serializers.ValidationError(
                    {
                        "competition_model": (
                            "Dla dyscypliny niestandardowej wybierz model rywalizacji: "
                            "HEAD_TO_HEAD albo MASS_START."
                        )
                    }
                )

            if result_mode != Tournament.ResultMode.CUSTOM:
                raise serializers.ValidationError(
                    {
                        "result_mode": (
                            "Dla dyscypliny niestandardowej wymagany jest result_mode=CUSTOM."
                        )
                    }
                )

            if not custom_name:
                raise serializers.ValidationError(
                    {
                        "custom_discipline_name": (
                            "Dla dyscypliny niestandardowej podaj własną nazwę."
                        )
                    }
                )

            attrs["competition_type"] = competition_type
            attrs["competition_model"] = competition_model
            attrs["result_mode"] = Tournament.ResultMode.CUSTOM
            attrs["custom_discipline_name"] = custom_name
            attrs["result_config"] = normalize_result_config(
                Tournament.ResultMode.CUSTOM,
                result_config,
            )
            return attrs

        attrs["competition_type"] = Tournament.infer_default_competition_type(discipline)
        attrs["competition_model"] = Tournament.infer_default_competition_model(discipline)
        attrs["result_mode"] = Tournament.ResultMode.SCORE
        attrs["result_config"] = {}
        attrs["custom_discipline_name"] = None
        return attrs


class ChangeDisciplineView(APIView):
    permission_classes = [IsAuthenticated, IsTournamentOrganizer]

    @transaction.atomic
    def post(self, request, pk):
        tournament: Tournament = get_object_or_404(Tournament, pk=pk)
        self.check_object_permissions(request, tournament)

        serializer = ChangeDisciplineSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        new_discipline = serializer.validated_data["discipline"]
        new_comp_type = serializer.validated_data["competition_type"]
        new_result_mode = serializer.validated_data["result_mode"]
        new_result_config = serializer.validated_data["result_config"]
        new_custom_name = serializer.validated_data["custom_discipline_name"]
        new_comp_model = serializer.validated_data["competition_model"]

        old_signature = (
            tournament.discipline,
            tournament.custom_discipline_name,
            tournament.competition_type,
            tournament.result_mode,
            tournament.result_config or {},
        )
        new_signature = (
            new_discipline,
            new_custom_name,
            new_comp_type,
            new_result_mode,
            new_result_config or {},
        )

        if new_signature == old_signature:
            return Response(
                {"detail": "Dyscyplina nie uległa zmianie."},
                status=status.HTTP_200_OK,
            )

        allowed_formats = Tournament.allowed_formats_for_discipline(new_discipline)
        incompatible_divisions = tournament.divisions.exclude(
            tournament_format__in=allowed_formats
        )
        if incompatible_divisions.exists():
            return Response(
                {
                    "detail": (
                        "Zmiana dyscypliny wymaga większego resetu, ponieważ co najmniej jedna dywizja "
                        "ma format niedostępny dla nowej dyscypliny."
                    ),
                    "reset_level": "FORMAT_INCOMPATIBLE",
                    "next_step": "setup",
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        match_model = get_model_any("tournaments", ["Match"])
        stage_model = get_model_any("tournaments", ["Stage"])
        team_model = get_model_any("tournaments", ["Team"])

        comp_type_changed = new_comp_type != tournament.competition_type

        if comp_type_changed:
            match_model.objects.filter(tournament=tournament).delete()
            StageMassStartEntry.objects.filter(stage__tournament=tournament).delete()
            stage_model.objects.filter(tournament=tournament).delete()
            team_model.objects.filter(tournament=tournament).delete()

            tournament.discipline = new_discipline
            tournament.custom_discipline_name = new_custom_name
            tournament.competition_type = new_comp_type
            tournament.competition_model = new_comp_model
            tournament.result_mode = new_result_mode
            tournament.result_config = new_result_config
            tournament.tournament_format = Tournament.TournamentFormat.LEAGUE
            tournament.format_config = normalize_format_config(new_discipline, {})
            tournament.status = Tournament.Status.DRAFT
            tournament.save(
                update_fields=[
                    "discipline",
                    "custom_discipline_name",
                    "competition_type",
                    "competition_model",
                    "result_mode",
                    "result_config",
                    "tournament_format",
                    "format_config",
                    "status",
                ]
            )

            for division in tournament.divisions.all().order_by("order", "id"):
                division.competition_type = new_comp_type
                division.competition_model = new_comp_model
                division.result_mode = new_result_mode
                division.result_config = dict(new_result_config or {})
                division.tournament_format = Tournament.TournamentFormat.LEAGUE
                division.format_config = {}
                division.status = Tournament.Status.DRAFT
                division.save()

            placeholder_teams = []
            divisions_for_reset = list(tournament.divisions.all().order_by("order", "id"))
            for current_division in divisions_for_reset:
                name_prefix = get_default_slot_prefix_for_competition_type(current_division.competition_type)
                placeholder_teams.extend(
                    [
                        team_model(
                            tournament=tournament,
                            division=current_division,
                            name=f"{name_prefix} 1",
                            is_active=True,
                        ),
                        team_model(
                            tournament=tournament,
                            division=current_division,
                            name=f"{name_prefix} 2",
                            is_active=True,
                        ),
                    ]
                )

            if placeholder_teams:
                team_model.objects.bulk_create(placeholder_teams)

            sync_custom_mass_start_structure(tournament)

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
        tournament.custom_discipline_name = new_custom_name
        tournament.competition_type = new_comp_type
        tournament.competition_model = new_comp_model
        tournament.result_mode = new_result_mode
        tournament.result_config = new_result_config
        tournament.format_config = normalize_format_config(
            new_discipline,
            tournament.format_config or {},
        )

        reset_match_results(match_model, tournament)
        clear_standings_cache(tournament)

        if tournament.status == Tournament.Status.FINISHED:
            tournament.status = Tournament.Status.CONFIGURED

        tournament.save(
            update_fields=[
                "discipline",
                "custom_discipline_name",
                "competition_type",
                "competition_model",
                "result_mode",
                "result_config",
                "format_config",
                "status",
            ]
        )

        for division in tournament.divisions.all().order_by("order", "id"):
            division.competition_type = new_comp_type
            division.competition_model = new_comp_model
            division.result_mode = new_result_mode
            division.result_config = dict(new_result_config or {})
            division.format_config = normalize_format_config(new_discipline, division.format_config or {})
            if division.status == Tournament.Status.FINISHED:
                division.status = Tournament.Status.CONFIGURED
            division.save()

        sync_custom_mass_start_structure(tournament)

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
            raise serializers.ValidationError(
                {"tournament_format": "Wybrany format nie jest dostępny dla tej dyscypliny."}
            )

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

        division = _resolve_division_from_request(request, tournament)
        if division is None:
            return Response(
                {"detail": "Nie znaleziono aktywnej dywizji dla tej operacji."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = ChangeSetupSerializer(
            data=request.data,
            context={"tournament": tournament},
        )
        serializer.is_valid(raise_exception=True)

        new_format = serializer.validated_data["tournament_format"]
        new_cfg = serializer.validated_data.get("format_config") or {}

        dry_run = str(request.query_params.get("dry_run", "")).lower() in (
            "1",
            "true",
            "yes",
        )

        old_cfg = normalize_format_config(tournament.discipline, division.format_config or {})
        new_cfg = normalize_format_config(tournament.discipline, new_cfg)

        fmt_changed = division.tournament_format != new_format
        cfg_changed = old_cfg != new_cfg
        changed = fmt_changed or cfg_changed

        old_struct = strip_standings_only_keys(tournament.discipline, old_cfg)
        new_struct = strip_standings_only_keys(tournament.discipline, new_cfg)
        structure_changed = old_struct != new_struct

        requires_reset = fmt_changed or structure_changed

        stage_model = get_model_any("tournaments", ["Stage"])
        match_model = get_model_any("tournaments", ["Match"])

        reset_needed = (
            stage_model.objects.filter(tournament=tournament, division=division).exists()
            or match_model.objects.filter(tournament=tournament, stage__division=division).exists()
            or StageMassStartEntry.objects.filter(stage__tournament=tournament, stage__division=division).exists()
        )

        if dry_run:
            return Response(
                {
                    "division_id": division.id,
                    "changed": changed,
                    "requires_reset": bool(requires_reset and changed),
                    "reset_needed": bool(reset_needed and requires_reset and changed),
                    "detail": "Sprawdzenie zakończone.",
                },
                status=status.HTTP_200_OK,
            )

        reset_performed = False

        if changed and requires_reset and reset_needed:
            match_model.objects.filter(tournament=tournament, stage__division=division).delete()
            StageMassStartEntry.objects.filter(stage__tournament=tournament, stage__division=division).delete()
            stage_model.objects.filter(tournament=tournament, division=division).delete()
            reset_performed = True
            clear_standings_cache(tournament, division=division)

        if changed and (not reset_performed) and cfg_changed:
            clear_standings_cache(tournament, division=division)

        if changed:
            previous_competition_type = division.competition_type

            division.tournament_format = new_format
            division.format_config = new_cfg

            if division.status == Tournament.Status.FINISHED:
                division.status = Tournament.Status.CONFIGURED
            elif reset_performed:
                division.status = Tournament.Status.DRAFT

            division.save(update_fields=["tournament_format", "format_config", "status"])
            sync_custom_mass_start_structure(tournament, division=division)
            rename_default_team_names_for_division_competition_type_change(
                tournament,
                division,
                previous_competition_type,
            )

            if division.is_default:
                tournament.tournament_format = division.tournament_format
                tournament.format_config = dict(division.format_config or {})
                tournament.save(update_fields=["tournament_format", "format_config"])

        return Response(
            {
                "detail": "Konfiguracja dywizji zapisana.",
                "division_id": division.id,
                "changed": changed,
                "requires_reset": bool(requires_reset and changed),
                "reset_performed": reset_performed,
                "next_step": "teams",
            },
            status=status.HTTP_200_OK,
        )
