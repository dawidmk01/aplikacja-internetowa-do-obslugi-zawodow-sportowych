# backend/tournaments/serializers/tournament.py
# Plik definiuje serializery odpowiedzialne za walidację wspólnych danych turnieju oraz aktywnej dywizji.

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.db import transaction
from rest_framework import serializers

from tournaments.models import (
    Division,
    Match,
    Stage,
    StageMassStartEntry,
    StageMassStartResult,
    Team,
    TeamPlayer,
    Tournament,
    TournamentMembership,
    TournamentRegistration,
    TournamentAssistantInvite,
)

User = get_user_model()

TENIS_POINTS_MODES = ("NONE", "PLT")
BYE_TEAM_NAME = "__SYSTEM_BYE__"
ACTIVE_ENTRY_MODES = (Tournament.EntryMode.MANAGER, Tournament.EntryMode.ORGANIZER_ONLY)
DIVISION_CONFIG_FIELDS = {
    "competition_type",
    "competition_model",
    "tournament_format",
    "format_config",
    "result_mode",
    "result_config",
}


def _normalize_format_config(discipline: str | None, cfg) -> dict:
    discipline = (discipline or "").lower()

    if cfg is None:
        cfg = {}
    if not isinstance(cfg, dict):
        raise serializers.ValidationError(
            {"format_config": "format_config musi być obiektem JSON (dict)."}
        )

    cfg = dict(cfg)

    if discipline == Tournament.Discipline.TENNIS:
        mode = cfg.get("tennis_points_mode") or "NONE"
        mode = str(mode).upper()
        if mode not in TENIS_POINTS_MODES:
            raise serializers.ValidationError(
                {
                    "format_config": {
                        "tennis_points_mode": f"Dozwolone: {', '.join(TENIS_POINTS_MODES)}"
                    }
                }
            )
        cfg["tennis_points_mode"] = mode
    else:
        cfg.pop("tennis_points_mode", None)

    try:
        return Tournament.normalize_format_config(discipline, cfg)
    except ValueError as exc:
        raise serializers.ValidationError({"format_config": str(exc)}) from exc


def _normalize_result_mode(value: str | None) -> str:
    mode = str(value or Tournament.ResultMode.SCORE).upper()
    allowed = {Tournament.ResultMode.SCORE, Tournament.ResultMode.CUSTOM}
    if mode not in allowed:
        raise serializers.ValidationError(
            {"result_mode": "Dozwolone wartości: SCORE, CUSTOM."}
        )
    return mode



def _normalize_result_config(result_mode: str | None, cfg) -> dict:
    mode = _normalize_result_mode(result_mode)

    try:
        return Division.normalize_result_config(mode, cfg)
    except ValueError as exc:
        raise serializers.ValidationError({"result_config": str(exc)}) from exc


def _safe_entry_mode(value: str | None) -> str:
    if value in ACTIVE_ENTRY_MODES:
        return value
    return Tournament.EntryMode.MANAGER


def _is_create(serializer: serializers.ModelSerializer) -> bool:
    return serializer.instance is None


def _is_draft_custom_bootstrap(
    *,
    serializer: serializers.ModelSerializer,
    discipline: str | None,
    attrs: dict,
) -> bool:
    if discipline != Tournament.Discipline.CUSTOM:
        return False

    if not _is_create(serializer):
        return False

    if "custom_discipline_name" not in attrs:
        return True

    raw_name = attrs.get("custom_discipline_name")
    return not bool((raw_name or "").strip())


def _division_summary_payload(division: Division) -> dict:
    return {
        "id": division.id,
        "name": division.name,
        "slug": division.slug,
        "order": division.order,
        "is_default": division.is_default,
        "is_archived": division.is_archived,
        "status": division.status,
    }


def _extract_requested_division_ref(serializer: serializers.ModelSerializer) -> tuple[int | None, str | None]:
    request = serializer.context.get("request")
    raw_id = None
    raw_slug = None

    initial_data = getattr(serializer, "initial_data", None)
    if hasattr(initial_data, "get"):
        raw_id = (
            initial_data.get("division_id")
            or initial_data.get("active_division_id")
            or initial_data.get("division")
        )
        raw_slug = (
            initial_data.get("division_slug")
            or initial_data.get("active_division_slug")
        )

    if raw_id in (None, "") and request is not None:
        raw_id = (
            request.query_params.get("division_id")
            or request.query_params.get("active_division_id")
            or request.query_params.get("division")
        )

    if raw_slug in (None, "") and request is not None:
        raw_slug = (
            request.query_params.get("division_slug")
            or request.query_params.get("active_division_slug")
        )

    if raw_id in (None, ""):
        ctx_id = serializer.context.get("division_id")
        if ctx_id not in (None, ""):
            raw_id = ctx_id

    if raw_slug in (None, ""):
        ctx_slug = serializer.context.get("division_slug")
        if ctx_slug not in (None, ""):
            raw_slug = ctx_slug

    division = serializer.context.get("division")
    if raw_id in (None, "") and raw_slug in (None, "") and division is not None:
        raw_id = getattr(division, "id", None)

    division_id = None
    if raw_id not in (None, ""):
        try:
            division_id = int(raw_id)
        except (TypeError, ValueError) as exc:
            raise serializers.ValidationError(
                {"division_id": "division_id musi być liczbą całkowitą."}
            ) from exc

    division_slug = None
    if raw_slug not in (None, ""):
        division_slug = str(raw_slug).strip()
        if not division_slug:
            raise serializers.ValidationError(
                {"division_slug": "division_slug nie może być pusty."}
            )

    return division_id, division_slug


