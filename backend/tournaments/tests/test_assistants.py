# backend/tournaments/tests/test_assistants.py
# Plik zabezpiecza uprawnienia asystentów, zaproszenia oraz egzekwowanie ról na endpointach.

from .helpers import *


class TournamentAssistantAccessTests(TestCase):
    """Testy zabezpieczają centralną logikę uprawnień organizatora i asystentów."""

    def setUp(self):
        self.organizer = create_test_user("assistant-access-owner@example.com")
        self.assistant = create_test_user("assistant-access-user@example.com")
        self.pending_assistant = create_test_user("assistant-access-pending@example.com")
        self.other_user = create_test_user("assistant-access-other@example.com")

        self.tournament = Tournament.objects.create(
            name="Turniej uprawnień asystenta",
            discipline="football",
            organizer=self.organizer,
            entry_mode=Tournament.EntryMode.MANAGER,
        )

        self.membership_model = apps.get_model("tournaments", "TournamentMembership")

    def _create_membership(self, user, *, status=None, permissions=None):
        return self.membership_model.objects.create(
            tournament=self.tournament,
            user=user,
            role=self.membership_model.Role.ASSISTANT,
            status=status or self.membership_model.Status.ACCEPTED,
            permissions=permissions or {},
            invited_by=self.organizer,
        )

    def test_organizer_receives_all_permissions(self):
        from tournaments.access import get_my_permissions

        permissions = get_my_permissions(self.organizer, self.tournament)

        self.assertTrue(all(permissions.values()))
        self.assertTrue(permissions[self.membership_model.PERM_TEAMS_EDIT])
        self.assertTrue(permissions[self.membership_model.PERM_SCHEDULE_EDIT])
        self.assertTrue(permissions[self.membership_model.PERM_RESULTS_EDIT])
        self.assertTrue(permissions[self.membership_model.PERM_PUBLISH])
        self.assertTrue(permissions[self.membership_model.PERM_ARCHIVE])
        self.assertTrue(permissions[self.membership_model.PERM_MANAGE_ASSISTANTS])
        self.assertTrue(permissions[self.membership_model.PERM_JOIN_SETTINGS])

    def test_user_without_membership_receives_no_permissions(self):
        from tournaments.access import get_my_permissions

        permissions = get_my_permissions(self.other_user, self.tournament)

        self.assertTrue(permissions)
        self.assertFalse(any(permissions.values()))

    def test_accepted_assistant_receives_only_granted_regular_permissions(self):
        from tournaments.access import (
            can_edit_results,
            can_edit_schedule,
            can_edit_teams,
            get_my_permissions,
            user_is_assistant,
        )

        self._create_membership(
            self.assistant,
            permissions={
                self.membership_model.PERM_TEAMS_EDIT: True,
                self.membership_model.PERM_RESULTS_EDIT: True,
                self.membership_model.PERM_SCHEDULE_EDIT: False,
            },
        )

        permissions = get_my_permissions(self.assistant, self.tournament)

        self.assertTrue(user_is_assistant(self.assistant, self.tournament))
        self.assertTrue(permissions[self.membership_model.PERM_TEAMS_EDIT])
        self.assertTrue(permissions[self.membership_model.PERM_RESULTS_EDIT])
        self.assertFalse(permissions[self.membership_model.PERM_SCHEDULE_EDIT])

        self.assertTrue(can_edit_teams(self.assistant, self.tournament))
        self.assertTrue(can_edit_results(self.assistant, self.tournament))
        self.assertFalse(can_edit_schedule(self.assistant, self.tournament))

    def test_pending_assistant_is_not_treated_as_accepted_assistant(self):
        from tournaments.access import (
            can_edit_teams,
            get_my_permissions,
            user_has_pending_assistant_invite,
            user_is_assistant,
        )

        self._create_membership(
            self.pending_assistant,
            status=self.membership_model.Status.PENDING,
            permissions={
                self.membership_model.PERM_TEAMS_EDIT: True,
            },
        )

        permissions = get_my_permissions(self.pending_assistant, self.tournament)

        self.assertFalse(user_is_assistant(self.pending_assistant, self.tournament))
        self.assertTrue(user_has_pending_assistant_invite(self.pending_assistant, self.tournament))
        self.assertFalse(any(permissions.values()))
        self.assertFalse(can_edit_teams(self.pending_assistant, self.tournament))

    def test_assistant_never_receives_organizer_only_permissions_from_get_my_permissions(self):
        from tournaments.access import get_my_permissions

        self._create_membership(
            self.assistant,
            permissions={
                self.membership_model.PERM_TEAMS_EDIT: True,
                self.membership_model.PERM_PUBLISH: True,
                self.membership_model.PERM_ARCHIVE: True,
                self.membership_model.PERM_MANAGE_ASSISTANTS: True,
                self.membership_model.PERM_JOIN_SETTINGS: True,
            },
        )

        permissions = get_my_permissions(self.assistant, self.tournament)

        self.assertTrue(permissions[self.membership_model.PERM_TEAMS_EDIT])
        self.assertFalse(permissions[self.membership_model.PERM_PUBLISH])
        self.assertFalse(permissions[self.membership_model.PERM_ARCHIVE])
        self.assertFalse(permissions[self.membership_model.PERM_MANAGE_ASSISTANTS])
        self.assertFalse(permissions[self.membership_model.PERM_JOIN_SETTINGS])

    def test_assistant_management_permissions_are_organizer_only_helpers(self):
        from tournaments.access import can_manage_assistants, can_manage_join_settings

        self._create_membership(
            self.assistant,
            permissions={
                self.membership_model.PERM_MANAGE_ASSISTANTS: True,
                self.membership_model.PERM_JOIN_SETTINGS: True,
            },
        )

        self.assertTrue(can_manage_assistants(self.organizer, self.tournament))
        self.assertTrue(can_manage_join_settings(self.organizer, self.tournament))
        self.assertFalse(can_manage_assistants(self.assistant, self.tournament))
        self.assertFalse(can_manage_join_settings(self.assistant, self.tournament))

    def test_organizer_only_entry_mode_blocks_assistant_actions(self):
        from tournaments.access import (
            can_edit_results,
            can_edit_schedule,
            can_edit_teams,
            get_my_permissions,
            user_can_manage_tournament,
            user_is_assistant,
        )

        self.tournament.entry_mode = Tournament.EntryMode.ORGANIZER_ONLY
        self.tournament.save(update_fields=["entry_mode"])

        self._create_membership(
            self.assistant,
            permissions={
                self.membership_model.PERM_TEAMS_EDIT: True,
                self.membership_model.PERM_SCHEDULE_EDIT: True,
                self.membership_model.PERM_RESULTS_EDIT: True,
            },
        )

        permissions = get_my_permissions(self.assistant, self.tournament)

        self.assertTrue(user_is_assistant(self.assistant, self.tournament))
        self.assertFalse(any(permissions.values()))
        self.assertFalse(user_can_manage_tournament(self.assistant, self.tournament))
        self.assertFalse(can_edit_teams(self.assistant, self.tournament))
        self.assertFalse(can_edit_schedule(self.assistant, self.tournament))
        self.assertFalse(can_edit_results(self.assistant, self.tournament))

    def test_user_can_manage_tournament_accepts_both_argument_orders(self):
        from tournaments.access import user_can_manage_tournament

        self._create_membership(self.assistant)

        self.assertTrue(user_can_manage_tournament(self.organizer, self.tournament))
        self.assertTrue(user_can_manage_tournament(self.tournament, self.organizer))
        self.assertTrue(user_can_manage_tournament(self.assistant, self.tournament))
        self.assertTrue(user_can_manage_tournament(self.tournament, self.assistant))
        self.assertFalse(user_can_manage_tournament(self.other_user, self.tournament))

    def test_strict_permissions_require_explicit_raw_value(self):
        from tournaments.access import can_approve_name_changes, can_edit_roster, get_my_permissions

        self._create_membership(
            self.assistant,
            permissions={
                self.membership_model.PERM_TEAMS_EDIT: True,
            },
        )

        permissions = get_my_permissions(self.assistant, self.tournament)

        self.assertFalse(permissions[self.membership_model.PERM_ROSTER_EDIT])
        self.assertFalse(permissions[self.membership_model.PERM_NAME_CHANGE_APPROVE])
        self.assertFalse(can_edit_roster(self.assistant, self.tournament))
        self.assertFalse(can_approve_name_changes(self.assistant, self.tournament))

    def test_strict_permissions_are_enabled_when_explicitly_granted(self):
        from tournaments.access import can_approve_name_changes, can_edit_roster, get_my_permissions

        self._create_membership(
            self.assistant,
            permissions={
                self.membership_model.PERM_ROSTER_EDIT: True,
                self.membership_model.PERM_NAME_CHANGE_APPROVE: True,
            },
        )

        permissions = get_my_permissions(self.assistant, self.tournament)

        self.assertTrue(permissions[self.membership_model.PERM_ROSTER_EDIT])
        self.assertTrue(permissions[self.membership_model.PERM_NAME_CHANGE_APPROVE])
        self.assertTrue(can_edit_roster(self.assistant, self.tournament))
        self.assertTrue(can_approve_name_changes(self.assistant, self.tournament))

    def test_can_view_assistant_permissions_allows_organizer_and_own_assistant_only(self):
        from tournaments.access import can_view_assistant_permissions

        self._create_membership(self.assistant)

        self.assertTrue(can_view_assistant_permissions(self.organizer, self.tournament, self.assistant.id))
        self.assertTrue(can_view_assistant_permissions(self.assistant, self.tournament, self.assistant.id))
        self.assertFalse(can_view_assistant_permissions(self.assistant, self.tournament, self.other_user.id))
        self.assertFalse(can_view_assistant_permissions(self.other_user, self.tournament, self.assistant.id))

    def test_only_organizer_can_update_assistant_permissions(self):
        from tournaments.access import can_update_assistant_permissions

        self._create_membership(self.assistant)

        self.assertTrue(can_update_assistant_permissions(self.organizer, self.tournament))
        self.assertFalse(can_update_assistant_permissions(self.assistant, self.tournament))
        self.assertFalse(can_update_assistant_permissions(self.other_user, self.tournament))


