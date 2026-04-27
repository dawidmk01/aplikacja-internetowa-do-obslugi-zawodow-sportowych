# backend/tournaments/tests/test_setup_reset.py
# Plik testuje zmianę konfiguracji rozgrywek oraz izolację resetu struktury między dywizjami.

from django.apps import apps
from django.test import TestCase
from rest_framework.test import APIClient

from tournaments.models import Division, Team, Tournament
from tournaments.services.match_generation import ensure_matches_generated

from .helpers import create_test_user


class TournamentSetupResetApiTests(TestCase):
    """Testy zabezpieczają zmianę setupu aktywnej dywizji i reset wyłącznie jej struktury."""

    def setUp(self):
        self.organizer = create_test_user("setup-reset-owner@example.com")
        self.assistant = create_test_user("setup-reset-assistant@example.com")
        self.other_user = create_test_user("setup-reset-other@example.com")
        self.client = APIClient()

        self.stage_model = apps.get_model("tournaments", "Stage")
        self.match_model = apps.get_model("tournaments", "Match")
        self.membership_model = apps.get_model("tournaments", "TournamentMembership")

        self.tournament = Tournament.objects.create(
            name="Turniej resetu setupu",
            discipline=Tournament.Discipline.FOOTBALL,
            organizer=self.organizer,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            status=Tournament.Status.CONFIGURED,
            entry_mode=Tournament.EntryMode.MANAGER,
        )

        self.default_division = Division.objects.create(
            tournament=self.tournament,
            name="Dywizja główna",
            is_default=True,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            status=Tournament.Status.CONFIGURED,
        )

        self.second_division = Division.objects.create(
            tournament=self.tournament,
            name="Druga dywizja",
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            status=Tournament.Status.CONFIGURED,
        )

        self.default_teams = self._create_teams(self.default_division, "Główna", 4)
        self.second_teams = self._create_teams(self.second_division, "Druga", 4)

        ensure_matches_generated(self.tournament, division=self.default_division)
        ensure_matches_generated(self.tournament, division=self.second_division)

    def _create_teams(self, division, prefix, count):
        return [
            Team.objects.create(
                tournament=self.tournament,
                division=division,
                name=f"{prefix} {index}",
                is_active=True,
            )
            for index in range(1, count + 1)
        ]

    def _setup_url(self, division=None, *, dry_run=False):
        division = division or self.default_division
        suffix = f"?division_id={division.id}"
        if dry_run:
            suffix += "&dry_run=1"
        return f"/api/tournaments/{self.tournament.id}/setup/{suffix}"

    def _create_assistant_membership(self, *, tournament_edit=False):
        return self.membership_model.objects.create(
            tournament=self.tournament,
            user=self.assistant,
            role=self.membership_model.Role.ASSISTANT,
            status=self.membership_model.Status.ACCEPTED,
            permissions={
                self.membership_model.PERM_TOURNAMENT_EDIT: tournament_edit,
            },
            invited_by=self.organizer,
        )

    def _stage_ids_for_division(self, division):
        return set(
            self.stage_model.objects.filter(
                tournament=self.tournament,
                division=division,
            ).values_list("id", flat=True)
        )

    def _match_ids_for_division(self, division):
        return set(
            self.match_model.objects.filter(
                tournament=self.tournament,
                stage__division=division,
            ).values_list("id", flat=True)
        )

    def test_setup_dry_run_reports_no_reset_for_unchanged_configuration(self):
        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            self._setup_url(self.default_division, dry_run=True),
            {
                "tournament_format": Tournament.TournamentFormat.LEAGUE,
                "format_config": {},
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json().get("changed"))
        self.assertFalse(response.json().get("requires_reset"))

    def test_setup_dry_run_reports_reset_for_changed_format(self):
        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            self._setup_url(self.default_division, dry_run=True),
            {
                "tournament_format": Tournament.TournamentFormat.CUP,
                "format_config": {},
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json().get("changed"))
        self.assertTrue(response.json().get("requires_reset"))

    def test_organizer_can_change_setup_and_clear_only_selected_division_structure(self):
        old_default_stages = self._stage_ids_for_division(self.default_division)
        old_default_matches = self._match_ids_for_division(self.default_division)

        old_second_stages = self._stage_ids_for_division(self.second_division)
        old_second_matches = self._match_ids_for_division(self.second_division)

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            self._setup_url(self.default_division),
            {
                "tournament_format": Tournament.TournamentFormat.CUP,
                "format_config": {
                    "cup_matches": 1,
                    "third_place": True,
                },
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        self.default_division.refresh_from_db()
        self.second_division.refresh_from_db()
        self.tournament.refresh_from_db()

        self.assertEqual(self.default_division.tournament_format, Tournament.TournamentFormat.CUP)
        self.assertEqual(self.default_division.format_config.get("cup_matches"), 1)
        self.assertTrue(self.default_division.format_config.get("third_place"))

        self.assertEqual(self.second_division.tournament_format, Tournament.TournamentFormat.LEAGUE)
        self.assertEqual(self.second_division.format_config, {})

        self.assertTrue(old_default_stages)
        self.assertTrue(old_default_matches)
        self.assertFalse(self._stage_ids_for_division(self.default_division))
        self.assertFalse(self._match_ids_for_division(self.default_division))

        self.assertSetEqual(self._stage_ids_for_division(self.second_division), old_second_stages)
        self.assertSetEqual(self._match_ids_for_division(self.second_division), old_second_matches)

        self.assertEqual(self.tournament.tournament_format, Tournament.TournamentFormat.CUP)

    def test_change_setup_for_non_default_division_does_not_sync_legacy_tournament_config(self):
        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            self._setup_url(self.second_division),
            {
                "tournament_format": Tournament.TournamentFormat.CUP,
                "format_config": {
                    "cup_matches": 1,
                },
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        self.second_division.refresh_from_db()
        self.tournament.refresh_from_db()

        self.assertEqual(self.second_division.tournament_format, Tournament.TournamentFormat.CUP)
        self.assertEqual(self.tournament.tournament_format, Tournament.TournamentFormat.LEAGUE)

    def test_change_setup_rejects_invalid_format(self):
        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            self._setup_url(self.default_division),
            {
                "tournament_format": "INVALID_FORMAT",
                "format_config": {},
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)

        self.default_division.refresh_from_db()

        self.assertEqual(self.default_division.tournament_format, Tournament.TournamentFormat.LEAGUE)

    def test_assistant_with_tournament_edit_cannot_change_setup_reset(self):
        self._create_assistant_membership(tournament_edit=True)
        self.client.force_authenticate(user=self.assistant)

        response = self.client.post(
            self._setup_url(self.default_division),
            {
                "tournament_format": Tournament.TournamentFormat.CUP,
                "format_config": {
                    "cup_matches": 1,
                },
            },
            format="json",
        )

        self.assertEqual(response.status_code, 403)

        self.default_division.refresh_from_db()

        self.assertEqual(self.default_division.tournament_format, Tournament.TournamentFormat.LEAGUE)

    def test_assistant_without_tournament_edit_cannot_change_setup(self):
        self._create_assistant_membership(tournament_edit=False)
        self.client.force_authenticate(user=self.assistant)

        response = self.client.post(
            self._setup_url(self.default_division),
            {
                "tournament_format": Tournament.TournamentFormat.CUP,
                "format_config": {},
            },
            format="json",
        )

        self.assertEqual(response.status_code, 403)

        self.default_division.refresh_from_db()

        self.assertEqual(self.default_division.tournament_format, Tournament.TournamentFormat.LEAGUE)

    def test_organizer_only_entry_mode_blocks_assistant_setup_change(self):
        self._create_assistant_membership(tournament_edit=True)

        self.tournament.entry_mode = Tournament.EntryMode.ORGANIZER_ONLY
        self.tournament.save(update_fields=["entry_mode"])

        self.client.force_authenticate(user=self.assistant)

        response = self.client.post(
            self._setup_url(self.default_division),
            {
                "tournament_format": Tournament.TournamentFormat.CUP,
                "format_config": {},
            },
            format="json",
        )

        self.assertEqual(response.status_code, 403)

        self.default_division.refresh_from_db()

        self.assertEqual(self.default_division.tournament_format, Tournament.TournamentFormat.LEAGUE)

    def test_other_user_cannot_change_setup(self):
        self.client.force_authenticate(user=self.other_user)

        response = self.client.post(
            self._setup_url(self.default_division),
            {
                "tournament_format": Tournament.TournamentFormat.CUP,
                "format_config": {},
            },
            format="json",
        )

        self.assertIn(response.status_code, {403, 404})

        self.default_division.refresh_from_db()

        self.assertEqual(self.default_division.tournament_format, Tournament.TournamentFormat.LEAGUE)
