from django.db import transaction

from tournaments.models import Tournament, Stage, Team
from tournaments.services.generators.league import generate_league_stage
from tournaments.services.generators.knockout import generate_knockout_stage
from tournaments.services.generators.groups import generate_group_stage


@transaction.atomic
def ensure_matches_generated(tournament: Tournament) -> None:
    """
    Generuje (lub regeneruje) strukturę rozgrywek na podstawie
    faktycznej listy aktywnych uczestników (Team).

    Zasady:
    - źródłem prawdy są Team(is_active=True)
    - minimum 2 aktywne Team
    - funkcja NIE zarządza statusem turnieju
    """

    active_teams_count = Team.objects.filter(
        tournament=tournament,
        is_active=True,
    ).count()

    if active_teams_count < 2:
        return

    # RESET STRUKTURY (Match usuną się kaskadowo)
    Stage.objects.filter(tournament=tournament).delete()

    fmt = tournament.tournament_format

    if fmt == Tournament.TournamentFormat.LEAGUE:
        generate_league_stage(tournament)

    elif fmt == Tournament.TournamentFormat.MIXED:
        generate_group_stage(tournament)
        generate_knockout_stage(tournament)

    elif fmt == Tournament.TournamentFormat.CUP:
        generate_knockout_stage(tournament)
