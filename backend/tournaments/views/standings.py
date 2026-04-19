
# backend/tournaments/views/standings.py
# Plik udostępnia dane klasyfikacji i drabinki dla widoku panelowego oraz publicznego w kontekście aktywnej dywizji.

from __future__ import annotations

import copy

from django.shortcuts import get_object_or_404

from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from tournaments.models import Division, Stage, Tournament
from tournaments.services.standings.compute import compute_stage_standings
from tournaments.services.standings.knockout_bracket import get_knockout_bracket
from tournaments.services.standings.types import StandingRow
from tournaments.views._helpers import public_access_or_403


def _resolve_division_from_request(request, tournament: Tournament) -> Division | None:
    raw_id = (
        request.query_params.get("division_id")
        or request.query_params.get("active_division_id")
        or request.query_params.get("division")
    )
    raw_slug = (
        request.query_params.get("division_slug")
        or request.query_params.get("active_division_slug")
    )

    divisions_qs = tournament.divisions.all().order_by("order", "id")

    if raw_id:
        try:
            division_id = int(raw_id)
        except (TypeError, ValueError):
            return None
        return divisions_qs.filter(pk=division_id).first()

    if raw_slug:
        return divisions_qs.filter(slug=str(raw_slug).strip()).first()

    return tournament.get_default_division()


def _competition_context(tournament: Tournament, division: Division | None):
    return division or tournament


def _runtime_tournament_for_division(tournament: Tournament, division: Division | None) -> Tournament:
    if division is None:
        return tournament

    runtime = copy.copy(tournament)
    runtime.competition_type = division.competition_type
    runtime.competition_model = division.competition_model
    runtime.tournament_format = division.tournament_format
    runtime.result_mode = division.result_mode
    runtime.result_config = dict(division.result_config or {})
    runtime.format_config = dict(division.format_config or {})
    return runtime


def _effective_tournament_format(
    *,
    fallback_format: str,
    has_league_stage: bool,
    has_group_stage: bool,
    has_knockout_stage: bool,
) -> str:
    if has_knockout_stage and (has_league_stage or has_group_stage):
        return Tournament.TournamentFormat.MIXED

    if has_knockout_stage:
        return Tournament.TournamentFormat.CUP

    if has_group_stage:
        return Tournament.TournamentFormat.MIXED

    if has_league_stage:
        return Tournament.TournamentFormat.LEAGUE

    return fallback_format


