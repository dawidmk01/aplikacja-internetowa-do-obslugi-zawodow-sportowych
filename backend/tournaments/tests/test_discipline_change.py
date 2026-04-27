# backend/tournaments/tests/test_discipline_change.py
# Plik testuje zmianę dyscypliny turnieju oraz reset zależnej struktury rozgrywek.

from django.apps import apps
from django.test import TestCase
from rest_framework.test import APIClient

from tournaments.models import Division, Team, Tournament
from tournaments.services.match_generation import ensure_matches_generated

from .helpers import create_test_user


class TournamentDisciplineChangeApiTests(TestCase):
    """Testy zabezpieczają dedykowany endpoint zmiany dyscypliny i czyszczenie danych zależnych."""

    def setUp(self):
        self.organizer = create_test_user("discipline-change-owner@example.com")
        self.assistant = create_test_user("discipline-change-assistant@example.com")
        self.other_user = create_test_user("discipline-change-other@example.com")
        self.client = APIClient()

        self.stage_model = apps.get_model("tournaments", "Stage")
        self.match_model = apps.get_model("tournaments", "Match")
        self.membership_model = apps.get_model("tournaments", "TournamentMembership")

        self.tournament = Tournament.objects.create(
            name="Turniej zmiany dyscypliny",
            discipline=Tournament.Discipline.FOOTBALL,
            organizer=self.organizer,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            status=Tournament.Status.CONFIGURED,
            entry_mode=Tournament.EntryMode.MANAGER,
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

        self.default_teams = self._create_teams(self.default_division, "Główna", 4)
        self.second_teams = self._create_teams(self.second_division, "Druga", 4)

        ensure_matches_generated(self.tournament, division=self.default_division)
        ensure_matches_generated(self.tournament, division=self.second_division)

    def _create_teams(self, division, prefix, count):
        return [
            Team.objects.create(
                tournament=self.tournament,
                division=division,
                name=f"{prefix} {index}",
                is_active=True,
            )
            for index in range(1, count + 1)
        ]

    def _url(self):
        return f"/api/tournaments/{self.tournament.id}/change-discipline/"

    def _stage_ids_for_tournament(self):
        return set(
            self.stage_model.objects.filter(
                tournament=self.tournament,
            ).values_list("id", flat=True)
        )

    def _match_ids_for_tournament(self):
        return set(
            self.match_model.objects.filter(
                tournament=self.tournament,
            ).values_list("id", flat=True)
        )

    def _create_assistant_membership(self, *, tournament_edit=True):
        return self.membership_model.objects.create(
            tournament=self.tournament,
            user=self.assistant,
            role=self.membership_model.Role.ASSISTANT,
            status=self.membership_model.Status.ACCEPTED,
            permissions={
                self.membership_model.PERM_TOURNAMENT_EDIT: tournament_edit,
            },
            invited_by=self.organizer,
        )

    def test_organizer_can_change_discipline_and_clear_generated_structure(self):
        old_stage_ids = self._stage_ids_for_tournament()
        old_match_ids = self._match_ids_for_tournament()

        self.assertTrue(old_stage_ids)
        self.assertTrue(old_match_ids)

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            self._url(),
            {
                "discipline": Tournament.Discipline.TENNIS,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        self.tournament.refresh_from_db()
        self.default_division.refresh_from_db()
        self.second_division.refresh_from_db()

        self.assertEqual(self.tournament.discipline, Tournament.Discipline.TENNIS)
        self.assertIsNone(self.tournament.custom_discipline_name)

        self.assertFalse(self._stage_ids_for_tournament())
        self.assertFalse(self._match_ids_for_tournament())

    def test_change_discipline_to_custom_requires_custom_name(self):
        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            self._url(),
            {
                "discipline": Tournament.Discipline.CUSTOM,
                "custom_discipline_name": "",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)

        self.tournament.refresh_from_db()

        self.assertEqual(self.tournament.discipline, Tournament.Discipline.FOOTBALL)

    def test_organizer_can_change_to_custom_discipline_with_name(self):
        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            self._url(),
            {
                "discipline": Tournament.Discipline.CUSTOM,
                "custom_discipline_name": "Dart",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        self.tournament.refresh_from_db()

        self.assertEqual(self.tournament.discipline, Tournament.Discipline.CUSTOM)
        self.assertEqual(self.tournament.custom_discipline_name, "Dart")

    def test_change_discipline_rejects_invalid_discipline(self):
        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            self._url(),
            {
                "discipline": "INVALID_DISCIPLINE",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)

        self.tournament.refresh_from_db()

        self.assertEqual(self.tournament.discipline, Tournament.Discipline.FOOTBALL)

    def test_assistant_cannot_change_discipline_even_with_tournament_edit(self):
        self._create_assistant_membership(tournament_edit=True)
        self.client.force_authenticate(user=self.assistant)

        response = self.client.post(
            self._url(),
            {
                "discipline": Tournament.Discipline.TENNIS,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 403)

        self.tournament.refresh_from_db()

        self.assertEqual(self.tournament.discipline, Tournament.Discipline.FOOTBALL)
        self.assertTrue(self._stage_ids_for_tournament())
        self.assertTrue(self._match_ids_for_tournament())

    def test_other_user_cannot_change_discipline(self):
        self.client.force_authenticate(user=self.other_user)

        response = self.client.post(
            self._url(),
            {
                "discipline": Tournament.Discipline.TENNIS,
            },
            format="json",
        )

        self.assertIn(response.status_code, {403, 404})

        self.tournament.refresh_from_db()

        self.assertEqual(self.tournament.discipline, Tournament.Discipline.FOOTBALL)

    def test_unauthenticated_user_cannot_change_discipline(self):
        response = self.client.post(
            self._url(),
            {
                "discipline": Tournament.Discipline.TENNIS,
            },
            format="json",
        )

        self.assertIn(response.status_code, {401, 403})

        self.tournament.refresh_from_db()

        self.assertEqual(self.tournament.discipline, Tournament.Discipline.FOOTBALL)
