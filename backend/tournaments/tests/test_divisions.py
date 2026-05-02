# backend/tournaments/tests/test_divisions.py
# Plik zabezpiecza tworzenie, konfigurację, wybór i archiwizację dywizji turniejowych.

from .helpers import *


class TournamentDivisionBootstrapTests(TestCase):
    """Testy zabezpieczają automatyczne utworzenie domyślnej dywizji podczas tworzenia turnieju."""

    def setUp(self):
        self.organizer = create_test_user("division-bootstrap@example.com")
        self.client = APIClient()
        self.client.force_authenticate(user=self.organizer)

    def test_create_tournament_creates_default_division(self):
        response = self.client.post(
            "/api/tournaments/",
            {
                "name": "Turniej z dywizją domyślną",
                "discipline": "football",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)

        tournament = Tournament.objects.get(name="Turniej z dywizją domyślną")
        division = tournament.get_default_division()

        self.assertIsNotNone(division)
        self.assertTrue(division.is_default)
        self.assertEqual(division.name, "Dywizja główna")
        self.assertEqual(division.status, Tournament.Status.CONFIGURED)

    def test_default_division_mirrors_tournament_competition_configuration(self):
        response = self.client.post(
            "/api/tournaments/",
            {
                "name": "Turniej z konfiguracją dywizji",
                "discipline": "football",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)

        tournament = Tournament.objects.get(name="Turniej z konfiguracją dywizji")
        division = tournament.get_default_division()

        self.assertEqual(division.competition_type, tournament.competition_type)
        self.assertEqual(division.competition_model, tournament.competition_model)
        self.assertEqual(division.tournament_format, tournament.tournament_format)
        self.assertEqual(division.result_mode, tournament.result_mode)
        self.assertEqual(division.format_config, tournament.format_config)
        self.assertEqual(division.result_config, tournament.result_config)

    def test_create_team_tournament_creates_two_default_team_slots(self):
        response = self.client.post(
            "/api/tournaments/",
            {
                "name": "Turniej drużynowy z uczestnikami",
                "discipline": "football",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)

        tournament = Tournament.objects.get(name="Turniej drużynowy z uczestnikami")
        division = tournament.get_default_division()
        teams = list(Team.objects.filter(tournament=tournament, division=division).order_by("id"))

        self.assertEqual(len(teams), 2)
        self.assertEqual([team.name for team in teams], ["Drużyna 1", "Drużyna 2"])
        self.assertTrue(all(team.is_active for team in teams))

    def test_create_individual_tournament_creates_two_default_participant_slots(self):
        response = self.client.post(
            "/api/tournaments/",
            {
                "name": "Turniej indywidualny z uczestnikami",
                "discipline": "tennis",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)

        tournament = Tournament.objects.get(name="Turniej indywidualny z uczestnikami")
        division = tournament.get_default_division()
        teams = list(Team.objects.filter(tournament=tournament, division=division).order_by("id"))

        self.assertEqual(tournament.competition_type, Tournament.CompetitionType.INDIVIDUAL)
        self.assertEqual(division.competition_type, Tournament.CompetitionType.INDIVIDUAL)
        self.assertEqual(len(teams), 2)
        self.assertEqual([team.name for team in teams], ["Zawodnik 1", "Zawodnik 2"])

    def test_division_slug_is_generated_from_name(self):
        tournament = Tournament.objects.create(
            name="Turniej slugów",
            discipline="football",
            organizer=self.organizer,
        )

        division = Division.objects.create(
            tournament=tournament,
            name="Juniorzy Starsi",
            is_default=True,
        )

        self.assertEqual(division.slug, "juniorzy-starsi")

    def test_second_division_receives_unique_slug_for_repeated_slug(self):
        tournament = Tournament.objects.create(
            name="Turniej powtarzalnych slugów dywizji",
            discipline="football",
            organizer=self.organizer,
        )
        Division.objects.create(
            tournament=tournament,
            name="Kategoria Open",
            is_default=True,
        )

        division = Division.objects.create(
            tournament=tournament,
            name="Kategoria  Open",
        )

        self.assertEqual(division.slug, "kategoria-open-2")


class TournamentDivisionApiTests(TestCase):
    """Testy API zabezpieczają zarządzanie dywizjami w obrębie turnieju organizatora."""

    def setUp(self):
        self.organizer = create_test_user("division-api-owner@example.com")
        self.other_user = create_test_user("division-api-other@example.com")
        self.client = APIClient()

    def _create_tournament_via_api(self, name="Turniej dywizji API", discipline="football"):
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
        return Tournament.objects.get(name=name)

    def _response_items(self, response):
        data = response.json()

        if isinstance(data, list):
            return data

        if isinstance(data, dict) and isinstance(data.get("results"), list):
            return data["results"]

        return []

    def test_organizer_receives_divisions_in_tournament_detail(self):
        tournament = self._create_tournament_via_api()
        default_division = tournament.get_default_division()

        response = self.client.get(f"/api/tournaments/{tournament.id}/")

        self.assertEqual(response.status_code, 200)

        divisions = response.json().get("divisions") or []
        division_ids = {item.get("id") for item in divisions}

        self.assertIn(default_division.id, division_ids)

    def test_other_user_cannot_access_private_tournament_detail_with_divisions(self):
        tournament = self._create_tournament_via_api()
        self.client.force_authenticate(user=self.other_user)

        response = self.client.get(f"/api/tournaments/{tournament.id}/")

        self.assertIn(response.status_code, {403, 404})

    def test_organizer_can_create_additional_division(self):
        tournament = self._create_tournament_via_api()

        response = self.client.post(
            f"/api/tournaments/{tournament.id}/divisions/",
            {"name": "Juniorzy"},
            format="json",
        )

        self.assertIn(response.status_code, {200, 201, 202})

        division = Division.objects.get(tournament=tournament, name="Juniorzy")
        teams = list(Team.objects.filter(tournament=tournament, division=division).order_by("id"))

        self.assertFalse(division.is_default)
        self.assertEqual(division.status, Tournament.Status.CONFIGURED)
        self.assertEqual([team.name for team in teams], ["Drużyna 1", "Drużyna 2"])

    def test_other_user_cannot_create_division(self):
        tournament = self._create_tournament_via_api()
        self.client.force_authenticate(user=self.other_user)

        response = self.client.post(
            f"/api/tournaments/{tournament.id}/divisions/",
            {"name": "Niedozwolona dywizja"},
            format="json",
        )

        self.assertIn(response.status_code, {403, 404})
        self.assertFalse(Division.objects.filter(tournament=tournament, name="Niedozwolona dywizja").exists())

    def test_create_division_rejects_duplicate_name_in_tournament(self):
        tournament = self._create_tournament_via_api()
        Division.objects.create(
            tournament=tournament,
            name="Kategoria Open",
        )

        response = self.client.post(
            f"/api/tournaments/{tournament.id}/divisions/",
            {"name": "Kategoria Open"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(Division.objects.filter(tournament=tournament, name="Kategoria Open").count(), 1)

    def test_created_individual_division_uses_participant_slot_names(self):
        tournament = self._create_tournament_via_api(
            name="Turniej tenisowy z dywizją",
            discipline="tennis",
        )

        response = self.client.post(
            f"/api/tournaments/{tournament.id}/divisions/",
            {"name": "Seniorzy"},
            format="json",
        )

        self.assertIn(response.status_code, {200, 201, 202})

        division = Division.objects.get(tournament=tournament, name="Seniorzy")
        teams = list(Team.objects.filter(tournament=tournament, division=division).order_by("id"))

        self.assertEqual(division.competition_type, Tournament.CompetitionType.INDIVIDUAL)
        self.assertEqual([team.name for team in teams], ["Zawodnik 1", "Zawodnik 2"])


class TournamentChangeSetupApiTests(TestCase):
    """Testy API zabezpieczają zmianę konfiguracji formatu aktywnej dywizji."""

    def setUp(self):
        self.organizer = create_test_user("setup-owner@example.com")
        self.other_user = create_test_user("setup-other@example.com")
        self.client = APIClient()

    def _create_tournament_via_api(self, name="Turniej konfiguracji", discipline="football"):
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

    def test_setup_dry_run_for_current_configuration_reports_no_change(self):
        tournament, division = self._create_tournament_via_api()

        response = self.client.post(
            f"/api/tournaments/{tournament.id}/setup/?division_id={division.id}&dry_run=1",
            {
                "tournament_format": division.tournament_format,
                "format_config": division.format_config,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("division_id"), division.id)
        self.assertFalse(response.json().get("changed"))
        self.assertFalse(response.json().get("requires_reset"))

    def test_setup_dry_run_for_changed_format_reports_required_reset(self):
        tournament, division = self._create_tournament_via_api()

        response = self.client.post(
            f"/api/tournaments/{tournament.id}/setup/?division_id={division.id}&dry_run=1",
            {
                "tournament_format": Tournament.TournamentFormat.CUP,
                "format_config": {},
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json().get("changed"))
        self.assertTrue(response.json().get("requires_reset"))
        self.assertIn("reset_needed", response.json())

    def test_organizer_can_change_default_division_setup(self):
        tournament, division = self._create_tournament_via_api()

        response = self.client.post(
            f"/api/tournaments/{tournament.id}/setup/?division_id={division.id}",
            {
                "tournament_format": Tournament.TournamentFormat.CUP,
                "format_config": {},
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("division_id"), division.id)
        self.assertTrue(response.json().get("changed"))

        division.refresh_from_db()
        tournament.refresh_from_db()

        self.assertEqual(division.tournament_format, Tournament.TournamentFormat.CUP)
        self.assertEqual(tournament.tournament_format, Tournament.TournamentFormat.CUP)

    def test_setup_rejects_invalid_tournament_format(self):
        tournament, division = self._create_tournament_via_api()

        response = self.client.post(
            f"/api/tournaments/{tournament.id}/setup/?division_id={division.id}",
            {
                "tournament_format": "INVALID",
                "format_config": {},
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)

        division.refresh_from_db()
        self.assertEqual(division.tournament_format, Tournament.TournamentFormat.LEAGUE)

    def test_other_user_cannot_change_tournament_setup(self):
        tournament, division = self._create_tournament_via_api()
        self.client.force_authenticate(user=self.other_user)

        response = self.client.post(
            f"/api/tournaments/{tournament.id}/setup/?division_id={division.id}",
            {
                "tournament_format": Tournament.TournamentFormat.CUP,
                "format_config": {},
            },
            format="json",
        )

        self.assertIn(response.status_code, {403, 404})

        division.refresh_from_db()
        self.assertEqual(division.tournament_format, Tournament.TournamentFormat.LEAGUE)

    def test_unauthenticated_user_cannot_change_tournament_setup(self):
        tournament, division = self._create_tournament_via_api()
        self.client.force_authenticate(user=None)

        response = self.client.post(
            f"/api/tournaments/{tournament.id}/setup/?division_id={division.id}",
            {
                "tournament_format": Tournament.TournamentFormat.CUP,
                "format_config": {},
            },
            format="json",
        )

        self.assertIn(response.status_code, {401, 403})

        division.refresh_from_db()
        self.assertEqual(division.tournament_format, Tournament.TournamentFormat.LEAGUE)


class TournamentDivisionDetailApiTests(TestCase):
    """Testy API zabezpieczają edycję, wybór domyślnej dywizji oraz archiwizację dywizji."""

    def setUp(self):
        self.organizer = create_test_user("division-detail-owner@example.com")
        self.other_user = create_test_user("division-detail-other@example.com")
        self.client = APIClient()

    def _create_tournament_via_api(self, name="Turniej szczegółów dywizji", discipline="football"):
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

    def _create_division_via_api(self, tournament, name="Juniorzy"):
        response = self.client.post(
            f"/api/tournaments/{tournament.id}/divisions/",
            {"name": name},
            format="json",
        )
        self.assertEqual(response.status_code, 201)

        return Division.objects.get(tournament=tournament, name=name)

    def test_organizer_can_rename_division(self):
        tournament, division = self._create_tournament_via_api()

        response = self.client.patch(
            f"/api/tournaments/{tournament.id}/divisions/{division.id}/",
            {"name": "Nowa dywizja główna"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        division.refresh_from_db()
        self.assertEqual(division.name, "Nowa dywizja główna")

    def test_division_rename_rejects_empty_name(self):
        tournament, division = self._create_tournament_via_api()
        original_name = division.name

        response = self.client.patch(
            f"/api/tournaments/{tournament.id}/divisions/{division.id}/",
            {"name": "   "},
            format="json",
        )

        self.assertEqual(response.status_code, 400)

        division.refresh_from_db()
        self.assertEqual(division.name, original_name)

    def test_division_rename_rejects_duplicate_name_case_insensitive(self):
        tournament, default_division = self._create_tournament_via_api()
        self._create_division_via_api(tournament, "Juniorzy")

        response = self.client.patch(
            f"/api/tournaments/{tournament.id}/divisions/{default_division.id}/",
            {"name": "juniorzy"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)

        default_division.refresh_from_db()
        self.assertEqual(default_division.name, "Dywizja główna")

    def test_other_user_cannot_patch_division(self):
        tournament, division = self._create_tournament_via_api()
        self.client.force_authenticate(user=self.other_user)

        response = self.client.patch(
            f"/api/tournaments/{tournament.id}/divisions/{division.id}/",
            {"name": "Niedozwolona zmiana"},
            format="json",
        )

        self.assertIn(response.status_code, {403, 404})

        division.refresh_from_db()
        self.assertEqual(division.name, "Dywizja główna")

    def test_organizer_can_mark_additional_division_as_default(self):
        tournament, default_division = self._create_tournament_via_api()
        new_default = self._create_division_via_api(tournament, "Seniorzy")

        response = self.client.patch(
            f"/api/tournaments/{tournament.id}/divisions/{new_default.id}/",
            {"is_default": True},
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        default_division.refresh_from_db()
        new_default.refresh_from_db()

        self.assertFalse(default_division.is_default)
        self.assertTrue(new_default.is_default)

    def test_cannot_archive_last_active_division(self):
        tournament, division = self._create_tournament_via_api()

        response = self.client.patch(
            f"/api/tournaments/{tournament.id}/divisions/{division.id}/",
            {"is_archived": True},
            format="json",
        )

        self.assertEqual(response.status_code, 400)

        division.refresh_from_db()
        self.assertFalse(division.is_archived)
        self.assertTrue(division.is_default)

    def test_organizer_can_archive_non_default_division(self):
        tournament, default_division = self._create_tournament_via_api()
        division = self._create_division_via_api(tournament, "Archiwalna")

        response = self.client.patch(
            f"/api/tournaments/{tournament.id}/divisions/{division.id}/",
            {"is_archived": True},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json().get("fallback_division_id"))

        division.refresh_from_db()
        default_division.refresh_from_db()

        self.assertTrue(division.is_archived)
        self.assertFalse(division.is_default)
        self.assertTrue(default_division.is_default)

    def test_archiving_default_division_selects_fallback_and_syncs_tournament_config(self):
        tournament, default_division = self._create_tournament_via_api()
        fallback = self._create_division_via_api(tournament, "Fallback")

        fallback.tournament_format = Tournament.TournamentFormat.CUP
        fallback.format_config = {"cup_matches": 1}
        fallback.result_config = {}
        fallback.save(update_fields=["tournament_format", "format_config", "result_config"])

        response = self.client.patch(
            f"/api/tournaments/{tournament.id}/divisions/{default_division.id}/",
            {"is_archived": True},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("fallback_division_id"), fallback.id)

        default_division.refresh_from_db()
        fallback.refresh_from_db()
        tournament.refresh_from_db()

        self.assertTrue(default_division.is_archived)
        self.assertFalse(default_division.is_default)
        self.assertTrue(fallback.is_default)
        self.assertEqual(tournament.tournament_format, Tournament.TournamentFormat.CUP)
        self.assertEqual(tournament.format_config, {"cup_matches": 1})
