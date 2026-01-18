# backend/tournaments/serializers/teams.py
from rest_framework import serializers

from tournaments.models import Team


class TeamSerializer(serializers.ModelSerializer):
    """
    Serializer jednostki startowej turnieju (drużyna / zawodnik).
    """

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
        """
        Liczba aktywnych zawodników w składzie drużyny.

        Uwaga wydajnościowa:
        - Jeżeli w widoku użyjesz .prefetch_related("players"), to obj.players będzie w cache.
        - Jeżeli nie, Django wykona COUNT per rekord (N+1).
        Dlatego w TournamentTeamListView docelowo dopniemy prefetch.
        """
        try:
            # gdy prefetch był wykonany, to będzie to QuerySet w cache
            return obj.players.filter(is_active=True).count()
        except Exception:
            return 0

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
