# backend/tournaments/tests/test_mass_start_api.py
# Plik zawiera testy API wyników etapowych dla trybu MASS_START.

from decimal import Decimal

from django.apps import apps
from django.test import TestCase

from rest_framework.test import APIClient

from tournaments.models import Division, Team, Tournament

from .helpers import create_test_user


class TournamentMassStartResultApiTests(TestCase):
    """Testy API zabezpieczają zapis i odczyt wyników modelu MASS_START."""

    def setUp(self):
        self.organizer = create_test_user("mass-start-api-owner@example.com")
        self.assistant = create_test_user("mass-start-api-assistant@example.com")
        self.other_user = create_test_user("mass-start-api-other@example.com")
        self.client = APIClient()

        self.membership_model = apps.get_model("tournaments", "TournamentMembership")
        self.stage_model = apps.get_model("tournaments", "Stage")
        self.group_model = apps.get_model("tournaments", "Group")
        self.entry_model = apps.get_model("tournaments", "StageMassStartEntry")
        self.result_model = apps.get_model("tournaments", "StageMassStartResult")

    def _result_config(
        self,
        *,
        value_kind=None,
        better_result=None,
        decimal_places=2,
        rounds_count=1,
        stages=None,
    ):
        value_kind = value_kind or Tournament.RESULTCFG_VALUE_KIND_NUMBER
        better_result = better_result or Tournament.RESULTCFG_BETTER_RESULT_HIGHER

        return {
            Tournament.RESULTCFG_CUSTOM_MODE_KEY: Tournament.RESULTCFG_CUSTOM_MODE_MASS_START_MEASURED,
            Tournament.RESULTCFG_VALUE_KIND_KEY: value_kind,
            Tournament.RESULTCFG_BETTER_RESULT_KEY: better_result,
            Tournament.RESULTCFG_DECIMAL_PLACES_KEY: decimal_places,
            Tournament.RESULTCFG_ALLOW_TIES_KEY: True,
            Tournament.RESULTCFG_AGGREGATION_MODE_KEY: Tournament.RESULTCFG_AGGREGATION_BEST,
            Tournament.RESULTCFG_ROUNDS_COUNT_KEY: rounds_count,
            Tournament.RESULTCFG_STAGES_KEY: stages
            or [
                {
                    Tournament.RESULTCFG_STAGE_NAME_KEY: "Finał",
                    Tournament.RESULTCFG_STAGE_GROUPS_COUNT_KEY: 1,
                    Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY: rounds_count,
                }
            ],
        }

    def _create_context(
        self,
        *,
        name="Turniej MASS_START API",
        teams_count=3,
        result_config=None,
        is_published=False,
    ):
        result_config = result_config or self._result_config()

        tournament = Tournament.objects.create(
            name=name,
            discipline=Tournament.Discipline.CUSTOM,
            custom_discipline_name="Test MASS_START API",
            organizer=self.organizer,
            competition_type=Tournament.CompetitionType.INDIVIDUAL,
            competition_model=Tournament.CompetitionModel.MASS_START,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.CUSTOM,
            result_config=result_config,
            status=Tournament.Status.CONFIGURED,
            is_published=is_published,
        )

        division = Division.objects.create(
            tournament=tournament,
            name="Dywizja MASS_START API",
            is_default=True,
            competition_type=Tournament.CompetitionType.INDIVIDUAL,
            competition_model=Tournament.CompetitionModel.MASS_START,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.CUSTOM,
            result_config=result_config,
            status=Tournament.Status.CONFIGURED,
        )

        teams = [
            Team.objects.create(
                tournament=tournament,
                division=division,
                name=f"Zawodnik MASS_START {index}",
                is_active=True,
            )
            for index in range(1, teams_count + 1)
        ]

        from tournaments.views.tournaments import sync_custom_mass_start_structure_for_division

        sync_custom_mass_start_structure_for_division(tournament, division)

        stages = list(
            self.stage_model.objects.filter(
                tournament=tournament,
                division=division,
                stage_type=self.stage_model.StageType.MASS_START,
            ).order_by("order", "id")
        )

        return tournament, division, teams, stages

    def _panel_url(self, tournament, division):
        return f"/api/tournaments/{tournament.id}/mass-start-results/?division_id={division.id}"

    def _public_url(self, tournament, division):
        return f"/api/tournaments/{tournament.id}/public/mass-start-results/?division_id={division.id}"

    def _first_group(self, stage):
        return self.group_model.objects.filter(stage=stage).order_by("id").first()

    def _create_assistant_membership(self, tournament):
        return self.membership_model.objects.create(
            tournament=tournament,
            user=self.assistant,
            role=self.membership_model.Role.ASSISTANT,
            status=self.membership_model.Status.ACCEPTED,
            permissions={
                self.membership_model.PERM_RESULTS_EDIT: True,
            },
            invited_by=self.organizer,
        )

    def test_organizer_can_read_mass_start_results_payload(self):
        tournament, division, teams, stages = self._create_context()
        stage = stages[0]

        self.client.force_authenticate(user=self.organizer)

        response = self.client.get(self._panel_url(tournament, division))

        self.assertEqual(response.status_code, 200)

        data = response.json()

        self.assertEqual(data.get("tournament_id"), tournament.id)
        self.assertEqual(data.get("division_id"), division.id)
        self.assertEqual(data.get("competition_model"), Tournament.CompetitionModel.MASS_START)
        self.assertEqual(data.get("value_kind"), Tournament.RESULTCFG_VALUE_KIND_NUMBER)

        payload_stages = data.get("stages") or []

        self.assertEqual(len(payload_stages), 1)
        self.assertEqual(payload_stages[0].get("stage_id"), stage.id)
        self.assertEqual(payload_stages[0].get("stage_name"), "Finał")
        self.assertEqual(payload_stages[0].get("stage_status"), self.stage_model.Status.OPEN)

        entries = payload_stages[0].get("groups", [])[0].get("entries", [])
        self.assertEqual({item.get("team_id") for item in entries}, {team.id for team in teams})

    def test_assistant_can_read_mass_start_results_payload(self):
        tournament, division, _teams, _stages = self._create_context()
        self._create_assistant_membership(tournament)

        self.client.force_authenticate(user=self.assistant)

        response = self.client.get(self._panel_url(tournament, division))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("division_id"), division.id)

    def test_other_user_cannot_read_panel_mass_start_results(self):
        tournament, division, _teams, _stages = self._create_context()

        self.client.force_authenticate(user=self.other_user)

        response = self.client.get(self._panel_url(tournament, division))

        self.assertEqual(response.status_code, 403)

    def test_organizer_can_save_numeric_mass_start_result(self):
        tournament, division, teams, stages = self._create_context()
        stage = stages[0]
        group = self._first_group(stage)

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            self._panel_url(tournament, division),
            {
                "stage_id": stage.id,
                "group_id": group.id,
                "team_id": teams[0].id,
                "round_number": 1,
                "numeric_value": "12.35",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        result = self.result_model.objects.get(stage=stage, group=group, team=teams[0])

        self.assertEqual(result.value_kind, Tournament.RESULTCFG_VALUE_KIND_NUMBER)
        self.assertEqual(result.numeric_value, Decimal("12.3500"))
        self.assertEqual(result.display_value, "12.35")
        self.assertEqual(result.round_number, 1)
        self.assertTrue(result.is_active)

    def test_saving_second_numeric_result_recalculates_group_ranks(self):
        tournament, division, teams, stages = self._create_context(teams_count=2)
        stage = stages[0]
        group = self._first_group(stage)

        self.client.force_authenticate(user=self.organizer)

        first_response = self.client.post(
            self._panel_url(tournament, division),
            {
                "stage_id": stage.id,
                "group_id": group.id,
                "team_id": teams[0].id,
                "round_number": 1,
                "numeric_value": "10",
            },
            format="json",
        )
        self.assertEqual(first_response.status_code, 200)

        second_response = self.client.post(
            self._panel_url(tournament, division),
            {
                "stage_id": stage.id,
                "group_id": group.id,
                "team_id": teams[1].id,
                "round_number": 1,
                "numeric_value": "15",
            },
            format="json",
        )
        self.assertEqual(second_response.status_code, 200)

        first_result = self.result_model.objects.get(stage=stage, team=teams[0])
        second_result = self.result_model.objects.get(stage=stage, team=teams[1])

        self.assertEqual(first_result.rank, 2)
        self.assertEqual(second_result.rank, 1)

    def test_saving_result_for_same_team_and_round_updates_existing_row(self):
        tournament, division, teams, stages = self._create_context()
        stage = stages[0]
        group = self._first_group(stage)

        self.client.force_authenticate(user=self.organizer)

        first_response = self.client.post(
            self._panel_url(tournament, division),
            {
                "stage_id": stage.id,
                "group_id": group.id,
                "team_id": teams[0].id,
                "round_number": 1,
                "numeric_value": "10",
            },
            format="json",
        )
        self.assertEqual(first_response.status_code, 200)

        second_response = self.client.post(
            self._panel_url(tournament, division),
            {
                "stage_id": stage.id,
                "group_id": group.id,
                "team_id": teams[0].id,
                "round_number": 1,
                "numeric_value": "20",
            },
            format="json",
        )
        self.assertEqual(second_response.status_code, 200)

        results = self.result_model.objects.filter(stage=stage, team=teams[0], round_number=1)

        self.assertEqual(results.count(), 1)
        result = results.get()
        self.assertEqual(result.numeric_value, Decimal("20.0000"))
        self.assertEqual(result.display_value, "20.00")

    def test_mass_start_result_rejects_team_without_stage_entry(self):
        tournament, division, _teams, stages = self._create_context(teams_count=2)
        stage = stages[0]
        group = self._first_group(stage)

        foreign_team = Team.objects.create(
            tournament=tournament,
            division=division,
            name="Zawodnik bez wpisu API",
            is_active=True,
        )

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            self._panel_url(tournament, division),
            {
                "stage_id": stage.id,
                "group_id": group.id,
                "team_id": foreign_team.id,
                "round_number": 1,
                "numeric_value": "10",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(self.result_model.objects.filter(stage=stage, team=foreign_team).exists())

    def test_mass_start_result_rejects_wrong_group_for_team_entry(self):
        result_config = self._result_config(
            stages=[
                {
                    Tournament.RESULTCFG_STAGE_NAME_KEY: "Kwalifikacje",
                    Tournament.RESULTCFG_STAGE_GROUPS_COUNT_KEY: 2,
                    Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY: 1,
                }
            ]
        )
        tournament, division, teams, stages = self._create_context(
            name="Turniej MASS_START API grupy",
            teams_count=4,
            result_config=result_config,
        )
        stage = stages[0]
        groups = list(self.group_model.objects.filter(stage=stage).order_by("id"))
        entry = self.entry_model.objects.get(stage=stage, team=teams[0])

        wrong_group = groups[1] if entry.group_id == groups[0].id else groups[0]

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            self._panel_url(tournament, division),
            {
                "stage_id": stage.id,
                "group_id": wrong_group.id,
                "team_id": teams[0].id,
                "round_number": 1,
                "numeric_value": "10",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(self.result_model.objects.filter(stage=stage, team=teams[0]).exists())

    def test_mass_start_result_rejects_round_outside_stage_limit(self):
        tournament, division, teams, stages = self._create_context()
        stage = stages[0]
        group = self._first_group(stage)

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            self._panel_url(tournament, division),
            {
                "stage_id": stage.id,
                "group_id": group.id,
                "team_id": teams[0].id,
                "round_number": 2,
                "numeric_value": "10",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(self.result_model.objects.filter(stage=stage, team=teams[0]).exists())

    def test_other_user_cannot_save_mass_start_result(self):
        tournament, division, teams, stages = self._create_context()
        stage = stages[0]
        group = self._first_group(stage)

        self.client.force_authenticate(user=self.other_user)

        response = self.client.post(
            self._panel_url(tournament, division),
            {
                "stage_id": stage.id,
                "group_id": group.id,
                "team_id": teams[0].id,
                "round_number": 1,
                "numeric_value": "10",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertFalse(self.result_model.objects.filter(stage=stage, team=teams[0]).exists())

    def test_public_mass_start_results_reject_unpublished_tournament(self):
        tournament, division, _teams, _stages = self._create_context(is_published=False)

        response = self.client.get(self._public_url(tournament, division))

        self.assertEqual(response.status_code, 403)

    def test_public_mass_start_results_allow_published_tournament(self):
        tournament, division, _teams, stages = self._create_context(is_published=True)

        response = self.client.get(self._public_url(tournament, division))

        self.assertEqual(response.status_code, 200)

        data = response.json()

        self.assertEqual(data.get("tournament_id"), tournament.id)
        self.assertEqual(data.get("division_id"), division.id)
        self.assertEqual((data.get("stages") or [])[0].get("stage_id"), stages[0].id)

    def test_stage_is_automatically_closed_when_all_required_results_are_saved(self):
        tournament, division, teams, stages = self._create_context(teams_count=2)
        stage = stages[0]
        group = self._first_group(stage)

        self.client.force_authenticate(user=self.organizer)

        for index, team in enumerate(teams, start=1):
            response = self.client.post(
                self._panel_url(tournament, division),
                {
                    "stage_id": stage.id,
                    "group_id": group.id,
                    "team_id": team.id,
                    "round_number": 1,
                    "numeric_value": str(index * 10),
                },
                format="json",
            )
            self.assertEqual(response.status_code, 200)

        stage.refresh_from_db()

        self.assertEqual(stage.status, self.stage_model.Status.CLOSED)

    def test_result_cannot_be_saved_for_planned_mass_start_stage(self):
        result_config = self._result_config(
            stages=[
                {
                    Tournament.RESULTCFG_STAGE_NAME_KEY: "Kwalifikacje",
                    Tournament.RESULTCFG_STAGE_GROUPS_COUNT_KEY: 1,
                    Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY: 1,
                },
                {
                    Tournament.RESULTCFG_STAGE_NAME_KEY: "Finał",
                    Tournament.RESULTCFG_STAGE_GROUPS_COUNT_KEY: 1,
                    Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY: 1,
                },
            ]
        )
        tournament, division, teams, stages = self._create_context(
            name="Turniej MASS_START API planowany etap",
            teams_count=2,
            result_config=result_config,
        )
        planned_stage = stages[1]
        group = self._first_group(planned_stage)

        self.assertEqual(planned_stage.status, self.stage_model.Status.PLANNED)

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            self._panel_url(tournament, division),
            {
                "stage_id": planned_stage.id,
                "group_id": group.id,
                "team_id": teams[0].id,
                "round_number": 1,
                "numeric_value": "10",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(self.result_model.objects.filter(stage=planned_stage).exists())

    def test_time_mass_start_result_uses_time_ms_and_display_value(self):
        result_config = self._result_config(
            value_kind=Tournament.RESULTCFG_VALUE_KIND_TIME,
            better_result=Tournament.RESULTCFG_BETTER_RESULT_LOWER,
            stages=[
                {
                    Tournament.RESULTCFG_STAGE_NAME_KEY: "Finał czasowy",
                    Tournament.RESULTCFG_STAGE_GROUPS_COUNT_KEY: 1,
                    Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY: 1,
                }
            ],
        )
        result_config[Tournament.RESULTCFG_TIME_FORMAT_KEY] = Tournament.RESULTCFG_TIME_FORMAT_SS_HH

        tournament, division, teams, stages = self._create_context(
            name="Turniej MASS_START API czas",
            result_config=result_config,
        )
        stage = stages[0]
        group = self._first_group(stage)

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            self._panel_url(tournament, division),
            {
                "stage_id": stage.id,
                "group_id": group.id,
                "team_id": teams[0].id,
                "round_number": 1,
                "time_ms": 12340,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        result = self.result_model.objects.get(stage=stage, team=teams[0])

        self.assertEqual(result.value_kind, Tournament.RESULTCFG_VALUE_KIND_TIME)
        self.assertEqual(result.time_ms, 12340)
        self.assertEqual(result.display_value, "12.34")
        self.assertIsNone(result.numeric_value)
        self.assertIsNone(result.place_value)
