# backend/tournaments/serializers/teams.py
# Plik definiuje serializery odpowiedzialne za odczyt i edycję uczestników w kontekście dywizji turnieju.

from __future__ import annotations

from rest_framework import serializers

from tournaments.models import Division, Team, Tournament


def _extract_requested_division_ref(serializer: serializers.Serializer) -> tuple[int | None, str | None]:
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


def _resolve_division(serializer: serializers.Serializer, tournament: Tournament) -> Division | None:
    division_id, division_slug = _extract_requested_division_ref(serializer)
    divisions_qs = tournament.divisions.all().order_by("order", "id")

    if division_id is not None:
        division = divisions_qs.filter(pk=division_id).first()
        if not division:
            raise serializers.ValidationError(
                {"division_id": "Wskazana dywizja nie należy do tego turnieju."}
            )
        return division

    if division_slug is not None:
        division = divisions_qs.filter(slug=division_slug).first()
        if not division:
            raise serializers.ValidationError(
                {"division_slug": "Wskazana dywizja nie należy do tego turnieju."}
            )
        return division

    return tournament.get_default_division()


class TeamSerializer(serializers.ModelSerializer):
    players_count = serializers.SerializerMethodField()
    division_id = serializers.IntegerField(source="division.id", read_only=True, allow_null=True)
    division_name = serializers.CharField(source="division.name", read_only=True, allow_null=True)

    class Meta:
        model = Team
        fields = (
            "id",
            "tournament",
            "division",
            "division_id",
            "division_name",
            "name",
            "is_active",
            "created_at",
            "players_count",
        )
        read_only_fields = (
            "id",
            "tournament",
            "created_at",
            "players_count",
            "division_id",
            "division_name",
        )

    def get_players_count(self, obj: Team) -> int:
        return obj.players.filter(is_active=True).count()

    def validate_name(self, value: str) -> str:
        if not value or not value.strip():
            raise serializers.ValidationError("Nazwa nie może być pusta.")
        return value.strip()

    def validate_division(self, value: Division | None) -> Division | None:
        tournament: Tournament | None = self.context.get("tournament") or getattr(self.instance, "tournament", None)

        if value is None:
            raise serializers.ValidationError("Uczestnik musi być przypisany do dywizji.")

        if tournament is not None and value.tournament_id != tournament.id:
            raise serializers.ValidationError("Wskazana dywizja nie należy do tego turnieju.")

        return value

    def validate(self, attrs):
        tournament: Tournament | None = self.context.get("tournament") or getattr(self.instance, "tournament", None)
        requested_division = _resolve_division(self, tournament) if tournament is not None else None

        division = attrs.get("division")
        if division is None:
            division = requested_division or getattr(self.instance, "division", None)

        if tournament is not None and division is not None and division.tournament_id != tournament.id:
            raise serializers.ValidationError({"division": "Wskazana dywizja nie należy do tego turnieju."})

        if requested_division is not None and division is not None and requested_division.id != division.id:
            raise serializers.ValidationError(
                {"division": "Serializer działa w kontekście innej aktywnej dywizji niż przekazana w danych."}
            )

        return attrs


class TeamUpdateSerializer(serializers.ModelSerializer):
    division_id = serializers.IntegerField(required=False, write_only=True)
    division_slug = serializers.CharField(required=False, write_only=True)

    class Meta:
        model = Team
        fields = ("name", "division", "division_id", "division_slug")

    def validate_name(self, value):
        if value is None:
            return value
        if not str(value).strip():
            raise serializers.ValidationError("Nazwa nie może być pusta.")
        return str(value).strip()

    def validate_division(self, value: Division | None) -> Division | None:
        team = self.instance
        tournament = self.context.get("tournament") or (team.tournament if team else None)

        if value is None:
            raise serializers.ValidationError("Uczestnik musi być przypisany do dywizji.")

        if tournament is not None and value.tournament_id != tournament.id:
            raise serializers.ValidationError("Wskazana dywizja nie należy do tego turnieju.")

        return value

    def validate(self, attrs):
        team = self.instance
        tournament = self.context.get("tournament") or (team.tournament if team else None)
        requested_division = _resolve_division(self, tournament) if tournament is not None else None

        if "division" not in attrs and requested_division is not None:
            attrs["division"] = requested_division

        division = attrs.get("division") or getattr(team, "division", None)
        if tournament is not None and division is not None and division.tournament_id != tournament.id:
            raise serializers.ValidationError({"division": "Wskazana dywizja nie należy do tego turnieju."})

        return attrs
