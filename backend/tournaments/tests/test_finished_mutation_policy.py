# backend/tournaments/tests/test_finished_mutation_policy.py
# Plik testuje politykę zapisu dla turnieju zakończonego statusem FINISHED.

from django.test import TestCase
from rest_framework.test import APIClient

from tournaments.models import Division, Match, Stage, Team, Tournament

from .helpers import create_test_user


class TournamentFinishedMutationPolicyTests(TestCase):
    """Testy sprawdzają, czy zakończony turniej zachowuje się jak tryb tylko do odczytu."""

    def setUp(self):
        self.organizer = create_test_user("finished-policy-owner@example.com")
        self.client = APIClient()

        self.tournament = Tournament.objects.create(
            name="Turniej zakończony",
            discipline=Tournament.Discipline.FOOTBALL,
            organizer=self.organizer,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            entry_mode=Tournament.EntryMode.MANAGER,
            status=Tournament.Status.FINISHED,
            is_archived=False,
        )

        self.division = Division.objects.create(
            tournament=self.tournament,
            name="Dywizja główna",
            is_default=True,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            status=Tournament.Status.FINISHED,
        )

        self.home_team = Team.objects.create(
            tournament=self.tournament,
            division=self.division,
            name="Dawid Kędzierski Team",
        )
        self.away_team = Team.objects.create(
            tournament=self.tournament,
            division=self.division,
            name="Rywal",
        )

        self.stage = Stage.objects.create(
            tournament=self.tournament,
            division=self.division,
            stage_type=Stage.StageType.LEAGUE,
            order=1,
            status=Stage.Status.CLOSED,
        )

        self.match = Match.objects.create(
            tournament=self.tournament,
            stage=self.stage,
            home_team=self.home_team,
            away_team=self.away_team,
            status=Match.Status.FINISHED,
            home_score=2,
            away_score=1,
            result_entered=True,
        )

        self.client.force_authenticate(user=self.organizer)

    def _assert_rejected(self, response):
        self.assertIn(response.status_code, {400, 403, 409})

    def test_finished_tournament_rejects_team_name_update(self):
        response = self.client.patch(
            f"/api/tournaments/{self.tournament.id}/teams/{self.home_team.id}/",
            {
                "name": "Zmieniona nazwa",
                "division_id": self.division.id,
            },
            format="json",
        )

        self._assert_rejected(response)

        self.home_team.refresh_from_db()
        self.assertEqual(self.home_team.name, "Dawid Kędzierski Team")

    def test_finished_tournament_rejects_match_schedule_update(self):
        response = self.client.patch(
            f"/api/matches/{self.match.id}/",
            {"location": "Nowa hala"},
            format="json",
        )

        self._assert_rejected(response)

        self.match.refresh_from_db()
        self.assertIsNone(self.match.location)

    def test_finished_tournament_rejects_match_result_update(self):
        response = self.client.patch(
            f"/api/matches/{self.match.id}/result/",
            {
                "home_score": 5,
                "away_score": 0,
                "result_entered": True,
            },
            format="json",
        )

        self._assert_rejected(response)

        self.match.refresh_from_db()
        self.assertEqual(self.match.home_score, 2)
        self.assertEqual(self.match.away_score, 1)

    def test_finished_tournament_rejects_clock_start(self):
        response = self.client.post(
            f"/api/matches/{self.match.id}/clock/start/",
            {},
            format="json",
        )

        self._assert_rejected(response)

        self.match.refresh_from_db()
        self.assertNotEqual(self.match.clock_state, Match.ClockState.RUNNING)
