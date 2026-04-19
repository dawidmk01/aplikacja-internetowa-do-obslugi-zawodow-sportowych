# backend/tournaments/services/generators/wrestling_nordic.py
# Plik generuje system Nordic dla zapasów, czyli jedną grupę z walkami każdy z każdym.

from __future__ import annotations

from django.db import transaction

from tournaments.models import Division, Group, Match, Stage, Tournament
from tournaments.services.generators.wrestling_common import (
    create_stage,
    get_active_wrestlers,
    next_stage_order,
    promote_after_generation,
    resolve_division,
    round_robin_schedule,
    validate_wrestling_runtime,
)


@transaction.atomic
def generate_wrestling_nordic_stage(
    tournament: Tournament,
    division: Division | None = None,
) -> Stage:
    division = resolve_division(tournament, division)

    validate_wrestling_runtime(tournament, division)

    wrestlers = get_active_wrestlers(tournament, division)
    if len(wrestlers) < 3:
        raise ValueError("System Nordic wymaga co najmniej 3 aktywnych zawodników.")

    order = next_stage_order(tournament, division)
    stage = create_stage(
        tournament,
        division=division,
        stage_type=Stage.StageType.GROUP,
        order=order,
        status=Stage.Status.OPEN,
    )

    group = Group.objects.create(stage=stage, name="Nordic")
    schedule = round_robin_schedule(wrestlers)

    matches: list[Match] = []
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
        raise ValueError("Generator Nordic nie utworzył żadnych walk.")

    Match.objects.bulk_create(matches)
    promote_after_generation(tournament, division)

    return stage
