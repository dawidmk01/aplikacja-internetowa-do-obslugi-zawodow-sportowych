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
from ._helpers import user_can_view_tournament


class TournamentAssistantListView(ListAPIView):
    serializer_class = TournamentAssistantSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        tournament = get_object_or_404(Tournament, pk=self.kwargs["pk"])

        # Podgląd listy: organizer + asystent (membership) + participant (jeśli ma view).
        # Jeśli chcesz tylko organizer: zmień na IsTournamentOrganizer.
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

        user = serializer.validated_data["user"]

        # Nie dodawaj organizatora jako asystenta
        if user.id == tournament.organizer_id:
            return Response(
                {"detail": "Organizator nie może być dodany jako asystent."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Unikaj duplikatów membership
        obj, created = TournamentMembership.objects.get_or_create(
            tournament=tournament,
            user=user,
            role=TournamentMembership.Role.ASSISTANT,
            defaults={"permissions": {}},
        )
        if not created:
            return Response(
                {"detail": "Ten użytkownik jest już asystentem w tym turnieju."},
                status=status.HTTP_409_CONFLICT,
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
      -> { raw: {...}, effective: {...} }

    PATCH /api/tournaments/<pk>/assistants/<user_id>/permissions/
      body: { teams_edit?: bool, schedule_edit?: bool, ... , roster_edit?: bool, name_change_approve?: bool }
      -> { raw: {...}, effective: {...} }

    Zasady:
    - Organizer: może GET/PATCH dla dowolnego asystenta
    - Asystent: może GET wyłącznie swoje uprawnienia (żeby nie podglądał cudzych)
    - PATCH: tylko organizer
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

        # Twardo filtrujemy do dozwolonych kluczy (żadnych organizer-only i żadnych "śmieci")
        allowed_keys = set(AssistantPermissionsSerializer.allowed_keys())

        raw = dict(m.permissions or {})
        raw = {k: bool(v) for k, v in raw.items() if k in allowed_keys}

        for k, v in ser.validated_data.items():
            if k in allowed_keys:
                raw[k] = bool(v)

        m.permissions = raw
        m.save(update_fields=["permissions"])

        return Response(
            {
                "raw": m.permissions or {},
                "effective": m.effective_permissions(),
            },
            status=status.HTTP_200_OK,
        )
