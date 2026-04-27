# backend/tournaments/tests/test_rulesets_detailed.py
# Plik przeznaczono na szczegółowe testy rulesetów klasyfikacji sportowych.

from .helpers import *


# TODO: Dodać testy tie-breaków dla piłki nożnej, ręcznej, koszykówki, tenisa i zapasów.


from django.apps import apps
from django.test import TestCase

from tournaments.models import Division, Team, Tournament

from .helpers import create_test_user


class TournamentRulesetScoringRegressionTests(TestCase):
    """Testy regresji zabezpieczają punktowanie tabel dla obsługiwanych rulesetów sportowych."""

    def setUp(self):
        self.organizer = create_test_user("ruleset-scoring-owner@example.com")
        self.stage_model = apps.get_model("tournaments", "Stage")
        self.match_model = apps.get_model("tournaments", "Match")

    def _create_context(
        self,
        *,
        discipline,
        name="Turniej rulesetu",
        format_config=None,
    ):
        tournament = Tournament.objects.create(
            name=name,
            discipline=discipline,
            organizer=self.organizer,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            format_config=format_config or {},
        )

        division = Division.objects.create(
            tournament=tournament,
            name="Dywizja główna",
            is_default=True,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            format_config=format_config or {},
            status=Tournament.Status.CONFIGURED,
        )

        stage = self.stage_model.objects.create(
            tournament=tournament,
            division=division,
            stage_type=self.stage_model.StageType.LEAGUE,
            order=1,
        )

        teams = [
            Team.objects.create(
                tournament=tournament,
                division=division,
                name=f"Drużyna rulesetu {index}",
                is_active=True,
            )
            for index in range(1, 3)
        ]

        match = self.match_model.objects.create(
            tournament=tournament,
            stage=stage,
            home_team=teams[0],
            away_team=teams[1],
            round_number=1,
            status=self.match_model.Status.FINISHED,
            result_entered=True,
        )

        return tournament, division, stage, teams, match

    def _standings_by_team_id(self, tournament, stage):
        from tournaments.services.standings.compute import compute_stage_standings

        return {
            row.team_id: row
            for row in compute_stage_standings(tournament, stage)
        }

    def test_football_win_gives_three_points_and_clean_loss_gives_zero(self):
        tournament, _division, stage, teams, match = self._create_context(
            discipline=Tournament.Discipline.FOOTBALL,
            name="Ruleset piłki nożnej",
        )

        match.home_score = 2
        match.away_score = 0
        match.save(update_fields=["home_score", "away_score"])

        standings = self._standings_by_team_id(tournament, stage)

        self.assertEqual(standings[teams[0].id].points, 3)
        self.assertEqual(standings[teams[0].id].wins, 1)
        self.assertEqual(standings[teams[1].id].points, 0)
        self.assertEqual(standings[teams[1].id].losses, 1)
        self.assertEqual(standings[teams[0].id].goal_difference, 2)

    def test_football_draw_gives_one_point_to_each_team(self):
        tournament, _division, stage, teams, match = self._create_context(
            discipline=Tournament.Discipline.FOOTBALL,
            name="Ruleset remisu piłkarskiego",
        )

        match.home_score = 1
        match.away_score = 1
        match.save(update_fields=["home_score", "away_score"])

        standings = self._standings_by_team_id(tournament, stage)

        self.assertEqual(standings[teams[0].id].points, 1)
        self.assertEqual(standings[teams[1].id].points, 1)
        self.assertEqual(standings[teams[0].id].draws, 1)
        self.assertEqual(standings[teams[1].id].draws, 1)

    def test_handball_penalty_decision_after_draw_gives_two_points_to_winner_and_one_to_loser(self):
        tournament, _division, stage, teams, match = self._create_context(
            discipline=Tournament.Discipline.HANDBALL,
            name="Ruleset piłki ręcznej karne",
        )

        match.home_score = 24
        match.away_score = 24
        match.decided_by_penalties = True
        match.home_penalty_score = 4
        match.away_penalty_score = 3
        match.save(
            update_fields=[
                "home_score",
                "away_score",
                "decided_by_penalties",
                "home_penalty_score",
                "away_penalty_score",
            ]
        )

        standings = self._standings_by_team_id(tournament, stage)

        self.assertEqual(standings[teams[0].id].points, 2)
        self.assertEqual(standings[teams[1].id].points, 1)
        self.assertEqual(standings[teams[0].id].penalty_wins, 1)
        self.assertEqual(standings[teams[1].id].penalty_losses, 1)

    def test_handball_regular_win_gives_three_points(self):
        tournament, _division, stage, teams, match = self._create_context(
            discipline=Tournament.Discipline.HANDBALL,
            name="Ruleset piłki ręcznej zwycięstwo",
        )

        match.home_score = 30
        match.away_score = 27
        match.save(update_fields=["home_score", "away_score"])

        standings = self._standings_by_team_id(tournament, stage)

        self.assertEqual(standings[teams[0].id].points, 3)
        self.assertEqual(standings[teams[1].id].points, 0)
        self.assertEqual(standings[teams[0].id].wins, 1)
        self.assertEqual(standings[teams[1].id].losses, 1)

    def test_basketball_win_gives_two_points_to_winner_and_one_to_loser(self):
        tournament, _division, stage, teams, match = self._create_context(
            discipline=Tournament.Discipline.BASKETBALL,
            name="Ruleset koszykówki",
        )

        match.home_score = 82
        match.away_score = 74
        match.save(update_fields=["home_score", "away_score"])

        standings = self._standings_by_team_id(tournament, stage)

        self.assertEqual(standings[teams[0].id].points, 2)
        self.assertEqual(standings[teams[1].id].points, 1)
        self.assertEqual(standings[teams[0].id].wins, 1)
        self.assertEqual(standings[teams[1].id].losses, 1)

    def test_tennis_plt_mode_gives_ten_points_for_two_zero_win(self):
        tournament, _division, stage, teams, match = self._create_context(
            discipline=Tournament.Discipline.TENNIS,
            name="Ruleset tenisa PLT 2-0",
            format_config={"tennis_points_mode": "PLT"},
        )

        match.home_score = 2
        match.away_score = 0
        match.tennis_sets = [
            {"home_games": 6, "away_games": 2},
            {"home_games": 6, "away_games": 4},
        ]
        match.save(update_fields=["home_score", "away_score", "tennis_sets"])

        standings = self._standings_by_team_id(tournament, stage)

        self.assertEqual(standings[teams[0].id].points, 10)
        self.assertEqual(standings[teams[1].id].points, 2)
        self.assertEqual(standings[teams[0].id].games_for, 12)
        self.assertEqual(standings[teams[1].id].games_for, 6)

    def test_tennis_plt_mode_gives_eight_points_for_two_one_win(self):
        tournament, _division, stage, teams, match = self._create_context(
            discipline=Tournament.Discipline.TENNIS,
            name="Ruleset tenisa PLT 2-1",
            format_config={"tennis_points_mode": "PLT"},
        )

        match.home_score = 2
        match.away_score = 1
        match.tennis_sets = [
            {"home_games": 6, "away_games": 4},
            {"home_games": 4, "away_games": 6},
            {"home_games": 10, "away_games": 7},
        ]
        match.save(update_fields=["home_score", "away_score", "tennis_sets"])

        standings = self._standings_by_team_id(tournament, stage)

        self.assertEqual(standings[teams[0].id].points, 8)
        self.assertEqual(standings[teams[1].id].points, 4)
        self.assertEqual(standings[teams[0].id].wins, 1)
        self.assertEqual(standings[teams[1].id].losses, 1)

    def test_wrestling_dominant_result_gives_five_zero_classification_points(self):
        tournament, _division, stage, teams, match = self._create_context(
            discipline=Tournament.Discipline.WRESTLING,
            name="Ruleset zapasów przewaga",
        )

        match.home_score = 4
        match.away_score = 0
        match.winner = teams[0]
        match.wrestling_result_method = "VFA"
        match.save(update_fields=["home_score", "away_score", "winner", "wrestling_result_method"])

        standings = self._standings_by_team_id(tournament, stage)

        self.assertEqual(standings[teams[0].id].points, 5)
        self.assertEqual(standings[teams[1].id].points, 0)
        self.assertEqual(standings[teams[0].id].wins, 1)
        self.assertEqual(standings[teams[1].id].losses, 1)

    def test_wrestling_points_win_with_loser_score_gives_three_one_points(self):
        tournament, _division, stage, teams, match = self._create_context(
            discipline=Tournament.Discipline.WRESTLING,
            name="Ruleset zapasów punkty",
        )

        match.home_score = 6
        match.away_score = 8
        match.winner = teams[1]
        match.wrestling_result_method = "VPO"
        match.save(update_fields=["home_score", "away_score", "winner", "wrestling_result_method"])

        standings = self._standings_by_team_id(tournament, stage)

        self.assertEqual(standings[teams[1].id].points, 3)
        self.assertEqual(standings[teams[0].id].points, 1)
        self.assertEqual(standings[teams[1].id].wins, 1)
        self.assertEqual(standings[teams[0].id].losses, 1)


