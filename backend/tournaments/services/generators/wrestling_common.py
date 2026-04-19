# backend/tournaments/services/generators/wrestling_common.py
# Plik udostępnia współdzielone helpery do generatorów zapasów bez ingerencji w istniejące generatory innych dyscyplin.

from __future__ import annotations

import math
from typing import Iterable, List, Sequence, Tuple

from django.db import transaction

from tournaments.models import Division, Group, Stage, Team, Tournament

BYE_TEAM_NAME = "__SYSTEM_BYE__"


def resolve_division(tournament: Tournament, division: Division | None = None) -> Division | None:
    if division is None:
        return tournament.get_default_division()

    if division.tournament_id != tournament.id:
        raise ValueError("Wskazana dywizja nie należy do tego turnieju.")

    return division


def runtime_status(tournament: Tournament, division: Division | None) -> str:
    return division.status if division is not None else tournament.status


def runtime_format_config(tournament: Tournament, division: Division | None) -> dict:
    if division is not None:
        return dict(division.format_config or {})
    return dict(tournament.format_config or {})


def promote_after_generation(tournament: Tournament, division: Division | None) -> None:
    if division is not None and division.status == Tournament.Status.DRAFT:
        division.status = Tournament.Status.CONFIGURED
        division.save(update_fields=["status"])

    if tournament.status == Tournament.Status.DRAFT:
        tournament.status = Tournament.Status.CONFIGURED
        tournament.save(update_fields=["status"])


def validate_wrestling_runtime(tournament: Tournament, division: Division | None) -> None:
    if tournament.discipline != Tournament.Discipline.WRESTLING:
        raise ValueError("Helpery wrestling_common obsługują wyłącznie dyscyplinę WRESTLING.")

    status_value = runtime_status(tournament, division)
    if status_value not in {
        Tournament.Status.DRAFT,
        Tournament.Status.CONFIGURED,
        Tournament.Status.RUNNING,
    }:
        raise ValueError(
            "Struktura zapasów może być generowana tylko dla dywizji w statusie DRAFT/CONFIGURED/RUNNING."
        )


def get_active_wrestlers(tournament: Tournament, division: Division | None) -> List[Team]:
    teams_qs = tournament.teams.filter(is_active=True).exclude(name=BYE_TEAM_NAME)
    if division is not None:
        teams_qs = teams_qs.filter(division=division)

    teams = list(teams_qs.order_by("id"))
    if len(teams) < 2:
        raise ValueError("Zapasy wymagają co najmniej 2 aktywnych uczestników.")
    return teams


def get_or_create_bye_team(tournament: Tournament, division: Division | None) -> Team:
    team, _created = Team.objects.get_or_create(
        tournament=tournament,
        division=division,
        name=BYE_TEAM_NAME,
        defaults={"is_active": False},
    )
    if team.is_active:
        team.is_active = False
        team.save(update_fields=["is_active"])
    return team


def create_stage(
    tournament: Tournament,
    *,
    division: Division | None,
    stage_type: str,
    order: int,
    status: str = Stage.Status.OPEN,
) -> Stage:
    return Stage.objects.create(
        tournament=tournament,
        division=division,
        stage_type=stage_type,
        order=order,
        status=status,
    )


def next_stage_order(tournament: Tournament, division: Division | None) -> int:
    stages_qs = Stage.objects.filter(tournament=tournament)
    if division is not None:
        stages_qs = stages_qs.filter(division=division)

    last_stage = stages_qs.order_by("-order").first()
    return (last_stage.order + 1) if last_stage else 1


def resolve_wrestling_competition_mode(
    tournament: Tournament,
    division: Division | None,
    wrestlers_count: int,
) -> str:
    cfg = runtime_format_config(tournament, division)
    requested = str(
        cfg.get(Tournament.FORMATCFG_WRESTLING_MODE_KEY)
        or Tournament.WrestlingCompetitionMode.AUTO
    ).upper()

    if requested == Tournament.WrestlingCompetitionMode.AUTO:
        if wrestlers_count < 6:
            return Tournament.WrestlingCompetitionMode.NORDIC
        if wrestlers_count in (6, 7):
            return Tournament.WrestlingCompetitionMode.TWO_POOLS
        return Tournament.WrestlingCompetitionMode.ELIMINATION_REPECHAGE

    return requested


def split_evenly(items: Sequence[Team], buckets: int) -> List[List[Team]]:
    if buckets < 1:
        raise ValueError("Liczba bucketów musi być >= 1.")

    n = len(items)
    base_size = n // buckets
    extra = n % buckets

    result: list[list[Team]] = []
    idx = 0
    for i in range(buckets):
        size = base_size + (1 if i < extra else 0)
        result.append(list(items[idx : idx + size]))
        idx += size
    return result


def create_named_groups(stage: Stage, groups: Sequence[Sequence[Team]]) -> List[Tuple[Group, List[Team]]]:
    created: list[tuple[Group, list[Team]]] = []
    for index, group_teams in enumerate(groups, start=1):
        group = Group.objects.create(stage=stage, name=f"Grupa {index}")
        created.append((group, list(group_teams)))
    return created


def round_robin_schedule(teams: Sequence[Team]) -> List[List[Tuple[Team, Team]]]:
    arr: List[Team | None] = list(teams)

    if len(arr) % 2 == 1:
        arr.append(None)

    n = len(arr)
    rounds = n - 1
    half = n // 2
    schedule: list[list[tuple[Team, Team]]] = []

    for _ in range(rounds):
        round_matches: list[tuple[Team, Team]] = []
        for i in range(half):
            team_one = arr[i]
            team_two = arr[n - 1 - i]
            if team_one is not None and team_two is not None:
                round_matches.append((team_one, team_two))

        schedule.append(round_matches)
        arr = [arr[0]] + [arr[-1]] + arr[1:-1]

    return schedule


def next_power_of_two(n: int) -> int:
    if n <= 1:
        return 1
    return 2 ** math.ceil(math.log2(n))


@transaction.atomic
def reset_division_stages(tournament: Tournament, division: Division | None) -> None:
    stages_qs = Stage.objects.filter(tournament=tournament)
    if division is not None:
        stages_qs = stages_qs.filter(division=division)
    stages_qs.delete()
