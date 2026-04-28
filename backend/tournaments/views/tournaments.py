# backend/tournaments/views/tournaments.py
# Plik udostępnia widoki listy, szczegółów i zmian konfiguracji turnieju z obsługą aktywnej dywizji.

from __future__ import annotations

import re

from django.apps import apps
from django.db import transaction
from django.utils import timezone
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

from ._helpers import resolve_request_division

TENIS_POINTS_MODES = ("NONE", "PLT")


# ===== Helpery współdzielone widoków konfiguracji =====

def get_model_any(app_label: str, names: list[str]):
    for name in names:
        try:
            return apps.get_model(app_label, name)
        except LookupError:
            continue
    raise LookupError(f"Nie znaleziono żadnego modelu z listy: {names}")


def normalize_format_config(discipline: str | None, cfg: dict | None) -> dict:
    # Normalizacja skupia walidację konfiguracji formatu przed zapisem do dywizji i generatorów.
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
                        "tennis_points_mode": "Dozwolone wartości: standardowy zapis tenisa albo skrócony zapis punktowy."
                    }
                }
            )
        cfg["tennis_points_mode"] = mode
    else:
        cfg.pop("tennis_points_mode", None)

    try:
        return Tournament.normalize_format_config(discipline, cfg)
    except ValueError as exc:
        raise serializers.ValidationError({"format_config": str(exc)}) from exc


def normalize_result_config(result_mode: str | None, cfg: dict | None) -> dict:
    # Normalizacja wyniku zabezpiecza zgodność konfiguracji dyscypliny niestandardowej.
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


def _division_has_generated_structure(tournament: Tournament, division: Division | None = None) -> bool:
    stage_qs = Stage.objects.filter(tournament=tournament, is_archived=False)
    match_qs = get_model_any("tournaments", ["Match"]).objects.filter(tournament=tournament, stage__is_archived=False)
    entry_qs = StageMassStartEntry.objects.filter(stage__tournament=tournament, stage__is_archived=False)

    if division is not None:
        stage_qs = stage_qs.filter(division=division)
        match_qs = match_qs.filter(stage__division=division)
        entry_qs = entry_qs.filter(stage__division=division)

    return stage_qs.exists() or match_qs.exists() or entry_qs.exists()


def _division_has_result_progress(tournament: Tournament, division: Division | None = None) -> bool:
    match_model = get_model_any("tournaments", ["Match"])
    match_qs = match_model.objects.filter(tournament=tournament, stage__is_archived=False)
    result_qs = StageMassStartResult.objects.filter(stage__tournament=tournament, stage__is_archived=False, is_active=True)

    if division is not None:
        match_qs = match_qs.filter(stage__division=division)
        result_qs = result_qs.filter(stage__division=division)

    if match_qs.filter(
        Q(result_entered=True)
        | Q(status__in=(match_model.Status.IN_PROGRESS, match_model.Status.FINISHED))
    ).exists():
        return True

    if result_qs.exists():
        return True

    try:
        custom_result_model = apps.get_model("tournaments", "MatchCustomResult")
    except LookupError:
        custom_result_model = None

    if custom_result_model is not None:
        custom_qs = custom_result_model.objects.filter(match__tournament=tournament, match__stage__is_archived=False, is_active=True)
        if division is not None:
            custom_qs = custom_qs.filter(match__stage__division=division)
        if custom_qs.exists():
            return True

    return False


def _tournament_has_result_progress(tournament: Tournament) -> bool:
    return _division_has_result_progress(tournament, None)


def _division_has_schedule_progress(tournament: Tournament, division: Division | None = None) -> bool:
    stage_qs = Stage.objects.filter(tournament=tournament, is_archived=False)
    group_model = get_model_any("tournaments", ["Group"])
    group_qs = group_model.objects.filter(stage__tournament=tournament, stage__is_archived=False)
    match_model = get_model_any("tournaments", ["Match"])
    match_qs = match_model.objects.filter(tournament=tournament, stage__is_archived=False)

    if division is not None:
        stage_qs = stage_qs.filter(division=division)
        group_qs = group_qs.filter(stage__division=division)
        match_qs = match_qs.filter(stage__division=division)

    schedule_filter = (
        Q(scheduled_date__isnull=False)
        | Q(scheduled_time__isnull=False)
        | (Q(location__isnull=False) & ~Q(location=""))
    )

    return (
        stage_qs.filter(schedule_filter).exists()
        or group_qs.filter(schedule_filter).exists()
        or match_qs.filter(schedule_filter).exists()
    )


