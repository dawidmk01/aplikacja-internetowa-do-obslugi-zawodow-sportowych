# backend/tournaments/services/standings/rulesets/tennis.py
# Plik definiuje zasady sortowania tabeli tenisowej dla ligi i grup w warstwie klasyfikacji.

from __future__ import annotations

from itertools import groupby
from typing import Any, Dict, Iterable, List, Literal, Optional, Set, Tuple

from tournaments.models import Match
from tournaments.services.standings.rulesets.base import StandingsRuleset
from tournaments.services.standings.types import StandingRow


TennisPointsMode = Literal["NONE", "PLT"]


class TennisRuleset(StandingsRuleset):
    """
    Klasa odwzorowuje zasady sortowania tabeli tenisowej.

    Obsługiwane są dwa tryby głównego kryterium:
    - NONE - tabela sortowana jest przede wszystkim po liczbie zwycięstw,
    - PLT - tabela sortowana jest przede wszystkim po punktach ligi tenisowej.

    Kolejność tie-breaku po zakończeniu etapu:
    - dla NONE: H2H wins, różnica setów, sety wygrane, różnica gemów, gemy wygrane,
    - dla PLT: H2H points, H2H wins, różnica setów, sety wygrane, różnica gemów, gemy wygrane.

    Po kryteriach H2H stosowane są dalej kryteria ogólne:
    - różnica setów,
    - sety wygrane,
    - różnica gemów,
    - gemy wygrane,
    - nazwa i identyfikator drużyny.
    """

    def __init__(self, points_mode: TennisPointsMode = "NONE") -> None:
        # Normalizacja chroni przed niepoprawnym trybem przekazanym z warstwy wywołującej.
        self.points_mode: TennisPointsMode = "PLT" if points_mode == "PLT" else "NONE"

    def sort_rows(
        self,
        rows: Iterable[StandingRow],
        finished_matches: List[Match],
        all_stage_matches: List[Match],
    ) -> List[StandingRow]:
        rows_list = list(rows)

        mode: TennisPointsMode = self.points_mode
        use_points = mode == "PLT"

        def overall_key(row: StandingRow):
            # Klucz bazowy buduje kolejność ogólną i stabilne bloki remisowe.
            primary = -(row.points if use_points else row.wins)
            secondary = -row.wins
            return (
                primary,
                secondary,
                -row.goal_difference,
                -row.goals_for,
                -row.games_difference,
                -row.games_for,
                row.team_name.lower(),
                row.team_id,
            )

        rows_list.sort(key=overall_key)

        stage_complete = all(match.status == Match.Status.FINISHED for match in all_stage_matches) if all_stage_matches else False
        if not stage_complete:
            return rows_list

        result: List[StandingRow] = []
        primary_group = (lambda row: row.points) if use_points else (lambda row: row.wins)

        # Remisy rozstrzygane są wyłącznie w obrębie tego samego kryterium głównego.
        for _, block_iter in groupby(rows_list, key=primary_group):
            block = list(block_iter)
            if len(block) == 1:
                result.extend(block)
                continue

            tied_ids: Set[int] = {row.team_id for row in block}
            h2h_metrics = _compute_h2h_metrics(tied_ids, finished_matches, mode=mode)

            def h2h_key(row: StandingRow):
                h2h_points, h2h_wins, h2h_set_diff, h2h_sets_for, h2h_games_diff, h2h_games_for = h2h_metrics.get(
                    row.team_id,
                    (0, 0, 0, 0, 0, 0),
                )
                return (
                    -h2h_points if use_points else 0,
                    -h2h_wins,
                    -h2h_set_diff,
                    -h2h_sets_for,
                    -h2h_games_diff,
                    -h2h_games_for,
                    *overall_key(row),
                )

            # H2H doprecyzowuje kolejność tylko wewnątrz aktualnego bloku remisu.
            block.sort(key=h2h_key)
            result.extend(block)

        return result


def _points_mode_from_matches(matches: List[Match]) -> Optional[TennisPointsMode]:
    """
    Funkcja pomocnicza odczytuje tryb punktacji z konfiguracji turnieju.

    Implementacja pozostaje w pliku jako pomocniczy fallback dla starszych ścieżek integracyjnych.
    """
    for match in matches:
        try:
            cfg = getattr(getattr(match, "tournament", None), "format_config", None) or {}
            mode = cfg.get("tennis_points_mode") or "NONE"
            if mode in ("NONE", "PLT"):
                return mode  # type: ignore[return-value]
        except Exception:
            continue
    return None


