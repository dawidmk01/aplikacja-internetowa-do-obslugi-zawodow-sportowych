
# backend/tournaments/views/mass_start_results.py
# Plik udostępnia odczyt i zapis wyników etapowych dla trybu MASS_START w kontekście aktywnej dywizji.

from __future__ import annotations

from collections import defaultdict
from decimal import Decimal
from typing import Any

from django.db import transaction
from django.shortcuts import get_object_or_404

from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from tournaments.access import user_is_assistant
from tournaments.models import (
    Division,
    Group,
    Stage,
    StageMassStartEntry,
    StageMassStartResult,
    Tournament,
)
from tournaments.realtime import ws_emit_tournament
from tournaments.serializers import (
    StageMassStartResultSerializer,
    StageMassStartResultWriteSerializer,
)
from tournaments.views._helpers import public_access_or_403


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


def _competition_context(division: Division | None, tournament: Tournament):
    return division or tournament


def _division_stage_cfgs(context_obj) -> list[dict]:
    if hasattr(context_obj, "get_mass_start_stages"):
        return list(context_obj.get_mass_start_stages() or [])
    return []


def _stage_cfg_for_order(context_obj, order: int) -> dict:
    cfgs = _division_stage_cfgs(context_obj)
    if 1 <= order <= len(cfgs):
        cfg = cfgs[order - 1]
        return cfg if isinstance(cfg, dict) else {}
    return {}


def _stage_name(stage: Stage) -> str:
    context_obj = _competition_context(getattr(stage, "division", None), stage.tournament)
    cfg = _stage_cfg_for_order(context_obj, stage.order)
    raw = str(cfg.get(Tournament.RESULTCFG_STAGE_NAME_KEY) or "").strip()
    return raw or f"Etap {stage.order}"


def _result_numeric_value(result: StageMassStartResult):
    if result.value_kind == Tournament.RESULTCFG_VALUE_KIND_TIME:
        return int(result.time_ms or 0)
    if result.value_kind == Tournament.RESULTCFG_VALUE_KIND_PLACE:
        return int(result.place_value or 0)
    return Decimal(result.numeric_value or "0")


def _aggregate_round_values(
    values: list[tuple[int, Any]],
    aggregation_mode: str,
    lower_is_better: bool,
):
    if not values:
        return None

    ordered = sorted(values, key=lambda item: (item[0], item[1]))
    only_values = [value for _, value in ordered]

    if aggregation_mode == Tournament.RESULTCFG_AGGREGATION_LAST_ROUND:
        return ordered[-1][1]

    if aggregation_mode == Tournament.RESULTCFG_AGGREGATION_SUM:
        if isinstance(only_values[0], Decimal):
            total = Decimal("0")
            for value in only_values:
                total += Decimal(value)
            return total
        return sum(int(value) for value in only_values)

    if aggregation_mode == Tournament.RESULTCFG_AGGREGATION_AVERAGE:
        if isinstance(only_values[0], Decimal):
            total = Decimal("0")
            for value in only_values:
                total += Decimal(value)
            return total / Decimal(len(only_values))
        total = sum(int(value) for value in only_values)
        return Decimal(total) / Decimal(len(only_values))

    return min(only_values) if lower_is_better else max(only_values)


def _format_aggregate_display(context_obj, value) -> str:
    if value is None:
        return "-"

    value_kind = context_obj.get_result_value_kind()
    cfg = context_obj.get_result_config()

    if value_kind == Tournament.RESULTCFG_VALUE_KIND_TIME:
        total_ms = int(Decimal(value))
        total_seconds, ms = divmod(total_ms, 1000)
        minutes, seconds = divmod(total_seconds, 60)
        hours, minutes = divmod(minutes, 60)
        hundredths = ms // 10
        time_format = cfg.get(Tournament.RESULTCFG_TIME_FORMAT_KEY)

        if time_format == Tournament.RESULTCFG_TIME_FORMAT_HH_MM_SS:
            return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
        if time_format == Tournament.RESULTCFG_TIME_FORMAT_MM_SS:
            total_minutes = total_seconds // 60
            return f"{total_minutes:02d}:{seconds:02d}"
        if time_format == Tournament.RESULTCFG_TIME_FORMAT_SS_HH:
            return f"{total_seconds}.{hundredths:02d}"

        total_minutes = total_seconds // 60
        return f"{total_minutes:02d}:{seconds:02d}.{hundredths:02d}"

    if value_kind == Tournament.RESULTCFG_VALUE_KIND_PLACE:
        return str(int(Decimal(value)))

    decimal_places = int(cfg.get(Tournament.RESULTCFG_DECIMAL_PLACES_KEY, 0) or 0)
    unit_label = str(
        cfg.get(Tournament.RESULTCFG_UNIT_LABEL_KEY)
        or cfg.get(Tournament.RESULTCFG_UNIT_KEY)
        or ""
    ).strip()
    numeric = Decimal(value)
    exponent = Decimal("1").scaleb(-decimal_places)
    quantized = numeric.quantize(exponent)
    rendered = (
        f"{quantized:.{decimal_places}f}"
        if decimal_places > 0
        else str(int(quantized))
    )
    return f"{rendered} {unit_label}".strip()


