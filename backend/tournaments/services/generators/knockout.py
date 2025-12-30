"""
Generator rozgrywek pucharowych (KO – single elimination).

Moduł odpowiada za:
- utworzenie etapu pucharowego,
- wyznaczenie najbliższej potęgi 2,
- obsługę wolnych losów (bye),
- wygenerowanie pierwszej rundy drabinki.

Generator tworzy WYŁĄCZNIE pierwszą rundę.
Kolejne rundy są generowane dynamicznie na podstawie wyników.
"""

import math
from typing import List

from tournaments.models import (
    Tournament,
    Stage,
    Match,
    Team,
)


# ============================================================
# API PUBLICZNE
# ============================================================

def generate_knockout_stage(tournament: Tournament) -> Stage:
    """
    Generuje fazę pucharową turnieju (KO).

    Zakłada:
    - turniej w statusie DRAFT,
    - zatwierdzonych uczestników,
    - poprawną konfigurację domenową.

    Zwraca utworzony obiekt Stage.
    """
    _validate_tournament_state(tournament)

    teams = _get_active_teams(tournament)

    stage = Stage.objects.create(
        tournament=tournament,
        stage_type=Stage.StageType.KNOCKOUT,
        order=1,
    )

    bracket_size = _next_power_of_two(len(teams))
    byes_count = bracket_size - len(teams)

    seeded_teams = _apply_byes(teams, byes_count)

    _generate_first_round_matches(
        tournament=tournament,
        stage=stage,
        teams=seeded_teams,
    )

    return stage


# ============================================================
# WALIDACJA
# ============================================================

def _validate_tournament_state(tournament: Tournament) -> None:
    if tournament.status != Tournament.Status.DRAFT:
        raise ValueError(
            "Faza pucharowa może być generowana tylko dla turnieju w statusie DRAFT."
        )


def _get_active_teams(tournament: Tournament) -> List[Team]:
    teams = list(
        tournament.teams.filter(
            is_active=True
        ).order_by("id")
    )

    if len(teams) < 2:
        raise ValueError(
            "Do wygenerowania fazy pucharowej wymaganych jest co najmniej dwóch uczestników."
        )

    return teams



# ============================================================
# LOGIKA DRABINKI
# ============================================================

def _next_power_of_two(n: int) -> int:
    """
    Zwraca najbliższą potęgę 2 większą lub równą n.
    """
    return 2 ** math.ceil(math.log2(n))


def _apply_byes(teams: List[Team], byes_count: int) -> List[Team]:
    """
    Uzupełnia listę uczestników o wolne losy (bye).

    Wolne losy są reprezentowane przez None i obsługiwane
    podczas generowania meczów.
    """
    if byes_count <= 0:
        return teams

    return teams + [None] * byes_count


def _generate_first_round_matches(
    tournament: Tournament,
    stage: Stage,
    teams: List[Team],
) -> None:
    """
    Generuje mecze pierwszej rundy fazy pucharowej.

    Każda para (team vs team) tworzy mecz.
    Jeżeli występuje bye (None), mecz nie jest tworzony,
    a awans następuje automatycznie w kolejnej rundzie.
    """
    matches = []
    round_number = 1

    for i in range(0, len(teams), 2):
        home = teams[i]
        away = teams[i + 1]

        # Wolny los – brak meczu
        if home is None or away is None:
            continue

        matches.append(
            Match(
                tournament=tournament,
                stage=stage,
                home_team=home,
                away_team=away,
                round_number=round_number,
                status=Match.Status.SCHEDULED,
            )
        )

    Match.objects.bulk_create(matches)
