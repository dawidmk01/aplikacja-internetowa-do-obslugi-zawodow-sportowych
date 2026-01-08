from __future__ import annotations

from tournaments.models import Tournament
from tournaments.services.standings.rulesets.football import FootballPZPNRuleset
from tournaments.services.standings.rulesets.handball import HandballRuleset
from tournaments.services.standings.rulesets.base import StandingsRuleset


def get_ruleset(tournament: Tournament) -> StandingsRuleset:
    # Jeśli masz enum: Tournament.Discipline.HANDBALL itd. -> podmień porównanie.
    if (tournament.discipline or "").lower() == "handball":
        return HandballRuleset()
    return FootballPZPNRuleset()
