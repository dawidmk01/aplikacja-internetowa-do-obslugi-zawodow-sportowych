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
        stage_structure_mode=None,
        multi_event_overall_mode=None,
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
            Tournament.RESULTCFG_STAGE_STRUCTURE_MODE_KEY: stage_structure_mode or Tournament.RESULTCFG_STAGE_STRUCTURE_REDUCTION,
            Tournament.RESULTCFG_MULTI_EVENT_OVERALL_MODE_KEY: (
                multi_event_overall_mode
                or Tournament.RESULTCFG_MULTI_EVENT_OVERALL_POINTS_BY_RANK
            ),
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

    def test_organizer_can_save_dns_mass_start_result_without_value(self):
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
                "result_status": "DNS",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        result = self.result_model.objects.get(stage=stage, group=group, team=teams[0])

        self.assertEqual(result.result_status, self.result_model.ResultStatus.DNS)
        self.assertIsNone(result.numeric_value)
        self.assertIsNone(result.time_ms)
        self.assertIsNone(result.place_value)
        self.assertEqual(result.display_value, "DNS")
        self.assertIsNone(result.rank)

    def test_mass_start_result_status_rejects_value_payload(self):
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
                "result_status": "DNF",
                "numeric_value": "10",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(self.result_model.objects.filter(stage=stage, team=teams[0]).exists())

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

    def test_multi_event_result_can_be_saved_for_planned_parallel_competition(self):
        result_config = self._result_config(
            stage_structure_mode=Tournament.RESULTCFG_STAGE_STRUCTURE_MULTI_EVENT,
            stages=[
                {
                    Tournament.RESULTCFG_STAGE_NAME_KEY: "Przysiad",
                    Tournament.RESULTCFG_STAGE_GROUPS_COUNT_KEY: 1,
                    Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY: 1,
                },
                {
                    Tournament.RESULTCFG_STAGE_NAME_KEY: "Martwy ciąg",
                    Tournament.RESULTCFG_STAGE_GROUPS_COUNT_KEY: 1,
                    Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY: 1,
                },
            ],
        )
        tournament, division, teams, stages = self._create_context(
            name="Turniej MASS_START API wielobój",
            teams_count=2,
            result_config=result_config,
        )
        planned_stage = stages[1]
        planned_stage.status = self.stage_model.Status.PLANNED
        planned_stage.save(update_fields=["status"])
        group = self._first_group(planned_stage)

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

        self.assertEqual(response.status_code, 200)
        self.assertTrue(self.result_model.objects.filter(stage=planned_stage, team=teams[0]).exists())
        self.assertEqual(response.json().get("detail"), "Wynik konkurencji zapisany.")

    def test_multi_event_public_payload_hides_advance_count(self):
        result_config = self._result_config(
            stage_structure_mode=Tournament.RESULTCFG_STAGE_STRUCTURE_MULTI_EVENT,
            stages=[
                {
                    Tournament.RESULTCFG_STAGE_NAME_KEY: "Bieg",
                    Tournament.RESULTCFG_STAGE_GROUPS_COUNT_KEY: 1,
                    Tournament.RESULTCFG_STAGE_ADVANCE_COUNT_KEY: 1,
                    Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY: 1,
                },
            ],
        )
        tournament, division, _teams, _stages = self._create_context(
            name="Turniej MASS_START API payload wielobój",
            result_config=result_config,
            is_published=True,
        )

        response = self.client.get(self._public_url(tournament, division))

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data.get("stage_structure_mode"), Tournament.RESULTCFG_STAGE_STRUCTURE_MULTI_EVENT)
        self.assertIsNone((data.get("stages") or [])[0].get("advance_count"))

    def test_multi_event_public_payload_includes_overall_standings(self):
        result_config = self._result_config(
            stage_structure_mode=Tournament.RESULTCFG_STAGE_STRUCTURE_MULTI_EVENT,
            stages=[
                {
                    Tournament.RESULTCFG_STAGE_NAME_KEY: "Przysiad",
                    Tournament.RESULTCFG_STAGE_GROUPS_COUNT_KEY: 1,
                    Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY: 1,
                },
                {
                    Tournament.RESULTCFG_STAGE_NAME_KEY: "Martwy ciąg",
                    Tournament.RESULTCFG_STAGE_GROUPS_COUNT_KEY: 1,
                    Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY: 1,
                },
            ],
        )
        tournament, division, teams, stages = self._create_context(
            name="Turniej MASS_START API klasyfikacja łączna",
            teams_count=3,
            result_config=result_config,
            is_published=True,
        )

        self.client.force_authenticate(user=self.organizer)

        first_stage = stages[0]
        first_group = self._first_group(first_stage)
        second_stage = stages[1]
        second_group = self._first_group(second_stage)

        payloads = [
            (first_stage, first_group, teams[0], {"numeric_value": "100"}),
            (first_stage, first_group, teams[1], {"numeric_value": "90"}),
            (first_stage, first_group, teams[2], {"result_status": "DNS"}),
            (second_stage, second_group, teams[0], {"numeric_value": "80"}),
            (second_stage, second_group, teams[1], {"result_status": "DNF"}),
            (second_stage, second_group, teams[2], {"numeric_value": "120"}),
        ]

        for stage, group, team, result_payload in payloads:
            response = self.client.post(
                self._panel_url(tournament, division),
                {
                    "stage_id": stage.id,
                    "group_id": group.id,
                    "team_id": team.id,
                    "round_number": 1,
                    **result_payload,
                },
                format="json",
            )
            self.assertEqual(response.status_code, 200)

        self.client.force_authenticate(user=None)
        response = self.client.get(self._public_url(tournament, division))

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data.get("overall_mode"), Tournament.RESULTCFG_MULTI_EVENT_OVERALL_POINTS_BY_RANK)
        standings = data.get("overall_standings") or []

        self.assertEqual(len(standings), 3)
        self.assertEqual(standings[0].get("team_id"), teams[0].id)
        self.assertEqual(standings[0].get("rank"), 1)
        self.assertEqual(standings[0].get("total_points"), 3)
        self.assertEqual(standings[0].get("completed_events_count"), 2)
        self.assertEqual(
            [event.get("stage_name") for event in data.get("overall_events", [])],
            ["Przysiad", "Martwy ciąg"],
        )
        self.assertEqual(
            [event.get("overall_contribution_display") for event in standings[0].get("event_results", [])],
            ["2", "1"],
        )
        self.assertTrue(all(event.get("is_completed") for event in standings[0].get("event_results", [])))
        self.assertEqual(standings[1].get("team_id"), teams[2].id)
        self.assertEqual(standings[1].get("total_points"), 2)
        self.assertEqual(
            standings[1].get("event_results", [])[0].get("overall_contribution_display"),
            "Nie wystartował",
        )
        self.assertEqual(standings[2].get("team_id"), teams[1].id)
        self.assertEqual(standings[2].get("special_statuses_count"), 1)


    def test_multi_event_overall_standings_can_use_sum_ranks(self):
        result_config = self._result_config(
            stage_structure_mode=Tournament.RESULTCFG_STAGE_STRUCTURE_MULTI_EVENT,
            multi_event_overall_mode=Tournament.RESULTCFG_MULTI_EVENT_OVERALL_SUM_RANKS,
            stages=[
                {
                    Tournament.RESULTCFG_STAGE_NAME_KEY: "Konkurencja 1",
                    Tournament.RESULTCFG_STAGE_GROUPS_COUNT_KEY: 1,
                    Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY: 1,
                },
                {
                    Tournament.RESULTCFG_STAGE_NAME_KEY: "Konkurencja 2",
                    Tournament.RESULTCFG_STAGE_GROUPS_COUNT_KEY: 1,
                    Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY: 1,
                },
            ],
        )
        tournament, division, teams, stages = self._create_context(
            name="Turniej MASS_START API suma miejsc",
            teams_count=2,
            result_config=result_config,
            is_published=True,
        )

        self.client.force_authenticate(user=self.organizer)

        payloads = [
            (stages[0], teams[0], "10"),
            (stages[0], teams[1], "20"),
            (stages[1], teams[0], "30"),
            (stages[1], teams[1], "35"),
        ]

        for stage, team, value in payloads:
            response = self.client.post(
                self._panel_url(tournament, division),
                {
                    "stage_id": stage.id,
                    "group_id": self._first_group(stage).id,
                    "team_id": team.id,
                    "round_number": 1,
                    "numeric_value": value,
                },
                format="json",
            )
            self.assertEqual(response.status_code, 200)

        self.client.force_authenticate(user=None)
        response = self.client.get(self._public_url(tournament, division))

        self.assertEqual(response.status_code, 200)
        data = response.json()
        standings = data.get("overall_standings") or []

        self.assertEqual(data.get("overall_mode"), Tournament.RESULTCFG_MULTI_EVENT_OVERALL_SUM_RANKS)
        self.assertEqual(standings[0].get("team_id"), teams[1].id)
        self.assertEqual(standings[0].get("total_rank_sum"), 2)
        self.assertEqual(standings[0].get("overall_display"), "2")

    def test_multi_event_overall_standings_can_use_sum_results(self):
        result_config = self._result_config(
            stage_structure_mode=Tournament.RESULTCFG_STAGE_STRUCTURE_MULTI_EVENT,
            multi_event_overall_mode=Tournament.RESULTCFG_MULTI_EVENT_OVERALL_SUM_RESULTS,
            stages=[
                {
                    Tournament.RESULTCFG_STAGE_NAME_KEY: "Konkurencja 1",
                    Tournament.RESULTCFG_STAGE_GROUPS_COUNT_KEY: 1,
                    Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY: 1,
                },
                {
                    Tournament.RESULTCFG_STAGE_NAME_KEY: "Konkurencja 2",
                    Tournament.RESULTCFG_STAGE_GROUPS_COUNT_KEY: 1,
                    Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY: 1,
                },
            ],
        )
        tournament, division, teams, stages = self._create_context(
            name="Turniej MASS_START API suma wyników",
            teams_count=2,
            result_config=result_config,
            is_published=True,
        )

        self.client.force_authenticate(user=self.organizer)

        payloads = [
            (stages[0], teams[0], "10"),
            (stages[0], teams[1], "20"),
            (stages[1], teams[0], "30"),
            (stages[1], teams[1], "25"),
        ]

        for stage, team, value in payloads:
            response = self.client.post(
                self._panel_url(tournament, division),
                {
                    "stage_id": stage.id,
                    "group_id": self._first_group(stage).id,
                    "team_id": team.id,
                    "round_number": 1,
                    "numeric_value": value,
                },
                format="json",
            )
            self.assertEqual(response.status_code, 200)

        self.client.force_authenticate(user=None)
        response = self.client.get(self._public_url(tournament, division))

        self.assertEqual(response.status_code, 200)
        data = response.json()
        standings = data.get("overall_standings") or []

        self.assertEqual(data.get("overall_mode"), Tournament.RESULTCFG_MULTI_EVENT_OVERALL_SUM_RESULTS)
        self.assertEqual(standings[0].get("team_id"), teams[1].id)
        self.assertEqual(standings[0].get("overall_display"), "45.00 pkt")

    def test_multi_event_sum_results_ignores_invalid_attempt_when_valid_result_exists(self):
        result_config = self._result_config(
            stage_structure_mode=Tournament.RESULTCFG_STAGE_STRUCTURE_MULTI_EVENT,
            multi_event_overall_mode=Tournament.RESULTCFG_MULTI_EVENT_OVERALL_SUM_RESULTS,
            rounds_count=3,
            stages=[
                {
                    Tournament.RESULTCFG_STAGE_NAME_KEY: "Przysiad",
                    Tournament.RESULTCFG_STAGE_GROUPS_COUNT_KEY: 1,
                    Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY: 3,
                },
                {
                    Tournament.RESULTCFG_STAGE_NAME_KEY: "Wyciskanie leżąc",
                    Tournament.RESULTCFG_STAGE_GROUPS_COUNT_KEY: 1,
                    Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY: 3,
                },
                {
                    Tournament.RESULTCFG_STAGE_NAME_KEY: "Martwy ciąg",
                    Tournament.RESULTCFG_STAGE_GROUPS_COUNT_KEY: 1,
                    Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY: 3,
                },
            ],
        )
        result_config[Tournament.RESULTCFG_UNIT_PRESET_KEY] = Tournament.RESULTCFG_UNIT_PRESET_KILOGRAMS
        result_config[Tournament.RESULTCFG_UNIT_KEY] = "kg"
        result_config[Tournament.RESULTCFG_UNIT_LABEL_KEY] = "kg"

        tournament, division, teams, stages = self._create_context(
            name="Turniej MASS_START API trójbój",
            teams_count=2,
            result_config=result_config,
            is_published=True,
        )

        self.client.force_authenticate(user=self.organizer)

        payloads = [
            (stages[0], teams[0], 1, {"numeric_value": "150"}),
            (stages[0], teams[0], 2, {"numeric_value": "160"}),
            (stages[0], teams[0], 3, {"numeric_value": "170"}),
            (stages[1], teams[0], 1, {"numeric_value": "100"}),
            (stages[1], teams[0], 2, {"numeric_value": "110"}),
            (stages[1], teams[0], 3, {"numeric_value": "115"}),
            (stages[2], teams[0], 1, {"numeric_value": "200"}),
            (stages[2], teams[0], 2, {"numeric_value": "210"}),
            (stages[2], teams[0], 3, {"numeric_value": "220"}),
            (stages[0], teams[1], 1, {"numeric_value": "160"}),
            (stages[0], teams[1], 2, {"numeric_value": "180"}),
            (stages[0], teams[1], 3, {"result_status": "DSQ"}),
            (stages[1], teams[1], 1, {"numeric_value": "100"}),
            (stages[1], teams[1], 2, {"numeric_value": "110"}),
            (stages[1], teams[1], 3, {"numeric_value": "117.5"}),
            (stages[2], teams[1], 1, {"numeric_value": "190"}),
            (stages[2], teams[1], 2, {"numeric_value": "210"}),
            (stages[2], teams[1], 3, {"numeric_value": "220"}),
        ]

        for stage, team, round_number, result_payload in payloads:
            response = self.client.post(
                self._panel_url(tournament, division),
                {
                    "stage_id": stage.id,
                    "group_id": self._first_group(stage).id,
                    "team_id": team.id,
                    "round_number": round_number,
                    **result_payload,
                },
                format="json",
            )
            self.assertEqual(response.status_code, 200)

        self.client.force_authenticate(user=None)
        response = self.client.get(self._public_url(tournament, division))

        self.assertEqual(response.status_code, 200)
        data = response.json()
        standings = data.get("overall_standings") or []

        self.assertEqual(data.get("overall_mode"), Tournament.RESULTCFG_MULTI_EVENT_OVERALL_SUM_RESULTS)
        self.assertEqual(standings[0].get("team_id"), teams[1].id)
        self.assertEqual(standings[0].get("rank"), 1)
        self.assertEqual(standings[0].get("overall_display"), "517.50 kg")
        self.assertEqual(standings[0].get("special_statuses_count"), 0)
        self.assertEqual(
            standings[0].get("event_results", [])[0].get("overall_contribution_display"),
            "180.00 kg",
        )
        self.assertEqual(standings[1].get("team_id"), teams[0].id)
        self.assertEqual(standings[1].get("overall_display"), "505.00 kg")

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
