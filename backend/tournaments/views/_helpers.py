# backend/tournaments/views/_helpers.py
# Plik udostępnia wspólne helpery widoków turniejowych z obsługą aktywnej dywizji.

from __future__ import annotations

from typing import Optional, Tuple

from django.db.models import Q
from rest_framework import status
from rest_framework.response import Response

from tournaments.services.generators.knockout import generate_next_knockout_stage
from tournaments.services.match_outcome import penalty_winner_id, team_goals_in_match

from ..access import participant_can_view_public_preview, user_is_assistant, user_is_registered_participant
from ..models import Division, Match, Stage, Team, Tournament


def resolve_request_division(request, tournament: Tournament, *, required: bool = False) -> Optional[Division]:
    raw_id = request.query_params.get("division_id") or request.query_params.get("active_division_id")
    raw_slug = request.query_params.get("division_slug") or request.query_params.get("active_division_slug")

    qs = tournament.divisions.all().order_by("order", "id")

    if raw_id not in (None, ""):
        try:
            division_id = int(raw_id)
        except (TypeError, ValueError):
            return None
        return qs.filter(pk=division_id).first()

    if raw_slug not in (None, ""):
        return qs.filter(slug=str(raw_slug).strip()).first()

    division = tournament.get_default_division()
    if required and division is None:
        return None
    return division


def get_runtime_context(tournament: Tournament, division: Optional[Division] = None):
    if division is not None:
        return division
    return tournament.get_default_division() or tournament


def get_runtime_format_config(tournament: Tournament, division: Optional[Division] = None) -> dict:
    context = get_runtime_context(tournament, division)
    return dict(getattr(context, "format_config", None) or {})


def get_runtime_result_config(tournament: Tournament, division: Optional[Division] = None) -> dict:
    context = get_runtime_context(tournament, division)
    if hasattr(context, "get_result_config"):
        return dict(context.get_result_config() or {})
    return dict(getattr(context, "result_config", None) or {})


def get_runtime_result_mode(tournament: Tournament, division: Optional[Division] = None) -> str:
    context = get_runtime_context(tournament, division)
    return str(getattr(context, "result_mode", Tournament.ResultMode.SCORE) or Tournament.ResultMode.SCORE)


def get_runtime_competition_model(tournament: Tournament, division: Optional[Division] = None) -> str:
    context = get_runtime_context(tournament, division)
    return str(getattr(context, "competition_model", tournament.competition_model) or tournament.competition_model)


def get_runtime_tournament_format(tournament: Tournament, division: Optional[Division] = None) -> str:
    context = get_runtime_context(tournament, division)
    return str(getattr(context, "tournament_format", tournament.tournament_format) or tournament.tournament_format)


def public_access_or_403(request, tournament: Tournament) -> Optional[Response]:
    user = getattr(request, "user", None)

    if user and getattr(user, "is_authenticated", False):
        if tournament.organizer_id == user.id:
            return None

        if user_is_assistant(user, tournament):
            return None

        if user_is_registered_participant(user, tournament):
            if participant_can_view_public_preview(tournament):
                return None

            return Response(
                {"detail": "Podgląd dla uczestników jest wyłączony. Poczekaj na publikację turnieju."},
                status=status.HTTP_403_FORBIDDEN,
            )

    if not getattr(tournament, "is_published", False):
        return Response(
            {"detail": "Turniej nie jest dostępny."},
            status=status.HTTP_403_FORBIDDEN,
        )

    access_code = getattr(tournament, "access_code", None)
    if access_code and request.query_params.get("code") != access_code:
        return Response(
            {"detail": "Wymagany poprawny kod dostępu."},
            status=status.HTTP_403_FORBIDDEN,
        )

    return None


def _get_cup_matches(tournament: Tournament, division: Optional[Division] = None) -> int:
    cfg = get_runtime_format_config(tournament, division)
    raw = cfg.get("cup_matches", 1)

    try:
        value = int(raw)
    except (TypeError, ValueError):
        value = 1

    return value if value in (1, 2) else 1


def _pair_key_ids(home_id: int, away_id: int) -> Tuple[int, int]:
    return (home_id, away_id) if home_id < away_id else (away_id, home_id)


def _sync_two_leg_pair_winner_if_possible(stage: Stage, tournament: Tournament, match: Match) -> None:
    division = getattr(stage, "division", None)
    if _get_cup_matches(tournament, division) != 2:
        return

    key = _pair_key_ids(match.home_team_id, match.away_team_id)

    group = list(
        Match.objects.filter(stage=stage).only(
            "id",
            "status",
            "winner_id",
            "home_team_id",
            "away_team_id",
            "home_score",
            "away_score",
            "went_to_extra_time",
            "home_extra_time_score",
            "away_extra_time_score",
            "decided_by_penalties",
            "home_penalty_score",
            "away_penalty_score",
        )
    )
    group = [item for item in group if _pair_key_ids(item.home_team_id, item.away_team_id) == key]

    if len(group) != 2 or any(item.status != Match.Status.FINISHED for item in group):
        return

    team_ids = list({group[0].home_team_id, group[0].away_team_id})
    if len(team_ids) != 2:
        return

    team_a, team_b = team_ids[0], team_ids[1]
    goals_a = sum(team_goals_in_match(item, team_a) for item in group)
    goals_b = sum(team_goals_in_match(item, team_b) for item in group)
    ids = [group[0].id, group[1].id]

    if goals_a != goals_b:
        winner_id = team_a if goals_a > goals_b else team_b
        Match.objects.filter(id__in=ids).update(winner_id=winner_id)
        return

    second_leg = max(group, key=lambda item: item.id)
    penalty_winner = penalty_winner_id(second_leg)
    if penalty_winner is not None:
        Match.objects.filter(id__in=ids).update(winner_id=penalty_winner)
        return

    Match.objects.filter(id__in=ids).update(winner=None)