from django.apps import apps
from django.test import TestCase

from tournaments.models import Division, Team, Tournament

from .helpers import create_test_user


class TournamentRulesetScoringRegressionTests(TestCase):
    """Testy regresji zabezpieczają punktowanie tabel dla obsługiwanych rulesetów sportowych."""

    def setUp(self):
        self.organizer = create_test_user("ruleset-scoring-owner@example.com")
        self.stage_model = apps.get_model("tournaments", "Stage")
        self.match_model = apps.get_model("tournaments", "Match")

    def _create_context(
        self,
        *,
        discipline,
        name="Turniej rulesetu",
        format_config=None,
    ):
        tournament = Tournament.objects.create(
            name=name,
            discipline=discipline,
            organizer=self.organizer,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            format_config=format_config or {},
        )

        division = Division.objects.create(
            tournament=tournament,
            name="Dywizja główna",
            is_default=True,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            format_config=format_config or {},
            status=Tournament.Status.CONFIGURED,
        )

        stage = self.stage_model.objects.create(
            tournament=tournament,
            division=division,
            stage_type=self.stage_model.StageType.LEAGUE,
            order=1,
        )

        teams = [
            Team.objects.create(
                tournament=tournament,
                division=division,
                name=f"Drużyna rulesetu {index}",
                is_active=True,
            )
            for index in range(1, 3)
        ]

        match = self.match_model.objects.create(
            tournament=tournament,
            stage=stage,
            home_team=teams[0],
            away_team=teams[1],
            round_number=1,
            status=self.match_model.Status.FINISHED,
            result_entered=True,
        )

        return tournament, division, stage, teams, match

    def _standings_by_team_id(self, tournament, stage):
        from tournaments.services.standings.compute import compute_stage_standings

        return {
            row.team_id: row
            for row in compute_stage_standings(tournament, stage)
        }

    def test_football_win_gives_three_points_and_clean_loss_gives_zero(self):
        tournament, _division, stage, teams, match = self._create_context(
            discipline=Tournament.Discipline.FOOTBALL,
            name="Ruleset piłki nożnej",
        )

        match.home_score = 2
        match.away_score = 0
        match.save(update_fields=["home_score", "away_score"])

        standings = self._standings_by_team_id(tournament, stage)

        self.assertEqual(standings[teams[0].id].points, 3)
        self.assertEqual(standings[teams[0].id].wins, 1)
        self.assertEqual(standings[teams[1].id].points, 0)
        self.assertEqual(standings[teams[1].id].losses, 1)
        self.assertEqual(standings[teams[0].id].goal_difference, 2)

    def test_football_draw_gives_one_point_to_each_team(self):
        tournament, _division, stage, teams, match = self._create_context(
            discipline=Tournament.Discipline.FOOTBALL,
            name="Ruleset remisu piłkarskiego",
        )

        match.home_score = 1
        match.away_score = 1
        match.save(update_fields=["home_score", "away_score"])

        standings = self._standings_by_team_id(tournament, stage)

        self.assertEqual(standings[teams[0].id].points, 1)
        self.assertEqual(standings[teams[1].id].points, 1)
        self.assertEqual(standings[teams[0].id].draws, 1)
        self.assertEqual(standings[teams[1].id].draws, 1)

    def test_handball_penalty_decision_after_draw_gives_two_points_to_winner_and_one_to_loser(self):
        tournament, _division, stage, teams, match = self._create_context(
            discipline=Tournament.Discipline.HANDBALL,
            name="Ruleset piłki ręcznej karne",
        )

        match.home_score = 24
        match.away_score = 24
        match.decided_by_penalties = True
        match.home_penalty_score = 4
        match.away_penalty_score = 3
        match.save(
            update_fields=[
                "home_score",
                "away_score",
                "decided_by_penalties",
                "home_penalty_score",
                "away_penalty_score",
            ]
        )

        standings = self._standings_by_team_id(tournament, stage)

        self.assertEqual(standings[teams[0].id].points, 2)
        self.assertEqual(standings[teams[1].id].points, 1)
        self.assertEqual(standings[teams[0].id].penalty_wins, 1)
        self.assertEqual(standings[teams[1].id].penalty_losses, 1)

    def test_handball_regular_win_gives_three_points(self):
        tournament, _division, stage, teams, match = self._create_context(
            discipline=Tournament.Discipline.HANDBALL,
            name="Ruleset piłki ręcznej zwycięstwo",
        )

        match.home_score = 30
        match.away_score = 27
        match.save(update_fields=["home_score", "away_score"])

        standings = self._standings_by_team_id(tournament, stage)

        self.assertEqual(standings[teams[0].id].points, 3)
        self.assertEqual(standings[teams[1].id].points, 0)
        self.assertEqual(standings[teams[0].id].wins, 1)
        self.assertEqual(standings[teams[1].id].losses, 1)

    def test_basketball_win_gives_two_points_to_winner_and_one_to_loser(self):
        tournament, _division, stage, teams, match = self._create_context(
            discipline=Tournament.Discipline.BASKETBALL,
            name="Ruleset koszykówki",
        )

        match.home_score = 82
        match.away_score = 74
        match.save(update_fields=["home_score", "away_score"])

        standings = self._standings_by_team_id(tournament, stage)

        self.assertEqual(standings[teams[0].id].points, 2)
        self.assertEqual(standings[teams[1].id].points, 1)
        self.assertEqual(standings[teams[0].id].wins, 1)
        self.assertEqual(standings[teams[1].id].losses, 1)

    def test_tennis_plt_mode_gives_ten_points_for_two_zero_win(self):
        tournament, _division, stage, teams, match = self._create_context(
            discipline=Tournament.Discipline.TENNIS,
            name="Ruleset tenisa PLT 2-0",
            format_config={"tennis_points_mode": "PLT"},
        )

        match.home_score = 2
        match.away_score = 0
        match.tennis_sets = [
            {"home_games": 6, "away_games": 2},
            {"home_games": 6, "away_games": 4},
        ]
        match.save(update_fields=["home_score", "away_score", "tennis_sets"])

        standings = self._standings_by_team_id(tournament, stage)

        self.assertEqual(standings[teams[0].id].points, 10)
        self.assertEqual(standings[teams[1].id].points, 2)
        self.assertEqual(standings[teams[0].id].games_for, 12)
        self.assertEqual(standings[teams[1].id].games_for, 6)

    def test_tennis_plt_mode_gives_eight_points_for_two_one_win(self):
        tournament, _division, stage, teams, match = self._create_context(
            discipline=Tournament.Discipline.TENNIS,
            name="Ruleset tenisa PLT 2-1",
            format_config={"tennis_points_mode": "PLT"},
        )

        match.home_score = 2
        match.away_score = 1
        match.tennis_sets = [
            {"home_games": 6, "away_games": 4},
            {"home_games": 4, "away_games": 6},
            {"home_games": 10, "away_games": 7},
        ]
        match.save(update_fields=["home_score", "away_score", "tennis_sets"])

        standings = self._standings_by_team_id(tournament, stage)

        self.assertEqual(standings[teams[0].id].points, 8)
        self.assertEqual(standings[teams[1].id].points, 4)
        self.assertEqual(standings[teams[0].id].wins, 1)
        self.assertEqual(standings[teams[1].id].losses, 1)

    def test_wrestling_dominant_result_gives_five_zero_classification_points(self):
        tournament, _division, stage, teams, match = self._create_context(
            discipline=Tournament.Discipline.WRESTLING,
            name="Ruleset zapasów przewaga",
        )

        match.home_score = 4
        match.away_score = 0
        match.winner = teams[0]
        match.wrestling_result_method = "VFA"
        match.save(update_fields=["home_score", "away_score", "winner", "wrestling_result_method"])

        standings = self._standings_by_team_id(tournament, stage)

        self.assertEqual(standings[teams[0].id].points, 5)
        self.assertEqual(standings[teams[1].id].points, 0)
        self.assertEqual(standings[teams[0].id].wins, 1)
        self.assertEqual(standings[teams[1].id].losses, 1)

    def test_wrestling_points_win_with_loser_score_gives_three_one_points(self):
        tournament, _division, stage, teams, match = self._create_context(
            discipline=Tournament.Discipline.WRESTLING,
            name="Ruleset zapasów punkty",
        )

        match.home_score = 6
        match.away_score = 8
        match.winner = teams[1]
        match.wrestling_result_method = "VPO"
        match.save(update_fields=["home_score", "away_score", "winner", "wrestling_result_method"])

        standings = self._standings_by_team_id(tournament, stage)

        self.assertEqual(standings[teams[1].id].points, 3)
        self.assertEqual(standings[teams[0].id].points, 1)
        self.assertEqual(standings[teams[1].id].wins, 1)
        self.assertEqual(standings[teams[0].id].losses, 1)
