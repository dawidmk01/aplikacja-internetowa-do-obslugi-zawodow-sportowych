from rest_framework import serializers

from tournaments.models import Match

BYE_TEAM_NAME = "__SYSTEM_BYE__"


class MatchSerializer(serializers.ModelSerializer):
    """
    Serializer do listy meczów (UI).
    Zwraca informacje o etapie, nazwach drużyn i wykrywa mecze techniczne (BYE).
    """

    # Nazwy drużyn
    home_team_name = serializers.SerializerMethodField()
    away_team_name = serializers.SerializerMethodField()

    # Etap (stage) – do grupowania w UI
    stage_type = serializers.CharField(source="stage.stage_type", read_only=True)
    stage_id = serializers.IntegerField(source="stage.id", read_only=True)
    stage_order = serializers.IntegerField(source="stage.order", read_only=True)

    # Mecz techniczny (BYE)
    is_technical = serializers.SerializerMethodField()

    class Meta:
        model = Match
        fields = (
            "id",
            "stage_id",
            "stage_order",
            "stage_type",
            "round_number",
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

    @staticmethod
    def _team_name(team) -> str | None:
        if not team:
            return None
        name = getattr(team, "name", None)
        return str(name) if name is not None else None

    @staticmethod
    def _is_system_bye_team(team) -> bool:
        name = MatchSerializer._team_name(team)
        if not name:
            return False
        return name.strip().upper() == BYE_TEAM_NAME

    def get_home_team_name(self, obj: Match) -> str:
        # frontend często ma home_team_name jako string -> zwracamy zawsze string
        return self._team_name(obj.home_team) or ""

    def get_away_team_name(self, obj: Match) -> str | None:
        # może być None, jeżeli kiedyś dopuszczisz brak away_team
        return self._team_name(obj.away_team)

    def get_is_technical(self, obj: Match) -> bool:
        return self._is_system_bye_team(obj.home_team) or self._is_system_bye_team(obj.away_team)


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
        touched_score = ("home_score" in validated_data) or ("away_score" in validated_data)

        if touched_score and not instance.result_entered:
            instance.result_entered = True

        if "home_score" in validated_data:
            instance.home_score = validated_data["home_score"]
        if "away_score" in validated_data:
            instance.away_score = validated_data["away_score"]

        update_fields = []
        if touched_score:
            update_fields.append("result_entered")
        if "home_score" in validated_data:
            update_fields.append("home_score")
        if "away_score" in validated_data:
            update_fields.append("away_score")

        if update_fields:
            instance.save(update_fields=update_fields)

        return instance
