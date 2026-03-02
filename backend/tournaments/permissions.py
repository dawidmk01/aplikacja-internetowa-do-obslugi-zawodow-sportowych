# backend/tournaments/permissions.py
# Plik centralizuje klasy uprawnień DRF dla widoków turniejowych.

from __future__ import annotations

from typing import Optional

from django.shortcuts import get_object_or_404

from rest_framework.permissions import SAFE_METHODS, BasePermission

from .access import (
    can_manage_assistants,
    can_update_assistant_permissions,
    can_view_assistant_permissions,
    user_can_view_tournament,
    user_is_organizer,
)
from .models import Tournament


def _get_tournament(view, obj=None) -> Optional[Tournament]:
    cached = getattr(view, "_permission_tournament", None)
    if cached is not None:
        return cached

    if isinstance(obj, Tournament):
        view._permission_tournament = obj
        return obj

    if obj is not None and hasattr(obj, "tournament"):
        tournament = obj.tournament
        view._permission_tournament = tournament
        return tournament

    pk = getattr(view, "kwargs", {}).get("pk")
    if pk is None:
        return None

    tournament = get_object_or_404(Tournament, pk=pk)
    view._permission_tournament = tournament
    return tournament


def _get_target_user_id(view) -> Optional[int]:
    raw = getattr(view, "kwargs", {}).get("user_id")
    if raw is None:
        return None

    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


class IsTournamentOrganizer(BasePermission):
    def has_permission(self, request, view):
        tournament = _get_tournament(view)
        if tournament is None:
            return False

        return user_is_organizer(request.user, tournament)

    def has_object_permission(self, request, view, obj):
        tournament = _get_tournament(view, obj)
        if tournament is None:
            return False

        return user_is_organizer(request.user, tournament)


class CanViewTournament(BasePermission):
    def has_permission(self, request, view):
        tournament = _get_tournament(view)
        if tournament is None:
            return False

        return user_can_view_tournament(request.user, tournament)


class CanManageAssistants(BasePermission):
    def has_permission(self, request, view):
        tournament = _get_tournament(view)
        if tournament is None:
            return False

        return can_manage_assistants(request.user, tournament)


class CanAccessAssistantPermissions(BasePermission):
    def has_permission(self, request, view):
        tournament = _get_tournament(view)
        if tournament is None:
            return False

        target_user_id = _get_target_user_id(view)
        if target_user_id is None:
            return False

        # Organizator ma odczyt i zapis, asystent tylko odczyt własnych uprawnień.
        if request.method in SAFE_METHODS:
            return can_view_assistant_permissions(request.user, tournament, target_user_id)

        return can_update_assistant_permissions(request.user, tournament)