# backend/tournaments/serializers/teams.py
# Plik definiuje serializery odpowiedzialne za odczyt i edycję jednostek startowych turnieju.

from rest_framework import serializers

from tournaments.models import Team


class TeamSerializer(serializers.ModelSerializer):
    players_count = serializers.SerializerMethodField()

    class Meta:
        model = Team
        fields = (
            "id",
            "tournament",
            "division",
            "name",
            "is_active",
            "created_at",
            "players_count",
        )
        read_only_fields = (
            "id",
            "tournament",
            "created_at",
            "players_count",
        )

    def get_players_count(self, obj: Team) -> int:
        # Widok może użyć prefetch_related("players"), ale serializer działa też bez prefetchu.
        return obj.players.filter(is_active=True).count()

    def validate_name(self, value: str) -> str:
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
        if not str(value).strip():
            raise serializers.ValidationError("Nazwa nie może być pusta.")
        return str(value).strip()
