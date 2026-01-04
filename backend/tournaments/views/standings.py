
from django.shortcuts import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from tournaments.models import Tournament, Stage
# POPRAWIONE IMPORTY (bez 'services'):
from tournaments.standings.league_table import compute_stage_standings
from tournaments.standings.knockout_bracket import get_knockout_bracket

class TournamentStandingsView(APIView):
    """
    GET /api/tournaments/:id/standings/

    Uniwersalny endpoint zwracający:
    - 'table': dla Ligi i Mixed
    - 'bracket': dla Pucharu i Mixed
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, pk: int):
        tournament = get_object_or_404(Tournament, pk=pk)

        response_data = {}
        fmt = tournament.tournament_format

        # ==========================================
        # 1. OBSŁUGA TABELI LIGOWEJ (Liga / Mixed)
        # ==========================================
        if fmt in (Tournament.TournamentFormat.LEAGUE, Tournament.TournamentFormat.MIXED):
            # A) Format LIGA
            if fmt == Tournament.TournamentFormat.LEAGUE:
                stage = tournament.stages.filter(stage_type=Stage.StageType.LEAGUE).first()
                if stage:
                    table = compute_stage_standings(tournament, stage)
                    response_data["table"] = [row.__dict__ for row in table]

            # B) Format MIXED (Faza grupowa)
            elif fmt == Tournament.TournamentFormat.MIXED:
                stage = tournament.stages.filter(stage_type=Stage.StageType.GROUP).first()
                if stage:
                    # Tutaj logika zależy od tego, jak chcesz to wyświetlić na froncie.
                    # Frontend, który dałem, obsługuje jedną tablicę 'table'.
                    # Jeśli masz wiele grup, musimy to spłaszczyć lub dostosować frontend.
                    # Na razie pobieramy tabelę dla pierwszej grupy lub łączymy (uproszczenie):

                    # Wariant prosty: Pobierz wszystkie grupy i zwróć jako jedną listę (jeśli frontend to obsłuży)
                    # lub zwróć strukturę specjalną.
                    # Aby Twój obecny frontend działał bez zmian dla Mixed, zróbmy:
                    groups_payload = []
                    for group in stage.groups.all():
                        t = compute_stage_standings(tournament, stage, group)
                        # Dodajemy nazwę grupy do wiersza, żeby rozróżnić w tabeli
                        for row in t:
                            row_dict = row.__dict__
                            row_dict['group_name'] = group.name
                            groups_payload.append(row_dict)

                    response_data["table"] = groups_payload

        # ==========================================
        # 2. OBSŁUGA DRABINKI (Puchar / Mixed)
        # ==========================================
        if fmt in (Tournament.TournamentFormat.CUP, Tournament.TournamentFormat.MIXED):
            # Używamy nowej funkcji z serwisu
            bracket_data = get_knockout_bracket(tournament)
            response_data["bracket"] = bracket_data

        return Response(response_data)