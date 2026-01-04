from rest_framework import serializers
from tournaments.models import Match

BYE_TEAM_NAME = "__SYSTEM_BYE__"


class MatchSerializer(serializers.ModelSerializer):
    """
    Serializer do listy meczów (UI).
    Zwraca informacje o etapie, drużynach oraz dane potrzebne
    do liczenia formy (Ostatnie 5).
    """

    # ===== ID drużyn (KRYTYCZNE) =====
    home_team_id = serializers.IntegerField(source="home_team.id", read_only=True)
    away_team_id = serializers.IntegerField(source="away_team.id", read_only=True)

    # ===== Nazwy drużyn =====
    home_team_name = serializers.CharField(source="home_team.name", read_only=True)
    away_team_name = serializers.CharField(source="away_team.name", read_only=True)

    # ===== Etap =====
    stage_type = serializers.CharField(source="stage.stage_type", read_only=True)
    stage_id = serializers.IntegerField(source="stage.id", read_only=True)
    stage_order = serializers.IntegerField(source="stage.order", read_only=True)

    # ===== Grupa (NOWE POLE) =====
    # To pole jest kluczowe dla poprawnego wyświetlania kafelków w fazie grupowej (MIXED)
    group_name = serializers.CharField(source="group.name", read_only=True, allow_null=True)

    # ===== Mecz techniczny (BYE) =====
    is_technical = serializers.SerializerMethodField()

    class Meta:
        model = Match
        fields = (
            "id",
            "stage_id",
            "stage_order",
            "stage_type",
            "group_name",  # <--- Pamiętaj o dodaniu tutaj!
            "round_number",
            "home_team_id",
            "away_team_id",
            "home_team_name",
            "away_team_name",
            "home_score",
            "away_score",
            "status",
            "scheduled_date",
            "scheduled_time",
            "location",
            "is_technical",
        )

    def get_is_technical(self, obj: Match) -> bool:
        return (
            obj.home_team and obj.home_team.name == BYE_TEAM_NAME
        ) or (
            obj.away_team and obj.away_team.name == BYE_TEAM_NAME
        )


# =========================
# SERIALIZERY UPDATE (WYMAGANE PRZEZ API)
# =========================

class MatchScheduleUpdateSerializer(serializers.ModelSerializer):
    """
    PATCH /api/matches/:id/
    """
    class Meta:
        model = Match
        fields = (
            "scheduled_date",
            "scheduled_time",
            "location",
        )


class MatchResultUpdateSerializer(serializers.ModelSerializer):
    """
    PATCH /api/matches/:id/result/
    """
    home_score = serializers.IntegerField(required=False, min_value=0)
    away_score = serializers.IntegerField(required=False, min_value=0)

    status = serializers.CharField(read_only=True)

    class Meta:
        model = Match
        fields = ("home_score", "away_score", "status")

    def update(self, instance: Match, validated_data):
        touched_score = (
            "home_score" in validated_data or "away_score" in validated_data
        )

        if touched_score and not instance.result_entered:
            instance.result_entered = True

        if "home_score" in validated_data:
            instance.home_score = validated_data["home_score"]
        if "away_score" in validated_data:
            instance.away_score = validated_data["away_score"]

        instance.save()
        return instance