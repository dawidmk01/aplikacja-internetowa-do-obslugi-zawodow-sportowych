# backend/tournaments/tests/test_archive_extended_mutation_guards.py
# Plik testuje blokowanie dodatkowych mutacji danych po archiwizacji turnieju.

from django.test import TestCase
from rest_framework.test import APIClient

from tournaments.models import Division, Match, Stage, Team, TeamPlayer, Tournament

from .helpers import create_test_user


class TournamentArchivedExtendedMutationGuardTests(TestCase):
    """Testy zabezpieczają mniej oczywiste endpointy zapisu w zarchiwizowanym turnieju."""

    def setUp(self):
        self.organizer = create_test_user("archive-extended-owner@example.com")
        self.participant = create_test_user("archive-extended-participant@example.com")
        self.client = APIClient()

        self.tournament = Tournament.objects.create(
            name="Turniej archiwalny - rozszerzony",
            discipline=Tournament.Discipline.FOOTBALL,
            organizer=self.organizer,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            entry_mode=Tournament.EntryMode.MANAGER,
            join_enabled=True,
            participants_self_rename_enabled=True,
            registration_code="ARCHIVE123",
            status=Tournament.Status.CONFIGURED,
            is_archived=True,
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

        self.home_team = Team.objects.create(
            tournament=self.tournament,
            division=self.division,
            name="Dawid Kędzierski Team",
            registered_user=self.participant,
        )
        self.away_team = Team.objects.create(
            tournament=self.tournament,
            division=self.division,
            name="Rywal",
        )

        self.stage = Stage.objects.create(
            tournament=self.tournament,
            division=self.division,
            stage_type=Stage.StageType.LEAGUE,
            order=1,
            status=Stage.Status.OPEN,
        )

        self.match = Match.objects.create(
            tournament=self.tournament,
            stage=self.stage,
            home_team=self.home_team,
            away_team=self.away_team,
            status=Match.Status.SCHEDULED,
        )

    def _assert_rejected(self, response):
        self.assertIn(response.status_code, {400, 403, 409})

    def test_archived_tournament_rejects_roster_update_by_organizer(self):
        self.client.force_authenticate(user=self.organizer)

        response = self.client.put(
            f"/api/tournaments/{self.tournament.id}/teams/{self.home_team.id}/players/?division_id={self.division.id}",
            {
                "players": [
                    {
                        "display_name": "Dawid Kędzierski",
                        "jersey_number": 10,
                    }
                ]
            },
            format="json",
        )

        self._assert_rejected(response)
        self.assertFalse(TeamPlayer.objects.filter(team=self.home_team, is_active=True).exists())

    def test_archived_tournament_rejects_own_roster_update_by_participant(self):
        self.client.force_authenticate(user=self.participant)

        response = self.client.put(
            f"/api/tournaments/{self.tournament.id}/my-team/players/?division_id={self.division.id}",
            {
                "players": [
                    {
                        "display_name": "Dawid Kędzierski",
                        "jersey_number": 7,
                    }
                ]
            },
            format="json",
        )

        self._assert_rejected(response)
        self.assertFalse(TeamPlayer.objects.filter(team=self.home_team, is_active=True).exists())

    def test_archived_tournament_rejects_team_name_change_request(self):
        self.client.force_authenticate(user=self.participant)

        response = self.client.post(
            f"/api/tournaments/{self.tournament.id}/teams/{self.home_team.id}/name-change-requests/",
            {"requested_name": "Nowa nazwa uczestnika"},
            format="json",
        )

        self._assert_rejected(response)
        self.assertFalse(self.tournament.name_change_requests.exists())

    def test_archived_tournament_rejects_set_scheduled(self):
        self.client.force_authenticate(user=self.organizer)

        self.match.status = Match.Status.FINISHED
        self.match.save(update_fields=["status"])

        response = self.client.post(
            f"/api/matches/{self.match.id}/set-scheduled/",
            {},
            format="json",
        )

        self._assert_rejected(response)

        self.match.refresh_from_db()
        self.assertEqual(self.match.status, Match.Status.FINISHED)
