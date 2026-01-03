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

        return attrs
