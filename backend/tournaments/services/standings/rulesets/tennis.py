from __future__ import annotations

from itertools import groupby
from typing import Dict, Iterable, List, Set, Tuple

from tournaments.models import Match
from tournaments.services.standings.rulesets.base import StandingsRuleset
from tournaments.services.standings.types import StandingRow


class TennisRuleset(StandingsRuleset):
    """
    Tenis – kolejność w tabeli dla ligi / grup.

    Założenia (zgodnie z implementacją projektu):
    - points == liczba zwycięstw (1 za wygraną, 0 za porażkę),
    - goals_for / goals_against / goal_difference = sety wygrane/przegrane/różnica setów,
    - games_for / games_against / games_difference = gemy wygrane/przegrane/różnica gemów (tie-break).

    Kryteria sortowania:
    1) wins (malejąco)
    2) (gdy etap zakończony i mamy remisy) H2H:
       - H2H wins (malejąco)
       - H2H różnica setów
       - H2H sety wygrane
       - H2H różnica gemów
       - H2H gemy wygrane
    3) overall:
       - różnica setów
       - sety wygrane
       - różnica gemów
       - gemy wygrane
    4) deterministycznie: nazwa, id
    """

    def sort_rows(
        self,
        rows: Iterable[StandingRow],
        finished_matches: List[Match],
        all_stage_matches: List[Match],
    ) -> List[StandingRow]:
        rows_list = list(rows)

        # Najpierw bazowe sortowanie "overall" – stabilne i deterministyczne.
        rows_list.sort(
            key=lambda r: (
                -r.wins,
                -r.goal_difference,   # różnica setów
                -r.goals_for,         # sety wygrane
                -r.games_difference,  # różnica gemów
                -r.games_for,         # gemy wygrane
                r.team_name.lower(),
                r.team_id,
            )
        )

        stage_complete = all(m.status == Match.Status.FINISHED for m in all_stage_matches)
        if not stage_complete:
            return rows_list

        # Jeśli etap zakończony – rozstrzygamy remisy H2H w obrębie tych samych "wins".
        result: List[StandingRow] = []
        for _, block_iter in groupby(rows_list, key=lambda r: r.wins):
            block = list(block_iter)
            if len(block) == 1:
                result.extend(block)
                continue

            tied_ids: Set[int] = {r.team_id for r in block}
            h2h = _compute_h2h_metrics(tied_ids, finished_matches)

            block.sort(
                key=lambda r: (
                    -h2h.get(r.team_id, (0, 0, 0, 0, 0))[0],  # H2H wins
                    -h2h.get(r.team_id, (0, 0, 0, 0, 0))[1],  # H2H set diff
                    -h2h.get(r.team_id, (0, 0, 0, 0, 0))[2],  # H2H sets for
                    -h2h.get(r.team_id, (0, 0, 0, 0, 0))[3],  # H2H game diff
                    -h2h.get(r.team_id, (0, 0, 0, 0, 0))[4],  # H2H games for
                    -r.goal_difference,
                    -r.goals_for,
                    -r.games_difference,
                    -r.games_for,
                    r.team_name.lower(),
                    r.team_id,
                )
            )
            result.extend(block)

        return result


def _safe_int(v) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def _games_from_match(m: Match) -> Tuple[int, int]:
    """
    Sumuje gemy z m.tennis_sets.
    Tie-break nie jest liczony jako gemy.
    Funkcja defensywna.
    """
    sets = getattr(m, "tennis_sets", None)
    if not isinstance(sets, list):
        return (0, 0)

    hg = 0
    ag = 0
    for s in sets:
        if not isinstance(s, dict):
            continue
        hg += _safe_int(s.get("home_games"))
        ag += _safe_int(s.get("away_games"))
    return (hg, ag)


def _compute_h2h_metrics(tied_ids: Set[int], finished_matches: List[Match]) -> Dict[int, Tuple[int, int, int, int, int]]:
    """
    Zwraca metryki H2H dla każdej drużyny w grupie remisu:
    (wins, set_diff, sets_for, game_diff, games_for)

    Wykorzystujemy:
    - m.home_score/m.away_score jako sety (bo serializer ustawia wynik w setach),
    - m.tennis_sets jako źródło gemów (opcjonalne; jeśli brak danych to 0).
    """
    metrics: Dict[int, Tuple[int, int, int, int, int]] = {tid: (0, 0, 0, 0, 0) for tid in tied_ids}

    # Uproszczona aktualizacja krotek (niemutowalne)
    def add(tid: int, *, w: int = 0, sd: int = 0, sf: int = 0, gd: int = 0, gf: int = 0) -> None:
        cw, csd, csf, cgd, cgf = metrics.get(tid, (0, 0, 0, 0, 0))
        metrics[tid] = (cw + w, csd + sd, csf + sf, cgd + gd, cgf + gf)

    for m in finished_matches:
        if m.home_team_id not in tied_ids or m.away_team_id not in tied_ids:
            continue

        hs = _safe_int(m.home_score)
        aws = _safe_int(m.away_score)

        home_games, away_games = _games_from_match(m)

        # sety
        add(m.home_team_id, sd=(hs - aws), sf=hs)
        add(m.away_team_id, sd=(aws - hs), sf=aws)

        # gemy
        add(m.home_team_id, gd=(home_games - away_games), gf=home_games)
        add(m.away_team_id, gd=(away_games - home_games), gf=away_games)

        # zwycięstwo w meczu H2H
        if hs > aws:
            add(m.home_team_id, w=1)
        elif aws > hs:
            add(m.away_team_id, w=1)

    return metrics