def _safe_int(value: Any) -> int:
    # Funkcja defensywna utrzymuje stabilność obliczeń przy niepełnych danych wejściowych.
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _games_from_match(match: Match) -> Tuple[int, int]:
    """
    Funkcja sumuje gemy z tenisowych setów zapisanych w strukturze `tennis_sets`.

    Tie-break nie jest liczony jako gem, dlatego do bilansu trafiają wyłącznie wartości `home_games`
    i `away_games` zapisane dla każdego seta.
    """
    tennis_sets = getattr(match, "tennis_sets", None)
    if not isinstance(tennis_sets, list):
        return (0, 0)

    home_games = 0
    away_games = 0

    for set_item in tennis_sets:
        if not isinstance(set_item, dict):
            continue
        home_games += _safe_int(set_item.get("home_games"))
        away_games += _safe_int(set_item.get("away_games"))

    return (home_games, away_games)


def _plt_points_from_sets(home_sets: int, away_sets: int, tennis_sets: Any) -> Tuple[int, int]:
    """
    Funkcja przelicza wynik meczu na punkty w wariancie PLT.

    Model punktacji:
    - zwycięstwo bez straty seta - 10/2,
    - zwycięstwo z oddanym setem - 8/4,
    - brak danych setowych przy wyniku 0:0 traktowany jest defensywnie jako brak klasyfikowalnego wyniku.
    """
    if (not tennis_sets) and home_sets == 0 and away_sets == 0:
        return (0, 0)

    if home_sets == away_sets:
        return (0, 0)

    home_won = home_sets > away_sets
    loser_sets = min(home_sets, away_sets)

    # Rozróżnienie wyniku prostego i wyniku z oddanym setem wpływa na wagę punktową.
    if loser_sets == 0:
        return (10, 2) if home_won else (2, 10)

    return (8, 4) if home_won else (4, 8)


def _compute_h2h_metrics(
    tied_ids: Set[int],
    finished_matches: List[Match],
    *,
    mode: TennisPointsMode,
) -> Dict[int, Tuple[int, int, int, int, int, int]]:
    """
    Funkcja oblicza metryki H2H dla bloku drużyn remisujących.

    Zwracana krotka oznacza kolejno:
    - punkty H2H,
    - zwycięstwa H2H,
    - różnicę setów H2H,
    - sety wygrane H2H,
    - różnicę gemów H2H,
    - gemy wygrane H2H.
    """
    metrics: Dict[int, Tuple[int, int, int, int, int, int]] = {
        team_id: (0, 0, 0, 0, 0, 0) for team_id in tied_ids
    }

    def add(
        team_id: int,
        *,
        points: int = 0,
        wins: int = 0,
        set_diff: int = 0,
        sets_for: int = 0,
        games_diff: int = 0,
        games_for: int = 0,
    ) -> None:
        current_points, current_wins, current_set_diff, current_sets_for, current_games_diff, current_games_for = metrics.get(
            team_id,
            (0, 0, 0, 0, 0, 0),
        )
        metrics[team_id] = (
            current_points + points,
            current_wins + wins,
            current_set_diff + set_diff,
            current_sets_for + sets_for,
            current_games_diff + games_diff,
            current_games_for + games_for,
        )

    use_points = mode == "PLT"

    # Analizowane są wyłącznie mecze wewnątrz badanego bloku remisu.
    for match in finished_matches:
        if match.home_team_id not in tied_ids or match.away_team_id not in tied_ids:
            continue

        home_sets = _safe_int(match.home_score)
        away_sets = _safe_int(match.away_score)
        tennis_sets = getattr(match, "tennis_sets", None)

        home_games, away_games = _games_from_match(match)

        add(match.home_team_id, set_diff=home_sets - away_sets, sets_for=home_sets)
        add(match.away_team_id, set_diff=away_sets - home_sets, sets_for=away_sets)

        add(match.home_team_id, games_diff=home_games - away_games, games_for=home_games)
        add(match.away_team_id, games_diff=away_games - home_games, games_for=away_games)

        if home_sets > away_sets:
            add(match.home_team_id, wins=1)
        elif away_sets > home_sets:
            add(match.away_team_id, wins=1)

        if use_points:
            home_points, away_points = _plt_points_from_sets(home_sets, away_sets, tennis_sets)
            add(match.home_team_id, points=home_points)
            add(match.away_team_id, points=away_points)

    return metrics
