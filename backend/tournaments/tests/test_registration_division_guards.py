# backend/tournaments/tests/test_registration_division_guards.py
# Plik testuje izolację rejestracji uczestników i wolnych slotów między dywizjami turnieju.

from django.apps import apps
from django.test import TestCase
from rest_framework.test import APIClient

from tournaments.models import Division, Team, Tournament

from .helpers import create_test_user


class TournamentRegistrationDivisionGuardTests(TestCase):
    """Testy zabezpieczają rejestrację uczestnika w kontekście wybranej dywizji."""

    def setUp(self):
        self.organizer = create_test_user("registration-division-owner@example.com")
        self.participant = create_test_user("registration-division-user@example.com")
        self.second_participant = create_test_user("registration-division-second@example.com")
        self.third_participant = create_test_user("registration-division-third@example.com")
        self.fourth_participant = create_test_user("registration-division-fourth@example.com")
        self.client = APIClient()

        self.registration_model = apps.get_model("tournaments", "TournamentRegistration")

        self.tournament = Tournament.objects.create(
            name="Turniej rejestracji dywizji",
            discipline=Tournament.Discipline.FOOTBALL,
            organizer=self.organizer,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            status=Tournament.Status.CONFIGURED,
            join_enabled=True,
            registration_code="JOIN123",
            participants_self_rename_enabled=True,
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

        self.default_teams = self._create_slots(self.default_division, "Główna", 2)
        self.second_teams = self._create_slots(self.second_division, "Druga", 2)

    def _create_slots(self, division, prefix, count):
        return [
            Team.objects.create(
                tournament=self.tournament,
                division=division,
                name=f"{prefix} {index}",
                is_active=True,
            )
            for index in range(1, count + 1)
        ]

    def _verify_url(self, division):
        return f"/api/tournaments/{self.tournament.id}/registrations/verify/?division_id={division.id}"

    def _join_url(self, division):
        return f"/api/tournaments/{self.tournament.id}/registrations/join/?division_id={division.id}"

    def _me_url(self, division):
        return f"/api/tournaments/{self.tournament.id}/registrations/me/?division_id={division.id}"

    def _join(self, user, division, display_name):
        self.client.force_authenticate(user=user)
        return self.client.post(
            self._join_url(division),
            {
                "code": "JOIN123",
                "display_name": display_name,
            },
            format="json",
        )

    def test_verify_returns_selected_division_id(self):
        self.client.force_authenticate(user=self.participant)

        response = self.client.post(
            self._verify_url(self.second_division),
            {"code": "JOIN123"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("division_id"), self.second_division.id)

    def test_verify_returns_all_non_archived_divisions_for_join_selector(self):
        draft_division = Division.objects.create(
            tournament=self.tournament,
            name="Dywizja robocza",
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            status=Tournament.Status.DRAFT,
        )
        archived_division = Division.objects.create(
            tournament=self.tournament,
            name="Dywizja archiwalna",
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            status=Tournament.Status.CONFIGURED,
            is_archived=True,
        )

        self.client.force_authenticate(user=self.participant)

        response = self.client.post(
            self._verify_url(self.default_division),
            {"code": "JOIN123"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        division_ids = {item.get("id") for item in response.json().get("divisions", [])}
        self.assertSetEqual(
            division_ids,
            {self.default_division.id, self.second_division.id, draft_division.id},
        )
        self.assertNotIn(archived_division.id, division_ids)

    def test_join_claims_slot_only_in_selected_division(self):
        response = self._join(
            self.participant,
            self.second_division,
            "Dawid Kędzierski",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("division_id"), self.second_division.id)

        registration = self.registration_model.objects.get(
            tournament=self.tournament,
            division=self.second_division,
            user=self.participant,
        )
        team = Team.objects.get(id=response.json().get("team_id"))

        self.assertEqual(registration.team_id, team.id)
        self.assertEqual(team.division_id, self.second_division.id)
        self.assertEqual(team.registered_user_id, self.participant.id)
        self.assertEqual(team.name, "Dawid Kędzierski")

        self.assertFalse(
            Team.objects.filter(
                tournament=self.tournament,
                division=self.default_division,
                registered_user=self.participant,
            ).exists()
        )

    def test_full_default_division_does_not_block_joining_second_division(self):
        first_response = self._join(self.participant, self.default_division, "Pierwszy")
        second_response = self._join(self.second_participant, self.default_division, "Drugi")

        self.assertEqual(first_response.status_code, 200)
        self.assertEqual(second_response.status_code, 200)

        blocked_response = self._join(self.third_participant, self.default_division, "Trzeci")

        self.assertEqual(blocked_response.status_code, 400)

        second_division_response = self._join(self.third_participant, self.second_division, "Trzeci druga")

        self.assertEqual(second_division_response.status_code, 200)

        team = Team.objects.get(id=second_division_response.json().get("team_id"))
        self.assertEqual(team.division_id, self.second_division.id)

    def test_registration_me_is_scoped_to_selected_division(self):
        join_response = self._join(self.participant, self.default_division, "Uczestnik główny")
        self.assertEqual(join_response.status_code, 200)

        self.client.force_authenticate(user=self.participant)

        default_response = self.client.get(self._me_url(self.default_division))
        second_response = self.client.get(self._me_url(self.second_division))

        self.assertEqual(default_response.status_code, 200)
        self.assertEqual(default_response.json().get("division_id"), self.default_division.id)
        self.assertEqual(default_response.json().get("display_name"), "Uczestnik główny")
        self.assertEqual(second_response.status_code, 404)

    def test_same_user_can_register_in_two_different_divisions(self):
        default_response = self._join(self.participant, self.default_division, "Dawid główna")
        second_response = self._join(self.participant, self.second_division, "Dawid druga")

        self.assertEqual(default_response.status_code, 200)
        self.assertEqual(second_response.status_code, 200)

        registrations = self.registration_model.objects.filter(
            tournament=self.tournament,
            user=self.participant,
        ).order_by("division_id")

        self.assertEqual(registrations.count(), 2)
        self.assertSetEqual(
            set(registrations.values_list("division_id", flat=True)),
            {self.default_division.id, self.second_division.id},
        )

    def test_updating_registration_in_one_division_does_not_touch_second_division(self):
        default_response = self._join(self.participant, self.default_division, "Dawid główna")
        second_response = self._join(self.participant, self.second_division, "Dawid druga")

        self.assertEqual(default_response.status_code, 200)
        self.assertEqual(second_response.status_code, 200)

        updated_default_response = self._join(self.participant, self.default_division, "Dawid główna nowa")

        self.assertEqual(updated_default_response.status_code, 200)
        self.assertEqual(updated_default_response.json().get("team_id"), default_response.json().get("team_id"))

        default_registration = self.registration_model.objects.get(
            tournament=self.tournament,
            division=self.default_division,
            user=self.participant,
        )
        second_registration = self.registration_model.objects.get(
            tournament=self.tournament,
            division=self.second_division,
            user=self.participant,
        )

        default_team = Team.objects.get(id=default_registration.team_id)
        second_team = Team.objects.get(id=second_registration.team_id)

        self.assertEqual(default_registration.display_name, "Dawid główna nowa")
        self.assertEqual(default_team.name, "Dawid główna nowa")

        self.assertEqual(second_registration.display_name, "Dawid druga")
        self.assertEqual(second_team.name, "Dawid druga")

    def test_join_disabled_rejects_verify_and_join_without_creating_registration(self):
        self.tournament.join_enabled = False
        self.tournament.save(update_fields=["join_enabled"])

        self.client.force_authenticate(user=self.participant)

        verify_response = self.client.post(
            self._verify_url(self.default_division),
            {"code": "JOIN123"},
            format="json",
        )
        join_response = self.client.post(
            self._join_url(self.default_division),
            {
                "code": "JOIN123",
                "display_name": "Zablokowany uczestnik",
            },
            format="json",
        )

        self.assertEqual(verify_response.status_code, 400)
        self.assertEqual(join_response.status_code, 400)
        self.assertFalse(
            self.registration_model.objects.filter(
                tournament=self.tournament,
                user=self.participant,
            ).exists()
        )

    def test_wrong_code_does_not_claim_any_slot(self):
        self.client.force_authenticate(user=self.participant)

        response = self.client.post(
            self._join_url(self.default_division),
            {
                "code": "WRONG",
                "display_name": "Błędny kod",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(
            self.registration_model.objects.filter(
                tournament=self.tournament,
                user=self.participant,
            ).exists()
        )
        self.assertFalse(
            Team.objects.filter(
                tournament=self.tournament,
                registered_user=self.participant,
            ).exists()
        )

    def test_archived_tournament_rejects_join_without_claiming_slot(self):
        self.tournament.is_archived = True
        self.tournament.status = Tournament.Status.FINISHED
        self.tournament.save(update_fields=["is_archived", "status"])

        response = self._join(self.participant, self.default_division, "Archiwalny uczestnik")

        self.assertEqual(response.status_code, 400)
        self.assertFalse(
            self.registration_model.objects.filter(
                tournament=self.tournament,
                user=self.participant,
            ).exists()
        )
        self.assertFalse(
            Team.objects.filter(
                tournament=self.tournament,
                registered_user=self.participant,
            ).exists()
        )
