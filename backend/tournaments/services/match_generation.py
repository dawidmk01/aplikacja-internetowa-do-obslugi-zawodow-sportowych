# backend/tournaments/services/match_generation.py
from django.db import transaction

from tournaments.models import Tournament, Stage, Team
from tournaments.services.generators.league import generate_league_stage
from tournaments.services.generators.knockout import generate_knockout_stage
from tournaments.services.generators.groups import generate_group_stage

BYE_TEAM_NAME = "__SYSTEM_BYE__"


@transaction.atomic
def ensure_matches_generated(tournament: Tournament) -> None:
    """
    Generuje (lub regeneruje) strukturę rozgrywek na podstawie
    faktycznej listy aktywnych uczestników (Team).

    Zasady:
    - źródłem prawdy są Team(is_active=True) Z WYŁĄCZENIEM __SYSTEM_BYE__
    - minimum 2 aktywnych Team
    - funkcja NIE zarządza statusem turnieju
    """

    active_teams = list(
        Team.objects.filter(tournament=tournament, is_active=True)
        .exclude(name=BYE_TEAM_NAME)
        .order_by("id")
    )

    if len(active_teams) < 2:
        return

    # RESET STRUKTURY (Match usuną się kaskadowo)
    Stage.objects.filter(tournament=tournament).delete()

    fmt = tournament.tournament_format

    if fmt == Tournament.TournamentFormat.LEAGUE:
        generate_league_stage(tournament)

    elif fmt == Tournament.TournamentFormat.MIXED:
        # tylko grupy; KO dopiero po /advance-from-groups/
        generate_group_stage(tournament)

    elif fmt == Tournament.TournamentFormat.CUP:
        # KLUCZOWE: KO musi brać TYLKO aktywnych uczestników
        generate_knockout_stage(tournament, teams=active_teams)
