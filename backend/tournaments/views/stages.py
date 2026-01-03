from __future__ import annotations

from django.db import transaction
from django.shortcuts import get_object_or_404

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from tournaments.services.generators.knockout import generate_next_knockout_stage

from ..models import Stage
from ._helpers import user_can_manage_tournament


class ConfirmStageView(APIView):
    """
    Legacy/kompatybilność: ręczne wygenerowanie kolejnego etapu KO.
    Docelowo możesz usunąć, jeśli zostajesz przy auto-progres.
    """
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, *args, **kwargs):
        stage_id = kwargs.get("pk") or kwargs.get("id")
        if not stage_id:
            return Response({"detail": "Brak identyfikatora etapu."}, status=status.HTTP_400_BAD_REQUEST)

        stage = get_object_or_404(Stage, pk=stage_id)
        tournament = stage.tournament

        if not user_can_manage_tournament(request.user, tournament):
            return Response({"detail": "Brak uprawnień."}, status=status.HTTP_403_FORBIDDEN)

        if stage.stage_type != Stage.StageType.KNOCKOUT:
            return Response(
                {"detail": "Zatwierdzanie obsługiwane jest tylko dla etapu KO."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if stage.status != Stage.Status.OPEN:
            stage.status = Stage.Status.OPEN
            stage.save(update_fields=["status"])

        try:
            generate_next_knockout_stage(stage)
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        return Response({"detail": "Etap został zatwierdzony."}, status=status.HTTP_200_OK)
