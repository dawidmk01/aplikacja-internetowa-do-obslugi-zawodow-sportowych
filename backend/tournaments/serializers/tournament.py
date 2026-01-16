from __future__ import annotations

from django.contrib.auth import get_user_model
from rest_framework import serializers

from tournaments.models import Match, Tournament, TournamentMembership, TournamentRegistration

User = get_user_model()

TENIS_POINTS_MODES = ("NONE", "PLT")
BYE_TEAM_NAME = "__SYSTEM_BYE__"


def _normalize_format_config(discipline: str | None, cfg) -> dict:
    """
    Ujednolica format_config:
    - zawsze dict
    - dla tenisa: gwarantuje tennis_points_mode ∈ {NONE, PLT} (domyślnie NONE)
    - dla innych dyscyplin: usuwa tennis_points_mode, jeśli ktoś go podał
    """
    discipline = (discipline or "").lower()

    if cfg is None:
        cfg = {}
    if not isinstance(cfg, dict):
        raise serializers.ValidationError(
            {"format_config": "format_config musi być obiektem JSON (dict)."}
        )

    cfg = dict(cfg)  # kopia

    if discipline == "tennis":
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


class TournamentSerializer(serializers.ModelSerializer):
    """
    Zasady:
    - name: zawsze edytowalne
    - discipline: po DRAFT tylko przez /change-discipline/
    - setup (format/config): po DRAFT tylko przez /change-setup/
    - liczba uczestników NIE jest częścią konfiguracji (pochodzi z Team)
    """

    my_role = serializers.SerializerMethodField()
    matches_started = serializers.SerializerMethodField()

    class Meta:
        model = Tournament
        fields = "__all__"
        read_only_fields = (
            "organizer",
            "status",
            "created_at",
            "my_role",
            "matches_started",
        )

    # ============================================================
    # UKRYWANIE PÓL WRAŻLIWYCH (READ)
    # ============================================================

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")

        # Kody (access + registration) widoczne tylko dla organizatora
        if not request or not request.user.is_authenticated or instance.organizer_id != request.user.id:
            data.pop("access_code", None)
            data.pop("registration_code", None)

        return data

    # ============================================================
    # WALIDACJA FORMATU VS DYSCYPLINA
    # ============================================================

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

    # ============================================================
    # WALIDACJA KONTEKSTOWA (STATUS / ROLE)
    # ============================================================

    def validate(self, attrs):
        request = self.context.get("request")
        instance = self.instance

        # Ujednolicamy format_config także wtedy, gdy przychodzi w PATCH/POST
        if "format_config" in attrs:
            discipline = attrs.get("discipline") or (
                instance.discipline if instance else None
            )
            attrs["format_config"] = _normalize_format_config(
                discipline, attrs.get("format_config")
            )

        # Jeśli to CREATE (instance None) lub brak usera, nie narzucamy reguł zmian po DRAFT
        if not request or not request.user.is_authenticated or not instance:
            return attrs

        # --------------------------------------------
        # Dyscyplina po DRAFT -> tylko change-discipline
        # --------------------------------------------
        if instance.status != Tournament.Status.DRAFT and "discipline" in attrs:
            raise serializers.ValidationError(
                {
                    "discipline": (
                        "Zmiana dyscypliny po konfiguracji turnieju wymaga resetu. "
                        "Użyj endpointu: POST /api/tournaments/<id>/change-discipline/"
                    )
                }
            )

        # --------------------------------------------
        # Setup po DRAFT -> tylko change-setup
        # --------------------------------------------
        if instance.status != Tournament.Status.DRAFT and any(
            f in attrs for f in ("tournament_format", "format_config")
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

        # ============================================================
        # UPRAWNIENIA
        # ============================================================

        is_organizer = instance.organizer_id == request.user.id
        is_assistant = instance.memberships.filter(
            user=request.user,
            role=TournamentMembership.Role.ASSISTANT,
        ).exists()

        # Widoczność / kody / tryby – tylko organizator
        if not is_organizer:
            attrs.pop("is_published", None)
            attrs.pop("access_code", None)
            attrs.pop("registration_code", None)
            attrs.pop("entry_mode", None)

        # Konfiguracja sportowa – organizator lub asystent
        # (entry_mode usunięte stąd, bo jest wyżej - tylko organizer)
        if not (is_organizer or is_assistant):
            for field in (
                "competition_type",
                "tournament_format",
                "format_config",
            ):
                attrs.pop(field, None)

        return attrs

    # ============================================================
    # CREATE
    # ============================================================

    def create(self, validated_data):
        if "competition_type" not in validated_data:
            validated_data["competition_type"] = (
                Tournament.infer_default_competition_type(
                    validated_data.get("discipline")
                )
            )

        discipline = (validated_data.get("discipline") or "").lower()
        validated_data["format_config"] = _normalize_format_config(
            discipline,
            validated_data.get("format_config"),
        )

        return super().create(validated_data)

    # ============================================================
    # META
    # ============================================================

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

        # Sprawdzenie czy użytkownik jest zarejestrowanym uczestnikiem
        if TournamentRegistration.objects.filter(tournament=obj, user=request.user).exists():
            return "PARTICIPANT"

        return None

    def get_matches_started(self, obj: Tournament) -> bool:
        """
        True tylko jeśli rozpoczął się REALNY mecz (nie techniczny BYE):
        istnieje mecz IN_PROGRESS lub FINISHED, w którym NIE gra __SYSTEM_BYE__.
        """
        return (
            obj.matches.exclude(home_team__name=BYE_TEAM_NAME)
            .exclude(away_team__name=BYE_TEAM_NAME)
            .filter(status__in=(Match.Status.IN_PROGRESS, Match.Status.FINISHED))
            .exists()
        )


class TournamentMetaUpdateSerializer(serializers.ModelSerializer):
    """
    Serializer do edycji pól meta turnieju:
    - start_date, end_date, location
    - description
    Endpoint: PATCH /api/tournaments/{id}/meta/
    """

    class Meta:
        model = Tournament
        fields = ("start_date", "end_date", "location", "description")

    def validate(self, attrs):
        start = attrs.get("start_date", getattr(self.instance, "start_date", None))
        end = attrs.get("end_date", getattr(self.instance, "end_date", None))
        if start and end and end < start:
            raise serializers.ValidationError(
                {
                    "end_date": "Data zakończenia nie może być wcześniejsza niż data rozpoczęcia."
                }
            )
        return attrs