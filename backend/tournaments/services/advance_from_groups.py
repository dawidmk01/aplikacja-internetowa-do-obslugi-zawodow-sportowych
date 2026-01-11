"""
Awans z grup do KO (MIXED).

Wariant docelowy:
- NIE zmieniamy Team.is_active.
- Generujemy KO na podstawie listy advancing_teams (seeding = kolejność listy).
"""

from __future__ import annotations

from django.db import transaction

from tournaments.models import Tournament, Stage, Team, Match
from tournaments.services.standings.compute import compute_stage_standings
from tournaments.services.generators.knockout import generate_knockout_stage


@transaction.atomic
def advance_from_groups_to_knockout(tournament: Tournament) -> Stage:
    _ensure_mixed_format(tournament)
    _ensure_status_allows_generation(tournament)

    group_stage = _get_group_stage(tournament)
    _ensure_all_group_matches_finished(group_stage)
    _ensure_no_existing_knockout(tournament)

    advance_per_group = _get_advance_config(tournament)

    groups = group_stage.groups.all().order_by("id")

    advancing_ids: list[int] = []
    for group in groups:
        standings = compute_stage_standings(tournament=tournament, stage=group_stage, group=group)
        if len(standings) < advance_per_group:
            raise ValueError(f"Grupa {group.name} ma za mało uczestników do awansu.")
        advancing_ids.extend([row.team_id for row in standings[:advance_per_group]])

    if not advancing_ids:
        raise ValueError("Nie udało się wyznaczyć zespołów awansujących z grup.")


    teams_map = Team.objects.filter(tournament=tournament, id__in=advancing_ids).in_bulk()
    missing = [tid for tid in advancing_ids if tid not in teams_map]
    if missing:
        raise ValueError(f"Nie znaleziono drużyn o ID: {missing}")

    advancing_teams: list[Team] = [teams_map[tid] for tid in advancing_ids]

    # Informacyjnie do UI/debug
    cfg = tournament.format_config or {}
    cfg["knockout_teams"] = len({t.id for t in advancing_teams})
    cfg["knockout_seed_ids"] = [t.id for t in advancing_teams]
    tournament.format_config = cfg
    tournament.save(update_fields=["format_config"])

    return generate_knockout_stage(tournament, teams=advancing_teams)


def advance_from_groups(tournament: Tournament) -> Stage:
    return advance_from_groups_to_knockout(tournament)


def _ensure_mixed_format(tournament: Tournament) -> None:
    if tournament.tournament_format != Tournament.TournamentFormat.MIXED:
        raise ValueError("Awans z grup do KO jest dostępny tylko dla formatu MIXED.")


def _ensure_status_allows_generation(tournament: Tournament) -> None:
    allowed = {Tournament.Status.DRAFT, Tournament.Status.CONFIGURED, Tournament.Status.RUNNING}
    if tournament.status not in allowed:
        raise ValueError("Faza pucharowa może być generowana tylko dla turnieju w statusie DRAFT/CONFIGURED/RUNNING.")


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
    if Match.objects.filter(stage=group_stage).exclude(status=Match.Status.FINISHED).exists():
        raise ValueError("Nie wszystkie mecze fazy grupowej są zakończone (FINISHED).")


def _ensure_no_existing_knockout(tournament: Tournament) -> None:
    if tournament.stages.filter(stage_type=Stage.StageType.KNOCKOUT).exists():
        raise ValueError("Faza pucharowa została już wygenerowana.")


def _get_advance_config(tournament: Tournament) -> int:
    cfg = tournament.format_config or {}
    raw = cfg.get("advance_from_group", None)

    try:
        v = int(raw)
    except (TypeError, ValueError):
        raise ValueError("Niepoprawna konfiguracja awansu z grup (advance_from_group).")

    if v < 1:
        raise ValueError("Niepoprawna konfiguracja awansu z grup (advance_from_group).")

    return v
