# backend/tournaments/views/standings.py
# Plik udostępnia dane tabeli i drabinki dla widoku klasyfikacji turnieju.

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

        fmt = tournament.tournament_format
        discipline = (getattr(tournament, "discipline", "") or "").lower()

        response_data: dict = {
            "meta": {
                "discipline": discipline,
                "table_schema": "TENNIS" if discipline == "tennis" else "DEFAULT",
            }
        }

        # Frontend używa trybu punktacji tenisa do wyboru kolumn i opisów.
        if discipline == "tennis":
            cfg = tournament.format_config or {}
            response_data["meta"]["tennis_points_mode"] = cfg.get("tennis_points_mode") or "NONE"

        if fmt == Tournament.TournamentFormat.LEAGUE:
            stage = tournament.stages.filter(stage_type=Stage.StageType.LEAGUE).first()
            if stage:
                table = compute_stage_standings(tournament, stage)
                response_data["table"] = [self._serialize_row(row, discipline) for row in table]

        elif fmt == Tournament.TournamentFormat.MIXED:
            stage = tournament.stages.filter(stage_type=Stage.StageType.GROUP).first()
            if stage:
                groups_payload = []
                groups = stage.groups.all().order_by("name")

                for group in groups:
                    table = compute_stage_standings(tournament, stage, group=group)
                    groups_payload.append(
                        {
                            "group_id": group.id,
                            "group_name": group.name,
                            "table": [self._serialize_row(row, discipline) for row in table],
                        }
                    )

                response_data["groups"] = groups_payload

        # Drabinka jest zwracana dla CUP oraz części pucharowej MIXED.
        if fmt in (Tournament.TournamentFormat.CUP, Tournament.TournamentFormat.MIXED):
            bracket_data = get_knockout_bracket(tournament)
            if bracket_data and bracket_data.get("rounds"):
                response_data["bracket"] = bracket_data

        return Response(response_data, status=status.HTTP_200_OK)

    @staticmethod
    def _serialize_row(row: StandingRow, discipline: str) -> dict:
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
        }

        # Tenis dostaje docelowe aliasy sets_* przy zachowaniu kompatybilności legacy.
        if discipline == "tennis":
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

        return base