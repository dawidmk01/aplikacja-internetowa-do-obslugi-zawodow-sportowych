from rest_framework.permissions import BasePermission


class IsTournamentOrganizer(BasePermission):
    def has_object_permission(self, request, view, obj):
        return obj.organizer_id == request.user.id
