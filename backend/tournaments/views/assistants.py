# backend/tournaments/views/assistants.py
# Plik udostępnia endpointy listy asystentów i zarządzania ich uprawnieniami.

from __future__ import annotations

from django.db import transaction
from django.shortcuts import get_object_or_404

from rest_framework import status
from rest_framework.generics import ListAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from ..models import Tournament, TournamentMembership
from ..permissions import CanAccessAssistantPermissions, CanManageAssistants, CanViewTournament
from ..realtime import ws_emit_tournament, ws_emit_user
from ..serializers import AddAssistantSerializer, TournamentAssistantSerializer
from ..serializers.assistants import AssistantPermissionsSerializer


def _get_permission_tournament(view, pk: int) -> Tournament:
    tournament = getattr(view, "_permission_tournament", None)
    if tournament is not None:
        return tournament
    return get_object_or_404(Tournament, pk=pk)


class TournamentAssistantListView(ListAPIView):
    serializer_class = TournamentAssistantSerializer
    permission_classes = [IsAuthenticated, CanViewTournament]

    def get_queryset(self):
        tournament = _get_permission_tournament(self, self.kwargs["pk"])
        return tournament.memberships.filter(role=TournamentMembership.Role.ASSISTANT)


class AddAssistantView(APIView):
    permission_classes = [IsAuthenticated, CanManageAssistants]

    def post(self, request, pk):
        tournament = _get_permission_tournament(self, pk)

        serializer = AddAssistantSerializer(data=request.data, context={"tournament": tournament})
        serializer.is_valid(raise_exception=True)

        user = serializer.validated_data["user"]

        if user.id == tournament.organizer_id:
            return Response(
                {"detail": "Organizator nie może być dodany jako asystent."},
                status=status.HTTP_400_BAD_REQUEST,
            )

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

        # Zmiana trafia do kanału turnieju i do kanału użytkownika.
        transaction.on_commit(
            lambda: ws_emit_tournament(
                tournament.id,
                "permissions.changed",
                {
                    "userId": user.id,
                    "action": "assistant_added",
                },
            )
        )

        transaction.on_commit(
            lambda: ws_emit_user(
                user.id,
                {
                    "v": 1,
                    "type": "membership.changed",
                    "tournamentId": tournament.id,
                    "action": "assistant_added",
                },
            )
        )

        return Response(status=status.HTTP_201_CREATED)


class RemoveAssistantView(APIView):
    permission_classes = [IsAuthenticated, CanManageAssistants]

    @transaction.atomic
    def delete(self, request, pk, user_id):
        tournament = _get_permission_tournament(self, pk)

        membership = (
            TournamentMembership.objects.select_for_update()
            .filter(
                tournament=tournament,
                user_id=user_id,
                role=TournamentMembership.Role.ASSISTANT,
            )
            .first()
        )

        if not membership:
            return Response(
                {"detail": "Nie znaleziono asystenta."},
                status=status.HTTP_404_NOT_FOUND,
            )

        membership.delete()

        transaction.on_commit(
            lambda: ws_emit_tournament(
                tournament.id,
                "permissions.changed",
                {
                    "userId": int(user_id),
                    "action": "assistant_removed",
                },
            )
        )

        transaction.on_commit(
            lambda: ws_emit_user(
                int(user_id),
                {
                    "v": 1,
                    "type": "membership.changed",
                    "tournamentId": tournament.id,
                    "action": "assistant_removed",
                },
            )
        )

        return Response(status=status.HTTP_204_NO_CONTENT)


class AssistantPermissionsView(APIView):
    permission_classes = [IsAuthenticated, CanAccessAssistantPermissions]

    def get(self, request, pk: int, user_id: int):
        tournament = _get_permission_tournament(self, pk)

        membership = TournamentMembership.objects.filter(
            tournament=tournament,
            user_id=user_id,
            role=TournamentMembership.Role.ASSISTANT,
        ).first()

        if not membership:
            return Response(
                {"detail": "Nie znaleziono asystenta."},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response(
            {
                "raw": membership.permissions or {},
                "effective": membership.effective_permissions(),
            },
            status=status.HTTP_200_OK,
        )

    def patch(self, request, pk: int, user_id: int):
        tournament = _get_permission_tournament(self, pk)

        serializer = AssistantPermissionsSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)

        allowed_keys = set(AssistantPermissionsSerializer.allowed_keys())

        with transaction.atomic():
            membership = (
                TournamentMembership.objects.select_for_update()
                .filter(
                    tournament=tournament,
                    user_id=user_id,
                    role=TournamentMembership.Role.ASSISTANT,
                )
                .first()
            )

            if not membership:
                return Response(
                    {"detail": "Nie znaleziono asystenta."},
                    status=status.HTTP_404_NOT_FOUND,
                )

            # Zapisywany jest tylko jawny, dozwolony zestaw kluczy.
            raw = dict(membership.permissions or {})
            raw = {k: bool(v) for k, v in raw.items() if k in allowed_keys}

            for key, value in serializer.validated_data.items():
                if key in allowed_keys:
                    raw[key] = bool(value)

            membership.permissions = raw
            membership.save(update_fields=["permissions"])

        transaction.on_commit(
            lambda: ws_emit_tournament(
                tournament.id,
                "permissions.changed",
                {
                    "userId": int(user_id),
                    "action": "assistant_permissions_updated",
                },
            )
        )

        transaction.on_commit(
            lambda: ws_emit_user(
                int(user_id),
                {
                    "v": 1,
                    "type": "membership.changed",
                    "tournamentId": tournament.id,
                    "action": "assistant_permissions_updated",
                },
            )
        )

        return Response(
            {
                "raw": membership.permissions or {},
                "effective": membership.effective_permissions(),
            },
            status=status.HTTP_200_OK,
        )