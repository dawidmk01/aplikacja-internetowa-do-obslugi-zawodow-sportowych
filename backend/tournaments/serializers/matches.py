# backend/tournaments/serializers/matches.py
# Plik definiuje serializery odpowiedzialne za odczyt i zapis wyników oraz terminów meczów w kontekście dywizji meczu.

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any, Dict, Tuple

from rest_framework import serializers

from tournaments.models import Match, MatchCustomResult, Stage, Tournament

BYE_TEAM_NAME = "__SYSTEM_BYE__"


def _third_place_value() -> str:
    return getattr(Stage.StageType, "THIRD_PLACE", "THIRD_PLACE")


def _is_knockout_like(stage_type: str | None) -> bool:
    return str(stage_type) in (str(Stage.StageType.KNOCKOUT), str(_third_place_value()))


def _match_division(match: Match):
    return getattr(getattr(match, "stage", None), "division", None)


def _competition_context_for_match(match: Match) -> dict:
    division = _match_division(match)
    tournament = match.tournament

    if division is None:
        result_mode = getattr(tournament, "result_mode", Tournament.ResultMode.SCORE)
        result_config = (
            tournament.get_result_config()
            if result_mode == Tournament.ResultMode.CUSTOM
            else {}
        )
        return {
            "result_mode": result_mode,
            "competition_model": getattr(
                tournament,
                "competition_model",
                Tournament.CompetitionModel.HEAD_TO_HEAD,
            ),
            "format_config": dict(getattr(tournament, "format_config", {}) or {}),
            "result_config": dict(result_config or {}),
        }

    result_mode = getattr(division, "result_mode", Tournament.ResultMode.SCORE)
    result_config = division.get_result_config() if result_mode == Tournament.ResultMode.CUSTOM else {}
    return {
        "result_mode": result_mode,
        "competition_model": getattr(
            division,
            "competition_model",
            Tournament.CompetitionModel.HEAD_TO_HEAD,
        ),
        "format_config": dict(getattr(division, "format_config", {}) or {}),
        "result_config": dict(result_config or {}),
    }


def _tennis_target_sets(cfg: dict) -> int:
    best_of = int(cfg.get("tennis_best_of") or 3)
    if best_of not in (3, 5):
        raise serializers.ValidationError(
            {"tennis_best_of": "Dozwolone wartości to 3 albo 5."}
        )
    return best_of // 2 + 1


def _parse_int(v: Any, *, field: str) -> int:
    try:
        iv = int(v)
    except (TypeError, ValueError) as exc:
        raise serializers.ValidationError(
            {field: "Wartość musi być liczbą całkowitą."}
        ) from exc

    if iv < 0:
        raise serializers.ValidationError({field: "Wartość nie może być ujemna."})

    return iv


def _validate_tennis_tiebreak(tb_winner: int, tb_loser: int) -> None:
    if tb_winner < 7:
        raise serializers.ValidationError(
            {"tennis_sets": "Tie-break: zwycięzca musi mieć co najmniej 7 punktów."}
        )

    if tb_winner - tb_loser < 2:
        raise serializers.ValidationError(
            {"tennis_sets": "Tie-break: wymagana przewaga co najmniej 2 punktów."}
        )


