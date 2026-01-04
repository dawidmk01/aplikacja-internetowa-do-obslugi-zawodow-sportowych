"""
Generator rozgrywek ligowych (round-robin z kolejkami).

Obsługuje:
- jedną lub dwie rundy ligi (league_matches = 1 | 2),
- numerację kolejek (round_number),
- parzystą i nieparzystą liczbę uczestników (pauzy),
- pełną atomowość operacji (czyszczenie starych meczów przed dodaniem nowych).

Frontend steruje liczbą rund przez:
format_config["league_matches"] = 1 | 2
"""

from typing import List, Tuple
from django.db import transaction

from tournaments.models import Tournament, Stage, Match, Team


# ============================================================
# API PUBLICZNE
# ============================================================

@transaction.atomic
def generate_league_stage(tournament: Tournament) -> Stage:
    """
    Generuje pełną strukturę ligi wraz z kolejkami i meczami.
    UWAGA: Usuwa istniejące mecze ligowe, jeśli turniej był już generowany.
    """
    _validate_tournament(tournament)

    teams = _get_active_teams(tournament)

    # Ta metoda pobiera teraz wartość z klucza "league_matches" (dzięki zmianie w models.py)
    league_legs = tournament.get_league_legs()

    if league_legs not in (1, 2):
        raise ValueError("Liczba rund (league_matches) musi wynosić 1 albo 2.")

    # 1. Pobierz lub stwórz etap (zamiast create, używamy get_or_create)
    stage, created = Stage.objects.get_or_create(
        tournament=tournament,
        stage_type=Stage.StageType.LEAGUE,
        defaults={
            "order": 1,
            "status": Stage.Status.OPEN
        }
    )

    # 2. WAŻNE: Wyczyść stare mecze przed generowaniem nowych!
    # To naprawia problem "6 meczów zamiast 12" przy ponownym generowaniu.
    Match.objects.filter(stage=stage).delete()

    # 3. Generowanie harmonogramu (Round Robin - każdy z każdym)
    schedule = _round_robin_schedule(teams)

    matches: list[Match] = []
    current_round = 1

    # Pętla generująca rundy (1 = tylko mecz, 2 = mecz i rewanż)
    for leg in range(league_legs):
        for round_pairs in schedule:
            for home, away in round_pairs:
                # Druga tura (leg == 1) to rewanże -> zamiana gospodarza
                current_home, current_away = home, away
                if leg == 1:
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

    # Aktualizujemy status turnieju na CONFIGURED, jeśli był w DRAFT
    if tournament.status == Tournament.Status.DRAFT:
        tournament.status = Tournament.Status.CONFIGURED
        tournament.save(update_fields=["status"])

    return stage


# ============================================================
# WALIDACJE
# ============================================================

def _validate_tournament(tournament: Tournament) -> None:
    # Pozwalamy na regenerację, jeśli status to CONFIGURED (już wygenerowany)
    allowed_statuses = [Tournament.Status.DRAFT, Tournament.Status.CONFIGURED]

    if tournament.status not in allowed_statuses:
        raise ValueError(
            f"Ligę można generować tylko dla turnieju w statusie DRAFT lub CONFIGURED. Obecny status: {tournament.status}"
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
    Zwraca listę kolejek round-robin (algorytm kołowy).
    """
    teams = teams[:]

    # Obsługa nieparzystej liczby drużyn (dodajemy "None" jako pauzę)
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

            # Jeśli żadna z drużyn nie jest pauzą, tworzymy parę
            if t1 is not None and t2 is not None:
                round_matches.append((t1, t2))

        schedule.append(round_matches)

        # Rotacja drużyn (algorytm Bergera)
        # Element [0] zostaje, reszta przesuwa się w prawo
        teams = [teams[0]] + [teams[-1]] + teams[1:-1]

    return schedule