# backend/tournaments/serializers/assistants.py
# Plik definiuje serializery odpowiedzialne za listę asystentów i ich uprawnienia.

from django.contrib.auth import get_user_model
from rest_framework import serializers

from tournaments.models import TournamentMembership

User = get_user_model()


class TournamentAssistantSerializer(serializers.ModelSerializer):
    user_id = serializers.IntegerField(source="user.id", read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)
    username = serializers.CharField(source="user.username", read_only=True)

    class Meta:
        model = TournamentMembership
        fields = (
            "user_id",
            "email",
            "username",
            "role",
            "created_at",
        )


class AddAssistantSerializer(serializers.Serializer):
    email = serializers.EmailField()

    def validate_email(self, value):
        try:
            return User.objects.get(email=value)
        except User.DoesNotExist as exc:
            raise serializers.ValidationError(
                "Użytkownik o podanym adresie e-mail nie istnieje."
            ) from exc

    def validate(self, attrs):
        tournament = self.context["tournament"]
        user = attrs["email"]

        if tournament.organizer_id == user.id:
            raise serializers.ValidationError("Organizator nie może dodać samego siebie.")

        if TournamentMembership.objects.filter(tournament=tournament, user=user).exists():
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

    # Te pola mogą być zwracane w effective_permissions, ale nie powinny być zapisywane.
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
        return attrs
