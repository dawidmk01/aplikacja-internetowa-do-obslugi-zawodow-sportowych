# backend/tournaments/tests/test_archive_mass_start_guards.py
# Plik testuje blokowanie zapisu wyników MASS_START po archiwizacji turnieju.

from django.test import TestCase
from rest_framework.test import APIClient

from tournaments.models import (
    Division,
    Group,
    Stage,
    StageMassStartEntry,
    StageMassStartResult,
    Team,
    Tournament,
)

from .helpers import create_test_user


class TournamentArchivedMassStartGuardTests(TestCase):
    """Testy zabezpieczają endpoint wyników MASS_START przed zapisem w archiwum."""

    def setUp(self):
        self.organizer = create_test_user("archive-mass-start-owner@example.com")
        self.client = APIClient()

        result_config = {
            Tournament.RESULTCFG_VALUE_KIND_KEY: Tournament.RESULTCFG_VALUE_KIND_NUMBER,
            Tournament.RESULTCFG_UNIT_KEY: "pkt",
            Tournament.RESULTCFG_UNIT_LABEL_KEY: "pkt",
            Tournament.RESULTCFG_DECIMAL_PLACES_KEY: 2,
            Tournament.RESULTCFG_AGGREGATION_MODE_KEY: Tournament.RESULTCFG_AGGREGATION_BEST,
            Tournament.RESULTCFG_ALLOW_TIES_KEY: True,
        }

        self.tournament = Tournament.objects.create(
            name="Archiwalny MASS_START",
            discipline=Tournament.Discipline.CUSTOM,
            custom_discipline_name="Test punktowy",
            organizer=self.organizer,
            competition_type=Tournament.CompetitionType.INDIVIDUAL,
            competition_model=Tournament.CompetitionModel.MASS_START,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.CUSTOM,
            result_config=result_config,
            status=Tournament.Status.CONFIGURED,
            is_archived=True,
        )

        self.division = Division.objects.create(
            tournament=self.tournament,
            name="Dywizja MASS_START",
            is_default=True,
            competition_type=Tournament.CompetitionType.INDIVIDUAL,
            competition_model=Tournament.CompetitionModel.MASS_START,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.CUSTOM,
            result_config=result_config,
            status=Tournament.Status.CONFIGURED,
        )

        self.team = Team.objects.create(
            tournament=self.tournament,
            division=self.division,
            name="Dawid Kędzierski",
        )
        self.other_team = Team.objects.create(
            tournament=self.tournament,
            division=self.division,
            name="Rywal",
        )

        self.stage = Stage.objects.create(
            tournament=self.tournament,
            division=self.division,
            stage_type=Stage.StageType.MASS_START,
            order=1,
            status=Stage.Status.OPEN,
        )

        self.group = Group.objects.create(
            stage=self.stage,
            name="Grupa A",
        )

        StageMassStartEntry.objects.create(
            stage=self.stage,
            group=self.group,
            team=self.team,
            seed=1,
            is_active=True,
        )
        StageMassStartEntry.objects.create(
            stage=self.stage,
            group=self.group,
            team=self.other_team,
            seed=2,
            is_active=True,
        )

        self.client.force_authenticate(user=self.organizer)

    def test_archived_tournament_rejects_mass_start_result_create(self):
        response = self.client.post(
            f"/api/tournaments/{self.tournament.id}/mass-start-results/?division_id={self.division.id}",
            {
                "stage_id": self.stage.id,
                "group_id": self.group.id,
                "team_id": self.team.id,
                "round_number": 1,
                "numeric_value": "12.50",
            },
            format="json",
        )

        self.assertIn(response.status_code, {400, 403, 409})
        self.assertFalse(StageMassStartResult.objects.filter(stage=self.stage).exists())
