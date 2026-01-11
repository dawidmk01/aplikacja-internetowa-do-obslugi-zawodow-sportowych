"""
Generator rozgrywek ligowych (round-robin z kolejkami).

Obsługuje:
- jedną lub dwie rundy ligi (league_matches = 1 | 2),
- numerację kolejek (round_number),
- parzystą i nieparzystą liczbę uczestników (pauzy),
- regenerację (czyści stare mecze ligowe przed dodaniem nowych),
- ochronę przed przypadkowym wciągnięciem BYE do ligi.

Frontend steruje liczbą rund przez:
format_config["league_matches"] = 1 | 2
"""

from __future__ import annotations

from typing import List, Tuple, Optional
from django.db import transaction

from tournaments.models import Tournament, Stage, Match, Team


BYE_TEAM_NAME = "__SYSTEM_BYE__"


@transaction.atomic
def generate_league_stage(tournament: Tournament) -> Stage:
    """
    Generuje pełną strukturę ligi wraz z kolejkami i meczami.
    UWAGA: Czyści istniejące mecze ligowe w tym etapie, jeśli liga była już generowana.
    """
    _validate_tournament(tournament)

    # ✅ LIGA NIGDY nie ma brać BYE jako uczestnika
    teams = _get_active_teams_excluding_bye(tournament)

    # ✅ źródło prawdy: format_config["league_matches"]
    league_matches = _get_league_matches(tournament)

    # 1) Pobierz lub stwórz etap
    stage, _created = Stage.objects.get_or_create(
        tournament=tournament,
        stage_type=Stage.StageType.LEAGUE,
        defaults={"order": 1, "status": Stage.Status.OPEN},
    )

    # 2) Wyczyść stare mecze tej ligi (żeby nie dublować)
    Match.objects.filter(stage=stage).delete()

    # 3) Harmonogram round-robin (pauzy przy nieparzystej liczbie drużyn)
    schedule = _round_robin_schedule(teams)

    matches: list[Match] = []
    current_round = 1

    # leg=0 -> pierwsza runda, leg=1 -> rewanże (zamiana gospodarza)
    for leg in range(league_matches):
        for round_pairs in schedule:
            for home, away in round_pairs:
                if leg == 0:
                    current_home, current_away = home, away
                else:
                    current_home, current_away = away, home

                matches.append(
                    Match(
                        tournament=tournament,
                        stage=stage,
                        home_team=current_home,
                        away_team=current_away,
                        round_number=current_round,
                        status=Match.Status.SCHEDULED,
                    )
                )
            current_round += 1

    if not matches:
        raise ValueError("Generator ligi nie utworzył żadnych meczów.")

    Match.objects.bulk_create(matches)

    # Status turnieju
    if tournament.status == Tournament.Status.DRAFT:
        tournament.status = Tournament.Status.CONFIGURED
        tournament.save(update_fields=["status"])

    return stage


# ============================================================
# WALIDACJE / KONFIG
# ============================================================

def _validate_tournament(tournament: Tournament) -> None:
    allowed_statuses = {Tournament.Status.DRAFT, Tournament.Status.CONFIGURED}
    if tournament.status not in allowed_statuses:
        raise ValueError(
            "Ligę można generować tylko dla turnieju w statusie DRAFT lub CONFIGURED. "
            f"Obecny status: {tournament.status}"
        )

    if tournament.tournament_format != Tournament.TournamentFormat.LEAGUE:
        raise ValueError("Generator ligi obsługuje wyłącznie format LEAGUE.")


def _get_league_matches(tournament: Tournament) -> int:
    cfg = tournament.format_config or {}
    try:
        v = int(cfg.get("league_matches", 1))
    except (TypeError, ValueError):
        v = 1

    if v not in (1, 2):
        raise ValueError("Liczba rund (league_matches) musi wynosić 1 albo 2.")
    return v


def _get_active_teams_excluding_bye(tournament: Tournament) -> List[Team]:
    # ✅ jeśli BYE istnieje, wymuś jego nieaktywność (żeby nie mieszał w /teams/setup/)
    Team.objects.filter(tournament=tournament, name=BYE_TEAM_NAME).update(is_active=False)

    teams = list(
        tournament.teams
        .filter(is_active=True)
        .exclude(name=BYE_TEAM_NAME)
        .order_by("id")
    )

    if len(teams) < 2:
        raise ValueError("Liga wymaga co najmniej 2 aktywnych uczestników.")
    return teams


# ============================================================
# ROUND-ROBIN (KOLEJKI)
# ============================================================

def _round_robin_schedule(teams: List[Team]) -> List[List[Tuple[Team, Team]]]:
    """
    Zwraca listę kolejek round-robin (algorytm Bergera).
    Przy nieparzystej liczbie drużyn dodajemy None jako pauzę,
    ale NIE generujemy meczu technicznego.
    """
    arr: List[Optional[Team]] = list(teams)

    if len(arr) % 2 == 1:
        arr.append(None)

    n = len(arr)
    rounds = n - 1
    half = n // 2

    schedule: list[list[tuple[Team, Team]]] = []

    for _ in range(rounds):
        round_matches: list[tuple[Team, Team]] = []

        for i in range(half):
            t1 = arr[i]
            t2 = arr[n - 1 - i]
            if t1 is not None and t2 is not None:
                round_matches.append((t1, t2))

        schedule.append(round_matches)

        # rotacja (Berger): element [0] zostaje, reszta przesuwa się w prawo
        arr = [arr[0]] + [arr[-1]] + arr[1:-1]

    return schedule
