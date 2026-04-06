# backend/tournaments/services/standings/context.py
# Plik udostępnia helpery budujące kontekst danych wejściowych dla obliczeń tabel.

from __future__ import annotations

from typing import Set

from tournaments.models import Group, Match, Stage, Team, Tournament


def is_bye_team_name(name: str | None) -> bool:
    if not name:
        return False

    normalized = name.strip().upper()
    return (
        normalized == "BYE"
        or "SYSTEM_BYE" in normalized
        or normalized == "__SYSTEM_BYE__"
        or "__SYSTEM_BYE__" in normalized
    )


def get_finished_matches(stage: Stage, group: Group | None):
    qs = Match.objects.filter(stage=stage, status=Match.Status.FINISHED)
    if group:
        qs = qs.filter(group=group)
    return qs


def get_all_matches(stage: Stage, group: Group | None):
    qs = Match.objects.filter(stage=stage)
    if group:
        qs = qs.filter(group=group)
    return qs


def _collect_team_ids_from_matches(qs) -> Set[int]:
    # Zbieranie drużyn z meczów odcina tabelę od bieżącego stanu is_active.
    home_ids = set(qs.values_list("home_team_id", flat=True))
    away_ids = set(qs.values_list("away_team_id", flat=True))
    ids = home_ids | away_ids
    ids.discard(None)
    return ids


def get_teams_for_context(
    tournament: Tournament,
    stage: Stage,
    group: Group | None,
) -> list[Team]:
    qs = Match.objects.filter(stage=stage)
    if group:
        qs = qs.filter(group=group)

    if qs.exists():
        team_ids = _collect_team_ids_from_matches(qs)
        teams_qs = Team.objects.filter(id__in=team_ids).exclude(name__iexact="BYE")

        # Dodatkowa filtracja usuwa wszystkie techniczne warianty BYE.
        teams = [team for team in teams_qs if not is_bye_team_name(team.name)]
        return teams

    # Fallback przed wygenerowaniem meczów bierze aktywne drużyny turnieju.
    teams_qs = tournament.teams.filter(is_active=True).exclude(name__iexact="BYE")
    teams = [team for team in teams_qs if not is_bye_team_name(team.name)]
    return teams
