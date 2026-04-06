# backend/tournaments/views/stages.py
# Plik udostępnia operacje etapów turnieju z obsługą aktywnej dywizji.

from __future__ import annotations

import inspect

from django.conf import settings
from django.db import transaction
from django.shortcuts import get_object_or_404

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from tournaments.access import user_can_manage_tournament
from tournaments.models import Tournament
from tournaments.services.advance_from_groups import advance_from_groups_to_knockout
from tournaments.services.advance_mass_start_stage import advance_mass_start_stage

from ._helpers import resolve_request_division


def _call_with_optional_division(service, *, tournament, division):
    try:
        signature = inspect.signature(service)
    except (TypeError, ValueError):
        signature = None

    if signature and "division" in signature.parameters:
        return service(tournament=tournament, division=division)

    return service(tournament)


class AdvanceFromGroupsView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, pk: int):
        tournament = get_object_or_404(Tournament, pk=pk)
        division = resolve_request_division(request, tournament)

        if not user_can_manage_tournament(request.user, tournament):
            return Response({"detail": "Brak uprawnień do zarządzania tym turniejem."}, status=status.HTTP_403_FORBIDDEN)

        try:
            stage = _call_with_optional_division(advance_from_groups_to_knockout, tournament=tournament, division=division)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as exc:
            if getattr(settings, "DEBUG", False):
                return Response({"detail": f"Advance-from-groups error: {type(exc).__name__}: {exc}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
            return Response({"detail": "Wystąpił błąd podczas generowania fazy pucharowej."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response({"detail": "Faza pucharowa została wygenerowana pomyślnie.", "stage_id": stage.id, "division_id": getattr(stage, "division_id", None)}, status=status.HTTP_201_CREATED)


class AdvanceMassStartStageView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, pk: int):
        tournament = get_object_or_404(Tournament, pk=pk)
        division = resolve_request_division(request, tournament)

        if not user_can_manage_tournament(request.user, tournament):
            return Response({"detail": "Brak uprawnień do zarządzania tym turniejem."}, status=status.HTTP_403_FORBIDDEN)

        try:
            stage = _call_with_optional_division(advance_mass_start_stage, tournament=tournament, division=division)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as exc:
            if getattr(settings, "DEBUG", False):
                return Response({"detail": f"Advance-mass-start-stage error: {type(exc).__name__}: {exc}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
            return Response({"detail": "Wystąpił błąd podczas generowania kolejnego etapu MASS_START."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response({"detail": "Kolejny etap MASS_START został wygenerowany pomyślnie.", "stage_id": stage.id, "division_id": getattr(stage, "division_id", None)}, status=status.HTTP_201_CREATED)
