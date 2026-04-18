# backend/tournaments/services/standings/rulesets/basketball.py
# Plik definiuje zasady sortowania tabeli koszykarskiej w warstwie klasyfikacji.

from __future__ import annotations

from itertools import groupby
from typing import Dict, Iterable, List, Set, Tuple

from tournaments.models import Match
from tournaments.services.standings.rulesets.base import StandingsRuleset
from tournaments.services.standings.types import StandingRow


class BasketballFibaRuleset(StandingsRuleset):
    def sort_rows(
        self,
        rows: Iterable[StandingRow],
        finished_matches: List[Match],
        all_stage_matches: List[Match],
    ) -> List[StandingRow]:
        rows_list = list(rows)
        rows_list.sort(key=_overall_key)

        # Kryteria H2H mają sens dopiero po zamknięciu całego etapu.
        stage_complete = all(match.status == Match.Status.FINISHED for match in all_stage_matches) if all_stage_matches else False
        if not stage_complete:
            return rows_list

        result: List[StandingRow] = []

        # Remisy rozpatrywane są wyłącznie w obrębie tej samej liczby punktów tabelarycznych.
        for _, block_iter in groupby(rows_list, key=lambda row: row.points):
            block = list(block_iter)
            if len(block) == 1:
                result.extend(block)
                continue

            result.extend(_resolve_tied_block(block, finished_matches))

        return result


# ===== Klucze sortowania =====

def _overall_key(row: StandingRow) -> tuple:
    # Klucz ogólny utrzymuje stabilną kolejność przed pełnym domknięciem etapu.
    return (
        -row.points,
        -row.goal_difference,
        -row.goals_for,
        row.team_name.lower(),
        row.team_id,
    )


def _h2h_key(
    team_id: int,
    stats: Dict[int, Tuple[int, int, int]],
) -> tuple:
    h2h_points, h2h_diff, h2h_scored = stats.get(team_id, (0, 0, 0))
    return (-h2h_points, -h2h_diff, -h2h_scored)


# ===== Rozstrzyganie remisów =====

def _resolve_tied_block(
    block: List[StandingRow],
    finished_matches: List[Match],
) -> List[StandingRow]:
    if len(block) <= 1:
        return list(block)

    tied_ids: Set[int] = {row.team_id for row in block}
    h2h_stats = _compute_h2h_stats(tied_ids, finished_matches)

    ordered = sorted(
        block,
        key=lambda row: (
            *_h2h_key(row.team_id, h2h_stats),
            row.team_name.lower(),
            row.team_id,
        ),
    )

    result: List[StandingRow] = []

    # FIBA wymaga ponownego zastosowania procedury dla podzbiorów nadal nierozstrzygniętych.
    for _, subgroup_iter in groupby(
        ordered,
        key=lambda row: h2h_stats.get(row.team_id, (0, 0, 0)),
    ):
        subgroup = list(subgroup_iter)

        if len(subgroup) == 1:
            result.extend(subgroup)
            continue

        # Gdy cały blok ma identyczne H2H, przejście następuje do kryteriów ogólnych.
        if len(subgroup) == len(block):
            subgroup.sort(key=_overall_key)
            result.extend(subgroup)
            continue

        result.extend(_resolve_tied_block(subgroup, finished_matches))

    return result


# ===== Statystyki H2H =====

def _compute_h2h_stats(
    tied_team_ids: Set[int],
    finished_matches: List[Match],
) -> Dict[int, Tuple[int, int, int]]:
    """
    Zwracana krotka oznacza kolejno:
    - punkty klasyfikacyjne H2H,
    - różnicę koszy H2H,
    - kosze zdobyte H2H.
    """
    stats: Dict[int, List[int]] = {
        team_id: [0, 0, 0] for team_id in tied_team_ids
    }

    # Uwzględniane są wyłącznie zakończone mecze rozegrane wewnątrz badanego bloku remisu.
    for match in finished_matches:
        home_team_id = match.home_team_id
        away_team_id = match.away_team_id

        if home_team_id not in tied_team_ids or away_team_id not in tied_team_ids:
            continue

        home_score, away_score = _basketball_final_score(match)
        home_points, away_points = _classification_points(home_score, away_score)

        stats[home_team_id][0] += home_points
        stats[away_team_id][0] += away_points

        stats[home_team_id][1] += home_score - away_score
        stats[away_team_id][1] += away_score - home_score

        stats[home_team_id][2] += home_score
        stats[away_team_id][2] += away_score

    return {
        team_id: (values[0], values[1], values[2])
        for team_id, values in stats.items()
    }


# ===== Wynik i punkty klasyfikacyjne =====

def _basketball_final_score(match: Match) -> Tuple[int, int]:
    # Koszykówka sumuje wynik podstawowy i dogrywkę, bez użycia karnych.
    home_regular = int(match.home_score or 0)
    away_regular = int(match.away_score or 0)

    home_extra_time = int(getattr(match, "home_extra_time_score", 0) or 0)
    away_extra_time = int(getattr(match, "away_extra_time_score", 0) or 0)

    return (
        home_regular + home_extra_time,
        away_regular + away_extra_time,
    )


def _classification_points(home_score: int, away_score: int) -> Tuple[int, int]:
    if home_score > away_score:
        return (2, 1)
    if away_score > home_score:
        return (1, 2)

    # Remis końcowy w koszykówce oznacza niespójne dane wejściowe.
    return (0, 0)