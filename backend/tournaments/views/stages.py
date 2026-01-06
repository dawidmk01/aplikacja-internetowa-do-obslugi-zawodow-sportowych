from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import IsAuthenticated

from tournaments.models import Tournament
from tournaments.services import advance_from_groups_to_knockout
from ._helpers import user_can_manage_tournament

class AdvanceFromGroupsView(APIView):
    """
    Endpoint do przejścia z Fazy Grupowej -> Fazy Pucharowej (generuje drabinkę).
    """
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, pk):
        # ✅ POPRAWKA: Używamy 'pk' zamiast 'id' dla spójności z konwencją Django
        tournament = get_object_or_404(Tournament, pk=pk)

        # 1. Sprawdzenie uprawnień (czy to właściciel/admin)
        if not user_can_manage_tournament(request.user, tournament):
            return Response(
                {"detail": "Brak uprawnień do zarządzania tym turniejem."},
                status=status.HTTP_403_FORBIDDEN
            )

        try:
            # 2. Wywołanie logiki biznesowej (generowanie drzewka)
            stage = advance_from_groups_to_knockout(tournament)

        except ValueError as e:
            # Obsługa błędu logicznego (np. "Nie wszystkie mecze rozegrane")
            return Response(
                {"detail": str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )
        except Exception as e:
            # Obsługa innych nieprzewidzianych błędów
            # Warto tu dodać logowanie błędu w produkcji
            return Response(
                {"detail": "Wystąpił błąd podczas generowania fazy pucharowej."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

        return Response(
            {
                "detail": "Faza pucharowa została wygenerowana pomyślnie.",
                "stage_id": stage.id,
            },
            status=status.HTTP_201_CREATED,
        )