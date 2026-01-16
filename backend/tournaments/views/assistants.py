from __future__ import annotations

from django.shortcuts import get_object_or_404

from rest_framework import status
from rest_framework.generics import ListAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from ..models import Tournament, TournamentMembership
from ..permissions import IsTournamentOrganizer
from ..serializers import (
    AddAssistantSerializer,
    TournamentAssistantSerializer,
)
from ..serializers.assistants import AssistantPermissionsSerializer
from ._helpers import user_can_view_tournament, get_membership


class TournamentAssistantListView(ListAPIView):
    serializer_class = TournamentAssistantSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        tournament = get_object_or_404(Tournament, pk=self.kwargs["pk"])

        # Podgląd listy: organizer + asystent (membership). Jeśli wolisz tylko organizer – zmień na IsTournamentOrganizer.
        if not user_can_view_tournament(self.request.user, tournament):
            return TournamentMembership.objects.none()

        return tournament.memberships.filter(role=TournamentMembership.Role.ASSISTANT)


class AddAssistantView(APIView):
    permission_classes = [IsAuthenticated, IsTournamentOrganizer]

    def post(self, request, pk):
        tournament = get_object_or_404(Tournament, pk=pk)
        self.check_object_permissions(request, tournament)

        serializer = AddAssistantSerializer(data=request.data, context={"tournament": tournament})
        serializer.is_valid(raise_exception=True)

        TournamentMembership.objects.create(
            tournament=tournament,
            user=serializer.validated_data["user"],
            role=TournamentMembership.Role.ASSISTANT,
            permissions={},  # domyślne bazowe wynikają z entry_mode w effective_permissions()
        )

        return Response(status=status.HTTP_201_CREATED)


class RemoveAssistantView(APIView):
    permission_classes = [IsAuthenticated, IsTournamentOrganizer]

    def delete(self, request, pk, user_id):
        tournament = get_object_or_404(Tournament, pk=pk)
        self.check_object_permissions(request, tournament)

        TournamentMembership.objects.filter(
            tournament=tournament,
            user_id=user_id,
            role=TournamentMembership.Role.ASSISTANT,
        ).delete()

        return Response(status=status.HTTP_204_NO_CONTENT)


class AssistantPermissionsView(APIView):
    """
    GET  /api/tournaments/<pk>/assistants/<user_id>/permissions/
      -> { effective: {...}, raw: {...} }

    PATCH /api/tournaments/<pk>/assistants/<user_id>/permissions/
      body: { teams_edit?: bool, schedule_edit?: bool, ... }
      -> { effective: {...}, raw: {...} }

    Tylko organizator może modyfikować.
    Asystent może co najwyżej zobaczyć (opcjonalnie) – tu robimy: GET organizer+asystent, PATCH tylko organizer.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, pk: int, user_id: int):
        tournament = get_object_or_404(Tournament, pk=pk)

        # Organizer zawsze widzi
        if tournament.organizer_id != request.user.id:
            # Asystent może widzieć tylko swoje, żeby nie podglądał cudzych
            if request.user.id != user_id:
                return Response({"detail": "Brak uprawnień."}, status=status.HTTP_403_FORBIDDEN)

        m = TournamentMembership.objects.filter(
            tournament=tournament,
            user_id=user_id,
            role=TournamentMembership.Role.ASSISTANT,
        ).first()
        if not m:
            return Response({"detail": "Nie znaleziono asystenta."}, status=status.HTTP_404_NOT_FOUND)

        return Response(
            {
                "raw": m.permissions or {},
                "effective": m.effective_permissions(),
            },
            status=status.HTTP_200_OK,
        )

    def patch(self, request, pk: int, user_id: int):
        tournament = get_object_or_404(Tournament, pk=pk)

        # Tylko organizer edytuje
        if tournament.organizer_id != request.user.id:
            return Response({"detail": "Brak uprawnień."}, status=status.HTTP_403_FORBIDDEN)

        m = TournamentMembership.objects.filter(
            tournament=tournament,
            user_id=user_id,
            role=TournamentMembership.Role.ASSISTANT,
        ).first()
        if not m:
            return Response({"detail": "Nie znaleziono asystenta."}, status=status.HTTP_404_NOT_FOUND)

        ser = AssistantPermissionsSerializer(data=request.data, partial=True)
        ser.is_valid(raise_exception=True)

        raw = dict(m.permissions or {})
        raw.update(ser.validated_data)
        m.permissions = raw
        m.save(update_fields=["permissions"])

        return Response(
            {
                "raw": m.permissions or {},
                "effective": m.effective_permissions(),
            },
            status=status.HTTP_200_OK,
        )
