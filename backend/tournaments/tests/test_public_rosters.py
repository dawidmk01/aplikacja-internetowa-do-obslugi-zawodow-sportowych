# backend/tournaments/tests/test_public_rosters.py
# Plik zawiera testy API zabezpieczające publiczny podgląd składów drużyn.

from django.apps import apps
from django.test import TestCase

from rest_framework.test import APIClient

from tournaments.models import Division, Team, Tournament

from .helpers import create_test_user


class TournamentPublicRosterApiTests(TestCase):
    """Testy API zabezpieczają widoczność składów drużyn w widoku publicznym i uczestnika."""

    bye_team_name = "__SYSTEM_BYE__"

    def setUp(self):
        self.organizer = create_test_user("public-roster-owner@example.com")
        self.participant = create_test_user("public-roster-participant@example.com")
        self.other_user = create_test_user("public-roster-other@example.com")
        self.client = APIClient()

        self.player_model = apps.get_model("tournaments", "TeamPlayer")
        self.registration_model = apps.get_model("tournaments", "TournamentRegistration")

    def _create_context(
        self,
        *,
        name="Turniej publicznych składów",
        is_published=False,
        preview_enabled=False,
        competition_type=Tournament.CompetitionType.TEAM,
    ):
        tournament = Tournament.objects.create(
            name=name,
            discipline=Tournament.Discipline.FOOTBALL,
            organizer=self.organizer,
            competition_type=competition_type,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            status=Tournament.Status.CONFIGURED,
            is_published=is_published,
            participants_public_preview_enabled=preview_enabled,
        )

        division = Division.objects.create(
            tournament=tournament,
            name="Dywizja publiczna",
            is_default=True,
            competition_type=competition_type,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            status=Tournament.Status.CONFIGURED,
        )

        teams = [
            Team.objects.create(
                tournament=tournament,
                division=division,
                name=f"Drużyna publicznego składu {index}",
                is_active=True,
            )
            for index in range(1, 3)
        ]

        return tournament, division, teams

    def _team_players_url(self, tournament, division, team):
        return f"/api/tournaments/{tournament.id}/teams/{team.id}/players/?division_id={division.id}"

    def _create_players(self, team, other_team=None):
        active_player = self.player_model.objects.create(
            team=team,
            display_name="Dawid Kędzierski",
            jersey_number=10,
            created_by=self.organizer,
        )

        inactive_player = self.player_model.objects.create(
            team=team,
            display_name="Nieaktywny zawodnik",
            jersey_number=11,
            is_active=False,
            created_by=self.organizer,
        )

        foreign_player = None
        if other_team is not None:
            foreign_player = self.player_model.objects.create(
                team=other_team,
                display_name="Zawodnik innej drużyny",
                jersey_number=12,
                created_by=self.organizer,
            )

        return active_player, inactive_player, foreign_player

    def _register_participant(self, tournament, division, team):
        team.registered_user = self.participant
        team.save(update_fields=["registered_user"])

        return self.registration_model.objects.create(
            tournament=tournament,
            division=division,
            user=self.participant,
            team=team,
            display_name=team.name,
        )

    def _result_ids(self, response):
        return {item.get("id") for item in response.json().get("results", [])}

    def test_anonymous_user_can_view_roster_for_published_tournament(self):
        tournament, division, teams = self._create_context(is_published=True)
        active_player, inactive_player, foreign_player = self._create_players(teams[0], teams[1])

        response = self.client.get(self._team_players_url(tournament, division, teams[0]))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("team_id"), teams[0].id)
        self.assertEqual(response.json().get("count"), 1)

        result_ids = self._result_ids(response)

        self.assertIn(active_player.id, result_ids)
        self.assertNotIn(inactive_player.id, result_ids)
        self.assertNotIn(foreign_player.id, result_ids)

    def test_public_roster_response_contains_basic_player_data(self):
        tournament, division, teams = self._create_context(is_published=True)
        active_player, _inactive_player, _foreign_player = self._create_players(teams[0])

        response = self.client.get(self._team_players_url(tournament, division, teams[0]))

        self.assertEqual(response.status_code, 200)

        players = response.json().get("results", [])

        self.assertEqual(len(players), 1)
        self.assertEqual(players[0].get("id"), active_player.id)
        self.assertEqual(players[0].get("display_name"), "Dawid Kędzierski")
        self.assertEqual(players[0].get("jersey_number"), 10)

    def test_anonymous_user_cannot_view_roster_for_unpublished_tournament(self):
        tournament, division, teams = self._create_context(is_published=False)
        self._create_players(teams[0])

        response = self.client.get(self._team_players_url(tournament, division, teams[0]))

        self.assertEqual(response.status_code, 403)

    def test_registered_participant_can_view_roster_when_preview_is_enabled(self):
        tournament, division, teams = self._create_context(
            is_published=False,
            preview_enabled=True,
        )
        self._register_participant(tournament, division, teams[0])
        self._create_players(teams[0])

        self.client.force_authenticate(user=self.participant)

        response = self.client.get(self._team_players_url(tournament, division, teams[0]))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("team_id"), teams[0].id)
        self.assertEqual(response.json().get("count"), 1)

    def test_registered_participant_cannot_view_roster_when_preview_is_disabled(self):
        tournament, division, teams = self._create_context(
            is_published=False,
            preview_enabled=False,
        )
        self._register_participant(tournament, division, teams[0])
        self._create_players(teams[0])

        self.client.force_authenticate(user=self.participant)

        response = self.client.get(self._team_players_url(tournament, division, teams[0]))

        self.assertEqual(response.status_code, 403)

    def test_other_authenticated_user_cannot_view_private_roster(self):
        tournament, division, teams = self._create_context(is_published=False)
        self._create_players(teams[0])

        self.client.force_authenticate(user=self.other_user)

        response = self.client.get(self._team_players_url(tournament, division, teams[0]))

        self.assertEqual(response.status_code, 403)

    def test_organizer_can_view_roster_even_when_tournament_is_unpublished(self):
        tournament, division, teams = self._create_context(is_published=False)
        self._create_players(teams[0])

        self.client.force_authenticate(user=self.organizer)

        response = self.client.get(self._team_players_url(tournament, division, teams[0]))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("count"), 1)

    def test_roster_endpoint_rejects_individual_division(self):
        tournament, division, teams = self._create_context(
            name="Indywidualny publiczny roster",
            is_published=True,
            competition_type=Tournament.CompetitionType.INDIVIDUAL,
        )

        response = self.client.get(self._team_players_url(tournament, division, teams[0]))

        self.assertEqual(response.status_code, 400)

    def test_technical_bye_team_cannot_have_public_roster(self):
        tournament, division, _teams = self._create_context(is_published=True)

        bye_team = Team.objects.create(
            tournament=tournament,
            division=division,
            name=self.bye_team_name,
            is_active=True,
        )

        response = self.client.get(self._team_players_url(tournament, division, bye_team))

        self.assertEqual(response.status_code, 400)

    def test_public_roster_endpoint_is_limited_to_selected_division(self):
        tournament, first_division, first_teams = self._create_context(is_published=True)

        second_division = Division.objects.create(
            tournament=tournament,
            name="Druga dywizja publiczna",
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            status=Tournament.Status.CONFIGURED,
        )

        second_team = Team.objects.create(
            tournament=tournament,
            division=second_division,
            name="Drużyna z drugiej dywizji",
            is_active=True,
        )

        self._create_players(second_team)

        response = self.client.get(self._team_players_url(tournament, first_division, second_team))

        self.assertEqual(response.status_code, 404)

    def test_public_roster_rejects_inactive_team_slot(self):
        tournament, division, teams = self._create_context(is_published=True)
        teams[0].is_active = False
        teams[0].save(update_fields=["is_active"])

        response = self.client.get(self._team_players_url(tournament, division, teams[0]))

        self.assertEqual(response.status_code, 404)
