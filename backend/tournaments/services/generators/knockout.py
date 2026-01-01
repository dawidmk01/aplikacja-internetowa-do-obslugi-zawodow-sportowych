"""
Generator rozgrywek pucharowych (KO – single elimination).

Obsługuje:
- generowanie pierwszej rundy,
- wolne losy (BYE) w pierwszej rundzie,
- dynamiczne generowanie kolejnych rund po zatwierdzeniu etapu.

Zasady domenowe:
- BYE jest cechą RUNDY, nie zawodnika,
- BYE może wystąpić tylko wtedy, gdy liczba zawodników jest nieparzysta,
- liczba zawodników zawsze maleje aż do jednego zwycięzcy.
"""

import math
from typing import List, Optional

from django.db import transaction

from tournaments.models import Tournament, Stage, Match, Team


# ============================================================
# API PUBLICZNE
# ============================================================

@transaction.atomic
def generate_knockout_stage(tournament: Tournament) -> Stage:
    """
    Generuje PIERWSZY etap fazy pucharowej (KO).
    """

    _validate_tournament(tournament)

    teams = _get_active_teams(tournament)
    cfg = tournament.format_config or {}

    cup_matches = int(cfg.get("cup_matches", 1))
    if cup_matches not in (1, 2):
        raise ValueError("cup_matches musi wynosić 1 albo 2.")

    stage = Stage.objects.create(
        tournament=tournament,
        stage_type=Stage.StageType.KNOCKOUT,
        order=1,
        status=Stage.Status.OPEN,
    )

    bracket_size = _next_power_of_two(len(teams))
    byes_count = bracket_size - len(teams)

    seeded_teams = _apply_byes(teams, byes_count)

    matches = _generate_first_round_matches(
        tournament=tournament,
        stage=stage,
        teams=seeded_teams,
        matches_per_pair=cup_matches,
    )

    if not matches:
        raise ValueError("Generator pucharowy nie utworzył żadnych meczów.")

    Match.objects.bulk_create(matches)

    tournament.status = Tournament.Status.CONFIGURED
    tournament.save(update_fields=["status"])

    return stage


@transaction.atomic
def generate_next_knockout_stage(stage: Stage) -> Stage:
    """
    Generuje KOLEJNY etap fazy pucharowej na podstawie
    zwycięzców poprzedniego etapu.

    Obsługuje BYE w sposób domenowo poprawny.
    """

    if stage.status != Stage.Status.OPEN:
        raise ValueError("Etap został już zamknięty.")

    matches = stage.matches.all()

    # 1. wszystkie mecze muszą być zakończone
    if matches.exclude(status=Match.Status.FINISHED).exists():
        raise ValueError("Nie wszystkie mecze etapu są zakończone.")

    # 2. zbieramy zwycięzców
    winners: List[Team] = []
    for match in matches:
        if not match.winner:
            raise ValueError("Brak zwycięzcy meczu w fazie pucharowej.")
        winners.append(match.winner)

    # 3. zamykamy bieżący etap
    stage.status = Stage.Status.CLOSED
    stage.save(update_fields=["status"])

    # 4. jeden zwycięzca → KONIEC TURNIEJU
    if len(winners) == 1:
        tournament = stage.tournament
        tournament.status = Tournament.Status.FINISHED
        tournament.save(update_fields=["status"])
        return stage

    # 5. tworzymy nowy etap
    next_stage = Stage.objects.create(
        tournament=stage.tournament,
        stage_type=Stage.StageType.KNOCKOUT,
        order=stage.order + 1,
        status=Stage.Status.OPEN,
    )

    # 6. obsługa BYE (maksymalnie jeden)

    bye_team: Optional[Team] = None
    if len(winners) % 2 == 1:
        bye_team = winners.pop()

        Match.objects.create(
            tournament=stage.tournament,
            stage=next_stage,
            home_team=bye_team,
            away_team=bye_team,  # technicznie, ale bez gry
            round_number=1,
            status=Match.Status.FINISHED,
            winner=bye_team,
        )

    # 7. parowanie pozostałych
    for i in range(0, len(winners), 2):
        Match.objects.create(
            tournament=stage.tournament,
            stage=next_stage,
            home_team=winners[i],
            away_team=winners[i + 1],
            round_number=1,
            status=Match.Status.SCHEDULED,
        )

    # 8. BYE nie jest meczem – zawodnik zostanie uwzględniony
    #    przy generowaniu KOLEJNEJ rundy (po zatwierdzeniu etapu)
    if bye_team:
        # BYE nie tworzy rekordu Match
        pass

    return next_stage


# ============================================================
# WALIDACJE
# ============================================================

def _validate_tournament(tournament: Tournament) -> None:
    if tournament.status != Tournament.Status.DRAFT:
        raise ValueError(
            "Faza pucharowa może być generowana tylko dla turnieju w statusie DRAFT."
        )

    if tournament.tournament_format != Tournament.TournamentFormat.CUP:
        raise ValueError(
            "Generator pucharowy obsługuje wyłącznie format CUP."
        )


def _get_active_teams(tournament: Tournament) -> List[Team]:
    teams = list(
        tournament.teams.filter(is_active=True).order_by("id")
    )

    if len(teams) < 2:
        raise ValueError(
            "Do wygenerowania fazy pucharowej wymaganych jest co najmniej dwóch uczestników."
        )

    return teams


# ============================================================
# LOGIKA DRABINKI – RUNDA 1
# ============================================================

def _next_power_of_two(n: int) -> int:
    """
    Zwraca najmniejszą potęgę 2 ≥ n.
    """
    return 2 ** math.ceil(math.log2(n))


def _apply_byes(
    teams: List[Team],
    byes_count: int,
) -> List[Optional[Team]]:
    """
    Dodaje BYE jako None – tylko w pierwszej rundzie.
    """
    if byes_count <= 0:
        return teams

    return teams + [None] * byes_count


def _generate_first_round_matches(
    tournament: Tournament,
    stage: Stage,
    teams: List[Optional[Team]],
    matches_per_pair: int,
) -> List[Match]:
    """
    Generuje mecze pierwszej rundy KO.
    """

    matches: List[Match] = []
    round_number = 1

    for i in range(0, len(teams), 2):
        home = teams[i]
        away = teams[i + 1]

        # BYE → brak meczu
        if home is None or away is None:
            continue

        for m in range(matches_per_pair):
            h, a = (home, away) if m == 0 else (away, home)

            matches.append(
                Match(
                    tournament=tournament,
                    stage=stage,
                    home_team=h,
                    away_team=a,
                    round_number=round_number,
                    status=Match.Status.SCHEDULED,
                )
            )

    return matches
