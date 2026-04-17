# backend/tournaments/views/assistants.py
# Plik udostępnia endpointy listy asystentów, zaproszeń i zarządzania ich uprawnieniami.

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.generics import ListAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from ..models import Tournament, TournamentAssistantInvite, TournamentMembership
from ..permissions import CanAccessAssistantPermissions, CanManageAssistants, CanViewTournament
from ..realtime import ws_emit_tournament, ws_emit_user
from ..serializers import AddAssistantSerializer, TournamentAssistantSerializer
from ..serializers.assistants import AssistantPermissionsSerializer, normalize_assistant_permissions, normalize_email

User = get_user_model()


def _get_permission_tournament(view, pk: int) -> Tournament:
    tournament = getattr(view, "_permission_tournament", None)
    if tournament is not None:
        return tournament
    return get_object_or_404(Tournament, pk=pk)


class TournamentAssistantListView(ListAPIView):
    serializer_class = TournamentAssistantSerializer
    permission_classes = [IsAuthenticated, CanViewTournament]

    def list(self, request, *args, **kwargs):
        tournament = _get_permission_tournament(self, self.kwargs["pk"])

        payload: list[dict] = []

        invites = tournament.assistant_invites.filter(status=TournamentAssistantInvite.Status.PENDING).order_by(
            "-created_at", "-id"
        )
        for invite in invites:
            payload.append(
                {
                    "user_id": -int(invite.id),
                    "invite_id": int(invite.id),
                    "email": invite.invited_email,
                    "username": None,
                    "role": TournamentMembership.Role.ASSISTANT,
                    "status": TournamentAssistantInvite.Status.PENDING,
                    "permissions": invite.normalized_permissions(),
                    "created_at": invite.created_at,
                }
            )

        memberships = tournament.memberships.filter(
            role=TournamentMembership.Role.ASSISTANT,
            status=TournamentMembership.Status.ACCEPTED,
        ).select_related("user").order_by("-created_at", "id")
        for membership in memberships:
            payload.append(
                {
                    "user_id": int(membership.user_id),
                    "invite_id": None,
                    "email": membership.user.email,
                    "username": membership.user.username,
                    "role": membership.role,
                    "status": membership.status,
                    "permissions": membership.effective_permissions(),
                    "created_at": membership.created_at,
                }
            )

        serializer = self.get_serializer(payload, many=True)
        return Response(serializer.data)


class AddAssistantView(APIView):
    permission_classes = [IsAuthenticated, CanManageAssistants]

    def post(self, request, pk):
        tournament = _get_permission_tournament(self, pk)
        serializer = AddAssistantSerializer(data=request.data, context={"tournament": tournament})
        serializer.is_valid(raise_exception=True)

        email = serializer.validated_data["email"]
        permissions = serializer.validated_data["permissions"]
        matched_user = serializer.validated_data.get("matched_user")

        generic_detail = (
            "Zaproszenie zostało zapisane. Jeśli konto z tym adresem istnieje albo zostanie utworzone później, użytkownik zobaczy je na liście swoich turniejów."
        )

        if matched_user and TournamentMembership.objects.filter(
            tournament=tournament,
            user=matched_user,
            role=TournamentMembership.Role.ASSISTANT,
            status=TournamentMembership.Status.ACCEPTED,
        ).exists():
            return Response(
                {"detail": "Ten adres jest już przypisany do aktywnego asystenta."},
                status=status.HTTP_409_CONFLICT,
            )

        with transaction.atomic():
            invite, created = TournamentAssistantInvite.objects.select_for_update().get_or_create(
                tournament=tournament,
                normalized_email=email,
                defaults={
                    "invited_email": email,
                    "invited_by": request.user,
                    "status": TournamentAssistantInvite.Status.PENDING,
                    "permissions": permissions,
                },
            )

            action = "assistant_invited" if created else "assistant_invite_updated"

            if not created:
                invite.invited_email = email
                invite.mark_pending(invited_by=request.user, permissions=permissions)
                invite.save(update_fields=["invited_email", "normalized_email", "status", "invited_by", "permissions", "responded_at", "updated_at"])

        transaction.on_commit(
            lambda: ws_emit_tournament(
                tournament.id,
                "permissions.changed",
                {"userId": matched_user.id if matched_user else None, "action": action},
            )
        )

        if matched_user:
            transaction.on_commit(
                lambda: ws_emit_user(
                    matched_user.id,
                    {"v": 1, "type": "membership.changed", "tournamentId": tournament.id, "action": action},
                )
            )

        return Response({"detail": generic_detail}, status=status.HTTP_202_ACCEPTED)


