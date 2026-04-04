# backend/tournaments/views/standings.py
# Plik udostępnia dane klasyfikacji i drabinki dla widoku panelowego oraz publicznego.

from __future__ import annotations

from django.shortcuts import get_object_or_404

from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from tournaments.models import Stage, Tournament
from tournaments.services.standings.compute import compute_stage_standings
from tournaments.services.standings.knockout_bracket import get_knockout_bracket
from tournaments.services.standings.types import StandingRow
from tournaments.views._helpers import public_access_or_403


class TournamentStandingsView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, pk: int):
        tournament = get_object_or_404(Tournament, pk=pk)

        denied = public_access_or_403(request, tournament)
        if denied is not None:
            return denied

        discipline = (getattr(tournament, "discipline", "") or "").lower()
        result_mode = getattr(tournament, "result_mode", Tournament.ResultMode.SCORE)
        competition_model = getattr(tournament, "competition_model", None)
        tournament_format = tournament.tournament_format

        result_config = dict(getattr(tournament, "result_config", None) or {})
        format_config = dict(getattr(tournament, "format_config", None) or {})

        response_data: dict = {
            "meta": self._build_meta(
                tournament=tournament,
                discipline=discipline,
                result_mode=result_mode,
                competition_model=competition_model,
                tournament_format=tournament_format,
                result_config=result_config,
                format_config=format_config,
            )
        }

        if tournament_format == Tournament.TournamentFormat.LEAGUE:
            stage = tournament.stages.filter(stage_type=Stage.StageType.LEAGUE).first()
            if stage:
                response_data["table"] = self._serialize_stage_table(
                    tournament=tournament,
                    stage=stage,
                    discipline=discipline,
                    result_mode=result_mode,
                    competition_model=competition_model,
                    result_config=result_config,
                )

        elif tournament_format == Tournament.TournamentFormat.MIXED:
            stage = tournament.stages.filter(stage_type=Stage.StageType.GROUP).first()
            if stage:
                groups_payload = []

                for group in stage.groups.all().order_by("name"):
                    groups_payload.append(
                        {
                            "group_id": group.id,
                            "group_name": group.name,
                            "table": self._serialize_stage_table(
                                tournament=tournament,
                                stage=stage,
                                group=group,
                                discipline=discipline,
                                result_mode=result_mode,
                                competition_model=competition_model,
                                result_config=result_config,
                            ),
                        }
                    )

                response_data["groups"] = groups_payload

        if tournament_format in (
            Tournament.TournamentFormat.CUP,
            Tournament.TournamentFormat.MIXED,
        ):
            bracket_data = get_knockout_bracket(tournament)
            if bracket_data and bracket_data.get("rounds"):
                response_data["bracket"] = bracket_data

        return Response(response_data, status=status.HTTP_200_OK)

    @classmethod
    def _build_meta(
        cls,
        *,
        tournament: Tournament,
        discipline: str,
        result_mode: str,
        competition_model: str | None,
        tournament_format: str,
        result_config: dict,
        format_config: dict,
    ) -> dict:
        meta = {
            "discipline": discipline,
            "competition_type": tournament.competition_type,
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