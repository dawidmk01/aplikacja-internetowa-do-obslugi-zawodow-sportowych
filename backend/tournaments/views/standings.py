from django.shortcuts import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from tournaments.models import Tournament, Stage
from tournaments.standings.league_table import compute_stage_standings
from tournaments.models import Match


# ============================================================
# LIGA / GRUPY – TABELA
# ============================================================

class TournamentLeagueTableView(APIView):
    """
    GET /api/tournaments/:id/league-table/
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, pk: int):
        tournament = get_object_or_404(Tournament, pk=pk)

        if tournament.tournament_format == Tournament.TournamentFormat.CUP:
            return Response(
                {"detail": "Turniej pucharowy nie posiada tabeli ligowej."},
                status=409,
            )

        # ===== LIGA =====
        if tournament.tournament_format == Tournament.TournamentFormat.LEAGUE:
            stage = tournament.stages.filter(stage_type=Stage.StageType.LEAGUE).first()
            if not stage:
                return Response({"detail": "Brak etapu ligowego."}, status=404)

            table = compute_stage_standings(tournament, stage)
            return Response({
                "type": "LEAGUE",
                "table": [row.__dict__ for row in table],
            })

        # ===== MIXED – GRUPY =====
        stage = tournament.stages.filter(stage_type=Stage.StageType.GROUP).first()
        if not stage:
            return Response({"detail": "Brak fazy grupowej."}, status=404)

        groups_payload = []
        for group in stage.groups.all():
            table = compute_stage_standings(tournament, stage, group)
            groups_payload.append({
                "group_id": group.id,
                "group_name": group.name,
                "table": [row.__dict__ for row in table],
            })

        return Response({
            "type": "GROUP",
            "groups": groups_payload,
        })


# ============================================================
# UNIWERSALNY ENDPOINT STANDINGS (alias)
# ============================================================

class TournamentLeagueStandingsView(TournamentLeagueTableView):
    """
    GET /api/tournaments/:id/standings/
    Alias na league-table (dla frontendu).
    """
    pass


# ============================================================
# PUCHAR – DRABINKA
# ============================================================

class TournamentKnockoutBracketView(APIView):
    """
    GET /api/tournaments/:id/bracket/
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, tournament_id: int):
        tournament = get_object_or_404(Tournament, pk=tournament_id)

        if tournament.tournament_format != Tournament.TournamentFormat.CUP:
            return Response(
                {"detail": "Drabinka dostępna tylko dla turniejów pucharowych."},
                status=409,
            )

        matches = (
            Match.objects
            .filter(tournament=tournament)
            .select_related("stage", "home_team", "away_team")
            .order_by("stage__order", "round_number", "id")
        )

        payload = []
        for m in matches:
            payload.append({
                "id": m.id,
                "stage_id": m.stage_id,
                "stage_type": m.stage.stage_type,
                "round_number": m.round_number,
                "home_team": m.home_team.name,
                "away_team": m.away_team.name,
                "home_score": m.home_score,
                "away_score": m.away_score,
                "status": m.status,
            })

        return Response({
            "tournament_id": tournament.id,
            "bracket": payload,
        })
