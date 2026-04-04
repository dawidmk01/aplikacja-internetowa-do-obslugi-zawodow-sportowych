# backend/tournaments/serializers/tournament.py
# Plik definiuje serializery odpowiedzialne za walidację i kontrakt API konfiguracji turnieju.

from __future__ import annotations

from django.contrib.auth import get_user_model
from rest_framework import serializers

from tournaments.models import Match, Tournament, TournamentMembership, TournamentRegistration

User = get_user_model()

TENIS_POINTS_MODES = ("NONE", "PLT")
BYE_TEAM_NAME = "__SYSTEM_BYE__"
ACTIVE_ENTRY_MODES = (Tournament.EntryMode.MANAGER, Tournament.EntryMode.ORGANIZER_ONLY)


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

    return cfg


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
        return Tournament.normalize_result_config(mode, cfg)
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

    # Pozwala utworzyć szkic custom bez pełnej konfiguracji, aby wejść do formularza setup.
    if "custom_discipline_name" not in attrs:
        return True

    raw_name = attrs.get("custom_discipline_name")
    return not bool((raw_name or "").strip())


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
    # Pola wyliczane utrzymują kontrakt panelu bez duplikowania logiki po stronie frontu.
    my_role = serializers.SerializerMethodField()
    matches_started = serializers.SerializerMethodField()
    my_permissions = serializers.SerializerMethodField()
    schedule_targets = serializers.SerializerMethodField()

    # Te aliasy utrzymują spójny kontrakt API mimo legacy nazw w modelu.
    allow_join_by_code = serializers.BooleanField(required=False, source="join_enabled")
    join_code = serializers.CharField(
        required=False,
        allow_null=True,
        allow_blank=True,
        source="registration_code",
    )

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
        )

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")

        if "entry_mode" in data:
            data["entry_mode"] = _safe_entry_mode(data.get("entry_mode"))

        data.pop("join_enabled", None)
        data.pop("registration_code", None)

        if instance.discipline != Tournament.Discipline.CUSTOM:
            data["custom_discipline_name"] = None

        if instance.result_mode != Tournament.ResultMode.CUSTOM:
            data["result_config"] = {}

        if not request or not request.user.is_authenticated or instance.organizer_id != request.user.id:
            data.pop("access_code", None)
            data.pop("join_code", None)

        return data

    def validate_tournament_format(self, value):
        discipline = (
            self.initial_data.get("discipline")
            or (self.instance.discipline if self.instance else None)
        )

        if discipline:
            allowed = Tournament.allowed_formats_for_discipline(discipline)
            if value not in allowed:
                raise serializers.ValidationError(
                    "Wybrany format nie jest dostępny dla tej dyscypliny."
                )
        return value

    def validate_format_config(self, value):
        discipline = (
            self.initial_data.get("discipline")
            or (self.instance.discipline if self.instance else None)
        )
        return _normalize_format_config(discipline, value)

    def validate_entry_mode(self, value: str):
        if value not in ACTIVE_ENTRY_MODES:
            raise serializers.ValidationError(
                "Nieprawidłowy tryb panelu. Dozwolone: MANAGER, ORGANIZER_ONLY."
            )
        return value

    def validate_result_mode(self, value: str):
        return _normalize_result_mode(value)

    def validate_result_config(self, value):
        result_mode = (
            self.initial_data.get("result_mode")
            or (self.instance.result_mode if self.instance else Tournament.ResultMode.SCORE)
        )
        return _normalize_result_config(result_mode, value)

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

        discipline = attrs.get("discipline") or (instance.discipline if instance else None)
        competition_type = attrs.get("competition_type") or (
            instance.competition_type if instance else None
        )
        competition_model = attrs.get("competition_model") or (
            instance.competition_model if instance else None
        )
        result_mode = attrs.get("result_mode") or (
            instance.result_mode if instance else Tournament.ResultMode.SCORE
        )
        custom_discipline_name = attrs.get("custom_discipline_name")
        current_custom_name = instance.custom_discipline_name if instance else None

        if "format_config" in attrs:
            attrs["format_config"] = _normalize_format_config(
                discipline,
                attrs.get("format_config"),
            )

        if "result_config" in attrs or "result_mode" in attrs:
            attrs["result_config"] = _normalize_result_config(
                result_mode,
                attrs.get("result_config", instance.result_config if instance else None),
            )

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

        is_custom_bootstrap = _is_draft_custom_bootstrap(
            serializer=self,
            discipline=discipline,
            attrs=attrs,
        )

        if discipline == Tournament.Discipline.CUSTOM:
            effective_name = (
                custom_discipline_name if "custom_discipline_name" in attrs else current_custom_name
            )
            effective_name = (effective_name or "").strip()

            if is_custom_bootstrap:
                attrs["custom_discipline_name"] = None
                attrs["competition_type"] = (
                    competition_type or Tournament.CompetitionType.INDIVIDUAL
                )
                attrs["competition_model"] = (
                    competition_model or Tournament.CompetitionModel.MASS_START
                )
                attrs["result_mode"] = Tournament.ResultMode.SCORE
                attrs["result_config"] = {}
            else:
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
                                "Dla w pełni skonfigurowanej dyscypliny niestandardowej wymagany jest result_mode=CUSTOM."
                            )
                        }
                    )

                attrs["custom_discipline_name"] = effective_name
                attrs["result_mode"] = Tournament.ResultMode.CUSTOM
                attrs["result_config"] = _normalize_result_config(
                    Tournament.ResultMode.CUSTOM,
                    attrs.get("result_config", instance.result_config if instance else None),
                )

        else:
            attrs["custom_discipline_name"] = None

            if result_mode == Tournament.ResultMode.CUSTOM:
                raise serializers.ValidationError(
                    {
                        "result_mode": (
                            "Tryb CUSTOM jest obecnie dostępny tylko dla dyscypliny niestandardowej."
                        )
                    }
                )

            attrs["result_mode"] = Tournament.ResultMode.SCORE
            attrs["result_config"] = {}
            attrs["competition_model"] = Tournament.infer_default_competition_model(discipline)

        if not request or not request.user.is_authenticated or not instance:
            if "entry_mode" in attrs:
                attrs["entry_mode"] = self.validate_entry_mode(attrs["entry_mode"])
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
            instance.status != Tournament.Status.DRAFT
            and discipline != Tournament.Discipline.CUSTOM
            and any(
                field in attrs
                for field in (
                    "tournament_format",
                    "format_config",
                    "competition_type",
                    "competition_model",
                    "result_mode",
                    "result_config",
                )
            )
        ):
            raise serializers.ValidationError(
                {
                    "detail": (
                        "Zmiana konfiguracji turnieju po wygenerowaniu rozgrywek "
                        "wymaga resetu etapów i meczów. "
                        "Użyj endpointu: POST /api/tournaments/<id>/change-setup/"
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
            for field in (
                "competition_type",
                "competition_model",
                "tournament_format",
                "format_config",
                "custom_discipline_name",
                "result_mode",
                "result_config",
            ):
                attrs.pop(field, None)

        if is_organizer and "entry_mode" in attrs:
            attrs["entry_mode"] = self.validate_entry_mode(attrs["entry_mode"])

        return attrs

    def create(self, validated_data):
        discipline = validated_data.get("discipline")

        if "competition_type" not in validated_data:
            if discipline == Tournament.Discipline.CUSTOM:
                validated_data["competition_type"] = Tournament.CompetitionType.INDIVIDUAL
            else:
                validated_data["competition_type"] = Tournament.infer_default_competition_type(
                    discipline
                )

        if "competition_model" not in validated_data:
            validated_data["competition_model"] = Tournament.infer_default_competition_model(
                discipline
            )

        is_custom_bootstrap = (
            discipline == Tournament.Discipline.CUSTOM
            and not bool((validated_data.get("custom_discipline_name") or "").strip())
        )

        if discipline == Tournament.Discipline.CUSTOM:
            if is_custom_bootstrap:
                validated_data["result_mode"] = Tournament.ResultMode.SCORE
                validated_data["result_config"] = {}
                validated_data["custom_discipline_name"] = None
            else:
                validated_data["result_mode"] = Tournament.ResultMode.CUSTOM
        else:
            validated_data["result_mode"] = Tournament.ResultMode.SCORE
            validated_data["custom_discipline_name"] = None
            validated_data["result_config"] = {}

        validated_data["format_config"] = _normalize_format_config(
            discipline,
            validated_data.get("format_config"),
        )

        if validated_data["result_mode"] == Tournament.ResultMode.CUSTOM:
            validated_data["result_config"] = _normalize_result_config(
                validated_data.get("result_mode"),
                validated_data.get("result_config"),
            )
        else:
            validated_data["result_config"] = {}

        if "entry_mode" in validated_data:
            validated_data["entry_mode"] = self.validate_entry_mode(validated_data["entry_mode"])

        return super().create(validated_data)

    def get_my_role(self, obj):
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return None

        if obj.organizer_id == request.user.id:
            return "ORGANIZER"

        if obj.memberships.filter(
            user=request.user,
            role=TournamentMembership.Role.ASSISTANT,
        ).exists():
            return TournamentMembership.Role.ASSISTANT

        if TournamentRegistration.objects.filter(tournament=obj, user=request.user).exists():
            return "PARTICIPANT"

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
            membership = TournamentMembership.objects.filter(
                tournament=obj,
                user=user,
                role=TournamentMembership.Role.ASSISTANT,
            ).first()

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

    def get_schedule_targets(self, obj: Tournament) -> dict:
        stages_payload = []
        groups_payload = []

        for stage in obj.stages.all().order_by("order"):
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
        return (
            obj.matches.exclude(home_team__name=BYE_TEAM_NAME)
            .exclude(away_team__name=BYE_TEAM_NAME)
            .filter(status__in=(Match.Status.IN_PROGRESS, Match.Status.FINISHED))
            .exists()
        )


class TournamentMetaUpdateSerializer(serializers.ModelSerializer):
    # Serializer ogranicza edycję do lekkich pól opisowych bez resetu konfiguracji.
    stage_schedule = StageScheduleEntrySerializer(many=True, required=False, write_only=True)
    group_schedule = GroupScheduleEntrySerializer(many=True, required=False, write_only=True)

    class Meta:
        model = Tournament
        fields = ("start_date", "end_date", "location", "description", "stage_schedule", "group_schedule")

    def validate(self, attrs):
        start = attrs.get("start_date", getattr(self.instance, "start_date", None))
        end = attrs.get("end_date", getattr(self.instance, "end_date", None))

        if start and end and end < start:
            raise serializers.ValidationError(
                {"end_date": "Data zakończenia nie może być wcześniejsza niż data rozpoczęcia."}
            )

        self._validate_schedule_entries(
            attrs.get("stage_schedule") or [],
            attrs.get("group_schedule") or [],
            start=start,
            end=end,
        )

        return attrs

    def _validate_schedule_entries(self, stage_schedule, group_schedule, *, start, end):
        stage_ids = set(self.instance.stages.values_list("id", flat=True))
        group_ids = set(
            self.instance.stages.all().values_list("groups__id", flat=True)
        )
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

        if stage_schedule is not None:
            stages = {stage.id: stage for stage in instance.stages.all()}
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
            for stage in instance.stages.all().prefetch_related("groups"):
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