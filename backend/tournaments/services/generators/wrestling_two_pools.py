# backend/tournaments/services/generators/wrestling_two_pools.py
# Plik generuje etap dwóch grup dla zapasów jako pierwszy krok systemu 6-7 zawodników.

from __future__ import annotations

from django.db import transaction

from tournaments.models import Division, Match, Stage, Tournament
from tournaments.services.generators.wrestling_common import (
    create_named_groups,
    create_stage,
    get_active_wrestlers,
    next_stage_order,
    promote_after_generation,
    resolve_division,
    round_robin_schedule,
    split_evenly,
    validate_wrestling_runtime,
)


def _validate_two_pools_size(wrestlers_count: int) -> None:
    if wrestlers_count not in (6, 7):
        raise ValueError(
            "System dwóch grup dla zapasów jest przeznaczony dla 6 albo 7 aktywnych zawodników."
        )


@transaction.atomic
def generate_wrestling_two_pools_stage(
    tournament: Tournament,
    division: Division | None = None,
) -> Stage:
    division = resolve_division(tournament, division)

    validate_wrestling_runtime(tournament, division)

    wrestlers = get_active_wrestlers(tournament, division)
    _validate_two_pools_size(len(wrestlers))

    order = next_stage_order(tournament, division)
    stage = create_stage(
        tournament,
        division=division,
        stage_type=Stage.StageType.GROUP,
        order=order,
        status=Stage.Status.OPEN,
    )

    groups_seed = split_evenly(wrestlers, 2)
    groups = create_named_groups(stage, groups_seed)

    matches: list[Match] = []
    for group, group_wrestlers in groups:
        schedule = round_robin_schedule(group_wrestlers)
        current_round = 1

        for round_pairs in schedule:
            for home, away in round_pairs:
                matches.append(
                    Match(
                        tournament=tournament,
                        stage=stage,
                        group=group,
                        home_team=home,
                        away_team=away,
                        round_number=current_round,
                        status=Match.Status.SCHEDULED,
                    )
                )
            current_round += 1

    if not matches:
        raise ValueError("Generator dwóch grup nie utworzył żadnych walk.")

    Match.objects.bulk_create(matches)
    promote_after_generation(tournament, division)

    return stage
