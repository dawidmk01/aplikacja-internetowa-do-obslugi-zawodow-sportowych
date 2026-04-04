# backend/tournaments/serializers/generate.py
# Plik definiuje walidację wejścia dla generowania struktury rozgrywek turnieju.

from rest_framework import serializers

from tournaments.models import Tournament


class GenerateTournamentSerializer(serializers.Serializer):
    def validate(self, attrs):
        tournament: Tournament = self.context["tournament"]

        if tournament.status != Tournament.Status.DRAFT:
            raise serializers.ValidationError(
                "Rozgrywki można wygenerować tylko w statusie DRAFT."
            )

        teams_count = tournament.teams.filter(is_active=True).count()
        if teams_count < 2:
            raise serializers.ValidationError("Turniej musi mieć co najmniej 2 uczestników.")

        if tournament.discipline == Tournament.Discipline.CUSTOM:
            if tournament.result_mode != Tournament.ResultMode.CUSTOM:
                raise serializers.ValidationError(
                    "Dla dyscypliny niestandardowej wymagany jest result_mode=CUSTOM."
                )

            try:
                tournament.normalize_result_config(
                    tournament.result_mode,
                    tournament.result_config,
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

            if tournament.competition_model == Tournament.CompetitionModel.HEAD_TO_HEAD:
                allowed_formats = Tournament.allowed_formats_for_discipline(Tournament.Discipline.CUSTOM)
                if tournament.tournament_format not in allowed_formats:
                    raise serializers.ValidationError(
                        {"tournament_format": "Dla dyscypliny niestandardowej wybierz poprawny format turnieju."}
                    )

            if tournament.competition_model == Tournament.CompetitionModel.MASS_START:
                stages = tournament.result_config.get(Tournament.RESULTCFG_STAGES_KEY) or []
                if not stages:
                    raise serializers.ValidationError(
                        {"result_config": "Dla trybu 'wszyscy razem' wymagany jest co najmniej jeden aktywny etap."}
                    )

        return attrs
