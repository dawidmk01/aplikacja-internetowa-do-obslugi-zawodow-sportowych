# backend/tournaments/tests/test_clock.py
# Plik zabezpiecza obsługę zegara meczu oraz izolację stanu między meczami.

from .helpers import *


class TournamentMatchClockApiTests(TestCase):
    """Testy API zabezpieczają obsługę zegara meczu i izolację stanu między meczami."""

    def setUp(self):
        self.organizer = create_test_user("clock-owner@example.com")
        self.other_user = create_test_user("clock-other@example.com")
        self.client = APIClient()

    def _stage_model(self):
        return apps.get_model("tournaments", "Stage")

    def _match_model(self):
        return apps.get_model("tournaments", "Match")

    def _create_context(self):
        match_model = self._match_model()
        stage_model = self._stage_model()

        tournament = Tournament.objects.create(
            name="Turniej zegara",
            discipline=Tournament.Discipline.FOOTBALL,
            organizer=self.organizer,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
        )

        division = Division.objects.create(
            tournament=tournament,
            name="Dywizja zegara",
            is_default=True,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            status=Tournament.Status.CONFIGURED,
        )

        stage = stage_model.objects.create(
            tournament=tournament,
            division=division,
            stage_type=stage_model.StageType.LEAGUE,
            order=1,
        )

        teams = [
            Team.objects.create(
                tournament=tournament,
                division=division,
                name=f"Drużyna zegara {index}",
                is_active=True,
            )
            for index in range(1, 4)
        ]

        first_match = match_model.objects.create(
            tournament=tournament,
            stage=stage,
            home_team=teams[0],
            away_team=teams[1],
            round_number=1,
            status=match_model.Status.SCHEDULED,
        )

        second_match = match_model.objects.create(
            tournament=tournament,
            stage=stage,
            home_team=teams[1],
            away_team=teams[2],
            round_number=2,
            status=match_model.Status.SCHEDULED,
        )

        return tournament, first_match, second_match

    def test_organizer_can_read_match_clock_state(self):
        _tournament, match, _second_match = self._create_context()
        self.client.force_authenticate(user=self.organizer)

        response = self.client.get(f"/api/matches/{match.id}/clock/")

        self.assertEqual(response.status_code, 200)

        data = response.json()

        self.assertEqual(data.get("clock_state"), self._match_model().ClockState.NOT_STARTED)
        self.assertEqual(data.get("clock_period"), self._match_model().ClockPeriod.NONE)
        self.assertEqual(data.get("clock_elapsed_seconds"), 0)
        self.assertEqual(data.get("clock_added_seconds"), 0)

    def test_organizer_can_start_match_clock(self):
        _tournament, match, _second_match = self._create_context()
        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(f"/api/matches/{match.id}/clock/start/")

        self.assertEqual(response.status_code, 200)

        match.refresh_from_db()

        self.assertEqual(match.clock_state, self._match_model().ClockState.RUNNING)
        self.assertIsNotNone(match.clock_started_at)

    def test_starting_one_match_clock_does_not_change_other_match_clock(self):
        _tournament, first_match, second_match = self._create_context()
        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(f"/api/matches/{first_match.id}/clock/start/")

        self.assertEqual(response.status_code, 200)

        first_match.refresh_from_db()
        second_match.refresh_from_db()

        self.assertEqual(first_match.clock_state, self._match_model().ClockState.RUNNING)
        self.assertEqual(second_match.clock_state, self._match_model().ClockState.NOT_STARTED)
        self.assertEqual(second_match.clock_elapsed_seconds, 0)
        self.assertIsNone(second_match.clock_started_at)

    def test_other_user_cannot_start_match_clock(self):
        _tournament, match, _second_match = self._create_context()
        self.client.force_authenticate(user=self.other_user)

        response = self.client.post(f"/api/matches/{match.id}/clock/start/")

        self.assertIn(response.status_code, {403, 404})

        match.refresh_from_db()

        self.assertEqual(match.clock_state, self._match_model().ClockState.NOT_STARTED)
        self.assertIsNone(match.clock_started_at)

    def test_organizer_can_pause_running_match_clock(self):
        from datetime import timedelta
        from django.utils import timezone

        _tournament, match, _second_match = self._create_context()
        match.clock_state = self._match_model().ClockState.RUNNING
        match.clock_started_at = timezone.now() - timedelta(seconds=75)
        match.clock_elapsed_seconds = 10
        match.save(update_fields=["clock_state", "clock_started_at", "clock_elapsed_seconds"])

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(f"/api/matches/{match.id}/clock/pause/")

        self.assertEqual(response.status_code, 200)

        match.refresh_from_db()

        self.assertEqual(match.clock_state, self._match_model().ClockState.PAUSED)
        self.assertIsNone(match.clock_started_at)
        self.assertGreaterEqual(match.clock_elapsed_seconds, 70)

    def test_pause_is_idempotent_when_clock_is_not_running(self):
        _tournament, match, _second_match = self._create_context()
        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(f"/api/matches/{match.id}/clock/pause/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("clock_state"), self._match_model().ClockState.NOT_STARTED)

        match.refresh_from_db()

        self.assertEqual(match.clock_state, self._match_model().ClockState.NOT_STARTED)
        self.assertEqual(match.clock_elapsed_seconds, 0)

    def test_organizer_can_resume_paused_match_clock(self):
        _tournament, match, _second_match = self._create_context()
        match.clock_state = self._match_model().ClockState.PAUSED
        match.clock_elapsed_seconds = 45
        match.save(update_fields=["clock_state", "clock_elapsed_seconds"])

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(f"/api/matches/{match.id}/clock/resume/")

        self.assertEqual(response.status_code, 200)

        match.refresh_from_db()

        self.assertEqual(match.clock_state, self._match_model().ClockState.RUNNING)
        self.assertEqual(match.clock_elapsed_seconds, 45)
        self.assertIsNotNone(match.clock_started_at)

    def test_organizer_can_stop_running_match_clock(self):
        from datetime import timedelta
        from django.utils import timezone

        _tournament, match, _second_match = self._create_context()
        match.clock_state = self._match_model().ClockState.RUNNING
        match.clock_started_at = timezone.now() - timedelta(seconds=60)
        match.clock_elapsed_seconds = 20
        match.save(update_fields=["clock_state", "clock_started_at", "clock_elapsed_seconds"])

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(f"/api/matches/{match.id}/clock/stop/")

        self.assertEqual(response.status_code, 200)

        match.refresh_from_db()

        self.assertEqual(match.clock_state, self._match_model().ClockState.STOPPED)
        self.assertIsNone(match.clock_started_at)
        self.assertGreaterEqual(match.clock_elapsed_seconds, 60)

    def test_organizer_can_set_clock_period_and_elapsed_time_is_reset(self):
        _tournament, match, _second_match = self._create_context()
        match.clock_elapsed_seconds = 120
        match.save(update_fields=["clock_elapsed_seconds"])

        self.client.force_authenticate(user=self.organizer)

        response = self.client.patch(
            f"/api/matches/{match.id}/clock/period/",
            {
                "period": self._match_model().ClockPeriod.SH,
                "clock_period": self._match_model().ClockPeriod.SH,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        match.refresh_from_db()

        self.assertEqual(match.clock_period, self._match_model().ClockPeriod.SH)
        self.assertEqual(match.clock_elapsed_seconds, 0)

    def test_clock_period_rejects_invalid_value(self):
        _tournament, match, _second_match = self._create_context()
        self.client.force_authenticate(user=self.organizer)

        response = self.client.patch(
            f"/api/matches/{match.id}/clock/period/",
            {
                "period": "INVALID",
                "clock_period": "INVALID",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)

        match.refresh_from_db()

        self.assertEqual(match.clock_period, self._match_model().ClockPeriod.NONE)

    def test_organizer_can_set_added_seconds(self):
        _tournament, match, _second_match = self._create_context()
        self.client.force_authenticate(user=self.organizer)

        response = self.client.patch(
            f"/api/matches/{match.id}/clock/added/",
            {
                "added_seconds": 120,
                "clock_added_seconds": 120,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        match.refresh_from_db()

        self.assertEqual(match.clock_added_seconds, 120)

    def test_added_seconds_rejects_negative_value(self):
        _tournament, match, _second_match = self._create_context()
        self.client.force_authenticate(user=self.organizer)

        response = self.client.patch(
            f"/api/matches/{match.id}/clock/added/",
            {
                "added_seconds": -1,
                "clock_added_seconds": -1,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)

        match.refresh_from_db()

        self.assertEqual(match.clock_added_seconds, 0)
