# backend/tournaments/services/standings/rulesets/handball.py
# Plik definiuje zasady sortowania tabeli dla piłki ręcznej w warstwie klasyfikacji etapu.

from __future__ import annotations

from itertools import groupby
from typing import Dict, Iterable, List, Set, Tuple

from tournaments.models import Match
from tournaments.services.match_outcome import final_score
from tournaments.services.standings.rulesets.base import StandingsRuleset
from tournaments.services.standings.types import StandingRow


class HandballRuleset(StandingsRuleset):
    """
    Klasa odwzorowuje zasady porządkowania tabeli dla piłki ręcznej.

    Punktacja:
    - zwycięstwo w czasie gry - 3 pkt,
    - zwycięstwo po karnych - 2 pkt,
    - porażka po karnych - 1 pkt,
    - porażka w czasie gry - 0 pkt.

    Kolejność sortowania:
    1. W trakcie etapu: punkty, bilans bramek, bramki zdobyte, nazwa.
    2. Po zakończeniu etapu dla zespołów remisujących punktowo:
       - mała tabela H2H: punkty, bilans bramek, bramki zdobyte,
       - następnie kryteria ogólne: bilans bramek, bramki zdobyte, nazwa.
    """

    def sort_rows(
        self,
        rows: Iterable[StandingRow],
        finished_matches: List[Match],
        all_stage_matches: List[Match],
    ) -> List[StandingRow]:
        rows_list = list(rows)

        # Pełne rozegranie etapu decyduje, czy można uruchomić małą tabelę H2H.
        stage_complete = all(match.status == Match.Status.FINISHED for match in all_stage_matches)

        # Sortowanie bazowe ustawia kolejność dla trwającego etapu i bloki remisowe po punktach.
        rows_list.sort(
            key=lambda row: (
                -row.points,
                -row.goal_difference,
                -row.goals_for,
                row.team_name.lower(),
                row.team_id,
            )
        )

        if not stage_complete:
            return rows_list

        result: List[StandingRow] = []

        # Grupowanie po punktach pozwala rozstrzygać tylko rzeczywiste remisy punktowe.
        for _points, group in groupby(rows_list, key=lambda row: row.points):
            block = list(group)

            if len(block) == 1:
                result.append(block[0])
                continue

            tied_ids = {row.team_id for row in block}
            h2h_points, h2h_diff, h2h_goals_for = _compute_h2h_stats(tied_ids, finished_matches)

            # Kolejność H2H obowiązuje dopiero po zamknięciu etapu.
            block.sort(
                key=lambda row: (
                    -h2h_points.get(row.team_id, 0),
                    -h2h_diff.get(row.team_id, 0),
                    -h2h_goals_for.get(row.team_id, 0),
                    -row.goal_difference,
                    -row.goals_for,
                    row.team_name.lower(),
                    row.team_id,
                )
            )
            result.extend(block)

        return result


def _compute_h2h_stats(
    tied_team_ids: Set[int],
    finished_matches: List[Match],
) -> Tuple[Dict[int, int], Dict[int, int], Dict[int, int]]:
    """
    Funkcja oblicza statystyki małej tabeli dla zespołów remisujących punktowo.

    Zwracane słowniki opisują odpowiednio:
    - punkty w meczach bezpośrednich,
    - bilans bramek w meczach bezpośrednich,
    - bramki zdobyte w meczach bezpośrednich.
    """
    points: Dict[int, int] = {team_id: 0 for team_id in tied_team_ids}
    goal_diff: Dict[int, int] = {team_id: 0 for team_id in tied_team_ids}
    goals_for: Dict[int, int] = {team_id: 0 for team_id in tied_team_ids}

    # Analizowane są wyłącznie zakończone mecze rozegrane wewnątrz badanego bloku remisu.
    for match in finished_matches:
        home_team_id = match.home_team_id
        away_team_id = match.away_team_id

        if home_team_id not in tied_team_ids or away_team_id not in tied_team_ids:
            continue

        home_score, away_score = final_score(match)

        goals_for[home_team_id] += home_score
        goals_for[away_team_id] += away_score
        goal_diff[home_team_id] += home_score - away_score
        goal_diff[away_team_id] += away_score - home_score

        # Remis bramkowy może być rozstrzygnięty karnymi w modelu 3-2-1-0.
        if home_score > away_score:
            points[home_team_id] += 3
        elif home_score < away_score:
            points[away_team_id] += 3
        else:
            if (
                match.decided_by_penalties
                and match.home_penalty_score is not None
                and match.away_penalty_score is not None
            ):
                if match.home_penalty_score > match.away_penalty_score:
                    points[home_team_id] += 2
                    points[away_team_id] += 1
                elif match.home_penalty_score < match.away_penalty_score:
                    points[away_team_id] += 2
                    points[home_team_id] += 1
                else:
                    points[home_team_id] += 1
                    points[away_team_id] += 1
            else:
                points[home_team_id] += 1
                points[away_team_id] += 1

    return points, goal_diff, goals_for


HandballSuperligaRuleset = HandballRuleset