class TournamentStandingsView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, pk: int):
        tournament = get_object_or_404(Tournament, pk=pk)

        denied = public_access_or_403(request, tournament)
        if denied is not None:
            return denied

        division = _resolve_division_from_request(request, tournament)
        context_obj = _competition_context(tournament, division)
        runtime_tournament = _runtime_tournament_for_division(tournament, division)

        discipline = (getattr(tournament, "discipline", "") or "").lower()
        result_mode = getattr(context_obj, "result_mode", Tournament.ResultMode.SCORE)
        competition_model = getattr(context_obj, "competition_model", None)

        result_config = dict(getattr(context_obj, "result_config", None) or {})
        format_config = dict(getattr(context_obj, "format_config", None) or {})

        stages_qs = tournament.stages.all()
        if division is not None:
            stages_qs = stages_qs.filter(division=division)

        league_stage = stages_qs.filter(stage_type=Stage.StageType.LEAGUE).order_by("order", "id").first()
        group_stage = stages_qs.filter(stage_type=Stage.StageType.GROUP).order_by("order", "id").first()
        has_knockout_stage = stages_qs.filter(
            stage_type__in=(Stage.StageType.KNOCKOUT, Stage.StageType.THIRD_PLACE)
        ).exists()

        tournament_format = _effective_tournament_format(
            fallback_format=context_obj.tournament_format,
            has_league_stage=league_stage is not None,
            has_group_stage=group_stage is not None,
            has_knockout_stage=has_knockout_stage,
        )

        response_data: dict = {
            "meta": self._build_meta(
                tournament=tournament,
                division=division,
                discipline=discipline,
                result_mode=result_mode,
                competition_model=competition_model,
                tournament_format=tournament_format,
                result_config=result_config,
                format_config=format_config,
            )
        }

        if group_stage is not None:
            groups_payload = []

            for group in group_stage.groups.all().order_by("name"):
                groups_payload.append(
                    {
                        "group_id": group.id,
                        "group_name": group.name,
                        "table": self._serialize_stage_table(
                            tournament=runtime_tournament,
                            stage=group_stage,
                            group=group,
                            discipline=discipline,
                            result_mode=result_mode,
                            competition_model=competition_model,
                            result_config=result_config,
                        ),
                    }
                )

            response_data["groups"] = groups_payload

        elif league_stage is not None:
            response_data["table"] = self._serialize_stage_table(
                tournament=runtime_tournament,
                stage=league_stage,
                discipline=discipline,
                result_mode=result_mode,
                competition_model=competition_model,
                result_config=result_config,
            )

        if has_knockout_stage:
            bracket_data = get_knockout_bracket(runtime_tournament, division=division)
            if bracket_data and bracket_data.get("rounds"):
                response_data["bracket"] = bracket_data

        return Response(response_data, status=status.HTTP_200_OK)

    @classmethod
    def _build_meta(
        cls,
        *,
        tournament: Tournament,
        division: Division | None,
        discipline: str,
        result_mode: str,
        competition_model: str | None,
        tournament_format: str,
        result_config: dict,
        format_config: dict,
    ) -> dict:
        meta = {
            "division_id": division.id if division else None,
            "division_name": division.name if division else None,
            "discipline": discipline,
            "competition_type": tournament.competition_type if division is None else division.competition_type,
            "competition_model": competition_model,
            "tournament_format": tournament_format,
            "result_mode": result_mode,
            "table_schema": cls._detect_table_schema(
                discipline=discipline,
                result_mode=result_mode,
                competition_model=competition_model,
                result_config=result_config,
            ),
        }

        if discipline == Tournament.Discipline.CUSTOM:
            custom_mode = cls._detect_custom_table_mode(
                competition_model=competition_model,
                result_config=result_config,
            )
            custom_value_kind = cls._detect_custom_value_kind(
                competition_model=competition_model,
                result_config=result_config,
            )

            meta.update(
                {
                    "custom_discipline_name": tournament.custom_discipline_name,
                    "custom_mode": custom_mode,
                    "custom_value_kind": custom_value_kind,
                    "result_config": result_config,
                    "format_config": format_config,
                    "shows_points_table": custom_mode == "HEAD_TO_HEAD_POINTS",
                    "shows_result_ranking": custom_mode in (
                        "HEAD_TO_HEAD_MEASURED",
                        "MASS_START_MEASURED",
                    ),
                }
            )

        if discipline == Tournament.Discipline.TENNIS:
            meta["tennis_points_mode"] = format_config.get("tennis_points_mode") or "NONE"

        return meta

    @classmethod
    def _serialize_stage_table(
        cls,
        *,
        tournament: Tournament,
        stage,
        discipline: str,
        result_mode: str,
        competition_model: str | None,
        result_config: dict,
        group=None,
    ) -> list[dict]:
        table = compute_stage_standings(tournament, stage, group=group)
        return [
            cls._serialize_row(
                row=row,
                discipline=discipline,
                result_mode=result_mode,
                competition_model=competition_model,
                result_config=result_config,
            )
            for row in table
        ]

    @staticmethod
    def _detect_table_schema(
        *,
        discipline: str,
        result_mode: str,
        competition_model: str | None,
        result_config: dict,
    ) -> str:
        if discipline == Tournament.Discipline.TENNIS:
            return "TENNIS"

        if result_mode != Tournament.ResultMode.CUSTOM:
            return "DEFAULT"

        custom_mode = TournamentStandingsView._detect_custom_table_mode(
            competition_model=competition_model,
            result_config=result_config,
        )

        if custom_mode == "HEAD_TO_HEAD_POINTS":
            return "CUSTOM_POINTS"
        if custom_mode == "HEAD_TO_HEAD_MEASURED":
            return "CUSTOM_MEASURED_HEAD_TO_HEAD"
        if custom_mode == "MASS_START_MEASURED":
            return "CUSTOM_MEASURED_MASS_START"
        return "CUSTOM"

    @staticmethod
    def _detect_custom_table_mode(
        *,
        competition_model: str | None,
        result_config: dict,
    ) -> str:
        if competition_model == Tournament.CompetitionModel.HEAD_TO_HEAD:
            head_to_head_mode = (
                result_config.get("head_to_head_mode") or "POINTS_TABLE"
            ).upper()
            if head_to_head_mode == "MEASURED_RESULT":
                return "HEAD_TO_HEAD_MEASURED"
            return "HEAD_TO_HEAD_POINTS"

        return "MASS_START_MEASURED"

    @staticmethod
    def _detect_custom_value_kind(
        *,
        competition_model: str | None,
        result_config: dict,
    ) -> str | None:
        if competition_model == Tournament.CompetitionModel.HEAD_TO_HEAD:
            head_to_head_mode = (
                result_config.get("head_to_head_mode") or "POINTS_TABLE"
            ).upper()
            if head_to_head_mode != "MEASURED_RESULT":
                return None
            return (result_config.get("measured_value_kind") or "NUMBER").upper()

        return (result_config.get("mass_start_value_kind") or "TIME").upper()

    @staticmethod
    def _serialize_row(
        *,
        row: StandingRow,
        discipline: str,
        result_mode: str,
        competition_model: str | None,
        result_config: dict,
    ) -> dict:
        base = {
            "team_id": row.team_id,
            "team_name": row.team_name,
            "played": row.played,
            "wins": row.wins,
            "draws": row.draws,
            "losses": row.losses,
            "points": row.points,
            "goals_for": row.goals_for,
            "goals_against": row.goals_against,
            "goal_difference": row.goal_difference,
            "games_for": getattr(row, "games_for", 0),
            "games_against": getattr(row, "games_against", 0),
            "games_difference": getattr(row, "games_difference", 0),
            "rank": getattr(row, "rank", None),
        }

        if discipline == Tournament.Discipline.TENNIS:
            base.update(
                {
                    "sets_for": row.goals_for,
                    "sets_against": row.goals_against,
                    "sets_diff": row.goal_difference,
                    "games_for": getattr(row, "games_for", 0),
                    "games_against": getattr(row, "games_against", 0),
                    "games_diff": getattr(row, "games_difference", 0),
                }
            )

        if result_mode == Tournament.ResultMode.CUSTOM:
            custom_mode = TournamentStandingsView._detect_custom_table_mode(
                competition_model=competition_model,
                result_config=result_config,
            )
            custom_value_kind = TournamentStandingsView._detect_custom_value_kind(
                competition_model=competition_model,
                result_config=result_config,
            )

            base.update(
                {
                    "is_custom_result": True,
                    "custom_mode": custom_mode,
                    "custom_value_kind": custom_value_kind,
                    "custom_result_numeric": getattr(row, "custom_result_numeric", None),
                    "custom_result_time_ms": getattr(row, "custom_result_time_ms", None),
                    "custom_result_place": getattr(row, "custom_result_place", None),
                    "custom_result_display": getattr(row, "custom_result_display", None),
                }
            )

        return base
