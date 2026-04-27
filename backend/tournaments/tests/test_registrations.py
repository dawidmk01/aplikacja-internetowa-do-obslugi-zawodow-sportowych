# backend/tournaments/tests/test_registrations.py
# Plik zabezpiecza rejestrację uczestników do turnieju przez kod dostępu.

from .helpers import *


class TournamentRegistrationApiTests(TestCase):
    """Testy API zabezpieczają dołączanie uczestnika do turnieju przez kod."""

    def setUp(self):
        self.organizer = create_test_user("registration-owner@example.com")
        self.participant = create_test_user("registration-participant@example.com")
        self.second_participant = create_test_user("registration-second@example.com")
        self.third_participant = create_test_user("registration-third@example.com")
        self.client = APIClient()

    def _api_url_for_view(self, view_class_name: str, **params):
        urls_module = import_module("tournaments.urls")

        for pattern in urls_module.urlpatterns:
            if not isinstance(pattern, URLPattern):
                continue

            callback = getattr(pattern, "callback", None)
            view_class = getattr(callback, "view_class", None)

            if getattr(view_class, "__name__", None) != view_class_name:
                continue

            route = str(pattern.pattern)
            for key, value in params.items():
                route = route.replace(f"<int:{key}>", str(value))

            return f"/api/{route}"

        raise AssertionError(f"Nie znaleziono ścieżki dla widoku {view_class_name}.")

    def _create_joinable_tournament(self, name="Turniej rejestracji"):
        self.client.force_authenticate(user=self.organizer)
        response = self.client.post(
            "/api/tournaments/",
            {
                "name": name,
                "discipline": "football",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)

        tournament = Tournament.objects.get(name=name)
        tournament.join_enabled = True
        tournament.registration_code = "ABC123"
        tournament.participants_self_rename_enabled = True
        tournament.save(
            update_fields=[
                "join_enabled",
                "registration_code",
                "participants_self_rename_enabled",
            ]
        )

        return tournament, tournament.get_default_division()

    def _registration_model(self):
        return apps.get_model("tournaments", "TournamentRegistration")

    def test_registration_verify_rejects_when_join_is_disabled(self):
        tournament, division = self._create_joinable_tournament()
        tournament.join_enabled = False
        tournament.save(update_fields=["join_enabled"])

        self.client.force_authenticate(user=self.participant)

        response = self.client.post(
            self._api_url_for_view("TournamentRegistrationVerifyView", pk=tournament.id)
            + f"?division_id={division.id}",
            {"code": "ABC123"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)

    def test_registration_verify_rejects_invalid_code(self):
        tournament, division = self._create_joinable_tournament()
        self.client.force_authenticate(user=self.participant)

        response = self.client.post(
            self._api_url_for_view("TournamentRegistrationVerifyView", pk=tournament.id)
            + f"?division_id={division.id}",
            {"code": "WRONG"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)

    def test_registration_verify_accepts_valid_code(self):
        tournament, division = self._create_joinable_tournament()
        self.client.force_authenticate(user=self.participant)

        response = self.client.post(
            self._api_url_for_view("TournamentRegistrationVerifyView", pk=tournament.id)
            + f"?division_id={division.id}",
            {"code": "ABC123"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("detail"), "OK")
        self.assertEqual(response.json().get("division_id"), division.id)

    def test_participant_can_join_and_claim_first_free_slot(self):
        tournament, division = self._create_joinable_tournament()
        self.client.force_authenticate(user=self.participant)

        response = self.client.post(
            self._api_url_for_view("TournamentRegistrationJoinView", pk=tournament.id)
            + f"?division_id={division.id}",
            {
                "code": "ABC123",
                "display_name": "FC Uczestnik",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("detail"), "OK")
        self.assertEqual(response.json().get("division_id"), division.id)

        registration_model = self._registration_model()
        registration = registration_model.objects.get(
            tournament=tournament,
            division=division,
            user=self.participant,
        )
        team = Team.objects.get(id=response.json().get("team_id"))

        self.assertEqual(registration.display_name, "FC Uczestnik")
        self.assertEqual(registration.team_id, team.id)
        self.assertEqual(team.registered_user_id, self.participant.id)
        self.assertEqual(team.name, "FC Uczestnik")

    def test_join_accepts_name_alias_when_display_name_is_missing(self):
        tournament, division = self._create_joinable_tournament()
        self.client.force_authenticate(user=self.participant)

        response = self.client.post(
            self._api_url_for_view("TournamentRegistrationJoinView", pk=tournament.id)
            + f"?division_id={division.id}",
            {
                "code": "ABC123",
                "name": "Alias uczestnika",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("display_name"), "Alias uczestnika")

    def test_join_rejects_when_no_free_slots_are_available(self):
        tournament, division = self._create_joinable_tournament()

        for user, display_name in (
            (self.participant, "Pierwszy uczestnik"),
            (self.second_participant, "Drugi uczestnik"),
        ):
            self.client.force_authenticate(user=user)
            response = self.client.post(
                self._api_url_for_view("TournamentRegistrationJoinView", pk=tournament.id)
                + f"?division_id={division.id}",
                {
                    "code": "ABC123",
                    "display_name": display_name,
                },
                format="json",
            )
            self.assertEqual(response.status_code, 200)

        self.client.force_authenticate(user=self.third_participant)

        response = self.client.post(
            self._api_url_for_view("TournamentRegistrationJoinView", pk=tournament.id)
            + f"?division_id={division.id}",
            {
                "code": "ABC123",
                "display_name": "Trzeci uczestnik",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)

    def test_join_updates_existing_registration_without_claiming_second_slot(self):
        tournament, division = self._create_joinable_tournament()
        self.client.force_authenticate(user=self.participant)

        first_response = self.client.post(
            self._api_url_for_view("TournamentRegistrationJoinView", pk=tournament.id)
            + f"?division_id={division.id}",
            {
                "code": "ABC123",
                "display_name": "Pierwsza nazwa",
            },
            format="json",
        )
        self.assertEqual(first_response.status_code, 200)

        second_response = self.client.post(
            self._api_url_for_view("TournamentRegistrationJoinView", pk=tournament.id)
            + f"?division_id={division.id}",
            {
                "code": "ABC123",
                "display_name": "Druga nazwa",
            },
            format="json",
        )

        self.assertEqual(second_response.status_code, 200)
        self.assertEqual(second_response.json().get("team_id"), first_response.json().get("team_id"))

        registration_model = self._registration_model()
        self.assertEqual(
            registration_model.objects.filter(
                tournament=tournament,
                division=division,
                user=self.participant,
            ).count(),
            1,
        )

        team = Team.objects.get(id=first_response.json().get("team_id"))
        team.refresh_from_db()

        self.assertEqual(team.name, "Druga nazwa")

    def test_registration_me_returns_own_registration(self):
        tournament, division = self._create_joinable_tournament()
        self.client.force_authenticate(user=self.participant)

        join_response = self.client.post(
            self._api_url_for_view("TournamentRegistrationJoinView", pk=tournament.id)
            + f"?division_id={division.id}",
            {
                "code": "ABC123",
                "display_name": "Uczestnik do podglądu",
            },
            format="json",
        )
        self.assertEqual(join_response.status_code, 200)

        response = self.client.get(
            self._api_url_for_view("TournamentRegistrationMeView", pk=tournament.id)
            + f"?division_id={division.id}"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("display_name"), "Uczestnik do podglądu")
        self.assertEqual(response.json().get("team_id"), join_response.json().get("team_id"))
        self.assertEqual(response.json().get("division_id"), division.id)

    def test_registration_me_returns_404_without_registration(self):
        tournament, division = self._create_joinable_tournament()
        self.client.force_authenticate(user=self.participant)

        response = self.client.get(
            self._api_url_for_view("TournamentRegistrationMeView", pk=tournament.id)
            + f"?division_id={division.id}"
        )

        self.assertEqual(response.status_code, 404)

    def test_participant_can_rename_own_registration_when_self_rename_is_enabled(self):
        tournament, division = self._create_joinable_tournament()
        self.client.force_authenticate(user=self.participant)

        join_response = self.client.post(
            self._api_url_for_view("TournamentRegistrationJoinView", pk=tournament.id)
            + f"?division_id={division.id}",
            {
                "code": "ABC123",
                "display_name": "Stara nazwa",
            },
            format="json",
        )
        self.assertEqual(join_response.status_code, 200)

        response = self.client.patch(
            self._api_url_for_view("TournamentRegistrationMeView", pk=tournament.id)
            + f"?division_id={division.id}",
            {"display_name": "Nowa nazwa"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("display_name"), "Nowa nazwa")

        registration_model = self._registration_model()
        registration = registration_model.objects.get(
            tournament=tournament,
            division=division,
            user=self.participant,
        )
        team = Team.objects.get(id=registration.team_id)

        self.assertEqual(registration.display_name, "Nowa nazwa")
        self.assertEqual(team.name, "Nowa nazwa")

    def test_participant_cannot_rename_own_registration_when_self_rename_is_disabled(self):
        tournament, division = self._create_joinable_tournament()
        tournament.participants_self_rename_enabled = False
        tournament.save(update_fields=["participants_self_rename_enabled"])

        self.client.force_authenticate(user=self.participant)

        join_response = self.client.post(
            self._api_url_for_view("TournamentRegistrationJoinView", pk=tournament.id)
            + f"?division_id={division.id}",
            {
                "code": "ABC123",
                "display_name": "Nazwa bez samoedycji",
            },
            format="json",
        )
        self.assertEqual(join_response.status_code, 200)

        response = self.client.patch(
            self._api_url_for_view("TournamentRegistrationMeView", pk=tournament.id)
            + f"?division_id={division.id}",
            {"display_name": "Niedozwolona zmiana"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)

        team = Team.objects.get(id=join_response.json().get("team_id"))
        team.refresh_from_db()

        self.assertEqual(team.name, "Nazwa bez samoedycji")
