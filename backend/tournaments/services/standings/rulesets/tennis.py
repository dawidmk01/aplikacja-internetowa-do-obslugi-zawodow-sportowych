from __future__ import annotations

from itertools import groupby
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple, Literal

from tournaments.models import Match
from tournaments.services.standings.rulesets.base import StandingsRuleset
from tournaments.services.standings.types import StandingRow


TennisPointsMode = Literal["NONE", "PLT"]


class TennisRuleset(StandingsRuleset):
    """
    Tenis – kolejność w tabeli dla ligi / grup.

    Pola (jak w projekcie):
    - wins / losses: zwycięstwa i porażki
    - goals_for / goals_against / goal_difference: sety wygrane / przegrane / różnica setów
    - games_for / games_against / games_difference: gemy wygrane / przegrane / różnica gemów

    Dwa tryby punktacji (Tournament.format_config.tennis_points_mode):
    - "NONE": brak punktów, sortujemy po wins (zwycięstwach)
    - "PLT": punktacja jak Polska Liga Tenisa (10/8/4/2/0) → sortujemy po points

    Tie-break (gdy etap zakończony) – H2H w obrębie remisu po kryterium głównym:
    - "NONE": remis po wins → H2H: wins, set diff, sets for, game diff, games for
    - "PLT": remis po points → H2H: points, wins, set diff, sets for, game diff, games for

    Potem (overall):
    - różnica setów
    - sety wygrane
    - różnica gemów
    - gemy wygrane
    - deterministycznie: nazwa, id
    """

    def __init__(self, points_mode: TennisPointsMode = "NONE") -> None:
        # defensywnie normalizujemy
        self.points_mode: TennisPointsMode = "PLT" if points_mode == "PLT" else "NONE"

    def sort_rows(
        self,
        rows: Iterable[StandingRow],
        finished_matches: List[Match],
        all_stage_matches: List[Match],
    ) -> List[StandingRow]:
        rows_list = list(rows)

        mode: TennisPointsMode = self.points_mode
        use_points = (mode == "PLT")

        # Bazowe sortowanie (overall) – stabilne i deterministyczne
        def overall_key(r: StandingRow):
            primary = -(r.points if use_points else r.wins)
            secondary = -r.wins  # zawsze przydatne jako 2. kryterium (np. PLT)
            return (
                primary,
                secondary,
                -r.goal_difference,   # różnica setów
                -r.goals_for,         # sety wygrane
                -r.games_difference,  # różnica gemów
                -r.games_for,         # gemy wygrane
                r.team_name.lower(),
                r.team_id,
            )

        rows_list.sort(key=overall_key)

        stage_complete = all(m.status == Match.Status.FINISHED for m in all_stage_matches) if all_stage_matches else False
        if not stage_complete:
            return rows_list

        # Po zakończeniu etapu: rozstrzygamy remisy H2H w obrębie tego samego kryterium głównego
        result: List[StandingRow] = []
        primary_group = (lambda r: r.points) if use_points else (lambda r: r.wins)

        for _, block_iter in groupby(rows_list, key=primary_group):
            block = list(block_iter)
            if len(block) == 1:
                result.extend(block)
                continue

            tied_ids: Set[int] = {r.team_id for r in block}

            h2h = _compute_h2h_metrics(tied_ids, finished_matches, mode=mode)

            def h2h_key(r: StandingRow):
                hp, hw, hsd, hsf, hgd, hgf = h2h.get(r.team_id, (0, 0, 0, 0, 0, 0))
                return (
                    -hp if use_points else 0,  # w NONE nie używamy H2H points
                    -hw,
                    -hsd,
                    -hsf,
                    -hgd,
                    -hgf,
                    *overall_key(r),
                )

            block.sort(key=h2h_key)
            result.extend(block)

        return result


# --- Poniżej helpery zostają, ale _points_mode_from_matches jest już nieużywany. ---
#     Możesz go usunąć, jeśli chcesz “czyściutki” plik.

