# backend/tournaments/serializers/generate.py
# Plik definiuje walidację generowania struktury rozgrywek w kontekście aktywnej dywizji turnieju.

from __future__ import annotations

from rest_framework import serializers

from tournaments.models import Division, Tournament


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

    division = tournament.get_default_division()
    if division:
        return division

    if tournament.divisions.exists():
        raise serializers.ValidationError(
            {"division_id": "Turniej ma wiele dywizji i wymaga wskazania aktywnej dywizji."}
        )

    return None


def _competition_context(tournament: Tournament, division: Division | None) -> dict:
    if division is None:
        return {
            "status": tournament.status,
            "competition_type": tournament.competition_type,
            "competition_model": tournament.competition_model,
            "tournament_format": tournament.tournament_format,
            "result_mode": tournament.result_mode,
            "result_config": dict(tournament.result_config or {}),
        }

    return {
        "status": division.status,
        "competition_type": division.competition_type,
        "competition_model": division.competition_model,
        "tournament_format": division.tournament_format,
        "result_mode": division.result_mode,
        "result_config": dict(division.result_config or {}),
    }


class GenerateTournamentSerializer(serializers.Serializer):
    def validate(self, attrs):
        tournament: Tournament = self.context["tournament"]
        division = _resolve_division(self, tournament)
        context = _competition_context(tournament, division)

        if division is not None and division.is_archived:
            raise serializers.ValidationError(
                {"division_id": "Nie można wygenerować rozgrywek dla zarchiwizowanej dywizji."}
            )

        if context["status"] != Tournament.Status.DRAFT:
            raise serializers.ValidationError(
                "Rozgrywki można wygenerować tylko dla dywizji w statusie DRAFT."
            )

        teams_qs = tournament.teams.filter(is_active=True)
        if division is not None:
            teams_qs = teams_qs.filter(division=division)

        teams_count = teams_qs.count()
        if teams_count < 2:
            raise serializers.ValidationError(
                "Aktywna dywizja musi mieć co najmniej 2 uczestników."
            )

        if tournament.discipline == Tournament.Discipline.CUSTOM:
            result_mode = context["result_mode"]
            result_config = context["result_config"]
            competition_model = context["competition_model"]
            tournament_format = context["tournament_format"]

            if result_mode != Tournament.ResultMode.CUSTOM:
                raise serializers.ValidationError(
                    "Dla dyscypliny niestandardowej wymagany jest result_mode=CUSTOM."
                )

            try:
                normalized_result_config = Tournament.normalize_result_config(
                    result_mode,
                    result_config,
                )
            except ValueError as exc:
                raise serializers.ValidationError(
                    {"result_config": str(exc)}
                ) from exc

            custom_name = (tournament.custom_discipline_name or "").strip()
            if not custom_name:
                raise serializers.ValidationError(
                    {"custom_discipline_name": "Dla dyscypliny niestandardowej podaj własną nazwę."}
                )

            if competition_model == Tournament.CompetitionModel.HEAD_TO_HEAD:
                allowed_formats = Tournament.allowed_formats_for_discipline(
                    Tournament.Discipline.CUSTOM
                )
                if tournament_format not in allowed_formats:
                    raise serializers.ValidationError(
                        {
                            "tournament_format": (
                                "Dla dyscypliny niestandardowej wybierz poprawny format turnieju."
                            )
                        }
                    )

            if competition_model == Tournament.CompetitionModel.MASS_START:
                stages = normalized_result_config.get(Tournament.RESULTCFG_STAGES_KEY) or []
                if not stages:
                    raise serializers.ValidationError(
                        {
                            "result_config": (
                                "Dla trybu 'wszyscy razem' wymagany jest co najmniej jeden aktywny etap."
                            )
                        }
                    )

        attrs["division"] = division
        return attrs