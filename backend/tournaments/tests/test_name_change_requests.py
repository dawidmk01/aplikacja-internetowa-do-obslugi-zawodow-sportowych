# backend/tournaments/tests/test_name_change_requests.py
# Plik zabezpiecza przepływ wniosków uczestników o zmianę nazwy.

from .helpers import *


class TournamentTeamNameChangeRequestApiTests(TestCase):
    """Testy API zabezpieczają przepływ wniosków o zmianę nazwy uczestnika."""

    def setUp(self):
        self.organizer = create_test_user("name-change-owner@example.com")
        self.participant = create_test_user("name-change-participant@example.com")
        self.other_user = create_test_user("name-change-other@example.com")
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

    def _registration_model(self):
        return apps.get_model("tournaments", "TournamentRegistration")

    def _name_change_request_model(self):
        return apps.get_model("tournaments", "TeamNameChangeRequest")

    def _response_items(self, response):
        data = response.json()

        if isinstance(data, list):
            return data

        if isinstance(data, dict) and isinstance(data.get("results"), list):
            return data["results"]

        return []

    def _create_tournament_with_registered_participant(
        self,
        *,
        self_rename_enabled=False,
        name="Turniej wniosków o nazwę",
    ):
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
        tournament.participants_self_rename_enabled = self_rename_enabled
        tournament.participants_public_preview_enabled = True
        tournament.save(
            update_fields=[
                "participants_self_rename_enabled",
                "participants_public_preview_enabled",
            ]
        )

        division = tournament.get_default_division()
        team = (
            Team.objects.filter(
                tournament=tournament,
                division=division,
                is_active=True,
            )
            .order_by("id")
            .first()
        )

        team.name = "Stara nazwa uczestnika"
        team.registered_user = self.participant
        team.save(update_fields=["name", "registered_user"])

        self._registration_model().objects.create(
            tournament=tournament,
            division=division,
            user=self.participant,
            team=team,
            display_name="Stara nazwa uczestnika",
        )

        return tournament, division, team

    def _create_pending_request(self):
        tournament, division, team = self._create_tournament_with_registered_participant()

        self.client.force_authenticate(user=self.participant)

        response = self.client.post(
            self._api_url_for_view(
                "TournamentTeamNameChangeRequestCreateView",
                pk=tournament.id,
                team_id=team.id,
            )
            + f"?division_id={division.id}",
            {"requested_name": "Nowa nazwa uczestnika"},
            format="json",
        )

        self.assertEqual(response.status_code, 201)

        request_model = self._name_change_request_model()
        name_request = request_model.objects.get(id=response.json()["request"]["id"])

        return tournament, division, team, name_request

    def test_participant_cannot_request_name_change_when_self_rename_is_enabled(self):
        tournament, division, team = self._create_tournament_with_registered_participant(
            self_rename_enabled=True,
            name="Turniej z samoedycją nazw",
        )

        self.client.force_authenticate(user=self.participant)

        response = self.client.post(
            self._api_url_for_view(
                "TournamentTeamNameChangeRequestCreateView",
                pk=tournament.id,
                team_id=team.id,
            )
            + f"?division_id={division.id}",
            {"requested_name": "Niepotrzebny wniosek"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(
            self._name_change_request_model()
            .objects.filter(tournament=tournament, team=team)
            .exists()
        )

    def test_registered_participant_can_submit_name_change_request(self):
        tournament, division, team = self._create_tournament_with_registered_participant()

        self.client.force_authenticate(user=self.participant)

        response = self.client.post(
            self._api_url_for_view(
                "TournamentTeamNameChangeRequestCreateView",
                pk=tournament.id,
                team_id=team.id,
            )
            + f"?division_id={division.id}",
            {"requested_name": "Nowa nazwa uczestnika"},
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json().get("detail"), "Prośba została złożona.")

        request_model = self._name_change_request_model()
        name_request = request_model.objects.get(tournament=tournament, team=team)

        self.assertEqual(name_request.requested_by_id, self.participant.id)
        self.assertEqual(name_request.old_name, "Stara nazwa uczestnika")
        self.assertEqual(name_request.requested_name, "Nowa nazwa uczestnika")
        self.assertEqual(name_request.status, request_model.Status.PENDING)

    def test_participant_cannot_submit_second_pending_request_for_same_team(self):
        tournament, division, team, _name_request = self._create_pending_request()

        self.client.force_authenticate(user=self.participant)

        response = self.client.post(
            self._api_url_for_view(
                "TournamentTeamNameChangeRequestCreateView",
                pk=tournament.id,
                team_id=team.id,
            )
            + f"?division_id={division.id}",
            {"requested_name": "Jeszcze inna nazwa"},
            format="json",
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(
            self._name_change_request_model()
            .objects.filter(
                tournament=tournament,
                team=team,
                status=self._name_change_request_model().Status.PENDING,
            )
            .count(),
            1,
        )

    def test_unregistered_user_cannot_submit_name_change_request(self):
        tournament, division, team = self._create_tournament_with_registered_participant()

        self.client.force_authenticate(user=self.other_user)

        response = self.client.post(
            self._api_url_for_view(
                "TournamentTeamNameChangeRequestCreateView",
                pk=tournament.id,
                team_id=team.id,
            )
            + f"?division_id={division.id}",
            {"requested_name": "Niedozwolona nazwa"},
            format="json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertFalse(
            self._name_change_request_model()
            .objects.filter(tournament=tournament, requested_by=self.other_user)
            .exists()
        )

    def test_participant_cannot_submit_request_for_foreign_team_slot(self):
        tournament, division, team = self._create_tournament_with_registered_participant()

        foreign_team = (
            Team.objects.filter(
                tournament=tournament,
                division=division,
                is_active=True,
            )
            .exclude(id=team.id)
            .order_by("id")
            .first()
        )

        self.client.force_authenticate(user=self.participant)

        response = self.client.post(
            self._api_url_for_view(
                "TournamentTeamNameChangeRequestCreateView",
                pk=tournament.id,
                team_id=foreign_team.id,
            )
            + f"?division_id={division.id}",
            {"requested_name": "Próba cudzego slotu"},
            format="json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertFalse(
            self._name_change_request_model()
            .objects.filter(tournament=tournament, team=foreign_team)
            .exists()
        )

    def test_organizer_can_list_pending_name_change_requests(self):
        tournament, division, team, name_request = self._create_pending_request()

        self.client.force_authenticate(user=self.organizer)

        response = self.client.get(
            self._api_url_for_view(
                "TournamentTeamNameChangeRequestListView",
                pk=tournament.id,
            )
            + f"?division_id={division.id}"
        )

        self.assertEqual(response.status_code, 200)

        items = self._response_items(response)

        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].get("id"), name_request.id)
        self.assertEqual(items[0].get("team_id"), team.id)
        self.assertEqual(items[0].get("requested_name"), "Nowa nazwa uczestnika")

    def test_participant_can_list_only_own_name_change_requests(self):
        tournament, division, _team, name_request = self._create_pending_request()

        self.client.force_authenticate(user=self.participant)

        response = self.client.get(
            self._api_url_for_view(
                "TournamentTeamNameChangeRequestListView",
                pk=tournament.id,
            )
            + f"?division_id={division.id}"
        )

        self.assertEqual(response.status_code, 200)

        items = self._response_items(response)

        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].get("id"), name_request.id)

    def test_organizer_can_approve_name_change_request(self):
        tournament, division, team, name_request = self._create_pending_request()

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            self._api_url_for_view(
                "TournamentTeamNameChangeRequestApproveView",
                pk=tournament.id,
                request_id=name_request.id,
            )
            + f"?division_id={division.id}"
        )

        self.assertEqual(response.status_code, 200)

        name_request.refresh_from_db()
        team.refresh_from_db()

        registration = self._registration_model().objects.get(
            tournament=tournament,
            division=division,
            user=self.participant,
        )

        self.assertEqual(name_request.status, self._name_change_request_model().Status.APPROVED)
        self.assertEqual(name_request.decided_by_id, self.organizer.id)
        self.assertIsNotNone(name_request.decided_at)
        self.assertEqual(team.name, "Nowa nazwa uczestnika")
        self.assertEqual(registration.display_name, "Nowa nazwa uczestnika")

    def test_organizer_can_reject_name_change_request(self):
        tournament, division, team, name_request = self._create_pending_request()

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            self._api_url_for_view(
                "TournamentTeamNameChangeRequestRejectView",
                pk=tournament.id,
                request_id=name_request.id,
            )
            + f"?division_id={division.id}"
        )

        self.assertEqual(response.status_code, 200)

        name_request.refresh_from_db()
        team.refresh_from_db()

        registration = self._registration_model().objects.get(
            tournament=tournament,
            division=division,
            user=self.participant,
        )

        self.assertEqual(name_request.status, self._name_change_request_model().Status.REJECTED)
        self.assertEqual(name_request.decided_by_id, self.organizer.id)
        self.assertIsNotNone(name_request.decided_at)
        self.assertEqual(team.name, "Stara nazwa uczestnika")
        self.assertEqual(registration.display_name, "Stara nazwa uczestnika")

    def test_participant_cannot_approve_own_name_change_request(self):
        tournament, division, _team, name_request = self._create_pending_request()

        self.client.force_authenticate(user=self.participant)

        response = self.client.post(
            self._api_url_for_view(
                "TournamentTeamNameChangeRequestApproveView",
                pk=tournament.id,
                request_id=name_request.id,
            )
            + f"?division_id={division.id}"
        )

        self.assertEqual(response.status_code, 403)

        name_request.refresh_from_db()
        self.assertEqual(name_request.status, self._name_change_request_model().Status.PENDING)