def _points_mode_from_matches(matches: List[Match]) -> Optional[TennisPointsMode]:
    """
    (Legacy) Pobiera format_config.tennis_points_mode z turnieju (z dowolnego meczu),
    domyślnie "NONE".
    Nieużywane po przejściu na TennisRuleset(points_mode=...).
    """
    for m in matches:
        try:
            cfg = getattr(getattr(m, "tournament", None), "format_config", None) or {}
            mode = cfg.get("tennis_points_mode") or "NONE"
            if mode in ("NONE", "PLT"):
                return mode  # type: ignore[return-value]
        except Exception:
            continue
    return None


def _safe_int(v: Any) -> int:
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


def _plt_points_from_sets(home_sets: int, away_sets: int, tennis_sets: Any) -> Tuple[int, int]:
    """
    Punktacja PLT wg przykładu:
    - wygrana 2:0 -> 10 pkt, przegrana -> 2 pkt
    - wygrana 2:1 -> 8 pkt,  przegrana -> 4 pkt
    - walkower -> 0 pkt (brak pewnego sygnału w modelu, więc wykrywamy tylko defensywnie)

    Uogólnienie dla BO5:
    - wygrana "do zera" (np. 3:0) traktowana jak straight sets -> 10/2
    - wygrana z oddanym setem (np. 3:1, 3:2) -> 8/4
    """
    # Defensywny “walkower”: etap FINISHED bez danych setów i bez wyniku
    if (not tennis_sets) and home_sets == 0 and away_sets == 0:
        return (0, 0)

    if home_sets == away_sets:
        # remis w setach w tenisie nie powinien wystąpić, ale defensywnie:
        return (0, 0)

    home_won = home_sets > away_sets
    loser_sets = min(home_sets, away_sets)

    # straight sets: przegrany 0
    if loser_sets == 0:
        return (10, 2) if home_won else (2, 10)

    # pozostałe: 8/4
    return (8, 4) if home_won else (4, 8)


def _compute_h2h_metrics(
    tied_ids: Set[int],
    finished_matches: List[Match],
    *,
    mode: TennisPointsMode,
) -> Dict[int, Tuple[int, int, int, int, int, int]]:
    """
    Zwraca metryki H2H dla każdej drużyny w grupie remisu:
    (points, wins, set_diff, sets_for, game_diff, games_for)

    - sety: m.home_score / m.away_score (w projekcie to sety dla tenisa)
    - gemy: z m.tennis_sets (opcjonalne; jeśli brak danych to 0)
    - punkty: tylko w trybie PLT, w NONE = 0
    """
    metrics: Dict[int, Tuple[int, int, int, int, int, int]] = {
        tid: (0, 0, 0, 0, 0, 0) for tid in tied_ids
    }

    def add(
        tid: int,
        *,
        p: int = 0,
        w: int = 0,
        sd: int = 0,
        sf: int = 0,
        gd: int = 0,
        gf: int = 0,
    ) -> None:
        cp, cw, csd, csf, cgd, cgf = metrics.get(tid, (0, 0, 0, 0, 0, 0))
        metrics[tid] = (cp + p, cw + w, csd + sd, csf + sf, cgd + gd, cgf + gf)

    use_points = (mode == "PLT")

    for m in finished_matches:
        if m.home_team_id not in tied_ids or m.away_team_id not in tied_ids:
            continue

        hs = _safe_int(m.home_score)
        aws = _safe_int(m.away_score)
        tennis_sets = getattr(m, "tennis_sets", None)

        home_games, away_games = _games_from_match(m)

        # sety
        add(m.home_team_id, sd=(hs - aws), sf=hs)
        add(m.away_team_id, sd=(aws - hs), sf=aws)

        # gemy
        add(m.home_team_id, gd=(home_games - away_games), gf=home_games)
        add(m.away_team_id, gd=(away_games - home_games), gf=away_games)

        # zwycięstwo H2H
        if hs > aws:
            add(m.home_team_id, w=1)
        elif aws > hs:
            add(m.away_team_id, w=1)

        # punkty H2H (PLT)
        if use_points:
            ph, pa = _plt_points_from_sets(hs, aws, tennis_sets)
            add(m.home_team_id, p=ph)
            add(m.away_team_id, p=pa)

    return metrics
