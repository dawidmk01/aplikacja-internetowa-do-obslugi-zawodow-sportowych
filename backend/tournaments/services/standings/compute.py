from __future__ import annotations

from tournaments.models import Group, Match, Stage, Team, Tournament
from tournaments.services.standings.types import StandingRow
from tournaments.services.standings.rulesets.base import StandingsRuleset
from tournaments.services.standings.rulesets.football import FootballPZPNRuleset
from tournaments.services.standings.rulesets.handball import HandballSuperligaRuleset
from tournaments.services.match_outcome import final_score


BYE_TEAM_NAME = "__SYSTEM_BYE__"


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
    """
    Kluczowa zasada (Wariant B):
    - Standings liczymy z uczestników *kontekstu etapu/grupy*,
      a nie z Team.is_active.
    Dzięki temu:
    - po awansie do KO i zmianie is_active drużyny NIE znikają z tabel grup,
    - zmiany wyników w grupach nadal mogą zmienić kolejność/awans.
    """
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


def _team_ids_from_matches(stage: Stage, group: Group | None) -> set[int]:
    qs = Match.objects.filter(stage=stage)
    if group is not None:
        qs = qs.filter(group=group)

    home_ids = set(qs.values_list("home_team_id", flat=True))
    away_ids = set(qs.values_list("away_team_id", flat=True))
    ids = home_ids | away_ids
    ids.discard(None)  # bezpieczeństwo
    return ids


def _get_teams_for_context(tournament: Tournament, stage: Stage, group: Group | None) -> list[Team]:
    """
    Najważniejsza zmiana:
    - NIE filtrujemy po is_active.
    Uczestników kontekstu bierzemy z meczów etapu/grupy.
    """
    ids = _team_ids_from_matches(stage, group)

    # Jeżeli z jakiegoś powodu nie ma jeszcze meczów (np. widok przed generacją),
    # to fallback: pokaż wszystkich uczestników turnieju (bez BYE).
    if not ids:
        return list(tournament.teams.exclude(name=BYE_TEAM_NAME))

    return list(Team.objects.filter(id__in=ids).exclude(name=BYE_TEAM_NAME))


def _get_finished_matches(stage: Stage, group: Group | None):
    qs = Match.objects.filter(stage=stage, status=Match.Status.FINISHED)
    if group is not None:
        qs = qs.filter(group=group)
    return qs


def _get_all_matches(stage: Stage, group: Group | None):
    qs = Match.objects.filter(stage=stage)
    if group is not None:
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
        away.away_wins += 1
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
                home.draws += 1
                away.draws += 1
        else:
            home.draws += 1
            away.draws += 1
            home.points += 1
            away.points += 1
        return

    home.draws += 1
    away.draws += 1
    home.points += 1
    away.points += 1
