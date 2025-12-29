"""
Moduł odpowiedzialny za awans uczestników z fazy grupowej
do fazy pucharowej (KO).

Awans jest wyznaczany na podstawie tabel grupowych,
zgodnie z konfiguracją turnieju.
"""

from tournaments.models import (
    Tournament,
    Stage,
    Group,
    Team,
)

from tournaments.services.standings.league_table import (
    compute_stage_standings,
)

from tournaments.services.generators.knockout import (
    generate_knockout_stage,
)


# ============================================================
# API PUBLICZNE
# ============================================================

def advance_from_groups_to_knockout(tournament: Tournament) -> Stage:
    """
    Wyznacza uczestników awansujących z fazy grupowej
    i generuje fazę pucharową (KO).

    Zakłada:
    - zakończone wszystkie mecze grupowe,
    - poprawną konfigurację awansu,
    - brak wcześniej wygenerowanej fazy KO.

    Zwraca nowo utworzony etap KO.
    """
    group_stage = _get_group_stage(tournament)
    advance_per_group = _get_advance_config(tournament)

    advancing_teams = []

    for group in group_stage.groups.all():
        standings = compute_stage_standings(
            tournament=tournament,
            stage=group_stage,
            group=group,
        )

        if len(standings) < advance_per_group:
            raise ValueError(
                f"Grupa {group.name} nie posiada wystarczającej liczby uczestników."
            )

        advancing_teams.extend(
            _get_top_teams_from_standings(standings, advance_per_group)
        )

    _replace_tournament_teams(tournament, advancing_teams)

    knockout_stage = generate_knockout_stage(tournament)
    return knockout_stage


# ============================================================
# WALIDACJA I POMOCNICZE
# ============================================================

def _get_group_stage(tournament: Tournament) -> Stage:
    try:
        return tournament.stages.get(stage_type=Stage.StageType.GROUP)
    except Stage.DoesNotExist:
        raise ValueError("Turniej nie posiada fazy grupowej.")


def _get_advance_config(tournament: Tournament) -> int:
    advance_per_group = tournament.format_config.get("advance_per_group")

    if not isinstance(advance_per_group, int) or advance_per_group < 1:
        raise ValueError("Niepoprawna konfiguracja awansu z grup.")

    return advance_per_group


def _get_top_teams_from_standings(
    standings,
    limit: int,
) -> list[Team]:
    """
    Zwraca listę Team na podstawie tabeli wyników.
    """
    return [
        Team.objects.get(id=row.team_id)
        for row in standings[:limit]
    ]


def _replace_tournament_teams(
    tournament: Tournament,
    advancing_teams: list[Team],
) -> None:
    """
    Zastępuje listę uczestników turnieju listą zespołów,
    które awansowały do fazy pucharowej.

    Operacja jest logiczna (a nie fizyczna) – dezaktywujemy
    nieawansujących.
    """
    advancing_ids = {team.id for team in advancing_teams}

    for team in tournament.teams.all():
        if team.id in advancing_ids:
            team.is_active = True
            team.status = Team.Status.APPROVED
        else:
            team.is_active = False

        team.save(update_fields=["is_active", "status"])
