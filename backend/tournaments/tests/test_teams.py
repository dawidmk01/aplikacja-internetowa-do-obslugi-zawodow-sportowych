# backend/tournaments/tests/test_teams.py
# Plik zabezpiecza konfigurację slotów oraz listowanie i edycję uczestników.

from .helpers import *


class TournamentTeamSetupApiTests(TestCase):
    """Testy API zabezpieczają konfigurację liczby uczestników w aktywnej dywizji."""

    def setUp(self):
        self.organizer = create_test_user("team-setup-owner@example.com")
        self.other_user = create_test_user("team-setup-other@example.com")
        self.client = APIClient()

    def _create_tournament_via_api(self, name="Turniej uczestników", discipline="football"):
        self.client.force_authenticate(user=self.organizer)
        response = self.client.post(
            "/api/tournaments/",
            {
                "name": name,
                "discipline": discipline,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)

        tournament = Tournament.objects.get(name=name)
        return tournament, tournament.get_default_division()

    def _active_team_names(self, tournament, division):
        return list(
            Team.objects.filter(
                tournament=tournament,
                division=division,
                is_active=True,
            )
            .exclude(name="__SYSTEM_BYE__")
            .order_by("id")
            .values_list("name", flat=True)
        )

    def test_organizer_can_increase_participants_count(self):
        tournament, division = self._create_tournament_via_api()

        response = self.client.post(
            f"/api/tournaments/{tournament.id}/teams/setup/?division_id={division.id}",
            {"teams_count": 4},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("division_id"), division.id)
        self.assertEqual(response.json().get("teams_count"), 4)
        self.assertTrue(response.json().get("upgraded"))

        self.assertEqual(
            self._active_team_names(tournament, division),
            ["Drużyna 1", "Drużyna 2", "Drużyna 3", "Drużyna 4"],
        )

    def test_organizer_can_decrease_active_participants_count_without_deleting_slots(self):
        tournament, division = self._create_tournament_via_api()

        self.client.post(
            f"/api/tournaments/{tournament.id}/teams/setup/?division_id={division.id}",
            {"teams_count": 4},
            format="json",
        )

        response = self.client.post(
            f"/api/tournaments/{tournament.id}/teams/setup/?division_id={division.id}",
            {"teams_count": 3},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("teams_count"), 3)

        all_teams = list(
            Team.objects.filter(tournament=tournament, division=division)
            .exclude(name="__SYSTEM_BYE__")
            .order_by("id")
        )

        self.assertEqual([team.name for team in all_teams], ["Drużyna 1", "Drużyna 2", "Drużyna 3", "Drużyna 4"])
        self.assertEqual([team.name for team in all_teams if team.is_active], ["Drużyna 1", "Drużyna 2", "Drużyna 3"])
        self.assertFalse(all_teams[-1].is_active)

    def test_team_setup_rejects_less_than_two_participants(self):
        tournament, division = self._create_tournament_via_api()

        response = self.client.post(
            f"/api/tournaments/{tournament.id}/teams/setup/?division_id={division.id}",
            {"teams_count": 1},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(self._active_team_names(tournament, division), ["Drużyna 1", "Drużyna 2"])

    def test_team_setup_rejects_invalid_participants_count(self):
        tournament, division = self._create_tournament_via_api()

        response = self.client.post(
            f"/api/tournaments/{tournament.id}/teams/setup/?division_id={division.id}",
            {"teams_count": "abc"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(self._active_team_names(tournament, division), ["Drużyna 1", "Drużyna 2"])

    def test_other_user_cannot_change_participants_count(self):
        tournament, division = self._create_tournament_via_api()
        self.client.force_authenticate(user=self.other_user)

        response = self.client.post(
            f"/api/tournaments/{tournament.id}/teams/setup/?division_id={division.id}",
            {"teams_count": 4},
            format="json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(self._active_team_names(tournament, division), ["Drużyna 1", "Drużyna 2"])

    def test_individual_division_uses_participant_slot_prefix_when_increasing_count(self):
        tournament, division = self._create_tournament_via_api(
            name="Turniej indywidualny setup",
            discipline="tennis",
        )

        response = self.client.post(
            f"/api/tournaments/{tournament.id}/teams/setup/?division_id={division.id}",
            {"participants_count": 4},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("teams_count"), 4)
        self.assertEqual(
            self._active_team_names(tournament, division),
            ["Zawodnik 1", "Zawodnik 2", "Zawodnik 3", "Zawodnik 4"],
        )

    def test_team_setup_regenerates_structure_when_stage_is_missing(self):
        from tournaments.models import Match, Stage

        tournament, division = self._create_tournament_via_api()

        Stage.objects.filter(tournament=tournament, division=division).delete()
        self.assertFalse(Stage.objects.filter(tournament=tournament, division=division).exists())

        response = self.client.post(
            f"/api/tournaments/{tournament.id}/teams/setup/?division_id={division.id}",
            {"teams_count": 2},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json().get("upgraded"))

        self.assertTrue(Stage.objects.filter(tournament=tournament, division=division).exists())
        self.assertTrue(Match.objects.filter(tournament=tournament, stage__division=division).exists())

    def test_team_setup_updates_only_selected_division(self):
        tournament, default_division = self._create_tournament_via_api()

        response = self.client.post(
            f"/api/tournaments/{tournament.id}/divisions/",
            {"name": "Druga dywizja"},
            format="json",
        )
        self.assertEqual(response.status_code, 201)

        second_division = Division.objects.get(tournament=tournament, name="Druga dywizja")

        response = self.client.post(
            f"/api/tournaments/{tournament.id}/teams/setup/?division_id={default_division.id}",
            {"teams_count": 4},
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        self.assertEqual(
            self._active_team_names(tournament, default_division),
            ["Drużyna 1", "Drużyna 2", "Drużyna 3", "Drużyna 4"],
        )
        self.assertEqual(
            self._active_team_names(tournament, second_division),
            ["Drużyna 1", "Drużyna 2"],
        )


class TournamentTeamListAndUpdateApiTests(TestCase):
    """Testy API zabezpieczają listowanie i edycję uczestników w aktywnej dywizji."""

    bye_team_name = "__SYSTEM_BYE__"

    def setUp(self):
        self.organizer = create_test_user("team-list-owner@example.com")
        self.other_user = create_test_user("team-list-other@example.com")
        self.client = APIClient()

    def _create_tournament_via_api(self, name="Turniej listy uczestników", discipline="football"):
        self.client.force_authenticate(user=self.organizer)
        response = self.client.post(
            "/api/tournaments/",
            {
                "name": name,
                "discipline": discipline,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)

        tournament = Tournament.objects.get(name=name)
        return tournament, tournament.get_default_division()

    def _create_division_via_api(self, tournament, name="Druga dywizja"):
        response = self.client.post(
            f"/api/tournaments/{tournament.id}/divisions/",
            {"name": name},
            format="json",
        )
        self.assertEqual(response.status_code, 201)

        return Division.objects.get(tournament=tournament, name=name)

    def _response_items(self, response):
        data = response.json()

        if isinstance(data, list):
            return data

        if isinstance(data, dict) and isinstance(data.get("results"), list):
            return data["results"]

        return []

    def test_organizer_sees_only_active_teams_from_selected_division(self):
        tournament, default_division = self._create_tournament_via_api()
        second_division = self._create_division_via_api(tournament, "Seniorzy")

        Team.objects.filter(tournament=tournament, division=second_division).update(is_active=False)

        response = self.client.get(
            f"/api/tournaments/{tournament.id}/teams/?division_id={default_division.id}"
        )

        self.assertEqual(response.status_code, 200)

        items = self._response_items(response)
        team_ids = {item.get("id") for item in items}
        expected_ids = set(
            Team.objects.filter(
                tournament=tournament,
                division=default_division,
                is_active=True,
            )
            .exclude(name=self.bye_team_name)
            .values_list("id", flat=True)
        )

        self.assertSetEqual(team_ids, expected_ids)

    def test_team_list_excludes_inactive_slots(self):
        tournament, division = self._create_tournament_via_api()
        inactive_team = Team.objects.filter(tournament=tournament, division=division).order_by("id").last()
        inactive_team.is_active = False
        inactive_team.save(update_fields=["is_active"])

        response = self.client.get(
            f"/api/tournaments/{tournament.id}/teams/?division_id={division.id}"
        )

        self.assertEqual(response.status_code, 200)

        items = self._response_items(response)
        team_ids = {item.get("id") for item in items}

        self.assertNotIn(inactive_team.id, team_ids)
        self.assertEqual(len(items), 1)

    def test_team_list_excludes_technical_bye_slot(self):
        tournament, division = self._create_tournament_via_api()
        bye_team = Team.objects.create(
            tournament=tournament,
            division=division,
            name=self.bye_team_name,
            is_active=True,
        )

        response = self.client.get(
            f"/api/tournaments/{tournament.id}/teams/?division_id={division.id}"
        )

        self.assertEqual(response.status_code, 200)

        items = self._response_items(response)
        team_ids = {item.get("id") for item in items}
        team_names = {item.get("name") for item in items}

        self.assertNotIn(bye_team.id, team_ids)
        self.assertNotIn(self.bye_team_name, team_names)

    def test_other_user_receives_empty_team_list_for_private_tournament(self):
        tournament, division = self._create_tournament_via_api()
        self.client.force_authenticate(user=self.other_user)

        response = self.client.get(
            f"/api/tournaments/{tournament.id}/teams/?division_id={division.id}"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._response_items(response), [])

    def test_organizer_can_update_team_name(self):
        tournament, division = self._create_tournament_via_api()
        team = Team.objects.filter(tournament=tournament, division=division, is_active=True).order_by("id").first()

        response = self.client.patch(
            f"/api/tournaments/{tournament.id}/teams/{team.id}/?division_id={division.id}",
            {"name": "FC Test"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        team.refresh_from_db()
        self.assertEqual(team.name, "FC Test")

    def test_other_user_cannot_update_team_name(self):
        tournament, division = self._create_tournament_via_api()
        team = Team.objects.filter(tournament=tournament, division=division, is_active=True).order_by("id").first()

        self.client.force_authenticate(user=self.other_user)

        response = self.client.patch(
            f"/api/tournaments/{tournament.id}/teams/{team.id}/?division_id={division.id}",
            {"name": "Niedozwolona nazwa"},
            format="json",
        )

        self.assertEqual(response.status_code, 403)

        team.refresh_from_db()
        self.assertNotEqual(team.name, "Niedozwolona nazwa")

    def test_team_update_is_limited_to_selected_division(self):
        tournament, default_division = self._create_tournament_via_api()
        second_division = self._create_division_via_api(tournament, "Seniorzy")

        default_team = Team.objects.filter(
            tournament=tournament,
            division=default_division,
            is_active=True,
        ).order_by("id").first()

        response = self.client.patch(
            f"/api/tournaments/{tournament.id}/teams/{default_team.id}/?division_id={second_division.id}",
            {"name": "Błędna dywizja"},
            format="json",
        )

        self.assertEqual(response.status_code, 404)

        default_team.refresh_from_db()
        self.assertNotEqual(default_team.name, "Błędna dywizja")

    def test_cannot_update_technical_bye_slot(self):
        tournament, division = self._create_tournament_via_api()
        bye_team = Team.objects.create(
            tournament=tournament,
            division=division,
            name=self.bye_team_name,
            is_active=True,
        )

        response = self.client.patch(
            f"/api/tournaments/{tournament.id}/teams/{bye_team.id}/?division_id={division.id}",
            {"name": "Niepoprawna nazwa BYE"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)

        bye_team.refresh_from_db()
        self.assertEqual(bye_team.name, self.bye_team_name)