def _tournament_has_schedule_progress(tournament: Tournament) -> bool:
    return _division_has_schedule_progress(tournament, None)


def _reset_impact_messages(
    tournament: Tournament,
    *,
    division: Division | None = None,
    schedule_label: str = "dane harmonogramu",
    result_label: str = "wprowadzone wyniki",
) -> list[str]:
    messages: list[str] = []
    if _division_has_schedule_progress(tournament, division):
        messages.append(schedule_label)
    if _division_has_result_progress(tournament, division):
        messages.append(result_label)
    return messages


def _can_keep_data_for_discipline_change(
    tournament: Tournament,
    *,
    new_discipline: str,
    new_competition_type: str,
    new_competition_model: str,
    new_result_mode: str,
    new_result_config: dict | None,
) -> bool:
    score_disciplines = {
        Tournament.Discipline.FOOTBALL,
        Tournament.Discipline.HANDBALL,
        Tournament.Discipline.BASKETBALL,
    }

    if tournament.discipline not in score_disciplines or new_discipline not in score_disciplines:
        return False

    return (
        tournament.competition_type == new_competition_type
        and tournament.competition_model == new_competition_model == Tournament.CompetitionModel.HEAD_TO_HEAD
        and tournament.result_mode == new_result_mode == Tournament.ResultMode.SCORE
        and dict(tournament.result_config or {}) == dict(new_result_config or {})
    )


def reset_match_results(match_model, tournament: Tournament, *, division: Division | None = None) -> None:
    qs = match_model.objects.filter(tournament=tournament, stage__is_archived=False)
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


def _stage_name_for_mass_start(
    index: int,
    cfg: dict,
    stage_structure_mode: str | None = None,
) -> str:
    raw_name = str(cfg.get(Tournament.RESULTCFG_STAGE_NAME_KEY) or "").strip()

    if stage_structure_mode == Tournament.RESULTCFG_STAGE_STRUCTURE_MULTI_EVENT:
        if not raw_name or raw_name == f"Etap {index}":
            return f"Konkurencja {index}"
        return raw_name

    if raw_name:
        return raw_name

    defaults = {1: "Kwalifikacje", 2: "Półfinał", 3: "Finał"}
    return defaults.get(index, f"Etap {index}")


def _group_name_for_index(index: int) -> str:
    return f"Grupa {index}"


def _default_mass_start_stage_status(index: int, stage_structure_mode: str | None = None) -> str:
    if stage_structure_mode == Tournament.RESULTCFG_STAGE_STRUCTURE_MULTI_EVENT:
        return Stage.Status.OPEN
    return Stage.Status.OPEN if index == 1 else Stage.Status.PLANNED


def _mass_start_stage_structure_mode(tournament: Tournament, division: Division | None = None) -> str:
    context = division or tournament
    result_config = (
        context.get_result_config()
        if hasattr(context, "get_result_config")
        else tournament.get_result_config()
        if hasattr(tournament, "get_result_config")
        else {}
    )
    mode = str(
        result_config.get(Tournament.RESULTCFG_STAGE_STRUCTURE_MODE_KEY)
        or Tournament.RESULTCFG_STAGE_STRUCTURE_REDUCTION
    ).upper()
    if mode not in (
        Tournament.RESULTCFG_STAGE_STRUCTURE_REDUCTION,
        Tournament.RESULTCFG_STAGE_STRUCTURE_MULTI_EVENT,
    ):
        return Tournament.RESULTCFG_STAGE_STRUCTURE_REDUCTION
    return mode



def _archive_stage_queryset(qs, *, reason: str):
    now = timezone.now()
    stage_ids = list(qs.values_list("id", flat=True)) if hasattr(qs, "values_list") else [stage.id for stage in qs]
    if not stage_ids:
        return

    Stage.objects.filter(id__in=stage_ids).update(
        is_archived=True,
        archived_at=now,
        archive_reason=reason,
    )


