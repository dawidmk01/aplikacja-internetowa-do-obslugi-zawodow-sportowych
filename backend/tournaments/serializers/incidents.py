# backend/tournaments/serializers/incidents.py

from __future__ import annotations

from typing import Any, Dict, Optional

from rest_framework import serializers

from tournaments.models import Match, MatchIncident, Team, TeamPlayer, Tournament


# =========================
# Allowed kinds per discipline
# =========================

def _allowed_kinds_for_discipline(discipline: str) -> set[str]:
    """
    Minimalny, bezpieczny zestaw na start.
    Rozszerzysz później, ale już teraz jest spójnie dla piłki/ręcznej/tenisa.
    """
    k = MatchIncident.Kind
    if discipline == Tournament.Discipline.FOOTBALL:
        return {
            k.GOAL,
            k.YELLOW_CARD,
            k.RED_CARD,
            k.FOUL,
            k.SUBSTITUTION,
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
        # punkty w gemach nie idą jako incydenty (osobny mechanizm),
        # tu trzymamy tylko timeline zdarzeń “organizacyjnych/dyscyplinarnych”
        return {
            k.TENNIS_CODE_VIOLATION,
            k.TIMEOUT,
        }
    if discipline == Tournament.Discipline.VOLLEYBALL:
        return {
            k.SUBSTITUTION,
            k.TIMEOUT,
        }
    if discipline == Tournament.Discipline.BASKETBALL:
        # scoring w koszu zwykle wymaga 1/2/3 pkt – zostawiamy na później
        return {
            k.FOUL,
            k.SUBSTITUTION,
            k.TIMEOUT,
        }
    if discipline == Tournament.Discipline.WRESTLING:
        return {
            k.TIMEOUT,
        }
    # fallback: pozwól tylko na timeout, żeby nie blokować całkiem
    return {k.TIMEOUT}


def _parse_minute_raw(minute_raw: str) -> Optional[int]:
    """
    Parsuje zapisy typu:
    - "73" -> 73
    - "90+3" -> 93
    Gdy nie da się sparsować -> None
    """
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


# =========================
# Output serializer
# =========================

class MatchIncidentSerializer(serializers.ModelSerializer):
    team_name = serializers.CharField(source="team.name", read_only=True)

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
        read_only_fields = ["id", "created_by", "created_at", "match"]

    def get_player_name(self, obj: MatchIncident) -> Optional[str]:
        return obj.player.display_name if obj.player_id else None

    def get_player_in_name(self, obj: MatchIncident) -> Optional[str]:
        return obj.player_in.display_name if obj.player_in_id else None

    def get_player_out_name(self, obj: MatchIncident) -> Optional[str]:
        return obj.player_out.display_name if obj.player_out_id else None


# =========================
# Create serializer
# =========================

class MatchIncidentCreateSerializer(serializers.Serializer):
    """
    Wejście do POST /matches/<match_id>/incidents/

    Zasady:
    - team musi być home/away z meczu
    - kind musi być dozwolony dla dyscypliny
    - SUBSTITUTION wymaga player_in + player_out
    - kary/kartki zwykle wymagają player
    - time_source:
        * CLOCK: minute wyliczamy z zegara
        * MANUAL: minute/minute_raw mogą przyjść z payloadu
    """

    team = serializers.IntegerField()
    kind = serializers.ChoiceField(choices=MatchIncident.Kind.choices)

    # czas
    time_source = serializers.ChoiceField(choices=MatchIncident.TimeSource.choices, required=False)
    minute = serializers.IntegerField(required=False, allow_null=True)
    minute_raw = serializers.CharField(required=False, allow_blank=True, allow_null=True)

    # gracze
    player = serializers.IntegerField(required=False, allow_null=True)
    player_in = serializers.IntegerField(required=False, allow_null=True)
    player_out = serializers.IntegerField(required=False, allow_null=True)

    meta = serializers.JSONField(required=False)

    def validate(self, attrs: Dict[str, Any]) -> Dict[str, Any]:
        match: Match = self.context["match"]
        discipline = match.tournament.discipline

        team_id = int(attrs["team"])
        kind = attrs["kind"]

        # team in match
        if team_id not in (match.home_team_id, match.away_team_id):
            raise serializers.ValidationError({"team": "Wybrana drużyna nie należy do tego meczu."})

        # kind allowed
        allowed = _allowed_kinds_for_discipline(discipline)
        if kind not in allowed:
            raise serializers.ValidationError({"kind": f"Ten typ incydentu nie jest dostępny dla dyscypliny: {discipline}."})

        # normalize time_source
        time_source = attrs.get("time_source") or MatchIncident.TimeSource.CLOCK
        attrs["time_source"] = time_source

        # players
        player_id = attrs.get("player")
        player_in_id = attrs.get("player_in")
        player_out_id = attrs.get("player_out")

        # SUBSTITUTION rules
        if kind == MatchIncident.Kind.SUBSTITUTION:
            if not player_in_id or not player_out_id:
                raise serializers.ValidationError("Zmiana wymaga wskazania player_in oraz player_out.")
            if player_id:
                raise serializers.ValidationError("Dla zmiany nie ustawiaj pola player (użyj player_in/player_out).")
        else:
            if player_in_id or player_out_id:
                raise serializers.ValidationError("Pola player_in/player_out są dozwolone tylko dla typu SUBSTITUTION.")

        # player required for some kinds
        kinds_requiring_player = {
            MatchIncident.Kind.YELLOW_CARD,
            MatchIncident.Kind.RED_CARD,
            MatchIncident.Kind.FOUL,
            MatchIncident.Kind.HANDBALL_TWO_MINUTES,
            MatchIncident.Kind.TENNIS_CODE_VIOLATION,
        }
        if kind in kinds_requiring_player and not player_id:
            raise serializers.ValidationError({"player": "Ten typ incydentu wymaga wskazania zawodnika."})

        # validate player ownership (if present)
        team = Team.objects.get(pk=team_id)

        def _ensure_player(pid: Optional[int], field: str) -> Optional[TeamPlayer]:
            if not pid:
                return None
            try:
                p = TeamPlayer.objects.get(pk=int(pid))
            except TeamPlayer.DoesNotExist:
                raise serializers.ValidationError({field: "Nie znaleziono zawodnika."})
            if p.team_id != team.id:
                raise serializers.ValidationError({field: "Zawodnik nie należy do wskazanej drużyny."})
            return p

        _ensure_player(player_id, "player")
        _ensure_player(player_in_id, "player_in")
        _ensure_player(player_out_id, "player_out")

        # time logic
        if time_source == MatchIncident.TimeSource.CLOCK:
            # minute liczymy z zegara
            attrs["period"] = match.clock_period
            attrs["minute"] = match.clock_minute_total()
            attrs["minute_raw"] = str(attrs["minute"])
        else:
            # MANUAL: bierz minute/minute_raw z payloadu (jedno z nich)
            minute = attrs.get("minute")
            minute_raw = (attrs.get("minute_raw") or "").strip() if attrs.get("minute_raw") is not None else ""

            if minute is None and not minute_raw:
                # manual bez czasu -> dopuszczamy tylko dla sportów bez zegara / zdarzeń organizacyjnych
                attrs["minute"] = None
                attrs["minute_raw"] = None
            else:
                if minute is None and minute_raw:
                    parsed = _parse_minute_raw(minute_raw)
                    attrs["minute"] = parsed
                if minute is not None and minute < 0:
                    raise serializers.ValidationError({"minute": "Minuta nie może być ujemna."})
                attrs["minute_raw"] = minute_raw or (str(minute) if minute is not None else None)

            # period: jeśli klient nie poda, weź aktualny z match
            attrs["period"] = match.clock_period or Match.ClockPeriod.NONE

        # meta default
        if "meta" not in attrs or attrs["meta"] is None:
            attrs["meta"] = {}

        return attrs

    def create(self, validated_data: Dict[str, Any]) -> MatchIncident:
        match: Match = self.context["match"]
        user = self.context["request"].user

        incident = MatchIncident.objects.create(
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
        return incident
