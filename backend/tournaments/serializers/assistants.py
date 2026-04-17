# backend/tournaments/serializers/assistants.py
# Plik definiuje serializery odpowiedzialne za listę asystentów, zaproszeń i ich uprawnień.

from __future__ import annotations

from django.contrib.auth import get_user_model
from rest_framework import serializers

from tournaments.models import Tournament, TournamentMembership

User = get_user_model()


ALLOWED_PERMISSION_KEYS = {
    TournamentMembership.PERM_TEAMS_EDIT,
    TournamentMembership.PERM_ROSTER_EDIT,
    TournamentMembership.PERM_SCHEDULE_EDIT,
    TournamentMembership.PERM_RESULTS_EDIT,
    TournamentMembership.PERM_BRACKET_EDIT,
    TournamentMembership.PERM_TOURNAMENT_EDIT,
    TournamentMembership.PERM_NAME_CHANGE_APPROVE,
}


def _get_tournament_from_context(serializer: serializers.Serializer) -> Tournament:
    tournament = serializer.context.get("tournament")
    if not isinstance(tournament, Tournament):
        raise serializers.ValidationError({"detail": "Brakuje turnieju w kontekście serializera."})
    return tournament


def normalize_email(value: str | None) -> str:
    return str(value or "").strip().lower()


def normalize_assistant_permissions(raw: object) -> dict[str, bool]:
    payload = raw if isinstance(raw, dict) else {}
    return {key: bool(payload.get(key, False)) for key in ALLOWED_PERMISSION_KEYS}


class TournamentAssistantSerializer(serializers.Serializer):
    user_id = serializers.IntegerField(required=False, allow_null=True)
    invite_id = serializers.IntegerField(required=False, allow_null=True)
    email = serializers.EmailField()
    username = serializers.CharField(required=False, allow_null=True)
    role = serializers.CharField(required=False, allow_null=True)
    status = serializers.CharField()
    permissions = serializers.DictField(child=serializers.BooleanField(), required=False)
    created_at = serializers.DateTimeField(required=False)


class AddAssistantSerializer(serializers.Serializer):
    email = serializers.EmailField()
    permissions = serializers.DictField(required=False)

    def validate(self, attrs):
        tournament = _get_tournament_from_context(self)
        normalized = normalize_email(attrs.get("email"))

        if not normalized:
            raise serializers.ValidationError({"email": "Podaj adres e-mail."})

        organizer_email = normalize_email(getattr(getattr(tournament, "organizer", None), "email", None))
        if organizer_email and organizer_email == normalized:
            raise serializers.ValidationError("Organizator nie może dodać samego siebie.")

        attrs["email"] = normalized
        attrs["permissions"] = normalize_assistant_permissions(attrs.get("permissions"))
        attrs["matched_user"] = User.objects.filter(email__iexact=normalized).first()
        return attrs


class AssistantPermissionsSerializer(serializers.Serializer):
    teams_edit = serializers.BooleanField(required=False)
    roster_edit = serializers.BooleanField(required=False)
    schedule_edit = serializers.BooleanField(required=False)
    results_edit = serializers.BooleanField(required=False)
    bracket_edit = serializers.BooleanField(required=False)
    tournament_edit = serializers.BooleanField(required=False)
    name_change_approve = serializers.BooleanField(required=False)

    publish = serializers.BooleanField(required=False)
    archive = serializers.BooleanField(required=False)
    manage_assistants = serializers.BooleanField(required=False)
    join_settings = serializers.BooleanField(required=False)

    @classmethod
    def allowed_keys(cls) -> set[str]:
        return set(ALLOWED_PERMISSION_KEYS)

    def validate(self, attrs):
        unsupported = set(attrs.keys()) - self.allowed_keys()
        if unsupported:
            raise serializers.ValidationError(
                {"detail": "Wskazano niedozwolone klucze uprawnień: " + ", ".join(sorted(unsupported))}
            )
        return attrs