def _has_stage_schedule(stage: Stage) -> bool:
    return bool(stage.scheduled_date or stage.scheduled_time or (stage.location or "").strip())


def _has_group_schedule(stage: Stage) -> bool:
    return stage.groups.filter(
        Q(scheduled_date__isnull=False)
        | Q(scheduled_time__isnull=False)
        | (Q(location__isnull=False) & ~Q(location=""))
    ).exists()


def _mass_start_stage_has_user_data(stage: Stage) -> bool:
    return (
        _has_stage_schedule(stage)
        or _has_group_schedule(stage)
        or StageMassStartResult.objects.filter(stage=stage, is_active=True).exists()
    )


def _mass_start_restore_candidates(
    tournament: Tournament,
    division: Division,
    target_count: int,
) -> list[Stage]:
    active_orders = set(
        Stage.objects.filter(
            tournament=tournament,
            division=division,
            stage_type=Stage.StageType.MASS_START,
            is_archived=False,
        ).values_list("order", flat=True)
    )
    missing_orders = [order for order in range(1, target_count + 1) if order not in active_orders]
    if not missing_orders:
        return []

    candidates: list[Stage] = []
    for order in missing_orders:
        stage = (
            Stage.objects.filter(
                tournament=tournament,
                division=division,
                stage_type=Stage.StageType.MASS_START,
                order=order,
                is_archived=True,
            )
            .order_by("-archived_at", "-id")
            .first()
        )
        if stage is not None:
            candidates.append(stage)

    return candidates


def analyze_mass_start_structure_change(
    tournament: Tournament,
    division: Division,
    result_config: dict | None,
) -> dict:
    stage_cfgs = list((result_config or {}).get(Tournament.RESULTCFG_STAGES_KEY) or [])
    target_count = len(stage_cfgs)

    active_stages = list(
        Stage.objects.filter(
            tournament=tournament,
            division=division,
            stage_type=Stage.StageType.MASS_START,
            is_archived=False,
        ).order_by("order", "id")
    )

    archive_candidates = [stage for stage in active_stages if int(stage.order or 0) > target_count]
    archive_messages: list[str] = []

    schedule_count = sum(1 for stage in archive_candidates if _has_stage_schedule(stage) or _has_group_schedule(stage))
    result_count = sum(
        1
        for stage in archive_candidates
        if StageMassStartResult.objects.filter(stage=stage, is_active=True).exists()
    )

    if schedule_count:
        archive_messages.append("dane harmonogramu z usuwanych konkurencji lub etapów")
    if result_count:
        archive_messages.append("wprowadzone wyniki z usuwanych konkurencji lub etapów")

    stage_structure_mode = _mass_start_stage_structure_mode(tournament, division)
    restore_candidates = _mass_start_restore_candidates(
        tournament=tournament,
        division=division,
        target_count=target_count,
    )

    return {
        "restore_available": bool(restore_candidates),
        "restore_items": [
            _stage_name_for_mass_start(
                stage.order,
                stage_cfgs[stage.order - 1] if 0 < stage.order <= len(stage_cfgs) else {},
                stage_structure_mode,
            )
            for stage in restore_candidates
        ],
        "archive_messages": archive_messages,
    }


def _sync_mass_start_stage_entries(
    tournament: Tournament,
    division: Division,
    stage,
    groups: list,
    cfg: dict,
) -> None:
    stage_structure_mode = _mass_start_stage_structure_mode(tournament, division)

    if (
        stage.order != 1
        and stage_structure_mode != Tournament.RESULTCFG_STAGE_STRUCTURE_MULTI_EVENT
    ):
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

    if stage_structure_mode == Tournament.RESULTCFG_STAGE_STRUCTURE_MULTI_EVENT:
        selected_team_ids = active_team_ids
    else:
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


