from __future__ import annotations

from tournaments.models import Group, Match, Stage, Tournament
from tournaments.services.standings.context import (
    get_all_matches,
    get_finished_matches,
    get_teams_for_context,
)
from tournaments.services.standings.rulesets import get_ruleset
from tournaments.services.standings.types import StandingRow


def compute_stage_standings(
    tournament: Tournament,
    stage: Stage,
    group: Group | None = None,
) -> list[StandingRow]:
    teams = get_teams_for_context(tournament, stage, group)
    rows = _initialize_rows(teams)

    finished_matches = list(get_finished_matches(stage, group))
    for match in finished_matches:
        _apply_match_result(rows, match)

    for row in rows.values():
        row.goal_difference = row.goals_for - row.goals_against

    all_stage_matches = list(get_all_matches(stage, group))

    ruleset = get_ruleset(tournament)
    return ruleset.sort_rows(rows.values(), finished_matches, all_stage_matches)


def _initialize_rows(teams: list) -> dict[int, StandingRow]:
    return {
        t.id: StandingRow(team_id=t.id, team_name=t.name)
        for t in teams
    }


def _apply_match_result(rows: dict[int, StandingRow], match: Match) -> None:
    home = rows.get(match.home_team_id)
    away = rows.get(match.away_team_id)
    if not home or not away:
        return

    hs = match.home_score or 0
    aws = match.away_score or 0

    home.played += 1
    away.played += 1

    home.goals_for += hs
    home.goals_against += aws
    away.goals_for += aws
    away.goals_against += hs

    if hs > aws:
        home.wins += 1
        away.losses += 1
        home.points += 3
    elif hs < aws:
        away.wins += 1
        away.away_wins += 1
        home.losses += 1
        away.points += 3
    else:
        home.draws += 1
        away.draws += 1
        home.points += 1
        away.points += 1
