"""
Moduł odpowiedzialny za awans uczestników z fazy grupowej
do fazy pucharowej (KO).

Awans wyznaczany jest na podstawie tabel grupowych,
zgodnie z konfiguracją turnieju.
"""

from django.db import transaction

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

@transaction.atomic
def advance_from_groups_to_knockout(tournament: Tournament) -> Stage:
    """
    Wyznacza zespoły awansujące z fazy grupowej
    i generuje fazę pucharową (KO).

    Zakłada:
    - istniejącą fazę GROUP,
    - zakończone mecze grupowe,
    - poprawną konfigurację awansu,
    - brak istniejącej fazy KO.
    """
    group_stage = _get_group_stage(tournament)
    _ensure_no_existing_knockout(tournament)

    advance_per_group = _get_advance_config(tournament)

    advancing_teams: list[Team] = []

    for group in group_stage.groups.all():
        standings = compute_stage_standings(
            tournament=tournament,
            stage=group_stage,
            group=group,
        )

        if len(standings) < advance_per_group:
            raise ValueError(
                f"Grupa {group.name} ma za mało uczestników do awansu."
            )

        advancing_teams.extend(
            _get_top_teams_from_standings(
                standings,
                advance_per_group,
            )
        )

    _replace_tournament_teams(tournament, advancing_teams)

    return generate_knockout_stage(tournament)


# ============================================================
# WALIDACJE
# ============================================================

def _get_group_stage(tournament: Tournament) -> Stage:
    try:
        return tournament.stages.get(
            stage_type=Stage.StageType.GROUP
        )
    except Stage.DoesNotExist:
        raise ValueError(
            "Turniej nie posiada fazy grupowej."
        )


def _ensure_no_existing_knockout(tournament: Tournament) -> None:
    if tournament.stages.filter(
        stage_type=Stage.StageType.KNOCKOUT
    ).exists():
        raise ValueError(
            "Faza pucharowa została już wygenerowana."
        )


def _get_advance_config(tournament: Tournament) -> int:
    """
    Odczyt konfiguracji awansu z grup.
    """
    advance_per_group = tournament.format_config.get(
        "advance_from_group"
    )

    if not isinstance(advance_per_group, int) or advance_per_group < 1:
        raise ValueError(
            "Niepoprawna konfiguracja awansu z grup."
        )

    return advance_per_group


# ============================================================
# POMOCNICZE
# ============================================================

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
    Dezaktywuje zespoły, które nie awansowały do KO.
    """
    advancing_ids = {team.id for team in advancing_teams}

    for team in tournament.teams.all():
        team.is_active = team.id in advancing_ids
        team.save(update_fields=["is_active"])
