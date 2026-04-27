# backend/tournaments/tests/test_join_settings.py
# Plik zawiera testy API zabezpieczające ustawienia dołączania do turnieju przez kod.

from django.apps import apps
from django.test import TestCase

from rest_framework.test import APIClient

from tournaments.models import Division, Team, Tournament

from .helpers import create_test_user


class TournamentJoinSettingsApiTests(TestCase):
    """Testy API zabezpieczają ustawienia zapisów, kod dołączania i widoczność kodu."""

    def setUp(self):
        self.organizer = create_test_user("join-settings-owner@example.com")
        self.participant = create_test_user("join-settings-participant@example.com")
        self.assistant = create_test_user("join-settings-assistant@example.com")
        self.other_user = create_test_user("join-settings-other@example.com")

        self.client = APIClient()

        self.membership_model = apps.get_model("tournaments", "TournamentMembership")
        self.registration_model = apps.get_model("tournaments", "TournamentRegistration")

    def _create_tournament(self, *, name="Turniej ustawień zapisów"):
        tournament = Tournament.objects.create(
            name=name,
            discipline=Tournament.Discipline.FOOTBALL,
            organizer=self.organizer,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            entry_mode=Tournament.EntryMode.MANAGER,
        )

        division = Division.objects.create(
            tournament=tournament,
            name="Dywizja główna",
            is_default=True,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            status=Tournament.Status.CONFIGURED,
        )

        return tournament, division

    def _create_team_slots(self, tournament, division, *, prefix="Drużyna", count=2):
        return [
            Team.objects.create(
                tournament=tournament,
                division=division,
                name=f"{prefix} {index}",
                is_active=True,
            )
            for index in range(1, count + 1)
        ]

    def _enable_join_by_code(self, tournament, *, code="ABC123"):
        tournament.join_enabled = True
        tournament.registration_code = code
        tournament.save(update_fields=["join_enabled", "registration_code"])

    def _detail_url(self, tournament):
        return f"/api/tournaments/{tournament.id}/"

    def _verify_url(self, tournament, division):
        return f"/api/tournaments/{tournament.id}/registrations/verify/?division_id={division.id}"

    def _join_url(self, tournament, division):
        return f"/api/tournaments/{tournament.id}/registrations/join/?division_id={division.id}"

    def _me_url(self, tournament, division):
        return f"/api/tournaments/{tournament.id}/registrations/me/?division_id={division.id}"

    def _create_assistant_membership(self, tournament, *, permissions=None):
        return self.membership_model.objects.create(
            tournament=tournament,
            user=self.assistant,
            role=self.membership_model.Role.ASSISTANT,
            status=self.membership_model.Status.ACCEPTED,
            permissions=permissions or {},
            invited_by=self.organizer,
        )

    def test_join_settings_are_disabled_by_default(self):
        tournament, _division = self._create_tournament()

        self.assertFalse(tournament.join_enabled)
        self.assertIsNone(tournament.registration_code)
        self.assertTrue(tournament.participants_self_rename_enabled)
        self.assertFalse(tournament.participants_public_preview_enabled)

    def test_organizer_can_enable_join_by_code_through_tournament_detail(self):
        tournament, _division = self._create_tournament()

        self.client.force_authenticate(user=self.organizer)

        response = self.client.patch(
            self._detail_url(tournament),
            {
                "allow_join_by_code": True,
                "join_code": "  ABC123  ",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        tournament.refresh_from_db()

        self.assertTrue(tournament.join_enabled)
        self.assertEqual(tournament.registration_code, "ABC123")
        self.assertEqual(response.json().get("allow_join_by_code"), True)
        self.assertEqual(response.json().get("join_code"), "ABC123")

    def test_enable_join_by_code_requires_non_short_code(self):
        tournament, _division = self._create_tournament()

        self.client.force_authenticate(user=self.organizer)

        response = self.client.patch(
            self._detail_url(tournament),
            {
                "allow_join_by_code": True,
                "join_code": "AB",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)

        tournament.refresh_from_db()

        self.assertFalse(tournament.join_enabled)
        self.assertIsNone(tournament.registration_code)

    def test_organizer_can_disable_join_and_clear_registration_code(self):
        tournament, _division = self._create_tournament()
        self._enable_join_by_code(tournament, code="ABC123")

        self.client.force_authenticate(user=self.organizer)

        response = self.client.patch(
            self._detail_url(tournament),
            {
                "allow_join_by_code": False,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        tournament.refresh_from_db()

        self.assertFalse(tournament.join_enabled)
        self.assertIsNone(tournament.registration_code)

    def test_non_organizer_cannot_change_join_settings(self):
        tournament, _division = self._create_tournament()

        self.client.force_authenticate(user=self.other_user)

        response = self.client.patch(
            self._detail_url(tournament),
            {
                "allow_join_by_code": True,
                "join_code": "ABC123",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 403)

        tournament.refresh_from_db()

        self.assertFalse(tournament.join_enabled)
        self.assertIsNone(tournament.registration_code)

    def test_assistant_cannot_change_join_settings_even_with_join_permission_key(self):
        tournament, _division = self._create_tournament()
        self._create_assistant_membership(
            tournament,
            permissions={
                self.membership_model.PERM_JOIN_SETTINGS: True,
            },
        )

        self.client.force_authenticate(user=self.assistant)

        response = self.client.patch(
            self._detail_url(tournament),
            {
                "allow_join_by_code": True,
                "join_code": "ABC123",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 403)

        tournament.refresh_from_db()

        self.assertFalse(tournament.join_enabled)
        self.assertIsNone(tournament.registration_code)

    def test_tournament_detail_exposes_join_code_only_to_organizer(self):
        tournament, _division = self._create_tournament()
        self._enable_join_by_code(tournament, code="ABC123")
        tournament.is_published = True
        tournament.save(update_fields=["is_published"])

        self.client.force_authenticate(user=self.organizer)

        organizer_response = self.client.get(self._detail_url(tournament))

        self.assertEqual(organizer_response.status_code, 200)
        self.assertEqual(organizer_response.json().get("join_code"), "ABC123")
        self.assertTrue(organizer_response.json().get("allow_join_by_code"))

        self.client.force_authenticate(user=None)

        public_response = self.client.get(self._detail_url(tournament))

        self.assertEqual(public_response.status_code, 200)
        self.assertNotIn("join_code", public_response.json())
        self.assertTrue(public_response.json().get("allow_join_by_code"))

    def test_registration_verify_accepts_registration_code_alias(self):
        tournament, division = self._create_tournament()
        self._enable_join_by_code(tournament, code="ABC123")

        self.client.force_authenticate(user=self.participant)

        response = self.client.post(
            self._verify_url(tournament, division),
            {
                "registration_code": "ABC123",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("detail"), "OK")
        self.assertEqual(response.json().get("division_id"), division.id)

    def test_registration_verify_rejects_when_join_is_disabled(self):
        tournament, division = self._create_tournament()
        tournament.registration_code = "ABC123"
        tournament.save(update_fields=["registration_code"])

        self.client.force_authenticate(user=self.participant)

        response = self.client.post(
            self._verify_url(tournament, division),
            {
                "code": "ABC123",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)

    def test_registration_join_rejects_invalid_code_and_does_not_claim_slot(self):
        tournament, division = self._create_tournament()
        self._enable_join_by_code(tournament, code="ABC123")
        teams = self._create_team_slots(tournament, division)

        self.client.force_authenticate(user=self.participant)

        response = self.client.post(
            self._join_url(tournament, division),
            {
                "code": "WRONG",
                "display_name": "Dawid Kędzierski",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(
            self.registration_model.objects.filter(
                tournament=tournament,
                division=division,
                user=self.participant,
            ).exists()
        )

        teams[0].refresh_from_db()
        self.assertIsNone(teams[0].registered_user_id)

    def test_registration_join_claims_slot_only_in_selected_division(self):
        tournament, first_division = self._create_tournament()
        second_division = Division.objects.create(
            tournament=tournament,
            name="Druga dywizja",
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            status=Tournament.Status.CONFIGURED,
        )

        self._enable_join_by_code(tournament, code="ABC123")

        first_division_teams = self._create_team_slots(
            tournament,
            first_division,
            prefix="Pierwsza dywizja",
        )
        second_division_teams = self._create_team_slots(
            tournament,
            second_division,
            prefix="Druga dywizja",
        )

        self.client.force_authenticate(user=self.participant)

        response = self.client.post(
            self._join_url(tournament, second_division),
            {
                "code": "ABC123",
                "display_name": "Dawid Kędzierski",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("division_id"), second_division.id)

        registration = self.registration_model.objects.get(
            tournament=tournament,
            division=second_division,
            user=self.participant,
        )

        self.assertEqual(registration.team_id, second_division_teams[0].id)
        self.assertEqual(registration.display_name, "Dawid Kędzierski")

        first_division_teams[0].refresh_from_db()
        second_division_teams[0].refresh_from_db()

        self.assertIsNone(first_division_teams[0].registered_user_id)
        self.assertEqual(second_division_teams[0].registered_user_id, self.participant.id)

    def test_organizer_can_disable_participant_self_rename_setting(self):
        tournament, _division = self._create_tournament()

        self.client.force_authenticate(user=self.organizer)

        response = self.client.patch(
            self._detail_url(tournament),
            {
                "participants_self_rename_enabled": False,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        tournament.refresh_from_db()

        self.assertFalse(tournament.participants_self_rename_enabled)

    def test_disabled_self_rename_setting_blocks_registration_name_update(self):
        tournament, division = self._create_tournament()
        self._enable_join_by_code(tournament, code="ABC123")
        self._create_team_slots(tournament, division)

        self.client.force_authenticate(user=self.participant)

        join_response = self.client.post(
            self._join_url(tournament, division),
            {
                "code": "ABC123",
                "display_name": "Dawid Kędzierski",
            },
            format="json",
        )
        self.assertEqual(join_response.status_code, 200)

        tournament.participants_self_rename_enabled = False
        tournament.save(update_fields=["participants_self_rename_enabled"])

        response = self.client.patch(
            self._me_url(tournament, division),
            {
                "display_name": "Nowa nazwa uczestnika",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)

        registration = self.registration_model.objects.get(
            tournament=tournament,
            division=division,
            user=self.participant,
        )

        self.assertEqual(registration.display_name, "Dawid Kędzierski")
