from __future__ import annotations

from typing import Iterable, Set

from tournaments.models import Group, Match, Stage, Team, Tournament


def is_bye_team_name(name: str | None) -> bool:
    if not name:
        return False
    n = name.strip().upper()
    return (
        n == "BYE"
        or "SYSTEM_BYE" in n
        or n == "__SYSTEM_BYE__"
        or "__SYSTEM_BYE__" in n
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
    """
    Kluczowe: NIE filtrujemy po is_active w tabelach ligowych/grupowych,
    bo po awansie z grup drużyny mogą być dezaktywowane, a tabela ma nadal
    pokazywać pełny skład grupy/ligi.

    Źródło prawdy: mecze danego etapu (i grupy).
    Fallback (gdy meczów jeszcze nie ma): aktywne drużyny turnieju.
    """
    qs = Match.objects.filter(stage=stage)
    if group:
        qs = qs.filter(group=group)

    if qs.exists():
        team_ids = _collect_team_ids_from_matches(qs)
        teams_qs = Team.objects.filter(id__in=team_ids).exclude(name__iexact="BYE")
        # dodatkowa ochrona, jeśli BYE nie jest dokładnie "BYE"
        teams = [t for t in teams_qs if not is_bye_team_name(t.name)]
        return teams

    # fallback: przed wygenerowaniem meczów
    teams_qs = tournament.teams.filter(is_active=True).exclude(name__iexact="BYE")
    teams = [t for t in teams_qs if not is_bye_team_name(t.name)]
    return teams
