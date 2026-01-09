from rest_framework import serializers
from tournaments.models import Match, Stage, Tournament

BYE_TEAM_NAME = "__SYSTEM_BYE__"


class MatchSerializer(serializers.ModelSerializer):
    """
    Serializer do listy meczów (UI).
    Zwraca informacje o etapie, drużynach oraz dane potrzebne do edycji wyniku,
    w tym dogrywkę i karne.
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

    # ===== Grupa =====
    group_name = serializers.CharField(source="group.name", read_only=True, allow_null=True)

    # ===== Winner (dla KO) =====
    winner_id = serializers.IntegerField(source="winner.id", read_only=True, allow_null=True)

    # ===== Mecz techniczny (BYE) =====
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

            # dogrywka
            "went_to_extra_time",
            "home_extra_time_score",
            "away_extra_time_score",

            # karne
            "decided_by_penalties",
            "home_penalty_score",
            "away_penalty_score",

            # meta
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
        fields = (
            "scheduled_date",
            "scheduled_time",
            "location",
        )


class MatchResultUpdateSerializer(serializers.ModelSerializer):
    """
    PATCH /api/matches/:id/result/

    Cel: tylko zapis pól wyniku (w tym dogrywka/karne), bez kończenia meczu.
    Status FINISHED ustawiamy wyłącznie w POST /finish/.
    """

    home_score = serializers.IntegerField(required=False, min_value=0)
    away_score = serializers.IntegerField(required=False, min_value=0)

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
        # Kontekst (w widoku masz select_related("stage","tournament"), więc to jest tanie)
        stage_type = getattr(instance.stage, "stage_type", None)
        tournament: Tournament = instance.tournament
        discipline = (getattr(tournament, "discipline", "") or "").lower()
        cfg = tournament.format_config or {}

        # Flaga "użytkownik faktycznie edytował wynik"
        touched_keys = {
            "home_score", "away_score",
            "went_to_extra_time", "home_extra_time_score", "away_extra_time_score",
            "decided_by_penalties", "home_penalty_score", "away_penalty_score",
        }
        if any(k in validated_data for k in touched_keys) and not instance.result_entered:
            instance.result_entered = True

        # 1) Aktualizuj pola podstawowe
        if "home_score" in validated_data:
            instance.home_score = validated_data["home_score"]
        if "away_score" in validated_data:
            instance.away_score = validated_data["away_score"]

        # 2) Dogrywka
        if "went_to_extra_time" in validated_data:
            instance.went_to_extra_time = bool(validated_data["went_to_extra_time"])

        if "home_extra_time_score" in validated_data:
            instance.home_extra_time_score = validated_data["home_extra_time_score"]
        if "away_extra_time_score" in validated_data:
            instance.away_extra_time_score = validated_data["away_extra_time_score"]

        # 3) Karne
        if "decided_by_penalties" in validated_data:
            instance.decided_by_penalties = bool(validated_data["decided_by_penalties"])

        if "home_penalty_score" in validated_data:
            instance.home_penalty_score = validated_data["home_penalty_score"]
        if "away_penalty_score" in validated_data:
            instance.away_penalty_score = validated_data["away_penalty_score"]

        # 4) Normalizacja – żeby nie trzymać śmieci:
        #    - jeśli checkbox wyłączony → wyczyść wartości
        if not instance.went_to_extra_time:
            instance.home_extra_time_score = None
            instance.away_extra_time_score = None

        if not instance.decided_by_penalties:
            instance.home_penalty_score = None
            instance.away_penalty_score = None

        # 5) Ograniczenia domenowe (miękko na PATCH – nie walimy 400, tylko czyścimy pola)
        is_knockout_like = stage_type in (Stage.StageType.KNOCKOUT, Stage.StageType.THIRD_PLACE)

        # - dla nie-handballa: dogrywka/karne tylko w KO-like
        if discipline != "handball" and not is_knockout_like:
            instance.went_to_extra_time = False
            instance.home_extra_time_score = None
            instance.away_extra_time_score = None
            instance.decided_by_penalties = False
            instance.home_penalty_score = None
            instance.away_penalty_score = None

        # - dla handballa: tryb KO może zabraniać dogrywki
        if discipline == "handball" and is_knockout_like:
            tiebreak = (cfg.get("handball_knockout_tiebreak") or "OVERTIME_PENALTIES").upper()
            if tiebreak == "PENALTIES":
                instance.went_to_extra_time = False
                instance.home_extra_time_score = None
                instance.away_extra_time_score = None

        # - dla handballa: liga/grupa może zabraniać rozstrzygnięć
        if discipline == "handball" and stage_type in (Stage.StageType.LEAGUE, Stage.StageType.GROUP):
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
            # OVERTIME_PENALTIES – zostawiamy możliwość dogrywki i karnych

        instance.save()
        return instance
