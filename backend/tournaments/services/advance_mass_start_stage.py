# backend/tournaments/services/advance_mass_start_stage.py
# Plik udostępnia use-case generowania kolejnego etapu MASS_START na podstawie rankingu bieżącego etapu.

from __future__ import annotations

from collections import defaultdict
from decimal import Decimal
from typing import Any

from django.db import transaction

from tournaments.models import (
    Group,
    Stage,
    StageMassStartEntry,
    StageMassStartResult,
    Team,
    Tournament,
)


def _stage_cfg_for_order(tournament: Tournament, order: int) -> dict:
    cfgs = list(tournament.get_mass_start_stages() or [])
    if 1 <= order <= len(cfgs):
        cfg = cfgs[order - 1]
        return cfg if isinstance(cfg, dict) else {}
    return {}


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


def _entry_team_ids_for_group(stage: Stage, group: Group | None) -> list[int]:
    qs = StageMassStartEntry.objects.filter(stage=stage, is_active=True)
    if group is None:
        qs = qs.filter(group__isnull=True)
    else:
        qs = qs.filter(group=group)

    return list(qs.order_by("seed", "team_id", "id").values_list("team_id", flat=True))


def _compute_group_rankings(tournament: Tournament, stage: Stage, group: Group | None) -> list[dict[str, Any]]:
    stage_cfg = _stage_cfg_for_order(tournament, stage.order)
    aggregation_mode = str(
        stage_cfg.get(Tournament.RESULTCFG_STAGE_AGGREGATION_MODE_KEY)
        or tournament.get_result_config().get(Tournament.RESULTCFG_AGGREGATION_MODE_KEY)
        or Tournament.RESULTCFG_AGGREGATION_BEST
    ).upper()

    lower_is_better = (
        tournament.result_is_time()
        or tournament.result_is_place()
        or tournament.custom_result_lower_is_better()
    )
    allow_ties = bool(
        tournament.get_result_config().get(Tournament.RESULTCFG_ALLOW_TIES_KEY, True)
    )

    team_ids = _entry_team_ids_for_group(stage, group)
    if not team_ids:
        return []

    results = list(
        StageMassStartResult.objects.filter(
            stage=stage,
            team_id__in=team_ids,
            is_active=True,
            group=group,
        )
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
                "aggregate_value": aggregate_value,
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
    out: list[dict[str, Any]] = []

    for index, row in enumerate(ranking_rows, start=1):
        current_value = row["aggregate_value"]
        if allow_ties and previous_value is not None and current_value == previous_value:
            rank = previous_rank
        else:
            rank = index

        out.append(
            {
                "team_id": row["team_id"],
                "rank": rank,
                "aggregate_value": current_value,
            }
        )

        previous_value = current_value
        previous_rank = rank

    return out


def _ensure_mass_start_tournament(tournament: Tournament) -> None:
    if not tournament.uses_custom_results() or not tournament.uses_mass_start():
        raise ValueError("Ten turniej nie używa trybu MASS_START.")


def _get_open_stage(tournament: Tournament) -> Stage:
    stage = (
        Stage.objects.filter(
            tournament=tournament,
            stage_type=Stage.StageType.MASS_START,
            status=Stage.Status.OPEN,
        )
        .order_by("order", "id")
        .first()
    )
    if not stage:
        raise ValueError("Brak otwartego etapu MASS_START do zamknięcia.")
    return stage


def _ensure_stage_complete(tournament: Tournament, stage: Stage) -> None:
    stage_cfg = _stage_cfg_for_order(tournament, stage.order)
    rounds_count = int(stage_cfg.get(Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY) or 1)

    entries = list(
        StageMassStartEntry.objects.filter(stage=stage, is_active=True)
        .order_by("group_id", "seed", "team_id", "id")
    )
    if not entries:
        raise ValueError("Bieżący etap nie ma wygenerowanej obsady.")

    expected_team_ids = {entry.team_id for entry in entries}
    results = StageMassStartResult.objects.filter(
        stage=stage,
        is_active=True,
        team_id__in=expected_team_ids,
    )

    for team_id in expected_team_ids:
        team_rounds = set(
            results.filter(team_id=team_id).values_list("round_number", flat=True)
        )
        missing = [round_number for round_number in range(1, rounds_count + 1) if round_number not in team_rounds]
        if missing:
            raise ValueError(
                f"Nie można wygenerować następnego etapu. Brakuje wyników dla uczestnika id={team_id}."
            )


def _collect_advancers(tournament: Tournament, stage: Stage) -> list[int]:
    stage_cfg = _stage_cfg_for_order(tournament, stage.order)
    advance_count_raw = stage_cfg.get(Tournament.RESULTCFG_STAGE_ADVANCE_COUNT_KEY)

    next_stage = (
        Stage.objects.filter(
            tournament=tournament,
            stage_type=Stage.StageType.MASS_START,
            order=stage.order + 1,
        )
        .order_by("id")
        .first()
    )

    next_cfg = _stage_cfg_for_order(tournament, stage.order + 1)
    next_participants_raw = next_cfg.get(Tournament.RESULTCFG_STAGE_PARTICIPANTS_COUNT_KEY)
    desired_total = int(advance_count_raw) if advance_count_raw else None

    if desired_total is None and next_participants_raw:
        desired_total = int(next_participants_raw)

    ranking_rows: list[dict[str, Any]] = []
    groups = list(stage.groups.all().order_by("id"))

    for group in groups:
        for row in _compute_group_rankings(tournament, stage, group):
            ranking_rows.append(
                {
                    "team_id": row["team_id"],
                    "group_id": group.id,
                    "rank": row["rank"],
                }
            )

    ranking_rows.sort(key=lambda item: (item["rank"], item["group_id"], item["team_id"]))

    if not ranking_rows:
        raise ValueError("Nie udało się wyznaczyć klasyfikacji bieżącego etapu.")

    advancers: list[int] = []
    seen: set[int] = set()
    for row in ranking_rows:
        team_id = row["team_id"]
        if team_id in seen:
            continue
        advancers.append(team_id)
        seen.add(team_id)
        if desired_total and len(advancers) >= desired_total:
            break

    if not advancers:
        raise ValueError("Nie udało się wyznaczyć uczestników następnego etapu.")

    if next_stage is None:
        if len(advancers) == 1:
            return advancers
        raise ValueError("Brak kolejnego etapu do wygenerowania.")

    return advancers


def _assign_groups(next_stage: Stage, team_ids: list[int]) -> list[tuple[int, int | None, int]]:
    groups = list(next_stage.groups.all().order_by("id"))
    if not groups:
        return [(team_id, None, seed) for seed, team_id in enumerate(team_ids, start=1)]

    if len(groups) == 1:
        return [(team_id, groups[0].id, seed) for seed, team_id in enumerate(team_ids, start=1)]

    count = len(groups)
    base = len(team_ids) // count
    extra = len(team_ids) % count

    out: list[tuple[int, int | None, int]] = []
    cursor = 0
    seed = 1

    for index, group in enumerate(groups):
        size = base + (1 if index < extra else 0)
        for team_id in team_ids[cursor : cursor + size]:
            out.append((team_id, group.id, seed))
            seed += 1
        cursor += size

    return out


@transaction.atomic
def advance_mass_start_stage(tournament: Tournament) -> Stage:
    _ensure_mass_start_tournament(tournament)

    current_stage = _get_open_stage(tournament)
    _ensure_stage_complete(tournament, current_stage)

    next_stage = (
        Stage.objects.filter(
            tournament=tournament,
            stage_type=Stage.StageType.MASS_START,
            order=current_stage.order + 1,
        )
        .order_by("id")
        .first()
    )

    advancers = _collect_advancers(tournament, current_stage)

    current_stage.status = Stage.Status.CLOSED
    current_stage.save(update_fields=["status"])

    if next_stage is None:
        tournament.status = Tournament.Status.FINISHED
        tournament.save(update_fields=["status"])
        return current_stage

    if next_stage.status != Stage.Status.PLANNED:
        raise ValueError("Następny etap MASS_START został już wcześniej wygenerowany.")

    assignments = _assign_groups(next_stage, advancers)

    keep_ids: list[int] = []
    existing_by_team = {
        entry.team_id: entry
        for entry in StageMassStartEntry.objects.filter(stage=next_stage).order_by("id")
    }

    for team_id, group_id, seed in assignments:
        entry = existing_by_team.get(team_id)
        if entry is None:
            entry = StageMassStartEntry(
                stage=next_stage,
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
        keep_ids.append(entry.id)

    StageMassStartEntry.objects.filter(stage=next_stage).exclude(id__in=keep_ids).delete()

    next_stage.status = Stage.Status.OPEN
    next_stage.save(update_fields=["status"])

    if tournament.status == Tournament.Status.DRAFT:
        tournament.status = Tournament.Status.CONFIGURED
        tournament.save(update_fields=["status"])

    return next_stage