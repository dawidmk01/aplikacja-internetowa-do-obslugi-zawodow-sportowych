from rest_framework import serializers
from tournaments.models import Match, Stage, Tournament

BYE_TEAM_NAME = "__SYSTEM_BYE__"


def _third_place_value() -> str:
    return getattr(Stage.StageType, "THIRD_PLACE", "THIRD_PLACE")


def _is_knockout_like(stage_type: str | None) -> bool:
    return str(stage_type) in (str(Stage.StageType.KNOCKOUT), str(_third_place_value()))


class MatchSerializer(serializers.ModelSerializer):
    """
    Serializer do listy meczów (UI).
    Zwraca informacje o etapie, drużynach oraz dane potrzebne do edycji wyniku,
    w tym dogrywkę i karne.
    """

    home_team_id = serializers.IntegerField(source="home_team.id", read_only=True)
    away_team_id = serializers.IntegerField(source="away_team.id", read_only=True)

    home_team_name = serializers.CharField(source="home_team.name", read_only=True)
    away_team_name = serializers.CharField(source="away_team.name", read_only=True)

    stage_type = serializers.CharField(source="stage.stage_type", read_only=True)
    stage_id = serializers.IntegerField(source="stage.id", read_only=True)
    stage_order = serializers.IntegerField(source="stage.order", read_only=True)

    group_name = serializers.CharField(source="group.name", read_only=True, allow_null=True)

    winner_id = serializers.IntegerField(source="winner.id", read_only=True, allow_null=True)

    is_technical = serializers.SerializerMethodField()

    class Meta:
        model = Match
        fields = (
            "id",
            "stage_id",
            "stage_order",
            "stage_type",
            "group_name",
            "round_number",
            "home_team_id",
            "away_team_id",
            "home_team_name",
            "away_team_name",
            "home_score",
            "away_score",
            "went_to_extra_time",
            "home_extra_time_score",
            "away_extra_time_score",
            "decided_by_penalties",
            "home_penalty_score",
            "away_penalty_score",
            "result_entered",
            "winner_id",
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


class MatchScheduleUpdateSerializer(serializers.ModelSerializer):
    """
    PATCH /api/matches/:id/
    """
    class Meta:
        model = Match
        fields = ("scheduled_date", "scheduled_time", "location")


class MatchResultUpdateSerializer(serializers.ModelSerializer):
    """
    PATCH /api/matches/:id/result/

    Cel: tylko zapis pól wyniku (w tym dogrywka/karne), bez kończenia meczu.
    Status FINISHED ustawiamy wyłącznie w POST /finish/.
    """

    home_score = serializers.IntegerField(required=False, allow_null=False, min_value=0)
    away_score = serializers.IntegerField(required=False, allow_null=False, min_value=0)

    went_to_extra_time = serializers.BooleanField(required=False)
    home_extra_time_score = serializers.IntegerField(required=False, allow_null=True, min_value=0)
    away_extra_time_score = serializers.IntegerField(required=False, allow_null=True, min_value=0)

    decided_by_penalties = serializers.BooleanField(required=False)
    home_penalty_score = serializers.IntegerField(required=False, allow_null=True, min_value=0)
    away_penalty_score = serializers.IntegerField(required=False, allow_null=True, min_value=0)

    status = serializers.CharField(read_only=True)

    class Meta:
        model = Match
        fields = (
            "home_score",
            "away_score",
            "went_to_extra_time",
            "home_extra_time_score",
            "away_extra_time_score",
            "decided_by_penalties",
            "home_penalty_score",
            "away_penalty_score",
            "status",
        )

    def update(self, instance: Match, validated_data):
        stage_type = getattr(instance.stage, "stage_type", None)
        tournament: Tournament = instance.tournament
        discipline = (getattr(tournament, "discipline", "") or "").lower()
        cfg = tournament.format_config or {}

        touched_keys = {
            "home_score", "away_score",
            "went_to_extra_time", "home_extra_time_score", "away_extra_time_score",
            "decided_by_penalties", "home_penalty_score", "away_penalty_score",
        }
        if any(k in validated_data for k in touched_keys):
            instance.result_entered = True

        # 1) Set values (only provided)
        for k, v in validated_data.items():
            setattr(instance, k, v)

        # 2) Checkbox normalization (hard cleanup)
        if not instance.went_to_extra_time:
            instance.home_extra_time_score = None
            instance.away_extra_time_score = None

        if not instance.decided_by_penalties:
            instance.home_penalty_score = None
            instance.away_penalty_score = None

        # 3) Domain constraints (soft cleanup on PATCH)
        knockout_like = _is_knockout_like(stage_type)

        # non-handball: ET/pen only in KO-like
        if discipline != "handball" and not knockout_like:
            instance.went_to_extra_time = False
            instance.home_extra_time_score = None
            instance.away_extra_time_score = None
            instance.decided_by_penalties = False
            instance.home_penalty_score = None
            instance.away_penalty_score = None

        # handball KO: config may forbid overtime
        if discipline == "handball" and knockout_like:
            tiebreak = (cfg.get("handball_knockout_tiebreak") or "OVERTIME_PENALTIES").upper()
            if tiebreak == "PENALTIES":
                instance.went_to_extra_time = False
                instance.home_extra_time_score = None
                instance.away_extra_time_score = None

        # handball league/group: tie-break only makes sense on draw
        if discipline == "handball" and str(stage_type) in (str(Stage.StageType.LEAGUE), str(Stage.StageType.GROUP)):
            if instance.home_score != instance.away_score:
                instance.went_to_extra_time = False
                instance.home_extra_time_score = None
                instance.away_extra_time_score = None
                instance.decided_by_penalties = False
                instance.home_penalty_score = None
                instance.away_penalty_score = None
            else:
                draw_mode = (cfg.get("handball_table_draw_mode") or "ALLOW_DRAW").upper()
                if draw_mode == "ALLOW_DRAW":
                    instance.went_to_extra_time = False
                    instance.home_extra_time_score = None
                    instance.away_extra_time_score = None
                    instance.decided_by_penalties = False
                    instance.home_penalty_score = None
                    instance.away_penalty_score = None
                elif draw_mode == "PENALTIES":
                    instance.went_to_extra_time = False
                    instance.home_extra_time_score = None
                    instance.away_extra_time_score = None

        instance.save()
        return instance