def sync_custom_mass_start_structure_for_division(
    tournament: Tournament,
    division: Division,
    *,
    restore_archived_mass_start: bool = False,
) -> None:
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
            is_archived=False,
        ).order_by("order", "id")
    )

    if not is_custom_mass_start:
        if existing_mass_stages:
            _archive_stage_queryset(existing_mass_stages, reason="MASS_START_DISABLED")
        return

    stage_cfgs = list(division.get_mass_start_stages() or [])

    stale_stages = stage_model.objects.filter(tournament=tournament, division=division, is_archived=False).exclude(
        stage_type=stage_model.StageType.MASS_START
    )
    if stale_stages.exists():
        match_model.objects.filter(tournament=tournament, stage__in=stale_stages).delete()
        stale_stages.delete()

    match_model.objects.filter(
        tournament=tournament,
        stage__division=division,
        stage__stage_type=stage_model.StageType.MASS_START,
        stage__is_archived=False,
    ).delete()

    active_stage_ids: list[int] = []
    stage_structure_mode = _mass_start_stage_structure_mode(tournament, division)

    existing_by_order = {int(stage.order): stage for stage in existing_mass_stages}

    for index, cfg in enumerate(stage_cfgs, start=1):
        stage = existing_by_order.get(index)

        if stage is None and restore_archived_mass_start:
            stage = (
                stage_model.objects.filter(
                    tournament=tournament,
                    division=division,
                    stage_type=stage_model.StageType.MASS_START,
                    order=index,
                    is_archived=True,
                )
                .order_by("-archived_at", "-id")
                .first()
            )

        is_new_stage = stage is None

        if stage is None:
            stage = stage_model(
                tournament=tournament,
                division=division,
                stage_type=stage_model.StageType.MASS_START,
                order=index,
                status=_default_mass_start_stage_status(index, stage_structure_mode),
            )
        else:
            stage.is_archived = False
            stage.archived_at = None
            stage.archive_reason = ""

        stage.stage_type = stage_model.StageType.MASS_START
        stage.division = division
        stage.order = index

        if is_new_stage:
            stage.status = _default_mass_start_stage_status(index, stage_structure_mode)
        elif (
            stage_structure_mode == Tournament.RESULTCFG_STAGE_STRUCTURE_MULTI_EVENT
            and stage.status == Stage.Status.PLANNED
        ):
            stage.status = Stage.Status.OPEN

        if hasattr(stage, "name"):
            stage.name = _stage_name_for_mass_start(index, cfg, stage_structure_mode)

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
            is_archived=False,
        ).exclude(id__in=active_stage_ids)
        if stale_mass_stages.exists():
            _archive_stage_queryset(stale_mass_stages, reason="MASS_START_STRUCTURE_REDUCED")


def sync_custom_mass_start_structure(
    tournament: Tournament,
    *,
    division: Division | None = None,
    restore_archived_mass_start: bool = False,
) -> None:
    if division is not None:
        sync_custom_mass_start_structure_for_division(
            tournament,
            division,
            restore_archived_mass_start=restore_archived_mass_start,
        )
        return

    for current_division in tournament.divisions.all().order_by("order", "id"):
        sync_custom_mass_start_structure_for_division(
            tournament,
            current_division,
            restore_archived_mass_start=restore_archived_mass_start,
        )


# ===== Widoki listy i szczegółu turnieju =====

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


