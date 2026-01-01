"""
Generator rozgrywek ligowych (round-robin z kolejkami).

Obsługuje:
- jedną lub dwie rundy ligi (league_legs = 1 | 2),
- numerację kolejek (round_number),
- parzystą i nieparzystą liczbę uczestników (pauzy),
- pełną atomowość operacji.

Frontend steruje liczbą rund przez:
format_config["league_legs"] = 1 | 2
"""

from typing import List, Tuple, Optional
from django.db import transaction

from tournaments.models import Tournament, Stage, Match, Team


# ============================================================
# API PUBLICZNE
# ============================================================

@transaction.atomic
def generate_league_stage(tournament: Tournament) -> Stage:
    """
    Generuje pełną strukturę ligi wraz z kolejkami i meczami.
    """
    _validate_tournament(tournament)

    teams = _get_active_teams(tournament)
    league_legs = tournament.get_league_legs()

    if league_legs not in (1, 2):
        raise ValueError("league_legs musi wynosić 1 albo 2.")

    stage = Stage.objects.create(
        tournament=tournament,
        stage_type=Stage.StageType.LEAGUE,
        order=1,
    )

    schedule = _round_robin_schedule(teams)

    matches: list[Match] = []
    current_round = 1

    for leg in range(league_legs):
        for round_pairs in schedule:
            for home, away in round_pairs:
                # druga runda = rewanż (zamiana gospodarza)
                if leg == 1:
                    home, away = away, home

                matches.append(
                    Match(
                        tournament=tournament,
                        stage=stage,
                        home_team=home,
                        away_team=away,
                        round_number=current_round,
                        status=Match.Status.SCHEDULED,
                    )
                )

            current_round += 1

    if not matches:
        raise ValueError("Generator ligi nie utworzył żadnych meczów.")

    Match.objects.bulk_create(matches)

    tournament.status = Tournament.Status.CONFIGURED
    tournament.save(update_fields=["status"])

    return stage


# ============================================================
# WALIDACJE
# ============================================================

def _validate_tournament(tournament: Tournament) -> None:
    if tournament.status != Tournament.Status.DRAFT:
        raise ValueError(
            "Ligę można generować tylko dla turnieju w statusie DRAFT."
        )

    if tournament.tournament_format != Tournament.TournamentFormat.LEAGUE:
        raise ValueError(
            "Generator ligi obsługuje wyłącznie format LEAGUE."
        )


def _get_active_teams(tournament: Tournament) -> List[Team]:
    teams = list(
        tournament.teams.filter(is_active=True).order_by("id")
    )

    if len(teams) < 2:
        raise ValueError(
            "Liga wymaga co najmniej 2 aktywnych uczestników."
        )

    return teams


# ============================================================
# ROUND-ROBIN (KOLEJKI)
# ============================================================

def _round_robin_schedule(
    teams: List[Team],
) -> List[List[Tuple[Team, Team]]]:
    """
    Zwraca listę kolejek round-robin.

    Każda kolejka = lista par (home, away).

    Przy nieparzystej liczbie zespołów:
    - jedna pauza w każdej kolejce,
    - brak pustych meczów.
    """
    teams = teams[:]

    if len(teams) % 2 == 1:
        teams.append(None)

    n = len(teams)
    rounds = n - 1
    half = n // 2

    schedule: list[list[tuple[Team, Team]]] = []

    for _ in range(rounds):
        round_matches: list[tuple[Team, Team]] = []

        for i in range(half):
            t1 = teams[i]
            t2 = teams[n - 1 - i]

            if t1 is not None and t2 is not None:
                round_matches.append((t1, t2))

        schedule.append(round_matches)

        # algorytm kołowy
        teams = [teams[0]] + [teams[-1]] + teams[1:-1]

    return schedule
