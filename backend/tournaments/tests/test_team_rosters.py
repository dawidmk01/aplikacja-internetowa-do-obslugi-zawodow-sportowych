# backend/tournaments/tests/test_team_rosters.py
# Plik zawiera testy API zabezpieczające zarządzanie składami drużyn w turnieju.

from django.apps import apps
from django.test import TestCase

from rest_framework.test import APIClient

from tournaments.models import Division, Team, Tournament

from .helpers import create_test_user


class TournamentTeamRosterApiTests(TestCase):
    """Testy API zabezpieczają edycję składów drużyn oraz uprawnienia roster_edit."""

    bye_team_name = "__SYSTEM_BYE__"

    def setUp(self):
        self.organizer = create_test_user("roster-owner@example.com")
        self.participant = create_test_user("roster-participant@example.com")
        self.other_participant = create_test_user("roster-other-participant@example.com")
        self.assistant = create_test_user("roster-assistant@example.com")
        self.other_user = create_test_user("roster-other@example.com")

        self.client = APIClient()

        self.membership_model = apps.get_model("tournaments", "TournamentMembership")
        self.registration_model = apps.get_model("tournaments", "TournamentRegistration")
        self.player_model = apps.get_model("tournaments", "TeamPlayer")

        self.tournament = Tournament.objects.create(
            name="Turniej składów",
            discipline=Tournament.Discipline.FOOTBALL,
            organizer=self.organizer,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            entry_mode=Tournament.EntryMode.MANAGER,
            participants_public_preview_enabled=True,
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

        self.team = Team.objects.create(
            tournament=self.tournament,
            division=self.division,
            name="Drużyna uczestnika",
            is_active=True,
            registered_user=self.participant,
        )
        self.other_team = Team.objects.create(
            tournament=self.tournament,
            division=self.division,
            name="Druga drużyna",
            is_active=True,
            registered_user=self.other_participant,
        )

        self.registration_model.objects.create(
            tournament=self.tournament,
            division=self.division,
            user=self.participant,
            team=self.team,
            display_name=self.team.name,
        )
        self.registration_model.objects.create(
            tournament=self.tournament,
            division=self.division,
            user=self.other_participant,
            team=self.other_team,
            display_name=self.other_team.name,
        )

    def _team_players_url(self, team=None, division=None):
        team = team or self.team
        division = division or self.division

        return f"/api/tournaments/{self.tournament.id}/teams/{team.id}/players/?division_id={division.id}"

    def _my_team_players_url(self, division=None):
        division = division or self.division

        return f"/api/tournaments/{self.tournament.id}/my-team/players/?division_id={division.id}"

    def _create_assistant_membership(self, *, permissions=None, entry_mode=None):
        if entry_mode is not None:
            self.tournament.entry_mode = entry_mode
            self.tournament.save(update_fields=["entry_mode"])

        membership = self.membership_model.objects.create(
            tournament=self.tournament,
            user=self.assistant,
            role=self.membership_model.Role.ASSISTANT,
            status=self.membership_model.Status.ACCEPTED,
            permissions=permissions or {},
            invited_by=self.organizer,
        )

        return membership

    def _active_players(self, team=None):
        team = team or self.team

        return list(
            self.player_model.objects.filter(team=team, is_active=True).order_by("id")
        )

    def test_organizer_can_save_team_roster(self):
        self.client.force_authenticate(user=self.organizer)

        response = self.client.put(
            self._team_players_url(),
            {
                "players": [
                    {"display_name": "Dawid Kędzierski", "jersey_number": 7},
                    {"display_name": "Piotr Nowak", "jersey_number": 10},
                ]
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("team_id"), self.team.id)
        self.assertEqual(response.json().get("count"), 2)

        players = self._active_players()

        self.assertEqual([player.display_name for player in players], ["Dawid Kędzierski", "Piotr Nowak"])
        self.assertEqual([player.jersey_number for player in players], [7, 10])
        self.assertTrue(all(player.created_by_id == self.organizer.id for player in players))

    def test_roster_update_modifies_existing_player_and_deactivates_removed_player(self):
        first_player = self.player_model.objects.create(
            team=self.team,
            display_name="Stare imię",
            jersey_number=5,
            created_by=self.organizer,
        )
        removed_player = self.player_model.objects.create(
            team=self.team,
            display_name="Usunięty zawodnik",
            jersey_number=9,
            created_by=self.organizer,
        )

        self.client.force_authenticate(user=self.organizer)

        response = self.client.put(
            self._team_players_url(),
            {
                "players": [
                    {
                        "id": first_player.id,
                        "display_name": "Nowe imię",
                        "jersey_number": 11,
                    }
                ]
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        first_player.refresh_from_db()
        removed_player.refresh_from_db()

        self.assertTrue(first_player.is_active)
        self.assertEqual(first_player.display_name, "Nowe imię")
        self.assertEqual(first_player.jersey_number, 11)
        self.assertFalse(removed_player.is_active)

    def test_roster_rejects_duplicate_active_jersey_numbers(self):
        self.client.force_authenticate(user=self.organizer)

        response = self.client.put(
            self._team_players_url(),
            {
                "players": [
                    {"display_name": "Pierwszy zawodnik", "jersey_number": 8},
                    {"display_name": "Drugi zawodnik", "jersey_number": 8},
                ]
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.player_model.objects.filter(team=self.team, is_active=True).count(), 0)

    def test_roster_rejects_non_positive_jersey_number(self):
        self.client.force_authenticate(user=self.organizer)

        response = self.client.put(
            self._team_players_url(),
            {
                "players": [
                    {"display_name": "Błędny numer", "jersey_number": 0},
                ]
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.player_model.objects.filter(team=self.team, is_active=True).count(), 0)

    def test_roster_rejects_player_id_from_other_team(self):
        foreign_player = self.player_model.objects.create(
            team=self.other_team,
            display_name="Zawodnik innej drużyny",
            jersey_number=3,
            created_by=self.organizer,
        )

        self.client.force_authenticate(user=self.organizer)

        response = self.client.put(
            self._team_players_url(),
            {
                "players": [
                    {
                        "id": foreign_player.id,
                        "display_name": "Próba przeniesienia",
                        "jersey_number": 4,
                    }
                ]
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)

        foreign_player.refresh_from_db()

        self.assertEqual(foreign_player.team_id, self.other_team.id)
        self.assertEqual(foreign_player.display_name, "Zawodnik innej drużyny")

    def test_roster_list_returns_only_active_players_for_selected_team(self):
        active_player = self.player_model.objects.create(
            team=self.team,
            display_name="Aktywny zawodnik",
            jersey_number=1,
            created_by=self.organizer,
        )
        inactive_player = self.player_model.objects.create(
            team=self.team,
            display_name="Nieaktywny zawodnik",
            jersey_number=2,
            is_active=False,
            created_by=self.organizer,
        )
        foreign_player = self.player_model.objects.create(
            team=self.other_team,
            display_name="Zawodnik innej drużyny",
            jersey_number=3,
            created_by=self.organizer,
        )

        self.client.force_authenticate(user=self.organizer)

        response = self.client.get(self._team_players_url())

        self.assertEqual(response.status_code, 200)

        result_ids = {item.get("id") for item in response.json().get("results", [])}

        self.assertIn(active_player.id, result_ids)
        self.assertNotIn(inactive_player.id, result_ids)
        self.assertNotIn(foreign_player.id, result_ids)

    def test_team_roster_endpoint_is_limited_to_selected_division(self):
        second_division = Division.objects.create(
            tournament=self.tournament,
            name="Druga dywizja",
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            status=Tournament.Status.CONFIGURED,
        )

        self.client.force_authenticate(user=self.organizer)

        response = self.client.put(
            self._team_players_url(team=self.team, division=second_division),
            {
                "players": [
                    {"display_name": "Błędna dywizja", "jersey_number": 12},
                ]
            },
            format="json",
        )

        self.assertEqual(response.status_code, 404)
        self.assertFalse(
            self.player_model.objects.filter(team=self.team, display_name="Błędna dywizja").exists()
        )

    def test_roster_endpoint_rejects_individual_division(self):
        individual_tournament = Tournament.objects.create(
            name="Turniej indywidualny bez składów",
            discipline=Tournament.Discipline.TENNIS,
            organizer=self.organizer,
            competition_type=Tournament.CompetitionType.INDIVIDUAL,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
        )
        individual_division = Division.objects.create(
            tournament=individual_tournament,
            name="Indywidualna",
            is_default=True,
            competition_type=Tournament.CompetitionType.INDIVIDUAL,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            status=Tournament.Status.CONFIGURED,
        )
        individual_team = Team.objects.create(
            tournament=individual_tournament,
            division=individual_division,
            name="Zawodnik 1",
            is_active=True,
        )

        self.client.force_authenticate(user=self.organizer)

        response = self.client.put(
            f"/api/tournaments/{individual_tournament.id}/teams/{individual_team.id}/players/?division_id={individual_division.id}",
            {
                "players": [
                    {"display_name": "Nie powinno przejść", "jersey_number": 1},
                ]
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)

    def test_participant_can_view_own_team_roster(self):
        self.player_model.objects.create(
            team=self.team,
            display_name="Własny zawodnik",
            jersey_number=14,
            created_by=self.organizer,
        )

        self.client.force_authenticate(user=self.participant)

        response = self.client.get(self._my_team_players_url())

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("team_id"), self.team.id)
        self.assertEqual(response.json().get("count"), 1)
        self.assertEqual(response.json().get("results")[0].get("display_name"), "Własny zawodnik")

    def test_participant_cannot_edit_own_team_roster_when_owner_edit_is_disabled(self):
        self.client.force_authenticate(user=self.participant)

        response = self.client.put(
            self._my_team_players_url(),
            {
                "players": [
                    {"display_name": "Zawodnik właściciela", "jersey_number": 22},
                ]
            },
            format="json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertFalse(
            self.player_model.objects.filter(
                team=self.team,
                display_name="Zawodnik właściciela",
            ).exists()
        )

    def test_participant_cannot_edit_foreign_team_roster(self):
        self.client.force_authenticate(user=self.participant)

        response = self.client.put(
            self._team_players_url(team=self.other_team),
            {
                "players": [
                    {"display_name": "Cudza edycja", "jersey_number": 6},
                ]
            },
            format="json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertFalse(
            self.player_model.objects.filter(team=self.other_team, display_name="Cudza edycja").exists()
        )

    def test_unregistered_user_cannot_use_my_team_roster_endpoint(self):
        self.client.force_authenticate(user=self.other_user)

        response = self.client.put(
            self._my_team_players_url(),
            {
                "players": [
                    {"display_name": "Bez rejestracji", "jersey_number": 13},
                ]
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(
            self.player_model.objects.filter(team=self.team, display_name="Bez rejestracji").exists()
        )

    def test_assistant_with_roster_edit_can_update_roster(self):
        self._create_assistant_membership(
            permissions={
                self.membership_model.PERM_ROSTER_EDIT: True,
            }
        )

        self.client.force_authenticate(user=self.assistant)

        response = self.client.put(
            self._team_players_url(),
            {
                "players": [
                    {"display_name": "Zawodnik asystenta", "jersey_number": 15},
                ]
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        players = self._active_players()

        self.assertEqual(len(players), 1)
        self.assertEqual(players[0].display_name, "Zawodnik asystenta")
        self.assertEqual(players[0].created_by_id, self.assistant.id)

    def test_assistant_without_roster_edit_cannot_update_roster(self):
        self._create_assistant_membership(
            permissions={
                self.membership_model.PERM_TEAMS_EDIT: True,
                self.membership_model.PERM_ROSTER_EDIT: False,
            }
        )

        self.client.force_authenticate(user=self.assistant)

        response = self.client.put(
            self._team_players_url(),
            {
                "players": [
                    {"display_name": "Brak uprawnień roster", "jersey_number": 16},
                ]
            },
            format="json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertFalse(
            self.player_model.objects.filter(team=self.team, display_name="Brak uprawnień roster").exists()
        )

    def test_organizer_only_entry_mode_blocks_assistant_roster_edit(self):
        self._create_assistant_membership(
            permissions={
                self.membership_model.PERM_ROSTER_EDIT: True,
            },
            entry_mode=Tournament.EntryMode.ORGANIZER_ONLY,
        )

        self.client.force_authenticate(user=self.assistant)

        response = self.client.put(
            self._team_players_url(),
            {
                "players": [
                    {"display_name": "Zablokowany asystent", "jersey_number": 17},
                ]
            },
            format="json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertFalse(
            self.player_model.objects.filter(team=self.team, display_name="Zablokowany asystent").exists()
        )

    def test_technical_bye_team_cannot_have_roster(self):
        bye_team = Team.objects.create(
            tournament=self.tournament,
            division=self.division,
            name=self.bye_team_name,
            is_active=True,
        )

        self.client.force_authenticate(user=self.organizer)

        response = self.client.put(
            self._team_players_url(team=bye_team),
            {
                "players": [
                    {"display_name": "Zawodnik BYE", "jersey_number": 1},
                ]
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(self.player_model.objects.filter(team=bye_team).exists())
