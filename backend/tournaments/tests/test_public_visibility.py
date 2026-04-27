# backend/tournaments/tests/test_public_visibility.py
# Plik testuje publiczną widoczność turnieju, kod dostępu oraz podgląd dla uczestników.

from django.apps import apps
from django.test import TestCase
from rest_framework.test import APIClient

from tournaments.models import Division, Team, Tournament

from .helpers import create_test_user


class TournamentPublicVisibilityTests(TestCase):
    """Testy zabezpieczają reguły widoczności publicznej i uczestniczącej turnieju."""

    def setUp(self):
        self.organizer = create_test_user("public-owner@example.com")
        self.participant = create_test_user("public-participant@example.com")
        self.other_user = create_test_user("public-other@example.com")
        self.client = APIClient()

        self.stage_model = apps.get_model("tournaments", "Stage")
        self.match_model = apps.get_model("tournaments", "Match")
        self.registration_model = apps.get_model("tournaments", "TournamentRegistration")

    def _create_context(self, *, is_published=False, access_code="", participants_preview=False):
        tournament = Tournament.objects.create(
            name="Turniej widoczności publicznej",
            discipline=Tournament.Discipline.FOOTBALL,
            organizer=self.organizer,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            is_published=is_published,
            access_code=access_code,
            participants_public_preview_enabled=participants_preview,
            status=Tournament.Status.CONFIGURED,
        )

        division = Division.objects.create(
            tournament=tournament,
            name="Dywizja publiczna",
            is_default=True,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            status=Tournament.Status.CONFIGURED,
        )

        stage = self.stage_model.objects.create(
            tournament=tournament,
            division=division,
            stage_type=self.stage_model.StageType.LEAGUE,
            order=1,
        )

        teams = [
            Team.objects.create(
                tournament=tournament,
                division=division,
                name=f"Drużyna publiczna {index}",
                is_active=True,
            )
            for index in range(1, 3)
        ]

        match = self.match_model.objects.create(
            tournament=tournament,
            stage=stage,
            home_team=teams[0],
            away_team=teams[1],
            round_number=1,
            status=self.match_model.Status.SCHEDULED,
        )

        return tournament, division, stage, teams, match

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

    def test_anonymous_user_cannot_open_unpublished_tournament_detail(self):
        tournament, _division, _stage, _teams, _match = self._create_context(is_published=False)

        response = self.client.get(f"/api/tournaments/{tournament.id}/")

        self.assertEqual(response.status_code, 403)

    def test_anonymous_user_can_open_published_tournament_detail_without_access_code(self):
        tournament, _division, _stage, _teams, _match = self._create_context(is_published=True)

        response = self.client.get(f"/api/tournaments/{tournament.id}/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("id"), tournament.id)
        self.assertEqual(response.json().get("name"), "Turniej widoczności publicznej")

    def test_published_tournament_with_access_code_rejects_missing_code(self):
        tournament, _division, _stage, _teams, _match = self._create_context(
            is_published=True,
            access_code="ABC123",
        )

        response = self.client.get(f"/api/tournaments/{tournament.id}/")

        self.assertEqual(response.status_code, 403)

    def test_published_tournament_with_access_code_rejects_wrong_code(self):
        tournament, _division, _stage, _teams, _match = self._create_context(
            is_published=True,
            access_code="ABC123",
        )

        response = self.client.get(f"/api/tournaments/{tournament.id}/?code=WRONG")

        self.assertEqual(response.status_code, 403)

    def test_published_tournament_with_access_code_accepts_correct_code(self):
        tournament, _division, _stage, _teams, _match = self._create_context(
            is_published=True,
            access_code="ABC123",
        )

        response = self.client.get(f"/api/tournaments/{tournament.id}/?code=ABC123")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("id"), tournament.id)

    def test_public_match_list_rejects_unpublished_tournament(self):
        tournament, division, _stage, _teams, _match = self._create_context(is_published=False)

        response = self.client.get(
            f"/api/tournaments/{tournament.id}/public/matches/?division_id={division.id}"
        )

        self.assertIn(response.status_code, {403, 404})

    def test_public_match_list_returns_matches_for_published_tournament(self):
        tournament, division, _stage, _teams, match = self._create_context(is_published=True)

        response = self.client.get(
            f"/api/tournaments/{tournament.id}/public/matches/?division_id={division.id}"
        )

        self.assertEqual(response.status_code, 200)

        data = response.json()
        items = data if isinstance(data, list) else data.get("results", [])

        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].get("id"), match.id)
        self.assertEqual(items[0].get("division_id"), division.id)

    def test_public_standings_reject_unpublished_tournament(self):
        tournament, division, _stage, _teams, _match = self._create_context(is_published=False)

        response = self.client.get(
            f"/api/tournaments/{tournament.id}/public/standings/?division_id={division.id}"
        )

        self.assertIn(response.status_code, {403, 404})

    def test_public_standings_return_rows_for_published_tournament(self):
        tournament, division, _stage, teams, _match = self._create_context(is_published=True)

        response = self.client.get(
            f"/api/tournaments/{tournament.id}/public/standings/?division_id={division.id}"
        )

        self.assertEqual(response.status_code, 200)

        serialized = str(response.json())
        self.assertIn(str(teams[0].id), serialized)
        self.assertIn(str(teams[1].id), serialized)

    def test_registered_participant_can_preview_unpublished_tournament_when_preview_is_enabled(self):
        tournament, division, _stage, teams, _match = self._create_context(
            is_published=False,
            participants_preview=True,
        )
        self._register_participant(tournament, division, teams[0])

        self.client.force_authenticate(user=self.participant)

        response = self.client.get(f"/api/tournaments/{tournament.id}/?division_id={division.id}")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("my_role"), "PARTICIPANT")

    def test_registered_participant_cannot_preview_unpublished_tournament_when_preview_is_disabled(self):
        tournament, division, _stage, teams, _match = self._create_context(
            is_published=False,
            participants_preview=False,
        )
        self._register_participant(tournament, division, teams[0])

        self.client.force_authenticate(user=self.participant)

        response = self.client.get(f"/api/tournaments/{tournament.id}/?division_id={division.id}")

        self.assertEqual(response.status_code, 403)

    def test_public_detail_does_not_expose_access_code_to_anonymous_user(self):
        tournament, _division, _stage, _teams, _match = self._create_context(
            is_published=True,
            access_code="ABC123",
        )

        response = self.client.get(f"/api/tournaments/{tournament.id}/?code=ABC123")

        self.assertEqual(response.status_code, 200)
        self.assertNotIn("access_code", response.json())
        self.assertNotIn("join_code", response.json())
