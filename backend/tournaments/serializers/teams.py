from rest_framework import serializers

from tournaments.models import Team


class TeamSerializer(serializers.ModelSerializer):
    """
    Serializer jednostki startowej turnieju (drużyna / zawodnik).
    """

    class Meta:
        model = Team
        fields = (
            "id",
            "tournament",
            "division",
            "name",
            "is_active",
            "created_at",
        )
        read_only_fields = (
            "id",
            "tournament",
            "created_at",
        )

    def validate_name(self, value):
        if not value or not value.strip():
            raise serializers.ValidationError("Nazwa nie może być pusta.")
        return value.strip()


class TeamUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Team
        fields = ("name",)

    def validate_name(self, value):
        if value is None:
            return value
        if not value.strip():
            raise serializers.ValidationError("Nazwa nie może być pusta.")
        return value.strip()
