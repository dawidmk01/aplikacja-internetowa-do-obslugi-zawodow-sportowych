# backend/tournaments/tests/test_bracket_advancement.py
# Plik testuje generowanie i automatyczny awans w fazie pucharowej turnieju.

from django.apps import apps
from django.test import TestCase
from rest_framework.test import APIClient

from tournaments.models import Division, Team, Tournament
from tournaments.services.generators.knockout import generate_knockout_stage
from tournaments.views._helpers import _try_auto_advance_knockout

from .helpers import create_test_user


class TournamentBracketAdvancementTests(TestCase):
    """Testy zabezpieczają generowanie drabinki KO i awans zwycięzców między rundami."""

    def setUp(self):
        self.organizer = create_test_user("bracket-owner@example.com")
        self.other_user = create_test_user("bracket-other@example.com")
        self.client = APIClient()

        self.stage_model = apps.get_model("tournaments", "Stage")
        self.match_model = apps.get_model("tournaments", "Match")

    def _create_cup_context(self, *, teams_count=4, format_config=None):
        tournament = Tournament.objects.create(
            name="Turniej drabinki",
            discipline=Tournament.Discipline.FOOTBALL,
            organizer=self.organizer,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.CUP,
            result_mode=Tournament.ResultMode.SCORE,
            status=Tournament.Status.CONFIGURED,
        )

        division = Division.objects.create(
            tournament=tournament,
            name="Dywizja KO",
            is_default=True,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.CUP,
            result_mode=Tournament.ResultMode.SCORE,
            format_config=format_config or {},
            status=Tournament.Status.CONFIGURED,
        )

        teams = [
            Team.objects.create(
                tournament=tournament,
                division=division,
                name=f"Drużyna KO {index}",
                is_active=True,
            )
            for index in range(1, teams_count + 1)
        ]

        return tournament, division, teams

    def _finish_match_directly(self, match, *, home_score=1, away_score=0):
        match.home_score = home_score
        match.away_score = away_score
        match.result_entered = True
        match.winner = match.home_team if home_score > away_score else match.away_team
        match.status = self.match_model.Status.FINISHED
        match.save(
            update_fields=[
                "home_score",
                "away_score",
                "result_entered",
                "winner",
                "status",
            ]
        )
        return match

    def _finish_match_via_api(self, match, *, home_score=1, away_score=0):
        self.client.force_authenticate(user=self.organizer)

        result_response = self.client.patch(
            f"/api/matches/{match.id}/result/",
            {
                "home_score": home_score,
                "away_score": away_score,
            },
            format="json",
        )
        self.assertEqual(result_response.status_code, 200)

        finish_response = self.client.post(f"/api/matches/{match.id}/finish/")
        self.assertEqual(finish_response.status_code, 200)

        match.refresh_from_db()
        return match

    def test_generate_knockout_stage_creates_first_round_matches(self):
        tournament, division, teams = self._create_cup_context(teams_count=4)

        stage = generate_knockout_stage(tournament, division=division, teams=teams)

        matches = list(self.match_model.objects.filter(stage=stage).order_by("id"))

        self.assertEqual(stage.tournament_id, tournament.id)
        self.assertEqual(stage.division_id, division.id)
        self.assertEqual(stage.stage_type, self.stage_model.StageType.KNOCKOUT)
        self.assertEqual(stage.status, self.stage_model.Status.OPEN)
        self.assertEqual(len(matches), 2)
        self.assertTrue(all(match.status == self.match_model.Status.SCHEDULED for match in matches))

    def test_auto_advance_creates_final_after_all_semifinals_are_finished(self):
        tournament, division, teams = self._create_cup_context(teams_count=4)
        stage = generate_knockout_stage(tournament, division=division, teams=teams)

        first_round_matches = list(self.match_model.objects.filter(stage=stage).order_by("id"))
        expected_finalists = []

        for match in first_round_matches:
            self._finish_match_directly(match, home_score=2, away_score=0)
            expected_finalists.append(match.home_team_id)

        _try_auto_advance_knockout(stage)

        stage.refresh_from_db()
        final_stage = self.stage_model.objects.get(
            tournament=tournament,
            division=division,
            stage_type=self.stage_model.StageType.KNOCKOUT,
            order=stage.order + 1,
        )
        final_match = self.match_model.objects.get(stage=final_stage)

        self.assertEqual(stage.status, self.stage_model.Status.CLOSED)
        self.assertEqual(final_stage.status, self.stage_model.Status.OPEN)
        self.assertSetEqual(
            {final_match.home_team_id, final_match.away_team_id},
            set(expected_finalists),
        )

    def test_auto_advance_waits_until_all_matches_are_finished(self):
        tournament, division, teams = self._create_cup_context(teams_count=4)
        stage = generate_knockout_stage(tournament, division=division, teams=teams)

        first_match = self.match_model.objects.filter(stage=stage).order_by("id").first()
        self._finish_match_directly(first_match, home_score=2, away_score=0)

        _try_auto_advance_knockout(stage)

        self.assertEqual(
            self.stage_model.objects.filter(
                tournament=tournament,
                division=division,
                stage_type=self.stage_model.StageType.KNOCKOUT,
            ).count(),
            1,
        )

        stage.refresh_from_db()
        self.assertEqual(stage.status, self.stage_model.Status.OPEN)

    def test_finishing_last_round_marks_division_and_tournament_as_finished(self):
        tournament, division, teams = self._create_cup_context(teams_count=2)
        stage = generate_knockout_stage(tournament, division=division, teams=teams)

        final_match = self.match_model.objects.get(stage=stage)
        self._finish_match_directly(final_match, home_score=3, away_score=1)

        _try_auto_advance_knockout(stage)

        stage.refresh_from_db()
        division.refresh_from_db()
        tournament.refresh_from_db()

        self.assertEqual(stage.status, self.stage_model.Status.CLOSED)
        self.assertEqual(division.status, Tournament.Status.FINISHED)
        self.assertEqual(tournament.status, Tournament.Status.FINISHED)

    def test_other_user_cannot_finish_knockout_match(self):
        tournament, division, teams = self._create_cup_context(teams_count=2)
        stage = generate_knockout_stage(tournament, division=division, teams=teams)
        match = self.match_model.objects.get(stage=stage)

        self.client.force_authenticate(user=self.other_user)

        response = self.client.post(f"/api/matches/{match.id}/finish/")

        self.assertIn(response.status_code, {403, 404})

        match.refresh_from_db()
        self.assertEqual(match.status, self.match_model.Status.SCHEDULED)
        self.assertIsNone(match.winner_id)

    def test_two_leg_pair_winner_is_resolved_by_aggregate_score(self):
        tournament, division, teams = self._create_cup_context(
            teams_count=2,
            format_config={"cup_matches": 2, "final_matches": 2},
        )
        stage = generate_knockout_stage(tournament, division=division, teams=teams)
        first_leg, second_leg = list(self.match_model.objects.filter(stage=stage).order_by("id"))

        self._finish_match_via_api(first_leg, home_score=1, away_score=0)
        self._finish_match_via_api(second_leg, home_score=3, away_score=0)

        first_leg.refresh_from_db()
        second_leg.refresh_from_db()

        self.assertEqual(first_leg.status, self.match_model.Status.FINISHED)
        self.assertEqual(second_leg.status, self.match_model.Status.FINISHED)
        self.assertEqual(first_leg.winner_id, teams[1].id)
        self.assertEqual(second_leg.winner_id, teams[1].id)
