# backend/tournaments/services/standings/rulesets/base.py
# Plik definiuje kontrakt interfejsu dla reguł sortowania tabel w warstwie klasyfikacji.

from __future__ import annotations

from typing import Iterable, List, Protocol

from tournaments.models import Match
from tournaments.services.standings.types import StandingRow


class StandingsRuleset(Protocol):
    # Protokół określa wspólny interfejs dla implementacji reguł dyscyplin.
    def sort_rows(
        self,
        rows: Iterable[StandingRow],
        finished_matches: List[Match],
        all_stage_matches: List[Match],
    ) -> List[StandingRow]:
        ...

