# backend/tournaments/services/standings/rulesets/__init__.py
# Plik udostępnia publiczne eksporty reguł sortowania tabel wykorzystywanych przez warstwę klasyfikacji.

from tournaments.services.standings.rulesets.base import StandingsRuleset
from tournaments.services.standings.rulesets.football import FootballPZPNRuleset
from tournaments.services.standings.rulesets.handball import HandballRuleset
from tournaments.services.standings.rulesets.tennis import TennisRuleset

__all__ = [
    "StandingsRuleset",
    "FootballPZPNRuleset",
    "HandballRuleset",
    "TennisRuleset",
]
