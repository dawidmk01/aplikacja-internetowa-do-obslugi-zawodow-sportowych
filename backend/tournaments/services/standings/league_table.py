"""
Moduł odpowiedzialny za obliczanie tabeli wyników (standings)
dla rozgrywek ligowych oraz faz grupowych.

Tabela jest liczona dynamicznie na podstawie zakończonych meczów.

Zaimplementowane kryteria rozstrzygania remisów ("złoty standard"):
1) punkty (overall)
2) head-to-head (mini-tabela dla remisujących na punktach):
   - punkty H2H
   - bilans bramek H2H
   - bramki strzelone H2H
3) bilans ogólny (różnica bramek)
4) bramki strzelone ogólnie
5) stabilny fallback: nazwa, team_id
"""

from dataclasses import dataclass
from typing import Dict, Iterable, List, Tuple

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
    goal_difference: int = 0
    points: int = 0


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

    matches_qs = _get_finished_matches(stage, group)
    matches = list(matches_qs)  # potrzebne do H2H (wielokrotne iteracje)

    for match in matches:
        _apply_match_result(rows, match)

    # WYLICZENIE RB NA KOŃCU
    for row in rows.values():
        row.goal_difference = row.goals_for - row.goals_against

    return _sort_rows(rows.values(), matches)


# ============================================================
# POBIERANIE DANYCH
# ============================================================

def _get_teams_for_context(
    tournament: Tournament,
    stage: Stage,
    group: Group | None,
) -> list[Team]:
    """
    Zwraca listę uczestników:
    - liga: wszyscy aktywni uczestnicy turnieju
    - grupa: uczestnicy, którzy występują w meczach tej grupy
    """
    if group is None:
        return list(tournament.teams.filter(is_active=True))

    # DLA GRUPY: drużyny wynikają z meczów
    team_ids = set(
        Match.objects.filter(stage=stage, group=group)
        .values_list("home_team_id", flat=True)
    ) | set(
        Match.objects.filter(stage=stage, group=group)
        .values_list("away_team_id", flat=True)
    )

    return list(Team.objects.filter(id__in=team_ids))


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
    return {
        team.id: StandingRow(
            team_id=team.id,
            team_name=team.name,
        )
        for team in teams
    }


def _apply_match_result(
    rows: dict[int, StandingRow],
    match: Match,
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


# --------------------------
# HEAD-TO-HEAD (mini-tabela)
# --------------------------

def _compute_h2h_stats(
    tied_team_ids: set[int],
    matches: List[Match],
) -> Dict[int, Tuple[int, int, int]]:
    """
    Zwraca statystyki H2H dla podzbioru drużyn (mini-tabela):
    (punkty_h2h, gd_h2h, gf_h2h)
    """
    stats: Dict[int, List[int]] = {tid: [0, 0, 0] for tid in tied_team_ids}  # pts, gd, gf

    for m in matches:
        h = m.home_team_id
        a = m.away_team_id
        if h not in tied_team_ids or a not in tied_team_ids:
            continue

        # gole w H2H
        stats[h][2] += m.home_score
        stats[a][2] += m.away_score

        # różnica w H2H
        stats[h][1] += (m.home_score - m.away_score)
        stats[a][1] += (m.away_score - m.home_score)

        # punkty w H2H
        if m.home_score > m.away_score:
            stats[h][0] += 3
        elif m.home_score < m.away_score:
            stats[a][0] += 3
        else:
            stats[h][0] += 1
            stats[a][0] += 1

    return {tid: (v[0], v[1], v[2]) for tid, v in stats.items()}


def _sort_rows(rows: Iterable[StandingRow], matches: List[Match]) -> List[StandingRow]:
    """
    Sortowanie tabeli:
    1) punkty (overall)
    2) head-to-head (dla remisujących na punktach):
       - punkty H2H
       - bilans H2H
       - bramki H2H
    3) różnica bramek (overall)
    4) bramki strzelone (overall)
    5) nazwa, team_id (stabilność)

    Uwaga: H2H stosujemy tylko w obrębie bloków z tym samym overall points.
    """
    rows_list = list(rows)

    # 1) sort wstępny po punktach (żeby wyznaczyć bloki remisowe)
    rows_list.sort(
        key=lambda r: (
            -r.points,
            -r.goal_difference,
            -r.goals_for,
            r.team_name.lower(),
            r.team_id,
        )
    )

    # 2) znajdź bloki o tych samych punktach
    result: List[StandingRow] = []
    i = 0
    n = len(rows_list)

    while i < n:
        j = i + 1
        while j < n and rows_list[j].points == rows_list[i].points:
            j += 1

        block = rows_list[i:j]
        if len(block) <= 1:
            result.extend(block)
            i = j
            continue

        tied_ids = {r.team_id for r in block}
        h2h = _compute_h2h_stats(tied_ids, matches)

        # 3) sort blok po H2H; jeśli dalej remis, fallback po overall
        block.sort(
            key=lambda r: (
                -h2h.get(r.team_id, (0, 0, 0))[0],  # pts_h2h
                -h2h.get(r.team_id, (0, 0, 0))[1],  # gd_h2h
                -h2h.get(r.team_id, (0, 0, 0))[2],  # gf_h2h
                -r.goal_difference,                 # overall gd
                -r.goals_for,                       # overall gf
                r.team_name.lower(),
                r.team_id,
            )
        )

        result.extend(block)
        i = j

    return result
