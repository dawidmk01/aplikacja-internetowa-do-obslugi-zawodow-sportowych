# backend/tournaments/services/advance_mass_start_stage.py
# Plik udostępnia use-case generowania kolejnego etapu MASS_START dla aktywnej dywizji.

from __future__ import annotations

from collections import defaultdict
from decimal import Decimal
from typing import Any

from django.db import transaction

from tournaments.models import Division, Group, Stage, StageMassStartEntry, StageMassStartResult, Tournament


def _resolve_division(tournament: Tournament, division: Division | None = None) -> Division | None:
    if division is None:
        return tournament.get_default_division()

    if division.tournament_id != tournament.id:
        raise ValueError("Wskazana dywizja nie należy do tego turnieju.")

    return division


def _runtime_context(
    tournament: Tournament,
    division: Division | None,
):
    return division or tournament


def _stage_cfg_for_order(context, order: int) -> dict:
    cfgs = list(context.get_mass_start_stages() or [])
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

    # Fallback utrzymuje wybór najlepszego wyniku zależnie od kierunku rankingu.
    return min(only_values) if lower_is_better else max(only_values)


def _entry_team_ids_for_group(stage: Stage, group: Group | None) -> list[int]:
    qs = StageMassStartEntry.objects.filter(stage=stage, is_active=True)
    if group is None:
        qs = qs.filter(group__isnull=True)
    else:
        qs = qs.filter(group=group)

    return list(qs.order_by("seed", "team_id", "id").values_list("team_id", flat=True))


def _compute_group_rankings(context, stage: Stage, group: Group | None) -> list[dict[str, Any]]:
    stage_cfg = _stage_cfg_for_order(context, stage.order)
    aggregation_mode = str(
        stage_cfg.get(Tournament.RESULTCFG_STAGE_AGGREGATION_MODE_KEY)
        or context.get_result_config().get(Tournament.RESULTCFG_AGGREGATION_MODE_KEY)
        or Tournament.RESULTCFG_AGGREGATION_BEST
    ).upper()

    lower_is_better = (
        context.result_is_time()
        or context.result_is_place()
        or context.custom_result_lower_is_better()
    )
    allow_ties = bool(
        context.get_result_config().get(Tournament.RESULTCFG_ALLOW_TIES_KEY, True)
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

    # Nadawanie miejsc obsługuje remisy według konfiguracji dywizji.
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


def _ensure_mass_start_context(context) -> None:
    if not context.uses_custom_results() or not context.uses_mass_start():
        raise ValueError("Ta dywizja nie używa trybu MASS_START.")


def _get_open_stage(
    tournament: Tournament,
    division: Division | None,
) -> Stage:
    stage_qs = Stage.objects.filter(
        tournament=tournament,
        stage_type=Stage.StageType.MASS_START,
        status=Stage.Status.OPEN,
    )
    if division is not None:
        stage_qs = stage_qs.filter(division=division)

    stage = stage_qs.order_by("order", "id").first()
    if not stage:
        raise ValueError("Brak otwartego etapu MASS_START do zamknięcia.")
    return stage


def _ensure_stage_complete(context, stage: Stage) -> None:
    stage_cfg = _stage_cfg_for_order(context, stage.order)
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

    # Pełna kompletność wyników blokuje awans do następnego etapu przedwcześnie.
    for team_id in expected_team_ids:
        team_rounds = set(
            results.filter(team_id=team_id).values_list("round_number", flat=True)
        )
        missing = [
            round_number
            for round_number in range(1, rounds_count + 1)
            if round_number not in team_rounds
        ]
        if missing:
            raise ValueError(
                f"Nie można wygenerować następnego etapu. Brakuje wyników dla uczestnika id={team_id}."
            )


def _collect_advancers(
    tournament: Tournament,
    context,
    stage: Stage,
    division: Division | None,
) -> list[int]:
    stage_cfg = _stage_cfg_for_order(context, stage.order)
    advance_count_raw = stage_cfg.get(Tournament.RESULTCFG_STAGE_ADVANCE_COUNT_KEY)

    next_stage_qs = Stage.objects.filter(
        tournament=tournament,
        stage_type=Stage.StageType.MASS_START,
        order=stage.order + 1,
    )
    if division is not None:
        next_stage_qs = next_stage_qs.filter(division=division)

    next_stage = next_stage_qs.order_by("id").first()

    next_cfg = _stage_cfg_for_order(context, stage.order + 1)
    next_participants_raw = next_cfg.get(Tournament.RESULTCFG_STAGE_PARTICIPANTS_COUNT_KEY)
    desired_total = int(advance_count_raw) if advance_count_raw else None

    if desired_total is None and next_participants_raw:
        desired_total = int(next_participants_raw)

    ranking_rows: list[dict[str, Any]] = []
    groups = list(stage.groups.all().order_by("id"))

    for group in groups:
        for row in _compute_group_rankings(context, stage, group):
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

    # Rozkład grup utrzymuje możliwie równą obsadę następnego etapu.
    for index, group in enumerate(groups):
        size = base + (1 if index < extra else 0)
        for team_id in team_ids[cursor : cursor + size]:
            out.append((team_id, group.id, seed))
            seed += 1
        cursor += size

    return out


def _promote_after_generation(
    tournament: Tournament,
    division: Division | None,
) -> None:
    if division is not None and division.status == Tournament.Status.DRAFT:
        division.status = Tournament.Status.CONFIGURED
        division.save(update_fields=["status"])

    if tournament.status == Tournament.Status.DRAFT:
        tournament.status = Tournament.Status.CONFIGURED
        tournament.save(update_fields=["status"])


def _mark_finished(
    tournament: Tournament,
    division: Division | None,
) -> None:
    if division is None:
        tournament.status = Tournament.Status.FINISHED
        tournament.save(update_fields=["status"])
        return

    division.status = Tournament.Status.FINISHED
    division.save(update_fields=["status"])

    active_divisions = tournament.divisions.filter(is_archived=False)
    if active_divisions.exists() and not active_divisions.exclude(status=Tournament.Status.FINISHED).exists():
        tournament.status = Tournament.Status.FINISHED
        tournament.save(update_fields=["status"])


@transaction.atomic
def advance_mass_start_stage(
    tournament: Tournament,
    division: Division | None = None,
) -> Stage:
    division = _resolve_division(tournament, division)
    context = _runtime_context(tournament, division)

    _ensure_mass_start_context(context)

    current_stage = _get_open_stage(tournament, division)
    _ensure_stage_complete(context, current_stage)

    next_stage_qs = Stage.objects.filter(
        tournament=tournament,
        stage_type=Stage.StageType.MASS_START,
        order=current_stage.order + 1,
    )
    if division is not None:
        next_stage_qs = next_stage_qs.filter(division=division)

    next_stage = next_stage_qs.order_by("id").first()
    advancers = _collect_advancers(tournament, context, current_stage, division)

    current_stage.status = Stage.Status.CLOSED
    current_stage.save(update_fields=["status"])

    if next_stage is None:
        _mark_finished(tournament, division)
        return current_stage

    if next_stage.status != Stage.Status.PLANNED:
        raise ValueError("Następny etap MASS_START został już wcześniej wygenerowany.")

    assignments = _assign_groups(next_stage, advancers)

    keep_ids: list[int] = []
    existing_by_team = {
        entry.team_id: entry
        for entry in StageMassStartEntry.objects.filter(stage=next_stage).order_by("id")
    }

    # Aktualizacja wpisów zachowuje istniejące rekordy, jeśli uczestnik już był przygotowany.
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

    _promote_after_generation(tournament, division)
    return next_stage
