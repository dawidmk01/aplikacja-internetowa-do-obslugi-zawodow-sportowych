# backend/tournaments/tests/test_tournament_panel_summary.py
# Plik zawiera testy API zabezpieczające podsumowanie panelu i cele harmonogramu turnieju.

from django.apps import apps
from django.test import TestCase

from rest_framework.test import APIClient

from tournaments.models import Division, Team, Tournament

from .helpers import create_test_user


class TournamentPanelSummaryApiTests(TestCase):
    """Testy API zabezpieczają panel_stats i schedule_targets w szczegółach turnieju."""

    def setUp(self):
        self.organizer = create_test_user("panel-summary-owner@example.com")
        self.assistant = create_test_user("panel-summary-assistant@example.com")
        self.other_user = create_test_user("panel-summary-other@example.com")
        self.client = APIClient()

        self.membership_model = apps.get_model("tournaments", "TournamentMembership")
        self.stage_model = apps.get_model("tournaments", "Stage")
        self.group_model = apps.get_model("tournaments", "Group")
        self.match_model = apps.get_model("tournaments", "Match")
        self.player_model = apps.get_model("tournaments", "TeamPlayer")

    def _create_context(self):
        tournament = Tournament.objects.create(
            name="Turniej podsumowania panelu",
            discipline=Tournament.Discipline.FOOTBALL,
            organizer=self.organizer,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            status=Tournament.Status.CONFIGURED,
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

        first_stage = self.stage_model.objects.create(
            tournament=tournament,
            division=first_division,
            stage_type=self.stage_model.StageType.LEAGUE,
            order=1,
            scheduled_date="2026-06-01",
            scheduled_time="18:00:00",
            location="Boisko A",
        )

        second_stage = self.stage_model.objects.create(
            tournament=tournament,
            division=second_division,
            stage_type=self.stage_model.StageType.LEAGUE,
            order=1,
            scheduled_date="2026-06-02",
            scheduled_time="19:00:00",
            location="Boisko B",
        )

        first_group = self.group_model.objects.create(
            stage=first_stage,
            name="Grupa A",
            scheduled_date="2026-06-01",
            scheduled_time="18:30:00",
            location="Sektor A",
        )

        second_group = self.group_model.objects.create(
            stage=second_stage,
            name="Grupa B",
            scheduled_date="2026-06-02",
            scheduled_time="19:30:00",
            location="Sektor B",
        )

        first_teams = [
            Team.objects.create(
                tournament=tournament,
                division=first_division,
                name=f"Pierwsza drużyna {index}",
                is_active=True,
            )
            for index in range(1, 3)
        ]

        second_teams = [
            Team.objects.create(
                tournament=tournament,
                division=second_division,
                name=f"Druga drużyna {index}",
                is_active=True,
            )
            for index in range(1, 3)
        ]

        self.player_model.objects.create(
            team=first_teams[0],
            display_name="Zawodnik panelu 1",
            jersey_number=1,
            created_by=self.organizer,
        )
        self.player_model.objects.create(
            team=first_teams[0],
            display_name="Zawodnik panelu 2",
            jersey_number=2,
            created_by=self.organizer,
        )

        first_match = self.match_model.objects.create(
            tournament=tournament,
            stage=first_stage,
            group=first_group,
            home_team=first_teams[0],
            away_team=first_teams[1],
            round_number=1,
            status=self.match_model.Status.IN_PROGRESS,
        )

        second_match = self.match_model.objects.create(
            tournament=tournament,
            stage=second_stage,
            group=second_group,
            home_team=second_teams[0],
            away_team=second_teams[1],
            round_number=1,
            status=self.match_model.Status.FINISHED,
            home_score=2,
            away_score=0,
            result_entered=True,
        )

        return {
            "tournament": tournament,
            "first_division": first_division,
            "second_division": second_division,
            "first_stage": first_stage,
            "second_stage": second_stage,
            "first_group": first_group,
            "second_group": second_group,
            "first_match": first_match,
            "second_match": second_match,
        }

    def _detail_url(self, tournament, division=None):
        url = f"/api/tournaments/{tournament.id}/"
        if division is not None:
            url += f"?division_id={division.id}"
        return url

    def _create_assistant_membership(self, tournament):
        return self.membership_model.objects.create(
            tournament=tournament,
            user=self.assistant,
            role=self.membership_model.Role.ASSISTANT,
            status=self.membership_model.Status.ACCEPTED,
            permissions={
                self.membership_model.PERM_TEAMS_EDIT: True,
            },
            invited_by=self.organizer,
        )

    def test_organizer_detail_contains_panel_stats_for_tournament_scope(self):
        ctx = self._create_context()
        tournament = ctx["tournament"]

        self.client.force_authenticate(user=self.organizer)

        response = self.client.get(self._detail_url(tournament, ctx["first_division"]))

        self.assertEqual(response.status_code, 200)

        stats = response.json().get("panel_stats") or {}

        self.assertEqual(stats.get("status"), Tournament.Status.CONFIGURED)
        self.assertEqual(stats.get("divisions_count"), 2)
        self.assertEqual(stats.get("teams_count"), 4)
        self.assertEqual(stats.get("players_count"), 2)
        self.assertEqual(stats.get("stages_total"), 2)
        self.assertEqual(stats.get("progress_mode"), "MATCHES")
        self.assertEqual(stats.get("primary_progress_current"), 1)
        self.assertEqual(stats.get("primary_progress_total"), 2)
        self.assertEqual(stats.get("primary_progress_label"), "1/2")
        self.assertEqual(stats.get("secondary_progress_current"), 1)
        self.assertEqual(stats.get("secondary_progress_total"), 2)
        self.assertEqual(stats.get("secondary_progress_label"), "1/2")

    def test_schedule_targets_are_limited_to_selected_division(self):
        ctx = self._create_context()
        tournament = ctx["tournament"]

        self.client.force_authenticate(user=self.organizer)

        response = self.client.get(self._detail_url(tournament, ctx["first_division"]))

        self.assertEqual(response.status_code, 200)

        targets = response.json().get("schedule_targets") or {}
        stages = targets.get("stages") or []
        groups = targets.get("groups") or []

        stage_ids = {item.get("stage_id") for item in stages}
        group_ids = {item.get("group_id") for item in groups}

        self.assertIn(ctx["first_stage"].id, stage_ids)
        self.assertNotIn(ctx["second_stage"].id, stage_ids)
        self.assertIn(ctx["first_group"].id, group_ids)
        self.assertNotIn(ctx["second_group"].id, group_ids)

    def test_schedule_targets_return_stage_and_group_schedule_metadata(self):
        ctx = self._create_context()
        tournament = ctx["tournament"]

        self.client.force_authenticate(user=self.organizer)

        response = self.client.get(self._detail_url(tournament, ctx["first_division"]))

        self.assertEqual(response.status_code, 200)

        targets = response.json().get("schedule_targets") or {}
        stages = targets.get("stages") or []
        groups = targets.get("groups") or []

        stage_payload = next(item for item in stages if item.get("stage_id") == ctx["first_stage"].id)
        group_payload = next(item for item in groups if item.get("group_id") == ctx["first_group"].id)

        self.assertEqual(stage_payload.get("stage_name"), "Liga")
        self.assertEqual(stage_payload.get("scheduled_date"), "2026-06-01")
        self.assertEqual(stage_payload.get("scheduled_time"), "18:00")
        self.assertEqual(stage_payload.get("location"), "Boisko A")

        self.assertEqual(group_payload.get("group_name"), "Grupa A")
        self.assertEqual(group_payload.get("stage_id"), ctx["first_stage"].id)
        self.assertEqual(group_payload.get("scheduled_date"), "2026-06-01")
        self.assertEqual(group_payload.get("scheduled_time"), "18:30")
        self.assertEqual(group_payload.get("location"), "Sektor A")

    def test_active_division_fields_match_requested_division(self):
        ctx = self._create_context()
        tournament = ctx["tournament"]

        self.client.force_authenticate(user=self.organizer)

        response = self.client.get(self._detail_url(tournament, ctx["second_division"]))

        self.assertEqual(response.status_code, 200)

        data = response.json()

        self.assertEqual(data.get("active_division_id"), ctx["second_division"].id)
        self.assertEqual(data.get("active_division_name"), "Druga dywizja")
        self.assertEqual(data.get("division_status"), Tournament.Status.CONFIGURED)

    def test_assistant_can_read_panel_summary_but_gets_limited_permissions(self):
        ctx = self._create_context()
        tournament = ctx["tournament"]
        self._create_assistant_membership(tournament)

        self.client.force_authenticate(user=self.assistant)

        response = self.client.get(self._detail_url(tournament, ctx["first_division"]))

        self.assertEqual(response.status_code, 200)

        data = response.json()
        permissions = data.get("my_permissions") or {}

        self.assertEqual(data.get("my_role"), self.membership_model.Role.ASSISTANT)
        self.assertIn("panel_stats", data)
        self.assertIn("schedule_targets", data)
        self.assertTrue(permissions.get(self.membership_model.PERM_TEAMS_EDIT))
        self.assertFalse(permissions.get(self.membership_model.PERM_PUBLISH))
        self.assertFalse(permissions.get(self.membership_model.PERM_ARCHIVE))
        self.assertFalse(permissions.get(self.membership_model.PERM_MANAGE_ASSISTANTS))

    def test_other_user_cannot_read_private_panel_summary(self):
        ctx = self._create_context()
        tournament = ctx["tournament"]

        self.client.force_authenticate(user=self.other_user)

        response = self.client.get(self._detail_url(tournament, ctx["first_division"]))

        self.assertEqual(response.status_code, 403)
