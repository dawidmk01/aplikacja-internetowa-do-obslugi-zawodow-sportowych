# backend/tournaments/services/standings/rulesets/football.py
# Plik definiuje zasady sortowania tabeli piłkarskiej zgodne z regułami PZPN w warstwie klasyfikacji.

from __future__ import annotations

from itertools import combinations
from typing import Dict, Iterable, List, Tuple

from tournaments.models import Match
from tournaments.services.standings.rulesets.base import StandingsRuleset
from tournaments.services.standings.types import StandingRow


class FootballPZPNRuleset(StandingsRuleset):
    """
    Klasa odwzorowuje kolejność sortowania tabeli zgodną z zasadami PZPN.

    Kolejność kryteriów:
    1. Punkty ogólne.
    2. Przy remisie punktowym, ale tylko po rozegraniu pełnego kompletu H2H:
       - punkty w meczach bezpośrednich,
       - różnica bramek w meczach bezpośrednich.
    3. Różnica bramek ogółem.
    4. Bramki zdobyte ogółem.
    5. Liczba zwycięstw.
    6. Liczba zwycięstw na wyjeździe.
    7. Stabilny fallback: nazwa i identyfikator drużyny.
    """

    def sort_rows(
        self,
        rows: Iterable[StandingRow],
        finished_matches: List[Match],
        all_stage_matches: List[Match],
    ) -> List[StandingRow]:
        rows_list = list(rows)

        # Sortowanie wstępne buduje bloki remisowe po punktach.
        rows_list.sort(key=lambda row: (-row.points, row.team_name.lower(), row.team_id))

        result: List[StandingRow] = []
        index = 0
        rows_count = len(rows_list)

        while index < rows_count:
            block_end = index + 1
            while block_end < rows_count and rows_list[block_end].points == rows_list[index].points:
                block_end += 1

            block = rows_list[index:block_end]
            if len(block) <= 1:
                result.extend(block)
                index = block_end
                continue

            tied_ids = {row.team_id for row in block}
            use_h2h = _all_h2h_matches_finished(tied_ids, all_stage_matches)

            if use_h2h:
                h2h_stats = _compute_h2h_stats(tied_ids, finished_matches)

                # H2H uruchamiane jest wyłącznie wtedy, gdy komplet bezpośrednich spotkań został domknięty.
                block.sort(
                    key=lambda row: (
                        -h2h_stats.get(row.team_id, (0, 0))[0],
                        -h2h_stats.get(row.team_id, (0, 0))[1],
                        -row.goal_difference,
                        -row.goals_for,
                        -row.wins,
                        -row.away_wins,
                        row.team_name.lower(),
                        row.team_id,
                    )
                )
            else:
                # Brak pełnego H2H wymusza przejście bezpośrednio do kryteriów ogólnych.
                block.sort(
                    key=lambda row: (
                        -row.goal_difference,
                        -row.goals_for,
                        -row.wins,
                        -row.away_wins,
                        row.team_name.lower(),
                        row.team_id,
                    )
                )

            result.extend(block)
            index = block_end

        return result


def _all_h2h_matches_finished(
    tied_team_ids: set[int],
    all_stage_matches: List[Match],
) -> bool:
    # Pełny komplet H2H jest wymagany, aby zastosować kryteria meczów bezpośrednich.
    if len(tied_team_ids) < 2:
        return False

    pair_statuses: Dict[Tuple[int, int], List[str]] = {}

    for match in all_stage_matches:
        home_team_id = match.home_team_id
        away_team_id = match.away_team_id

        if home_team_id in tied_team_ids and away_team_id in tied_team_ids:
            pair_key = (min(home_team_id, away_team_id), max(home_team_id, away_team_id))
            pair_statuses.setdefault(pair_key, []).append(match.status)

    for first_team_id, second_team_id in combinations(sorted(tied_team_ids), 2):
        pair_key = (first_team_id, second_team_id)
        statuses = pair_statuses.get(pair_key)
        if not statuses:
            return False
        if not all(status == Match.Status.FINISHED for status in statuses):
            return False

    return True


def _compute_h2h_stats(
    tied_team_ids: set[int],
    finished_matches: List[Match],
) -> Dict[int, Tuple[int, int]]:
    """
    Funkcja oblicza małą tabelę H2H dla bloku drużyn remisujących punktowo.

    Zwracana para wartości oznacza:
    - punkty zdobyte w meczach bezpośrednich,
    - różnicę bramek w meczach bezpośrednich.
    """
    stats: Dict[int, List[int]] = {team_id: [0, 0] for team_id in tied_team_ids}

    # Uwzględniane są tylko zakończone spotkania rozegrane wewnątrz badanego bloku remisu.
    for match in finished_matches:
        home_team_id = match.home_team_id
        away_team_id = match.away_team_id

        if home_team_id not in tied_team_ids or away_team_id not in tied_team_ids:
            continue

        home_score = match.home_score or 0
        away_score = match.away_score or 0

        stats[home_team_id][1] += home_score - away_score
        stats[away_team_id][1] += away_score - home_score

        if home_score > away_score:
            stats[home_team_id][0] += 3
        elif home_score < away_score:
            stats[away_team_id][0] += 3
        else:
            stats[home_team_id][0] += 1
            stats[away_team_id][0] += 1

    return {team_id: (values[0], values[1]) for team_id, values in stats.items()}
