"""
Generator rozgrywek ligowych (round-robin z kolejkami).

Obsługuje:
- jedną rundę (każdy z każdym, jeden mecz),
- dwie rundy (rewanże – zmiana gospodarza),
- numerację kolejek,
- parzystą i nieparzystą liczbę uczestników.

Frontend otrzymuje gotowe dane do prezentacji (round_number).
"""

from typing import List, Tuple, Optional

from django.db import transaction

from tournaments.models import Tournament, Stage, Match, Team


# ============================================================
# API GŁÓWNE
# ============================================================

@transaction.atomic
def generate_league_stage(tournament: Tournament) -> Stage:
    """
    Generuje pełną strukturę ligi wraz z kolejkami i meczami.
    """
    _validate_tournament(tournament)

    teams = _get_approved_teams(tournament)

    # 1 = bez rewanżu, 2 = z rewanżem
    legs = tournament.get_league_legs()

    stage = Stage.objects.create(
        tournament=tournament,
        stage_type=Stage.StageType.LEAGUE,
        order=1,
    )

    base_schedule = _round_robin_schedule(teams)

    matches: list[Match] = []
    current_round = 1

    for leg in range(legs):
        for round_pairs in base_schedule:
            for home, away in round_pairs:
                # rewanż → zmiana gospodarza
                if leg == 1:
                    home, away = away, home

                matches.append(
                    Match(
                        tournament=tournament,
                        stage=stage,
                        round_number=current_round,
                        home_team=home,
                        away_team=away,
                        status=Match.Status.SCHEDULED,
                    )
                )
            current_round += 1

    Match.objects.bulk_create(matches)

    # zmiana statusu turnieju
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
            "Generator obsługuje wyłącznie format LEAGUE."
        )


def _get_approved_teams(tournament: Tournament) -> List[Team]:
    teams = list(
        tournament.teams.filter(
            is_active=True,
        ).order_by("id")
    )

    if len(teams) < 2:
        raise ValueError(
            "Liga wymaga co najmniej 2 zatwierdzonych uczestników."
        )

    return teams


# ============================================================
# ALGORYTM ROUND-ROBIN (KOLEJKI)
# ============================================================

def _round_robin_schedule(
    teams: List[Team],
) -> List[List[Tuple[Team, Team]]]:
    """
    Zwraca listę kolejek.
    Każda kolejka = lista par (home, away).
    """
    teams = teams[:]

    # nieparzysta liczba zespołów → pauza
    if len(teams) % 2 == 1:
        teams.append(None)

    n = len(teams)
    rounds = n - 1
    half = n // 2

    schedule: list[list[tuple[Team, Team]]] = []

    for _ in range(rounds):
        round_matches = []

        for i in range(half):
            t1 = teams[i]
            t2 = teams[n - 1 - i]

            if t1 is not None and t2 is not None:
                round_matches.append((t1, t2))

        schedule.append(round_matches)

        # algorytm kołowy
        teams = [teams[0]] + [teams[-1]] + teams[1:-1]

    return schedule
