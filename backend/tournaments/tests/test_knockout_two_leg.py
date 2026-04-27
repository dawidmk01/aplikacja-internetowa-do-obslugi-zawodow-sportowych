# backend/tournaments/tests/test_knockout_two_leg.py
# Plik przeznaczono na testy pucharu, dwumeczów, dogrywek i rzutów karnych.

from .helpers import *


# TODO: Dodać testy pojedynczego meczu KO, dwumeczu, dogrywki, karnych i meczu o trzecie miejsce.


from django.apps import apps
from django.test import TestCase

from rest_framework.test import APIClient

from tournaments.models import Division, Team, Tournament

from .helpers import create_test_user


class TournamentKnockoutTwoLegApiTests(TestCase):
    """Testy API zabezpieczają dwumecze pucharowe i rozstrzyganie par KO."""

    def setUp(self):
        self.organizer = create_test_user("two-leg-owner@example.com")
        self.other_user = create_test_user("two-leg-other@example.com")
        self.client = APIClient()

        self.stage_model = apps.get_model("tournaments", "Stage")
        self.match_model = apps.get_model("tournaments", "Match")

    def _create_tournament_context(
        self,
        *,
        name="Turniej dwumeczów",
        discipline=Tournament.Discipline.FOOTBALL,
        cup_matches=2,
    ):
        tournament = Tournament.objects.create(
            name=name,
            discipline=discipline,
            organizer=self.organizer,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.CUP,
            result_mode=Tournament.ResultMode.SCORE,
            format_config={"cup_matches": cup_matches},
            status=Tournament.Status.CONFIGURED,
        )

        division = Division.objects.create(
            tournament=tournament,
            name="Dywizja główna",
            is_default=True,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.CUP,
            result_mode=Tournament.ResultMode.SCORE,
            format_config={"cup_matches": cup_matches},
            status=Tournament.Status.CONFIGURED,
        )

        stage = self.stage_model.objects.create(
            tournament=tournament,
            division=division,
            stage_type=self.stage_model.StageType.KNOCKOUT,
            order=1,
        )

        teams = [
            Team.objects.create(
                tournament=tournament,
                division=division,
                name=f"Drużyna KO {index}",
                is_active=True,
            )
            for index in range(1, 3)
        ]

        first_leg = self.match_model.objects.create(
            tournament=tournament,
            stage=stage,
            home_team=teams[0],
            away_team=teams[1],
            round_number=1,
            status=self.match_model.Status.SCHEDULED,
        )

        second_leg = self.match_model.objects.create(
            tournament=tournament,
            stage=stage,
            home_team=teams[1],
            away_team=teams[0],
            round_number=1,
            status=self.match_model.Status.SCHEDULED,
        )

        return tournament, division, stage, teams, first_leg, second_leg

    def _result_url(self, match):
        return f"/api/matches/{match.id}/result/"

    def _finish_url(self, match):
        return f"/api/matches/{match.id}/finish/"

    def _save_result(self, match, *, home_score, away_score, extra=None):
        payload = {
            "home_score": home_score,
            "away_score": away_score,
        }
        if extra:
            payload.update(extra)

        response = self.client.patch(
            self._result_url(match),
            payload,
            format="json",
        )
        self.assertEqual(response.status_code, 200)

        match.refresh_from_db()
        return response

    def _finish(self, match):
        response = self.client.post(self._finish_url(match))
        match.refresh_from_db()
        return response

    def test_two_leg_pair_does_not_require_pair_winner_after_first_finished_leg(self):
        _tournament, _division, _stage, _teams, first_leg, second_leg = self._create_tournament_context()

        self.client.force_authenticate(user=self.organizer)

        self._save_result(first_leg, home_score=2, away_score=0)

        response = self._finish(first_leg)

        self.assertEqual(response.status_code, 200)

        first_leg.refresh_from_db()
        second_leg.refresh_from_db()

        self.assertEqual(first_leg.status, self.match_model.Status.FINISHED)
        self.assertEqual(second_leg.status, self.match_model.Status.SCHEDULED)

    def test_two_leg_pair_resolves_winner_after_both_legs_are_finished(self):
        _tournament, _division, _stage, teams, first_leg, second_leg = self._create_tournament_context()

        self.client.force_authenticate(user=self.organizer)

        self._save_result(first_leg, home_score=2, away_score=0)
        first_response = self._finish(first_leg)
        self.assertEqual(first_response.status_code, 200)

        self._save_result(second_leg, home_score=1, away_score=0)
        second_response = self._finish(second_leg)
        self.assertEqual(second_response.status_code, 200)

        first_leg.refresh_from_db()
        second_leg.refresh_from_db()

        self.assertEqual(first_leg.status, self.match_model.Status.FINISHED)
        self.assertEqual(second_leg.status, self.match_model.Status.FINISHED)
        self.assertEqual(first_leg.winner_id, teams[0].id)
        self.assertEqual(second_leg.winner_id, teams[0].id)

    def test_two_leg_pair_rejects_complete_unresolved_aggregate_draw(self):
        _tournament, _division, _stage, _teams, first_leg, second_leg = self._create_tournament_context()

        self.client.force_authenticate(user=self.organizer)

        self._save_result(first_leg, home_score=1, away_score=0)
        first_response = self._finish(first_leg)
        self.assertEqual(first_response.status_code, 200)

        self._save_result(second_leg, home_score=1, away_score=0)
        second_response = self._finish(second_leg)

        self.assertEqual(second_response.status_code, 400)

        first_leg.refresh_from_db()
        second_leg.refresh_from_db()

        self.assertEqual(first_leg.status, self.match_model.Status.FINISHED)
        self.assertEqual(second_leg.status, self.match_model.Status.SCHEDULED)
        self.assertIsNone(second_leg.winner_id)

    def test_two_leg_pair_can_be_resolved_by_penalties_on_second_leg(self):
        _tournament, _division, _stage, teams, first_leg, second_leg = self._create_tournament_context()

        self.client.force_authenticate(user=self.organizer)

        self._save_result(first_leg, home_score=1, away_score=0)
        first_response = self._finish(first_leg)
        self.assertEqual(first_response.status_code, 200)

        self._save_result(
            second_leg,
            home_score=1,
            away_score=0,
            extra={
                "decided_by_penalties": True,
                "home_penalty_score": 4,
                "away_penalty_score": 5,
            },
        )
        second_response = self._finish(second_leg)

        self.assertEqual(second_response.status_code, 200)

        first_leg.refresh_from_db()
        second_leg.refresh_from_db()

        self.assertEqual(first_leg.winner_id, teams[0].id)
        self.assertEqual(second_leg.winner_id, teams[0].id)
        self.assertEqual(second_leg.status, self.match_model.Status.FINISHED)

    def test_tennis_knockout_rejects_two_leg_mode(self):
        _tournament, _division, _stage, _teams, first_leg, _second_leg = self._create_tournament_context(
            name="Tenisowy dwumecz KO",
            discipline=Tournament.Discipline.TENNIS,
            cup_matches=2,
        )

        self.client.force_authenticate(user=self.organizer)

        self._save_result(
            first_leg,
            home_score=2,
            away_score=0,
            extra={
                "tennis_sets": [
                    {"home_games": 6, "away_games": 3},
                    {"home_games": 6, "away_games": 4},
                ],
            },
        )

        response = self._finish(first_leg)

        self.assertEqual(response.status_code, 400)

        first_leg.refresh_from_db()

        self.assertNotEqual(first_leg.status, self.match_model.Status.FINISHED)

    def test_other_user_cannot_finish_two_leg_match(self):
        _tournament, _division, _stage, _teams, first_leg, _second_leg = self._create_tournament_context()

        self.client.force_authenticate(user=self.organizer)
        self._save_result(first_leg, home_score=2, away_score=0)

        self.client.force_authenticate(user=self.other_user)

        response = self._finish(first_leg)

        self.assertIn(response.status_code, {403, 404})

        first_leg.refresh_from_db()

        self.assertNotEqual(first_leg.status, self.match_model.Status.FINISHED)

    def test_two_leg_pair_is_limited_to_matches_from_same_stage_and_division(self):
        first_tournament, first_division, first_stage, teams, first_leg, second_leg = self._create_tournament_context(
            name="Dwumecz izolacja pierwsza dywizja",
        )

        second_division = Division.objects.create(
            tournament=first_tournament,
            name="Druga dywizja",
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.CUP,
            result_mode=Tournament.ResultMode.SCORE,
            format_config={"cup_matches": 2},
            status=Tournament.Status.CONFIGURED,
        )

        second_stage = self.stage_model.objects.create(
            tournament=first_tournament,
            division=second_division,
            stage_type=self.stage_model.StageType.KNOCKOUT,
            order=1,
        )

        second_division_teams = [
            Team.objects.create(
                tournament=first_tournament,
                division=second_division,
                name=f"Druga dywizja KO {index}",
                is_active=True,
            )
            for index in range(1, 3)
        ]

        foreign_match = self.match_model.objects.create(
            tournament=first_tournament,
            stage=second_stage,
            home_team=second_division_teams[0],
            away_team=second_division_teams[1],
            round_number=1,
            status=self.match_model.Status.SCHEDULED,
        )

        self.client.force_authenticate(user=self.organizer)

        self._save_result(first_leg, home_score=2, away_score=0)
        first_response = self._finish(first_leg)
        self.assertEqual(first_response.status_code, 200)

        self._save_result(second_leg, home_score=1, away_score=0)
        second_response = self._finish(second_leg)
        self.assertEqual(second_response.status_code, 200)

        foreign_match.refresh_from_db()

        self.assertEqual(foreign_match.status, self.match_model.Status.SCHEDULED)
        self.assertIsNone(foreign_match.winner_id)