class AcceptAssistantInviteView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, pk):
        tournament = _get_permission_tournament(self, pk)
        normalized = normalize_email(getattr(request.user, "email", None))

        invite = (
            TournamentAssistantInvite.objects.select_for_update()
            .filter(
                tournament=tournament,
                normalized_email=normalized,
                status=TournamentAssistantInvite.Status.PENDING,
            )
            .first()
        )
        if not invite:
            return Response({"detail": "Nie znaleziono oczekującego zaproszenia."}, status=status.HTTP_404_NOT_FOUND)

        membership, _created = TournamentMembership.objects.select_for_update().get_or_create(
            tournament=tournament,
            user=request.user,
            defaults={
                "role": TournamentMembership.Role.ASSISTANT,
                "status": TournamentMembership.Status.ACCEPTED,
                "invited_by": invite.invited_by,
                "permissions": invite.normalized_permissions(),
            },
        )
        membership.role = TournamentMembership.Role.ASSISTANT
        membership.status = TournamentMembership.Status.ACCEPTED
        membership.invited_by = invite.invited_by
        membership.permissions = invite.normalized_permissions()
        membership.responded_at = timezone.now()
        membership.save(update_fields=["role", "status", "invited_by", "permissions", "responded_at"])

        invite.mark_accepted()
        invite.save(update_fields=["status", "responded_at", "updated_at"])

        transaction.on_commit(
            lambda: ws_emit_tournament(
                tournament.id,
                "permissions.changed",
                {"userId": request.user.id, "action": "assistant_accepted"},
            )
        )
        transaction.on_commit(
            lambda: ws_emit_user(
                request.user.id,
                {"v": 1, "type": "membership.changed", "tournamentId": tournament.id, "action": "assistant_accepted"},
            )
        )

        return Response({"detail": "Zaproszenie zostało zaakceptowane."}, status=status.HTTP_200_OK)


class DeclineAssistantInviteView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, pk):
        tournament = _get_permission_tournament(self, pk)
        normalized = normalize_email(getattr(request.user, "email", None))

        invite = (
            TournamentAssistantInvite.objects.select_for_update()
            .filter(
                tournament=tournament,
                normalized_email=normalized,
                status=TournamentAssistantInvite.Status.PENDING,
            )
            .first()
        )
        if not invite:
            return Response({"detail": "Nie znaleziono oczekującego zaproszenia."}, status=status.HTTP_404_NOT_FOUND)

        invite.mark_declined()
        invite.save(update_fields=["status", "responded_at", "updated_at"])

        transaction.on_commit(
            lambda: ws_emit_tournament(
                tournament.id,
                "permissions.changed",
                {"userId": request.user.id, "action": "assistant_declined"},
            )
        )
        transaction.on_commit(
            lambda: ws_emit_user(
                request.user.id,
                {"v": 1, "type": "membership.changed", "tournamentId": tournament.id, "action": "assistant_declined"},
            )
        )

        return Response({"detail": "Zaproszenie zostało odrzucone."}, status=status.HTTP_200_OK)


class CancelAssistantInviteView(APIView):
    permission_classes = [IsAuthenticated, CanManageAssistants]

    @transaction.atomic
    def post(self, request, pk, invite_id: int):
        tournament = _get_permission_tournament(self, pk)
        invite = (
            TournamentAssistantInvite.objects.select_for_update()
            .filter(tournament=tournament, id=invite_id, status=TournamentAssistantInvite.Status.PENDING)
            .first()
        )
        if not invite:
            return Response({"detail": "Nie znaleziono oczekującego zaproszenia."}, status=status.HTTP_404_NOT_FOUND)

        matched_user = User.objects.filter(email__iexact=invite.normalized_email).first()
        invite.mark_canceled()
        invite.save(update_fields=["status", "responded_at", "updated_at"])

        transaction.on_commit(
            lambda: ws_emit_tournament(
                tournament.id,
                "permissions.changed",
                {"userId": matched_user.id if matched_user else None, "action": "assistant_invite_canceled"},
            )
        )
        if matched_user:
            transaction.on_commit(
                lambda: ws_emit_user(
                    matched_user.id,
                    {"v": 1, "type": "membership.changed", "tournamentId": tournament.id, "action": "assistant_invite_canceled"},
                )
            )

        return Response({"detail": "Zaproszenie zostało cofnięte."}, status=status.HTTP_200_OK)


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
                status=TournamentMembership.Status.ACCEPTED,
            )
            .first()
        )
        if not membership:
            return Response({"detail": "Nie znaleziono asystenta."}, status=status.HTTP_404_NOT_FOUND)

        membership.delete()
        transaction.on_commit(
            lambda: ws_emit_tournament(
                tournament.id,
                "permissions.changed",
                {"userId": int(user_id), "action": "assistant_removed"},
            )
        )
        transaction.on_commit(
            lambda: ws_emit_user(
                int(user_id),
                {"v": 1, "type": "membership.changed", "tournamentId": tournament.id, "action": "assistant_removed"},
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
            status=TournamentMembership.Status.ACCEPTED,
        ).first()
        if not membership:
            return Response({"detail": "Nie znaleziono asystenta."}, status=status.HTTP_404_NOT_FOUND)

        return Response(
            {
                "status": membership.status,
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
                    status=TournamentMembership.Status.ACCEPTED,
                )
                .first()
            )
            if not membership:
                return Response({"detail": "Nie znaleziono asystenta."}, status=status.HTTP_404_NOT_FOUND)

            raw = dict(membership.permissions or {})
            raw = {k: bool(v) for k, v in raw.items() if k in allowed_keys}
            for key, value in serializer.validated_data.items():
                raw[key] = bool(value)

            membership.permissions = normalize_assistant_permissions(raw)
            membership.save(update_fields=["permissions"])

        transaction.on_commit(
            lambda: ws_emit_tournament(
                tournament.id,
                "permissions.changed",
                {"userId": int(user_id), "action": "assistant_permissions_updated"},
            )
        )
        transaction.on_commit(
            lambda: ws_emit_user(
                int(user_id),
                {"v": 1, "type": "membership.changed", "tournamentId": tournament.id, "action": "assistant_permissions_updated"},
            )
        )

        return Response(
            {"status": membership.status, "raw": membership.permissions or {}, "effective": membership.effective_permissions()},
            status=status.HTTP_200_OK,
        )
