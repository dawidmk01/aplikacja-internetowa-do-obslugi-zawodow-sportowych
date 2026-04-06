# backend/tournaments/serializers/assistants.py
# Plik definiuje serializery odpowiedzialne za listę asystentów i ich uprawnienia w skali całego turnieju.

from __future__ import annotations

from django.contrib.auth import get_user_model
from rest_framework import serializers

from tournaments.models import Tournament, TournamentMembership

User = get_user_model()


def _get_tournament_from_context(serializer: serializers.Serializer) -> Tournament:
    tournament = serializer.context.get("tournament")
    if not isinstance(tournament, Tournament):
        raise serializers.ValidationError(
            {"detail": "Brakuje turnieju w kontekście serializera."}
        )
    return tournament


class TournamentAssistantSerializer(serializers.ModelSerializer):
    user_id = serializers.IntegerField(source="user.id", read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)
    username = serializers.CharField(source="user.username", read_only=True)
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = TournamentMembership
        fields = (
            "user_id",
            "email",
            "username",
            "role",
            "permissions",
            "created_at",
        )

    def get_permissions(self, obj: TournamentMembership) -> dict:
        return obj.effective_permissions()


class AddAssistantSerializer(serializers.Serializer):
    email = serializers.EmailField()

    def validate_email(self, value):
        normalized = str(value).strip()

        try:
            return User.objects.get(email__iexact=normalized)
        except User.DoesNotExist as exc:
            raise serializers.ValidationError(
                "Użytkownik o podanym adresie e-mail nie istnieje."
            ) from exc

    def validate(self, attrs):
        tournament = _get_tournament_from_context(self)
        user = attrs["email"]

        if tournament.organizer_id == user.id:
            raise serializers.ValidationError(
                "Organizator nie może dodać samego siebie."
            )

        if TournamentMembership.objects.filter(
            tournament=tournament,
            user=user,
        ).exists():
            raise serializers.ValidationError(
                "Użytkownik jest już asystentem w tym turnieju."
            )

        attrs["user"] = user
        return attrs


class AssistantPermissionsSerializer(serializers.Serializer):
    teams_edit = serializers.BooleanField(required=False)
    roster_edit = serializers.BooleanField(required=False)
    schedule_edit = serializers.BooleanField(required=False)
    results_edit = serializers.BooleanField(required=False)
    bracket_edit = serializers.BooleanField(required=False)
    tournament_edit = serializers.BooleanField(required=False)
    name_change_approve = serializers.BooleanField(required=False)

    # Pola zastrzeżone dla organizatora mogą być zwracane w effective_permissions, ale nie są zapisywane.
    publish = serializers.BooleanField(required=False)
    archive = serializers.BooleanField(required=False)
    manage_assistants = serializers.BooleanField(required=False)
    join_settings = serializers.BooleanField(required=False)

    @classmethod
    def allowed_keys(cls) -> set[str]:
        return {
            TournamentMembership.PERM_TEAMS_EDIT,
            TournamentMembership.PERM_ROSTER_EDIT,
            TournamentMembership.PERM_SCHEDULE_EDIT,
            TournamentMembership.PERM_RESULTS_EDIT,
            TournamentMembership.PERM_BRACKET_EDIT,
            TournamentMembership.PERM_TOURNAMENT_EDIT,
            TournamentMembership.PERM_NAME_CHANGE_APPROVE,
        }

    def validate(self, attrs):
        unsupported = set(attrs.keys()) - self.allowed_keys()
        if unsupported:
            raise serializers.ValidationError(
                {
                    "detail": (
                        "Wskazano niedozwolone klucze uprawnień: "
                        + ", ".join(sorted(unsupported))
                    )
                }
            )
        return attrs
