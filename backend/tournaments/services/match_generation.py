# backend/tournaments/services/match_generation.py
# Plik udostępnia use-case generowania lub regenerowania struktury rozgrywek w kontekście aktywnej dywizji.

from __future__ import annotations

import copy

from django.db import transaction

from tournaments.models import Division, Stage, Team, Tournament
from tournaments.services.generators.groups import generate_group_stage
from tournaments.services.generators.knockout import generate_knockout_stage
from tournaments.services.generators.league import generate_league_stage

BYE_TEAM_NAME = "__SYSTEM_BYE__"


def _resolve_division(tournament: Tournament, division: Division | None = None) -> Division | None:
    if division is None:
        return tournament.get_default_division()

    if division.tournament_id != tournament.id:
        raise ValueError("Wskazana dywizja nie należy do tego turnieju.")

    return division


def _build_runtime_tournament(
    tournament: Tournament,
    division: Division | None,
) -> Tournament:
    if division is None:
        return tournament

    # Kopia runtime pozwala używać konfiguracji dywizji bez zapisu do Tournament.
    runtime = copy.copy(tournament)
    runtime.competition_type = division.competition_type
    runtime.competition_model = division.competition_model
    runtime.tournament_format = division.tournament_format
    runtime.format_config = dict(division.format_config or {})
    runtime.result_mode = division.result_mode
    runtime.result_config = dict(division.result_config or {})
    return runtime


@transaction.atomic
def ensure_matches_generated(
    tournament: Tournament,
    division: Division | None = None,
) -> None:
    division = _resolve_division(tournament, division)
    runtime_tournament = _build_runtime_tournament(tournament, division)

    active_teams = Team.objects.filter(tournament=tournament, is_active=True).exclude(name=BYE_TEAM_NAME)
    if division is not None:
        active_teams = active_teams.filter(division=division)

    active_teams = list(active_teams.order_by("id"))
    if len(active_teams) < 2:
        return

    stages_qs = Stage.objects.filter(tournament=tournament)
    if division is not None:
        stages_qs = stages_qs.filter(division=division)

    # Reset dotyczy wyłącznie etapu aktywnej dywizji.
    stages_qs.delete()

    tournament_format = runtime_tournament.tournament_format

    if tournament_format == Tournament.TournamentFormat.LEAGUE:
        generate_league_stage(tournament, division=division)

    elif tournament_format == Tournament.TournamentFormat.MIXED:
        generate_group_stage(tournament, division=division)

    elif tournament_format == Tournament.TournamentFormat.CUP:
        generate_knockout_stage(tournament, division=division, teams=active_teams)
