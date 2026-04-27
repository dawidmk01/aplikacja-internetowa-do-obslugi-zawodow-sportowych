# backend/tournaments/tests/test_custom_results.py
# Plik zabezpiecza zapis i ranking customowych wyników mierzalnych dla pojedynczego meczu.

from .helpers import *


class TournamentCustomMatchResultApiTests(TestCase):
    """Testy API zabezpieczają zapis customowych wyników pojedynczego meczu."""

    def setUp(self):
        self.organizer = create_test_user("custom-result-owner@example.com")
        self.other_user = create_test_user("custom-result-other@example.com")
        self.client = APIClient()

    def _stage_model(self):
        return apps.get_model("tournaments", "Stage")

    def _match_model(self):
        return apps.get_model("tournaments", "Match")

    def _custom_result_model(self):
        return apps.get_model("tournaments", "MatchCustomResult")

    def _create_context(
        self,
        *,
        value_kind=None,
        better_result=None,
        custom_mode=None,
        decimal_places=0,
        result_mode=None,
        name="Turniej customowych wyników",
    ):
        value_kind = value_kind or Tournament.RESULTCFG_VALUE_KIND_NUMBER
        better_result = better_result or Tournament.RESULTCFG_BETTER_RESULT_HIGHER
        custom_mode = custom_mode or Tournament.RESULTCFG_CUSTOM_MODE_MASS_START_MEASURED
        result_mode = result_mode or Tournament.ResultMode.CUSTOM

        tournament = Tournament.objects.create(
            name=name,
            discipline=Tournament.Discipline.CUSTOM,
            custom_discipline_name="Test custom",
            organizer=self.organizer,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=result_mode,
        )

        result_config = {
            Tournament.RESULTCFG_CUSTOM_MODE_KEY: custom_mode,
            Tournament.RESULTCFG_VALUE_KIND_KEY: value_kind,
            Tournament.RESULTCFG_BETTER_RESULT_KEY: better_result,
            Tournament.RESULTCFG_DECIMAL_PLACES_KEY: decimal_places,
            Tournament.RESULTCFG_ALLOW_TIES_KEY: True,
        }

        if value_kind == Tournament.RESULTCFG_VALUE_KIND_TIME:
            result_config[Tournament.RESULTCFG_TIME_FORMAT_KEY] = Tournament.RESULTCFG_TIME_FORMAT_SS_HH

        division = Division.objects.create(
            tournament=tournament,
            name="Dywizja custom",
            is_default=True,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=result_mode,
            result_config=result_config if result_mode == Tournament.ResultMode.CUSTOM else {},
            status=Tournament.Status.CONFIGURED,
        )

        stage = self._stage_model().objects.create(
            tournament=tournament,
            division=division,
            stage_type=self._stage_model().StageType.LEAGUE,
            order=1,
        )

        teams = [
            Team.objects.create(
                tournament=tournament,
                division=division,
                name=f"Zespół custom {index}",
                is_active=True,
            )
            for index in range(1, 3)
        ]

        match = self._match_model().objects.create(
            tournament=tournament,
            stage=stage,
            home_team=teams[0],
            away_team=teams[1],
            round_number=1,
            status=self._match_model().Status.SCHEDULED,
        )

        return tournament, division, stage, teams, match

    def test_organizer_can_save_numeric_custom_result(self):
        _tournament, _division, _stage, teams, match = self._create_context(
            decimal_places=2,
        )

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            f"/api/matches/{match.id}/custom-result/",
            {
                "team_id": teams[0].id,
                "numeric_value": "12.35",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        result = self._custom_result_model().objects.get(match=match, team=teams[0])
        match.refresh_from_db()

        self.assertEqual(result.value_kind, Tournament.RESULTCFG_VALUE_KIND_NUMBER)
        self.assertEqual(result.display_value, "12.35")
        self.assertEqual(result.rank, 1)
        self.assertTrue(result.is_active)
        self.assertTrue(match.result_entered)
        self.assertEqual(match.status, self._match_model().Status.IN_PROGRESS)
        self.assertEqual(match.winner_id, teams[0].id)

    def test_second_numeric_custom_result_recalculates_rank_and_winner(self):
        _tournament, _division, _stage, teams, match = self._create_context()

        self.client.force_authenticate(user=self.organizer)

        first_response = self.client.post(
            f"/api/matches/{match.id}/custom-result/",
            {
                "team_id": teams[0].id,
                "numeric_value": "10",
            },
            format="json",
        )
        self.assertEqual(first_response.status_code, 200)

        second_response = self.client.post(
            f"/api/matches/{match.id}/custom-result/",
            {
                "team_id": teams[1].id,
                "numeric_value": "15",
            },
            format="json",
        )
        self.assertEqual(second_response.status_code, 200)

        home_result = self._custom_result_model().objects.get(match=match, team=teams[0])
        away_result = self._custom_result_model().objects.get(match=match, team=teams[1])
        match.refresh_from_db()

        self.assertEqual(home_result.rank, 2)
        self.assertEqual(away_result.rank, 1)
        self.assertEqual(match.winner_id, teams[1].id)

    def test_saving_custom_result_for_same_team_updates_existing_row(self):
        _tournament, _division, _stage, teams, match = self._create_context()

        self.client.force_authenticate(user=self.organizer)

        first_response = self.client.post(
            f"/api/matches/{match.id}/custom-result/",
            {
                "team_id": teams[0].id,
                "numeric_value": "10",
            },
            format="json",
        )
        self.assertEqual(first_response.status_code, 200)

        second_response = self.client.post(
            f"/api/matches/{match.id}/custom-result/",
            {
                "team_id": teams[0].id,
                "numeric_value": "20",
            },
            format="json",
        )
        self.assertEqual(second_response.status_code, 200)

        results = self._custom_result_model().objects.filter(match=match, team=teams[0])

        self.assertEqual(results.count(), 1)
        self.assertEqual(results.get().display_value, "20")

    def test_time_custom_result_uses_lower_value_as_better_when_configured(self):
        _tournament, _division, _stage, teams, match = self._create_context(
            value_kind=Tournament.RESULTCFG_VALUE_KIND_TIME,
            better_result=Tournament.RESULTCFG_BETTER_RESULT_LOWER,
        )

        self.client.force_authenticate(user=self.organizer)

        slower_response = self.client.post(
            f"/api/matches/{match.id}/custom-result/",
            {
                "team_id": teams[0].id,
                "time_ms": 10000,
            },
            format="json",
        )
        self.assertEqual(slower_response.status_code, 200)

        faster_response = self.client.post(
            f"/api/matches/{match.id}/custom-result/",
            {
                "team_id": teams[1].id,
                "time_ms": 8000,
            },
            format="json",
        )
        self.assertEqual(faster_response.status_code, 200)

        slower_result = self._custom_result_model().objects.get(match=match, team=teams[0])
        faster_result = self._custom_result_model().objects.get(match=match, team=teams[1])
        match.refresh_from_db()

        self.assertEqual(slower_result.rank, 2)
        self.assertEqual(faster_result.rank, 1)
        self.assertEqual(faster_result.time_ms, 8000)
        self.assertEqual(match.winner_id, teams[1].id)

    def test_place_custom_result_accepts_place_value(self):
        _tournament, _division, _stage, teams, match = self._create_context(
            value_kind=Tournament.RESULTCFG_VALUE_KIND_PLACE,
            better_result=Tournament.RESULTCFG_BETTER_RESULT_LOWER,
        )

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            f"/api/matches/{match.id}/custom-result/",
            {
                "team_id": teams[0].id,
                "place_value": 1,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        result = self._custom_result_model().objects.get(match=match, team=teams[0])

        self.assertEqual(result.value_kind, Tournament.RESULTCFG_VALUE_KIND_PLACE)
        self.assertEqual(result.place_value, 1)
        self.assertEqual(result.display_value, "1")
        self.assertEqual(result.rank, 1)

    def test_custom_result_rejects_team_outside_match(self):
        tournament, division, _stage, _teams, match = self._create_context()

        foreign_team = Team.objects.create(
            tournament=tournament,
            division=division,
            name="Obcy zespół w tej samej dywizji",
            is_active=True,
        )

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            f"/api/matches/{match.id}/custom-result/",
            {
                "team_id": foreign_team.id,
                "numeric_value": "10",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(
            self._custom_result_model().objects.filter(match=match, team=foreign_team).exists()
        )

    def test_other_user_cannot_save_custom_result(self):
        _tournament, _division, _stage, teams, match = self._create_context()

        self.client.force_authenticate(user=self.other_user)

        response = self.client.post(
            f"/api/matches/{match.id}/custom-result/",
            {
                "team_id": teams[0].id,
                "numeric_value": "10",
            },
            format="json",
        )

        self.assertIn(response.status_code, {403, 404})
        self.assertFalse(
            self._custom_result_model().objects.filter(match=match, team=teams[0]).exists()
        )

    def test_custom_result_endpoint_rejects_standard_score_match(self):
        _tournament, _division, _stage, teams, match = self._create_context(
            result_mode=Tournament.ResultMode.SCORE,
            name="Turniej bez custom result",
        )

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            f"/api/matches/{match.id}/custom-result/",
            {
                "team_id": teams[0].id,
                "numeric_value": "10",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(self._custom_result_model().objects.filter(match=match).exists())

    def test_custom_result_endpoint_rejects_head_to_head_points_table_mode(self):
        _tournament, _division, _stage, teams, match = self._create_context(
            custom_mode=Tournament.RESULTCFG_CUSTOM_MODE_HEAD_TO_HEAD_POINTS,
            name="Turniej custom punktowy",
        )

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            f"/api/matches/{match.id}/custom-result/",
            {
                "team_id": teams[0].id,
                "numeric_value": "10",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(self._custom_result_model().objects.filter(match=match).exists())