def _resolve_division_for_serializer(
    serializer: serializers.ModelSerializer,
    tournament: Tournament,
    *,
    required: bool,
) -> Division | None:
    division_id, division_slug = _extract_requested_division_ref(serializer)

    qs = tournament.divisions.all().order_by("order", "id")

    if division_id is not None:
        division = qs.filter(pk=division_id).first()
        if not division:
            raise serializers.ValidationError({"division_id": "Wskazana dywizja nie należy do tego turnieju."})
        return division

    if division_slug is not None:
        division = qs.filter(slug=division_slug).first()
        if not division:
            raise serializers.ValidationError({"division_slug": "Wskazana dywizja nie należy do tego turnieju."})
        return division

    division = tournament.get_default_division()
    if required and not division:
        raise serializers.ValidationError(
            {"division_id": "Turniej nie ma jeszcze utworzonej dywizji roboczej."}
        )
    return division


def _build_division_config_from_source(source, *, discipline: str | None) -> dict:
    return {
        "competition_type": source.get("competition_type"),
        "competition_model": source.get("competition_model"),
        "tournament_format": source.get("tournament_format"),
        "format_config": _normalize_format_config(discipline, source.get("format_config")),
        "result_mode": _normalize_result_mode(source.get("result_mode")),
        "result_config": source.get("result_config"),
    }


def _normalize_division_config(
    *,
    serializer: serializers.ModelSerializer,
    discipline: str | None,
    custom_discipline_name: str | None,
    division_source: dict,
) -> dict:
    competition_type = division_source.get("competition_type")
    competition_model = division_source.get("competition_model")
    tournament_format = division_source.get("tournament_format")
    format_config = _normalize_format_config(discipline, division_source.get("format_config"))
    result_mode = _normalize_result_mode(division_source.get("result_mode"))
    result_config = division_source.get("result_config")

    is_custom_bootstrap = _is_draft_custom_bootstrap(
        serializer=serializer,
        discipline=discipline,
        attrs={"custom_discipline_name": custom_discipline_name},
    )

    if discipline == Tournament.Discipline.CUSTOM:
        effective_name = (custom_discipline_name or "").strip()

        if is_custom_bootstrap:
            return {
                "competition_type": competition_type or Tournament.CompetitionType.INDIVIDUAL,
                "competition_model": competition_model or Tournament.CompetitionModel.MASS_START,
                "tournament_format": tournament_format or Tournament.TournamentFormat.LEAGUE,
                "format_config": format_config,
                "result_mode": Tournament.ResultMode.SCORE,
                "result_config": {},
            }

        if not effective_name:
            raise serializers.ValidationError(
                {"custom_discipline_name": "Dla dyscypliny niestandardowej podaj własną nazwę."}
            )

        if competition_type not in (
            Tournament.CompetitionType.INDIVIDUAL,
            Tournament.CompetitionType.TEAM,
        ):
            raise serializers.ValidationError(
                {
                    "competition_type": (
                        "Dla dyscypliny niestandardowej wybierz typ uczestnictwa: "
                        "INDIVIDUAL albo TEAM."
                    )
                }
            )

        if competition_model not in (
            Tournament.CompetitionModel.HEAD_TO_HEAD,
            Tournament.CompetitionModel.MASS_START,
        ):
            raise serializers.ValidationError(
                {
                    "competition_model": (
                        "Dla dyscypliny niestandardowej wybierz model rywalizacji: "
                        "HEAD_TO_HEAD albo MASS_START."
                    )
                }
            )

        if result_mode != Tournament.ResultMode.CUSTOM:
            raise serializers.ValidationError(
                {
                    "result_mode": (
                        "Dla w pełni skonfigurowanej dyscypliny niestandardowej wymagany jest "
                        "result_mode=CUSTOM."
                    )
                }
            )

        return {
            "competition_type": competition_type,
            "competition_model": competition_model,
            "tournament_format": tournament_format,
            "format_config": format_config,
            "result_mode": Tournament.ResultMode.CUSTOM,
            "result_config": _normalize_result_config(Tournament.ResultMode.CUSTOM, result_config),
        }

    if discipline == Tournament.Discipline.WRESTLING:
        if competition_type not in (None, Tournament.CompetitionType.INDIVIDUAL):
            raise serializers.ValidationError(
                {
                    "competition_type": (
                        "Dla zapasów obsługiwany jest obecnie wyłącznie tryb INDIVIDUAL. "
                        "Kategorie Women, U20, U17 i U15 należy modelować przez dywizje."
                    )
                }
            )

        if competition_model not in (None, Tournament.CompetitionModel.HEAD_TO_HEAD):
            raise serializers.ValidationError(
                {
                    "competition_model": (
                        "Dla zapasów obsługiwany jest obecnie model HEAD_TO_HEAD."
                    )
                }
            )

        if result_mode == Tournament.ResultMode.CUSTOM:
            raise serializers.ValidationError(
                {
                    "result_mode": (
                        "Dla zapasów używany jest klasyczny wynik walki. "
                        "Tryb CUSTOM nie jest tutaj obsługiwany."
                    )
                }
            )

        allowed = Division.allowed_formats_for_discipline(discipline)
        if tournament_format not in allowed:
            raise serializers.ValidationError(
                {"tournament_format": "Wybrany format nie jest dostępny dla tej dyscypliny."}
            )

        return {
            "competition_type": Tournament.CompetitionType.INDIVIDUAL,
            "competition_model": Tournament.CompetitionModel.HEAD_TO_HEAD,
            "tournament_format": tournament_format,
            "format_config": format_config,
            "result_mode": Tournament.ResultMode.SCORE,
            "result_config": {},
        }

    allowed = Division.allowed_formats_for_discipline(discipline)
    if tournament_format not in allowed:
        raise serializers.ValidationError(
            {"tournament_format": "Wybrany format nie jest dostępny dla tej dyscypliny."}
        )

    if result_mode == Tournament.ResultMode.CUSTOM:
        raise serializers.ValidationError(
            {
                "result_mode": (
                    "Tryb CUSTOM jest obecnie dostępny tylko dla dyscypliny niestandardowej."
                )
            }
        )

    return {
        "competition_type": competition_type or Division.infer_default_competition_type(discipline),
        "competition_model": competition_model or Division.infer_default_competition_model(discipline),
        "tournament_format": tournament_format,
        "format_config": format_config,
        "result_mode": Tournament.ResultMode.SCORE,
        "result_config": {},
    }


