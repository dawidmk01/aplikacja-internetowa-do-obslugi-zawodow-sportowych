"""
Moduł odpowiedzialny za obliczanie tabeli wyników (standings)
dla rozgrywek ligowych oraz faz grupowych.

Tabela jest liczona dynamicznie na podstawie zakończonych meczów.
"""

from collections import defaultdict
from dataclasses import dataclass

from tournaments.models import (
    Tournament,
    Stage,
    Group,
    Match,
    Team,
)


# ============================================================
# STRUKTURA WIERSZA TABELI
# ============================================================

@dataclass
class StandingRow:
    team_id: int
    team_name: str

    played: int = 0
    wins: int = 0
    draws: int = 0
    losses: int = 0

    goals_for: int = 0
    goals_against: int = 0
    points: int = 0

    @property
    def goal_difference(self) -> int:
        return self.goals_for - self.goals_against


# ============================================================
# API PUBLICZNE
# ============================================================

def compute_stage_standings(
    tournament: Tournament,
    stage: Stage,
    group: Group | None = None,
) -> list[StandingRow]:
    """
    Oblicza tabelę wyników dla wskazanego etapu.

    - dla ligi: group = None
    - dla fazy grupowej: group = konkretna grupa
    """
    teams = _get_teams_for_context(tournament, stage, group)
    rows = _initialize_rows(teams)

    matches = _get_finished_matches(stage, group)

    for match in matches:
        _apply_match_result(rows, match, tournament)

    return _sort_rows(rows.values())


# ============================================================
# POBIERANIE DANYCH
# ============================================================

def _get_teams_for_context(
    tournament: Tournament,
    stage: Stage,
    group: Group | None,
) -> list[Team]:
    """
    Zwraca listę uczestników dla ligi lub konkretnej grupy.
    """
    qs = tournament.teams.filter(
        is_active=True,
        status=Team.Status.APPROVED,
    )

    if group:
        qs = qs.filter(
            home_matches__group=group
        ).distinct()

    return list(qs)


def _get_finished_matches(
    stage: Stage,
    group: Group | None,
):
    """
    Zwraca zakończone mecze dla etapu lub grupy.
    """
    qs = Match.objects.filter(
        stage=stage,
        status=Match.Status.FINISHED,
    )

    if group:
        qs = qs.filter(group=group)

    return qs


# ============================================================
# LOGIKA TABELI
# ============================================================

def _initialize_rows(teams: list[Team]) -> dict[int, StandingRow]:
    rows = {}
    for team in teams:
        rows[team.id] = StandingRow(
            team_id=team.id,
            team_name=team.name,
        )
    return rows


def _apply_match_result(
    rows: dict[int, StandingRow],
    match: Match,
    tournament: Tournament,
) -> None:
    home = rows.get(match.home_team_id)
    away = rows.get(match.away_team_id)

    if not home or not away:
        return

    home.played += 1
    away.played += 1

    home.goals_for += match.home_score
    home.goals_against += match.away_score
    away.goals_for += match.away_score
    away.goals_against += match.home_score

    if match.home_score > match.away_score:
        home.wins += 1
        away.losses += 1
        home.points += 3
    elif match.home_score < match.away_score:
        away.wins += 1
        home.losses += 1
        away.points += 3
    else:
        home.draws += 1
        away.draws += 1
        home.points += 1
        away.points += 1


def _sort_rows(rows: list[StandingRow]) -> list[StandingRow]:
    """
    Sortowanie tabeli:
    1. punkty
    2. różnica bramek
    3. bramki strzelone
    4. nazwa (stabilność)
    """
    return sorted(
        rows,
        key=lambda r: (
            -r.points,
            -r.goal_difference,
            -r.goals_for,
            r.team_name.lower(),
        ),
    )