def _entry_team_ids_for_group(stage: Stage, group: Group | None) -> list[int]:
    qs = StageMassStartEntry.objects.filter(stage=stage, is_active=True)

    if group is None:
        qs = qs.filter(group__isnull=True)
    else:
        qs = qs.filter(group=group)

    return list(
        qs.order_by("seed", "team_id", "id").values_list("team_id", flat=True)
    )


def _round_results_map(
    stage: Stage,
    team_ids: list[int],
) -> dict[tuple[int, int], StageMassStartResult]:
    if not team_ids:
        return {}

    qs = (
        StageMassStartResult.objects.filter(stage=stage, team_id__in=team_ids, is_active=True)
        .select_related("team", "group")
        .order_by("round_number", "id")
    )
    return {(result.team_id, result.round_number): result for result in qs}


def _compute_group_rankings(
    stage: Stage,
    group: Group | None,
    *,
    persist: bool,
) -> dict[int, dict[str, Any]]:
    context_obj = _competition_context(getattr(stage, "division", None), stage.tournament)
    stage_cfg = _stage_cfg_for_order(context_obj, stage.order)
    aggregation_mode = str(
        stage_cfg.get(Tournament.RESULTCFG_STAGE_AGGREGATION_MODE_KEY)
        or context_obj.get_result_config().get(Tournament.RESULTCFG_AGGREGATION_MODE_KEY)
        or Tournament.RESULTCFG_AGGREGATION_BEST
    ).upper()

    lower_is_better = (
        context_obj.result_is_time()
        or context_obj.result_is_place()
        or context_obj.custom_result_lower_is_better()
    )
    allow_ties = bool(
        context_obj.get_result_config().get(Tournament.RESULTCFG_ALLOW_TIES_KEY, True)
    )

    team_ids = _entry_team_ids_for_group(stage, group)
    if not team_ids:
        return {}

    results = list(
        StageMassStartResult.objects.filter(
            stage=stage,
            team_id__in=team_ids,
            is_active=True,
            group=group,
        )
        .select_related("team", "group")
        .order_by("team_id", "round_number", "id")
    )

    rows_by_team: dict[int, list[StageMassStartResult]] = defaultdict(list)
    for result in results:
        rows_by_team[result.team_id].append(result)

    ranking_rows: list[dict[str, Any]] = []
    for team_id in team_ids:
        team_results = rows_by_team.get(team_id, [])
        round_values = [
            (item.round_number, _result_numeric_value(item))
            for item in team_results
        ]
        aggregate_value = _aggregate_round_values(
            round_values,
            aggregation_mode,
            lower_is_better,
        )
        ranking_rows.append(
            {
                "team_id": team_id,
                "results": team_results,
                "aggregate_value": aggregate_value,
                "aggregate_display": _format_aggregate_display(
                    context_obj,
                    aggregate_value,
                ),
            }
        )

    sentinel = Decimal("999999999") if lower_is_better else Decimal("-999999999")
    ranking_rows.sort(
        key=lambda row: (
            row["aggregate_value"] if row["aggregate_value"] is not None else sentinel,
            row["team_id"],
        ),
        reverse=not lower_is_better,
    )

    previous_value = None
    previous_rank = None
    payload: dict[int, dict[str, Any]] = {}

    for index, row in enumerate(ranking_rows, start=1):
        current_value = row["aggregate_value"]
        if allow_ties and previous_value is not None and current_value == previous_value:
            rank = previous_rank
        else:
            rank = index

        payload[row["team_id"]] = {
            "rank": rank,
            "aggregate_value": current_value,
            "aggregate_display": row["aggregate_display"],
        }

        if persist:
            for result in row["results"]:
                if result.rank != rank:
                    result.rank = rank
                    result.save(update_fields=["rank", "updated_at"])

        previous_value = current_value
        previous_rank = rank

    return payload