def _knockout_downstream_stages(tournament: Tournament, after_order: int, division: Optional[Division] = None):
    qs = Stage.objects.filter(
        tournament=tournament,
        stage_type=Stage.StageType.KNOCKOUT,
        order__gt=after_order,
    )
    if division is not None:
        qs = qs.filter(division=division)
    return qs.order_by("order")


def _knockout_downstream_has_results(tournament: Tournament, after_order: int, division: Optional[Division] = None) -> bool:
    queryset = Match.objects.filter(
        tournament=tournament,
        stage__stage_type=Stage.StageType.KNOCKOUT,
        stage__order__gt=after_order,
    )
    if division is not None:
        queryset = queryset.filter(stage__division=division)

    return queryset.filter(
        Q(status=Match.Status.FINISHED) | Q(result_entered=True) | Q(winner__isnull=False)
    ).exists()


def _soft_reset_downstream_for_team_change(
    *,
    tournament: Tournament,
    after_order: int,
    old_team_id: int,
    new_team: Team,
    division: Optional[Division] = None,
) -> None:
    downstream_matches = (
        Match.objects.filter(
            tournament=tournament,
            stage__order__gt=after_order,
            stage__stage_type__in=[Stage.StageType.KNOCKOUT, Stage.StageType.THIRD_PLACE],
        )
        .select_related("stage")
    )

    if division is not None:
        downstream_matches = downstream_matches.filter(stage__division=division)

    to_update = []
    for match in downstream_matches:
        changed = False

        if match.home_team_id == old_team_id:
            match.home_team = new_team
            changed = True

        if match.away_team_id == old_team_id:
            match.away_team = new_team
            changed = True

        if not changed:
            continue

        if match.home_team_id == match.away_team_id:
            raise ValueError("Kolizja w KO: po podmianie drużyn mecz stał się home==away.")

        match.home_score = 0
        match.away_score = 0
        match.winner = None
        match.status = Match.Status.SCHEDULED
        match.result_entered = False
        match.tennis_sets = None
        match.went_to_extra_time = False
        match.home_extra_time_score = None
        match.away_extra_time_score = None
        match.decided_by_penalties = False
        match.home_penalty_score = None
        match.away_penalty_score = None
        to_update.append(match)

    if to_update:
        Match.objects.bulk_update(
            to_update,
            [
                "home_team",
                "away_team",
                "home_score",
                "away_score",
                "winner",
                "status",
                "result_entered",
                "tennis_sets",
                "went_to_extra_time",
                "home_extra_time_score",
                "away_extra_time_score",
                "decided_by_penalties",
                "home_penalty_score",
                "away_penalty_score",
            ],
        )

    stage_qs = Stage.objects.filter(
        tournament=tournament,
        order__gt=after_order,
        stage_type__in=[Stage.StageType.KNOCKOUT, Stage.StageType.THIRD_PLACE],
    )
    if division is not None:
        stage_qs = stage_qs.filter(division=division)

    stage_qs.exclude(status=Stage.Status.OPEN).update(status=Stage.Status.OPEN)

    if tournament.status == Tournament.Status.FINISHED:
        tournament.status = Tournament.Status.CONFIGURED
        tournament.save(update_fields=["status"])


def rollback_knockout_after_stage(stage: Stage) -> int:
    tournament = stage.tournament
    division = getattr(stage, "division", None)
    downstream_stages = _knockout_downstream_stages(tournament, stage.order, division=division)

    if not downstream_stages.exists():
        return 0

    Match.objects.filter(stage__in=downstream_stages).delete()
    deleted_count = downstream_stages.count()
    downstream_stages.delete()

    if tournament.status == Tournament.Status.FINISHED:
        tournament.status = Tournament.Status.CONFIGURED
        tournament.save(update_fields=["status"])

    return deleted_count


def handle_knockout_winner_change(
    *,
    tournament: Tournament,
    stage: Stage,
    old_winner_id: Optional[int],
    new_winner_id: Optional[int],
) -> None:
    if stage.stage_type != Stage.StageType.KNOCKOUT or old_winner_id == new_winner_id:
        return

    division = getattr(stage, "division", None)

    if not _knockout_downstream_stages(tournament, stage.order, division=division).exists():
        return

    if new_winner_id is None:
        rollback_knockout_after_stage(stage)
        return

    if _knockout_downstream_has_results(tournament, stage.order, division=division):
        rollback_knockout_after_stage(stage)
        return

    new_team = Team.objects.filter(pk=new_winner_id).first()
    if not new_team:
        rollback_knockout_after_stage(stage)
        return

    try:
        _soft_reset_downstream_for_team_change(
            tournament=tournament,
            after_order=stage.order,
            old_team_id=old_winner_id or 0,
            new_team=new_team,
            division=division,
        )
    except ValueError:
        rollback_knockout_after_stage(stage)


def _try_auto_advance_knockout(stage: Stage) -> None:
    tournament = stage.tournament
    division = getattr(stage, "division", None)

    if _knockout_downstream_stages(tournament, stage.order, division=division).exists():
        return

    matches = list(stage.matches.all())
    if not matches or any(match.status != Match.Status.FINISHED or not match.winner_id for match in matches):
        return

    if stage.status != Stage.Status.OPEN:
        stage.status = Stage.Status.OPEN
        stage.save(update_fields=["status"])

    try:
        generate_next_knockout_stage(stage)
    except ValueError:
        return
