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
            raise serializers.ValidationError("Użytkownik jest już współorganizatorem.")

        attrs["user"] = user
        return attrs
