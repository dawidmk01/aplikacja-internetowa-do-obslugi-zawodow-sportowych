from django.shortcuts import get_object_or_404
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from tournaments.models import Tournament, Stage
from tournaments.services.standings.compute import compute_stage_standings
from tournaments.services.standings.knockout_bracket import get_knockout_bracket


class TournamentStandingsView(APIView):
    """
    GET /api/tournaments/:id/standings/

    Zwraca dane do widoku wyników w zależności od formatu:
    - LEAGUE: klucz 'table' (jedna lista)
    - MIXED:  klucz 'groups' (lista obiektów {group_name, table}) + 'bracket'
    - CUP:    klucz 'bracket'
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, pk: int):
        tournament = get_object_or_404(Tournament, pk=pk)

        # Używamy enumów z modelu, zakładając że tak są zdefiniowane.
        # Jeśli masz je jako stringi ("LEAGUE", "CUP", "MIXED"), to też zadziała przy porównaniu.
        fmt = tournament.tournament_format

        response_data = {}

        # =====================================================
        # 1. FORMAT LIGA (Pojedyncza tabela)
        # =====================================================
        if fmt == Tournament.TournamentFormat.LEAGUE:
            # Szukamy etapu ligowego
            stage = tournament.stages.filter(stage_type=Stage.StageType.LEAGUE).first()

            if stage:
                table = compute_stage_standings(tournament, stage)
                # Serializacja obiektów StandingRow do słownika
                response_data["table"] = [row.__dict__ for row in table]

        # =====================================================
        # 2. FORMAT MIXED (Grupy - wiele tabel)
        # =====================================================
        elif fmt == Tournament.TournamentFormat.MIXED:
            # Szukamy etapu grupowego
            stage = tournament.stages.filter(stage_type=Stage.StageType.GROUP).first()

            if stage:
                groups_payload = []
                # Iterujemy po grupach w kolejności (A, B, C...)
                # Upewnij się, że w modelu Group masz pole 'order' lub sortuj po nazwie
                groups = stage.groups.all().order_by('name')

                for group in groups:
                    # Obliczamy tabelę dla konkretnej grupy
                    table = compute_stage_standings(tournament, stage, group=group)

                    groups_payload.append({
                        "group_id": group.id,
                        "group_name": group.name,  # Np. "Grupa A"
                        "table": [row.__dict__ for row in table]
                    })

                response_data["groups"] = groups_payload

        # =====================================================
        # 3. FORMAT PUCHAROWY ORAZ MIXED (Drabinka)
        # =====================================================
        # Drabinka występuje w czystym Pucharze oraz w Mixed (po grupach)
        if fmt in (Tournament.TournamentFormat.CUP, Tournament.TournamentFormat.MIXED):
            # Serwis zwraca gotową strukturę { rounds: [...], third_place: ... }
            bracket_data = get_knockout_bracket(tournament)

            # Dodajemy do odpowiedzi tylko jeśli są jakieś rundy
            if bracket_data and bracket_data.get("rounds"):
                response_data["bracket"] = bracket_data

        return Response(response_data)