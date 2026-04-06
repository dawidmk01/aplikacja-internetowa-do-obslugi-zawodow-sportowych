# backend/tournaments/services/advance_from_groups.py
# Plik udostępnia use-case awansu z fazy grupowej do fazy pucharowej w formacie MIXED dla aktywnej dywizji.

from __future__ import annotations

import copy

from django.db import transaction

from tournaments.models import Division, Match, Stage, Team, Tournament
from tournaments.services.generators.knockout import generate_knockout_stage
from tournaments.services.standings.compute import compute_stage_standings


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

    # Kopia runtime przenosi konfigurację dywizji do serwisów oczekujących obiektu Tournament.
    runtime = copy.copy(tournament)
    runtime.competition_type = division.competition_type
    runtime.competition_model = division.competition_model
    runtime.tournament_format = division.tournament_format
    runtime.format_config = dict(division.format_config or {})
    runtime.result_mode = division.result_mode
    runtime.result_config = dict(division.result_config or {})
    return runtime


@transaction.atomic
def advance_from_groups_to_knockout(
    tournament: Tournament,
    division: Division | None = None,
) -> Stage:
    division = _resolve_division(tournament, division)
    runtime_tournament = _build_runtime_tournament(tournament, division)

    _ensure_mixed_format(runtime_tournament)
    _ensure_status_allows_generation(runtime_tournament, division)

    group_stage = _get_group_stage(tournament, division)
    _ensure_all_group_matches_finished(group_stage)
    _ensure_no_existing_knockout(tournament, division)

    advance_per_group = _get_advance_config(runtime_tournament)

    groups = group_stage.groups.all().order_by("id")

    advancing_ids: list[int] = []
    for group in groups:
        standings = compute_stage_standings(
            tournament=runtime_tournament,
            stage=group_stage,
            group=group,
        )
        if len(standings) < advance_per_group:
            raise ValueError(f"Grupa {group.name} ma za mało uczestników do awansu.")
        advancing_ids.extend([row.team_id for row in standings[:advance_per_group]])

    if not advancing_ids:
        raise ValueError("Nie udało się wyznaczyć zespołów awansujących z grup.")

    teams_qs = Team.objects.filter(tournament=tournament, id__in=advancing_ids)
    if division is not None:
        teams_qs = teams_qs.filter(division=division)

    teams_map = teams_qs.in_bulk()
    missing = [team_id for team_id in advancing_ids if team_id not in teams_map]
    if missing:
        raise ValueError(f"Nie znaleziono drużyn o ID: {missing}")

    advancing_teams: list[Team] = [teams_map[team_id] for team_id in advancing_ids]

    if division is not None:
        cfg = dict(division.format_config or {})
        cfg["knockout_teams"] = len({team.id for team in advancing_teams})
        cfg["knockout_seed_ids"] = [team.id for team in advancing_teams]
        division.format_config = cfg
        division.save(update_fields=["format_config"])
    else:
        cfg = dict(tournament.format_config or {})
        cfg["knockout_teams"] = len({team.id for team in advancing_teams})
        cfg["knockout_seed_ids"] = [team.id for team in advancing_teams]
        tournament.format_config = cfg
        tournament.save(update_fields=["format_config"])

    return generate_knockout_stage(tournament, division=division, teams=advancing_teams)


def advance_from_groups(
    tournament: Tournament,
    division: Division | None = None,
) -> Stage:
    return advance_from_groups_to_knockout(tournament, division=division)


def _ensure_mixed_format(tournament: Tournament) -> None:
    if tournament.tournament_format != Tournament.TournamentFormat.MIXED:
        raise ValueError("Awans z grup do KO jest dostępny tylko dla formatu MIXED.")


def _ensure_status_allows_generation(
    tournament: Tournament,
    division: Division | None,
) -> None:
    status_value = division.status if division is not None else tournament.status
    allowed = {
        Tournament.Status.DRAFT,
        Tournament.Status.CONFIGURED,
        Tournament.Status.RUNNING,
    }
    if status_value not in allowed:
        raise ValueError(
            "Faza pucharowa może być generowana tylko dla dywizji w statusie DRAFT/CONFIGURED/RUNNING."
        )


def _get_group_stage(
    tournament: Tournament,
    division: Division | None,
) -> Stage:
    stage_qs = tournament.stages.filter(stage_type=Stage.StageType.GROUP)
    if division is not None:
        stage_qs = stage_qs.filter(division=division)

    stage = stage_qs.order_by("order").first()
    if not stage:
        raise ValueError("Dywizja nie posiada fazy grupowej.")
    return stage


def _ensure_all_group_matches_finished(group_stage: Stage) -> None:
    if Match.objects.filter(stage=group_stage).exclude(status=Match.Status.FINISHED).exists():
        raise ValueError("Nie wszystkie mecze fazy grupowej są zakończone (FINISHED).")


def _ensure_no_existing_knockout(
    tournament: Tournament,
    division: Division | None,
) -> None:
    stages_qs = tournament.stages.filter(stage_type=Stage.StageType.KNOCKOUT)
    if division is not None:
        stages_qs = stages_qs.filter(division=division)

    if stages_qs.exists():
        raise ValueError("Faza pucharowa została już wygenerowana dla tej dywizji.")


def _get_advance_config(tournament: Tournament) -> int:
    cfg = tournament.format_config or {}
    raw = cfg.get("advance_from_group")

    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise ValueError("Niepoprawna konfiguracja awansu z grup (advance_from_group).")

    if value < 1:
        raise ValueError("Niepoprawna konfiguracja awansu z grup (advance_from_group).")

    return value
