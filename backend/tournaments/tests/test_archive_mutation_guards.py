# backend/tournaments/tests/test_archive_mutation_guards.py
# Plik testuje blokowanie mutacji danych po archiwizacji turnieju.

from django.test import TestCase
from rest_framework.test import APIClient

from tournaments.models import Division, Match, Stage, Team, Tournament

from .helpers import create_test_user


class TournamentArchivedMutationGuardTests(TestCase):
    """Testy zabezpieczają archiwalny turniej przed zapisem w kluczowych endpointach."""

    def setUp(self):
        self.organizer = create_test_user("archive-guard-owner@example.com")
        self.client = APIClient()

        self.tournament = Tournament.objects.create(
            name="Turniej archiwalny",
            discipline=Tournament.Discipline.FOOTBALL,
            organizer=self.organizer,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            entry_mode=Tournament.EntryMode.MANAGER,
            status=Tournament.Status.CONFIGURED,
            is_archived=True,
        )

        self.division = Division.objects.create(
            tournament=self.tournament,
            name="Dywizja główna",
            is_default=True,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            status=Tournament.Status.CONFIGURED,
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
            status=Stage.Status.OPEN,
        )

        self.match = Match.objects.create(
            tournament=self.tournament,
            stage=self.stage,
            home_team=self.home_team,
            away_team=self.away_team,
            status=Match.Status.SCHEDULED,
        )

        self.client.force_authenticate(user=self.organizer)

    def _assert_rejected(self, response):
        self.assertIn(response.status_code, {400, 403, 409})

    def test_archived_tournament_rejects_team_name_update(self):
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

    def test_archived_tournament_rejects_match_schedule_update(self):
        response = self.client.patch(
            f"/api/matches/{self.match.id}/",
            {
                "scheduled_date": "2026-05-10",
                "scheduled_time": "18:30",
                "location": "Hala testowa",
            },
            format="json",
        )

        self._assert_rejected(response)

        self.match.refresh_from_db()
        self.assertIsNone(self.match.scheduled_date)
        self.assertIsNone(self.match.scheduled_time)
        self.assertIsNone(self.match.location)

    def test_archived_tournament_rejects_match_result_update(self):
        response = self.client.patch(
            f"/api/matches/{self.match.id}/result/",
            {
                "home_score": 3,
                "away_score": 1,
                "result_entered": True,
            },
            format="json",
        )

        self._assert_rejected(response)

        self.match.refresh_from_db()
        self.assertEqual(self.match.home_score, 0)
        self.assertEqual(self.match.away_score, 0)
        self.assertFalse(self.match.result_entered)

    def test_archived_tournament_rejects_clock_start(self):
        response = self.client.post(
            f"/api/matches/{self.match.id}/clock/start/",
            {},
            format="json",
        )

        self._assert_rejected(response)

        self.match.refresh_from_db()
        self.assertEqual(self.match.clock_state, Match.ClockState.NOT_STARTED)
        self.assertIsNone(self.match.clock_started_at)
        self.assertEqual(self.match.clock_elapsed_seconds, 0)
