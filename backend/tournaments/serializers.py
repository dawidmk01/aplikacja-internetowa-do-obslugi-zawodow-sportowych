from django.contrib.auth import get_user_model
from rest_framework import serializers
from .models import Tournament, TournamentMembership

User = get_user_model()


class TournamentSerializer(serializers.ModelSerializer):
    my_role = serializers.SerializerMethodField()

    class Meta:
        model = Tournament
        fields = "__all__"
        read_only_fields = ("organizer", "my_role")

    def get_my_role(self, obj):
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return None

        if obj.organizer_id == request.user.id:
            return "ORGANIZER"

        if obj.memberships.filter(
            user=request.user,
            role=TournamentMembership.Role.ASSISTANT,
        ).exists():
            return TournamentMembership.Role.ASSISTANT

        return None


class TournamentAssistantSerializer(serializers.ModelSerializer):
    """
    Serializer do listy współorganizatorów turnieju.
    ZWRACA user_id — kluczowe do DELETE.
    """
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
            raise serializers.ValidationError(
                "Organizator nie może dodać samego siebie."
            )

        if TournamentMembership.objects.filter(
            tournament=tournament,
            user=user,
        ).exists():
            raise serializers.ValidationError(
                "Użytkownik jest już współorganizatorem."
            )

        attrs["user"] = user
        return attrs
