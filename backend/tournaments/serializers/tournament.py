from django.contrib.auth import get_user_model
from rest_framework import serializers

from tournaments.models import Tournament, TournamentMembership

User = get_user_model()

TENIS_POINTS_MODES = ("NONE", "PLT")


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
        raise serializers.ValidationError({"format_config": "format_config musi być obiektem JSON (dict)."})

    cfg = dict(cfg)  # kopia

    if discipline == "tennis":
        mode = (cfg.get("tennis_points_mode") or "NONE")
        if mode not in TENIS_POINTS_MODES:
            raise serializers.ValidationError(
                {"format_config": {"tennis_points_mode": f"Dozwolone: {', '.join(TENIS_POINTS_MODES)}"}}
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

    class Meta:
        model = Tournament
        fields = "__all__"
        read_only_fields = (
            "organizer",
            "status",
            "created_at",
            "my_role",
        )

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
            discipline = attrs.get("discipline") or (instance.discipline if instance else None)
            attrs["format_config"] = _normalize_format_config(discipline, attrs.get("format_config"))

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

        # Widoczność – tylko organizator
        if not is_organizer:
            attrs.pop("is_published", None)
            attrs.pop("access_code", None)

        # Konfiguracja – organizator lub asystent
        if not (is_organizer or is_assistant):
            for field in (
                "entry_mode",
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

        # Domyślny config dla tenisa
        discipline = (validated_data.get("discipline") or "").lower()
        validated_data["format_config"] = _normalize_format_config(discipline, validated_data.get("format_config"))

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

        return None
