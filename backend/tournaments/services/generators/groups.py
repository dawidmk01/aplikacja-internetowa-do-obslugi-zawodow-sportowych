"""
Generator fazy grupowej turnieju (mini-ligi) z przygotowaniem awansu do KO.

Odpowiedzialności:
- utworzenie etapu grupowego,
- podział uczestników na grupy (również nierówne),
- wygenerowanie meczów round-robin w każdej grupie,
- zapis konfiguracji awansu do kolejnego etapu (KO).

Generator NIE tworzy fazy pucharowej – robi to osobny generator
na podstawie wyników fazy grupowej.
"""

from itertools import combinations
from typing import List

from tournaments.models import (
    Tournament,
    Stage,
    Group,
    Match,
    Team,
)


# ============================================================
# API PUBLICZNE
# ============================================================

def generate_group_stage(tournament: Tournament) -> Stage:
    """
    Generuje fazę grupową turnieju.

    Zakłada:
    - turniej w statusie DRAFT,
    - poprawną konfigurację w format_config,
    - zatwierdzonych uczestników.

    Wymagane w format_config:
    - groups_count: int
    - advance_per_group: int
    """
    _validate_tournament_state(tournament)

    teams = _get_active_teams(tournament)
    groups_count, advance_per_group = _get_group_config(tournament)

    stage = Stage.objects.create(
        tournament=tournament,
        stage_type=Stage.StageType.GROUP,
        order=1,
    )

    groups = _create_groups(stage, groups_count)
    _assign_teams_to_groups(teams, groups)
    _generate_group_matches(tournament, stage, groups)

    # Informacja o awansie zostaje w konfiguracji turnieju
    tournament.format_config["advance_per_group"] = advance_per_group
    tournament.save(update_fields=["format_config"])

    return stage


# ============================================================
# WALIDACJA
# ============================================================

def _validate_tournament_state(tournament: Tournament) -> None:
    if tournament.status != Tournament.Status.DRAFT:
        raise ValueError(
            "Faza grupowa może być generowana tylko dla turnieju w statusie DRAFT."
        )


def _get_active_teams(tournament: Tournament) -> List[Team]:
    teams = list(
        tournament.teams.filter(
            is_active=True,
            status=Team.Status.APPROVED,
        ).order_by("id")
    )

    if len(teams) < 4:
        raise ValueError(
            "Do wygenerowania fazy grupowej wymaganych jest co najmniej 4 uczestników."
        )

    return teams


def _get_group_config(tournament: Tournament) -> tuple[int, int]:
    config = tournament.format_config or {}

    groups_count = config.get("groups_count")
    advance_per_group = config.get("advance_per_group")

    if not isinstance(groups_count, int) or groups_count < 2:
        raise ValueError("Niepoprawna liczba grup.")

    if not isinstance(advance_per_group, int) or advance_per_group < 1:
        raise ValueError("Niepoprawna liczba awansujących z grupy.")

    return groups_count, advance_per_group


# ============================================================
# LOGIKA FAZY GRUPOWEJ
# ============================================================

def _create_groups(stage: Stage, groups_count: int) -> List[Group]:
    """
    Tworzy grupy A, B, C...
    """
    groups = []
    for i in range(groups_count):
        name = chr(ord("A") + i)
        groups.append(
            Group.objects.create(
                stage=stage,
                name=f"Grupa {name}",
            )
        )
    return groups


def _assign_teams_to_groups(
    teams: List[Team],
    groups: List[Group],
) -> None:
    """
    Przydziela zespoły do grup w sposób możliwie równomierny.

    Dopuszczalna różnica liczebności grup: max 1.
    """
    for index, team in enumerate(teams):
        group = groups[index % len(groups)]
        team.group = group  # pole logiczne, nie FK – przypisanie przez mecze
        team.save(update_fields=[])


def _generate_group_matches(
    tournament: Tournament,
    stage: Stage,
    groups: List[Group],
) -> None:
    """
    Generuje mecze round-robin w każdej grupie.
    """
    matches = []

    for group in groups:
        group_teams = Team.objects.filter(
            tournament=tournament,
            is_active=True,
            status=Team.Status.APPROVED,
        ).filter(
            # drużyny przypisane do tej grupy przez indeks
            id__in=[
                team.id for team in Team.objects.filter(
                    tournament=tournament,
                    is_active=True,
                    status=Team.Status.APPROVED,
                )
                if (team.id % len(groups)) == (ord(group.name[-1]) - ord("A"))
            ]
        )

        for home, away in combinations(group_teams, 2):
            matches.append(
                Match(
                    tournament=tournament,
                    stage=stage,
                    group=group,
                    home_team=home,
                    away_team=away,
                    status=Match.Status.SCHEDULED,
                )
            )

    Match.objects.bulk_create(matches)
