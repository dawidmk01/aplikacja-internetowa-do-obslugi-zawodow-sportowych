# backend/tournaments/tests/test_incident_player_guards.py
# Plik testuje walidację powiązania incydentów meczowych ze składem właściwej drużyny.

from django.apps import apps
from django.test import TestCase
from rest_framework.test import APIClient

from tournaments.models import Division, Team, Tournament

from .helpers import create_test_user


class TournamentIncidentPlayerGuardTests(TestCase):
    """Testy zabezpieczają przypisywanie incydentów wyłącznie do zawodników z właściwej drużyny meczu."""

    def setUp(self):
        self.organizer = create_test_user("incident-player-owner@example.com")
        self.assistant = create_test_user("incident-player-assistant@example.com")
        self.other_user = create_test_user("incident-player-other@example.com")
        self.client = APIClient()

        self.stage_model = apps.get_model("tournaments", "Stage")
        self.match_model = apps.get_model("tournaments", "Match")
        self.player_model = apps.get_model("tournaments", "TeamPlayer")
        self.incident_model = apps.get_model("tournaments", "MatchIncident")
        self.membership_model = apps.get_model("tournaments", "TournamentMembership")

        self.tournament = Tournament.objects.create(
            name="Turniej walidacji incydentów",
            discipline=Tournament.Discipline.FOOTBALL,
            organizer=self.organizer,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            status=Tournament.Status.CONFIGURED,
            entry_mode=Tournament.EntryMode.MANAGER,
        )

        self.division = Division.objects.create(
            tournament=self.tournament,
            name="Dywizja incydentów",
            is_default=True,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            status=Tournament.Status.CONFIGURED,
        )

        self.home_team = Team.objects.create(
            tournament=self.tournament,
            division=self.division,
            name="Gospodarze",
            is_active=True,
        )
        self.away_team = Team.objects.create(
            tournament=self.tournament,
            division=self.division,
            name="Goście",
            is_active=True,
        )
        self.foreign_team = Team.objects.create(
            tournament=self.tournament,
            division=self.division,
            name="Obca drużyna",
            is_active=True,
        )

        self.home_player = self.player_model.objects.create(
            team=self.home_team,
            display_name="Dawid Kędzierski",
            jersey_number=10,
            created_by=self.organizer,
        )
        self.away_player = self.player_model.objects.create(
            team=self.away_team,
            display_name="Zawodnik gości",
            jersey_number=7,
            created_by=self.organizer,
        )
        self.foreign_player = self.player_model.objects.create(
            team=self.foreign_team,
            display_name="Zawodnik spoza meczu",
            jersey_number=99,
            created_by=self.organizer,
        )
        self.inactive_home_player = self.player_model.objects.create(
            team=self.home_team,
            display_name="Nieaktywny zawodnik gospodarzy",
            jersey_number=11,
            is_active=False,
            created_by=self.organizer,
        )

        self.stage = self.stage_model.objects.create(
            tournament=self.tournament,
            division=self.division,
            stage_type=self.stage_model.StageType.LEAGUE,
            order=1,
            status=self.stage_model.Status.OPEN,
        )

        self.match = self.match_model.objects.create(
            tournament=self.tournament,
            stage=self.stage,
            home_team=self.home_team,
            away_team=self.away_team,
            round_number=1,
            status=self.match_model.Status.SCHEDULED,
        )

    def _incidents_url(self):
        return f"/api/matches/{self.match.id}/incidents/"

    def _delete_url(self, incident):
        return f"/api/incidents/{incident.id}/"

    def _create_assistant_membership(self, *, results_edit=False):
        return self.membership_model.objects.create(
            tournament=self.tournament,
            user=self.assistant,
            role=self.membership_model.Role.ASSISTANT,
            status=self.membership_model.Status.ACCEPTED,
            permissions={
                self.membership_model.PERM_RESULTS_EDIT: results_edit,
            },
            invited_by=self.organizer,
        )

    def _goal_payload(self, *, team, player=None):
        payload = {
            "kind": "GOAL",
            "team_id": team.id,
            "minute": 12,
        }
        if player is not None:
            payload["player_id"] = player.id
        return payload

    def test_organizer_can_create_goal_incident_for_player_from_scoring_team(self):
        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            self._incidents_url(),
            self._goal_payload(team=self.home_team, player=self.home_player),
            format="json",
        )

        self.assertEqual(response.status_code, 201)

        incident = self.incident_model.objects.get(match=self.match)

        self.assertEqual(incident.team_id, self.home_team.id)
        self.assertEqual(incident.player_id, self.home_player.id)

        self.match.refresh_from_db()
        self.assertEqual(self.match.home_score, 1)
        self.assertEqual(self.match.away_score, 0)

    def test_incident_rejects_player_from_opponent_when_team_is_home(self):
        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            self._incidents_url(),
            self._goal_payload(team=self.home_team, player=self.away_player),
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(self.incident_model.objects.filter(match=self.match).exists())

        self.match.refresh_from_db()
        self.assertEqual(self.match.home_score, 0)
        self.assertEqual(self.match.away_score, 0)

    def test_incident_rejects_player_from_team_outside_match(self):
        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            self._incidents_url(),
            self._goal_payload(team=self.home_team, player=self.foreign_player),
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(self.incident_model.objects.filter(match=self.match).exists())

    def test_incident_rejects_inactive_player(self):
        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            self._incidents_url(),
            self._goal_payload(team=self.home_team, player=self.inactive_home_player),
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(self.incident_model.objects.filter(match=self.match).exists())

    def test_incident_rejects_team_outside_match(self):
        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            self._incidents_url(),
            self._goal_payload(team=self.foreign_team, player=self.foreign_player),
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(self.incident_model.objects.filter(match=self.match).exists())

    def test_assistant_with_results_edit_can_create_incident(self):
        self._create_assistant_membership(results_edit=True)
        self.client.force_authenticate(user=self.assistant)

        response = self.client.post(
            self._incidents_url(),
            self._goal_payload(team=self.away_team, player=self.away_player),
            format="json",
        )

        self.assertEqual(response.status_code, 201)

        incident = self.incident_model.objects.get(match=self.match)

        self.assertEqual(incident.team_id, self.away_team.id)
        self.assertEqual(incident.player_id, self.away_player.id)

    def test_assistant_without_results_edit_cannot_create_incident(self):
        self._create_assistant_membership(results_edit=False)
        self.client.force_authenticate(user=self.assistant)

        response = self.client.post(
            self._incidents_url(),
            self._goal_payload(team=self.home_team, player=self.home_player),
            format="json",
        )

        self.assertIn(response.status_code, {403, 404})
        self.assertFalse(self.incident_model.objects.filter(match=self.match).exists())

    def test_organizer_only_entry_mode_blocks_assistant_incident_creation(self):
        self._create_assistant_membership(results_edit=True)

        self.tournament.entry_mode = Tournament.EntryMode.ORGANIZER_ONLY
        self.tournament.save(update_fields=["entry_mode"])

        self.client.force_authenticate(user=self.assistant)

        response = self.client.post(
            self._incidents_url(),
            self._goal_payload(team=self.home_team, player=self.home_player),
            format="json",
        )

        self.assertIn(response.status_code, {403, 404})
        self.assertFalse(self.incident_model.objects.filter(match=self.match).exists())

    def test_other_user_cannot_create_incident(self):
        self.client.force_authenticate(user=self.other_user)

        response = self.client.post(
            self._incidents_url(),
            self._goal_payload(team=self.home_team, player=self.home_player),
            format="json",
        )

        self.assertIn(response.status_code, {403, 404})
        self.assertFalse(self.incident_model.objects.filter(match=self.match).exists())

    def test_deleting_goal_incident_recomputes_match_score(self):
        self.client.force_authenticate(user=self.organizer)

        first_response = self.client.post(
            self._incidents_url(),
            self._goal_payload(team=self.home_team, player=self.home_player),
            format="json",
        )
        second_response = self.client.post(
            self._incidents_url(),
            self._goal_payload(team=self.away_team, player=self.away_player),
            format="json",
        )

        self.assertEqual(first_response.status_code, 201)
        self.assertEqual(second_response.status_code, 201)

        home_incident = self.incident_model.objects.get(team=self.home_team)

        delete_response = self.client.delete(self._delete_url(home_incident))

        self.assertIn(delete_response.status_code, {200, 204})

        self.match.refresh_from_db()

        self.assertEqual(self.match.home_score, 0)
        self.assertEqual(self.match.away_score, 1)

    def test_archived_tournament_rejects_incident_creation(self):
        self.tournament.is_archived = True
        self.tournament.status = Tournament.Status.FINISHED
        self.tournament.save(update_fields=["is_archived", "status"])

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            self._incidents_url(),
            self._goal_payload(team=self.home_team, player=self.home_player),
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(self.incident_model.objects.filter(match=self.match).exists())
