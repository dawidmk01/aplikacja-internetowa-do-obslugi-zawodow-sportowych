# backend/tournaments/serializers/incidents.py
# Plik definiuje serializery odpowiedzialne za odczyt i zapis incydentów meczowych z walidacją spójności dywizji.

from __future__ import annotations

from typing import Any, Dict, Optional

from rest_framework import serializers

from tournaments.models import Match, MatchIncident, Team, TeamPlayer, Tournament


def _allowed_kinds_for_discipline(discipline: str) -> set[str]:
    k = MatchIncident.Kind

    if discipline == Tournament.Discipline.FOOTBALL:
        return {
            k.GOAL,
            k.YELLOW_CARD,
            k.RED_CARD,
            k.FOUL,
            k.SUBSTITUTION,
            k.TIMEOUT,
        }

    if discipline == Tournament.Discipline.HANDBALL:
        return {
            k.GOAL,
            k.FOUL,
            k.SUBSTITUTION,
            k.HANDBALL_TWO_MINUTES,
            k.TIMEOUT,
        }

    if discipline == Tournament.Discipline.TENNIS:
        return {
            k.TENNIS_POINT,
            k.TENNIS_CODE_VIOLATION,
            k.TIMEOUT,
        }

    if discipline == Tournament.Discipline.VOLLEYBALL:
        return {
            k.SUBSTITUTION,
            k.TIMEOUT,
        }

    if discipline == Tournament.Discipline.BASKETBALL:
        return {
            k.GOAL,
            k.FOUL,
            k.TIMEOUT,
            k.SUBSTITUTION,
        }

    if discipline == Tournament.Discipline.WRESTLING:
        return {
            k.WRESTLING_POINT_1,
            k.WRESTLING_POINT_2,
            k.WRESTLING_POINT_4,
            k.WRESTLING_POINT_5,
            k.WRESTLING_PASSIVITY,
            k.WRESTLING_CAUTION,
            k.WRESTLING_FALL,
            k.WRESTLING_INJURY,
            k.WRESTLING_FORFEIT,
            k.WRESTLING_DISQUALIFICATION,
            k.TIMEOUT,
        }

    return {
        k.GOAL,
        k.FOUL,
        k.TIMEOUT,
    }


def _parse_minute_raw(minute_raw: str) -> Optional[int]:
    s = (minute_raw or "").strip()
    if not s:
        return None
    if s.isdigit():
        return int(s)
    if "+" in s:
        left, right = s.split("+", 1)
        left = left.strip()
        right = right.strip()
        if left.isdigit() and right.isdigit():
            return int(left) + int(right)
    return None


def _validate_goal_meta_for_discipline(discipline: str, meta: dict) -> None:
    if discipline != Tournament.Discipline.BASKETBALL:
        return

    raw_points = meta.get("points", 1)
    try:
        points = int(raw_points or 1)
    except (TypeError, ValueError) as exc:
        raise serializers.ValidationError(
            {"meta": "Dla koszykówki meta.points musi być liczbą 1, 2 albo 3."}
        ) from exc

    if points not in (1, 2, 3):
        raise serializers.ValidationError(
            {"meta": "Dla koszykówki meta.points musi być równe 1, 2 albo 3."}
        )


def _validate_clock_mode_available(match: Match) -> None:
    if (
        match.clock_state == Match.ClockState.NOT_STARTED
        and int(match.clock_elapsed_seconds or 0) == 0
    ):
        raise serializers.ValidationError(
            {
                "time_source": (
                    "Zegar meczu nie jest uruchomiony - uruchom zegar albo wybierz tryb MANUAL."
                )
            }
        )


class MatchIncidentSerializer(serializers.ModelSerializer):
    team_name = serializers.CharField(source="team.name", read_only=True)
    division_id = serializers.IntegerField(source="match.stage.division.id", read_only=True, allow_null=True)
    division_name = serializers.CharField(source="match.stage.division.name", read_only=True, allow_null=True)
    player_name = serializers.SerializerMethodField()
    player_in_name = serializers.SerializerMethodField()
    player_out_name = serializers.SerializerMethodField()

    class Meta:
        model = MatchIncident
        fields = [
            "id",
            "match",
            "team",
            "team_name",
            "division_id",
            "division_name",
            "kind",
            "period",
            "time_source",
            "minute",
            "minute_raw",
            "player",
            "player_name",
            "player_in",
            "player_in_name",
            "player_out",
            "player_out_name",
            "meta",
            "created_by",
            "created_at",
        ]
        read_only_fields = ["id", "created_by", "created_at", "match", "division_id", "division_name"]

    def get_player_name(self, obj: MatchIncident) -> Optional[str]:
        return obj.player.display_name if obj.player_id else None

    def get_player_in_name(self, obj: MatchIncident) -> Optional[str]:
        return obj.player_in.display_name if obj.player_in_id else None

    def get_player_out_name(self, obj: MatchIncident) -> Optional[str]:
        return obj.player_out.display_name if obj.player_out_id else None