def _archived_tournament_write_response(tournament: Tournament) -> Response | None:
    if getattr(tournament, "is_archived", False):
        return Response(
            {"detail": "Nie można edytować zarchiwizowanego turnieju."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    return None


class TournamentDetailView(RetrieveUpdateAPIView):
    queryset = Tournament.objects.all()
    serializer_class = TournamentSerializer

    def _ensure_mass_start_structure(self, tournament: Tournament) -> None:
        division = resolve_request_division(self.request, tournament)
        if division is None:
            return

        if not (
            tournament.discipline == Tournament.Discipline.CUSTOM
            and division.result_mode == Tournament.ResultMode.CUSTOM
            and division.competition_model == Tournament.CompetitionModel.MASS_START
        ):
            return

        restore_archived = bool(getattr(self.request, "data", {}).get("restore_archived_mass_start"))
        sync_custom_mass_start_structure(
            tournament,
            division=division,
            restore_archived_mass_start=restore_archived,
        )

    def get_serializer_context(self):
        context = super().get_serializer_context()
        return context

    def update(self, request, *args, **kwargs):
        tournament = self.get_object()
        archived_response = _archived_tournament_write_response(tournament)
        if archived_response is not None:
            return archived_response

        dry_run = str(request.query_params.get("dry_run", "")).lower() in ("1", "true", "yes")
        if dry_run:
            division = resolve_request_division(request, tournament)
            if division is None:
                return Response({"detail": "Nie znaleziono aktywnej dywizji dla tej operacji."}, status=status.HTTP_400_BAD_REQUEST)

            result_config = request.data.get("result_config")
            analysis = (
                analyze_mass_start_structure_change(tournament, division, result_config)
                if isinstance(result_config, dict)
                else {"restore_available": False, "restore_items": [], "archive_messages": []}
            )

            return Response(
                {
                    "division_id": division.id,
                    "changed": True,
                    "requires_confirmation": bool(analysis["archive_messages"] or analysis["restore_available"]),
                    "restore_available": analysis["restore_available"],
                    "restore_items": analysis["restore_items"],
                    "archive_messages": analysis["archive_messages"],
                    "detail": "Sprawdzenie zakończone.",
                },
                status=status.HTTP_200_OK,
            )

        return super().update(request, *args, **kwargs)

    def perform_update(self, serializer):
        tournament = serializer.instance
        division = resolve_request_division(self.request, tournament)
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

        if tournament.is_archived:
            return Response(
                {"detail": "Turniej jest już zarchiwizowany."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        tournament.status = Tournament.Status.FINISHED
        tournament.is_archived = True
        tournament.is_published = False
        tournament.save(update_fields=["status", "is_archived", "is_published"])

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

        if not tournament.is_archived and tournament.status != Tournament.Status.FINISHED:
            return Response(
                {"detail": "Turniej nie znajduje się w archiwum."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        tournament.status = Tournament.Status.CONFIGURED
        tournament.is_archived = False
        tournament.save(update_fields=["status", "is_archived"])

        tournament.divisions.filter(is_archived=False).update(status=Tournament.Status.CONFIGURED)

        return Response(
            {"detail": "Turniej został przywrócony z archiwum."},
            status=status.HTTP_200_OK,
        )


# ===== Zmiana dyscypliny i konfiguracji bazowej =====

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
                            "Dla dyscypliny niestandardowej wybierz tryb indywidualny albo drużynowy."
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
                            "Dla dyscypliny niestandardowej wybierz model pojedynków albo wspólnego startu."
                        )
                    }
                )

            if result_mode != Tournament.ResultMode.CUSTOM:
                raise serializers.ValidationError(
                    {
                        "result_mode": (
                            "Dla dyscypliny niestandardowej wymagany jest niestandardowy tryb wyniku."
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

        if discipline == Tournament.Discipline.WRESTLING:
            attrs["competition_type"] = Tournament.CompetitionType.INDIVIDUAL
            attrs["competition_model"] = Tournament.CompetitionModel.HEAD_TO_HEAD
            attrs["result_mode"] = Tournament.ResultMode.SCORE
            attrs["result_config"] = {}
            attrs["custom_discipline_name"] = None
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
            tournament.competition_model,
            tournament.result_mode,
            tournament.result_config or {},
        )
        new_signature = (
            new_discipline,
            new_custom_name,
            new_comp_type,
            new_comp_model,
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
        dry_run = str(request.query_params.get("dry_run", "")).lower() in (
            "1",
            "true",
            "yes",
        )
        generated_structure_exists = _division_has_generated_structure(tournament)
        can_keep_existing_data = _can_keep_data_for_discipline_change(
            tournament,
            new_discipline=new_discipline,
            new_competition_type=new_comp_type,
            new_competition_model=new_comp_model,
            new_result_mode=new_result_mode,
            new_result_config=new_result_config,
        )
        impact_messages = (
            []
            if can_keep_existing_data
            else _reset_impact_messages(
                tournament,
                schedule_label="dane harmonogramu niedopasowane do nowej dyscypliny",
                result_label="wprowadzone wyniki niedopasowane do nowej dyscypliny",
            )
        )
        reset_level = "NONE" if can_keep_existing_data else "FULL_RESET" if comp_type_changed else "STRUCTURE_ARCHIVE"

        if dry_run:
            return Response(
                {
                    "changed": True,
                    "requires_reset": bool(generated_structure_exists and not can_keep_existing_data),
                    "reset_needed": bool(impact_messages),
                    "requires_confirmation": bool(impact_messages),
                    "archive_messages": impact_messages,
                    "preserve_results": bool(can_keep_existing_data),
                    "reset_level": reset_level,
                    "detail": "Sprawdzenie zmiany dyscypliny zakończone.",
                },
                status=status.HTTP_200_OK,
            )

        tournament.discipline = new_discipline
        tournament.custom_discipline_name = new_custom_name
        tournament.competition_type = new_comp_type
        tournament.competition_model = new_comp_model
        tournament.result_mode = new_result_mode
        tournament.result_config = new_result_config

        if can_keep_existing_data:
            tournament.format_config = normalize_format_config(
                new_discipline,
                tournament.format_config or {},
            )
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

            clear_standings_cache(tournament)
            return Response(
                {
                    "detail": "Zmieniono dyscyplinę. Zachowano zgodny harmonogram i wyniki.",
                    "reset_level": "NONE",
                    "next_step": "results",
                },
                status=status.HTTP_200_OK,
            )

        match_model.objects.filter(tournament=tournament, stage__is_archived=False).delete()
        StageMassStartEntry.objects.filter(stage__tournament=tournament, stage__is_archived=False).delete()
        _archive_stage_queryset(
            stage_model.objects.filter(tournament=tournament, is_archived=False),
            reason="DISCIPLINE_CHANGE",
        )
        clear_standings_cache(tournament)

        if comp_type_changed:
            team_model.objects.filter(tournament=tournament).delete()

        if comp_type_changed:
            tournament.tournament_format = Tournament.TournamentFormat.LEAGUE
            tournament.format_config = normalize_format_config(new_discipline, {})
        else:
            tournament.format_config = normalize_format_config(new_discipline, tournament.format_config or {})
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
            if comp_type_changed:
                division.tournament_format = Tournament.TournamentFormat.LEAGUE
                division.format_config = {}
            else:
                division.format_config = normalize_format_config(new_discipline, division.format_config or {})
            division.status = Tournament.Status.DRAFT
            division.save()

        if comp_type_changed:
            placeholder_teams = []
            for current_division in tournament.divisions.all().order_by("order", "id"):
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
                "detail": "Zmieniono dyscyplinę. Dane niezgodne z nową konfiguracją zostały zarchiwizowane lub usunięte.",
                "reset_level": reset_level,
                "next_step": "setup",
            },
            status=status.HTTP_200_OK,
        )


# ===== Zmiana konfiguracji formatu aktywnej dywizji =====

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

        division = resolve_request_division(request, tournament)
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

        generated_structure_exists = _division_has_generated_structure(tournament, division)
        impact_messages = (
            _reset_impact_messages(
                tournament,
                division=division,
                schedule_label="dane harmonogramu aktywnej dywizji",
                result_label="wprowadzone wyniki aktywnej dywizji",
            )
            if requires_reset and changed
            else []
        )

        if dry_run:
            return Response(
                {
                    "division_id": division.id,
                    "changed": changed,
                    "requires_reset": bool(requires_reset and changed),
                    "reset_needed": bool(impact_messages),
                    "requires_confirmation": bool(impact_messages),
                    "structure_exists": bool(generated_structure_exists),
                    "archive_messages": impact_messages,
                    "restore_available": False,
                    "restore_items": [],
                    "detail": "Sprawdzenie zakończone.",
                },
                status=status.HTTP_200_OK,
            )

        reset_performed = False

        if changed and requires_reset and generated_structure_exists:
            match_model.objects.filter(tournament=tournament, stage__division=division, stage__is_archived=False).delete()
            StageMassStartEntry.objects.filter(stage__tournament=tournament, stage__division=division, stage__is_archived=False).delete()
            _archive_stage_queryset(
                stage_model.objects.filter(tournament=tournament, division=division, is_archived=False),
                reason="SETUP_RESET",
            )
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