def _validate_single_tennis_set(
    set_obj: Dict[str, Any],
    *,
    set_index: int,
) -> Tuple[int, int]:
    if not isinstance(set_obj, dict):
        raise serializers.ValidationError(
            {"tennis_sets": f"Set #{set_index}: musi być obiektem JSON."}
        )

    hg = _parse_int(set_obj.get("home_games"), field="tennis_sets")
    ag = _parse_int(set_obj.get("away_games"), field="tennis_sets")

    if hg == ag:
        raise serializers.ValidationError(
            {"tennis_sets": f"Set #{set_index}: remis w gemach jest niedozwolony."}
        )

    winner_games = max(hg, ag)
    loser_games = min(hg, ag)

    if winner_games == 6:
        if loser_games > 4:
            raise serializers.ValidationError(
                {"tennis_sets": f"Set #{set_index}: wynik 6:{loser_games} jest niedozwolony."}
            )

        if (set_obj.get("home_tiebreak") is not None) or (
            set_obj.get("away_tiebreak") is not None
        ):
            raise serializers.ValidationError(
                {"tennis_sets": f"Set #{set_index}: tie-break dozwolony tylko przy 7:6."}
            )

        return hg, ag

    if winner_games == 7:
        if loser_games not in (5, 6):
            raise serializers.ValidationError(
                {"tennis_sets": f"Set #{set_index}: wynik 7:{loser_games} jest niedozwolony."}
            )

        if loser_games == 5:
            if (set_obj.get("home_tiebreak") is not None) or (
                set_obj.get("away_tiebreak") is not None
            ):
                raise serializers.ValidationError(
                    {"tennis_sets": f"Set #{set_index}: tie-break dozwolony tylko przy 7:6."}
                )
            return hg, ag

        ht = set_obj.get("home_tiebreak")
        at = set_obj.get("away_tiebreak")
        if ht is None or at is None:
            raise serializers.ValidationError(
                {
                    "tennis_sets": (
                        f"Set #{set_index}: przy 7:6 wymagany jest tie-break "
                        "(home_tiebreak/away_tiebreak)."
                    )
                }
            )

        ht_i = _parse_int(ht, field="tennis_sets")
        at_i = _parse_int(at, field="tennis_sets")

        if hg > ag:
            _validate_tennis_tiebreak(ht_i, at_i)
        else:
            _validate_tennis_tiebreak(at_i, ht_i)

        return hg, ag

    raise serializers.ValidationError(
        {
            "tennis_sets": (
                f"Set #{set_index}: wynik {hg}:{ag} jest niedozwolony "
                "(zwycięzca musi mieć 6 lub 7 gemów)."
            )
        }
    )


def _validate_tennis_sets_and_compute_score_for_save(
    tennis_sets: Any,
    *,
    cfg: dict,
) -> Tuple[int, int, bool]:
    if tennis_sets is None:
        raise serializers.ValidationError(
            {"tennis_sets": "Dla tenisa wymagane jest pole tennis_sets (lista setów w gemach)."}
        )

    if not isinstance(tennis_sets, list):
        raise serializers.ValidationError({"tennis_sets": "tennis_sets musi być listą setów."})

    target_sets = _tennis_target_sets(cfg)
    best_of = target_sets * 2 - 1

    if len(tennis_sets) == 0:
        raise serializers.ValidationError({"tennis_sets": "Podaj co najmniej jeden set."})

    if len(tennis_sets) > best_of:
        raise serializers.ValidationError(
            {"tennis_sets": f"Maksymalna liczba setów dla best-of-{best_of} to {best_of}."}
        )

    home_sets = 0
    away_sets = 0
    decided = False

    for idx, set_obj in enumerate(tennis_sets, start=1):
        hg, ag = _validate_single_tennis_set(set_obj, set_index=idx)
        if hg > ag:
            home_sets += 1
        else:
            away_sets += 1

        if home_sets == target_sets or away_sets == target_sets:
            decided = True
            if idx != len(tennis_sets):
                raise serializers.ValidationError(
                    {"tennis_sets": "Po osiągnięciu zwycięstwa w meczu nie można dodawać kolejnych setów."}
                )

    if not decided:
        raise serializers.ValidationError(
            {"tennis_sets": f"Mecz nie jest rozstrzygnięty. Wymagane: {target_sets} wygrane sety."}
        )

    return home_sets, away_sets, decided


def _format_decimal_for_display(value: Decimal, decimal_places: int) -> str:
    quantized = MatchCustomResult._quantize_numeric(value, decimal_places)
    return f"{quantized:.{decimal_places}f}" if decimal_places > 0 else str(int(quantized))


def _format_time_ms_for_display(time_ms: int, time_format: str | None) -> str:
    total_ms = int(time_ms)
    total_seconds, ms = divmod(total_ms, 1000)
    minutes, seconds = divmod(total_seconds, 60)
    hours, minutes = divmod(minutes, 60)
    hundredths = ms // 10

    if time_format == Tournament.RESULTCFG_TIME_FORMAT_HH_MM_SS:
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"

    if time_format == Tournament.RESULTCFG_TIME_FORMAT_MM_SS:
        total_minutes = total_seconds // 60
        return f"{total_minutes:02d}:{seconds:02d}"

    if time_format == Tournament.RESULTCFG_TIME_FORMAT_MM_SS_HH:
        total_minutes = total_seconds // 60
        return f"{total_minutes:02d}:{seconds:02d}.{hundredths:02d}"

    if time_format == Tournament.RESULTCFG_TIME_FORMAT_SS_HH:
        return f"{total_seconds}.{hundredths:02d}"

    total_minutes = total_seconds // 60
    return f"{total_minutes:02d}:{seconds:02d}.{hundredths:02d}"


