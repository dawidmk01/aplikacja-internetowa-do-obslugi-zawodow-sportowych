# backend/tournaments/tests/test_matches.py
# Plik zabezpiecza zapis wyników, harmonogram meczów oraz podstawowe klasyfikacje.

from .helpers import *


class TournamentMatchResultAndStandingsTests(TestCase):
    """Testy zabezpieczają zapis wyników, zmianę statusu meczu oraz obliczanie klasyfikacji."""

    bye_team_name = "__SYSTEM_BYE__"

    def setUp(self):
        self.organizer = create_test_user("match-result-owner@example.com")
        self.other_user = create_test_user("match-result-other@example.com")
        self.client = APIClient()

    def _stage_model(self):
        return apps.get_model("tournaments", "Stage")

    def _match_model(self):
        return apps.get_model("tournaments", "Match")

    def _incident_model(self):
        return apps.get_model("tournaments", "MatchIncident")

    def _create_tournament_context(
        self,
        *,
        name="Turniej wyników",
        discipline=Tournament.Discipline.FOOTBALL,
        teams_count=2,
    ):
        tournament = Tournament.objects.create(
            name=name,
            discipline=discipline,
            organizer=self.organizer,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
        )

        division = Division.objects.create(
            tournament=tournament,
            name="Dywizja główna",
            is_default=True,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            status=Tournament.Status.CONFIGURED,
        )

        stage_model = self._stage_model()
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
                name=f"Drużyna {index}",
                is_active=True,
            )
            for index in range(1, teams_count + 1)
        ]

        return tournament, division, stage, teams

    def _create_match(self, tournament, stage, home_team, away_team, *, status=None):
        match_model = self._match_model()

        return match_model.objects.create(
            tournament=tournament,
            stage=stage,
            home_team=home_team,
            away_team=away_team,
            round_number=1,
            status=status or match_model.Status.SCHEDULED,
        )

    def _standings_by_team_id(self, tournament, stage):
        from tournaments.services.standings.compute import compute_stage_standings

        return {
            row.team_id: row
            for row in compute_stage_standings(tournament, stage)
        }

    def test_organizer_can_save_match_result_and_move_match_to_in_progress(self):
        tournament, _division, stage, teams = self._create_tournament_context()
        match = self._create_match(tournament, stage, teams[0], teams[1])

        self.client.force_authenticate(user=self.organizer)

        response = self.client.patch(
            f"/api/matches/{match.id}/result/",
            {
                "home_score": 3,
                "away_score": 1,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        match.refresh_from_db()

        self.assertEqual(match.home_score, 3)
        self.assertEqual(match.away_score, 1)
        self.assertTrue(match.result_entered)
        self.assertEqual(match.status, self._match_model().Status.IN_PROGRESS)

    def test_manual_result_save_creates_live_goal_incidents(self):
        _tournament, _division, stage, teams = self._create_tournament_context()
        match = self._create_match(_tournament, stage, teams[0], teams[1])

        self.client.force_authenticate(user=self.organizer)

        response = self.client.patch(
            f"/api/matches/{match.id}/result/",
            {
                "home_score": 3,
                "away_score": 0,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        incident_model = self._incident_model()

        self.assertEqual(
            incident_model.objects.filter(match=match, kind="GOAL", team=teams[0]).count(),
            3,
        )
        self.assertFalse(incident_model.objects.filter(match=match, kind="GOAL", team=teams[1]).exists())

    def test_manual_result_decrease_requires_confirmation_before_deleting_live_incidents(self):
        _tournament, _division, stage, teams = self._create_tournament_context()
        match = self._create_match(_tournament, stage, teams[0], teams[1])

        self.client.force_authenticate(user=self.organizer)

        create_response = self.client.patch(
            f"/api/matches/{match.id}/result/",
            {
                "home_score": 3,
                "away_score": 0,
            },
            format="json",
        )
        self.assertEqual(create_response.status_code, 200)

        blocked_response = self.client.patch(
            f"/api/matches/{match.id}/result/",
            {
                "home_score": 2,
                "away_score": 0,
            },
            format="json",
        )

        self.assertEqual(blocked_response.status_code, 409)
        self.assertEqual(blocked_response.json().get("code"), "SCORE_SYNC_CONFIRM_REQUIRED")
        self.assertEqual(blocked_response.json().get("delete_count"), 1)

        match.refresh_from_db()
        self.assertEqual((match.home_score, match.away_score), (3, 0))
        self.assertEqual(self._incident_model().objects.filter(match=match, kind="GOAL").count(), 3)

        force_response = self.client.patch(
            f"/api/matches/{match.id}/result/?force=1",
            {
                "home_score": 2,
                "away_score": 0,
            },
            format="json",
        )

        self.assertEqual(force_response.status_code, 200)
        match.refresh_from_db()
        self.assertEqual((match.home_score, match.away_score), (2, 0))
        self.assertEqual(self._incident_model().objects.filter(match=match, kind="GOAL").count(), 2)

    def test_other_user_cannot_save_match_result(self):
        tournament, _division, stage, teams = self._create_tournament_context()
        match = self._create_match(tournament, stage, teams[0], teams[1])

        self.client.force_authenticate(user=self.other_user)

        response = self.client.patch(
            f"/api/matches/{match.id}/result/",
            {
                "home_score": 2,
                "away_score": 1,
            },
            format="json",
        )

        self.assertIn(response.status_code, {403, 404})

        match.refresh_from_db()

        self.assertFalse(match.result_entered)
        self.assertNotEqual(match.home_score, 2)
        self.assertNotEqual(match.away_score, 1)

    def test_organizer_can_finish_match_after_result_is_entered(self):
        tournament, _division, stage, teams = self._create_tournament_context()
        match = self._create_match(tournament, stage, teams[0], teams[1])

        self.client.force_authenticate(user=self.organizer)

        result_response = self.client.patch(
            f"/api/matches/{match.id}/result/",
            {
                "home_score": 1,
                "away_score": 0,
            },
            format="json",
        )
        self.assertEqual(result_response.status_code, 200)

        finish_response = self.client.post(f"/api/matches/{match.id}/finish/")

        self.assertEqual(finish_response.status_code, 200)

        match.refresh_from_db()

        self.assertEqual(match.status, self._match_model().Status.FINISHED)

    def test_organizer_can_finish_match_without_explicit_result_as_zero_zero(self):
        tournament, _division, stage, teams = self._create_tournament_context()
        match = self._create_match(tournament, stage, teams[0], teams[1])

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(f"/api/matches/{match.id}/finish/")

        self.assertEqual(response.status_code, 200)

        match.refresh_from_db()

        self.assertEqual(match.status, self._match_model().Status.FINISHED)

    
    def test_continue_match_moves_finished_match_back_to_in_progress(self):
        tournament, _division, stage, teams = self._create_tournament_context()
        match = self._create_match(
            tournament,
            stage,
            teams[0],
            teams[1],
            status=self._match_model().Status.FINISHED,
        )
        match.home_score = 2
        match.away_score = 1
        match.result_entered = True
        match.save(update_fields=["home_score", "away_score", "result_entered"])

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(f"/api/matches/{match.id}/continue/")

        self.assertEqual(response.status_code, 200)

        match.refresh_from_db()

        self.assertEqual(match.status, self._match_model().Status.IN_PROGRESS)

    def test_football_win_gives_three_points_in_standings(self):
        tournament, _division, stage, teams = self._create_tournament_context(
            discipline=Tournament.Discipline.FOOTBALL,
        )
        match = self._create_match(
            tournament,
            stage,
            teams[0],
            teams[1],
            status=self._match_model().Status.FINISHED,
        )
        match.home_score = 2
        match.away_score = 0
        match.result_entered = True
        match.save(update_fields=["home_score", "away_score", "result_entered"])

        standings = self._standings_by_team_id(tournament, stage)

        self.assertEqual(standings[teams[0].id].points, 3)
        self.assertEqual(standings[teams[0].id].wins, 1)
        self.assertEqual(standings[teams[1].id].points, 0)
        self.assertEqual(standings[teams[1].id].losses, 1)

    def test_football_draw_gives_one_point_to_each_team(self):
        tournament, _division, stage, teams = self._create_tournament_context(
            discipline=Tournament.Discipline.FOOTBALL,
        )
        match = self._create_match(
            tournament,
            stage,
            teams[0],
            teams[1],
            status=self._match_model().Status.FINISHED,
        )
        match.home_score = 1
        match.away_score = 1
        match.result_entered = True
        match.save(update_fields=["home_score", "away_score", "result_entered"])

        standings = self._standings_by_team_id(tournament, stage)

        self.assertEqual(standings[teams[0].id].points, 1)
        self.assertEqual(standings[teams[1].id].points, 1)
        self.assertEqual(standings[teams[0].id].draws, 1)
        self.assertEqual(standings[teams[1].id].draws, 1)

    def test_basketball_win_gives_two_points_to_winner_and_one_to_loser(self):
        tournament, _division, stage, teams = self._create_tournament_context(
            name="Turniej koszykarski wyników",
            discipline=Tournament.Discipline.BASKETBALL,
        )
        match = self._create_match(
            tournament,
            stage,
            teams[0],
            teams[1],
            status=self._match_model().Status.FINISHED,
        )
        match.home_score = 80
        match.away_score = 72
        match.result_entered = True
        match.save(update_fields=["home_score", "away_score", "result_entered"])

        standings = self._standings_by_team_id(tournament, stage)

        self.assertEqual(standings[teams[0].id].points, 2)
        self.assertEqual(standings[teams[1].id].points, 1)
        self.assertEqual(standings[teams[0].id].wins, 1)
        self.assertEqual(standings[teams[1].id].losses, 1)

    def test_standings_ignore_technical_bye_team(self):
        tournament, division, stage, teams = self._create_tournament_context(
            name="Turniej z BYE w tabeli",
            discipline=Tournament.Discipline.FOOTBALL,
        )
        bye_team = Team.objects.create(
            tournament=tournament,
            division=division,
            name=self.bye_team_name,
            is_active=True,
        )
        match = self._create_match(
            tournament,
            stage,
            teams[0],
            bye_team,
            status=self._match_model().Status.FINISHED,
        )
        match.home_score = 3
        match.away_score = 0
        match.result_entered = True
        match.save(update_fields=["home_score", "away_score", "result_entered"])

        standings = self._standings_by_team_id(tournament, stage)

        self.assertIn(teams[0].id, standings)
        self.assertNotIn(bye_team.id, standings)


class TournamentMatchListAndScheduleApiTests(TestCase):
    """Testy API zabezpieczają listowanie meczów oraz edycję harmonogramu."""

    def setUp(self):
        self.organizer = create_test_user("match-schedule-owner@example.com")
        self.other_user = create_test_user("match-schedule-other@example.com")
        self.client = APIClient()

    def _stage_model(self):
        return apps.get_model("tournaments", "Stage")

    def _match_model(self):
        return apps.get_model("tournaments", "Match")

    def _incident_model(self):
        return apps.get_model("tournaments", "MatchIncident")

    def _response_items(self, response):
        data = response.json()

        if isinstance(data, list):
            return data

        if isinstance(data, dict) and isinstance(data.get("results"), list):
            return data["results"]

        return []

    def _create_context(self):
        tournament = Tournament.objects.create(
            name="Turniej harmonogramu",
            discipline=Tournament.Discipline.FOOTBALL,
            organizer=self.organizer,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
        )

        first_division = Division.objects.create(
            tournament=tournament,
            name="Pierwsza dywizja",
            is_default=True,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            status=Tournament.Status.CONFIGURED,
        )

        second_division = Division.objects.create(
            tournament=tournament,
            name="Druga dywizja",
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            status=Tournament.Status.CONFIGURED,
        )

        stage_model = self._stage_model()
        first_stage = stage_model.objects.create(
            tournament=tournament,
            division=first_division,
            stage_type=stage_model.StageType.LEAGUE,
            order=1,
        )
        second_stage = stage_model.objects.create(
            tournament=tournament,
            division=second_division,
            stage_type=stage_model.StageType.LEAGUE,
            order=1,
        )

        first_teams = [
            Team.objects.create(
                tournament=tournament,
                division=first_division,
                name=f"Pierwsza {index}",
                is_active=True,
            )
            for index in range(1, 3)
        ]

        second_teams = [
            Team.objects.create(
                tournament=tournament,
                division=second_division,
                name=f"Druga {index}",
                is_active=True,
            )
            for index in range(1, 3)
        ]

        match_model = self._match_model()
        first_match = match_model.objects.create(
            tournament=tournament,
            stage=first_stage,
            home_team=first_teams[0],
            away_team=first_teams[1],
            round_number=1,
            status=match_model.Status.SCHEDULED,
        )
        second_match = match_model.objects.create(
            tournament=tournament,
            stage=second_stage,
            home_team=second_teams[0],
            away_team=second_teams[1],
            round_number=1,
            status=match_model.Status.SCHEDULED,
        )

        return tournament, first_division, second_division, first_match, second_match

    def test_organizer_sees_matches_from_selected_division(self):
        tournament, first_division, _second_division, first_match, _second_match = self._create_context()

        self.client.force_authenticate(user=self.organizer)

        response = self.client.get(
            f"/api/tournaments/{tournament.id}/matches/?division_id={first_division.id}"
        )

        self.assertEqual(response.status_code, 200)

        items = self._response_items(response)

        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].get("id"), first_match.id)
        self.assertEqual(items[0].get("division_id"), first_division.id)

    def test_match_list_does_not_mix_matches_between_divisions(self):
        tournament, first_division, second_division, first_match, second_match = self._create_context()

        self.client.force_authenticate(user=self.organizer)

        first_response = self.client.get(
            f"/api/tournaments/{tournament.id}/matches/?division_id={first_division.id}"
        )
        second_response = self.client.get(
            f"/api/tournaments/{tournament.id}/matches/?division_id={second_division.id}"
        )

        self.assertEqual(first_response.status_code, 200)
        self.assertEqual(second_response.status_code, 200)

        first_ids = {item.get("id") for item in self._response_items(first_response)}
        second_ids = {item.get("id") for item in self._response_items(second_response)}

        self.assertIn(first_match.id, first_ids)
        self.assertNotIn(second_match.id, first_ids)

        self.assertIn(second_match.id, second_ids)
        self.assertNotIn(first_match.id, second_ids)

    def test_other_user_receives_empty_panel_match_list_for_private_tournament(self):
        tournament, first_division, _second_division, _first_match, _second_match = self._create_context()

        self.client.force_authenticate(user=self.other_user)

        response = self.client.get(
            f"/api/tournaments/{tournament.id}/matches/?division_id={first_division.id}"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._response_items(response), [])

    def test_public_match_list_rejects_unpublished_tournament(self):
        tournament, first_division, _second_division, _first_match, _second_match = self._create_context()

        response = self.client.get(
            f"/api/tournaments/{tournament.id}/public/matches/?division_id={first_division.id}"
        )

        self.assertIn(response.status_code, {403, 404})

    def test_public_match_list_returns_matches_for_published_tournament(self):
        tournament, first_division, _second_division, first_match, _second_match = self._create_context()
        tournament.is_published = True
        tournament.save(update_fields=["is_published"])

        response = self.client.get(
            f"/api/tournaments/{tournament.id}/public/matches/?division_id={first_division.id}"
        )

        self.assertEqual(response.status_code, 200)

        items = self._response_items(response)

        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].get("id"), first_match.id)
        self.assertEqual(items[0].get("division_id"), first_division.id)

    def test_organizer_can_update_match_schedule(self):
        _tournament, _first_division, _second_division, first_match, _second_match = self._create_context()

        self.client.force_authenticate(user=self.organizer)

        response = self.client.patch(
            f"/api/matches/{first_match.id}/",
            {
                "scheduled_date": "2026-06-01",
                "scheduled_time": "18:30:00",
                "location": "Boisko główne",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        first_match.refresh_from_db()

        self.assertEqual(str(first_match.scheduled_date), "2026-06-01")
        self.assertEqual(str(first_match.scheduled_time), "18:30:00")
        self.assertEqual(first_match.location, "Boisko główne")

    def test_other_user_cannot_update_match_schedule(self):
        _tournament, _first_division, _second_division, first_match, _second_match = self._create_context()

        self.client.force_authenticate(user=self.other_user)

        response = self.client.patch(
            f"/api/matches/{first_match.id}/",
            {
                "scheduled_date": "2026-06-01",
                "scheduled_time": "18:30:00",
                "location": "Niedozwolone boisko",
            },
            format="json",
        )

        self.assertIn(response.status_code, {403, 404})

        first_match.refresh_from_db()

        self.assertIsNone(first_match.scheduled_date)
        self.assertIsNone(first_match.scheduled_time)
        self.assertNotEqual(first_match.location, "Niedozwolone boisko")

    def test_schedule_update_ignores_result_fields(self):
        _tournament, _first_division, _second_division, first_match, _second_match = self._create_context()

        first_match.home_score = 1
        first_match.away_score = 1
        first_match.result_entered = True
        first_match.save(update_fields=["home_score", "away_score", "result_entered"])

        self.client.force_authenticate(user=self.organizer)

        response = self.client.patch(
            f"/api/matches/{first_match.id}/",
            {
                "scheduled_date": "2026-06-02",
                "home_score": 5,
                "away_score": 0,
                "status": self._match_model().Status.FINISHED,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        first_match.refresh_from_db()

        self.assertEqual(str(first_match.scheduled_date), "2026-06-02")
        self.assertEqual(first_match.home_score, 1)
        self.assertEqual(first_match.away_score, 1)
        self.assertTrue(first_match.result_entered)
        self.assertNotEqual(first_match.status, self._match_model().Status.FINISHED)

    def test_set_scheduled_resets_clean_match_status(self):
        _tournament, _first_division, _second_division, first_match, _second_match = self._create_context()

        first_match.status = self._match_model().Status.IN_PROGRESS
        first_match.result_entered = True
        first_match.save(update_fields=["status", "result_entered"])

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(f"/api/matches/{first_match.id}/set-scheduled/")

        self.assertEqual(response.status_code, 200)

        first_match.refresh_from_db()

        self.assertEqual(first_match.status, self._match_model().Status.SCHEDULED)
        self.assertFalse(first_match.result_entered)
        self.assertIsNone(first_match.winner_id)

    def test_set_scheduled_rejects_match_with_score_data(self):
        _tournament, _first_division, _second_division, first_match, _second_match = self._create_context()

        first_match.status = self._match_model().Status.FINISHED
        first_match.home_score = 2
        first_match.away_score = 1
        first_match.result_entered = True
        first_match.save(update_fields=["status", "home_score", "away_score", "result_entered"])

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(f"/api/matches/{first_match.id}/set-scheduled/")

        self.assertEqual(response.status_code, 409)

        first_match.refresh_from_db()

        self.assertEqual(first_match.status, self._match_model().Status.FINISHED)
        self.assertTrue(first_match.result_entered)
        self.assertEqual(first_match.home_score, 2)
        self.assertEqual(first_match.away_score, 1)
