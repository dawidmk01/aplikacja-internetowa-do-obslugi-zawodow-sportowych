from django.contrib.auth import get_user_model
from rest_framework import serializers

from .models import (
    Tournament,
    TournamentMembership,
    Team,
    Division,
    Stage,
    Match,
)

User = get_user_model()

# ============================================================
# TURNIEJ
# ============================================================

class TournamentSerializer(serializers.ModelSerializer):
    """
    Serializer konfiguracji turnieju.
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

    # --------------------------------------------------------
    # WALIDACJE PÓL
    # --------------------------------------------------------

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

    def validate_participants_count(self, value):
        if value < 2:
            raise serializers.ValidationError(
                "Liczba uczestników musi wynosić co najmniej 2."
            )
        return value

    # --------------------------------------------------------
    # WALIDACJA GLOBALNA
    # --------------------------------------------------------

    def validate(self, attrs):
        request = self.context.get("request")
        instance = self.instance

        if not request or not request.user.is_authenticated or not instance:
            return attrs

        # Blokada edycji po wygenerowaniu rozgrywek
        if instance.status != Tournament.Status.DRAFT:
            for field in (
                "discipline",
                "competition_type",
                "tournament_format",
                "participants_count",
                "format_config",
                "entry_mode",
            ):
                attrs.pop(field, None)

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
                "participants_count",
                "format_config",
            ):
                attrs.pop(field, None)

        # Walidacja formatu mieszanego
        tournament_format = attrs.get(
            "tournament_format", instance.tournament_format
        )
        participants_count = attrs.get(
            "participants_count", instance.participants_count
        )

        if (
            tournament_format == Tournament.TournamentFormat.MIXED
            and participants_count < 4
        ):
            raise serializers.ValidationError(
                {
                    "participants_count": (
                        "Format mieszany wymaga co najmniej 4 uczestników."
                    )
                }
            )

        return attrs

    # --------------------------------------------------------
    # CREATE
    # --------------------------------------------------------

    def create(self, validated_data):
        if "competition_type" not in validated_data:
            validated_data["competition_type"] = (
                Tournament.infer_default_competition_type(
                    validated_data.get("discipline")
                )
            )
        return super().create(validated_data)

    # --------------------------------------------------------
    # ROLA UŻYTKOWNIKA
    # --------------------------------------------------------

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


# ============================================================
# WSPÓŁORGANIZATORZY
# ============================================================

class TournamentAssistantSerializer(serializers.ModelSerializer):
    user_id = serializers.IntegerField(source="user.id", read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)
    username = serializers.CharField(source="user.username", read_only=True)

    class Meta:
        model = TournamentMembership
        fields = (
            "user_id",
            "email",
            "username",
            "role",
            "created_at",
        )


class AddAssistantSerializer(serializers.Serializer):
    email = serializers.EmailField()

    def validate_email(self, value):
        try:
            return User.objects.get(email=value)
        except User.DoesNotExist:
            raise serializers.ValidationError(
                "Użytkownik o podanym adresie e-mail nie istnieje."
            )

    def validate(self, attrs):
        tournament = self.context["tournament"]
        user = attrs["email"]

        if tournament.organizer_id == user.id:
            raise serializers.ValidationError(
                "Organizator nie może dodać samego siebie."
            )

        if TournamentMembership.objects.filter(
            tournament=tournament,
            user=user,
        ).exists():
            raise serializers.ValidationError(
                "Użytkownik jest już współorganizatorem."
            )

        attrs["user"] = user
        return attrs


# ============================================================
# UCZESTNICY
# ============================================================

class TeamSerializer(serializers.ModelSerializer):
    """
    Serializer jednostki startowej turnieju (drużyna / zawodnik).
    """

    class Meta:
        model = Team
        fields = (
            "id",
            "tournament",
            "division",
            "name",
            "is_active",
            "created_at",
        )
        read_only_fields = (
            "id",
            "tournament",
            "created_at",
        )

    def validate_name(self, value):
        if not value or not value.strip():
            raise serializers.ValidationError(
                "Nazwa nie może być pusta."
            )
        return value.strip()



class TeamUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Team
        fields = (
            "name",
        )


# ============================================================
# GENEROWANIE ROZGRYWEK
# ============================================================


class GenerateTournamentSerializer(serializers.Serializer):
    def validate(self, attrs):
        tournament: Tournament = self.context["tournament"]

        if tournament.status != Tournament.Status.DRAFT:
            raise serializers.ValidationError(
                "Rozgrywki można wygenerować tylko w statusie DRAFT."
            )

        teams_count = tournament.teams.filter(is_active=True).count()

        if teams_count < 2:
            raise serializers.ValidationError(
                "Turniej musi mieć co najmniej 2 uczestników."
            )

        return attrs



# ============================================================
# MECZE
# ============================================================


class MatchSerializer(serializers.ModelSerializer):
    home_team_name = serializers.CharField(
        source="home_team.name",
        read_only=True,
    )
    away_team_name = serializers.CharField(
        source="away_team.name",
        read_only=True,
    )

    stage_type = serializers.CharField(
        source="stage.stage_type",
        read_only=True,
    )

    stage_id = serializers.IntegerField(
        source="stage.id",
        read_only=True,
    )

    class Meta:
        model = Match
        fields = (
            "id",
            "stage_id",
            "stage_type",
            "round_number",
            "home_team_name",
            "away_team_name",
            "home_score",
            "away_score",
            "status",
            "scheduled_date",
            "scheduled_time",
            "location",
        )


class MatchScheduleUpdateSerializer(serializers.ModelSerializer):
    """
    Serializer do edycji harmonogramu pojedynczego meczu.
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
    Serializer do wprowadzania wyniku meczu.
    PATCH /api/matches/:id/result/
    """

    class Meta:
        model = Match
        fields = (
            "home_score",
            "away_score",
            "status",
        )