class TournamentAssistantInviteApiTests(TestCase):
    """Testy API zabezpieczają przepływ zaproszeń asystenta do turnieju."""

    def setUp(self):
        self.organizer = create_test_user("assistant-api-owner@example.com")
        self.assistant = create_test_user("assistant-api-user@example.com")
        self.other_user = create_test_user("assistant-api-other@example.com")
        self.client = APIClient()

        self.tournament = Tournament.objects.create(
            name="Turniej API asystentów",
            discipline="football",
            organizer=self.organizer,
            entry_mode=Tournament.EntryMode.MANAGER,
        )

        self.membership_model = apps.get_model("tournaments", "TournamentMembership")
        self.invite_model = apps.get_model("tournaments", "TournamentAssistantInvite")

    def _permissions_payload(self):
        return {
            self.membership_model.PERM_TEAMS_EDIT: True,
            self.membership_model.PERM_SCHEDULE_EDIT: False,
            self.membership_model.PERM_RESULTS_EDIT: True,
            self.membership_model.PERM_ROSTER_EDIT: True,
            self.membership_model.PERM_NAME_CHANGE_APPROVE: False,
            self.membership_model.PERM_PUBLISH: True,
            self.membership_model.PERM_ARCHIVE: True,
            self.membership_model.PERM_MANAGE_ASSISTANTS: True,
            self.membership_model.PERM_JOIN_SETTINGS: True,
        }

    def _pending_invite(self, email=None, permissions=None):
        return self.invite_model.objects.create(
            tournament=self.tournament,
            invited_email=email or self.assistant.email,
            invited_by=self.organizer,
            permissions=permissions or self._permissions_payload(),
        )

    def _pending_membership(self, user=None, permissions=None):
        return self.membership_model.objects.create(
            tournament=self.tournament,
            user=user or self.assistant,
            role=self.membership_model.Role.ASSISTANT,
            status=self.membership_model.Status.PENDING,
            permissions=permissions or self._permissions_payload(),
            invited_by=self.organizer,
        )

    def _invite_for_assistant(self):
        return self.invite_model.objects.filter(
            tournament=self.tournament,
            normalized_email=self.assistant.email.lower(),
        ).order_by("-id").first()

    def _membership_for_assistant(self):
        return self.membership_model.objects.filter(
            tournament=self.tournament,
            user=self.assistant,
        ).order_by("-id").first()

    def test_organizer_can_create_pending_assistant_invite(self):
        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            f"/api/tournaments/{self.tournament.id}/assistants/add/",
            {
                "email": self.assistant.email,
                "permissions": self._permissions_payload(),
            },
            format="json",
        )

        self.assertIn(response.status_code, {200, 201, 202})

        invite = self._invite_for_assistant()

        self.assertIsNotNone(invite)
        self.assertEqual(invite.status, self.invite_model.Status.PENDING)
        self.assertEqual(invite.invited_by_id, self.organizer.id)
        self.assertEqual(invite.normalized_email, self.assistant.email.lower())
        self.assertTrue(invite.normalized_permissions()[self.membership_model.PERM_TEAMS_EDIT])
        self.assertTrue(invite.normalized_permissions()[self.membership_model.PERM_RESULTS_EDIT])
        self.assertFalse(invite.normalized_permissions()[self.membership_model.PERM_SCHEDULE_EDIT])

    def test_add_assistant_normalizes_email_and_reuses_existing_invite(self):
        self.client.force_authenticate(user=self.organizer)

        first_response = self.client.post(
            f"/api/tournaments/{self.tournament.id}/assistants/add/",
            {
                "email": f"  {self.assistant.email.upper()}  ",
                "permissions": {
                    self.membership_model.PERM_TEAMS_EDIT: True,
                },
            },
            format="json",
        )
        self.assertIn(first_response.status_code, {200, 201, 202})

        second_response = self.client.post(
            f"/api/tournaments/{self.tournament.id}/assistants/add/",
            {
                "email": self.assistant.email.lower(),
                "permissions": {
                    self.membership_model.PERM_RESULTS_EDIT: True,
                },
            },
            format="json",
        )
        self.assertIn(second_response.status_code, {200, 201, 202})

        invites = self.invite_model.objects.filter(
            tournament=self.tournament,
            normalized_email=self.assistant.email.lower(),
        )

        self.assertEqual(invites.count(), 1)

        invite = invites.get()

        self.assertEqual(invite.status, self.invite_model.Status.PENDING)
        self.assertTrue(invite.normalized_permissions()[self.membership_model.PERM_RESULTS_EDIT])

    def test_other_user_cannot_create_assistant_invite(self):
        self.client.force_authenticate(user=self.other_user)

        response = self.client.post(
            f"/api/tournaments/{self.tournament.id}/assistants/add/",
            {
                "email": self.assistant.email,
                "permissions": self._permissions_payload(),
            },
            format="json",
        )

        self.assertIn(response.status_code, {403, 404})
        self.assertFalse(
            self.invite_model.objects.filter(
                tournament=self.tournament,
                normalized_email=self.assistant.email.lower(),
            ).exists()
        )

    def test_assistant_can_accept_pending_invite(self):
        self._pending_invite()
        self.client.force_authenticate(user=self.assistant)

        response = self.client.post(
            f"/api/tournaments/{self.tournament.id}/assistant-invite/accept/"
        )

        self.assertEqual(response.status_code, 200)

        invite = self._invite_for_assistant()
        membership = self._membership_for_assistant()

        self.assertIsNotNone(invite)
        self.assertIsNotNone(membership)
        self.assertEqual(invite.status, self.invite_model.Status.ACCEPTED)
        self.assertIsNotNone(invite.responded_at)
        self.assertEqual(membership.status, self.membership_model.Status.ACCEPTED)
        self.assertEqual(membership.invited_by_id, self.organizer.id)
        self.assertTrue(membership.permissions.get(self.membership_model.PERM_TEAMS_EDIT))
        self.assertTrue(membership.permissions.get(self.membership_model.PERM_RESULTS_EDIT))

    def test_assistant_can_decline_pending_invite(self):
        self._pending_invite()
        self.client.force_authenticate(user=self.assistant)

        response = self.client.post(
            f"/api/tournaments/{self.tournament.id}/assistant-invite/decline/"
        )

        self.assertEqual(response.status_code, 200)

        invite = self._invite_for_assistant()
        membership = self._membership_for_assistant()

        self.assertIsNotNone(invite)
        self.assertEqual(invite.status, self.invite_model.Status.DECLINED)
        self.assertIsNotNone(invite.responded_at)

        if membership is not None:
            self.assertNotEqual(membership.status, self.membership_model.Status.ACCEPTED)

    def test_user_without_matching_invite_cannot_accept(self):
        self._pending_invite(email="someone-else@example.com")
        self.client.force_authenticate(user=self.assistant)

        response = self.client.post(
            f"/api/tournaments/{self.tournament.id}/assistant-invite/accept/"
        )

        self.assertIn(response.status_code, {400, 403, 404})
        self.assertIsNone(self._membership_for_assistant())

    def test_organizer_can_cancel_pending_assistant_invite(self):
        invite = self._pending_invite()
        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            f"/api/tournaments/{self.tournament.id}/assistant-invites/{invite.id}/cancel/"
        )

        self.assertEqual(response.status_code, 200)

        invite.refresh_from_db()

        self.assertEqual(invite.status, self.invite_model.Status.CANCELED)
        self.assertIsNotNone(invite.responded_at)

    def test_other_user_cannot_cancel_assistant_invite(self):
        invite = self._pending_invite()
        self.client.force_authenticate(user=self.other_user)

        response = self.client.post(
            f"/api/tournaments/{self.tournament.id}/assistant-invites/{invite.id}/cancel/"
        )

        self.assertIn(response.status_code, {403, 404})

        invite.refresh_from_db()

        self.assertEqual(invite.status, self.invite_model.Status.PENDING)

    def test_organizer_can_remove_accepted_assistant(self):
        self._pending_membership(
            permissions={
                self.membership_model.PERM_TEAMS_EDIT: True,
            }
        )
        membership = self._membership_for_assistant()
        membership.mark_accepted()
        membership.save(update_fields=["status", "responded_at"])

        self.client.force_authenticate(user=self.organizer)

        response = self.client.delete(
            f"/api/tournaments/{self.tournament.id}/assistants/{self.assistant.id}/remove/"
        )

        self.assertIn(response.status_code, {200, 204})
        self.assertFalse(
            self.membership_model.objects.filter(
                tournament=self.tournament,
                user=self.assistant,
                status=self.membership_model.Status.ACCEPTED,
            ).exists()
        )

    def test_assistant_cannot_remove_other_assistant(self):
        second_assistant = create_test_user("assistant-api-second@example.com")

        self._pending_membership(user=self.assistant)
        first_membership = self._membership_for_assistant()
        first_membership.mark_accepted()
        first_membership.save(update_fields=["status", "responded_at"])

        self.membership_model.objects.create(
            tournament=self.tournament,
            user=second_assistant,
            role=self.membership_model.Role.ASSISTANT,
            status=self.membership_model.Status.ACCEPTED,
            invited_by=self.organizer,
            permissions={self.membership_model.PERM_TEAMS_EDIT: True},
        )

        self.client.force_authenticate(user=self.assistant)

        response = self.client.delete(
            f"/api/tournaments/{self.tournament.id}/assistants/{second_assistant.id}/remove/"
        )

        self.assertIn(response.status_code, {403, 404})
        self.assertTrue(
            self.membership_model.objects.filter(
                tournament=self.tournament,
                user=second_assistant,
                status=self.membership_model.Status.ACCEPTED,
            ).exists()
        )

    def test_organizer_can_list_assistants_and_pending_invites(self):
        self._pending_invite(email="pending-assistant@example.com")
        self._pending_membership()
        membership = self._membership_for_assistant()
        membership.mark_accepted()
        membership.save(update_fields=["status", "responded_at"])

        self.client.force_authenticate(user=self.organizer)

        response = self.client.get(f"/api/tournaments/{self.tournament.id}/assistants/")

        self.assertEqual(response.status_code, 200)

        data = response.json()
        serialized = str(data)

        self.assertIn(self.assistant.email, serialized)
        self.assertIn("pending-assistant@example.com", serialized)

    def test_other_user_cannot_list_assistants(self):
        self.client.force_authenticate(user=self.other_user)

        response = self.client.get(f"/api/tournaments/{self.tournament.id}/assistants/")

        self.assertIn(response.status_code, {403, 404})


