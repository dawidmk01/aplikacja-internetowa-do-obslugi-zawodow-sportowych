"""
Generator fazy grupowej turnieju (dla formatu MIXED).

Odpowiada za:
- podział uczestników na grupy,
- generowanie kolejek round-robin w ramach każdej grupy,
- obsługę 1 lub 2 meczów pomiędzy każdą parą (rewanże),
- przypisanie grup WYŁĄCZNIE do meczów (Match.group).

NIE odpowiada za:
- awanse z grup,
- fazę pucharową.
"""

from typing import List, Tuple, Optional
from django.db import transaction

from tournaments.models import Tournament, Stage, Group, Match, Team


# ============================================================
# API PUBLICZNE
# ============================================================

@transaction.atomic
def generate_group_stage(tournament: Tournament) -> Stage:
    """
    Generuje fazę grupową turnieju (format MIXED).
    """
    _validate_tournament(tournament)

    teams = _get_active_teams(tournament)
    cfg = tournament.format_config or {}

    teams_per_group = int(cfg.get("teams_per_group", 4))
    group_matches = int(cfg.get("group_matches", 1))  # 1 lub 2

    if teams_per_group < 2:
        raise ValueError("Grupa musi mieć co najmniej 2 uczestników.")

    if group_matches not in (1, 2):
        raise ValueError("group_matches musi wynosić 1 albo 2.")

    stage = Stage.objects.create(
        tournament=tournament,
        stage_type=Stage.StageType.GROUP,
        order=1,
    )

    groups = _split_into_groups(stage, teams, teams_per_group)

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


# ============================================================
# WALIDACJE
# ============================================================

def _validate_tournament(tournament: Tournament) -> None:
    if tournament.status != Tournament.Status.DRAFT:
        raise ValueError(
            "Fazę grupową można generować tylko dla turnieju w statusie DRAFT."
        )

    if tournament.tournament_format != Tournament.TournamentFormat.MIXED:
        raise ValueError(
            "Generator fazy grupowej obsługuje wyłącznie format MIXED."
        )


def _get_active_teams(tournament: Tournament) -> List[Team]:
    teams = list(
        tournament.teams.filter(is_active=True).order_by("id")
    )

    if len(teams) < 2:
        raise ValueError(
            "Faza grupowa wymaga co najmniej 2 aktywnych uczestników."
        )

    return teams


# ============================================================
# LOGIKA GRUP
# ============================================================

def _split_into_groups(
    stage: Stage,
    teams: List[Team],
    teams_per_group: int,
) -> List[tuple[Group, List[Team]]]:
    """
    Dzieli zespoły na grupy.
    Zwraca listę:
    (Group, [Team, Team, ...])
    """
    groups: list[tuple[Group, List[Team]]] = []

    index = 0
    group_number = 1

    while index < len(teams):
        group = Group.objects.create(
            stage=stage,
            name=f"Grupa {group_number}",
        )

        group_teams = teams[index : index + teams_per_group]
        groups.append((group, group_teams))

        index += teams_per_group
        group_number += 1

    return groups


# ============================================================
# ROUND-ROBIN (KOLEJKI W GRUPIE)
# ============================================================

def _round_robin_schedule(
    teams: List[Team],
) -> List[List[Tuple[Team, Team]]]:
    """
    Zwraca listę kolejek (round-robin).
    Każda kolejka = lista par (home, away).
    Obsługuje pauzy przy nieparzystej liczbie zespołów.
    """
    teams = teams[:]

    if len(teams) % 2 == 1:
        teams.append(None)

    n = len(teams)
    rounds = n - 1
    half = n // 2

    schedule: list[list[tuple[Team, Team]]] = []

    for _ in range(rounds):
        round_matches: list[tuple[Team, Team]] = []

        for i in range(half):
            t1 = teams[i]
            t2 = teams[n - 1 - i]

            if t1 is not None and t2 is not None:
                round_matches.append((t1, t2))

        schedule.append(round_matches)

        # algorytm kołowy
        teams = [teams[0]] + [teams[-1]] + teams[1:-1]

    return schedule