def _sync_legacy_tournament_config(tournament: Tournament, division: Division) -> None:
    tournament.competition_type = division.competition_type
    tournament.competition_model = division.competition_model
    tournament.tournament_format = division.tournament_format
    tournament.format_config = dict(division.format_config or {})
    tournament.result_mode = division.result_mode
    tournament.result_config = dict(division.result_config or {})


class StageScheduleEntrySerializer(serializers.Serializer):
    stage_id = serializers.IntegerField()
    scheduled_date = serializers.DateField(required=False, allow_null=True)
    scheduled_time = serializers.TimeField(required=False, allow_null=True)
    location = serializers.CharField(required=False, allow_blank=True, allow_null=True, max_length=255)


class GroupScheduleEntrySerializer(serializers.Serializer):
    group_id = serializers.IntegerField()
    scheduled_date = serializers.DateField(required=False, allow_null=True)
    scheduled_time = serializers.TimeField(required=False, allow_null=True)
    location = serializers.CharField(required=False, allow_blank=True, allow_null=True, max_length=255)


class TournamentSerializer(serializers.ModelSerializer):
    my_role = serializers.SerializerMethodField()
    matches_started = serializers.SerializerMethodField()
    my_permissions = serializers.SerializerMethodField()
    schedule_targets = serializers.SerializerMethodField()
    panel_stats = serializers.SerializerMethodField()
    assistant_invite_pending = serializers.SerializerMethodField()
    assistant_membership_status = serializers.SerializerMethodField()

    allow_join_by_code = serializers.BooleanField(required=False, source="join_enabled")
    join_code = serializers.CharField(
        required=False,
        allow_null=True,
        allow_blank=True,
        source="registration_code",
    )

    division_id = serializers.IntegerField(required=False, write_only=True)
    division_slug = serializers.CharField(required=False, write_only=True)
    division_name = serializers.CharField(required=False, write_only=True, allow_blank=False, max_length=120)

    active_division_id = serializers.SerializerMethodField()
    active_division_slug = serializers.SerializerMethodField()
    active_division_name = serializers.SerializerMethodField()
    division_status = serializers.SerializerMethodField()
    divisions = serializers.SerializerMethodField()

    class Meta:
        model = Tournament
        fields = "__all__"
        read_only_fields = (
            "organizer",
            "status",
            "created_at",
            "my_role",
            "matches_started",
            "my_permissions",
            "active_division_id",
            "active_division_slug",
            "active_division_name",
            "division_status",
            "divisions",
            "panel_stats",
            "assistant_invite_pending",
            "assistant_membership_status",
        )

    # ===== Reprezentacja aktywnej dywizji =====

    def _get_active_division(self, tournament: Tournament) -> Division | None:
        return _resolve_division_for_serializer(self, tournament, required=False)

    def _division_config_source_for_validation(self, tournament: Tournament, division: Division | None) -> dict:
        if division is not None:
            return {
                "competition_type": division.competition_type,
                "competition_model": division.competition_model,
                "tournament_format": division.tournament_format,
                "format_config": dict(division.format_config or {}),
                "result_mode": division.result_mode,
                "result_config": dict(division.result_config or {}),
            }

        return {
            "competition_type": tournament.competition_type,
            "competition_model": tournament.competition_model,
            "tournament_format": tournament.tournament_format,
            "format_config": dict(tournament.format_config or {}),
            "result_mode": tournament.result_mode,
            "result_config": dict(tournament.result_config or {}),
        }

    def _overlay_active_division_data(self, data: dict, division: Division | None, *, discipline: str | None) -> dict:
        if division is None:
            return data

        data["competition_type"] = division.competition_type
        data["competition_model"] = division.competition_model
        data["tournament_format"] = division.tournament_format
        data["format_config"] = dict(division.format_config or {})
        data["result_mode"] = division.result_mode
        data["result_config"] = (
            division.get_result_config() if division.result_mode == Tournament.ResultMode.CUSTOM else {}
        )
        data["active_division_id"] = division.id
        data["active_division_slug"] = division.slug
        data["active_division_name"] = division.name
        data["division_status"] = division.status

        if discipline != Tournament.Discipline.CUSTOM:
            data["custom_discipline_name"] = None

        return data

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        division = self._get_active_division(instance)

        if "entry_mode" in data:
            data["entry_mode"] = _safe_entry_mode(data.get("entry_mode"))

        data.pop("join_enabled", None)
        data.pop("registration_code", None)
        data.pop("division_id", None)
        data.pop("division_slug", None)
        data.pop("division_name", None)

        data = self._overlay_active_division_data(
            data,
            division,
            discipline=instance.discipline,
        )

        if not request or not request.user.is_authenticated or instance.organizer_id != request.user.id:
            data.pop("access_code", None)
            data.pop("join_code", None)

        return data

    def get_active_division_id(self, obj: Tournament) -> int | None:
        division = self._get_active_division(obj)
        return division.id if division else None

    def get_active_division_slug(self, obj: Tournament) -> str | None:
        division = self._get_active_division(obj)
        return division.slug if division else None

    def get_active_division_name(self, obj: Tournament) -> str | None:
        division = self._get_active_division(obj)
        return division.name if division else None

    def get_division_status(self, obj: Tournament) -> str | None:
        division = self._get_active_division(obj)
        return division.status if division else None

    def get_divisions(self, obj: Tournament) -> list[dict]:
        return [_division_summary_payload(division) for division in obj.divisions.all().order_by("order", "id")]

    # ===== Walidacja pól wspólnych =====

    def validate_entry_mode(self, value: str):
        if value not in ACTIVE_ENTRY_MODES:
            raise serializers.ValidationError(
                "Nieprawidłowy tryb panelu. Dozwolone: MANAGER, ORGANIZER_ONLY."
            )
        return value

    def validate_custom_discipline_name(self, value: str | None):
        if value is None:
            return value

        normalized = value.strip()
        if not normalized:
            return None
        if len(normalized) < 3:
            raise serializers.ValidationError(
                "Własna nazwa dyscypliny musi mieć co najmniej 3 znaki."
            )
        return normalized

    def validate(self, attrs):
        request = self.context.get("request")
        instance = self.instance

        division_id = attrs.pop("division_id", None)
        division_slug = attrs.pop("division_slug", None)
        division_name = attrs.pop("division_name", None)

        if division_id is not None:
            self.context["division_id"] = division_id
        if division_slug not in (None, ""):
            self.context["division_slug"] = division_slug

        discipline = attrs.get("discipline") or (instance.discipline if instance else None)
        custom_discipline_name = attrs.get("custom_discipline_name")
        if "custom_discipline_name" not in attrs and instance:
            custom_discipline_name = instance.custom_discipline_name

        if "entry_mode" in attrs:
            attrs["entry_mode"] = self.validate_entry_mode(attrs["entry_mode"])

        join_enabled = attrs.get("join_enabled", None)
        reg_code = attrs.get("registration_code", None)
        if join_enabled is True:
            code = (reg_code or "").strip()
            if len(code) < 3:
                raise serializers.ValidationError(
                    {"join_code": "Dla dołączania przez kod wymagany jest kod (min. 3 znaki)."}
                )
            attrs["registration_code"] = code
        elif join_enabled is False:
            attrs["registration_code"] = None

        division = None
        if instance:
            division = _resolve_division_for_serializer(self, instance, required=False)

        division_source = self._division_config_source_for_validation(
            instance if instance else Tournament(discipline=discipline),
            division,
        )

        for field in DIVISION_CONFIG_FIELDS:
            if field in attrs:
                division_source[field] = attrs[field]

        normalized_division_config = _normalize_division_config(
            serializer=self,
            discipline=discipline,
            custom_discipline_name=custom_discipline_name,
            division_source=division_source,
        )

        attrs["_division_payload"] = normalized_division_config
        if division_name is not None:
            attrs["_division_name"] = str(division_name).strip()

        if not request or not request.user.is_authenticated or not instance:
            return attrs

        if (
            instance.status != Tournament.Status.DRAFT
            and "discipline" in attrs
            and attrs.get("discipline") != instance.discipline
        ):
            raise serializers.ValidationError(
                {
                    "discipline": (
                        "Zmiana dyscypliny po konfiguracji turnieju wymaga resetu. "
                        "Użyj endpointu: POST /api/tournaments/<id>/change-discipline/"
                    )
                }
            )

        if (
            division is not None
            and division.status != Tournament.Status.DRAFT
            and any(field in attrs for field in DIVISION_CONFIG_FIELDS)
        ):
            raise serializers.ValidationError(
                {
                    "detail": (
                        "Zmiana konfiguracji aktywnej dywizji po wygenerowaniu rozgrywek wymaga resetu "
                        "etapów i meczów tej dywizji. Użyj dedykowanego endpointu resetu setupu."
                    )
                }
            )

        is_organizer = instance.organizer_id == request.user.id
        is_assistant = instance.memberships.filter(
            user=request.user,
            role=TournamentMembership.Role.ASSISTANT,
        ).exists()

        if not is_organizer:
            for field in (
                "is_published",
                "access_code",
                "entry_mode",
                "join_enabled",
                "registration_code",
                "allow_join_by_code",
                "join_code",
            ):
                attrs.pop(field, None)

        if not (is_organizer or is_assistant):
            for field in DIVISION_CONFIG_FIELDS:
                attrs.pop(field, None)
            attrs.pop("_division_payload", None)
            attrs.pop("_division_name", None)

        if is_organizer and "entry_mode" in attrs:
            attrs["entry_mode"] = self.validate_entry_mode(attrs["entry_mode"])

        return attrs

    # ===== Zapis wspólnych danych i konfiguracji dywizji =====

    @transaction.atomic
    def create(self, validated_data):
        division_payload = validated_data.pop("_division_payload", None)
        division_name = validated_data.pop("_division_name", None) or "Dywizja główna"
        validated_data.pop("division_id", None)
        validated_data.pop("division_slug", None)
        validated_data.pop("division_name", None)

        discipline = validated_data.get("discipline")

        if discipline != Tournament.Discipline.CUSTOM:
            validated_data["custom_discipline_name"] = None

        tournament = super().create(validated_data)

        division_payload = division_payload or _normalize_division_config(
            serializer=self,
            discipline=tournament.discipline,
            custom_discipline_name=tournament.custom_discipline_name,
            division_source={
                "competition_type": tournament.competition_type,
                "competition_model": tournament.competition_model,
                "tournament_format": tournament.tournament_format,
                "format_config": tournament.format_config,
                "result_mode": tournament.result_mode,
                "result_config": tournament.result_config,
            },
        )

        division = Division.objects.create(
            tournament=tournament,
            name=division_name,
            is_default=True,
            status=tournament.status,
            **division_payload,
        )

        _sync_legacy_tournament_config(tournament, division)
        tournament.save(
            update_fields=[
                "competition_type",
                "competition_model",
                "tournament_format",
                "format_config",
                "result_mode",
                "result_config",
                "custom_discipline_name",
            ]
        )

        return tournament

    @transaction.atomic
    def update(self, instance: Tournament, validated_data):
        division_payload = validated_data.pop("_division_payload", None)
        division_name = validated_data.pop("_division_name", None)
        validated_data.pop("division_id", None)
        validated_data.pop("division_slug", None)
        validated_data.pop("division_name", None)

        # Konfiguracja sportowa jest utrzymywana w aktywnej dywizji, a nie w rekordzie turnieju.
        for field in DIVISION_CONFIG_FIELDS:
            validated_data.pop(field, None)

        if validated_data.get("discipline") != Tournament.Discipline.CUSTOM and "discipline" in validated_data:
            validated_data["custom_discipline_name"] = None

        instance = super().update(instance, validated_data)

        division = _resolve_division_for_serializer(self, instance, required=False)
        if division is None:
            division = Division.objects.create(
                tournament=instance,
                name=(division_name or "Dywizja główna"),
                is_default=True,
                status=instance.status,
                **(division_payload or instance.build_default_division_payload()),
            )

        if division_name is not None:
            division.name = division_name

        if division_payload is not None:
            for field, value in division_payload.items():
                setattr(division, field, value)

        division.save()

        if division.is_default:
            _sync_legacy_tournament_config(instance, division)
            instance.save(
                update_fields=[
                    "competition_type",
                    "competition_model",
                    "tournament_format",
                    "format_config",
                    "result_mode",
                    "result_config",
                ]
            )

        return instance

    # ===== Pola pochodne =====

    def _get_assistant_membership(self, obj: Tournament):
        request = self.context.get("request")
        user = request.user if request and request.user and request.user.is_authenticated else None
        if not user:
            return None

        return obj.memberships.filter(
            user=user,
            role=TournamentMembership.Role.ASSISTANT,
            status=TournamentMembership.Status.ACCEPTED,
        ).first()

    def _get_pending_assistant_invite(self, obj: Tournament):
        request = self.context.get("request")
        user = request.user if request and request.user and request.user.is_authenticated else None
        normalized_email = str(getattr(user, "email", "") or "").strip().lower() if user else ""
        if not normalized_email:
            return None

        return obj.assistant_invites.filter(
            normalized_email=normalized_email,
            status=TournamentAssistantInvite.Status.PENDING,
        ).first()

    def get_my_role(self, obj):
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return None

        if obj.organizer_id == request.user.id:
            return "ORGANIZER"

        if self._get_assistant_membership(obj) is not None:
            return TournamentMembership.Role.ASSISTANT

        if TournamentRegistration.objects.filter(tournament=obj, user=request.user).exists():
            return "PARTICIPANT"

        return None

    def get_assistant_invite_pending(self, obj: Tournament) -> bool:
        if self._get_assistant_membership(obj) is not None:
            return False
        return self._get_pending_assistant_invite(obj) is not None

    def get_assistant_membership_status(self, obj: Tournament) -> str | None:
        if self._get_assistant_membership(obj) is not None:
            return TournamentMembership.Status.ACCEPTED
        if self._get_pending_assistant_invite(obj) is not None:
            return TournamentAssistantInvite.Status.PENDING
        return None

    def get_my_permissions(self, obj: Tournament) -> dict:
        request = self.context.get("request")
        user = request.user if request and request.user and request.user.is_authenticated else None

        base = {
            TournamentMembership.PERM_TEAMS_EDIT: False,
            TournamentMembership.PERM_ROSTER_EDIT: False,
            TournamentMembership.PERM_SCHEDULE_EDIT: False,
            TournamentMembership.PERM_RESULTS_EDIT: False,
            TournamentMembership.PERM_BRACKET_EDIT: False,
            TournamentMembership.PERM_TOURNAMENT_EDIT: False,
            TournamentMembership.PERM_PUBLISH: False,
            TournamentMembership.PERM_ARCHIVE: False,
            TournamentMembership.PERM_MANAGE_ASSISTANTS: False,
            TournamentMembership.PERM_JOIN_SETTINGS: False,
            TournamentMembership.PERM_NAME_CHANGE_APPROVE: False,
        }

        if user and obj.organizer_id == user.id:
            return {
                TournamentMembership.PERM_TEAMS_EDIT: True,
                TournamentMembership.PERM_ROSTER_EDIT: True,
                TournamentMembership.PERM_SCHEDULE_EDIT: True,
                TournamentMembership.PERM_RESULTS_EDIT: True,
                TournamentMembership.PERM_BRACKET_EDIT: True,
                TournamentMembership.PERM_TOURNAMENT_EDIT: True,
                TournamentMembership.PERM_NAME_CHANGE_APPROVE: True,
                TournamentMembership.PERM_PUBLISH: True,
                TournamentMembership.PERM_ARCHIVE: True,
                TournamentMembership.PERM_MANAGE_ASSISTANTS: True,
                TournamentMembership.PERM_JOIN_SETTINGS: True,
            }

        membership = None
        if user:
            membership = self._get_assistant_membership(obj)

        if not membership:
            return base

        if _safe_entry_mode(obj.entry_mode) == Tournament.EntryMode.ORGANIZER_ONLY:
            return base

        eff = membership.effective_permissions()

        base.update(
            {
                TournamentMembership.PERM_TEAMS_EDIT: bool(
                    eff.get(TournamentMembership.PERM_TEAMS_EDIT)
                ),
                TournamentMembership.PERM_ROSTER_EDIT: bool(
                    eff.get(TournamentMembership.PERM_ROSTER_EDIT)
                ),
                TournamentMembership.PERM_SCHEDULE_EDIT: bool(
                    eff.get(TournamentMembership.PERM_SCHEDULE_EDIT)
                ),
                TournamentMembership.PERM_RESULTS_EDIT: bool(
                    eff.get(TournamentMembership.PERM_RESULTS_EDIT)
                ),
                TournamentMembership.PERM_BRACKET_EDIT: bool(
                    eff.get(TournamentMembership.PERM_BRACKET_EDIT)
                ),
                TournamentMembership.PERM_TOURNAMENT_EDIT: bool(
                    eff.get(TournamentMembership.PERM_TOURNAMENT_EDIT)
                ),
                TournamentMembership.PERM_NAME_CHANGE_APPROVE: bool(
                    eff.get(TournamentMembership.PERM_NAME_CHANGE_APPROVE)
                ),
            }
        )
        return base

    def _panel_competition_context(self, obj: Tournament, division: Division | None):
        return division or obj

    def _panel_status_value(self, obj: Tournament, division: Division | None) -> str:
        return division.status if division is not None else obj.status

    def _panel_status_label(self, status_value: str | None) -> str:
        return dict(Tournament.Status.choices).get(status_value, str(status_value or "-"))

    def _mass_start_stage_rounds_count(self, context_obj, stage: Stage) -> int:
        if not hasattr(context_obj, "get_mass_start_stages"):
            return 1

        stage_cfgs = list(context_obj.get_mass_start_stages() or [])
        index = max(0, int(stage.order or 1) - 1)
        if index >= len(stage_cfgs):
            return 1

        stage_cfg = stage_cfgs[index]
        if not isinstance(stage_cfg, dict):
            return 1

        raw_value = stage_cfg.get(Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY, 1)
        try:
            rounds_count = int(raw_value)
        except (TypeError, ValueError):
            rounds_count = 1

        return max(1, rounds_count)

    def get_panel_stats(self, obj: Tournament) -> dict:
        divisions_count = Division.objects.filter(tournament=obj).count()

        teams_qs = Team.objects.filter(tournament=obj, is_active=True).exclude(name=BYE_TEAM_NAME)
        teams_count = teams_qs.count()

        players_qs = TeamPlayer.objects.filter(
            team__tournament=obj,
            team__is_active=True,
            is_active=True,
        ).exclude(team__name=BYE_TEAM_NAME)
        players_count = players_qs.count()

        stages_qs = Stage.objects.filter(tournament=obj)
        stages_total = stages_qs.count()
        stages_closed = stages_qs.filter(status=Stage.Status.CLOSED).count()
        stage_progress_label = f"{stages_closed}/{stages_total}"

        status_value = obj.status
        status_label = self._panel_status_label(status_value)

        matches_qs = Match.objects.filter(tournament=obj).exclude(home_team__name=BYE_TEAM_NAME).exclude(away_team__name=BYE_TEAM_NAME)
        matches_total = matches_qs.count()
        matches_in_progress = matches_qs.filter(status=Match.Status.IN_PROGRESS).count()
        matches_finished = matches_qs.filter(status=Match.Status.FINISHED).count()

        if matches_total > 0:
            return {
                "status": status_value,
                "status_label": status_label,
                "divisions_count": divisions_count,
                "teams_count": teams_count,
                "players_count": players_count,
                "stages_total": stages_total,
                "stages_closed": stages_closed,
                "stage_progress_label": stage_progress_label,
                "progress_mode": "MATCHES",
                "primary_progress_current": matches_in_progress,
                "primary_progress_total": matches_total,
                "primary_progress_label": f"{matches_in_progress}/{matches_total}",
                "secondary_progress_current": matches_finished,
                "secondary_progress_total": matches_total,
                "secondary_progress_label": f"{matches_finished}/{matches_total}",
            }

        mass_start_stages = Stage.objects.filter(tournament=obj, stage_type=Stage.StageType.MASS_START).order_by("order", "id")
        progress_current = 0
        progress_total = 0

        for stage in mass_start_stages:
            context_obj = getattr(stage, "division", None) or obj
            entry_count = StageMassStartEntry.objects.filter(stage=stage, is_active=True).count()
            rounds_count = self._mass_start_stage_rounds_count(context_obj, stage)
            progress_total += entry_count * rounds_count
            progress_current += (
                StageMassStartResult.objects.filter(stage=stage, is_active=True)
                .values("team_id", "round_number")
                .distinct()
                .count()
            )

        return {
            "status": status_value,
            "status_label": status_label,
            "divisions_count": divisions_count,
            "teams_count": teams_count,
            "players_count": players_count,
            "stages_total": stages_total,
            "stages_closed": stages_closed,
            "stage_progress_label": stage_progress_label,
            "progress_mode": "MASS_START" if progress_total > 0 else "NONE",
            "primary_progress_current": progress_current,
            "primary_progress_total": progress_total,
            "primary_progress_label": f"{progress_current}/{progress_total}" if progress_total > 0 else "0/0",
            "secondary_progress_current": None,
            "secondary_progress_total": None,
            "secondary_progress_label": None,
        }

    def get_schedule_targets(self, obj: Tournament) -> dict:
        division = self._get_active_division(obj)
        stages_payload = []
        groups_payload = []

        stages_qs = obj.stages.all()
        if division is not None:
            stages_qs = stages_qs.filter(division=division)

        for stage in stages_qs.order_by("order"):
            stages_payload.append(
                {
                    "stage_id": stage.id,
                    "stage_type": stage.stage_type,
                    "stage_order": stage.order,
                    "stage_name": self._schedule_stage_name(stage),
                    "scheduled_date": stage.scheduled_date.isoformat() if stage.scheduled_date else None,
                    "scheduled_time": stage.scheduled_time.isoformat(timespec="minutes") if stage.scheduled_time else None,
                    "location": stage.location,
                }
            )

            for group in stage.groups.all().order_by("id"):
                groups_payload.append(
                    {
                        "group_id": group.id,
                        "group_name": group.name,
                        "stage_id": stage.id,
                        "stage_order": stage.order,
                        "stage_name": self._schedule_stage_name(stage),
                        "scheduled_date": group.scheduled_date.isoformat() if group.scheduled_date else None,
                        "scheduled_time": group.scheduled_time.isoformat(timespec="minutes") if group.scheduled_time else None,
                        "location": group.location,
                    }
                )

        return {"stages": stages_payload, "groups": groups_payload}

    @staticmethod
    def _schedule_stage_name(stage) -> str:
        if stage.stage_type == getattr(stage.StageType, "LEAGUE", "LEAGUE"):
            return "Liga"
        if stage.stage_type == getattr(stage.StageType, "GROUP", "GROUP"):
            return "Faza grupowa"
        if stage.stage_type == getattr(stage.StageType, "KNOCKOUT", "KNOCKOUT"):
            return "Faza pucharowa"
        if stage.stage_type == getattr(stage.StageType, "THIRD_PLACE", "THIRD_PLACE"):
            return "Mecz o 3. miejsce"
        if stage.stage_type == getattr(stage.StageType, "MASS_START", "MASS_START"):
            return f"Etap {stage.order}"
        return f"Etap {stage.order}"

    def get_matches_started(self, obj: Tournament) -> bool:
        division = self._get_active_division(obj)
        qs = obj.matches.exclude(home_team__name=BYE_TEAM_NAME).exclude(away_team__name=BYE_TEAM_NAME)

        if division is not None:
            qs = qs.filter(stage__division=division)

        return qs.filter(status__in=(Match.Status.IN_PROGRESS, Match.Status.FINISHED)).exists()


