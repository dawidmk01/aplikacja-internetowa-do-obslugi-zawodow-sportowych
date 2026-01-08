from __future__ import annotations

from itertools import combinations
from typing import Dict, Iterable, List, Tuple

from tournaments.models import Match
from tournaments.services.standings.types import StandingRow
from tournaments.services.standings.rulesets.base import StandingsRuleset


class FootballPZPNRuleset(StandingsRuleset):
    """
    Zasady kolejności w tabeli zgodne z Uchwałą PZPN (Organ prowadzący rozgrywki) – § 16 ust. 3:
    1) punkty (overall)
    2) przy równej liczbie punktów (tylko gdy rozegrano komplet H2H w danym bloku):
       - punkty w bezpośrednich spotkaniach (H2H)
       - różnica bramek w bezpośrednich spotkaniach (H2H)
    3) różnica bramek (overall)
    4) bramki zdobyte (overall)
    5) liczba zwycięstw (overall)
    6) liczba zwycięstw na wyjeździe (overall)
    7) stabilny fallback: nazwa, team_id
    """

    def sort_rows(
        self,
        rows: Iterable[StandingRow],
        finished_matches: List[Match],
        all_stage_matches: List[Match],
    ) -> List[StandingRow]:
        rows_list = list(rows)

        # sort wstępny po punktach -> bloki remisowe
        rows_list.sort(
            key=lambda r: (-r.points, r.team_name.lower(), r.team_id)
        )

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
            use_h2h = _all_h2h_matches_finished(tied_ids, all_stage_matches)

            if use_h2h:
                h2h = _compute_h2h_stats(tied_ids, finished_matches)
                block.sort(
                    key=lambda r: (
                        -h2h.get(r.team_id, (0, 0))[0],  # H2H points
                        -h2h.get(r.team_id, (0, 0))[1],  # H2H GD
                        -r.goal_difference,              # overall GD
                        -r.goals_for,                    # overall GF
                        -r.wins,                         # wins
                        -r.away_wins,                    # away wins
                        r.team_name.lower(),
                        r.team_id,
                    )
                )
            else:
                block.sort(
                    key=lambda r: (
                        -r.goal_difference,
                        -r.goals_for,
                        -r.wins,
                        -r.away_wins,
                        r.team_name.lower(),
                        r.team_id,
                    )
                )

            result.extend(block)
            i = j

        return result


def _all_h2h_matches_finished(
    tied_team_ids: set[int],
    all_stage_matches: List[Match],
) -> bool:
    if len(tied_team_ids) < 2:
        return False

    pair_statuses: Dict[Tuple[int, int], List[str]] = {}

    for m in all_stage_matches:
        h = m.home_team_id
        a = m.away_team_id
        if h in tied_team_ids and a in tied_team_ids:
            p = (min(h, a), max(h, a))
            pair_statuses.setdefault(p, []).append(m.status)

    for t1, t2 in combinations(sorted(tied_team_ids), 2):
        p = (t1, t2)
        statuses = pair_statuses.get(p)
        if not statuses:
            return False
        if not all(s == Match.Status.FINISHED for s in statuses):
            return False

    return True


def _compute_h2h_stats(
    tied_team_ids: set[int],
    finished_matches: List[Match],
) -> Dict[int, Tuple[int, int]]:
    # (pts, gd)
    stats: Dict[int, List[int]] = {tid: [0, 0] for tid in tied_team_ids}

    for m in finished_matches:
        h = m.home_team_id
        a = m.away_team_id
        if h not in tied_team_ids or a not in tied_team_ids:
            continue

        hs = m.home_score or 0
        aws = m.away_score or 0

        stats[h][1] += (hs - aws)
        stats[a][1] += (aws - hs)

        if hs > aws:
            stats[h][0] += 3
        elif hs < aws:
            stats[a][0] += 3
        else:
            stats[h][0] += 1
            stats[a][0] += 1

    return {tid: (v[0], v[1]) for tid, v in stats.items()}
