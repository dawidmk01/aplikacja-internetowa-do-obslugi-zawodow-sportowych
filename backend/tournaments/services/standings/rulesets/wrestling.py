# backend/tournaments/services/standings/rulesets/wrestling.py
# Plik definiuje reguły sortowania klasyfikacji zapaśniczej oparte na punktach klasyfikacyjnych PZZ/UWW core.

from __future__ import annotations

from typing import Iterable, List

from tournaments.models import Match
from tournaments.services.standings.rulesets.base import StandingsRuleset
from tournaments.services.standings.types import StandingRow


class WrestlingPZZRuleset(StandingsRuleset):
    """
    Klasa porządkuje klasyfikację dla zapasów w wariantach grupowych i Nordic.

    Aktualna kolejność kryteriów:
    1. punkty klasyfikacyjne,
    2. liczba zwycięstw,
    3. bilans punktów technicznych,
    4. punkty techniczne zdobyte,
    5. mniejsza liczba porażek,
    6. stabilny fallback: nazwa i identyfikator zawodnika.

    Jest to rdzeń klasyfikacji PZZ/UWW dla pierwszego etapu wdrożenia.
    Bardziej złożone remisy H2H i pełne kryteria Nordic mogą zostać dopięte
    w kolejnym kroku bez zmiany kontraktu rulesetu.
    """

    def sort_rows(
        self,
        rows: Iterable[StandingRow],
        finished_matches: List[Match],
        all_stage_matches: List[Match],
    ) -> List[StandingRow]:
        rows_list = list(rows)

        rows_list.sort(
            key=lambda row: (
                -row.points,
                -row.wins,
                -row.goal_difference,
                -row.goals_for,
                row.losses,
                row.team_name.lower(),
                row.team_id,
            )
        )

        for index, row in enumerate(rows_list, start=1):
            row.rank = index

        return rows_list
