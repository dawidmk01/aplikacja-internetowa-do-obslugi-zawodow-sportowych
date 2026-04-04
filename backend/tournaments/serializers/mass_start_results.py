# backend/tournaments/serializers/mass_start_results.py
# Plik definiuje serializery odpowiedzialne za odczyt i zapis wyników etapowych trybu MASS_START.

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

from rest_framework import serializers

from tournaments.models import (
    Group,
    Stage,
    StageMassStartEntry,
    StageMassStartResult,
    Team,
    Tournament,
)


def _format_decimal_for_display(value: Decimal, decimal_places: int) -> str:
    return f"{value:.{decimal_places}f}" if decimal_places > 0 else str(int(value))


def _quantize_numeric(value: Decimal | str | float | int, decimal_places: int) -> Decimal:
    decimal_value = value if isinstance(value, Decimal) else Decimal(str(value))
    exponent = Decimal("1").scaleb(-int(decimal_places))
    return decimal_value.quantize(exponent)


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
        raise serializers.ValidationError({"time_ms": "Wartość nie może być ujemna."})
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


class StageMassStartResultSerializer(serializers.ModelSerializer):
    stage_id = serializers.IntegerField(source="stage.id", read_only=True)
    group_id = serializers.IntegerField(source="group.id", read_only=True, allow_null=True)
    group_name = serializers.CharField(source="group.name", read_only=True, allow_null=True)
    team_id = serializers.IntegerField(source="team.id", read_only=True)
    team_name = serializers.CharField(source="team.name", read_only=True)
    sort_value = serializers.SerializerMethodField()

    class Meta:
        model = StageMassStartResult
        fields = (
            "id",
            "stage_id",
            "group_id",
            "group_name",
            "team_id",
            "team_name",
            "round_number",
            "value_kind",
            "numeric_value",
            "time_ms",
            "place_value",
            "display_value",
            "rank",
            "is_active",
            "sort_value",
        )

    def get_sort_value(self, obj: StageMassStartResult):
        value = obj.get_sort_value()
        if isinstance(value, Decimal):
            return str(value)
        return value


class StageMassStartResultWriteSerializer(serializers.Serializer):
    stage_id = serializers.IntegerField()
    group_id = serializers.IntegerField(required=False, allow_null=True)
    team_id = serializers.IntegerField()
    round_number = serializers.IntegerField(min_value=1)
    numeric_value = serializers.CharField(required=False, allow_blank=False)
    time_ms = serializers.IntegerField(required=False, min_value=0)
    place_value = serializers.IntegerField(required=False, min_value=1)
    is_active = serializers.BooleanField(required=False, default=True)

    def validate(self, attrs):
        tournament: Tournament = self.context["tournament"]

        if not tournament.uses_custom_results() or not tournament.uses_mass_start():
            raise serializers.ValidationError(
                {"detail": "Ten endpoint obsługuje wyłącznie wyniki etapowe MASS_START."}
            )

        stage = Stage.objects.filter(
            pk=attrs["stage_id"],
            tournament=tournament,
            stage_type=Stage.StageType.MASS_START,
        ).first()
        if not stage:
            raise serializers.ValidationError({"stage_id": "Wskazano nieprawidłowy etap."})

        if stage.status == Stage.Status.PLANNED:
            raise serializers.ValidationError(
                {"stage_id": "Ten etap nie został jeszcze wygenerowany."}
            )

        group = None
        if attrs.get("group_id") is not None:
            group = Group.objects.filter(pk=attrs["group_id"], stage=stage).first()
            if not group:
                raise serializers.ValidationError({"group_id": "Wskazano nieprawidłową grupę."})
        else:
            group = stage.groups.order_by("id").first()

        team = Team.objects.filter(pk=attrs["team_id"], tournament=tournament).first()
        if not team:
            raise serializers.ValidationError({"team_id": "Wskazano nieprawidłowego uczestnika."})

        entry = (
            StageMassStartEntry.objects.filter(
                stage=stage,
                team=team,
                is_active=True,
            )
            .select_related("group")
            .first()
        )
        if not entry:
            raise serializers.ValidationError(
                {"team_id": "Uczestnik nie należy do wygenerowanej obsady tego etapu."}
            )

        expected_group_id = entry.group_id
        provided_group_id = group.id if group else None
        if expected_group_id != provided_group_id:
            raise serializers.ValidationError(
                {"group_id": "Uczestnik nie należy do wskazanej grupy tego etapu."}
            )

        stage_cfgs = list(tournament.get_mass_start_stages() or [])
        stage_cfg = stage_cfgs[stage.order - 1] if stage.order - 1 < len(stage_cfgs) else {}
        rounds_count = int(stage_cfg.get(Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY) or 1)
        if attrs["round_number"] > rounds_count:
            raise serializers.ValidationError(
                {"round_number": f"Dozwolony zakres rund dla tego etapu to 1-{rounds_count}."}
            )

        value_kind = tournament.get_result_value_kind()
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

        attrs["stage"] = stage
        attrs["group"] = group
        attrs["team"] = team
        attrs["stage_entry"] = entry
        return attrs

    def save(self, **kwargs):
        tournament: Tournament = self.context["tournament"]
        value_kind = tournament.get_result_value_kind()
        cfg = tournament.get_result_config()

        stage: Stage = self.validated_data["stage"]
        group: Group | None = self.validated_data.get("group")
        team: Team = self.validated_data["team"]
        round_number = self.validated_data["round_number"]

        defaults: dict[str, Any] = {
            "group": group,
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
            quantized = _quantize_numeric(numeric_value, decimal_places)
            defaults["numeric_value"] = quantized
            defaults["time_ms"] = None
            defaults["place_value"] = None
            defaults["display_value"] = _format_decimal_for_display(quantized, decimal_places)

        result, created = StageMassStartResult.objects.get_or_create(
            stage=stage,
            team=team,
            round_number=round_number,
            defaults={
                **defaults,
                "created_by": self.context.get("user"),
            },
        )

        if not created:
            for key, value in defaults.items():
                setattr(result, key, value)

        result.save()
        return result