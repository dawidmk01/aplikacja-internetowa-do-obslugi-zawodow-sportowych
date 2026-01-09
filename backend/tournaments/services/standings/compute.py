from __future__ import annotations

from typing import List

from tournaments.models import Group, Match, Stage, Team, Tournament
from tournaments.services.standings.types import StandingRow
from tournaments.services.standings.rulesets.base import StandingsRuleset
from tournaments.services.standings.rulesets.football import FootballPZPNRuleset
from tournaments.services.standings.rulesets.handball import HandballSuperligaRuleset
from tournaments.services.match_outcome import final_score


def _get_ruleset(tournament: Tournament) -> StandingsRuleset:
    # Dopasuj wartości do swoich enumów / stringów dyscypliny
    if getattr(tournament, "discipline", None) in ("football", "FOOTBALL"):
        return FootballPZPNRuleset()
    if getattr(tournament, "discipline", None) in ("handball", "HANDBALL"):
        return HandballSuperligaRuleset()
    return StandingsRuleset()


def compute_stage_standings(
    tournament: Tournament,
    stage: Stage,
    group: Group | None = None,
) -> list[StandingRow]:
    ruleset = _get_ruleset(tournament)

    teams = _get_teams_for_context(tournament, stage, group)
    rows = _initialize_rows(teams)

    finished_matches = list(_get_finished_matches(stage, group))
    all_stage_matches = list(_get_all_matches(stage, group))

    for match in finished_matches:
        _apply_match_result(rows, match, tournament)

    for row in rows.values():
        row.goal_difference = row.goals_for - row.goals_against

    return ruleset.sort_rows(rows.values(), finished_matches, all_stage_matches)


BYE_TEAM_NAME = "__SYSTEM_BYE__"

def _get_teams_for_context(tournament: Tournament, stage: Stage, group: Group | None) -> list[Team]:
    if group is None:
        return list(tournament.teams.filter(is_active=True).exclude(name=BYE_TEAM_NAME))

    team_ids = set(
        Match.objects.filter(stage=stage, group=group).values_list("home_team_id", flat=True)
    ) | set(
        Match.objects.filter(stage=stage, group=group).values_list("away_team_id", flat=True)
    )

    return list(Team.objects.filter(id__in=team_ids, is_active=True).exclude(name=BYE_TEAM_NAME))



def _get_finished_matches(stage: Stage, group: Group | None):
    qs = Match.objects.filter(stage=stage, status=Match.Status.FINISHED)
    if group:
        qs = qs.filter(group=group)
    return qs


def _get_all_matches(stage: Stage, group: Group | None):
    qs = Match.objects.filter(stage=stage)
    if group:
        qs = qs.filter(group=group)
    return qs


def _initialize_rows(teams: list[Team]) -> dict[int, StandingRow]:
    return {t.id: StandingRow(team_id=t.id, team_name=t.name) for t in teams}


def _apply_match_result(rows: dict[int, StandingRow], match: Match, tournament: Tournament) -> None:
    home = rows.get(match.home_team_id)
    away = rows.get(match.away_team_id)
    if not home or not away:
        return

    hs, aws = final_score(match)

    home.played += 1
    away.played += 1

    # Superliga: gole z karnych nie wchodzą do wyniku i nie liczą się do kryteriów tabeli
    home.goals_for += hs
    home.goals_against += aws
    away.goals_for += aws
    away.goals_against += hs

    discipline = getattr(tournament, "discipline", None)

    is_handball = discipline in ("handball", "HANDBALL")

    if hs > aws:
        home.wins += 1
        away.losses += 1
        home.points += 3
        return

    if hs < aws:
        away.wins += 1
        away.away_wins += 1  # zostawiamy, choć w handball nie jest tie-breakerem
        home.losses += 1
        away.points += 3
        return

    # remis w czasie gry
    if is_handball:
        if match.decided_by_penalties and match.home_penalty_score is not None and match.away_penalty_score is not None:
            if match.home_penalty_score > match.away_penalty_score:
                home.wins += 1
                home.penalty_wins += 1
                away.losses += 1
                away.penalty_losses += 1
                home.points += 2
                away.points += 1
            elif match.home_penalty_score < match.away_penalty_score:
                away.wins += 1
                away.penalty_wins += 1
                away.away_wins += 1
                home.losses += 1
                home.penalty_losses += 1
                away.points += 2
                home.points += 1
            else:
                # powinno być niemożliwe po walidacji
                home.draws += 1
                away.draws += 1
        else:
            # jeśli backend dopuścił remis bez karnych – traktujemy jako draw,
            # ale docelowo finish/serializer powinien to zablokować
            home.draws += 1
            away.draws += 1
            home.points += 1
            away.points += 1
        return

    # pozostałe dyscypliny (np. football): remis = 1 pkt
    home.draws += 1
    away.draws += 1
    home.points += 1
    away.points += 1