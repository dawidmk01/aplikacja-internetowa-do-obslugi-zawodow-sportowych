# backend/tournaments/tests/test_public_access_contract.py
# Plik testuje publiczny dostęp do turnieju, kod dostępu oraz widoczność danych organizacyjnych.

from django.apps import apps
from django.test import TestCase
from rest_framework.test import APIClient

from tournaments.models import Division, Team, Tournament

from .helpers import create_test_user


class TournamentPublicAccessContractTests(TestCase):
    """Testy zabezpieczają kontrakt prywatności i publicznego odczytu turnieju."""

    def setUp(self):
        self.organizer = create_test_user("public-access-owner@example.com")
        self.other_user = create_test_user("public-access-other@example.com")
        self.client = APIClient()

        self.stage_model = apps.get_model("tournaments", "Stage")
        self.match_model = apps.get_model("tournaments", "Match")

        self.tournament = Tournament.objects.create(
            name="Turniej publicznego dostępu",
            discipline=Tournament.Discipline.FOOTBALL,
            organizer=self.organizer,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            status=Tournament.Status.CONFIGURED,
            is_published=False,
            access_code="PUBLIC123",
            join_enabled=True,
            registration_code="JOIN123",
        )

        self.division = Division.objects.create(
            tournament=self.tournament,
            name="Dywizja publiczna",
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
                name=f"Drużyna {index}",
                is_active=True,
            )
            for index in range(1, 3)
        ]

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
            home_team=self.teams[0],
            away_team=self.teams[1],
            round_number=1,
            status=self.match_model.Status.SCHEDULED,
        )

    def _detail_url(self, *, code=None):
        url = f"/api/tournaments/{self.tournament.id}/"
        if code is not None:
            url += f"?code={code}"
        return url

    def _public_matches_url(self, *, code=None):
        url = f"/api/tournaments/{self.tournament.id}/public/matches/?division_id={self.division.id}"
        if code is not None:
            url += f"&code={code}"
        return url

    def _panel_matches_url(self):
        return f"/api/tournaments/{self.tournament.id}/matches/?division_id={self.division.id}"

    def test_unpublished_tournament_detail_is_not_public(self):
        response = self.client.get(self._detail_url())

        self.assertIn(response.status_code, {403, 404})

    def test_unpublished_public_matches_are_not_public(self):
        response = self.client.get(self._public_matches_url())

        self.assertIn(response.status_code, {403, 404})

    def test_organizer_can_view_unpublished_tournament_detail(self):
        self.client.force_authenticate(user=self.organizer)

        response = self.client.get(self._detail_url())

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("id"), self.tournament.id)
        self.assertEqual(response.json().get("access_code"), "PUBLIC123")
        self.assertEqual(response.json().get("join_code"), "JOIN123")

    def test_other_authenticated_user_cannot_view_unpublished_tournament_detail(self):
        self.client.force_authenticate(user=self.other_user)

        response = self.client.get(self._detail_url())

        self.assertIn(response.status_code, {403, 404})

    def test_published_tournament_without_access_code_is_public(self):
        self.tournament.is_published = True
        self.tournament.access_code = ""
        self.tournament.save(update_fields=["is_published", "access_code"])

        response = self.client.get(self._detail_url())

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("id"), self.tournament.id)

    def test_public_detail_does_not_expose_access_or_join_codes(self):
        self.tournament.is_published = True
        self.tournament.access_code = ""
        self.tournament.save(update_fields=["is_published", "access_code"])

        response = self.client.get(self._detail_url())

        self.assertEqual(response.status_code, 200)
        self.assertNotIn("access_code", response.json())
        self.assertNotIn("join_code", response.json())
        self.assertNotIn("registration_code", response.json())

    def test_published_tournament_with_access_code_rejects_missing_code(self):
        self.tournament.is_published = True
        self.tournament.save(update_fields=["is_published"])

        response = self.client.get(self._detail_url())

        self.assertEqual(response.status_code, 403)

    def test_published_tournament_with_access_code_rejects_wrong_code(self):
        self.tournament.is_published = True
        self.tournament.save(update_fields=["is_published"])

        response = self.client.get(self._detail_url(code="WRONG"))

        self.assertEqual(response.status_code, 403)

    def test_published_tournament_with_access_code_accepts_valid_code(self):
        self.tournament.is_published = True
        self.tournament.save(update_fields=["is_published"])

        response = self.client.get(self._detail_url(code="PUBLIC123"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("id"), self.tournament.id)
        self.assertNotIn("access_code", response.json())
        self.assertNotIn("join_code", response.json())

    def test_public_matches_require_valid_access_code_when_configured(self):
        self.tournament.is_published = True
        self.tournament.save(update_fields=["is_published"])

        missing_code_response = self.client.get(self._public_matches_url())
        wrong_code_response = self.client.get(self._public_matches_url(code="WRONG"))
        valid_code_response = self.client.get(self._public_matches_url(code="PUBLIC123"))

        self.assertEqual(missing_code_response.status_code, 403)
        self.assertEqual(wrong_code_response.status_code, 403)
        self.assertEqual(valid_code_response.status_code, 200)

    def test_public_matches_return_only_selected_division_matches(self):
        self.tournament.is_published = True
        self.tournament.access_code = ""
        self.tournament.save(update_fields=["is_published", "access_code"])

        second_division = Division.objects.create(
            tournament=self.tournament,
            name="Druga dywizja",
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            status=Tournament.Status.CONFIGURED,
        )
        second_stage = self.stage_model.objects.create(
            tournament=self.tournament,
            division=second_division,
            stage_type=self.stage_model.StageType.LEAGUE,
            order=1,
            status=self.stage_model.Status.OPEN,
        )
        second_teams = [
            Team.objects.create(
                tournament=self.tournament,
                division=second_division,
                name=f"Druga {index}",
                is_active=True,
            )
            for index in range(1, 3)
        ]
        second_match = self.match_model.objects.create(
            tournament=self.tournament,
            stage=second_stage,
            home_team=second_teams[0],
            away_team=second_teams[1],
            round_number=1,
            status=self.match_model.Status.SCHEDULED,
        )

        response = self.client.get(self._public_matches_url())

        self.assertEqual(response.status_code, 200)

        data = response.json()
        items = data if isinstance(data, list) else data.get("results", [])
        match_ids = {item.get("id") for item in items}

        self.assertIn(self.match.id, match_ids)
        self.assertNotIn(second_match.id, match_ids)

    def test_panel_matches_remain_private_for_non_member_even_when_public_matches_work(self):
        self.tournament.is_published = True
        self.tournament.access_code = ""
        self.tournament.save(update_fields=["is_published", "access_code"])

        self.client.force_authenticate(user=self.other_user)

        panel_response = self.client.get(self._panel_matches_url())
        public_response = self.client.get(self._public_matches_url())

        self.assertEqual(panel_response.status_code, 200)
        self.assertEqual(panel_response.json(), [])
        self.assertEqual(public_response.status_code, 200)
