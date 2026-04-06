# backend/tournaments/services/generators/groups.py
# Plik generuje fazę grupową turnieju w formacie mieszanym dla aktywnej dywizji.

from __future__ import annotations

from typing import List, Optional, Tuple

from django.db import transaction

from tournaments.models import Division, Group, Match, Stage, Team, Tournament

BYE_TEAM_NAME = "__SYSTEM_BYE__"


def _resolve_division(tournament: Tournament, division: Division | None = None) -> Division | None:
    if division is None:
        return tournament.get_default_division()

    if division.tournament_id != tournament.id:
        raise ValueError("Wskazana dywizja nie należy do tego turnieju.")

    return division


def _runtime_status(
    tournament: Tournament,
    division: Division | None,
) -> str:
    return division.status if division is not None else tournament.status


def _runtime_tournament_format(
    tournament: Tournament,
    division: Division | None,
) -> str:
    return division.tournament_format if division is not None else tournament.tournament_format


def _runtime_format_config(
    tournament: Tournament,
    division: Division | None,
) -> dict:
    if division is not None:
        return dict(division.format_config or {})
    return dict(tournament.format_config or {})


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


@transaction.atomic
def generate_group_stage(
    tournament: Tournament,
    division: Division | None = None,
) -> Stage:
    division = _resolve_division(tournament, division)

    _validate_tournament(tournament, division)

    teams = _get_active_teams(tournament, division)
    cfg = _runtime_format_config(tournament, division)

    groups_count = int(cfg.get("groups_count", 2))
    group_matches = int(cfg.get("group_matches", 1))

    if groups_count < 1:
        raise ValueError("Liczba grup (groups_count) musi być >= 1.")

    if group_matches not in (1, 2):
        raise ValueError("group_matches musi wynosić 1 albo 2.")

    # Każda grupa musi mieć minimalną obsadę pozwalającą wygenerować mecze.
    if len(teams) < 2 * groups_count:
        raise ValueError(
            f"Za mało uczestników ({len(teams)}) na {groups_count} grup. "
            f"Minimalnie potrzeba {2 * groups_count}."
        )

    stage = Stage.objects.create(
        tournament=tournament,
        division=division,
        stage_type=Stage.StageType.GROUP,
        order=1,
    )

    groups = _split_into_groups(stage, teams, groups_count)

    matches: list[Match] = []

    for group, group_teams in groups:
        schedule = _round_robin_schedule(group_teams)
        current_round = 1

        # Rewanż odwraca gospodarza w obrębie tej samej siatki kolejek.
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
    _promote_after_generation(tournament, division)

    return stage


def _validate_tournament(
    tournament: Tournament,
    division: Division | None,
) -> None:
    if _runtime_status(tournament, division) != Tournament.Status.DRAFT:
        raise ValueError("Fazę grupową można generować tylko dla dywizji w statusie DRAFT.")

    if _runtime_tournament_format(tournament, division) != Tournament.TournamentFormat.MIXED:
        raise ValueError("Generator fazy grupowej obsługuje wyłącznie format MIXED.")


def _get_active_teams(
    tournament: Tournament,
    division: Division | None,
) -> List[Team]:
    teams_qs = tournament.teams.filter(is_active=True).exclude(name=BYE_TEAM_NAME)
    if division is not None:
        teams_qs = teams_qs.filter(division=division)

    teams = list(teams_qs.order_by("id"))
    if len(teams) < 2:
        raise ValueError("Faza grupowa wymaga co najmniej 2 aktywnych uczestników.")
    return teams


def _split_into_groups(stage: Stage, teams: List[Team], groups_count: int) -> List[tuple[Group, List[Team]]]:
    groups: list[tuple[Group, List[Team]]] = []

    n = len(teams)
    base_size = n // groups_count
    extra = n % groups_count

    idx = 0
    for i in range(groups_count):
        size = base_size + (1 if i < extra else 0)
        group_teams = teams[idx : idx + size]
        idx += size

        group = Group.objects.create(stage=stage, name=f"Grupa {i + 1}")
        groups.append((group, group_teams))

    return groups


def _round_robin_schedule(teams: List[Team]) -> List[List[Tuple[Team, Team]]]:
    arr: List[Optional[Team]] = list(teams)

    # Pauza wynika z nieparzystej liczby zespołów, ale nie tworzy BYE jako drużyny.
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

        # Rotacja kołowa utrzymuje poprawny rozkład par we wszystkich kolejkach.
        arr = [arr[0]] + [arr[-1]] + arr[1:-1]

    return schedule
