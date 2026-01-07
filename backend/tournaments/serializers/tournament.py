from django.contrib.auth import get_user_model
from rest_framework import serializers

from tournaments.models import Tournament, TournamentMembership

User = get_user_model()


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

    # ============================================================
    # WALIDACJA KONTEKSTOWA (STATUS / ROLE)
    # ============================================================

    def validate(self, attrs):
        request = self.context.get("request")
        instance = self.instance

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
