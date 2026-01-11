from django.conf import settings
from django.db import transaction
from django.shortcuts import get_object_or_404

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import IsAuthenticated

from tournaments.models import Tournament
from tournaments.services.advance_from_groups import advance_from_groups_to_knockout
from ._helpers import user_can_manage_tournament


class AdvanceFromGroupsView(APIView):
    """
    POST /api/tournaments/<pk>/advance-from-groups/
    """
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, pk: int):
        tournament = get_object_or_404(Tournament, pk=pk)

        if not user_can_manage_tournament(request.user, tournament):
            return Response(
                {"detail": "Brak uprawnień do zarządzania tym turniejem."},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            stage = advance_from_groups_to_knockout(tournament)

        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        except Exception as e:
            if getattr(settings, "DEBUG", False):
                return Response(
                    {"detail": f"Advance-from-groups error: {type(e).__name__}: {e}"},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR,
                )
            return Response(
                {"detail": "Wystąpił błąd podczas generowania fazy pucharowej."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(
            {"detail": "Faza pucharowa została wygenerowana pomyślnie.", "stage_id": stage.id},
            status=status.HTTP_201_CREATED,
        )
