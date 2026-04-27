# backend/tournaments/tests/test_archive_management_guards.py
# Plik testuje blokowanie zarządzania asystentami i ustawieniami dołączania po archiwizacji turnieju.

from django.test import TestCase
from rest_framework.test import APIClient

from tournaments.models import Division, Tournament, TournamentAssistantInvite, TournamentMembership

from .helpers import create_test_user


class TournamentArchivedManagementGuardTests(TestCase):
    """Testy zabezpieczają operacje administracyjne przed zapisem w zarchiwizowanym turnieju."""

    def setUp(self):
        self.organizer = create_test_user("archive-management-owner@example.com")
        self.assistant = create_test_user("archive-management-assistant@example.com")
        self.client = APIClient()

        self.tournament = Tournament.objects.create(
            name="Turniej archiwalny - zarządzanie",
            discipline=Tournament.Discipline.FOOTBALL,
            organizer=self.organizer,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            entry_mode=Tournament.EntryMode.MANAGER,
            join_enabled=True,
            registration_code="ARCHIVE123",
            status=Tournament.Status.CONFIGURED,
            is_archived=True,
        )

        self.division = Division.objects.create(
            tournament=self.tournament,
            name="Dywizja główna",
            is_default=True,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            status=Tournament.Status.CONFIGURED,
        )

        self.membership = TournamentMembership.objects.create(
            tournament=self.tournament,
            user=self.assistant,
            role=TournamentMembership.Role.ASSISTANT,
            status=TournamentMembership.Status.ACCEPTED,
            permissions={
                TournamentMembership.PERM_RESULTS_EDIT: True,
            },
        )

        self.client.force_authenticate(user=self.organizer)

    def _assert_rejected(self, response):
        self.assertIn(response.status_code, {400, 403, 409})

    def test_archived_tournament_rejects_assistant_invite_create(self):
        response = self.client.post(
            f"/api/tournaments/{self.tournament.id}/assistants/add/",
            {
                "email": "new-assistant@example.com",
                "permissions": {
                    TournamentMembership.PERM_RESULTS_EDIT: True,
                },
            },
            format="json",
        )

        self._assert_rejected(response)
        self.assertFalse(
            TournamentAssistantInvite.objects.filter(
                tournament=self.tournament,
                normalized_email="new-assistant@example.com",
            ).exists()
        )

    def test_archived_tournament_rejects_assistant_permission_update(self):
        response = self.client.patch(
            f"/api/tournaments/{self.tournament.id}/assistants/{self.assistant.id}/permissions/",
            {
                "permissions": {
                    TournamentMembership.PERM_RESULTS_EDIT: False,
                    TournamentMembership.PERM_TEAMS_EDIT: True,
                }
            },
            format="json",
        )

        self._assert_rejected(response)

        self.membership.refresh_from_db()
        self.assertTrue(self.membership.permissions.get(TournamentMembership.PERM_RESULTS_EDIT))
        self.assertFalse(self.membership.permissions.get(TournamentMembership.PERM_TEAMS_EDIT, False))

    def test_archived_tournament_rejects_assistant_remove(self):
        response = self.client.delete(
            f"/api/tournaments/{self.tournament.id}/assistants/{self.assistant.id}/remove/",
            format="json",
        )

        self._assert_rejected(response)

        self.membership.refresh_from_db()
        self.assertEqual(self.membership.status, TournamentMembership.Status.ACCEPTED)

    def test_archived_tournament_rejects_join_settings_update(self):
        response = self.client.patch(
            f"/api/tournaments/{self.tournament.id}/",
            {
                "allow_join_by_code": False,
                "join_code": "",
            },
            format="json",
        )

        self._assert_rejected(response)

        self.tournament.refresh_from_db()
        self.assertTrue(self.tournament.join_enabled)
        self.assertEqual(self.tournament.registration_code, "ARCHIVE123")
