"""
Moduł odpowiedzialny za awans uczestników z fazy grupowej
do fazy pucharowej (KO).

Awans wyznaczany jest na podstawie tabel grupowych,
zgodnie z konfiguracją turnieju.
"""

from __future__ import annotations

from django.db import transaction
from django.db.models import Q

from tournaments.models import Tournament, Stage, Team, Match
from tournaments.services.standings.compute import compute_stage_standings
from tournaments.services.generators.knockout import generate_knockout_stage


# ============================================================
# API PUBLICZNE
# ============================================================

@transaction.atomic
def advance_from_groups_to_knockout(tournament: Tournament) -> Stage:
    """
    Wyznacza zespoły awansujące z fazy grupowej
    i generuje fazę pucharową (KO).

    Zakłada:
    - turniej w formacie MIXED,
    - istniejącą fazę GROUP,
    - zakończone mecze grupowe,
    - poprawną konfigurację awansu,
    - brak istniejącej fazy KO.
    """
    _ensure_mixed_format(tournament)
    _ensure_status_allows_generation(tournament)

    group_stage = _get_group_stage(tournament)
    _ensure_all_group_matches_finished(group_stage)
    _ensure_no_existing_knockout(tournament)

    advance_per_group = _get_advance_config(tournament)

    # Deterministyczna kolejność grup
    groups = group_stage.groups.all().order_by("name", "id")

    advancing_ids: list[int] = []

    for group in groups:
        standings = compute_stage_standings(
            tournament=tournament,
            stage=group_stage,
            group=group,
        )

        if len(standings) < advance_per_group:
            raise ValueError(f"Grupa {group.name} ma za mało uczestników do awansu.")

        advancing_ids.extend([row.team_id for row in standings[:advance_per_group]])

    if not advancing_ids:
        raise ValueError("Nie udało się wyznaczyć zespołów awansujących z grup.")

    # Pobieramy Team-y jednym strzałem (bez N zapytań)
    teams_map = Team.objects.in_bulk(advancing_ids)
    advancing_teams: list[Team] = []
    missing: list[int] = []

    for tid in advancing_ids:
        t = teams_map.get(tid)
        if not t:
            missing.append(tid)
        else:
            advancing_teams.append(t)

    if missing:
        raise ValueError(f"Nie znaleziono drużyn o ID: {missing}")

    # Aktywne pozostają tylko awansujące
    _set_active_teams(tournament, set(advancing_ids))

    # Opcjonalnie: zapisz informację ile zespołów weszło do KO (przydatne w UI/debugu)
    cfg = tournament.format_config or {}
    cfg["knockout_teams"] = len(set(advancing_ids))
    tournament.format_config = cfg
    tournament.save(update_fields=["format_config"])

    # UWAGA: to wywołanie poleci dalej do generatora KO – tam masz obecnie blokadę na DRAFT.
    # Generator powinien bazować na aktywnych zespołach, a nie na participants_count.
    return generate_knockout_stage(tournament)


# ============================================================
# WALIDACJE
# ============================================================

def _ensure_mixed_format(tournament: Tournament) -> None:
    if tournament.tournament_format != Tournament.TournamentFormat.MIXED:
        raise ValueError("Awans z grup do KO jest dostępny tylko dla formatu MIXED.")


def _ensure_status_allows_generation(tournament: Tournament) -> None:
    # Dla MIXED to jest normalne, że po setupie jesteś w CONFIGURED,
    # a po rozpoczęciu rozgrywek nawet w RUNNING.
    allowed = {
        Tournament.Status.DRAFT,       # zostawiamy jako dopuszczalne (testy)
        Tournament.Status.CONFIGURED,  # docelowo najczęściej
        Tournament.Status.RUNNING,     # gdy mecze już trwają
    }
    if tournament.status not in allowed:
        raise ValueError("Faza pucharowa może być generowana tylko dla turnieju w statusie CONFIGURED/RUNNING.")


def _get_group_stage(tournament: Tournament) -> Stage:
    stage = (
        tournament.stages
        .filter(stage_type=Stage.StageType.GROUP)
        .order_by("order")
        .first()
    )
    if not stage:
        raise ValueError("Turniej nie posiada fazy grupowej.")
    return stage


def _ensure_all_group_matches_finished(group_stage: Stage) -> None:
    unfinished = (
        Match.objects
        .filter(stage=group_stage)
        .exclude(status=Match.Status.FINISHED)
        .exists()
    )
    if unfinished:
        raise ValueError("Nie wszystkie mecze fazy grupowej są zakończone (FINISHED).")


def _ensure_no_existing_knockout(tournament: Tournament) -> None:
    if tournament.stages.filter(stage_type=Stage.StageType.KNOCKOUT).exists():
        raise ValueError("Faza pucharowa została już wygenerowana.")


def _get_advance_config(tournament: Tournament) -> int:
    """
    Odczyt konfiguracji awansu z grup.
    """
    cfg = tournament.format_config or {}
    advance_per_group = cfg.get("advance_from_group")

    if not isinstance(advance_per_group, int) or advance_per_group < 1:
        raise ValueError("Niepoprawna konfiguracja awansu z grup.")

    return advance_per_group


# ============================================================
# POMOCNICZE
# ============================================================

def _set_active_teams(tournament: Tournament, advancing_ids: set[int]) -> None:
    """
    Ustawia is_active=True tylko dla awansujących, resztę dezaktywuje.
    Wydajnie (bulk update).
    """
    tournament.teams.filter(is_active=True).exclude(id__in=advancing_ids).update(is_active=False)
    tournament.teams.filter(id__in=advancing_ids).update(is_active=True)
