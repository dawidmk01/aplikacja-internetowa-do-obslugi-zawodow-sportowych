"""
Generator fazy grupowej turnieju (format MIXED).

Kluczowe zasady po poprawce:
- faza grupowa NIE używa BYE jako drużyny technicznej,
  bo przy nieparzystej liczbie drużyn po prostu ktoś pauzuje w kolejce;
- liczba grup ma wynikać z cfg.groups_count (stała, jeśli tak ustawisz w UI),
  a nie z teams_per_group.
"""

from __future__ import annotations

from typing import List, Tuple, Optional
from django.db import transaction

from tournaments.models import Tournament, Stage, Group, Match, Team


BYE_TEAM_NAME = "__SYSTEM_BYE__"


@transaction.atomic
def generate_group_stage(tournament: Tournament) -> Stage:
    _validate_tournament(tournament)

    teams = _get_active_teams(tournament)  # ✅ bez BYE
    cfg = tournament.format_config or {}

    groups_count = int(cfg.get("groups_count", 2))
    group_matches = int(cfg.get("group_matches", 1))  # 1 lub 2

    if groups_count < 1:
        raise ValueError("Liczba grup (groups_count) musi być >= 1.")

    if group_matches not in (1, 2):
        raise ValueError("group_matches musi wynosić 1 albo 2.")

    # ✅ każda grupa musi mieć min. 2 zespoły
    if len(teams) < 2 * groups_count:
        raise ValueError(
            f"Za mało uczestników ({len(teams)}) na {groups_count} grup. "
            f"Minimalnie potrzeba {2 * groups_count}."
        )

    stage = Stage.objects.create(
        tournament=tournament,
        stage_type=Stage.StageType.GROUP,
        order=1,
    )

    groups = _split_into_groups(stage, teams, groups_count)

    matches: list[Match] = []

    for group, group_teams in groups:
        schedule = _round_robin_schedule(group_teams)
        current_round = 1

        for leg in range(group_matches):
            for round_pairs in schedule:
                for home, away in round_pairs:
                    if leg == 1:
                        home, away = away, home

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
        raise ValueError("Generator fazy grupowej nie utworzył żadnych meczów.")

    Match.objects.bulk_create(matches)

    tournament.status = Tournament.Status.CONFIGURED
    tournament.save(update_fields=["status"])

    return stage


def _validate_tournament(tournament: Tournament) -> None:
    if tournament.status != Tournament.Status.DRAFT:
        raise ValueError("Fazę grupową można generować tylko dla turnieju w statusie DRAFT.")

    if tournament.tournament_format != Tournament.TournamentFormat.MIXED:
        raise ValueError("Generator fazy grupowej obsługuje wyłącznie format MIXED.")


def _get_active_teams(tournament: Tournament) -> List[Team]:
    teams = list(
        tournament.teams
        .filter(is_active=True)
        .exclude(name=BYE_TEAM_NAME)
        .order_by("id")
    )
    if len(teams) < 2:
        raise ValueError("Faza grupowa wymaga co najmniej 2 aktywnych uczestników.")
    return teams


def _split_into_groups(stage: Stage, teams: List[Team], groups_count: int) -> List[tuple[Group, List[Team]]]:
    """
    Tworzy DOKŁADNIE groups_count grup i rozkłada zespoły możliwie równo.
    Przykład: 13 zespołów / 2 grupy => 7 i 6.
    """
    groups: list[tuple[Group, List[Team]]] = []

    n = len(teams)
    base = n // groups_count
    extra = n % groups_count  # pierwsze "extra" grup dostaną +1

    idx = 0
    for i in range(groups_count):
        size = base + (1 if i < extra else 0)
        group_teams = teams[idx: idx + size]
        idx += size

        group = Group.objects.create(stage=stage, name=f"Grupa {i + 1}")
        groups.append((group, group_teams))

    return groups


def _round_robin_schedule(teams: List[Team]) -> List[List[Tuple[Team, Team]]]:
    """
    Round-robin bez BYE jako drużyny.
    Jeśli nieparzysta liczba zespołów -> w danej kolejce ktoś pauzuje (None),
    ale NIE tworzymy meczu technicznego.
    """
    arr: List[Optional[Team]] = list(teams)

    if len(arr) % 2 == 1:
        arr.append(None)

    n = len(arr)
    rounds = n - 1
    half = n // 2

    schedule: list[list[tuple[Team, Team]]] = []

    for _ in range(rounds):
        round_matches: list[tuple[Team, Team]] = []

        for i in range(half):
            t1 = arr[i]
            t2 = arr[n - 1 - i]
            if t1 is not None and t2 is not None:
                round_matches.append((t1, t2))

        schedule.append(round_matches)

        # algorytm kołowy
        arr = [arr[0]] + [arr[-1]] + arr[1:-1]

    return schedule
