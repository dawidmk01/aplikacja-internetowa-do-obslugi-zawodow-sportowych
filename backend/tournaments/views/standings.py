from __future__ import annotations

from django.shortcuts import get_object_or_404

from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from tournaments.models import Tournament, Stage, TournamentRegistration
from tournaments.services.standings.compute import compute_stage_standings
from tournaments.services.standings.knockout_bracket import get_knockout_bracket
from tournaments.services.standings.types import StandingRow

from tournaments.views._helpers import (
    user_is_assistant,
)


class TournamentStandingsView(APIView):
    """
    GET /api/tournaments/:id/standings/

    Zwraca dane do widoku wyników w zależności od formatu:
    - LEAGUE: klucz 'table' (jedna lista)
    - MIXED:  klucz 'groups' (lista obiektów {group_id, group_name, table}) + 'bracket'
    - CUP:    klucz 'bracket'

    Dodatkowo zwraca:
    - meta.discipline
    - meta.table_schema (np. "DEFAULT" / "TENNIS")
    - meta.tennis_points_mode (np. "PLT" / "NONE") jeśli dyscyplina tennis
    """

    permission_classes = [AllowAny]  # kontrola dostępu w _public_access_or_403

    def get(self, request, pk: int):
        tournament = get_object_or_404(Tournament, pk=pk)

        denied = self._public_access_or_403(request, tournament)
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

        # meta: tenis_points_mode (frontend to wykorzystuje)
        if discipline == "tennis":
            cfg = tournament.format_config or {}
            mode = (cfg.get("tennis_points_mode") or "NONE")
            response_data["meta"]["tennis_points_mode"] = mode

        # =====================================================
        # 1) FORMAT LIGA (pojedyncza tabela)
        # =====================================================
        if fmt == Tournament.TournamentFormat.LEAGUE:
            stage = tournament.stages.filter(stage_type=Stage.StageType.LEAGUE).first()
            if stage:
                table = compute_stage_standings(tournament, stage)
                response_data["table"] = [self._serialize_row(r, discipline) for r in table]

        # =====================================================
        # 2) FORMAT MIXED (grupy – wiele tabel)
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
        # 3) FORMAT CUP oraz MIXED (drabinka)
        # =====================================================
        if fmt in (Tournament.TournamentFormat.CUP, Tournament.TournamentFormat.MIXED):
            bracket_data = get_knockout_bracket(tournament)
            if bracket_data and bracket_data.get("rounds"):
                response_data["bracket"] = bracket_data

        return Response(response_data, status=status.HTTP_200_OK)

    @staticmethod
    def _public_access_or_403(request, tournament: Tournament) -> Response | None:
        """
        Spójnie z matches.py (public/matches) + TournamentDetailView:

        - organizer/asystent (zalogowany) -> OK zawsze
        - uczestnik (zalogowany i ma TournamentRegistration w tym turnieju) -> OK zawsze
        - public:
          - tournament.is_published == True
          - jeśli tournament.access_code ustawione -> wymagamy ?code=...
        """
        user = getattr(request, "user", None)

        if user and getattr(user, "is_authenticated", False):
            # organizer
            if tournament.organizer_id == user.id:
                return None

            # assistant (podgląd również w ORGANIZER_ONLY)
            if user_is_assistant(user, tournament):
                return None

            # uczestnik (rejestracja istnieje) – bez approved=True (bo tego nie ma w modelu)
            if TournamentRegistration.objects.filter(tournament=tournament, user=user).exists():
                return None

        # public
        if not getattr(tournament, "is_published", False):
            return Response({"detail": "Turniej nie jest dostępny."}, status=status.HTTP_403_FORBIDDEN)

        access_code = getattr(tournament, "access_code", None)
        if access_code:
            if request.query_params.get("code") != access_code:
                return Response({"detail": "Wymagany poprawny kod dostępu."}, status=status.HTTP_403_FORBIDDEN)

        return None

    @staticmethod
    def _serialize_row(row: StandingRow, discipline: str) -> dict:
        """
        DEFAULT:
          - kompatybilna tabela (goals_for/goals_against itd.)

        TENIS:
          - zwraca tenisowe pola: sets_for/sets_against, games_for/games_against
          - zostawia też legacy goals_* jako aliasy (dla kompatybilności)
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

        # Legacy / default (wspólne API)
        base.update(
            {
                "goals_for": row.goals_for,
                "goals_against": row.goals_against,
                "goal_difference": row.goal_difference,
            }
        )

        # games_* (jeśli istnieją)
        base.update(
            {
                "games_for": getattr(row, "games_for", 0),
                "games_against": getattr(row, "games_against", 0),
                "games_difference": getattr(row, "games_difference", 0),
            }
        )

        # TENIS: docelowe nazwy kolumn
        if discipline == "tennis":
            base.update(
                {
                    # sety (u Ciebie były mapowane na goals_* w StandingRow)
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
