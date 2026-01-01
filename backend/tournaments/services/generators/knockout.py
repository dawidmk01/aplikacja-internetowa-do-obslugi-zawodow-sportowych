"""
Generator rozgrywek pucharowych (KO – single elimination).

Obsługuje:
- rundy 1- lub 2-meczowe (cup_matches),
- wolne losy (bye),
- poprawną numerację rund.

Generator tworzy WYŁĄCZNIE pierwszą rundę.
Kolejne rundy są generowane dynamicznie po zakończeniu meczów.
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
    Generuje pierwszą rundę fazy pucharowej (KO).
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
            "Do wygenerowania fazy pucharowej wymaganych jest co najmniej dwóch aktywnych uczestników."
        )

    return teams


# ============================================================
# LOGIKA DRABINKI
# ============================================================

def _next_power_of_two(n: int) -> int:
    """
    Zwraca najbliższą potęgę 2 ≥ n.
    """
    return 2 ** math.ceil(math.log2(n))


def _apply_byes(
    teams: List[Team],
    byes_count: int,
) -> List[Optional[Team]]:
    """
    Dodaje wolne losy (bye) jako None.
    """
    if byes_count <= 0:
        return teams

    return teams + [None] * byes_count


def _generate_first_round_matches(
    tournament: Tournament,
    stage: Stage,
    teams: List[Optional[Team]],
    matches_per_pair: int,
) -> list[Match]:
    """
    Generuje pierwszą rundę fazy pucharowej.

    Dla każdej pary:
    - tworzy 1 lub 2 mecze,
    - przy bye (None) nie tworzy meczu.
    """
    matches: list[Match] = []
    round_number = 1

    for i in range(0, len(teams), 2):
        home = teams[i]
        away = teams[i + 1]

        # wolny los
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
