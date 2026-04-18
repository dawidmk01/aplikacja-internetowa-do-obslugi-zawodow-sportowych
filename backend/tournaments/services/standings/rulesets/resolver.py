# backend/tournaments/services/standings/rulesets/resolver.py
# Plik udostępnia wybór reguł sortowania tabeli zależnie od dyscypliny turnieju.

from __future__ import annotations

from tournaments.models import Tournament

from .basketball import BasketballFibaRuleset
from .football import FootballPzpnRuleset
from .handball import HandballRuleset
from .tennis import TennisRuleset


def get_ruleset(tournament: Tournament):
    # Domyślny fallback utrzymuje zgodność dla dyscyplin bez dedykowanego rulesetu.
    discipline = (getattr(tournament, "discipline", "") or "").lower()
    format_config = dict(getattr(tournament, "format_config", None) or {})

    if discipline == "handball":
        return HandballRuleset()

    if discipline == "basketball":
        return BasketballFibaRuleset()

    if discipline == "tennis":
        mode = (format_config.get("tennis_points_mode") or "NONE").upper()
        return TennisRuleset(points_mode="PLT" if mode == "PLT" else "NONE")

    return FootballPzpnRuleset()