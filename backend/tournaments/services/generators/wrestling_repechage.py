# backend/tournaments/services/generators/wrestling_repechage.py
# Plik generuje bazową drabinkę eliminacji bezpośredniej dla zapasów, pod którą później można podpiąć repasaże.

from __future__ import annotations

from django.db import transaction

from tournaments.models import Division, Match, Stage, Team, Tournament
from tournaments.services.generators.wrestling_common import (
    create_stage,
    get_active_wrestlers,
    get_or_create_bye_team,
    next_power_of_two,
    next_stage_order,
    promote_after_generation,
    resolve_division,
    validate_wrestling_runtime,
)


def _validate_repechage_size(wrestlers_count: int) -> None:
    if wrestlers_count < 8:
        raise ValueError(
            "System eliminacji z repasażami dla zapasów wymaga co najmniej 8 aktywnych zawodników."
        )


def _build_first_round_pairs(
    wrestlers: list[Team],
    byes_count: int,
    bye_team: Team | None,
) -> list[tuple[Team, Team]]:
    if byes_count < 0:
        raise ValueError("byes_count nie może być ujemne.")

    if byes_count == 0:
        if len(wrestlers) % 2 != 0:
            raise ValueError("Dla braku BYE liczba zawodników musi być parzysta.")
        return [(wrestlers[index], wrestlers[index + 1]) for index in range(0, len(wrestlers), 2)]

    if bye_team is None:
        raise ValueError("byes_count > 0 wymaga technicznego zawodnika BYE.")

    if byes_count >= len(wrestlers):
        raise ValueError("Nieprawidłowa liczba BYE względem liczby zawodników.")

    bye_wrestlers = wrestlers[:byes_count]
    play_wrestlers = wrestlers[byes_count:]

    if len(play_wrestlers) % 2 != 0:
        raise ValueError(
            "Błąd seeding zapasów: liczba zawodników grających w 1 rundzie musi być parzysta."
        )

    pairs: list[tuple[Team, Team]] = []
    pairs.extend([(wrestler, bye_team) for wrestler in bye_wrestlers])
    pairs.extend(
        [
            (play_wrestlers[index], play_wrestlers[index + 1])
            for index in range(0, len(play_wrestlers), 2)
        ]
    )
    return pairs


def _build_matches_for_pairs(
    tournament: Tournament,
    stage: Stage,
    pairs: list[tuple[Team, Team]],
    bye_team: Team | None,
) -> list[Match]:
    matches: list[Match] = []
    bye_id = bye_team.id if bye_team else None

    for home, away in pairs:
        # Wolny los zamyka parę od razu i awansuje zawodnika bez dodatkowej walki.
        if bye_id is not None and away.id == bye_id:
            matches.append(
                Match(
                    tournament=tournament,
                    stage=stage,
                    home_team=home,
                    away_team=away,
                    round_number=1,
                    status=Match.Status.FINISHED,
                    winner=home,
                    home_score=1,
                    away_score=0,
                )
            )
            continue

        matches.append(
            Match(
                tournament=tournament,
                stage=stage,
                home_team=home,
                away_team=away,
                round_number=1,
                status=Match.Status.SCHEDULED,
            )
        )

    return matches


@transaction.atomic
def generate_wrestling_repechage_stage(
    tournament: Tournament,
    division: Division | None = None,
) -> Stage:
    division = resolve_division(tournament, division)

    validate_wrestling_runtime(tournament, division)

    wrestlers = get_active_wrestlers(tournament, division)
    _validate_repechage_size(len(wrestlers))

    order = next_stage_order(tournament, division)
    stage = create_stage(
        tournament,
        division=division,
        stage_type=Stage.StageType.KNOCKOUT,
        order=order,
        status=Stage.Status.OPEN,
    )

    bracket_size = next_power_of_two(len(wrestlers))
    byes_count = bracket_size - len(wrestlers)

    bye_team: Team | None = None
    if byes_count > 0:
        bye_team = get_or_create_bye_team(tournament, division)

    pairs = _build_first_round_pairs(
        wrestlers=wrestlers,
        byes_count=byes_count,
        bye_team=bye_team,
    )

    matches = _build_matches_for_pairs(
        tournament=tournament,
        stage=stage,
        pairs=pairs,
        bye_team=bye_team,
    )

    if not matches:
        raise ValueError("Generator eliminacji z repasażami nie utworzył żadnych walk.")

    Match.objects.bulk_create(matches)
    promote_after_generation(tournament, division)

    return stage
