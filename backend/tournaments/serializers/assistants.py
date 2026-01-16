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
        except User.DoesNotExist:
            raise serializers.ValidationError(
                "Użytkownik o podanym adresie e-mail nie istnieje."
            )

    def validate(self, attrs):
        tournament = self.context["tournament"]
        user = attrs["email"]

        if tournament.organizer_id == user.id:
            raise serializers.ValidationError("Organizator nie może dodać samego siebie.")

        if TournamentMembership.objects.filter(tournament=tournament, user=user).exists():
            raise serializers.ValidationError("Użytkownik jest już asystentem w tym turnieju.")

        attrs["user"] = user
        return attrs

class AssistantPermissionsSerializer(serializers.Serializer):
    """
    Punkt 5: granularne uprawnienia per-asystent.

    Kontrakt dla frontu:
      - teams_edit, schedule_edit, results_edit, bracket_edit, tournament_edit
      - organizer-only klucze mogą być zwracane (false), ale NIE zapisujemy ich z PATCH.
    """

    teams_edit = serializers.BooleanField(required=False)
    schedule_edit = serializers.BooleanField(required=False)
    results_edit = serializers.BooleanField(required=False)
    bracket_edit = serializers.BooleanField(required=False)
    tournament_edit = serializers.BooleanField(required=False)

    # organizer-only (dla spójności kontraktu; w PATCH ignorowane)
    publish = serializers.BooleanField(required=False)
    archive = serializers.BooleanField(required=False)
    manage_assistants = serializers.BooleanField(required=False)
    join_settings = serializers.BooleanField(required=False)

    EDITABLE_KEYS = {
        TournamentMembership.PERM_TEAMS_EDIT: "teams_edit",
        TournamentMembership.PERM_SCHEDULE_EDIT: "schedule_edit",
        TournamentMembership.PERM_RESULTS_EDIT: "results_edit",
        TournamentMembership.PERM_BRACKET_EDIT: "bracket_edit",
        TournamentMembership.PERM_TOURNAMENT_EDIT: "tournament_edit",
    }

    def validate(self, attrs):
        # twardo ignorujemy organizer-only w walidacji zapisu (backend i tak je odrzuci w widoku)
        return attrs
