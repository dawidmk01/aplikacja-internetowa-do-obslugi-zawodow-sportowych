# backend/tournaments/tests/test_incidents_commentary.py
# Plik zabezpiecza incydenty meczowe, komentarz live oraz słownik fraz komentarza.

from .helpers import *


class TournamentIncidentAndCommentaryApiTests(TestCase):
    """Testy API zabezpieczają incydenty meczowe, komentarz live oraz słownik fraz komentarza."""

    def setUp(self):
        self.organizer = create_test_user("live-owner@example.com")
        self.other_user = create_test_user("live-other@example.com")
        self.client = APIClient()

    def _stage_model(self):
        return apps.get_model("tournaments", "Stage")

    def _match_model(self):
        return apps.get_model("tournaments", "Match")

    def _incident_model(self):
        return apps.get_model("tournaments", "MatchIncident")

    def _commentary_model(self):
        return apps.get_model("tournaments", "MatchCommentaryEntry")

    def _phrase_model(self):
        return apps.get_model("tournaments", "TournamentCommentaryPhrase")

    def _create_context(
        self,
        *,
        name="Turniej live",
        discipline=Tournament.Discipline.FOOTBALL,
        published=False,
    ):
        stage_model = self._stage_model()
        match_model = self._match_model()

        tournament = Tournament.objects.create(
            name=name,
            discipline=discipline,
            organizer=self.organizer,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            is_published=published,
        )

        division = Division.objects.create(
            tournament=tournament,
            name="Dywizja live",
            is_default=True,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            status=Tournament.Status.CONFIGURED,
        )

        stage = stage_model.objects.create(
            tournament=tournament,
            division=division,
            stage_type=stage_model.StageType.LEAGUE,
            order=1,
        )

        teams = [
            Team.objects.create(
                tournament=tournament,
                division=division,
                name=f"Drużyna live {index}",
                is_active=True,
            )
            for index in range(1, 3)
        ]

        match = match_model.objects.create(
            tournament=tournament,
            stage=stage,
            home_team=teams[0],
            away_team=teams[1],
            round_number=1,
            status=match_model.Status.SCHEDULED,
        )

        return tournament, division, stage, teams, match

    def _create_commentary_entry(self, match, *, text="Pierwszy komentarz", period=None):
        commentary_model = self._commentary_model()
        period = period or self._match_model().ClockPeriod.NONE

        return commentary_model.objects.create(
            match=match,
            period=period,
            time_source=commentary_model.TimeSource.MANUAL,
            minute=10,
            minute_raw="10",
            text=text,
            created_by=self.organizer,
        )

    def _create_phrase(self, tournament, *, text="atak", kind=None):
        phrase_model = self._phrase_model()
        kind = kind or phrase_model.Kind.TOKEN

        return phrase_model.objects.create(
            tournament=tournament,
            kind=kind,
            category="akcja",
            text=text,
            order=1,
            is_active=True,
            created_by=self.organizer,
        )

    def test_organizer_can_create_manual_goal_incident_and_score_is_recomputed(self):
        _tournament, _division, _stage, teams, match = self._create_context()

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            f"/api/matches/{match.id}/incidents/",
            {
                "team_id": teams[0].id,
                "kind": "GOAL",
                "time_source": "MANUAL",
                "minute": 12,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json().get("team_id"), teams[0].id)
        self.assertEqual(response.json().get("kind"), "GOAL")
        self.assertEqual(response.json().get("minute"), 12)

        match.refresh_from_db()

        self.assertEqual(match.home_score, 1)
        self.assertEqual(match.away_score, 0)

    def test_other_user_cannot_create_incident(self):
        _tournament, _division, _stage, teams, match = self._create_context()

        self.client.force_authenticate(user=self.other_user)

        response = self.client.post(
            f"/api/matches/{match.id}/incidents/",
            {
                "team_id": teams[0].id,
                "kind": "GOAL",
                "time_source": "MANUAL",
                "minute": 10,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertFalse(self._incident_model().objects.filter(match=match).exists())

    def test_incident_rejects_team_outside_match(self):
        tournament, division, _stage, _teams, match = self._create_context()

        foreign_team = Team.objects.create(
            tournament=tournament,
            division=division,
            name="Drużyna spoza meczu",
            is_active=True,
        )

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            f"/api/matches/{match.id}/incidents/",
            {
                "team_id": foreign_team.id,
                "kind": "GOAL",
                "time_source": "MANUAL",
                "minute": 10,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(self._incident_model().objects.filter(match=match, team=foreign_team).exists())

    def test_basketball_goal_uses_points_meta_when_recomputing_score(self):
        _tournament, _division, _stage, teams, match = self._create_context(
            name="Turniej live koszykówki",
            discipline=Tournament.Discipline.BASKETBALL,
        )

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            f"/api/matches/{match.id}/incidents/",
            {
                "team_id": teams[0].id,
                "kind": "GOAL",
                "time_source": "MANUAL",
                "minute": 4,
                "points": 3,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)

        match.refresh_from_db()

        self.assertEqual(match.home_score, 3)
        self.assertEqual(match.away_score, 0)

    def test_extra_time_goal_updates_extra_time_score_and_flag(self):
        _tournament, _division, _stage, teams, match = self._create_context()

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            f"/api/matches/{match.id}/incidents/",
            {
                "team_id": teams[0].id,
                "kind": "GOAL",
                "time_source": "MANUAL",
                "minute": 93,
                "scope": "EXTRA_TIME",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)

        match.refresh_from_db()

        self.assertEqual(match.home_score, 0)
        self.assertEqual(match.away_score, 0)
        self.assertEqual(match.home_extra_time_score, 1)
        self.assertEqual(int(match.away_extra_time_score or 0), 0)
        self.assertTrue(match.went_to_extra_time)

    def test_delete_goal_incident_recomputes_score(self):
        _tournament, _division, _stage, teams, match = self._create_context()

        self.client.force_authenticate(user=self.organizer)

        first_response = self.client.post(
            f"/api/matches/{match.id}/incidents/",
            {
                "team_id": teams[0].id,
                "kind": "GOAL",
                "time_source": "MANUAL",
                "minute": 10,
            },
            format="json",
        )
        self.assertEqual(first_response.status_code, 201)

        second_response = self.client.post(
            f"/api/matches/{match.id}/incidents/",
            {
                "team_id": teams[0].id,
                "kind": "GOAL",
                "time_source": "MANUAL",
                "minute": 20,
            },
            format="json",
        )
        self.assertEqual(second_response.status_code, 201)

        match.refresh_from_db()
        self.assertEqual(match.home_score, 2)

        delete_response = self.client.delete(f"/api/incidents/{first_response.json()['id']}/")

        self.assertEqual(delete_response.status_code, 204)

        match.refresh_from_db()
        self.assertEqual(match.home_score, 1)

    def test_timeout_incident_pauses_running_basketball_clock(self):
        from django.utils import timezone

        _tournament, _division, _stage, teams, match = self._create_context(
            name="Turniej live timeout",
            discipline=Tournament.Discipline.BASKETBALL,
        )

        match.clock_state = self._match_model().ClockState.RUNNING
        match.clock_started_at = timezone.now()
        match.clock_elapsed_seconds = 10
        match.save(update_fields=["clock_state", "clock_started_at", "clock_elapsed_seconds"])

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            f"/api/matches/{match.id}/incidents/",
            {
                "team_id": teams[0].id,
                "kind": "TIMEOUT",
                "time_source": "MANUAL",
                "minute": 2,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)

        match.refresh_from_db()

        self.assertEqual(match.clock_state, self._match_model().ClockState.PAUSED)
        self.assertIsNone(match.clock_started_at)
        self.assertGreaterEqual(match.clock_elapsed_seconds, 10)

    def test_wrestling_scoring_incident_recomputes_score(self):
        _tournament, _division, _stage, teams, match = self._create_context(
            name="Turniej live zapasy",
            discipline=Tournament.Discipline.WRESTLING,
        )

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            f"/api/matches/{match.id}/incidents/",
            {
                "team_id": teams[0].id,
                "kind": "WRESTLING_POINT_4",
                "time_source": "MANUAL",
                "minute": 1,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)

        match.refresh_from_db()

        self.assertEqual(match.home_score, 4)
        self.assertEqual(match.away_score, 0)

    def test_organizer_can_patch_incident_note_and_minute(self):
        _tournament, _division, _stage, teams, match = self._create_context()

        self.client.force_authenticate(user=self.organizer)

        create_response = self.client.post(
            f"/api/matches/{match.id}/incidents/",
            {
                "team_id": teams[0].id,
                "kind": "FOUL",
                "time_source": "MANUAL",
                "minute": 8,
            },
            format="json",
        )
        self.assertEqual(create_response.status_code, 201)

        response = self.client.patch(
            f"/api/incidents/{create_response.json()['id']}/",
            {
                "minute": 18,
                "note": "Faul taktyczny",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("minute"), 18)
        self.assertEqual(response.json().get("meta", {}).get("note"), "Faul taktyczny")

    def test_recompute_score_endpoint_returns_incident_totals(self):
        _tournament, _division, _stage, teams, match = self._create_context()

        self.client.force_authenticate(user=self.organizer)

        for team, minute in ((teams[0], 10), (teams[1], 22)):
            response = self.client.post(
                f"/api/matches/{match.id}/incidents/",
                {
                    "team_id": team.id,
                    "kind": "GOAL",
                    "time_source": "MANUAL",
                    "minute": minute,
                },
                format="json",
            )
            self.assertEqual(response.status_code, 201)

        match.home_score = 0
        match.away_score = 0
        match.save(update_fields=["home_score", "away_score"])

        response = self.client.post(f"/api/matches/{match.id}/incidents/recompute-score/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("home_score"), 1)
        self.assertEqual(response.json().get("away_score"), 1)
        self.assertEqual(response.json().get("incidents_regular_home"), 1)
        self.assertEqual(response.json().get("incidents_regular_away"), 1)

    def test_organizer_can_create_manual_commentary_entry(self):
        _tournament, _division, _stage, _teams, match = self._create_context()

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            f"/api/matches/{match.id}/commentary/",
            {
                "text": "Groźna akcja gospodarzy.",
                "time_source": "MANUAL",
                "minute": 15,
                "minute_raw": "15",
                "period": "FH",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json().get("text"), "Groźna akcja gospodarzy.")
        self.assertEqual(response.json().get("period"), "FH")
        self.assertEqual(response.json().get("division_id"), getattr(match.stage, "division_id", None))

    def test_other_user_cannot_create_commentary_entry(self):
        _tournament, _division, _stage, _teams, match = self._create_context()

        self.client.force_authenticate(user=self.other_user)

        response = self.client.post(
            f"/api/matches/{match.id}/commentary/",
            {
                "text": "Niedozwolony komentarz.",
                "time_source": "MANUAL",
                "minute": 1,
                "period": "FH",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertFalse(self._commentary_model().objects.filter(match=match).exists())

    def test_commentary_rejects_invalid_period_for_football(self):
        _tournament, _division, _stage, _teams, match = self._create_context()

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            f"/api/matches/{match.id}/commentary/",
            {
                "text": "Błędna kwarta dla piłki nożnej.",
                "time_source": "MANUAL",
                "minute": 1,
                "period": "Q1",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(self._commentary_model().objects.filter(match=match).exists())

    def test_public_commentary_get_rejects_unpublished_tournament(self):
        _tournament, _division, _stage, _teams, match = self._create_context()
        self._create_commentary_entry(match)

        response = self.client.get(f"/api/matches/{match.id}/commentary/")

        self.assertIn(response.status_code, {403, 404})

    def test_public_commentary_get_returns_entries_for_published_tournament(self):
        _tournament, _division, _stage, _teams, match = self._create_context(published=True)
        entry = self._create_commentary_entry(match, text="Komentarz publiczny")

        response = self.client.get(f"/api/matches/{match.id}/commentary/")

        self.assertEqual(response.status_code, 200)

        items = response.json()

        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].get("id"), entry.id)
        self.assertEqual(items[0].get("text"), "Komentarz publiczny")

    def test_organizer_can_patch_commentary_text_and_period(self):
        _tournament, _division, _stage, _teams, match = self._create_context()
        entry = self._create_commentary_entry(match)

        self.client.force_authenticate(user=self.organizer)

        response = self.client.patch(
            f"/api/commentary/{entry.id}/",
            {
                "text": "Zmieniony komentarz.",
                "period": "SH",
                "minute": 60,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("text"), "Zmieniony komentarz.")
        self.assertEqual(response.json().get("period"), "SH")
        self.assertEqual(response.json().get("minute"), 60)

    def test_organizer_can_delete_commentary_entry(self):
        _tournament, _division, _stage, _teams, match = self._create_context()
        entry = self._create_commentary_entry(match)

        self.client.force_authenticate(user=self.organizer)

        response = self.client.delete(f"/api/commentary/{entry.id}/")

        self.assertEqual(response.status_code, 200)
        self.assertFalse(self._commentary_model().objects.filter(id=entry.id).exists())

    def test_organizer_can_create_commentary_phrase(self):
        tournament, _division, _stage, _teams, _match = self._create_context()
        phrase_model = self._phrase_model()

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            f"/api/tournaments/{tournament.id}/commentary-phrases/",
            {
                "kind": phrase_model.Kind.TOKEN,
                "category": "atak",
                "text": "strzał",
                "order": 2,
                "is_active": True,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json().get("text"), "strzał")
        self.assertEqual(response.json().get("category"), "atak")
        self.assertTrue(response.json().get("is_active"))

    def test_commentary_phrase_rejects_empty_text(self):
        tournament, _division, _stage, _teams, _match = self._create_context()
        phrase_model = self._phrase_model()

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            f"/api/tournaments/{tournament.id}/commentary-phrases/",
            {
                "kind": phrase_model.Kind.TOKEN,
                "text": "   ",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(phrase_model.objects.filter(tournament=tournament).exists())

    def test_other_user_cannot_list_commentary_phrases(self):
        tournament, _division, _stage, _teams, _match = self._create_context()
        self._create_phrase(tournament)

        self.client.force_authenticate(user=self.other_user)

        response = self.client.get(f"/api/tournaments/{tournament.id}/commentary-phrases/")

        self.assertEqual(response.status_code, 403)

    def test_organizer_can_update_and_delete_commentary_phrase(self):
        tournament, _division, _stage, _teams, _match = self._create_context()
        phrase = self._create_phrase(tournament, text="atak")

        self.client.force_authenticate(user=self.organizer)

        patch_response = self.client.patch(
            f"/api/commentary-phrases/{phrase.id}/",
            {
                "text": "szybki atak",
                "category": "ofensywa",
                "order": 5,
                "is_active": False,
            },
            format="json",
        )

        self.assertEqual(patch_response.status_code, 200)
        self.assertEqual(patch_response.json().get("text"), "szybki atak")
        self.assertEqual(patch_response.json().get("category"), "ofensywa")
        self.assertEqual(patch_response.json().get("order"), 5)
        self.assertFalse(patch_response.json().get("is_active"))

        delete_response = self.client.delete(f"/api/commentary-phrases/{phrase.id}/")

        self.assertEqual(delete_response.status_code, 200)
        self.assertFalse(self._phrase_model().objects.filter(id=phrase.id).exists())
