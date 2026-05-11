# backend/tournaments/services/standings/rulesets/__init__.py
# Plik udostępnia publiczne eksporty reguł sortowania tabel wykorzystywanych przez warstwę klasyfikacji.

from tournaments.services.standings.rulesets.base import StandingsRuleset
from tournaments.services.standings.rulesets.basketball import BasketballRuleset
from tournaments.services.standings.rulesets.football import FootballRuleset
from tournaments.services.standings.rulesets.handball import HandballRuleset
from tournaments.services.standings.rulesets.tennis import TennisRuleset
from tournaments.services.standings.rulesets.wrestling import WrestlingRuleset

__all__ = [
    "StandingsRuleset",
    "BasketballRuleset",
    "FootballRuleset",
    "HandballRuleset",
    "TennisRuleset",
    "WrestlingRuleset",
]