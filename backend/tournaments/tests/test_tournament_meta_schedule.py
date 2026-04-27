# backend/tournaments/tests/test_tournament_meta_schedule.py
# Plik testuje aktualizację metadanych turnieju oraz harmonogramu etapów i grup.

from django.apps import apps
from django.test import TestCase
from rest_framework.test import APIClient

from tournaments.models import Division, Team, Tournament

from .helpers import create_test_user


class TournamentMetaScheduleApiTests(TestCase):
    """Testy zabezpieczają edycję metadanych i harmonogramu w kontekście aktywnej dywizji."""

    def setUp(self):
        self.organizer = create_test_user("meta-owner@example.com")
        self.assistant = create_test_user("meta-assistant@example.com")
        self.other_assistant = create_test_user("meta-other-assistant@example.com")
        self.other_user = create_test_user("meta-other@example.com")
        self.client = APIClient()

        self.stage_model = apps.get_model("tournaments", "Stage")
        self.group_model = apps.get_model("tournaments", "Group")
        self.membership_model = apps.get_model("tournaments", "TournamentMembership")

        self.tournament = Tournament.objects.create(
            name="Turniej metadanych",
            discipline=Tournament.Discipline.FOOTBALL,
            organizer=self.organizer,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.MIXED,
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
            tournament_format=Tournament.TournamentFormat.MIXED,
            result_mode=Tournament.ResultMode.SCORE,
            status=Tournament.Status.CONFIGURED,
        )

        self.second_division = Division.objects.create(
            tournament=self.tournament,
            name="Druga dywizja",
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.MIXED,
            result_mode=Tournament.ResultMode.SCORE,
            status=Tournament.Status.CONFIGURED,
        )

        self.default_stage = self.stage_model.objects.create(
            tournament=self.tournament,
            division=self.default_division,
            stage_type=self.stage_model.StageType.GROUP,
            order=1,
        )
        self.second_stage = self.stage_model.objects.create(
            tournament=self.tournament,
            division=self.second_division,
            stage_type=self.stage_model.StageType.GROUP,
            order=1,
        )

        self.default_group = self.group_model.objects.create(
            stage=self.default_stage,
            name="Grupa A",
        )
        self.second_group = self.group_model.objects.create(
            stage=self.second_stage,
            name="Grupa B",
        )

        for index in range(1, 3):
            Team.objects.create(
                tournament=self.tournament,
                division=self.default_division,
                name=f"Drużyna główna {index}",
                is_active=True,
            )
            Team.objects.create(
                tournament=self.tournament,
                division=self.second_division,
                name=f"Drużyna druga {index}",
                is_active=True,
            )

    def _meta_url(self, division=None):
        division = division or self.default_division
        return f"/api/tournaments/{self.tournament.id}/meta/?division_id={division.id}"

    def _create_assistant_membership(self, user, *, tournament_edit=False):
        return self.membership_model.objects.create(
            tournament=self.tournament,
            user=user,
            role=self.membership_model.Role.ASSISTANT,
            status=self.membership_model.Status.ACCEPTED,
            permissions={
                self.membership_model.PERM_TOURNAMENT_EDIT: tournament_edit,
            },
            invited_by=self.organizer,
        )

    def test_organizer_can_update_tournament_metadata(self):
        self.client.force_authenticate(user=self.organizer)

        response = self.client.patch(
            self._meta_url(),
            {
                "start_date": "2026-06-01",
                "end_date": "2026-06-30",
                "location": "Poznań",
                "description": "Opis turnieju po aktualizacji.",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        self.tournament.refresh_from_db()

        self.assertEqual(str(self.tournament.start_date), "2026-06-01")
        self.assertEqual(str(self.tournament.end_date), "2026-06-30")
        self.assertEqual(self.tournament.location, "Poznań")
        self.assertEqual(self.tournament.description, "Opis turnieju po aktualizacji.")

    def test_metadata_update_rejects_end_date_before_start_date(self):
        self.client.force_authenticate(user=self.organizer)

        response = self.client.patch(
            self._meta_url(),
            {
                "start_date": "2026-06-30",
                "end_date": "2026-06-01",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)

        self.tournament.refresh_from_db()

        self.assertIsNone(self.tournament.start_date)
        self.assertIsNone(self.tournament.end_date)

    def test_organizer_can_update_stage_schedule_for_selected_division(self):
        self.client.force_authenticate(user=self.organizer)

        response = self.client.patch(
            self._meta_url(self.default_division),
            {
                "start_date": "2026-06-01",
                "end_date": "2026-06-30",
                "stage_schedule": [
                    {
                        "stage_id": self.default_stage.id,
                        "scheduled_date": "2026-06-10",
                        "scheduled_time": "18:30:00",
                        "location": "Boisko główne",
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        self.default_stage.refresh_from_db()
        self.second_stage.refresh_from_db()

        self.assertEqual(str(self.default_stage.scheduled_date), "2026-06-10")
        self.assertEqual(str(self.default_stage.scheduled_time), "18:30:00")
        self.assertEqual(self.default_stage.location, "Boisko główne")

        self.assertIsNone(self.second_stage.scheduled_date)
        self.assertIsNone(self.second_stage.scheduled_time)
        self.assertIsNone(self.second_stage.location)

    def test_organizer_can_update_group_schedule_for_selected_division(self):
        self.client.force_authenticate(user=self.organizer)

        response = self.client.patch(
            self._meta_url(self.default_division),
            {
                "start_date": "2026-06-01",
                "end_date": "2026-06-30",
                "group_schedule": [
                    {
                        "group_id": self.default_group.id,
                        "scheduled_date": "2026-06-11",
                        "scheduled_time": "19:00:00",
                        "location": "Sala A",
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        self.default_group.refresh_from_db()
        self.second_group.refresh_from_db()

        self.assertEqual(str(self.default_group.scheduled_date), "2026-06-11")
        self.assertEqual(str(self.default_group.scheduled_time), "19:00:00")
        self.assertEqual(self.default_group.location, "Sala A")

        self.assertIsNone(self.second_group.scheduled_date)
        self.assertIsNone(self.second_group.scheduled_time)
        self.assertIsNone(self.second_group.location)

    def test_stage_schedule_rejects_stage_from_other_division(self):
        self.client.force_authenticate(user=self.organizer)

        response = self.client.patch(
            self._meta_url(self.default_division),
            {
                "stage_schedule": [
                    {
                        "stage_id": self.second_stage.id,
                        "scheduled_date": "2026-06-12",
                        "scheduled_time": "20:00:00",
                        "location": "Błędna dywizja",
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)

        self.second_stage.refresh_from_db()
        self.assertIsNone(self.second_stage.scheduled_date)
        self.assertIsNone(self.second_stage.scheduled_time)
        self.assertIsNone(self.second_stage.location)

    def test_group_schedule_rejects_group_from_other_division(self):
        self.client.force_authenticate(user=self.organizer)

        response = self.client.patch(
            self._meta_url(self.default_division),
            {
                "group_schedule": [
                    {
                        "group_id": self.second_group.id,
                        "scheduled_date": "2026-06-12",
                        "scheduled_time": "20:00:00",
                        "location": "Błędna grupa",
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)

        self.second_group.refresh_from_db()
        self.assertIsNone(self.second_group.scheduled_date)
        self.assertIsNone(self.second_group.scheduled_time)
        self.assertIsNone(self.second_group.location)

    def test_assistant_with_tournament_edit_can_update_metadata(self):
        self._create_assistant_membership(self.assistant, tournament_edit=True)
        self.client.force_authenticate(user=self.assistant)

        response = self.client.patch(
            self._meta_url(),
            {
                "location": "Hala asystenta",
                "description": "Opis zapisany przez asystenta.",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        self.tournament.refresh_from_db()

        self.assertEqual(self.tournament.location, "Hala asystenta")
        self.assertEqual(self.tournament.description, "Opis zapisany przez asystenta.")

    def test_assistant_without_tournament_edit_cannot_update_metadata(self):
        self._create_assistant_membership(self.other_assistant, tournament_edit=False)
        self.client.force_authenticate(user=self.other_assistant)

        response = self.client.patch(
            self._meta_url(),
            {
                "location": "Niedozwolona lokalizacja",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 403)

        self.tournament.refresh_from_db()

        self.assertNotEqual(self.tournament.location, "Niedozwolona lokalizacja")

    def test_organizer_only_entry_mode_blocks_assistant_metadata_update(self):
        self._create_assistant_membership(self.assistant, tournament_edit=True)

        self.tournament.entry_mode = Tournament.EntryMode.ORGANIZER_ONLY
        self.tournament.save(update_fields=["entry_mode"])

        self.client.force_authenticate(user=self.assistant)

        response = self.client.patch(
            self._meta_url(),
            {
                "location": "Zablokowana lokalizacja",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 403)

        self.tournament.refresh_from_db()

        self.assertNotEqual(self.tournament.location, "Zablokowana lokalizacja")

    def test_other_user_cannot_update_metadata(self):
        self.client.force_authenticate(user=self.other_user)

        response = self.client.patch(
            self._meta_url(),
            {
                "location": "Obca lokalizacja",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 403)

        self.tournament.refresh_from_db()

        self.assertNotEqual(self.tournament.location, "Obca lokalizacja")
