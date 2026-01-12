from __future__ import annotations

from django.shortcuts import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from tournaments.models import Tournament, Stage
from tournaments.services.standings.compute import compute_stage_standings
from tournaments.services.standings.knockout_bracket import get_knockout_bracket
from tournaments.services.standings.types import StandingRow


class TournamentStandingsView(APIView):
    """
    GET /api/tournaments/:id/standings/

    Zwraca dane do widoku wyników w zależności od formatu:
    - LEAGUE: klucz 'table' (jedna lista)
    - MIXED:  klucz 'groups' (lista obiektów {group_id, group_name, table}) + 'bracket'
    - CUP:    klucz 'bracket'

    Dodatkowo zwraca:
    - meta.discipline
    - meta.table_schema (np. "FOOTBALL" / "TENNIS")
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, pk: int):
        tournament = get_object_or_404(Tournament, pk=pk)
        fmt = tournament.tournament_format

        discipline = (getattr(tournament, "discipline", "") or "").lower()

        response_data: dict = {
            "meta": {
                "discipline": discipline,
                "table_schema": "TENNIS" if discipline == "tennis" else "DEFAULT",
            }
        }

        # =====================================================
        # 1. FORMAT LIGA (Pojedyncza tabela)
        # =====================================================
        if fmt == Tournament.TournamentFormat.LEAGUE:
            stage = tournament.stages.filter(stage_type=Stage.StageType.LEAGUE).first()
            if stage:
                table = compute_stage_standings(tournament, stage)
                response_data["table"] = [self._serialize_row(r, discipline) for r in table]

        # =====================================================
        # 2. FORMAT MIXED (Grupy - wiele tabel)
        # =====================================================
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
                            "table": [self._serialize_row(r, discipline) for r in table],
                        }
                    )

                response_data["groups"] = groups_payload

        # =====================================================
        # 3. FORMAT PUCHAROWY ORAZ MIXED (Drabinka)
        # =====================================================
        if fmt in (Tournament.TournamentFormat.CUP, Tournament.TournamentFormat.MIXED):
            bracket_data = get_knockout_bracket(tournament)
            if bracket_data and bracket_data.get("rounds"):
                response_data["bracket"] = bracket_data

        return Response(response_data)

    @staticmethod
    def _serialize_row(row: StandingRow, discipline: str) -> dict:
        """
        Serializacja tabeli:

        DEFAULT:
          - kompatybilna z piłkarską tabelą (goals_for/goals_against itd.)

        TENIS:
          - zwraca tenisowe pola: sets_for/sets_against, games_for/games_against
          - zachowuje też legacy goals_* jako aliasy (nie musisz, ale pomaga w migracji frontu)
        """
        base = {
            "team_id": row.team_id,
            "team_name": row.team_name,
            "played": row.played,
            "wins": row.wins,
            "draws": row.draws,
            "losses": row.losses,
            "points": row.points,
        }

        # Legacy / default (piłka/ręczna/kosz) – zostawiamy jako wspólne API
        base.update(
            {
                "goals_for": row.goals_for,
                "goals_against": row.goals_against,
                "goal_difference": row.goal_difference,
            }
        )

        # Jeśli masz w StandingRow pola games_* (u Ciebie są), to dokładamy je zawsze (są przydatne też poza tenisem)
        base.update(
            {
                "games_for": getattr(row, "games_for", 0),
                "games_against": getattr(row, "games_against", 0),
                "games_difference": getattr(row, "games_difference", 0),
            }
        )

        # TENIS: docelowe nazwy kolumn (bliższe realnym tabelom)
        if discipline == "tennis":
            base.update(
                {
                    # sety
                    "sets_for": row.goals_for,
                    "sets_against": row.goals_against,
                    "sets_diff": row.goal_difference,
                    # gemy
                    "games_for": getattr(row, "games_for", 0),
                    "games_against": getattr(row, "games_against", 0),
                    "games_diff": getattr(row, "games_difference", 0),
                }
            )

        return base