def _group_payload(stage: Stage, group: Group) -> dict[str, Any]:
    context_obj = _competition_context(getattr(stage, "division", None), stage.tournament)
    team_ids = _entry_team_ids_for_group(stage, group)
    ranking = _compute_group_rankings(stage, group, persist=False)
    round_results = _round_results_map(stage, team_ids)
    stage_cfg = _stage_cfg_for_order(context_obj, stage.order)
    rounds_count = int(stage_cfg.get(Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY) or 1)

    team_lookup = {
        team.id: team.name
        for team in stage.tournament.teams.filter(id__in=team_ids).order_by("id")
    }

    entries: list[dict[str, Any]] = []
    for team_id in team_ids:
        rounds: list[dict[str, Any]] = []
        for round_number in range(1, rounds_count + 1):
            result = round_results.get((team_id, round_number))
            rounds.append(
                {
                    "round_number": round_number,
                    "result_id": result.id if result else None,
                    "numeric_value": (
                        str(result.numeric_value)
                        if result and result.numeric_value is not None
                        else None
                    ),
                    "time_ms": (
                        int(result.time_ms)
                        if result and result.time_ms is not None
                        else None
                    ),
                    "place_value": (
                        int(result.place_value)
                        if result and result.place_value is not None
                        else None
                    ),
                    "display_value": result.display_value if result else None,
                    "rank": int(result.rank) if result and result.rank is not None else None,
                    "is_active": bool(result.is_active) if result else False,
                }
            )

        team_rank = ranking.get(team_id, {})
        entries.append(
            {
                "team_id": team_id,
                "team_name": team_lookup.get(team_id, f"Uczestnik {team_id}"),
                "group_id": group.id,
                "rank": team_rank.get("rank"),
                "aggregate_value": (
                    str(team_rank.get("aggregate_value"))
                    if isinstance(team_rank.get("aggregate_value"), Decimal)
                    else team_rank.get("aggregate_value")
                ),
                "aggregate_display": team_rank.get("aggregate_display", "-"),
                "rounds": rounds,
            }
        )

    return {
        "group_id": group.id,
        "group_name": group.name,
        "entries": entries,
    }


def _build_response_payload(tournament: Tournament, division: Division | None) -> dict[str, Any]:
    context_obj = _competition_context(division, tournament)

    stages = list(
        Stage.objects.filter(
            tournament=tournament,
            division=division,
            stage_type=Stage.StageType.MASS_START,
            status__in=(Stage.Status.PLANNED, Stage.Status.OPEN, Stage.Status.CLOSED),
        )
        .prefetch_related("groups")
        .order_by("order", "id")
    )

    payload_stages: list[dict[str, Any]] = []
    for stage in stages:
        stage_cfg = _stage_cfg_for_order(context_obj, stage.order)
        groups = list(stage.groups.all().order_by("id"))
        groups_payload: list[dict[str, Any]] = []

        for group in groups:
            groups_payload.append(_group_payload(stage, group))

        payload_stages.append(
            {
                "stage_id": stage.id,
                "division_id": stage.division_id,
                "stage_order": stage.order,
                "stage_name": _stage_name(stage),
                "stage_status": stage.status,
                "groups_count": int(
                    stage_cfg.get(Tournament.RESULTCFG_STAGE_GROUPS_COUNT_KEY)
                    or max(1, len(groups_payload) or 1)
                ),
                "participants_count": stage_cfg.get(
                    Tournament.RESULTCFG_STAGE_PARTICIPANTS_COUNT_KEY
                ),
                "advance_count": stage_cfg.get(
                    Tournament.RESULTCFG_STAGE_ADVANCE_COUNT_KEY
                ),
                "rounds_count": int(
                    stage_cfg.get(Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY) or 1
                ),
                "aggregation_mode": str(
                    stage_cfg.get(Tournament.RESULTCFG_STAGE_AGGREGATION_MODE_KEY)
                    or context_obj.get_result_config().get(
                        Tournament.RESULTCFG_AGGREGATION_MODE_KEY
                    )
                    or Tournament.RESULTCFG_AGGREGATION_BEST
                ).upper(),
                "groups": groups_payload,
            }
        )

    return {
        "tournament_id": tournament.id,
        "division_id": division.id if division else None,
        "division_name": division.name if division else None,
        "competition_model": context_obj.competition_model,
        "value_kind": context_obj.get_result_value_kind(),
        "unit_label": str(
            context_obj.get_result_config().get(Tournament.RESULTCFG_UNIT_LABEL_KEY)
            or context_obj.get_result_config().get(Tournament.RESULTCFG_UNIT_KEY)
            or ""
        ).strip(),
        "allow_ties": bool(
            context_obj.get_result_config().get(Tournament.RESULTCFG_ALLOW_TIES_KEY, True)
        ),
        "stages": payload_stages,
    }