class TournamentMetaUpdateSerializer(serializers.ModelSerializer):
    stage_schedule = StageScheduleEntrySerializer(many=True, required=False, write_only=True)
    group_schedule = GroupScheduleEntrySerializer(many=True, required=False, write_only=True)
    division_id = serializers.IntegerField(required=False, write_only=True)
    division_slug = serializers.CharField(required=False, write_only=True)

    class Meta:
        model = Tournament
        fields = (
            "start_date",
            "end_date",
            "location",
            "description",
            "stage_schedule",
            "group_schedule",
            "division_id",
            "division_slug",
        )

    def _get_active_division(self) -> Division | None:
        tournament: Tournament = self.instance

        serializer = TournamentSerializer(context=self.context)
        serializer.instance = tournament
        return _resolve_division_for_serializer(serializer, tournament, required=False)

    def validate(self, attrs):
        start = attrs.get("start_date", getattr(self.instance, "start_date", None))
        end = attrs.get("end_date", getattr(self.instance, "end_date", None))

        if start and end and end < start:
            raise serializers.ValidationError(
                {"end_date": "Data zakończenia nie może być wcześniejsza niż data rozpoczęcia."}
            )

        division_id = attrs.pop("division_id", None)
        division_slug = attrs.pop("division_slug", None)
        if division_id is not None:
            self.context["division_id"] = division_id
        if division_slug not in (None, ""):
            self.context["division_slug"] = division_slug

        self._validate_schedule_entries(
            attrs.get("stage_schedule") or [],
            attrs.get("group_schedule") or [],
            start=start,
            end=end,
        )

        return attrs

    def _validate_schedule_entries(self, stage_schedule, group_schedule, *, start, end):
        division = self._get_active_division()
        stages_qs = self.instance.stages.all()
        if division is not None:
            stages_qs = stages_qs.filter(division=division)

        stage_ids = set(stages_qs.values_list("id", flat=True))
        group_ids = set(stages_qs.values_list("groups__id", flat=True))
        group_ids.discard(None)

        def _validate_range(prefix: str, payload: dict):
            value = payload.get("scheduled_date")
            if not value:
                return
            if start and value < start:
                raise serializers.ValidationError({prefix: "Data nie może być wcześniejsza niż start turnieju."})
            if end and value > end:
                raise serializers.ValidationError({prefix: "Data nie może być późniejsza niż koniec turnieju."})

        for entry in stage_schedule:
            if entry["stage_id"] not in stage_ids:
                raise serializers.ValidationError({"stage_schedule": "Wskazano nieprawidłowy etap."})
            _validate_range("stage_schedule", entry)

        for entry in group_schedule:
            if entry["group_id"] not in group_ids:
                raise serializers.ValidationError({"group_schedule": "Wskazano nieprawidłową grupę."})
            _validate_range("group_schedule", entry)

    def update(self, instance, validated_data):
        stage_schedule = validated_data.pop("stage_schedule", None)
        group_schedule = validated_data.pop("group_schedule", None)

        instance = super().update(instance, validated_data)
        division = self._get_active_division()

        stages_qs = instance.stages.all()
        if division is not None:
            stages_qs = stages_qs.filter(division=division)

        if stage_schedule is not None:
            stages = {stage.id: stage for stage in stages_qs}
            for entry in stage_schedule:
                stage = stages.get(entry["stage_id"])
                if not stage:
                    continue
                stage.scheduled_date = entry.get("scheduled_date")
                stage.scheduled_time = entry.get("scheduled_time")
                stage.location = entry.get("location") or None
                stage.save(update_fields=["scheduled_date", "scheduled_time", "location"])

        if group_schedule is not None:
            groups = {}
            for stage in stages_qs.prefetch_related("groups"):
                for group in stage.groups.all():
                    groups[group.id] = group

            for entry in group_schedule:
                group = groups.get(entry["group_id"])
                if not group:
                    continue
                group.scheduled_date = entry.get("scheduled_date")
                group.scheduled_time = entry.get("scheduled_time")
                group.location = entry.get("location") or None
                group.save(update_fields=["scheduled_date", "scheduled_time", "location"])

        return instance