class TournamentAssistantEndpointPermissionTests(TestCase):
    """Testy API zabezpieczają praktyczne egzekwowanie uprawnień asystenta na endpointach turnieju."""

    def setUp(self):
        self.organizer = create_test_user("assistant-endpoint-owner@example.com")
        self.assistant = create_test_user("assistant-endpoint-user@example.com")
        self.other_assistant = create_test_user("assistant-endpoint-other@example.com")
        self.client = APIClient()

        self.membership_model = apps.get_model("tournaments", "TournamentMembership")
        self.stage_model = apps.get_model("tournaments", "Stage")
        self.match_model = apps.get_model("tournaments", "Match")

        self.tournament = Tournament.objects.create(
            name="Turniej uprawnień endpointów",
            discipline=Tournament.Discipline.FOOTBALL,
            organizer=self.organizer,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            entry_mode=Tournament.EntryMode.MANAGER,
        )

        self.division = Division.objects.create(
            tournament=self.tournament,
            name="Dywizja endpointów",
            is_default=True,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            status=Tournament.Status.CONFIGURED,
        )

        self.teams = [
            Team.objects.create(
                tournament=self.tournament,
                division=self.division,
                name=f"Drużyna endpoint {index}",
                is_active=True,
            )
            for index in range(1, 3)
        ]

        self.stage = self.stage_model.objects.create(
            tournament=self.tournament,
            division=self.division,
            stage_type=self.stage_model.StageType.LEAGUE,
            order=1,
        )

        self.match = self.match_model.objects.create(
            tournament=self.tournament,
            stage=self.stage,
            home_team=self.teams[0],
            away_team=self.teams[1],
            round_number=1,
            status=self.match_model.Status.SCHEDULED,
        )

    def _grant_assistant_permissions(self, user, permissions):
        return self.membership_model.objects.create(
            tournament=self.tournament,
            user=user,
            role=self.membership_model.Role.ASSISTANT,
            status=self.membership_model.Status.ACCEPTED,
            permissions=permissions,
            invited_by=self.organizer,
        )

    def test_assistant_with_teams_edit_can_update_team_name(self):
        self._grant_assistant_permissions(
            self.assistant,
            {self.membership_model.PERM_TEAMS_EDIT: True},
        )
        self.client.force_authenticate(user=self.assistant)

        response = self.client.patch(
            f"/api/tournaments/{self.tournament.id}/teams/{self.teams[0].id}/?division_id={self.division.id}",
            {"name": "Nazwa zmieniona przez asystenta"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        self.teams[0].refresh_from_db()
        self.assertEqual(self.teams[0].name, "Nazwa zmieniona przez asystenta")

    def test_assistant_without_teams_edit_cannot_update_team_name(self):
        self._grant_assistant_permissions(
            self.assistant,
            {self.membership_model.PERM_RESULTS_EDIT: True},
        )
        self.client.force_authenticate(user=self.assistant)

        response = self.client.patch(
            f"/api/tournaments/{self.tournament.id}/teams/{self.teams[0].id}/?division_id={self.division.id}",
            {"name": "Niedozwolona zmiana przez asystenta"},
            format="json",
        )

        self.assertIn(response.status_code, {403, 404})

        self.teams[0].refresh_from_db()
        self.assertNotEqual(self.teams[0].name, "Niedozwolona zmiana przez asystenta")

    def test_assistant_with_schedule_edit_can_update_match_schedule(self):
        self._grant_assistant_permissions(
            self.assistant,
            {self.membership_model.PERM_SCHEDULE_EDIT: True},
        )
        self.client.force_authenticate(user=self.assistant)

        response = self.client.patch(
            f"/api/matches/{self.match.id}/",
            {
                "scheduled_date": "2026-07-01",
                "scheduled_time": "19:15:00",
                "location": "Boisko asystenta",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        self.match.refresh_from_db()
        self.assertEqual(str(self.match.scheduled_date), "2026-07-01")
        self.assertEqual(str(self.match.scheduled_time), "19:15:00")
        self.assertEqual(self.match.location, "Boisko asystenta")

    def test_assistant_without_schedule_edit_cannot_update_match_schedule(self):
        self._grant_assistant_permissions(
            self.assistant,
            {self.membership_model.PERM_TEAMS_EDIT: True},
        )
        self.client.force_authenticate(user=self.assistant)

        response = self.client.patch(
            f"/api/matches/{self.match.id}/",
            {
                "scheduled_date": "2026-07-01",
                "scheduled_time": "19:15:00",
                "location": "Niedozwolone boisko asystenta",
            },
            format="json",
        )

        self.assertIn(response.status_code, {403, 404})

        self.match.refresh_from_db()
        self.assertIsNone(self.match.scheduled_date)
        self.assertIsNone(self.match.scheduled_time)
        self.assertNotEqual(self.match.location, "Niedozwolone boisko asystenta")

    def test_assistant_with_results_edit_can_save_match_result(self):
        self._grant_assistant_permissions(
            self.assistant,
            {self.membership_model.PERM_RESULTS_EDIT: True},
        )
        self.client.force_authenticate(user=self.assistant)

        response = self.client.patch(
            f"/api/matches/{self.match.id}/result/",
            {
                "home_score": 4,
                "away_score": 2,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        self.match.refresh_from_db()
        self.assertEqual(self.match.home_score, 4)
        self.assertEqual(self.match.away_score, 2)
        self.assertTrue(self.match.result_entered)
        self.assertEqual(self.match.status, self.match_model.Status.IN_PROGRESS)

    def test_assistant_without_results_edit_cannot_save_match_result(self):
        self._grant_assistant_permissions(
            self.assistant,
            {self.membership_model.PERM_SCHEDULE_EDIT: True},
        )
        self.client.force_authenticate(user=self.assistant)

        response = self.client.patch(
            f"/api/matches/{self.match.id}/result/",
            {
                "home_score": 4,
                "away_score": 2,
            },
            format="json",
        )

        self.assertIn(response.status_code, {403, 404})

        self.match.refresh_from_db()
        self.assertFalse(self.match.result_entered)
        self.assertNotEqual(self.match.home_score, 4)
        self.assertNotEqual(self.match.away_score, 2)

    def test_organizer_only_entry_mode_blocks_assistant_endpoint_permissions(self):
        self.tournament.entry_mode = Tournament.EntryMode.ORGANIZER_ONLY
        self.tournament.save(update_fields=["entry_mode"])

        self._grant_assistant_permissions(
            self.assistant,
            {
                self.membership_model.PERM_TEAMS_EDIT: True,
                self.membership_model.PERM_SCHEDULE_EDIT: True,
                self.membership_model.PERM_RESULTS_EDIT: True,
            },
        )
        self.client.force_authenticate(user=self.assistant)

        response = self.client.patch(
            f"/api/matches/{self.match.id}/result/",
            {
                "home_score": 1,
                "away_score": 0,
            },
            format="json",
        )

        self.assertIn(response.status_code, {403, 404})

        self.match.refresh_from_db()
        self.assertFalse(self.match.result_entered)
        self.assertNotEqual(self.match.home_score, 1)
        self.assertFalse(self.match.result_entered)

    def test_pending_assistant_cannot_use_endpoint_permissions(self):
        self.membership_model.objects.create(
            tournament=self.tournament,
            user=self.assistant,
            role=self.membership_model.Role.ASSISTANT,
            status=self.membership_model.Status.PENDING,
            permissions={self.membership_model.PERM_RESULTS_EDIT: True},
            invited_by=self.organizer,
        )
        self.client.force_authenticate(user=self.assistant)

        response = self.client.patch(
            f"/api/matches/{self.match.id}/result/",
            {
                "home_score": 2,
                "away_score": 0,
            },
            format="json",
        )

        self.assertIn(response.status_code, {403, 404})

        self.match.refresh_from_db()
        self.assertFalse(self.match.result_entered)