class MatchIncidentCreateSerializer(serializers.Serializer):
    team = serializers.IntegerField()
    kind = serializers.ChoiceField(choices=MatchIncident.Kind.choices)
    time_source = serializers.ChoiceField(
        choices=MatchIncident.TimeSource.choices,
        required=False,
    )
    minute = serializers.IntegerField(required=False, allow_null=True)
    minute_raw = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    player = serializers.IntegerField(required=False, allow_null=True)
    player_in = serializers.IntegerField(required=False, allow_null=True)
    player_out = serializers.IntegerField(required=False, allow_null=True)
    meta = serializers.JSONField(required=False)

    def validate(self, attrs: Dict[str, Any]) -> Dict[str, Any]:
        match: Match = self.context["match"]
        discipline = match.tournament.discipline
        match_division_id = getattr(match.stage, "division_id", None)

        team_id = int(attrs["team"])
        kind = attrs["kind"]

        if team_id not in (match.home_team_id, match.away_team_id):
            raise serializers.ValidationError(
                {"team": "Wybrana drużyna nie należy do tego meczu."}
            )

        allowed = _allowed_kinds_for_discipline(discipline)
        if kind not in allowed:
            raise serializers.ValidationError(
                {
                    "kind": (
                        "Ten typ incydentu nie jest dostępny dla dyscypliny: "
                        f"{discipline}."
                    )
                }
            )

        time_source = attrs.get("time_source") or MatchIncident.TimeSource.CLOCK
        attrs["time_source"] = time_source

        player_id = attrs.get("player")
        player_in_id = attrs.get("player_in")
        player_out_id = attrs.get("player_out")

        if kind == MatchIncident.Kind.SUBSTITUTION:
            if not player_in_id or not player_out_id:
                raise serializers.ValidationError(
                    "Zmiana wymaga wskazania player_in oraz player_out."
                )
            if player_id:
                raise serializers.ValidationError(
                    "Dla zmiany nie ustawiaj pola player (użyj player_in/player_out)."
                )
        else:
            if player_in_id or player_out_id:
                raise serializers.ValidationError(
                    "Pola player_in/player_out są dozwolone tylko dla typu SUBSTITUTION."
                )

        kinds_requiring_player = {
            MatchIncident.Kind.YELLOW_CARD,
            MatchIncident.Kind.RED_CARD,
            MatchIncident.Kind.FOUL,
            MatchIncident.Kind.HANDBALL_TWO_MINUTES,
            MatchIncident.Kind.TENNIS_CODE_VIOLATION,
        }
        if kind in kinds_requiring_player and not player_id:
            raise serializers.ValidationError(
                {"player": "Ten typ incydentu wymaga wskazania zawodnika."}
            )

        try:
            team = Team.objects.select_related("division").get(pk=team_id)
        except Team.DoesNotExist as exc:
            raise serializers.ValidationError({"team": "Nie znaleziono drużyny."}) from exc

        if team.tournament_id != match.tournament_id:
            raise serializers.ValidationError({"team": "Wybrana drużyna nie należy do tego turnieju."})

        if match_division_id is not None and team.division_id != match_division_id:
            raise serializers.ValidationError({"team": "Wybrana drużyna nie należy do dywizji tego meczu."})

        def _ensure_player(pid: Optional[int], field: str) -> Optional[TeamPlayer]:
            if not pid:
                return None
            try:
                player = TeamPlayer.objects.get(pk=int(pid))
            except TeamPlayer.DoesNotExist as exc:
                raise serializers.ValidationError(
                    {field: "Nie znaleziono zawodnika."}
                ) from exc
            if player.team_id != team.id:
                raise serializers.ValidationError(
                    {field: "Zawodnik nie należy do wskazanej drużyny."}
                )
            return player

        _ensure_player(player_id, "player")
        _ensure_player(player_in_id, "player_in")
        _ensure_player(player_out_id, "player_out")

        if time_source == MatchIncident.TimeSource.CLOCK:
            _validate_clock_mode_available(match)
            attrs["period"] = match.clock_period or Match.ClockPeriod.NONE
            attrs["minute"] = match.clock_minute_total()
            attrs["minute_raw"] = str(attrs["minute"])
        else:
            minute = attrs.get("minute")
            minute_raw = (
                (attrs.get("minute_raw") or "").strip()
                if attrs.get("minute_raw") is not None
                else ""
            )

            if minute is None and not minute_raw:
                attrs["minute"] = None
                attrs["minute_raw"] = None
            else:
                if minute is None and minute_raw:
                    attrs["minute"] = _parse_minute_raw(minute_raw)
                if minute is not None and minute < 0:
                    raise serializers.ValidationError(
                        {"minute": "Minuta nie może być ujemna."}
                    )
                attrs["minute_raw"] = minute_raw or (
                    str(minute) if minute is not None else None
                )

            attrs["period"] = match.clock_period or Match.ClockPeriod.NONE

        if "meta" not in attrs or attrs["meta"] is None:
            attrs["meta"] = {}

        if not isinstance(attrs["meta"], dict):
            raise serializers.ValidationError({"meta": "meta musi być obiektem JSON."})

        if kind == MatchIncident.Kind.GOAL:
            _validate_goal_meta_for_discipline(discipline, attrs["meta"])

        return attrs

    def create(self, validated_data: Dict[str, Any]) -> MatchIncident:
        match: Match = self.context["match"]
        user = self.context["request"].user

        return MatchIncident.objects.create(
            match=match,
            team_id=int(validated_data["team"]),
            kind=validated_data["kind"],
            period=validated_data["period"],
            time_source=validated_data["time_source"],
            minute=validated_data.get("minute"),
            minute_raw=validated_data.get("minute_raw"),
            player_id=validated_data.get("player"),
            player_in_id=validated_data.get("player_in"),
            player_out_id=validated_data.get("player_out"),
            meta=validated_data.get("meta") or {},
            created_by=user if user and user.is_authenticated else None,
        )