def _parse_numeric_value(raw_value: Any) -> Decimal:
    try:
        return Decimal(str(raw_value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise serializers.ValidationError(
            {"numeric_value": "Wartość musi być poprawną liczbą."}
        ) from exc


def _parse_time_ms(raw_value: Any) -> int:
    try:
        parsed = int(raw_value)
    except (TypeError, ValueError) as exc:
        raise serializers.ValidationError(
            {"time_ms": "Wartość musi być liczbą całkowitą w milisekundach."}
        ) from exc

    if parsed < 0:
        raise serializers.ValidationError(
            {"time_ms": "Wartość nie może być ujemna."}
        )

    return parsed


def _parse_place_value(raw_value: Any) -> int:
    try:
        parsed = int(raw_value)
    except (TypeError, ValueError) as exc:
        raise serializers.ValidationError(
            {"place_value": "Wartość musi być liczbą całkowitą."}
        ) from exc

    if parsed < 1:
        raise serializers.ValidationError(
            {"place_value": "Wartość musi być większa lub równa 1."}
        )

    return parsed


def _custom_mode(cfg: dict) -> str | None:
    return str(cfg.get(Tournament.RESULTCFG_CUSTOM_MODE_KEY) or "").upper() or None


def _match_uses_custom_result_rows(match: Match) -> bool:
    context = _competition_context_for_match(match)

    if context["result_mode"] != Tournament.ResultMode.CUSTOM:
        return False

    if context["competition_model"] != Tournament.CompetitionModel.HEAD_TO_HEAD:
        return False

    cfg = context["result_config"]
    custom_mode = _custom_mode(cfg)
    value_kind = cfg.get(Tournament.RESULTCFG_VALUE_KIND_KEY)

    return (
        custom_mode != Tournament.RESULTCFG_CUSTOM_MODE_HEAD_TO_HEAD_POINTS
        and value_kind in (
            Tournament.RESULTCFG_VALUE_KIND_NUMBER,
            Tournament.RESULTCFG_VALUE_KIND_TIME,
            Tournament.RESULTCFG_VALUE_KIND_PLACE,
        )
    )


def _match_uses_custom_points_table(match: Match) -> bool:
    context = _competition_context_for_match(match)

    if context["result_mode"] != Tournament.ResultMode.CUSTOM:
        return False

    if context["competition_model"] != Tournament.CompetitionModel.HEAD_TO_HEAD:
        return False

    return _custom_mode(context["result_config"]) == Tournament.RESULTCFG_CUSTOM_MODE_HEAD_TO_HEAD_POINTS


def _resolution_mode_for_match(match: Match) -> str:
    cfg = _competition_context_for_match(match)["result_config"]
    stage_type = getattr(match.stage, "stage_type", None)

    allow_draw = bool(cfg.get(Tournament.RESULTCFG_ALLOW_DRAW_KEY, True))
    allow_overtime = bool(cfg.get(Tournament.RESULTCFG_ALLOW_OVERTIME_KEY, False))
    allow_shootout = bool(cfg.get(Tournament.RESULTCFG_ALLOW_SHOOTOUT_KEY, False))

    # Rozstrzygnięcie remisu wynika bezpośrednio z aktualnej konfiguracji dywizji.
    if _is_knockout_like(stage_type):
        allow_draw = False

    if allow_draw:
        return "DRAW_ALLOWED"
    if allow_overtime and allow_shootout:
        return "OVERTIME_AND_SHOOTOUT"
    if allow_overtime:
        return "OVERTIME_ONLY"
    if allow_shootout:
        return "SHOOTOUT_ONLY"
    return "DRAW_ALLOWED"


def _apply_resolution_mode(instance: Match, resolution_mode: str | None) -> None:
    mode = str(resolution_mode or "").upper()

    if instance.home_score != instance.away_score:
        instance.went_to_extra_time = False
        instance.home_extra_time_score = None
        instance.away_extra_time_score = None
        instance.decided_by_penalties = False
        instance.home_penalty_score = None
        instance.away_penalty_score = None
        return

    if mode == "DRAW_ALLOWED":
        instance.went_to_extra_time = False
        instance.home_extra_time_score = None
        instance.away_extra_time_score = None
        instance.decided_by_penalties = False
        instance.home_penalty_score = None
        instance.away_penalty_score = None
        return

    if mode == "OVERTIME_ONLY":
        instance.decided_by_penalties = False
        instance.home_penalty_score = None
        instance.away_penalty_score = None
        return

    if mode == "SHOOTOUT_ONLY":
        instance.went_to_extra_time = False
        instance.home_extra_time_score = None
        instance.away_extra_time_score = None
        return


class MatchCustomResultSerializer(serializers.ModelSerializer):
    team_id = serializers.IntegerField(source="team.id", read_only=True)
    team_name = serializers.CharField(source="team.name", read_only=True)
    sort_value = serializers.SerializerMethodField()

    class Meta:
        model = MatchCustomResult
        fields = (
            "id",
            "team_id",
            "team_name",
            "value_kind",
            "numeric_value",
            "time_ms",
            "place_value",
            "display_value",
            "rank",
            "is_active",
            "sort_value",
        )

    def get_sort_value(self, obj: MatchCustomResult):
        value = obj.get_sort_value()
        if isinstance(value, Decimal):
            return str(value)
        return value


class MatchSerializer(serializers.ModelSerializer):
    home_team_id = serializers.IntegerField(source="home_team.id", read_only=True)
    away_team_id = serializers.IntegerField(source="away_team.id", read_only=True)

    home_team_name = serializers.CharField(source="home_team.name", read_only=True)
    away_team_name = serializers.CharField(source="away_team.name", read_only=True)

    stage_type = serializers.CharField(source="stage.stage_type", read_only=True)
    stage_id = serializers.IntegerField(source="stage.id", read_only=True)
    stage_order = serializers.IntegerField(source="stage.order", read_only=True)
    division_id = serializers.IntegerField(source="stage.division.id", read_only=True, allow_null=True)
    division_name = serializers.CharField(source="stage.division.name", read_only=True, allow_null=True)

    group_name = serializers.CharField(source="group.name", read_only=True, allow_null=True)

    winner_id = serializers.IntegerField(source="winner.id", read_only=True, allow_null=True)

    is_technical = serializers.SerializerMethodField()
    custom_results = serializers.SerializerMethodField()
    uses_custom_results = serializers.SerializerMethodField()

    class Meta:
        model = Match
        fields = (
            "id",
            "stage_id",
            "stage_order",
            "stage_type",
            "division_id",
            "division_name",
            "group_name",
            "round_number",
            "home_team_id",
            "away_team_id",
            "home_team_name",
            "away_team_name",
            "home_score",
            "away_score",
            "tennis_sets",
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
            "uses_custom_results",
            "custom_results",
        )

    def get_is_technical(self, obj: Match) -> bool:
        return (
            obj.home_team and obj.home_team.name == BYE_TEAM_NAME
        ) or (
            obj.away_team and obj.away_team.name == BYE_TEAM_NAME
        )

    def get_uses_custom_results(self, obj: Match) -> bool:
        return _match_uses_custom_result_rows(obj)

    def get_custom_results(self, obj: Match):
        if not _match_uses_custom_result_rows(obj):
            return []

        qs = obj.custom_results.select_related("team").filter(is_active=True).order_by("rank", "id")
        return MatchCustomResultSerializer(qs, many=True).data


class MatchScheduleUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Match
        fields = ("scheduled_date", "scheduled_time", "location")


class MatchCustomResultUpdateSerializer(serializers.Serializer):
    team_id = serializers.IntegerField()
    numeric_value = serializers.CharField(required=False, allow_blank=False)
    time_ms = serializers.IntegerField(required=False, min_value=0)
    place_value = serializers.IntegerField(required=False, min_value=1)
    is_active = serializers.BooleanField(required=False, default=True)

    def validate(self, attrs):
        match: Match = self.context["match"]
        context = _competition_context_for_match(match)

        if context["result_mode"] != Tournament.ResultMode.CUSTOM:
            raise serializers.ValidationError(
                {"detail": "Ten mecz nie używa trybu CUSTOM w aktywnej dywizji."}
            )

        if context["competition_model"] != Tournament.CompetitionModel.HEAD_TO_HEAD:
            raise serializers.ValidationError(
                {"detail": "Ten endpoint obsługuje wyłącznie customowe pojedynki / mecze."}
            )

        if not _match_uses_custom_result_rows(match):
            if _match_uses_custom_points_table(match):
                raise serializers.ValidationError(
                    {"detail": "Dla customowego systemu punktowego użyj standardowego endpointu zapisu wyniku meczu."}
                )
            raise serializers.ValidationError(
                {
                    "detail": (
                        "Aktywna konfiguracja dywizji nie obsługuje osobnych rekordów MatchCustomResult "
                        "dla tego typu pojedynku."
                    )
                }
            )

        team_id = attrs["team_id"]
        valid_team_ids = {match.home_team_id, match.away_team_id}
        if team_id not in valid_team_ids:
            raise serializers.ValidationError(
                {"team_id": "Uczestnik musi należeć do tego meczu."}
            )

        cfg = context["result_config"]
        value_kind = cfg.get(Tournament.RESULTCFG_VALUE_KIND_KEY)

        if value_kind == Tournament.RESULTCFG_VALUE_KIND_TIME:
            if "time_ms" not in attrs:
                raise serializers.ValidationError(
                    {"time_ms": "Dla wyniku czasowego wymagane jest pole time_ms."}
                )
            if "numeric_value" in attrs or "place_value" in attrs:
                raise serializers.ValidationError(
                    {"detail": "Dla wyniku czasowego nie podawaj numeric_value ani place_value."}
                )
        elif value_kind == Tournament.RESULTCFG_VALUE_KIND_PLACE:
            if "place_value" not in attrs:
                raise serializers.ValidationError(
                    {"place_value": "Dla wyniku typu miejsce wymagane jest pole place_value."}
                )
            if "numeric_value" in attrs or "time_ms" in attrs:
                raise serializers.ValidationError(
                    {"detail": "Dla wyniku typu miejsce nie podawaj numeric_value ani time_ms."}
                )
        else:
            if "numeric_value" not in attrs:
                raise serializers.ValidationError(
                    {"numeric_value": "Dla wyniku liczbowego wymagane jest pole numeric_value."}
                )
            if "time_ms" in attrs or "place_value" in attrs:
                raise serializers.ValidationError(
                    {"detail": "Dla wyniku liczbowego nie podawaj time_ms ani place_value."}
                )

        return attrs

    def save(self, **kwargs):
        match: Match = self.context["match"]
        context = _competition_context_for_match(match)
        cfg = context["result_config"]
        value_kind = cfg[Tournament.RESULTCFG_VALUE_KIND_KEY]
        team = match.home_team if match.home_team_id == self.validated_data["team_id"] else match.away_team

        defaults: dict[str, Any] = {
            "value_kind": value_kind,
            "is_active": bool(self.validated_data.get("is_active", True)),
            "updated_by": self.context.get("user"),
        }

        if value_kind == Tournament.RESULTCFG_VALUE_KIND_TIME:
            time_ms = _parse_time_ms(self.validated_data["time_ms"])
            defaults["time_ms"] = time_ms
            defaults["numeric_value"] = None
            defaults["place_value"] = None
            defaults["display_value"] = _format_time_ms_for_display(
                time_ms,
                cfg.get(Tournament.RESULTCFG_TIME_FORMAT_KEY),
            )
        elif value_kind == Tournament.RESULTCFG_VALUE_KIND_PLACE:
            place_value = _parse_place_value(self.validated_data["place_value"])
            defaults["place_value"] = place_value
            defaults["numeric_value"] = None
            defaults["time_ms"] = None
            defaults["display_value"] = str(place_value)
        else:
            decimal_places = int(cfg.get(Tournament.RESULTCFG_DECIMAL_PLACES_KEY, 0) or 0)
            numeric_value = _parse_numeric_value(self.validated_data["numeric_value"])
            quantized = MatchCustomResult._quantize_numeric(numeric_value, decimal_places)
            defaults["numeric_value"] = quantized
            defaults["time_ms"] = None
            defaults["place_value"] = None
            defaults["display_value"] = _format_decimal_for_display(quantized, decimal_places)

        result, created = MatchCustomResult.objects.get_or_create(
            match=match,
            team=team,
            defaults={
                **defaults,
                "created_by": self.context.get("user"),
            },
        )

        if not created:
            for key, value in defaults.items():
                setattr(result, key, value)

        result.save()
        self._refresh_match_state(match)
        return result

    @staticmethod
    def _refresh_match_state(match: Match) -> None:
        active_count = match.custom_results.filter(is_active=True).count()
        if active_count > 0 and not match.result_entered:
            match.result_entered = True
            match.save(update_fields=["result_entered"])


class MatchResultUpdateSerializer(serializers.ModelSerializer):
    home_score = serializers.IntegerField(required=False, allow_null=False, min_value=0)
    away_score = serializers.IntegerField(required=False, allow_null=False, min_value=0)

    tennis_sets = serializers.JSONField(required=False, allow_null=True)

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
            "tennis_sets",
            "went_to_extra_time",
            "home_extra_time_score",
            "away_extra_time_score",
            "decided_by_penalties",
            "home_penalty_score",
            "away_penalty_score",
            "status",
        )

    def validate(self, attrs):
        match: Match = self.instance
        context = _competition_context_for_match(match)

        if (
            context["result_mode"] == Tournament.ResultMode.CUSTOM
            and not _match_uses_custom_points_table(match)
        ):
            raise serializers.ValidationError(
                {
                    "detail": (
                        "Ten endpoint obsługuje standardowy wynik meczu oraz customowy system punktowy. "
                        "Dla customowego wyniku mierzalnego użyj endpointu zapisu rezultatu."
                    )
                }
            )

        return attrs

    def update(self, instance: Match, validated_data):
        stage_type = getattr(instance.stage, "stage_type", None)
        tournament: Tournament = instance.tournament
        discipline = (getattr(tournament, "discipline", "") or "").lower()
        context = _competition_context_for_match(instance)
        cfg = context["format_config"]
        is_custom_points_table = _match_uses_custom_points_table(instance)

        touched_keys = {
            "home_score",
            "away_score",
            "tennis_sets",
            "went_to_extra_time",
            "home_extra_time_score",
            "away_extra_time_score",
            "decided_by_penalties",
            "home_penalty_score",
            "away_penalty_score",
        }
        if any(key in validated_data for key in touched_keys):
            instance.result_entered = True

        for key, value in validated_data.items():
            setattr(instance, key, value)

        if not instance.went_to_extra_time:
            instance.home_extra_time_score = None
            instance.away_extra_time_score = None

        if not instance.decided_by_penalties:
            instance.home_penalty_score = None
            instance.away_penalty_score = None

        knockout_like = _is_knockout_like(stage_type)

        if discipline == Tournament.Discipline.TENNIS:
            instance.went_to_extra_time = False
            instance.home_extra_time_score = None
            instance.away_extra_time_score = None
            instance.decided_by_penalties = False
            instance.home_penalty_score = None
            instance.away_penalty_score = None

            home_sets, away_sets, _decided = _validate_tennis_sets_and_compute_score_for_save(
                instance.tennis_sets,
                cfg=cfg,
            )

            instance.home_score = home_sets
            instance.away_score = away_sets

            instance.save()
            return instance

        instance.tennis_sets = None

        if is_custom_points_table:
            _apply_resolution_mode(instance, _resolution_mode_for_match(instance))
            instance.save()
            return instance

        if discipline != Tournament.Discipline.HANDBALL and not knockout_like:
            instance.went_to_extra_time = False
            instance.home_extra_time_score = None
            instance.away_extra_time_score = None
            instance.decided_by_penalties = False
            instance.home_penalty_score = None
            instance.away_penalty_score = None

        if discipline == Tournament.Discipline.HANDBALL and knockout_like:
            tiebreak = (cfg.get("handball_knockout_tiebreak") or "OVERTIME_PENALTIES").upper()
            if tiebreak == "PENALTIES":
                instance.went_to_extra_time = False
                instance.home_extra_time_score = None
                instance.away_extra_time_score = None

        if discipline == Tournament.Discipline.HANDBALL and str(stage_type) in (
            str(Stage.StageType.LEAGUE),
            str(Stage.StageType.GROUP),
        ):
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
