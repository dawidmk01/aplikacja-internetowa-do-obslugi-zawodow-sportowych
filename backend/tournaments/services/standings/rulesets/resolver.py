from __future__ import annotations

from tournaments.models import Tournament

from .football import FootballPzpnRuleset
from .handball import HandballRuleset


def get_ruleset(tournament: Tournament):
    # Uwaga: dopasuj wartości do tego co masz w Tournament.Discipline (np. "football", "handball")
    d = (getattr(tournament, "discipline", "") or "").lower()

    if d == "handball":
        return HandballRuleset()

    # default
    return FootballPzpnRuleset()
