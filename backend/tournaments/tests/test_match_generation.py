# backend/tournaments/tests/test_match_generation.py
# Plik zabezpiecza generowanie struktury rozgrywek dla wybranej dywizji.

from .helpers import *


class TournamentMatchGenerationServiceTests(TestCase):
    """Testy zabezpieczają generowanie struktury rozgrywek w kontekście aktywnej dywizji."""

    bye_team_name = "__SYSTEM_BYE__"

    def setUp(self):
        self.organizer = create_test_user("match-generation-owner@example.com")

    def _create_tournament(self, name="Turniej generatora"):
        return Tournament.objects.create(
            name=name,
            discipline=Tournament.Discipline.FOOTBALL,
            organizer=self.organizer,
        )

    def _create_division(self, tournament, name, *, tournament_format=Tournament.TournamentFormat.LEAGUE, is_default=False):
        division = Division.objects.create(
            tournament=tournament,
            name=name,
            is_default=is_default,
        )
        division.competition_type = Tournament.CompetitionType.TEAM
        division.competition_model = Tournament.CompetitionModel.HEAD_TO_HEAD
        division.tournament_format = tournament_format
        division.result_mode = Tournament.ResultMode.SCORE
        division.format_config = {}
        division.result_config = {}
        division.save(
            update_fields=[
                "competition_type",
                "competition_model",
                "tournament_format",
                "result_mode",
                "format_config",
                "result_config",
            ]
        )
        return division

    def _create_teams(self, tournament, division, count):
        return [
            Team.objects.create(
                tournament=tournament,
                division=division,
                name=f"Drużyna {index}",
                is_active=True,
            )
            for index in range(1, count + 1)
        ]

    def _stage_model(self):
        return apps.get_model("tournaments", "Stage")

    def _match_model(self):
        return apps.get_model("tournaments", "Match")

    def test_league_generation_creates_stage_and_matches_for_selected_division(self):
        from tournaments.services.match_generation import ensure_matches_generated

        stage_model = self._stage_model()
        match_model = self._match_model()

        tournament = self._create_tournament()
        division = self._create_division(
            tournament,
            "Liga",
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            is_default=True,
        )
        self._create_teams(tournament, division, 4)

        ensure_matches_generated(tournament, division=division)

        stages = stage_model.objects.filter(tournament=tournament, division=division)
        matches = match_model.objects.filter(tournament=tournament, stage__division=division)

        self.assertTrue(stages.exists())
        self.assertTrue(matches.exists())
        self.assertTrue(all(stage.stage_type == stage_model.StageType.LEAGUE for stage in stages))

    def test_cup_generation_creates_knockout_stage_and_matches_for_selected_division(self):
        from tournaments.services.match_generation import ensure_matches_generated

        stage_model = self._stage_model()
        match_model = self._match_model()

        tournament = self._create_tournament("Turniej pucharowy generatora")
        division = self._create_division(
            tournament,
            "Puchar",
            tournament_format=Tournament.TournamentFormat.CUP,
            is_default=True,
        )
        self._create_teams(tournament, division, 4)

        ensure_matches_generated(tournament, division=division)

        stages = stage_model.objects.filter(tournament=tournament, division=division)
        matches = match_model.objects.filter(tournament=tournament, stage__division=division)

        self.assertTrue(stages.exists())
        self.assertTrue(matches.exists())
        self.assertTrue(stages.filter(stage_type=stage_model.StageType.KNOCKOUT).exists())

    def test_mixed_generation_creates_group_structure_for_selected_division(self):
        from tournaments.services.match_generation import ensure_matches_generated

        stage_model = self._stage_model()
        match_model = self._match_model()

        tournament = self._create_tournament("Turniej mieszany generatora")
        division = self._create_division(
            tournament,
            "Grupy i puchar",
            tournament_format=Tournament.TournamentFormat.MIXED,
            is_default=True,
        )
        division.format_config = {
            "groups_count": 2,
            "advance_per_group": 1,
        }
        division.save(update_fields=["format_config"])

        self._create_teams(tournament, division, 4)

        ensure_matches_generated(tournament, division=division)

        stages = stage_model.objects.filter(tournament=tournament, division=division)
        matches = match_model.objects.filter(tournament=tournament, stage__division=division)

        self.assertTrue(stages.exists())
        self.assertTrue(matches.exists())
        self.assertTrue(stages.filter(stage_type=stage_model.StageType.GROUP).exists())

    def test_generation_does_not_create_structure_with_less_than_two_real_teams(self):
        from tournaments.services.match_generation import ensure_matches_generated

        stage_model = self._stage_model()
        match_model = self._match_model()

        tournament = self._create_tournament("Turniej bez minimum uczestników")
        division = self._create_division(tournament, "Jedna drużyna", is_default=True)

        Team.objects.create(
            tournament=tournament,
            division=division,
            name="Drużyna 1",
            is_active=True,
        )

        ensure_matches_generated(tournament, division=division)

        self.assertFalse(stage_model.objects.filter(tournament=tournament, division=division).exists())
        self.assertFalse(match_model.objects.filter(tournament=tournament, stage__division=division).exists())

    def test_generation_ignores_technical_bye_when_counting_active_teams(self):
        from tournaments.services.match_generation import ensure_matches_generated

        stage_model = self._stage_model()

        tournament = self._create_tournament("Turniej z BYE")
        division = self._create_division(tournament, "BYE", is_default=True)

        Team.objects.create(
            tournament=tournament,
            division=division,
            name="Drużyna 1",
            is_active=True,
        )
        Team.objects.create(
            tournament=tournament,
            division=division,
            name=self.bye_team_name,
            is_active=True,
        )

        ensure_matches_generated(tournament, division=division)

        self.assertFalse(stage_model.objects.filter(tournament=tournament, division=division).exists())

    def test_generation_resets_only_selected_division_structure(self):
        from tournaments.services.match_generation import ensure_matches_generated

        stage_model = self._stage_model()

        tournament = self._create_tournament("Turniej izolacji dywizji")
        first_division = self._create_division(
            tournament,
            "Pierwsza dywizja",
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            is_default=True,
        )
        second_division = self._create_division(
            tournament,
            "Druga dywizja",
            tournament_format=Tournament.TournamentFormat.LEAGUE,
        )

        self._create_teams(tournament, first_division, 4)
        self._create_teams(tournament, second_division, 4)

        old_first_stage = stage_model.objects.create(
            tournament=tournament,
            division=first_division,
            stage_type=stage_model.StageType.LEAGUE,
            order=99,
        )
        second_stage = stage_model.objects.create(
            tournament=tournament,
            division=second_division,
            stage_type=stage_model.StageType.LEAGUE,
            order=99,
        )

        ensure_matches_generated(tournament, division=first_division)

        self.assertFalse(stage_model.objects.filter(id=old_first_stage.id).exists())
        self.assertTrue(stage_model.objects.filter(id=second_stage.id).exists())
        self.assertTrue(stage_model.objects.filter(tournament=tournament, division=first_division).exists())
        self.assertTrue(stage_model.objects.filter(tournament=tournament, division=second_division).exists())

    def test_generation_rejects_division_from_another_tournament(self):
        from tournaments.services.match_generation import ensure_matches_generated

        first_tournament = self._create_tournament("Pierwszy turniej generatora")
        second_tournament = self._create_tournament("Drugi turniej generatora")
        foreign_division = self._create_division(second_tournament, "Obca dywizja", is_default=True)

        with self.assertRaises(ValueError):
            ensure_matches_generated(first_tournament, division=foreign_division)