def _stage_entry_team_ids(stage: Stage) -> list[int]:
    return list(
        StageMassStartEntry.objects.filter(stage=stage, is_active=True)
        .order_by("seed", "team_id", "id")
        .values_list("team_id", flat=True)
    )


def _stage_rounds_count(stage: Stage) -> int:
    context_obj = _competition_context(getattr(stage, "division", None), stage.tournament)
    stage_cfg = _stage_cfg_for_order(context_obj, stage.order)
    return int(stage_cfg.get(Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY) or 1)


def _stage_has_all_required_results(stage: Stage) -> bool:
    team_ids = _stage_entry_team_ids(stage)
    if not team_ids:
        return False

    expected_count = len(team_ids) * _stage_rounds_count(stage)
    saved_pairs = set(
        StageMassStartResult.objects.filter(
            stage=stage,
            team_id__in=team_ids,
            is_active=True,
        ).values_list("team_id", "round_number")
    )
    return len(saved_pairs) >= expected_count


def _close_stage_if_complete(stage: Stage) -> bool:
    if stage.status != Stage.Status.OPEN:
        return False

    if not _stage_has_all_required_results(stage):
        return False

    stage.status = Stage.Status.CLOSED
    stage.save(update_fields=["status"])
    return True


class TournamentMassStartResultListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def _get_tournament(self, pk: int) -> Tournament:
        tournament = get_object_or_404(Tournament, pk=pk)
        user = self.request.user
        is_panel_user = (
            tournament.organizer_id == user.id or user_is_assistant(user, tournament)
        )
        if not is_panel_user:
            raise PermissionError("Brak dostępu do wyników etapowych tego turnieju.")
        return tournament

    def get(self, request, pk: int, *args, **kwargs):
        try:
            tournament = self._get_tournament(pk)
        except PermissionError as exc:
            return Response(
                {"detail": str(exc)},
                status=status.HTTP_403_FORBIDDEN,
            )

        division = _resolve_division_from_request(request, tournament)
        context_obj = _competition_context(division, tournament)
        if not context_obj.uses_custom_results() or not context_obj.uses_mass_start():
            return Response(
                {"detail": "Aktywna dywizja nie używa trybu MASS_START."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(_build_response_payload(tournament, division), status=status.HTTP_200_OK)

    @transaction.atomic
    def post(self, request, pk: int, *args, **kwargs):
        try:
            tournament = self._get_tournament(pk)
        except PermissionError as exc:
            return Response(
                {"detail": str(exc)},
                status=status.HTTP_403_FORBIDDEN,
            )

        division = _resolve_division_from_request(request, tournament)
        context_obj = _competition_context(division, tournament)
        if not context_obj.uses_custom_results() or not context_obj.uses_mass_start():
            return Response(
                {"detail": "Aktywna dywizja nie używa trybu MASS_START."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = StageMassStartResultWriteSerializer(
            data=request.data,
            context={"tournament": tournament, "division": division, "user": request.user},
        )
        serializer.is_valid(raise_exception=True)
        result = serializer.save()

        if result.stage.status == Stage.Status.PLANNED:
            return Response(
                {"detail": "Nie można zapisywać wyników dla etapu, który nie został jeszcze wygenerowany."},
                status=status.HTTP_409_CONFLICT,
            )

        group = result.group
        _compute_group_rankings(result.stage, group, persist=True)
        stage_closed = _close_stage_if_complete(result.stage)

        event_payload = {
            "division_id": result.stage.division_id,
            "stage_id": result.stage_id,
            "group_id": result.group_id,
        }
        if stage_closed:
            event_payload["stage_status"] = Stage.Status.CLOSED

        ws_emit_tournament(
            tournament.id,
            "mass_start_results_changed",
            event_payload,
        )

        detail = "Wynik etapowy zapisany."
        if stage_closed:
            detail = "Wynik etapowy zapisany. Etap został automatycznie zamknięty."

        return Response(
            {
                "detail": detail,
                "result": StageMassStartResultSerializer(result).data,
                "payload": _build_response_payload(tournament, result.stage.division),
            },
            status=status.HTTP_200_OK,
        )


class TournamentPublicMassStartResultListView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, pk: int, *args, **kwargs):
        tournament = get_object_or_404(Tournament, pk=pk)

        denied = public_access_or_403(request, tournament)
        if denied is not None:
            return denied

        division = _resolve_division_from_request(request, tournament)
        context_obj = _competition_context(division, tournament)
        if not context_obj.uses_custom_results() or not context_obj.uses_mass_start():
            return Response(
                {"detail": "Aktywna dywizja nie używa trybu MASS_START."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(_build_response_payload(tournament, division), status=status.HTTP_200_OK)
