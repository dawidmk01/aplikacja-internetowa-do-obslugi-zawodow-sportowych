# backend/tournaments/services/standings/rulesets/resolver.py
# Plik udostępnia wybór reguł sortowania tabeli zależnie od dyscypliny turnieju.

from __future__ import annotations

from tournaments.models import Tournament

from .football import FootballPzpnRuleset
from .handball import HandballRuleset


def get_ruleset(tournament: Tournament):
    # Domyślny fallback utrzymuje zgodność dla dyscyplin bez dedykowanego rulesetu.
    discipline = (getattr(tournament, "discipline", "") or "").lower()

    if discipline == "handball":
        return HandballRuleset()

    return FootballPzpnRuleset()
