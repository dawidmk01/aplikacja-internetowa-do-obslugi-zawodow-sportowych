# tournaments/tests.py
# Plik zawiera testy automatyczne potwierdzające spójność aplikacji turniejów.

from importlib import import_module

from django.apps import apps
from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase
from django.urls import URLPattern, URLResolver

from tournaments.models import Division, Team, Tournament


def create_test_user(email="organizer@example.com"):
    """Funkcja tworzy użytkownika testowego niezależnie od szczegółów modelu konta."""

    user_model = get_user_model()
    field_names = {field.name for field in user_model._meta.fields}

    user_data = {
        "email": email,
        "password": "test-password-123",
    }

    if "username" in field_names:
        user_data["username"] = email

    return user_model.objects.create_user(**user_data)


class TournamentSmokeTests(SimpleTestCase):
    """Testy dymne zabezpieczają możliwość uruchomienia podstawowych modułów domeny turniejów."""

    def test_tournaments_app_is_registered(self):
        app_config = apps.get_app_config("tournaments")

        self.assertEqual(app_config.name, "tournaments")

    def test_tournaments_urls_are_importable(self):
        urls_module = import_module("tournaments.urls")

        self.assertTrue(hasattr(urls_module, "urlpatterns"))
        self.assertGreater(len(urls_module.urlpatterns), 0)

        for pattern in urls_module.urlpatterns:
            self.assertIsInstance(pattern, (URLPattern, URLResolver))

    def test_tournaments_serializers_package_is_importable(self):
        serializers_module = import_module("tournaments.serializers")

        self.assertIsNotNone(serializers_module)

    def test_tournaments_views_package_is_importable(self):
        views_module = import_module("tournaments.views")

        self.assertIsNotNone(views_module)


class TournamentDomainModelTests(SimpleTestCase):
    """Testy zabezpieczają obecność głównych modeli procesu zarządzania turniejem."""

    expected_model_names = {
        "Tournament",
        "TournamentMembership",
        "TournamentAssistantInvite",
        "TournamentRegistration",
        "TeamNameChangeRequest",
        "Division",
        "Team",
        "TeamPlayer",
        "Stage",
        "Group",
        "Match",
        "MatchCustomResult",
        "StageMassStartEntry",
        "StageMassStartResult",
        "MatchIncident",
        "MatchCommentaryEntry",
        "TournamentCommentaryPhrase",
    }

    direct_tournament_models = {
        "TournamentMembership",
        "TournamentAssistantInvite",
        "TournamentRegistration",
        "TeamNameChangeRequest",
        "Division",
        "Team",
        "Stage",
        "Match",
        "TournamentCommentaryPhrase",
    }

    nested_parent_fields = {
        "Group": "stage",
        "MatchIncident": "match",
        "MatchCommentaryEntry": "match",
    }

    def test_tournaments_app_has_expected_domain_models(self):
        model_names = {
            model.__name__
            for model in apps.get_app_config("tournaments").get_models()
        }

        self.assertSetEqual(model_names, self.expected_model_names)

    def test_core_models_are_registered_in_django_app_registry(self):
        for model_name in self.expected_model_names:
            with self.subTest(model_name=model_name):
                model = apps.get_model("tournaments", model_name)

                self.assertEqual(model.__name__, model_name)

    def test_core_models_define_database_tables(self):
        for model_name in self.expected_model_names:
            with self.subTest(model_name=model_name):
                model = apps.get_model("tournaments", model_name)

                self.assertTrue(model._meta.db_table)

    def test_models_directly_related_to_tournament_keep_tournament_reference(self):
        for model_name in self.direct_tournament_models:
            with self.subTest(model_name=model_name):
                model = apps.get_model("tournaments", model_name)
                field_names = {field.name for field in model._meta.fields}

                self.assertIn("tournament", field_names)

    def test_nested_models_keep_parent_reference(self):
        for model_name, parent_field in self.nested_parent_fields.items():
            with self.subTest(model_name=model_name):
                model = apps.get_model("tournaments", model_name)
                field_names = {field.name for field in model._meta.fields}

                self.assertIn(parent_field, field_names)


class TournamentUrlContractTests(SimpleTestCase):
    """Testy zabezpieczają obecność publicznego kontraktu URL aplikacji turniejów."""

    expected_routes = {
        "tournaments/",
        "tournaments/my/",
        "tournaments/<int:pk>/",
        "tournaments/<int:pk>/meta/",
        "tournaments/<int:pk>/archive/",
        "tournaments/<int:pk>/unarchive/",
        "tournaments/<int:pk>/discipline/",
        "tournaments/<int:pk>/setup/",
        "tournaments/<int:pk>/change-discipline/",
        "tournaments/<int:pk>/change-setup/",
        "tournaments/<int:pk>/advance-from-groups/",
        "tournaments/<int:pk>/advance-mass-start-stage/",
        "tournaments/<int:pk>/divisions/",
        "tournaments/<int:pk>/divisions/<int:division_id>/",
        "tournaments/<int:pk>/assistants/",
        "tournaments/<int:pk>/assistants/add/",
        "tournaments/<int:pk>/assistant-invite/accept/",
        "tournaments/<int:pk>/assistant-invite/decline/",
        "tournaments/<int:pk>/teams/setup/",
        "tournaments/<int:pk>/teams/",
        "tournaments/<int:pk>/teams/<int:team_id>/",
        "tournaments/<int:pk>/matches/",
        "tournaments/<int:pk>/mass-start-results/",
        "tournaments/<int:pk>/public/matches/",
        "matches/<int:pk>/",
        "matches/<int:pk>/result/",
        "matches/<int:pk>/custom-result/",
        "matches/<int:pk>/finish/",
        "matches/<int:pk>/continue/",
        "matches/<int:pk>/set-scheduled/",
        "tournaments/<int:pk>/standings/",
        "tournaments/<int:pk>/public/standings/",
        "matches/<int:match_id>/incidents/",
        "incidents/<int:incident_id>/",
        "matches/<int:match_id>/clock/",
        "matches/<int:match_id>/clock/start/",
        "matches/<int:match_id>/clock/pause/",
        "matches/<int:match_id>/clock/resume/",
        "matches/<int:match_id>/clock/stop/",
        "matches/<int:match_id>/clock/period/",
        "matches/<int:match_id>/clock/added/",
        "matches/<int:match_id>/commentary/",
        "commentary/<int:commentary_id>/",
    }

    def test_expected_routes_are_registered(self):
        urls_module = import_module("tournaments.urls")
        registered_routes = {
            str(pattern.pattern)
            for pattern in urls_module.urlpatterns
            if isinstance(pattern, URLPattern)
        }

        for route in self.expected_routes:
            with self.subTest(route=route):
                self.assertIn(route, registered_routes)

    def test_registered_routes_have_callable_views(self):
        urls_module = import_module("tournaments.urls")

        for pattern in urls_module.urlpatterns:
            if not isinstance(pattern, URLPattern):
                continue

            with self.subTest(route=str(pattern.pattern)):
                self.assertTrue(callable(pattern.callback))


class TournamentModelPersistenceTests(TestCase):
    """Testy bazodanowe zabezpieczają podstawowy kontrakt modelu turnieju."""

    def setUp(self):
        self.organizer = create_test_user()

    def test_tournament_can_be_created_with_minimal_domain_data(self):
        tournament = Tournament.objects.create(
            name="Testowy turniej",
            discipline="football",
            organizer=self.organizer,
        )

        self.assertEqual(tournament.name, "Testowy turniej")
        self.assertEqual(tournament.discipline, "football")
        self.assertEqual(tournament.organizer_id, self.organizer.id)

    def test_tournament_uses_expected_default_configuration(self):
        tournament = Tournament.objects.create(
            name="Turniej z wartościami domyślnymi",
            discipline="football",
            organizer=self.organizer,
        )

        self.assertEqual(tournament.competition_type, "TEAM")
        self.assertEqual(tournament.competition_model, "HEAD_TO_HEAD")
        self.assertEqual(tournament.tournament_format, "LEAGUE")
        self.assertEqual(tournament.result_mode, "SCORE")
        self.assertEqual(tournament.status, "DRAFT")

    def test_tournament_publication_and_registration_flags_are_disabled_by_default(self):
        tournament = Tournament.objects.create(
            name="Turniej prywatny",
            discipline="football",
            organizer=self.organizer,
        )

        self.assertFalse(tournament.join_enabled)
        self.assertFalse(tournament.participants_public_preview_enabled)
        self.assertFalse(tournament.is_published)
        self.assertFalse(tournament.is_archived)
        self.assertTrue(tournament.participants_self_rename_enabled)

    def test_tournament_json_configuration_defaults_are_independent_between_instances(self):
        first_tournament = Tournament.objects.create(
            name="Pierwszy turniej",
            discipline="football",
            organizer=self.organizer,
        )
        second_tournament = Tournament.objects.create(
            name="Drugi turniej",
            discipline="football",
            organizer=self.organizer,
        )

        first_tournament.format_config["groups_count"] = 2
        first_tournament.save(update_fields=["format_config"])
        second_tournament.refresh_from_db()

        self.assertEqual(second_tournament.format_config, {})
        self.assertEqual(second_tournament.result_config, {})

    def test_custom_discipline_can_store_display_name(self):
        tournament = Tournament.objects.create(
            name="Turniej niestandardowy",
            discipline="custom",
            custom_discipline_name="Szachy błyskawiczne",
            organizer=self.organizer,
        )

        self.assertEqual(tournament.discipline, "custom")
        self.assertEqual(tournament.custom_discipline_name, "Szachy błyskawiczne")


from rest_framework.test import APIClient


class TournamentApiAccessTests(TestCase):
    """Testy API zabezpieczają podstawowy dostęp do zasobów turnieju przez warstwę HTTP."""

    def setUp(self):
        self.organizer = create_test_user("organizer-api@example.com")
        self.other_user = create_test_user("other-api@example.com")

        self.tournament = Tournament.objects.create(
            name="Turniej API",
            discipline="football",
            organizer=self.organizer,
        )

        self.client = APIClient()

    def _response_items(self, response):
        data = response.json()

        if isinstance(data, list):
            return data

        if isinstance(data, dict) and isinstance(data.get("results"), list):
            return data["results"]

        return []

    def test_unauthenticated_user_cannot_access_tournament_list(self):
        response = self.client.get("/api/tournaments/")

        self.assertIn(response.status_code, {401, 403})

    def test_authenticated_organizer_can_access_tournament_list(self):
        self.client.force_authenticate(user=self.organizer)

        response = self.client.get("/api/tournaments/")

        self.assertEqual(response.status_code, 200)

    def test_authenticated_organizer_sees_owned_tournament_on_list(self):
        self.client.force_authenticate(user=self.organizer)

        response = self.client.get("/api/tournaments/")
        items = self._response_items(response)
        tournament_ids = {item.get("id") for item in items}

        self.assertIn(self.tournament.id, tournament_ids)

    def test_organizer_can_access_tournament_detail(self):
        self.client.force_authenticate(user=self.organizer)

        response = self.client.get(f"/api/tournaments/{self.tournament.id}/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("id"), self.tournament.id)
        self.assertEqual(response.json().get("name"), "Turniej API")

    def test_other_user_cannot_access_private_tournament_detail(self):
        self.client.force_authenticate(user=self.other_user)

        response = self.client.get(f"/api/tournaments/{self.tournament.id}/")

        self.assertIn(response.status_code, {403, 404})

    def test_organizer_can_access_my_tournaments_endpoint(self):
        self.client.force_authenticate(user=self.organizer)

        response = self.client.get("/api/tournaments/my/")
        items = self._response_items(response)
        tournament_ids = {item.get("id") for item in items}

        self.assertEqual(response.status_code, 200)
        self.assertIn(self.tournament.id, tournament_ids)


class TournamentApiCreateTests(TestCase):
    """Testy API zabezpieczają kontrakt tworzenia turnieju przez warstwę HTTP."""

    def setUp(self):
        self.organizer = create_test_user("creator-api@example.com")
        self.client = APIClient()

    def test_unauthenticated_user_cannot_create_tournament(self):
        payload = {
            "name": "Turniej bez logowania",
            "discipline": "football",
        }

        response = self.client.post("/api/tournaments/", payload, format="json")

        self.assertIn(response.status_code, {401, 403})
        self.assertFalse(Tournament.objects.filter(name="Turniej bez logowania").exists())

    def test_authenticated_user_can_create_tournament_with_minimal_payload(self):
        self.client.force_authenticate(user=self.organizer)

        payload = {
            "name": "Nowy turniej z API",
            "discipline": "football",
        }

        response = self.client.post("/api/tournaments/", payload, format="json")

        self.assertEqual(response.status_code, 201)

        tournament = Tournament.objects.get(name="Nowy turniej z API")

        self.assertEqual(tournament.organizer_id, self.organizer.id)
        self.assertEqual(tournament.discipline, "football")
        self.assertEqual(tournament.competition_type, "TEAM")
        self.assertEqual(tournament.competition_model, "HEAD_TO_HEAD")
        self.assertEqual(tournament.tournament_format, "LEAGUE")
        self.assertFalse(tournament.is_published)
        self.assertFalse(tournament.is_archived)

    def test_created_tournament_is_returned_in_response(self):
        self.client.force_authenticate(user=self.organizer)

        payload = {
            "name": "Turniej widoczny w odpowiedzi",
            "discipline": "football",
        }

        response = self.client.post("/api/tournaments/", payload, format="json")

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json().get("name"), "Turniej widoczny w odpowiedzi")
        self.assertEqual(response.json().get("discipline"), "football")
        self.assertEqual(response.json().get("organizer"), self.organizer.id)

    def test_create_tournament_requires_name(self):
        self.client.force_authenticate(user=self.organizer)

        payload = {
            "discipline": "football",
        }

        response = self.client.post("/api/tournaments/", payload, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertFalse(Tournament.objects.filter(discipline="football", organizer=self.organizer).exists())

    def test_create_tournament_requires_discipline(self):
        self.client.force_authenticate(user=self.organizer)

        payload = {
            "name": "Turniej bez dyscypliny",
        }

        response = self.client.post("/api/tournaments/", payload, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertFalse(Tournament.objects.filter(name="Turniej bez dyscypliny").exists())


class TournamentApiOwnerActionTests(TestCase):
    """Testy API zabezpieczają operacje dostępne wyłącznie dla organizatora turnieju."""

    def setUp(self):
        self.organizer = create_test_user("owner-actions@example.com")
        self.other_user = create_test_user("blocked-actions@example.com")

        self.tournament = Tournament.objects.create(
            name="Turniej właścicielski",
            discipline="football",
            organizer=self.organizer,
        )

        self.client = APIClient()

    def test_organizer_can_archive_tournament(self):
        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(f"/api/tournaments/{self.tournament.id}/archive/")

        self.assertEqual(response.status_code, 200)

        self.tournament.refresh_from_db()
        self.assertTrue(self.tournament.is_archived)
        self.assertEqual(self.tournament.status, Tournament.Status.FINISHED)
        self.assertFalse(self.tournament.is_published)

    def test_other_user_cannot_archive_tournament(self):
        self.client.force_authenticate(user=self.other_user)

        response = self.client.post(f"/api/tournaments/{self.tournament.id}/archive/")

        self.assertIn(response.status_code, {403, 404})

        self.tournament.refresh_from_db()
        self.assertFalse(self.tournament.is_archived)
        self.assertEqual(self.tournament.status, Tournament.Status.DRAFT)

    def test_organizer_can_unarchive_tournament(self):
        self.tournament.status = Tournament.Status.FINISHED
        self.tournament.is_archived = True
        self.tournament.save(update_fields=["status", "is_archived"])

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(f"/api/tournaments/{self.tournament.id}/unarchive/")

        self.assertEqual(response.status_code, 200)

        self.tournament.refresh_from_db()
        self.assertFalse(self.tournament.is_archived)
        self.assertEqual(self.tournament.status, Tournament.Status.CONFIGURED)

    def test_other_user_cannot_unarchive_tournament(self):
        self.tournament.status = Tournament.Status.FINISHED
        self.tournament.is_archived = True
        self.tournament.save(update_fields=["status", "is_archived"])

        self.client.force_authenticate(user=self.other_user)

        response = self.client.post(f"/api/tournaments/{self.tournament.id}/unarchive/")

        self.assertIn(response.status_code, {403, 404})

        self.tournament.refresh_from_db()
        self.assertTrue(self.tournament.is_archived)
        self.assertEqual(self.tournament.status, Tournament.Status.FINISHED)

    def test_other_user_cannot_update_tournament_meta(self):
        self.client.force_authenticate(user=self.other_user)

        payload = {
            "name": "Niedozwolona zmiana nazwy",
            "description": "Opis nie powinien zostać zapisany.",
            "location": "Poznań",
        }

        response = self.client.patch(
            f"/api/tournaments/{self.tournament.id}/meta/",
            payload,
            format="json",
        )

        self.assertIn(response.status_code, {403, 404})

        self.tournament.refresh_from_db()
        self.assertEqual(self.tournament.name, "Turniej właścicielski")
        self.assertNotEqual(self.tournament.description, "Opis nie powinien zostać zapisany.")


class TournamentArchiveRegressionTests(TestCase):
    """Testy regresji zabezpieczają archiwizację przed obejściem dedykowanych endpointów."""

    def setUp(self):
        self.organizer = create_test_user("archive-regression@example.com")
        self.client = APIClient()
        self.client.force_authenticate(user=self.organizer)
        self.tournament = Tournament.objects.create(
            name="Turniej regresji archiwum",
            discipline="football",
            organizer=self.organizer,
        )

    def test_cannot_archive_already_archived_tournament(self):
        self.tournament.status = Tournament.Status.FINISHED
        self.tournament.is_archived = True
        self.tournament.save(update_fields=["status", "is_archived"])

        response = self.client.post(f"/api/tournaments/{self.tournament.id}/archive/")

        self.assertEqual(response.status_code, 400)

    def test_archive_synchronizes_finished_tournament_without_archive_flag(self):
        self.tournament.status = Tournament.Status.FINISHED
        self.tournament.is_archived = False
        self.tournament.save(update_fields=["status", "is_archived"])

        response = self.client.post(f"/api/tournaments/{self.tournament.id}/archive/")

        self.assertEqual(response.status_code, 200)

        self.tournament.refresh_from_db()
        self.assertTrue(self.tournament.is_archived)
        self.assertEqual(self.tournament.status, Tournament.Status.FINISHED)

    def test_cannot_unarchive_tournament_outside_archive(self):
        response = self.client.post(f"/api/tournaments/{self.tournament.id}/unarchive/")

        self.assertEqual(response.status_code, 400)

        self.tournament.refresh_from_db()
        self.assertFalse(self.tournament.is_archived)
        self.assertEqual(self.tournament.status, Tournament.Status.DRAFT)

    def test_regular_patch_cannot_archive_tournament(self):
        response = self.client.patch(
            f"/api/tournaments/{self.tournament.id}/",
            {"is_archived": True, "status": Tournament.Status.FINISHED},
            format="json",
        )

        self.assertIn(response.status_code, {200, 400})

        self.tournament.refresh_from_db()
        self.assertFalse(self.tournament.is_archived)
        self.assertNotEqual(self.tournament.status, Tournament.Status.FINISHED)

    def test_regular_patch_cannot_unarchive_tournament(self):
        self.tournament.status = Tournament.Status.FINISHED
        self.tournament.is_archived = True
        self.tournament.save(update_fields=["status", "is_archived"])

        response = self.client.patch(
            f"/api/tournaments/{self.tournament.id}/",
            {"is_archived": False, "status": Tournament.Status.CONFIGURED},
            format="json",
        )

        self.assertIn(response.status_code, {200, 400})

        self.tournament.refresh_from_db()
        self.assertTrue(self.tournament.is_archived)
        self.assertEqual(self.tournament.status, Tournament.Status.FINISHED)

    def test_archive_disables_public_publication(self):
        self.tournament.is_published = True
        self.tournament.save(update_fields=["is_published"])

        response = self.client.post(f"/api/tournaments/{self.tournament.id}/archive/")

        self.assertEqual(response.status_code, 200)

        self.tournament.refresh_from_db()
        self.assertTrue(self.tournament.is_archived)
        self.assertFalse(self.tournament.is_published)


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
        self.assertEqual(division.status, Tournament.Status.DRAFT)
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


class TournamentRegistrationApiTests(TestCase):
    """Testy API zabezpieczają dołączanie uczestnika do turnieju przez kod."""

    def setUp(self):
        self.organizer = create_test_user("registration-owner@example.com")
        self.participant = create_test_user("registration-participant@example.com")
        self.second_participant = create_test_user("registration-second@example.com")
        self.third_participant = create_test_user("registration-third@example.com")
        self.client = APIClient()

    def _api_url_for_view(self, view_class_name: str, **params):
        urls_module = import_module("tournaments.urls")

        for pattern in urls_module.urlpatterns:
            if not isinstance(pattern, URLPattern):
                continue

            callback = getattr(pattern, "callback", None)
            view_class = getattr(callback, "view_class", None)

            if getattr(view_class, "__name__", None) != view_class_name:
                continue

            route = str(pattern.pattern)
            for key, value in params.items():
                route = route.replace(f"<int:{key}>", str(value))

            return f"/api/{route}"

        raise AssertionError(f"Nie znaleziono ścieżki dla widoku {view_class_name}.")

    def _create_joinable_tournament(self, name="Turniej rejestracji"):
        self.client.force_authenticate(user=self.organizer)
        response = self.client.post(
            "/api/tournaments/",
            {
                "name": name,
                "discipline": "football",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)

        tournament = Tournament.objects.get(name=name)
        tournament.join_enabled = True
        tournament.registration_code = "ABC123"
        tournament.participants_self_rename_enabled = True
        tournament.save(
            update_fields=[
                "join_enabled",
                "registration_code",
                "participants_self_rename_enabled",
            ]
        )

        return tournament, tournament.get_default_division()

    def _registration_model(self):
        return apps.get_model("tournaments", "TournamentRegistration")

    def test_registration_verify_rejects_when_join_is_disabled(self):
        tournament, division = self._create_joinable_tournament()
        tournament.join_enabled = False
        tournament.save(update_fields=["join_enabled"])

        self.client.force_authenticate(user=self.participant)

        response = self.client.post(
            self._api_url_for_view("TournamentRegistrationVerifyView", pk=tournament.id)
            + f"?division_id={division.id}",
            {"code": "ABC123"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)

    def test_registration_verify_rejects_invalid_code(self):
        tournament, division = self._create_joinable_tournament()
        self.client.force_authenticate(user=self.participant)

        response = self.client.post(
            self._api_url_for_view("TournamentRegistrationVerifyView", pk=tournament.id)
            + f"?division_id={division.id}",
            {"code": "WRONG"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)

    def test_registration_verify_accepts_valid_code(self):
        tournament, division = self._create_joinable_tournament()
        self.client.force_authenticate(user=self.participant)

        response = self.client.post(
            self._api_url_for_view("TournamentRegistrationVerifyView", pk=tournament.id)
            + f"?division_id={division.id}",
            {"code": "ABC123"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("detail"), "OK")
        self.assertEqual(response.json().get("division_id"), division.id)

    def test_participant_can_join_and_claim_first_free_slot(self):
        tournament, division = self._create_joinable_tournament()
        self.client.force_authenticate(user=self.participant)

        response = self.client.post(
            self._api_url_for_view("TournamentRegistrationJoinView", pk=tournament.id)
            + f"?division_id={division.id}",
            {
                "code": "ABC123",
                "display_name": "FC Uczestnik",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("detail"), "OK")
        self.assertEqual(response.json().get("division_id"), division.id)

        registration_model = self._registration_model()
        registration = registration_model.objects.get(
            tournament=tournament,
            division=division,
            user=self.participant,
        )
        team = Team.objects.get(id=response.json().get("team_id"))

        self.assertEqual(registration.display_name, "FC Uczestnik")
        self.assertEqual(registration.team_id, team.id)
        self.assertEqual(team.registered_user_id, self.participant.id)
        self.assertEqual(team.name, "FC Uczestnik")

    def test_join_accepts_name_alias_when_display_name_is_missing(self):
        tournament, division = self._create_joinable_tournament()
        self.client.force_authenticate(user=self.participant)

        response = self.client.post(
            self._api_url_for_view("TournamentRegistrationJoinView", pk=tournament.id)
            + f"?division_id={division.id}",
            {
                "code": "ABC123",
                "name": "Alias uczestnika",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("display_name"), "Alias uczestnika")

    def test_join_rejects_when_no_free_slots_are_available(self):
        tournament, division = self._create_joinable_tournament()

        for user, display_name in (
            (self.participant, "Pierwszy uczestnik"),
            (self.second_participant, "Drugi uczestnik"),
        ):
            self.client.force_authenticate(user=user)
            response = self.client.post(
                self._api_url_for_view("TournamentRegistrationJoinView", pk=tournament.id)
                + f"?division_id={division.id}",
                {
                    "code": "ABC123",
                    "display_name": display_name,
                },
                format="json",
            )
            self.assertEqual(response.status_code, 200)

        self.client.force_authenticate(user=self.third_participant)

        response = self.client.post(
            self._api_url_for_view("TournamentRegistrationJoinView", pk=tournament.id)
            + f"?division_id={division.id}",
            {
                "code": "ABC123",
                "display_name": "Trzeci uczestnik",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)

    def test_join_updates_existing_registration_without_claiming_second_slot(self):
        tournament, division = self._create_joinable_tournament()
        self.client.force_authenticate(user=self.participant)

        first_response = self.client.post(
            self._api_url_for_view("TournamentRegistrationJoinView", pk=tournament.id)
            + f"?division_id={division.id}",
            {
                "code": "ABC123",
                "display_name": "Pierwsza nazwa",
            },
            format="json",
        )
        self.assertEqual(first_response.status_code, 200)

        second_response = self.client.post(
            self._api_url_for_view("TournamentRegistrationJoinView", pk=tournament.id)
            + f"?division_id={division.id}",
            {
                "code": "ABC123",
                "display_name": "Druga nazwa",
            },
            format="json",
        )

        self.assertEqual(second_response.status_code, 200)
        self.assertEqual(second_response.json().get("team_id"), first_response.json().get("team_id"))

        registration_model = self._registration_model()
        self.assertEqual(
            registration_model.objects.filter(
                tournament=tournament,
                division=division,
                user=self.participant,
            ).count(),
            1,
        )

        team = Team.objects.get(id=first_response.json().get("team_id"))
        team.refresh_from_db()

        self.assertEqual(team.name, "Druga nazwa")

    def test_registration_me_returns_own_registration(self):
        tournament, division = self._create_joinable_tournament()
        self.client.force_authenticate(user=self.participant)

        join_response = self.client.post(
            self._api_url_for_view("TournamentRegistrationJoinView", pk=tournament.id)
            + f"?division_id={division.id}",
            {
                "code": "ABC123",
                "display_name": "Uczestnik do podglądu",
            },
            format="json",
        )
        self.assertEqual(join_response.status_code, 200)

        response = self.client.get(
            self._api_url_for_view("TournamentRegistrationMeView", pk=tournament.id)
            + f"?division_id={division.id}"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("display_name"), "Uczestnik do podglądu")
        self.assertEqual(response.json().get("team_id"), join_response.json().get("team_id"))
        self.assertEqual(response.json().get("division_id"), division.id)

    def test_registration_me_returns_404_without_registration(self):
        tournament, division = self._create_joinable_tournament()
        self.client.force_authenticate(user=self.participant)

        response = self.client.get(
            self._api_url_for_view("TournamentRegistrationMeView", pk=tournament.id)
            + f"?division_id={division.id}"
        )

        self.assertEqual(response.status_code, 404)

    def test_participant_can_rename_own_registration_when_self_rename_is_enabled(self):
        tournament, division = self._create_joinable_tournament()
        self.client.force_authenticate(user=self.participant)

        join_response = self.client.post(
            self._api_url_for_view("TournamentRegistrationJoinView", pk=tournament.id)
            + f"?division_id={division.id}",
            {
                "code": "ABC123",
                "display_name": "Stara nazwa",
            },
            format="json",
        )
        self.assertEqual(join_response.status_code, 200)

        response = self.client.patch(
            self._api_url_for_view("TournamentRegistrationMeView", pk=tournament.id)
            + f"?division_id={division.id}",
            {"display_name": "Nowa nazwa"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json().get("display_name"), "Nowa nazwa")

        registration_model = self._registration_model()
        registration = registration_model.objects.get(
            tournament=tournament,
            division=division,
            user=self.participant,
        )
        team = Team.objects.get(id=registration.team_id)

        self.assertEqual(registration.display_name, "Nowa nazwa")
        self.assertEqual(team.name, "Nowa nazwa")

    def test_participant_cannot_rename_own_registration_when_self_rename_is_disabled(self):
        tournament, division = self._create_joinable_tournament()
        tournament.participants_self_rename_enabled = False
        tournament.save(update_fields=["participants_self_rename_enabled"])

        self.client.force_authenticate(user=self.participant)

        join_response = self.client.post(
            self._api_url_for_view("TournamentRegistrationJoinView", pk=tournament.id)
            + f"?division_id={division.id}",
            {
                "code": "ABC123",
                "display_name": "Nazwa bez samoedycji",
            },
            format="json",
        )
        self.assertEqual(join_response.status_code, 200)

        response = self.client.patch(
            self._api_url_for_view("TournamentRegistrationMeView", pk=tournament.id)
            + f"?division_id={division.id}",
            {"display_name": "Niedozwolona zmiana"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)

        team = Team.objects.get(id=join_response.json().get("team_id"))
        team.refresh_from_db()

        self.assertEqual(team.name, "Nazwa bez samoedycji")


class TournamentTeamNameChangeRequestApiTests(TestCase):
    """Testy API zabezpieczają przepływ wniosków o zmianę nazwy uczestnika."""

    def setUp(self):
        self.organizer = create_test_user("name-change-owner@example.com")
        self.participant = create_test_user("name-change-participant@example.com")
        self.other_user = create_test_user("name-change-other@example.com")
        self.client = APIClient()

    def _api_url_for_view(self, view_class_name: str, **params):
        urls_module = import_module("tournaments.urls")

        for pattern in urls_module.urlpatterns:
            if not isinstance(pattern, URLPattern):
                continue

            callback = getattr(pattern, "callback", None)
            view_class = getattr(callback, "view_class", None)

            if getattr(view_class, "__name__", None) != view_class_name:
                continue

            route = str(pattern.pattern)
            for key, value in params.items():
                route = route.replace(f"<int:{key}>", str(value))

            return f"/api/{route}"

        raise AssertionError(f"Nie znaleziono ścieżki dla widoku {view_class_name}.")

    def _registration_model(self):
        return apps.get_model("tournaments", "TournamentRegistration")

    def _name_change_request_model(self):
        return apps.get_model("tournaments", "TeamNameChangeRequest")

    def _response_items(self, response):
        data = response.json()

        if isinstance(data, list):
            return data

        if isinstance(data, dict) and isinstance(data.get("results"), list):
            return data["results"]

        return []

    def _create_tournament_with_registered_participant(
        self,
        *,
        self_rename_enabled=False,
        name="Turniej wniosków o nazwę",
    ):
        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            "/api/tournaments/",
            {
                "name": name,
                "discipline": "football",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)

        tournament = Tournament.objects.get(name=name)
        tournament.participants_self_rename_enabled = self_rename_enabled
        tournament.participants_public_preview_enabled = True
        tournament.save(
            update_fields=[
                "participants_self_rename_enabled",
                "participants_public_preview_enabled",
            ]
        )

        division = tournament.get_default_division()
        team = (
            Team.objects.filter(
                tournament=tournament,
                division=division,
                is_active=True,
            )
            .order_by("id")
            .first()
        )

        team.name = "Stara nazwa uczestnika"
        team.registered_user = self.participant
        team.save(update_fields=["name", "registered_user"])

        self._registration_model().objects.create(
            tournament=tournament,
            division=division,
            user=self.participant,
            team=team,
            display_name="Stara nazwa uczestnika",
        )

        return tournament, division, team

    def _create_pending_request(self):
        tournament, division, team = self._create_tournament_with_registered_participant()

        self.client.force_authenticate(user=self.participant)

        response = self.client.post(
            self._api_url_for_view(
                "TournamentTeamNameChangeRequestCreateView",
                pk=tournament.id,
                team_id=team.id,
            )
            + f"?division_id={division.id}",
            {"requested_name": "Nowa nazwa uczestnika"},
            format="json",
        )

        self.assertEqual(response.status_code, 201)

        request_model = self._name_change_request_model()
        name_request = request_model.objects.get(id=response.json()["request"]["id"])

        return tournament, division, team, name_request

    def test_participant_cannot_request_name_change_when_self_rename_is_enabled(self):
        tournament, division, team = self._create_tournament_with_registered_participant(
            self_rename_enabled=True,
            name="Turniej z samoedycją nazw",
        )

        self.client.force_authenticate(user=self.participant)

        response = self.client.post(
            self._api_url_for_view(
                "TournamentTeamNameChangeRequestCreateView",
                pk=tournament.id,
                team_id=team.id,
            )
            + f"?division_id={division.id}",
            {"requested_name": "Niepotrzebny wniosek"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(
            self._name_change_request_model()
            .objects.filter(tournament=tournament, team=team)
            .exists()
        )

    def test_registered_participant_can_submit_name_change_request(self):
        tournament, division, team = self._create_tournament_with_registered_participant()

        self.client.force_authenticate(user=self.participant)

        response = self.client.post(
            self._api_url_for_view(
                "TournamentTeamNameChangeRequestCreateView",
                pk=tournament.id,
                team_id=team.id,
            )
            + f"?division_id={division.id}",
            {"requested_name": "Nowa nazwa uczestnika"},
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json().get("detail"), "Prośba została złożona.")

        request_model = self._name_change_request_model()
        name_request = request_model.objects.get(tournament=tournament, team=team)

        self.assertEqual(name_request.requested_by_id, self.participant.id)
        self.assertEqual(name_request.old_name, "Stara nazwa uczestnika")
        self.assertEqual(name_request.requested_name, "Nowa nazwa uczestnika")
        self.assertEqual(name_request.status, request_model.Status.PENDING)

    def test_participant_cannot_submit_second_pending_request_for_same_team(self):
        tournament, division, team, _name_request = self._create_pending_request()

        self.client.force_authenticate(user=self.participant)

        response = self.client.post(
            self._api_url_for_view(
                "TournamentTeamNameChangeRequestCreateView",
                pk=tournament.id,
                team_id=team.id,
            )
            + f"?division_id={division.id}",
            {"requested_name": "Jeszcze inna nazwa"},
            format="json",
        )

        self.assertEqual(response.status_code, 409)
        self.assertEqual(
            self._name_change_request_model()
            .objects.filter(
                tournament=tournament,
                team=team,
                status=self._name_change_request_model().Status.PENDING,
            )
            .count(),
            1,
        )

    def test_unregistered_user_cannot_submit_name_change_request(self):
        tournament, division, team = self._create_tournament_with_registered_participant()

        self.client.force_authenticate(user=self.other_user)

        response = self.client.post(
            self._api_url_for_view(
                "TournamentTeamNameChangeRequestCreateView",
                pk=tournament.id,
                team_id=team.id,
            )
            + f"?division_id={division.id}",
            {"requested_name": "Niedozwolona nazwa"},
            format="json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertFalse(
            self._name_change_request_model()
            .objects.filter(tournament=tournament, requested_by=self.other_user)
            .exists()
        )

    def test_participant_cannot_submit_request_for_foreign_team_slot(self):
        tournament, division, team = self._create_tournament_with_registered_participant()

        foreign_team = (
            Team.objects.filter(
                tournament=tournament,
                division=division,
                is_active=True,
            )
            .exclude(id=team.id)
            .order_by("id")
            .first()
        )

        self.client.force_authenticate(user=self.participant)

        response = self.client.post(
            self._api_url_for_view(
                "TournamentTeamNameChangeRequestCreateView",
                pk=tournament.id,
                team_id=foreign_team.id,
            )
            + f"?division_id={division.id}",
            {"requested_name": "Próba cudzego slotu"},
            format="json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertFalse(
            self._name_change_request_model()
            .objects.filter(tournament=tournament, team=foreign_team)
            .exists()
        )

    def test_organizer_can_list_pending_name_change_requests(self):
        tournament, division, team, name_request = self._create_pending_request()

        self.client.force_authenticate(user=self.organizer)

        response = self.client.get(
            self._api_url_for_view(
                "TournamentTeamNameChangeRequestListView",
                pk=tournament.id,
            )
            + f"?division_id={division.id}"
        )

        self.assertEqual(response.status_code, 200)

        items = self._response_items(response)

        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].get("id"), name_request.id)
        self.assertEqual(items[0].get("team_id"), team.id)
        self.assertEqual(items[0].get("requested_name"), "Nowa nazwa uczestnika")

    def test_participant_can_list_only_own_name_change_requests(self):
        tournament, division, _team, name_request = self._create_pending_request()

        self.client.force_authenticate(user=self.participant)

        response = self.client.get(
            self._api_url_for_view(
                "TournamentTeamNameChangeRequestListView",
                pk=tournament.id,
            )
            + f"?division_id={division.id}"
        )

        self.assertEqual(response.status_code, 200)

        items = self._response_items(response)

        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].get("id"), name_request.id)

    def test_organizer_can_approve_name_change_request(self):
        tournament, division, team, name_request = self._create_pending_request()

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            self._api_url_for_view(
                "TournamentTeamNameChangeRequestApproveView",
                pk=tournament.id,
                request_id=name_request.id,
            )
            + f"?division_id={division.id}"
        )

        self.assertEqual(response.status_code, 200)

        name_request.refresh_from_db()
        team.refresh_from_db()

        registration = self._registration_model().objects.get(
            tournament=tournament,
            division=division,
            user=self.participant,
        )

        self.assertEqual(name_request.status, self._name_change_request_model().Status.APPROVED)
        self.assertEqual(name_request.decided_by_id, self.organizer.id)
        self.assertIsNotNone(name_request.decided_at)
        self.assertEqual(team.name, "Nowa nazwa uczestnika")
        self.assertEqual(registration.display_name, "Nowa nazwa uczestnika")

    def test_organizer_can_reject_name_change_request(self):
        tournament, division, team, name_request = self._create_pending_request()

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            self._api_url_for_view(
                "TournamentTeamNameChangeRequestRejectView",
                pk=tournament.id,
                request_id=name_request.id,
            )
            + f"?division_id={division.id}"
        )

        self.assertEqual(response.status_code, 200)

        name_request.refresh_from_db()
        team.refresh_from_db()

        registration = self._registration_model().objects.get(
            tournament=tournament,
            division=division,
            user=self.participant,
        )

        self.assertEqual(name_request.status, self._name_change_request_model().Status.REJECTED)
        self.assertEqual(name_request.decided_by_id, self.organizer.id)
        self.assertIsNotNone(name_request.decided_at)
        self.assertEqual(team.name, "Stara nazwa uczestnika")
        self.assertEqual(registration.display_name, "Stara nazwa uczestnika")

    def test_participant_cannot_approve_own_name_change_request(self):
        tournament, division, _team, name_request = self._create_pending_request()

        self.client.force_authenticate(user=self.participant)

        response = self.client.post(
            self._api_url_for_view(
                "TournamentTeamNameChangeRequestApproveView",
                pk=tournament.id,
                request_id=name_request.id,
            )
            + f"?division_id={division.id}"
        )

        self.assertEqual(response.status_code, 403)

        name_request.refresh_from_db()
        self.assertEqual(name_request.status, self._name_change_request_model().Status.PENDING)


class TournamentAssistantAccessTests(TestCase):
    """Testy zabezpieczają centralną logikę uprawnień organizatora i asystentów."""

    def setUp(self):
        self.organizer = create_test_user("assistant-access-owner@example.com")
        self.assistant = create_test_user("assistant-access-user@example.com")
        self.pending_assistant = create_test_user("assistant-access-pending@example.com")
        self.other_user = create_test_user("assistant-access-other@example.com")

        self.tournament = Tournament.objects.create(
            name="Turniej uprawnień asystenta",
            discipline="football",
            organizer=self.organizer,
            entry_mode=Tournament.EntryMode.MANAGER,
        )

        self.membership_model = apps.get_model("tournaments", "TournamentMembership")

    def _create_membership(self, user, *, status=None, permissions=None):
        return self.membership_model.objects.create(
            tournament=self.tournament,
            user=user,
            role=self.membership_model.Role.ASSISTANT,
            status=status or self.membership_model.Status.ACCEPTED,
            permissions=permissions or {},
            invited_by=self.organizer,
        )

    def test_organizer_receives_all_permissions(self):
        from tournaments.access import get_my_permissions

        permissions = get_my_permissions(self.organizer, self.tournament)

        self.assertTrue(all(permissions.values()))
        self.assertTrue(permissions[self.membership_model.PERM_TEAMS_EDIT])
        self.assertTrue(permissions[self.membership_model.PERM_SCHEDULE_EDIT])
        self.assertTrue(permissions[self.membership_model.PERM_RESULTS_EDIT])
        self.assertTrue(permissions[self.membership_model.PERM_PUBLISH])
        self.assertTrue(permissions[self.membership_model.PERM_ARCHIVE])
        self.assertTrue(permissions[self.membership_model.PERM_MANAGE_ASSISTANTS])
        self.assertTrue(permissions[self.membership_model.PERM_JOIN_SETTINGS])

    def test_user_without_membership_receives_no_permissions(self):
        from tournaments.access import get_my_permissions

        permissions = get_my_permissions(self.other_user, self.tournament)

        self.assertTrue(permissions)
        self.assertFalse(any(permissions.values()))

    def test_accepted_assistant_receives_only_granted_regular_permissions(self):
        from tournaments.access import (
            can_edit_results,
            can_edit_schedule,
            can_edit_teams,
            get_my_permissions,
            user_is_assistant,
        )

        self._create_membership(
            self.assistant,
            permissions={
                self.membership_model.PERM_TEAMS_EDIT: True,
                self.membership_model.PERM_RESULTS_EDIT: True,
                self.membership_model.PERM_SCHEDULE_EDIT: False,
            },
        )

        permissions = get_my_permissions(self.assistant, self.tournament)

        self.assertTrue(user_is_assistant(self.assistant, self.tournament))
        self.assertTrue(permissions[self.membership_model.PERM_TEAMS_EDIT])
        self.assertTrue(permissions[self.membership_model.PERM_RESULTS_EDIT])
        self.assertFalse(permissions[self.membership_model.PERM_SCHEDULE_EDIT])

        self.assertTrue(can_edit_teams(self.assistant, self.tournament))
        self.assertTrue(can_edit_results(self.assistant, self.tournament))
        self.assertFalse(can_edit_schedule(self.assistant, self.tournament))

    def test_pending_assistant_is_not_treated_as_accepted_assistant(self):
        from tournaments.access import (
            can_edit_teams,
            get_my_permissions,
            user_has_pending_assistant_invite,
            user_is_assistant,
        )

        self._create_membership(
            self.pending_assistant,
            status=self.membership_model.Status.PENDING,
            permissions={
                self.membership_model.PERM_TEAMS_EDIT: True,
            },
        )

        permissions = get_my_permissions(self.pending_assistant, self.tournament)

        self.assertFalse(user_is_assistant(self.pending_assistant, self.tournament))
        self.assertTrue(user_has_pending_assistant_invite(self.pending_assistant, self.tournament))
        self.assertFalse(any(permissions.values()))
        self.assertFalse(can_edit_teams(self.pending_assistant, self.tournament))

    def test_assistant_never_receives_organizer_only_permissions_from_get_my_permissions(self):
        from tournaments.access import get_my_permissions

        self._create_membership(
            self.assistant,
            permissions={
                self.membership_model.PERM_TEAMS_EDIT: True,
                self.membership_model.PERM_PUBLISH: True,
                self.membership_model.PERM_ARCHIVE: True,
                self.membership_model.PERM_MANAGE_ASSISTANTS: True,
                self.membership_model.PERM_JOIN_SETTINGS: True,
            },
        )

        permissions = get_my_permissions(self.assistant, self.tournament)

        self.assertTrue(permissions[self.membership_model.PERM_TEAMS_EDIT])
        self.assertFalse(permissions[self.membership_model.PERM_PUBLISH])
        self.assertFalse(permissions[self.membership_model.PERM_ARCHIVE])
        self.assertFalse(permissions[self.membership_model.PERM_MANAGE_ASSISTANTS])
        self.assertFalse(permissions[self.membership_model.PERM_JOIN_SETTINGS])

    def test_assistant_management_permissions_are_organizer_only_helpers(self):
        from tournaments.access import can_manage_assistants, can_manage_join_settings

        self._create_membership(
            self.assistant,
            permissions={
                self.membership_model.PERM_MANAGE_ASSISTANTS: True,
                self.membership_model.PERM_JOIN_SETTINGS: True,
            },
        )

        self.assertTrue(can_manage_assistants(self.organizer, self.tournament))
        self.assertTrue(can_manage_join_settings(self.organizer, self.tournament))
        self.assertFalse(can_manage_assistants(self.assistant, self.tournament))
        self.assertFalse(can_manage_join_settings(self.assistant, self.tournament))

    def test_organizer_only_entry_mode_blocks_assistant_actions(self):
        from tournaments.access import (
            can_edit_results,
            can_edit_schedule,
            can_edit_teams,
            get_my_permissions,
            user_can_manage_tournament,
            user_is_assistant,
        )

        self.tournament.entry_mode = Tournament.EntryMode.ORGANIZER_ONLY
        self.tournament.save(update_fields=["entry_mode"])

        self._create_membership(
            self.assistant,
            permissions={
                self.membership_model.PERM_TEAMS_EDIT: True,
                self.membership_model.PERM_SCHEDULE_EDIT: True,
                self.membership_model.PERM_RESULTS_EDIT: True,
            },
        )

        permissions = get_my_permissions(self.assistant, self.tournament)

        self.assertTrue(user_is_assistant(self.assistant, self.tournament))
        self.assertFalse(any(permissions.values()))
        self.assertFalse(user_can_manage_tournament(self.assistant, self.tournament))
        self.assertFalse(can_edit_teams(self.assistant, self.tournament))
        self.assertFalse(can_edit_schedule(self.assistant, self.tournament))
        self.assertFalse(can_edit_results(self.assistant, self.tournament))

    def test_user_can_manage_tournament_accepts_both_argument_orders(self):
        from tournaments.access import user_can_manage_tournament

        self._create_membership(self.assistant)

        self.assertTrue(user_can_manage_tournament(self.organizer, self.tournament))
        self.assertTrue(user_can_manage_tournament(self.tournament, self.organizer))
        self.assertTrue(user_can_manage_tournament(self.assistant, self.tournament))
        self.assertTrue(user_can_manage_tournament(self.tournament, self.assistant))
        self.assertFalse(user_can_manage_tournament(self.other_user, self.tournament))

    def test_strict_permissions_require_explicit_raw_value(self):
        from tournaments.access import can_approve_name_changes, can_edit_roster, get_my_permissions

        self._create_membership(
            self.assistant,
            permissions={
                self.membership_model.PERM_TEAMS_EDIT: True,
            },
        )

        permissions = get_my_permissions(self.assistant, self.tournament)

        self.assertFalse(permissions[self.membership_model.PERM_ROSTER_EDIT])
        self.assertFalse(permissions[self.membership_model.PERM_NAME_CHANGE_APPROVE])
        self.assertFalse(can_edit_roster(self.assistant, self.tournament))
        self.assertFalse(can_approve_name_changes(self.assistant, self.tournament))

    def test_strict_permissions_are_enabled_when_explicitly_granted(self):
        from tournaments.access import can_approve_name_changes, can_edit_roster, get_my_permissions

        self._create_membership(
            self.assistant,
            permissions={
                self.membership_model.PERM_ROSTER_EDIT: True,
                self.membership_model.PERM_NAME_CHANGE_APPROVE: True,
            },
        )

        permissions = get_my_permissions(self.assistant, self.tournament)

        self.assertTrue(permissions[self.membership_model.PERM_ROSTER_EDIT])
        self.assertTrue(permissions[self.membership_model.PERM_NAME_CHANGE_APPROVE])
        self.assertTrue(can_edit_roster(self.assistant, self.tournament))
        self.assertTrue(can_approve_name_changes(self.assistant, self.tournament))

    def test_can_view_assistant_permissions_allows_organizer_and_own_assistant_only(self):
        from tournaments.access import can_view_assistant_permissions

        self._create_membership(self.assistant)

        self.assertTrue(can_view_assistant_permissions(self.organizer, self.tournament, self.assistant.id))
        self.assertTrue(can_view_assistant_permissions(self.assistant, self.tournament, self.assistant.id))
        self.assertFalse(can_view_assistant_permissions(self.assistant, self.tournament, self.other_user.id))
        self.assertFalse(can_view_assistant_permissions(self.other_user, self.tournament, self.assistant.id))

    def test_only_organizer_can_update_assistant_permissions(self):
        from tournaments.access import can_update_assistant_permissions

        self._create_membership(self.assistant)

        self.assertTrue(can_update_assistant_permissions(self.organizer, self.tournament))
        self.assertFalse(can_update_assistant_permissions(self.assistant, self.tournament))
        self.assertFalse(can_update_assistant_permissions(self.other_user, self.tournament))


class TournamentAssistantInviteApiTests(TestCase):
    """Testy API zabezpieczają przepływ zaproszeń asystenta do turnieju."""

    def setUp(self):
        self.organizer = create_test_user("assistant-api-owner@example.com")
        self.assistant = create_test_user("assistant-api-user@example.com")
        self.other_user = create_test_user("assistant-api-other@example.com")
        self.client = APIClient()

        self.tournament = Tournament.objects.create(
            name="Turniej API asystentów",
            discipline="football",
            organizer=self.organizer,
            entry_mode=Tournament.EntryMode.MANAGER,
        )

        self.membership_model = apps.get_model("tournaments", "TournamentMembership")
        self.invite_model = apps.get_model("tournaments", "TournamentAssistantInvite")

    def _permissions_payload(self):
        return {
            self.membership_model.PERM_TEAMS_EDIT: True,
            self.membership_model.PERM_SCHEDULE_EDIT: False,
            self.membership_model.PERM_RESULTS_EDIT: True,
            self.membership_model.PERM_ROSTER_EDIT: True,
            self.membership_model.PERM_NAME_CHANGE_APPROVE: False,
            self.membership_model.PERM_PUBLISH: True,
            self.membership_model.PERM_ARCHIVE: True,
            self.membership_model.PERM_MANAGE_ASSISTANTS: True,
            self.membership_model.PERM_JOIN_SETTINGS: True,
        }

    def _pending_invite(self, email=None, permissions=None):
        return self.invite_model.objects.create(
            tournament=self.tournament,
            invited_email=email or self.assistant.email,
            invited_by=self.organizer,
            permissions=permissions or self._permissions_payload(),
        )

    def _pending_membership(self, user=None, permissions=None):
        return self.membership_model.objects.create(
            tournament=self.tournament,
            user=user or self.assistant,
            role=self.membership_model.Role.ASSISTANT,
            status=self.membership_model.Status.PENDING,
            permissions=permissions or self._permissions_payload(),
            invited_by=self.organizer,
        )

    def _invite_for_assistant(self):
        return self.invite_model.objects.filter(
            tournament=self.tournament,
            normalized_email=self.assistant.email.lower(),
        ).order_by("-id").first()

    def _membership_for_assistant(self):
        return self.membership_model.objects.filter(
            tournament=self.tournament,
            user=self.assistant,
        ).order_by("-id").first()

    def test_organizer_can_create_pending_assistant_invite(self):
        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            f"/api/tournaments/{self.tournament.id}/assistants/add/",
            {
                "email": self.assistant.email,
                "permissions": self._permissions_payload(),
            },
            format="json",
        )

        self.assertIn(response.status_code, {200, 201, 202})

        invite = self._invite_for_assistant()

        self.assertIsNotNone(invite)
        self.assertEqual(invite.status, self.invite_model.Status.PENDING)
        self.assertEqual(invite.invited_by_id, self.organizer.id)
        self.assertEqual(invite.normalized_email, self.assistant.email.lower())
        self.assertTrue(invite.normalized_permissions()[self.membership_model.PERM_TEAMS_EDIT])
        self.assertTrue(invite.normalized_permissions()[self.membership_model.PERM_RESULTS_EDIT])
        self.assertFalse(invite.normalized_permissions()[self.membership_model.PERM_SCHEDULE_EDIT])

    def test_add_assistant_normalizes_email_and_reuses_existing_invite(self):
        self.client.force_authenticate(user=self.organizer)

        first_response = self.client.post(
            f"/api/tournaments/{self.tournament.id}/assistants/add/",
            {
                "email": f"  {self.assistant.email.upper()}  ",
                "permissions": {
                    self.membership_model.PERM_TEAMS_EDIT: True,
                },
            },
            format="json",
        )
        self.assertIn(first_response.status_code, {200, 201, 202})

        second_response = self.client.post(
            f"/api/tournaments/{self.tournament.id}/assistants/add/",
            {
                "email": self.assistant.email.lower(),
                "permissions": {
                    self.membership_model.PERM_RESULTS_EDIT: True,
                },
            },
            format="json",
        )
        self.assertIn(second_response.status_code, {200, 201, 202})

        invites = self.invite_model.objects.filter(
            tournament=self.tournament,
            normalized_email=self.assistant.email.lower(),
        )

        self.assertEqual(invites.count(), 1)

        invite = invites.get()

        self.assertEqual(invite.status, self.invite_model.Status.PENDING)
        self.assertTrue(invite.normalized_permissions()[self.membership_model.PERM_RESULTS_EDIT])

    def test_other_user_cannot_create_assistant_invite(self):
        self.client.force_authenticate(user=self.other_user)

        response = self.client.post(
            f"/api/tournaments/{self.tournament.id}/assistants/add/",
            {
                "email": self.assistant.email,
                "permissions": self._permissions_payload(),
            },
            format="json",
        )

        self.assertIn(response.status_code, {403, 404})
        self.assertFalse(
            self.invite_model.objects.filter(
                tournament=self.tournament,
                normalized_email=self.assistant.email.lower(),
            ).exists()
        )

    def test_assistant_can_accept_pending_invite(self):
        self._pending_invite()
        self.client.force_authenticate(user=self.assistant)

        response = self.client.post(
            f"/api/tournaments/{self.tournament.id}/assistant-invite/accept/"
        )

        self.assertEqual(response.status_code, 200)

        invite = self._invite_for_assistant()
        membership = self._membership_for_assistant()

        self.assertIsNotNone(invite)
        self.assertIsNotNone(membership)
        self.assertEqual(invite.status, self.invite_model.Status.ACCEPTED)
        self.assertIsNotNone(invite.responded_at)
        self.assertEqual(membership.status, self.membership_model.Status.ACCEPTED)
        self.assertEqual(membership.invited_by_id, self.organizer.id)
        self.assertTrue(membership.permissions.get(self.membership_model.PERM_TEAMS_EDIT))
        self.assertTrue(membership.permissions.get(self.membership_model.PERM_RESULTS_EDIT))

    def test_assistant_can_decline_pending_invite(self):
        self._pending_invite()
        self.client.force_authenticate(user=self.assistant)

        response = self.client.post(
            f"/api/tournaments/{self.tournament.id}/assistant-invite/decline/"
        )

        self.assertEqual(response.status_code, 200)

        invite = self._invite_for_assistant()
        membership = self._membership_for_assistant()

        self.assertIsNotNone(invite)
        self.assertEqual(invite.status, self.invite_model.Status.DECLINED)
        self.assertIsNotNone(invite.responded_at)

        if membership is not None:
            self.assertNotEqual(membership.status, self.membership_model.Status.ACCEPTED)

    def test_user_without_matching_invite_cannot_accept(self):
        self._pending_invite(email="someone-else@example.com")
        self.client.force_authenticate(user=self.assistant)

        response = self.client.post(
            f"/api/tournaments/{self.tournament.id}/assistant-invite/accept/"
        )

        self.assertIn(response.status_code, {400, 403, 404})
        self.assertIsNone(self._membership_for_assistant())

    def test_organizer_can_cancel_pending_assistant_invite(self):
        invite = self._pending_invite()
        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            f"/api/tournaments/{self.tournament.id}/assistant-invites/{invite.id}/cancel/"
        )

        self.assertEqual(response.status_code, 200)

        invite.refresh_from_db()

        self.assertEqual(invite.status, self.invite_model.Status.CANCELED)
        self.assertIsNotNone(invite.responded_at)

    def test_other_user_cannot_cancel_assistant_invite(self):
        invite = self._pending_invite()
        self.client.force_authenticate(user=self.other_user)

        response = self.client.post(
            f"/api/tournaments/{self.tournament.id}/assistant-invites/{invite.id}/cancel/"
        )

        self.assertIn(response.status_code, {403, 404})

        invite.refresh_from_db()

        self.assertEqual(invite.status, self.invite_model.Status.PENDING)

    def test_organizer_can_remove_accepted_assistant(self):
        self._pending_membership(
            permissions={
                self.membership_model.PERM_TEAMS_EDIT: True,
            }
        )
        membership = self._membership_for_assistant()
        membership.mark_accepted()
        membership.save(update_fields=["status", "responded_at"])

        self.client.force_authenticate(user=self.organizer)

        response = self.client.delete(
            f"/api/tournaments/{self.tournament.id}/assistants/{self.assistant.id}/remove/"
        )

        self.assertIn(response.status_code, {200, 204})
        self.assertFalse(
            self.membership_model.objects.filter(
                tournament=self.tournament,
                user=self.assistant,
                status=self.membership_model.Status.ACCEPTED,
            ).exists()
        )

    def test_assistant_cannot_remove_other_assistant(self):
        second_assistant = create_test_user("assistant-api-second@example.com")

        self._pending_membership(user=self.assistant)
        first_membership = self._membership_for_assistant()
        first_membership.mark_accepted()
        first_membership.save(update_fields=["status", "responded_at"])

        self.membership_model.objects.create(
            tournament=self.tournament,
            user=second_assistant,
            role=self.membership_model.Role.ASSISTANT,
            status=self.membership_model.Status.ACCEPTED,
            invited_by=self.organizer,
            permissions={self.membership_model.PERM_TEAMS_EDIT: True},
        )

        self.client.force_authenticate(user=self.assistant)

        response = self.client.delete(
            f"/api/tournaments/{self.tournament.id}/assistants/{second_assistant.id}/remove/"
        )

        self.assertIn(response.status_code, {403, 404})
        self.assertTrue(
            self.membership_model.objects.filter(
                tournament=self.tournament,
                user=second_assistant,
                status=self.membership_model.Status.ACCEPTED,
            ).exists()
        )

    def test_organizer_can_list_assistants_and_pending_invites(self):
        self._pending_invite(email="pending-assistant@example.com")
        self._pending_membership()
        membership = self._membership_for_assistant()
        membership.mark_accepted()
        membership.save(update_fields=["status", "responded_at"])

        self.client.force_authenticate(user=self.organizer)

        response = self.client.get(f"/api/tournaments/{self.tournament.id}/assistants/")

        self.assertEqual(response.status_code, 200)

        data = response.json()
        serialized = str(data)

        self.assertIn(self.assistant.email, serialized)
        self.assertIn("pending-assistant@example.com", serialized)

    def test_other_user_cannot_list_assistants(self):
        self.client.force_authenticate(user=self.other_user)

        response = self.client.get(f"/api/tournaments/{self.tournament.id}/assistants/")

        self.assertIn(response.status_code, {403, 404})


class TournamentMatchGenerationServiceTests(TestCase):
    """Testy zabezpieczają generowanie struktury rozgrywek w kontekście aktywnej dywizji."""

    bye_team_name = "__SYSTEM_BYE__"

    def setUp(self):
        self.organizer = create_test_user("match-generation-owner@example.com")

    def _create_tournament(self, name="Turniej generatora"):
        return Tournament.objects.create(
            name=name,
            discipline=Tournament.Discipline.FOOTBALL,
            organizer=self.organizer,
        )

    def _create_division(self, tournament, name, *, tournament_format=Tournament.TournamentFormat.LEAGUE, is_default=False):
        division = Division.objects.create(
            tournament=tournament,
            name=name,
            is_default=is_default,
        )
        division.competition_type = Tournament.CompetitionType.TEAM
        division.competition_model = Tournament.CompetitionModel.HEAD_TO_HEAD
        division.tournament_format = tournament_format
        division.result_mode = Tournament.ResultMode.SCORE
        division.format_config = {}
        division.result_config = {}
        division.save(
            update_fields=[
                "competition_type",
                "competition_model",
                "tournament_format",
                "result_mode",
                "format_config",
                "result_config",
            ]
        )
        return division

    def _create_teams(self, tournament, division, count):
        return [
            Team.objects.create(
                tournament=tournament,
                division=division,
                name=f"Drużyna {index}",
                is_active=True,
            )
            for index in range(1, count + 1)
        ]

    def _stage_model(self):
        return apps.get_model("tournaments", "Stage")

    def _match_model(self):
        return apps.get_model("tournaments", "Match")

    def test_league_generation_creates_stage_and_matches_for_selected_division(self):
        from tournaments.services.match_generation import ensure_matches_generated

        stage_model = self._stage_model()
        match_model = self._match_model()

        tournament = self._create_tournament()
        division = self._create_division(
            tournament,
            "Liga",
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            is_default=True,
        )
        self._create_teams(tournament, division, 4)

        ensure_matches_generated(tournament, division=division)

        stages = stage_model.objects.filter(tournament=tournament, division=division)
        matches = match_model.objects.filter(tournament=tournament, stage__division=division)

        self.assertTrue(stages.exists())
        self.assertTrue(matches.exists())
        self.assertTrue(all(stage.stage_type == stage_model.StageType.LEAGUE for stage in stages))

    def test_cup_generation_creates_knockout_stage_and_matches_for_selected_division(self):
        from tournaments.services.match_generation import ensure_matches_generated

        stage_model = self._stage_model()
        match_model = self._match_model()

        tournament = self._create_tournament("Turniej pucharowy generatora")
        division = self._create_division(
            tournament,
            "Puchar",
            tournament_format=Tournament.TournamentFormat.CUP,
            is_default=True,
        )
        self._create_teams(tournament, division, 4)

        ensure_matches_generated(tournament, division=division)

        stages = stage_model.objects.filter(tournament=tournament, division=division)
        matches = match_model.objects.filter(tournament=tournament, stage__division=division)

        self.assertTrue(stages.exists())
        self.assertTrue(matches.exists())
        self.assertTrue(stages.filter(stage_type=stage_model.StageType.KNOCKOUT).exists())

    def test_mixed_generation_creates_group_structure_for_selected_division(self):
        from tournaments.services.match_generation import ensure_matches_generated

        stage_model = self._stage_model()
        match_model = self._match_model()

        tournament = self._create_tournament("Turniej mieszany generatora")
        division = self._create_division(
            tournament,
            "Grupy i puchar",
            tournament_format=Tournament.TournamentFormat.MIXED,
            is_default=True,
        )
        division.format_config = {
            "groups_count": 2,
            "advance_per_group": 1,
        }
        division.save(update_fields=["format_config"])

        self._create_teams(tournament, division, 4)

        ensure_matches_generated(tournament, division=division)

        stages = stage_model.objects.filter(tournament=tournament, division=division)
        matches = match_model.objects.filter(tournament=tournament, stage__division=division)

        self.assertTrue(stages.exists())
        self.assertTrue(matches.exists())
        self.assertTrue(stages.filter(stage_type=stage_model.StageType.GROUP).exists())

    def test_generation_does_not_create_structure_with_less_than_two_real_teams(self):
        from tournaments.services.match_generation import ensure_matches_generated

        stage_model = self._stage_model()
        match_model = self._match_model()

        tournament = self._create_tournament("Turniej bez minimum uczestników")
        division = self._create_division(tournament, "Jedna drużyna", is_default=True)

        Team.objects.create(
            tournament=tournament,
            division=division,
            name="Drużyna 1",
            is_active=True,
        )

        ensure_matches_generated(tournament, division=division)

        self.assertFalse(stage_model.objects.filter(tournament=tournament, division=division).exists())
        self.assertFalse(match_model.objects.filter(tournament=tournament, stage__division=division).exists())

    def test_generation_ignores_technical_bye_when_counting_active_teams(self):
        from tournaments.services.match_generation import ensure_matches_generated

        stage_model = self._stage_model()

        tournament = self._create_tournament("Turniej z BYE")
        division = self._create_division(tournament, "BYE", is_default=True)

        Team.objects.create(
            tournament=tournament,
            division=division,
            name="Drużyna 1",
            is_active=True,
        )
        Team.objects.create(
            tournament=tournament,
            division=division,
            name=self.bye_team_name,
            is_active=True,
        )

        ensure_matches_generated(tournament, division=division)

        self.assertFalse(stage_model.objects.filter(tournament=tournament, division=division).exists())

    def test_generation_resets_only_selected_division_structure(self):
        from tournaments.services.match_generation import ensure_matches_generated

        stage_model = self._stage_model()

        tournament = self._create_tournament("Turniej izolacji dywizji")
        first_division = self._create_division(
            tournament,
            "Pierwsza dywizja",
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            is_default=True,
        )
        second_division = self._create_division(
            tournament,
            "Druga dywizja",
            tournament_format=Tournament.TournamentFormat.LEAGUE,
        )

        self._create_teams(tournament, first_division, 4)
        self._create_teams(tournament, second_division, 4)

        old_first_stage = stage_model.objects.create(
            tournament=tournament,
            division=first_division,
            stage_type=stage_model.StageType.LEAGUE,
            order=99,
        )
        second_stage = stage_model.objects.create(
            tournament=tournament,
            division=second_division,
            stage_type=stage_model.StageType.LEAGUE,
            order=99,
        )

        ensure_matches_generated(tournament, division=first_division)

        self.assertFalse(stage_model.objects.filter(id=old_first_stage.id).exists())
        self.assertTrue(stage_model.objects.filter(id=second_stage.id).exists())
        self.assertTrue(stage_model.objects.filter(tournament=tournament, division=first_division).exists())
        self.assertTrue(stage_model.objects.filter(tournament=tournament, division=second_division).exists())

    def test_generation_rejects_division_from_another_tournament(self):
        from tournaments.services.match_generation import ensure_matches_generated

        first_tournament = self._create_tournament("Pierwszy turniej generatora")
        second_tournament = self._create_tournament("Drugi turniej generatora")
        foreign_division = self._create_division(second_tournament, "Obca dywizja", is_default=True)

        with self.assertRaises(ValueError):
            ensure_matches_generated(first_tournament, division=foreign_division)


class TournamentMatchResultAndStandingsTests(TestCase):
    """Testy zabezpieczają zapis wyników, zmianę statusu meczu oraz obliczanie klasyfikacji."""

    bye_team_name = "__SYSTEM_BYE__"

    def setUp(self):
        self.organizer = create_test_user("match-result-owner@example.com")
        self.other_user = create_test_user("match-result-other@example.com")
        self.client = APIClient()

    def _stage_model(self):
        return apps.get_model("tournaments", "Stage")

    def _match_model(self):
        return apps.get_model("tournaments", "Match")

    def _create_tournament_context(
        self,
        *,
        name="Turniej wyników",
        discipline=Tournament.Discipline.FOOTBALL,
        teams_count=2,
    ):
        tournament = Tournament.objects.create(
            name=name,
            discipline=discipline,
            organizer=self.organizer,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
        )

        division = Division.objects.create(
            tournament=tournament,
            name="Dywizja główna",
            is_default=True,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            status=Tournament.Status.CONFIGURED,
        )

        stage_model = self._stage_model()
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
                name=f"Drużyna {index}",
                is_active=True,
            )
            for index in range(1, teams_count + 1)
        ]

        return tournament, division, stage, teams

    def _create_match(self, tournament, stage, home_team, away_team, *, status=None):
        match_model = self._match_model()

        return match_model.objects.create(
            tournament=tournament,
            stage=stage,
            home_team=home_team,
            away_team=away_team,
            round_number=1,
            status=status or match_model.Status.SCHEDULED,
        )

    def _standings_by_team_id(self, tournament, stage):
        from tournaments.services.standings.compute import compute_stage_standings

        return {
            row.team_id: row
            for row in compute_stage_standings(tournament, stage)
        }

    def test_organizer_can_save_match_result_and_move_match_to_in_progress(self):
        tournament, _division, stage, teams = self._create_tournament_context()
        match = self._create_match(tournament, stage, teams[0], teams[1])

        self.client.force_authenticate(user=self.organizer)

        response = self.client.patch(
            f"/api/matches/{match.id}/result/",
            {
                "home_score": 3,
                "away_score": 1,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        match.refresh_from_db()

        self.assertEqual(match.home_score, 3)
        self.assertEqual(match.away_score, 1)
        self.assertTrue(match.result_entered)
        self.assertEqual(match.status, self._match_model().Status.IN_PROGRESS)

    def test_other_user_cannot_save_match_result(self):
        tournament, _division, stage, teams = self._create_tournament_context()
        match = self._create_match(tournament, stage, teams[0], teams[1])

        self.client.force_authenticate(user=self.other_user)

        response = self.client.patch(
            f"/api/matches/{match.id}/result/",
            {
                "home_score": 2,
                "away_score": 1,
            },
            format="json",
        )

        self.assertIn(response.status_code, {403, 404})

        match.refresh_from_db()

        self.assertFalse(match.result_entered)
        self.assertNotEqual(match.home_score, 2)
        self.assertNotEqual(match.away_score, 1)

    def test_organizer_can_finish_match_after_result_is_entered(self):
        tournament, _division, stage, teams = self._create_tournament_context()
        match = self._create_match(tournament, stage, teams[0], teams[1])

        self.client.force_authenticate(user=self.organizer)

        result_response = self.client.patch(
            f"/api/matches/{match.id}/result/",
            {
                "home_score": 1,
                "away_score": 0,
            },
            format="json",
        )
        self.assertEqual(result_response.status_code, 200)

        finish_response = self.client.post(f"/api/matches/{match.id}/finish/")

        self.assertEqual(finish_response.status_code, 200)

        match.refresh_from_db()

        self.assertEqual(match.status, self._match_model().Status.FINISHED)

    def test_organizer_can_finish_match_without_explicit_result_as_zero_zero(self):
        tournament, _division, stage, teams = self._create_tournament_context()
        match = self._create_match(tournament, stage, teams[0], teams[1])

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(f"/api/matches/{match.id}/finish/")

        self.assertEqual(response.status_code, 200)

        match.refresh_from_db()

        self.assertEqual(match.status, self._match_model().Status.FINISHED)

    
    def test_continue_match_moves_finished_match_back_to_in_progress(self):
        tournament, _division, stage, teams = self._create_tournament_context()
        match = self._create_match(
            tournament,
            stage,
            teams[0],
            teams[1],
            status=self._match_model().Status.FINISHED,
        )
        match.home_score = 2
        match.away_score = 1
        match.result_entered = True
        match.save(update_fields=["home_score", "away_score", "result_entered"])

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(f"/api/matches/{match.id}/continue/")

        self.assertEqual(response.status_code, 200)

        match.refresh_from_db()

        self.assertEqual(match.status, self._match_model().Status.IN_PROGRESS)

    def test_football_win_gives_three_points_in_standings(self):
        tournament, _division, stage, teams = self._create_tournament_context(
            discipline=Tournament.Discipline.FOOTBALL,
        )
        match = self._create_match(
            tournament,
            stage,
            teams[0],
            teams[1],
            status=self._match_model().Status.FINISHED,
        )
        match.home_score = 2
        match.away_score = 0
        match.result_entered = True
        match.save(update_fields=["home_score", "away_score", "result_entered"])

        standings = self._standings_by_team_id(tournament, stage)

        self.assertEqual(standings[teams[0].id].points, 3)
        self.assertEqual(standings[teams[0].id].wins, 1)
        self.assertEqual(standings[teams[1].id].points, 0)
        self.assertEqual(standings[teams[1].id].losses, 1)

    def test_football_draw_gives_one_point_to_each_team(self):
        tournament, _division, stage, teams = self._create_tournament_context(
            discipline=Tournament.Discipline.FOOTBALL,
        )
        match = self._create_match(
            tournament,
            stage,
            teams[0],
            teams[1],
            status=self._match_model().Status.FINISHED,
        )
        match.home_score = 1
        match.away_score = 1
        match.result_entered = True
        match.save(update_fields=["home_score", "away_score", "result_entered"])

        standings = self._standings_by_team_id(tournament, stage)

        self.assertEqual(standings[teams[0].id].points, 1)
        self.assertEqual(standings[teams[1].id].points, 1)
        self.assertEqual(standings[teams[0].id].draws, 1)
        self.assertEqual(standings[teams[1].id].draws, 1)

    def test_basketball_win_gives_two_points_to_winner_and_one_to_loser(self):
        tournament, _division, stage, teams = self._create_tournament_context(
            name="Turniej koszykarski wyników",
            discipline=Tournament.Discipline.BASKETBALL,
        )
        match = self._create_match(
            tournament,
            stage,
            teams[0],
            teams[1],
            status=self._match_model().Status.FINISHED,
        )
        match.home_score = 80
        match.away_score = 72
        match.result_entered = True
        match.save(update_fields=["home_score", "away_score", "result_entered"])

        standings = self._standings_by_team_id(tournament, stage)

        self.assertEqual(standings[teams[0].id].points, 2)
        self.assertEqual(standings[teams[1].id].points, 1)
        self.assertEqual(standings[teams[0].id].wins, 1)
        self.assertEqual(standings[teams[1].id].losses, 1)

    def test_standings_ignore_technical_bye_team(self):
        tournament, division, stage, teams = self._create_tournament_context(
            name="Turniej z BYE w tabeli",
            discipline=Tournament.Discipline.FOOTBALL,
        )
        bye_team = Team.objects.create(
            tournament=tournament,
            division=division,
            name=self.bye_team_name,
            is_active=True,
        )
        match = self._create_match(
            tournament,
            stage,
            teams[0],
            bye_team,
            status=self._match_model().Status.FINISHED,
        )
        match.home_score = 3
        match.away_score = 0
        match.result_entered = True
        match.save(update_fields=["home_score", "away_score", "result_entered"])

        standings = self._standings_by_team_id(tournament, stage)

        self.assertIn(teams[0].id, standings)
        self.assertNotIn(bye_team.id, standings)


class TournamentMatchListAndScheduleApiTests(TestCase):
    """Testy API zabezpieczają listowanie meczów oraz edycję harmonogramu."""

    def setUp(self):
        self.organizer = create_test_user("match-schedule-owner@example.com")
        self.other_user = create_test_user("match-schedule-other@example.com")
        self.client = APIClient()

    def _stage_model(self):
        return apps.get_model("tournaments", "Stage")

    def _match_model(self):
        return apps.get_model("tournaments", "Match")

    def _response_items(self, response):
        data = response.json()

        if isinstance(data, list):
            return data

        if isinstance(data, dict) and isinstance(data.get("results"), list):
            return data["results"]

        return []

    def _create_context(self):
        tournament = Tournament.objects.create(
            name="Turniej harmonogramu",
            discipline=Tournament.Discipline.FOOTBALL,
            organizer=self.organizer,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
        )

        first_division = Division.objects.create(
            tournament=tournament,
            name="Pierwsza dywizja",
            is_default=True,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            status=Tournament.Status.CONFIGURED,
        )

        second_division = Division.objects.create(
            tournament=tournament,
            name="Druga dywizja",
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.SCORE,
            status=Tournament.Status.CONFIGURED,
        )

        stage_model = self._stage_model()
        first_stage = stage_model.objects.create(
            tournament=tournament,
            division=first_division,
            stage_type=stage_model.StageType.LEAGUE,
            order=1,
        )
        second_stage = stage_model.objects.create(
            tournament=tournament,
            division=second_division,
            stage_type=stage_model.StageType.LEAGUE,
            order=1,
        )

        first_teams = [
            Team.objects.create(
                tournament=tournament,
                division=first_division,
                name=f"Pierwsza {index}",
                is_active=True,
            )
            for index in range(1, 3)
        ]

        second_teams = [
            Team.objects.create(
                tournament=tournament,
                division=second_division,
                name=f"Druga {index}",
                is_active=True,
            )
            for index in range(1, 3)
        ]

        match_model = self._match_model()
        first_match = match_model.objects.create(
            tournament=tournament,
            stage=first_stage,
            home_team=first_teams[0],
            away_team=first_teams[1],
            round_number=1,
            status=match_model.Status.SCHEDULED,
        )
        second_match = match_model.objects.create(
            tournament=tournament,
            stage=second_stage,
            home_team=second_teams[0],
            away_team=second_teams[1],
            round_number=1,
            status=match_model.Status.SCHEDULED,
        )

        return tournament, first_division, second_division, first_match, second_match

    def test_organizer_sees_matches_from_selected_division(self):
        tournament, first_division, _second_division, first_match, _second_match = self._create_context()

        self.client.force_authenticate(user=self.organizer)

        response = self.client.get(
            f"/api/tournaments/{tournament.id}/matches/?division_id={first_division.id}"
        )

        self.assertEqual(response.status_code, 200)

        items = self._response_items(response)

        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].get("id"), first_match.id)
        self.assertEqual(items[0].get("division_id"), first_division.id)

    def test_match_list_does_not_mix_matches_between_divisions(self):
        tournament, first_division, second_division, first_match, second_match = self._create_context()

        self.client.force_authenticate(user=self.organizer)

        first_response = self.client.get(
            f"/api/tournaments/{tournament.id}/matches/?division_id={first_division.id}"
        )
        second_response = self.client.get(
            f"/api/tournaments/{tournament.id}/matches/?division_id={second_division.id}"
        )

        self.assertEqual(first_response.status_code, 200)
        self.assertEqual(second_response.status_code, 200)

        first_ids = {item.get("id") for item in self._response_items(first_response)}
        second_ids = {item.get("id") for item in self._response_items(second_response)}

        self.assertIn(first_match.id, first_ids)
        self.assertNotIn(second_match.id, first_ids)

        self.assertIn(second_match.id, second_ids)
        self.assertNotIn(first_match.id, second_ids)

    def test_other_user_receives_empty_panel_match_list_for_private_tournament(self):
        tournament, first_division, _second_division, _first_match, _second_match = self._create_context()

        self.client.force_authenticate(user=self.other_user)

        response = self.client.get(
            f"/api/tournaments/{tournament.id}/matches/?division_id={first_division.id}"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._response_items(response), [])

    def test_public_match_list_rejects_unpublished_tournament(self):
        tournament, first_division, _second_division, _first_match, _second_match = self._create_context()

        response = self.client.get(
            f"/api/tournaments/{tournament.id}/public/matches/?division_id={first_division.id}"
        )

        self.assertIn(response.status_code, {403, 404})

    def test_public_match_list_returns_matches_for_published_tournament(self):
        tournament, first_division, _second_division, first_match, _second_match = self._create_context()
        tournament.is_published = True
        tournament.save(update_fields=["is_published"])

        response = self.client.get(
            f"/api/tournaments/{tournament.id}/public/matches/?division_id={first_division.id}"
        )

        self.assertEqual(response.status_code, 200)

        items = self._response_items(response)

        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].get("id"), first_match.id)
        self.assertEqual(items[0].get("division_id"), first_division.id)

    def test_organizer_can_update_match_schedule(self):
        _tournament, _first_division, _second_division, first_match, _second_match = self._create_context()

        self.client.force_authenticate(user=self.organizer)

        response = self.client.patch(
            f"/api/matches/{first_match.id}/",
            {
                "scheduled_date": "2026-06-01",
                "scheduled_time": "18:30:00",
                "location": "Boisko główne",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        first_match.refresh_from_db()

        self.assertEqual(str(first_match.scheduled_date), "2026-06-01")
        self.assertEqual(str(first_match.scheduled_time), "18:30:00")
        self.assertEqual(first_match.location, "Boisko główne")

    def test_other_user_cannot_update_match_schedule(self):
        _tournament, _first_division, _second_division, first_match, _second_match = self._create_context()

        self.client.force_authenticate(user=self.other_user)

        response = self.client.patch(
            f"/api/matches/{first_match.id}/",
            {
                "scheduled_date": "2026-06-01",
                "scheduled_time": "18:30:00",
                "location": "Niedozwolone boisko",
            },
            format="json",
        )

        self.assertIn(response.status_code, {403, 404})

        first_match.refresh_from_db()

        self.assertIsNone(first_match.scheduled_date)
        self.assertIsNone(first_match.scheduled_time)
        self.assertNotEqual(first_match.location, "Niedozwolone boisko")

    def test_schedule_update_ignores_result_fields(self):
        _tournament, _first_division, _second_division, first_match, _second_match = self._create_context()

        first_match.home_score = 1
        first_match.away_score = 1
        first_match.result_entered = True
        first_match.save(update_fields=["home_score", "away_score", "result_entered"])

        self.client.force_authenticate(user=self.organizer)

        response = self.client.patch(
            f"/api/matches/{first_match.id}/",
            {
                "scheduled_date": "2026-06-02",
                "home_score": 5,
                "away_score": 0,
                "status": self._match_model().Status.FINISHED,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        first_match.refresh_from_db()

        self.assertEqual(str(first_match.scheduled_date), "2026-06-02")
        self.assertEqual(first_match.home_score, 1)
        self.assertEqual(first_match.away_score, 1)
        self.assertTrue(first_match.result_entered)
        self.assertNotEqual(first_match.status, self._match_model().Status.FINISHED)

    def test_set_scheduled_resets_clean_match_status(self):
        _tournament, _first_division, _second_division, first_match, _second_match = self._create_context()

        first_match.status = self._match_model().Status.IN_PROGRESS
        first_match.result_entered = True
        first_match.save(update_fields=["status", "result_entered"])

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(f"/api/matches/{first_match.id}/set-scheduled/")

        self.assertEqual(response.status_code, 200)

        first_match.refresh_from_db()

        self.assertEqual(first_match.status, self._match_model().Status.SCHEDULED)
        self.assertFalse(first_match.result_entered)
        self.assertIsNone(first_match.winner_id)

    def test_set_scheduled_rejects_match_with_score_data(self):
        _tournament, _first_division, _second_division, first_match, _second_match = self._create_context()

        first_match.status = self._match_model().Status.FINISHED
        first_match.home_score = 2
        first_match.away_score = 1
        first_match.result_entered = True
        first_match.save(update_fields=["status", "home_score", "away_score", "result_entered"])

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(f"/api/matches/{first_match.id}/set-scheduled/")

        self.assertEqual(response.status_code, 409)

        first_match.refresh_from_db()

        self.assertEqual(first_match.status, self._match_model().Status.FINISHED)
        self.assertTrue(first_match.result_entered)
        self.assertEqual(first_match.home_score, 2)
        self.assertEqual(first_match.away_score, 1)


class TournamentCustomMatchResultApiTests(TestCase):
    """Testy API zabezpieczają zapis customowych wyników pojedynczego meczu."""

    def setUp(self):
        self.organizer = create_test_user("custom-result-owner@example.com")
        self.other_user = create_test_user("custom-result-other@example.com")
        self.client = APIClient()

    def _stage_model(self):
        return apps.get_model("tournaments", "Stage")

    def _match_model(self):
        return apps.get_model("tournaments", "Match")

    def _custom_result_model(self):
        return apps.get_model("tournaments", "MatchCustomResult")

    def _create_context(
        self,
        *,
        value_kind=None,
        better_result=None,
        custom_mode=None,
        decimal_places=0,
        result_mode=None,
        name="Turniej customowych wyników",
    ):
        value_kind = value_kind or Tournament.RESULTCFG_VALUE_KIND_NUMBER
        better_result = better_result or Tournament.RESULTCFG_BETTER_RESULT_HIGHER
        custom_mode = custom_mode or Tournament.RESULTCFG_CUSTOM_MODE_MASS_START_MEASURED
        result_mode = result_mode or Tournament.ResultMode.CUSTOM

        tournament = Tournament.objects.create(
            name=name,
            discipline=Tournament.Discipline.CUSTOM,
            custom_discipline_name="Test custom",
            organizer=self.organizer,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=result_mode,
        )

        result_config = {
            Tournament.RESULTCFG_CUSTOM_MODE_KEY: custom_mode,
            Tournament.RESULTCFG_VALUE_KIND_KEY: value_kind,
            Tournament.RESULTCFG_BETTER_RESULT_KEY: better_result,
            Tournament.RESULTCFG_DECIMAL_PLACES_KEY: decimal_places,
            Tournament.RESULTCFG_ALLOW_TIES_KEY: True,
        }

        if value_kind == Tournament.RESULTCFG_VALUE_KIND_TIME:
            result_config[Tournament.RESULTCFG_TIME_FORMAT_KEY] = Tournament.RESULTCFG_TIME_FORMAT_SS_HH

        division = Division.objects.create(
            tournament=tournament,
            name="Dywizja custom",
            is_default=True,
            competition_type=Tournament.CompetitionType.TEAM,
            competition_model=Tournament.CompetitionModel.HEAD_TO_HEAD,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=result_mode,
            result_config=result_config if result_mode == Tournament.ResultMode.CUSTOM else {},
            status=Tournament.Status.CONFIGURED,
        )

        stage = self._stage_model().objects.create(
            tournament=tournament,
            division=division,
            stage_type=self._stage_model().StageType.LEAGUE,
            order=1,
        )

        teams = [
            Team.objects.create(
                tournament=tournament,
                division=division,
                name=f"Zespół custom {index}",
                is_active=True,
            )
            for index in range(1, 3)
        ]

        match = self._match_model().objects.create(
            tournament=tournament,
            stage=stage,
            home_team=teams[0],
            away_team=teams[1],
            round_number=1,
            status=self._match_model().Status.SCHEDULED,
        )

        return tournament, division, stage, teams, match

    def test_organizer_can_save_numeric_custom_result(self):
        _tournament, _division, _stage, teams, match = self._create_context(
            decimal_places=2,
        )

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            f"/api/matches/{match.id}/custom-result/",
            {
                "team_id": teams[0].id,
                "numeric_value": "12.35",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        result = self._custom_result_model().objects.get(match=match, team=teams[0])
        match.refresh_from_db()

        self.assertEqual(result.value_kind, Tournament.RESULTCFG_VALUE_KIND_NUMBER)
        self.assertEqual(result.display_value, "12.35")
        self.assertEqual(result.rank, 1)
        self.assertTrue(result.is_active)
        self.assertTrue(match.result_entered)
        self.assertEqual(match.status, self._match_model().Status.IN_PROGRESS)
        self.assertEqual(match.winner_id, teams[0].id)

    def test_second_numeric_custom_result_recalculates_rank_and_winner(self):
        _tournament, _division, _stage, teams, match = self._create_context()

        self.client.force_authenticate(user=self.organizer)

        first_response = self.client.post(
            f"/api/matches/{match.id}/custom-result/",
            {
                "team_id": teams[0].id,
                "numeric_value": "10",
            },
            format="json",
        )
        self.assertEqual(first_response.status_code, 200)

        second_response = self.client.post(
            f"/api/matches/{match.id}/custom-result/",
            {
                "team_id": teams[1].id,
                "numeric_value": "15",
            },
            format="json",
        )
        self.assertEqual(second_response.status_code, 200)

        home_result = self._custom_result_model().objects.get(match=match, team=teams[0])
        away_result = self._custom_result_model().objects.get(match=match, team=teams[1])
        match.refresh_from_db()

        self.assertEqual(home_result.rank, 2)
        self.assertEqual(away_result.rank, 1)
        self.assertEqual(match.winner_id, teams[1].id)

    def test_saving_custom_result_for_same_team_updates_existing_row(self):
        _tournament, _division, _stage, teams, match = self._create_context()

        self.client.force_authenticate(user=self.organizer)

        first_response = self.client.post(
            f"/api/matches/{match.id}/custom-result/",
            {
                "team_id": teams[0].id,
                "numeric_value": "10",
            },
            format="json",
        )
        self.assertEqual(first_response.status_code, 200)

        second_response = self.client.post(
            f"/api/matches/{match.id}/custom-result/",
            {
                "team_id": teams[0].id,
                "numeric_value": "20",
            },
            format="json",
        )
        self.assertEqual(second_response.status_code, 200)

        results = self._custom_result_model().objects.filter(match=match, team=teams[0])

        self.assertEqual(results.count(), 1)
        self.assertEqual(results.get().display_value, "20")

    def test_time_custom_result_uses_lower_value_as_better_when_configured(self):
        _tournament, _division, _stage, teams, match = self._create_context(
            value_kind=Tournament.RESULTCFG_VALUE_KIND_TIME,
            better_result=Tournament.RESULTCFG_BETTER_RESULT_LOWER,
        )

        self.client.force_authenticate(user=self.organizer)

        slower_response = self.client.post(
            f"/api/matches/{match.id}/custom-result/",
            {
                "team_id": teams[0].id,
                "time_ms": 10000,
            },
            format="json",
        )
        self.assertEqual(slower_response.status_code, 200)

        faster_response = self.client.post(
            f"/api/matches/{match.id}/custom-result/",
            {
                "team_id": teams[1].id,
                "time_ms": 8000,
            },
            format="json",
        )
        self.assertEqual(faster_response.status_code, 200)

        slower_result = self._custom_result_model().objects.get(match=match, team=teams[0])
        faster_result = self._custom_result_model().objects.get(match=match, team=teams[1])
        match.refresh_from_db()

        self.assertEqual(slower_result.rank, 2)
        self.assertEqual(faster_result.rank, 1)
        self.assertEqual(faster_result.time_ms, 8000)
        self.assertEqual(match.winner_id, teams[1].id)

    def test_place_custom_result_accepts_place_value(self):
        _tournament, _division, _stage, teams, match = self._create_context(
            value_kind=Tournament.RESULTCFG_VALUE_KIND_PLACE,
            better_result=Tournament.RESULTCFG_BETTER_RESULT_LOWER,
        )

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            f"/api/matches/{match.id}/custom-result/",
            {
                "team_id": teams[0].id,
                "place_value": 1,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        result = self._custom_result_model().objects.get(match=match, team=teams[0])

        self.assertEqual(result.value_kind, Tournament.RESULTCFG_VALUE_KIND_PLACE)
        self.assertEqual(result.place_value, 1)
        self.assertEqual(result.display_value, "1")
        self.assertEqual(result.rank, 1)

    def test_custom_result_rejects_team_outside_match(self):
        tournament, division, _stage, _teams, match = self._create_context()

        foreign_team = Team.objects.create(
            tournament=tournament,
            division=division,
            name="Obcy zespół w tej samej dywizji",
            is_active=True,
        )

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            f"/api/matches/{match.id}/custom-result/",
            {
                "team_id": foreign_team.id,
                "numeric_value": "10",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(
            self._custom_result_model().objects.filter(match=match, team=foreign_team).exists()
        )

    def test_other_user_cannot_save_custom_result(self):
        _tournament, _division, _stage, teams, match = self._create_context()

        self.client.force_authenticate(user=self.other_user)

        response = self.client.post(
            f"/api/matches/{match.id}/custom-result/",
            {
                "team_id": teams[0].id,
                "numeric_value": "10",
            },
            format="json",
        )

        self.assertIn(response.status_code, {403, 404})
        self.assertFalse(
            self._custom_result_model().objects.filter(match=match, team=teams[0]).exists()
        )

    def test_custom_result_endpoint_rejects_standard_score_match(self):
        _tournament, _division, _stage, teams, match = self._create_context(
            result_mode=Tournament.ResultMode.SCORE,
            name="Turniej bez custom result",
        )

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            f"/api/matches/{match.id}/custom-result/",
            {
                "team_id": teams[0].id,
                "numeric_value": "10",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(self._custom_result_model().objects.filter(match=match).exists())

    def test_custom_result_endpoint_rejects_head_to_head_points_table_mode(self):
        _tournament, _division, _stage, teams, match = self._create_context(
            custom_mode=Tournament.RESULTCFG_CUSTOM_MODE_HEAD_TO_HEAD_POINTS,
            name="Turniej custom punktowy",
        )

        self.client.force_authenticate(user=self.organizer)

        response = self.client.post(
            f"/api/matches/{match.id}/custom-result/",
            {
                "team_id": teams[0].id,
                "numeric_value": "10",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(self._custom_result_model().objects.filter(match=match).exists())


class TournamentMassStartStructureTests(TestCase):
    """Testy zabezpieczają strukturę etapów i wyników modelu MASS_START."""

    def setUp(self):
        self.organizer = create_test_user("mass-start-owner@example.com")

    def _stage_model(self):
        return apps.get_model("tournaments", "Stage")

    def _group_model(self):
        return apps.get_model("tournaments", "Group")

    def _entry_model(self):
        return apps.get_model("tournaments", "StageMassStartEntry")

    def _result_model(self):
        return apps.get_model("tournaments", "StageMassStartResult")

    def _match_model(self):
        return apps.get_model("tournaments", "Match")

    def _result_config(
        self,
        *,
        value_kind=None,
        better_result=None,
        rounds_count=1,
        stages=None,
        decimal_places=0,
    ):
        value_kind = value_kind or Tournament.RESULTCFG_VALUE_KIND_NUMBER
        better_result = better_result or Tournament.RESULTCFG_BETTER_RESULT_HIGHER

        return {
            Tournament.RESULTCFG_CUSTOM_MODE_KEY: Tournament.RESULTCFG_CUSTOM_MODE_MASS_START_MEASURED,
            Tournament.RESULTCFG_VALUE_KIND_KEY: value_kind,
            Tournament.RESULTCFG_BETTER_RESULT_KEY: better_result,
            Tournament.RESULTCFG_DECIMAL_PLACES_KEY: decimal_places,
            Tournament.RESULTCFG_ROUNDS_COUNT_KEY: rounds_count,
            Tournament.RESULTCFG_STAGES_KEY: stages
            or [
                {
                    Tournament.RESULTCFG_STAGE_NAME_KEY: "Finał",
                    Tournament.RESULTCFG_STAGE_GROUPS_COUNT_KEY: 1,
                    Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY: rounds_count,
                }
            ],
        }

    def _create_mass_start_context(
        self,
        *,
        name="Turniej MASS_START",
        teams_count=4,
        result_config=None,
    ):
        tournament = Tournament.objects.create(
            name=name,
            discipline=Tournament.Discipline.CUSTOM,
            custom_discipline_name="Test wspólnego startu",
            organizer=self.organizer,
            competition_type=Tournament.CompetitionType.INDIVIDUAL,
            competition_model=Tournament.CompetitionModel.MASS_START,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.CUSTOM,
            result_config=result_config or self._result_config(),
        )

        division = Division.objects.create(
            tournament=tournament,
            name="Dywizja MASS_START",
            is_default=True,
            competition_type=Tournament.CompetitionType.INDIVIDUAL,
            competition_model=Tournament.CompetitionModel.MASS_START,
            tournament_format=Tournament.TournamentFormat.LEAGUE,
            result_mode=Tournament.ResultMode.CUSTOM,
            result_config=result_config or self._result_config(),
            status=Tournament.Status.CONFIGURED,
        )

        teams = [
            Team.objects.create(
                tournament=tournament,
                division=division,
                name=f"Zawodnik {index}",
                is_active=True,
            )
            for index in range(1, teams_count + 1)
        ]

        return tournament, division, teams

    def test_sync_mass_start_structure_creates_stage_group_and_entries(self):
        from tournaments.views.tournaments import sync_custom_mass_start_structure_for_division

        stage_model = self._stage_model()
        group_model = self._group_model()
        entry_model = self._entry_model()

        tournament, division, teams = self._create_mass_start_context()

        sync_custom_mass_start_structure_for_division(tournament, division)

        stages = stage_model.objects.filter(
            tournament=tournament,
            division=division,
            stage_type=stage_model.StageType.MASS_START,
        )
        groups = group_model.objects.filter(stage__in=stages)
        entries = entry_model.objects.filter(stage__in=stages, is_active=True)

        self.assertEqual(stages.count(), 1)
        self.assertEqual(stages.first().status, stage_model.Status.OPEN)
        self.assertEqual(groups.count(), 1)
        self.assertEqual(entries.count(), len(teams))
        self.assertEqual(
            list(entries.order_by("seed").values_list("team_id", flat=True)),
            [team.id for team in teams],
        )

    def test_sync_mass_start_structure_distributes_entries_between_groups(self):
        from tournaments.views.tournaments import sync_custom_mass_start_structure_for_division

        group_model = self._group_model()
        entry_model = self._entry_model()

        result_config = self._result_config(
            stages=[
                {
                    Tournament.RESULTCFG_STAGE_NAME_KEY: "Kwalifikacje",
                    Tournament.RESULTCFG_STAGE_GROUPS_COUNT_KEY: 2,
                    Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY: 1,
                }
            ]
        )
        tournament, division, _teams = self._create_mass_start_context(
            name="Turniej MASS_START grupy",
            teams_count=5,
            result_config=result_config,
        )

        sync_custom_mass_start_structure_for_division(tournament, division)

        groups = list(group_model.objects.filter(stage__division=division).order_by("id"))
        group_sizes = [
            entry_model.objects.filter(stage__division=division, group=group, is_active=True).count()
            for group in groups
        ]

        self.assertEqual(len(groups), 2)
        self.assertEqual(group_sizes, [3, 2])

    def test_sync_mass_start_structure_respects_stage_participants_limit(self):
        from tournaments.views.tournaments import sync_custom_mass_start_structure_for_division

        entry_model = self._entry_model()

        result_config = self._result_config(
            stages=[
                {
                    Tournament.RESULTCFG_STAGE_NAME_KEY: "Limitowany etap",
                    Tournament.RESULTCFG_STAGE_GROUPS_COUNT_KEY: 1,
                    Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY: 1,
                    Tournament.RESULTCFG_STAGE_PARTICIPANTS_COUNT_KEY: 3,
                }
            ]
        )
        tournament, division, teams = self._create_mass_start_context(
            name="Turniej MASS_START limit",
            teams_count=5,
            result_config=result_config,
        )

        sync_custom_mass_start_structure_for_division(tournament, division)

        entries = entry_model.objects.filter(stage__division=division, is_active=True).order_by("seed")

        self.assertEqual(entries.count(), 3)
        self.assertEqual(
            list(entries.values_list("team_id", flat=True)),
            [team.id for team in teams[:3]],
        )

    def test_sync_mass_start_structure_creates_multiple_stages(self):
        from tournaments.views.tournaments import sync_custom_mass_start_structure_for_division

        stage_model = self._stage_model()

        result_config = self._result_config(
            stages=[
                {
                    Tournament.RESULTCFG_STAGE_NAME_KEY: "Kwalifikacje",
                    Tournament.RESULTCFG_STAGE_GROUPS_COUNT_KEY: 2,
                    Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY: 1,
                },
                {
                    Tournament.RESULTCFG_STAGE_NAME_KEY: "Finał",
                    Tournament.RESULTCFG_STAGE_GROUPS_COUNT_KEY: 1,
                    Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY: 1,
                },
            ]
        )
        tournament, division, _teams = self._create_mass_start_context(
            name="Turniej MASS_START dwa etapy",
            result_config=result_config,
        )

        sync_custom_mass_start_structure_for_division(tournament, division)

        stages = list(stage_model.objects.filter(tournament=tournament, division=division).order_by("order"))

        self.assertEqual(len(stages), 2)
        self.assertEqual(stages[0].status, stage_model.Status.OPEN)
        self.assertEqual(stages[1].status, stage_model.Status.PLANNED)

    def test_sync_mass_start_structure_removes_stale_non_mass_start_stages_in_division(self):
        from tournaments.views.tournaments import sync_custom_mass_start_structure_for_division

        stage_model = self._stage_model()
        match_model = self._match_model()

        tournament, division, teams = self._create_mass_start_context()

        stale_stage = stage_model.objects.create(
            tournament=tournament,
            division=division,
            stage_type=stage_model.StageType.LEAGUE,
            order=99,
        )
        match_model.objects.create(
            tournament=tournament,
            stage=stale_stage,
            home_team=teams[0],
            away_team=teams[1],
            round_number=1,
        )

        sync_custom_mass_start_structure_for_division(tournament, division)

        self.assertFalse(stage_model.objects.filter(id=stale_stage.id).exists())
        self.assertFalse(match_model.objects.filter(stage=stale_stage).exists())
        self.assertTrue(
            stage_model.objects.filter(
                tournament=tournament,
                division=division,
                stage_type=stage_model.StageType.MASS_START,
            ).exists()
        )

    def test_stage_mass_start_result_accepts_numeric_value_for_stage_entry(self):
        from tournaments.views.tournaments import sync_custom_mass_start_structure_for_division

        result_model = self._result_model()

        tournament, division, teams = self._create_mass_start_context(
            result_config=self._result_config(decimal_places=2)
        )

        sync_custom_mass_start_structure_for_division(tournament, division)

        stage = self._stage_model().objects.get(tournament=tournament, division=division)
        group = self._group_model().objects.get(stage=stage)

        result = result_model.objects.create(
            stage=stage,
            group=group,
            team=teams[0],
            round_number=1,
            value_kind=Tournament.RESULTCFG_VALUE_KIND_NUMBER,
            numeric_value="12.345",
            display_value="12.35",
            created_by=self.organizer,
            updated_by=self.organizer,
        )

        self.assertEqual(result.stage_id, stage.id)
        self.assertEqual(result.group_id, group.id)
        self.assertEqual(result.team_id, teams[0].id)
        self.assertEqual(str(result.numeric_value), "12.34")

    def test_stage_mass_start_result_rejects_team_without_stage_entry(self):
        from django.core.exceptions import ValidationError
        from tournaments.views.tournaments import sync_custom_mass_start_structure_for_division

        result_model = self._result_model()

        tournament, division, _teams = self._create_mass_start_context(teams_count=2)

        sync_custom_mass_start_structure_for_division(tournament, division)

        foreign_team = Team.objects.create(
            tournament=tournament,
            division=division,
            name="Zawodnik bez wpisu",
            is_active=True,
        )

        stage = self._stage_model().objects.get(tournament=tournament, division=division)
        group = self._group_model().objects.get(stage=stage)

        result = result_model(
            stage=stage,
            group=group,
            team=foreign_team,
            round_number=1,
            value_kind=Tournament.RESULTCFG_VALUE_KIND_NUMBER,
            numeric_value="10",
        )

        with self.assertRaises(ValidationError):
            result.save()

    def test_stage_mass_start_result_rejects_wrong_value_kind(self):
        from django.core.exceptions import ValidationError
        from tournaments.views.tournaments import sync_custom_mass_start_structure_for_division

        result_model = self._result_model()

        tournament, division, teams = self._create_mass_start_context(
            result_config=self._result_config(value_kind=Tournament.RESULTCFG_VALUE_KIND_TIME)
        )

        sync_custom_mass_start_structure_for_division(tournament, division)

        stage = self._stage_model().objects.get(tournament=tournament, division=division)
        group = self._group_model().objects.get(stage=stage)

        result = result_model(
            stage=stage,
            group=group,
            team=teams[0],
            round_number=1,
            value_kind=Tournament.RESULTCFG_VALUE_KIND_NUMBER,
            numeric_value="10",
        )

        with self.assertRaises(ValidationError):
            result.save()

    def test_stage_mass_start_result_accepts_time_value_when_configured(self):
        from tournaments.views.tournaments import sync_custom_mass_start_structure_for_division

        result_model = self._result_model()

        tournament, division, teams = self._create_mass_start_context(
            name="Turniej MASS_START czas",
            result_config=self._result_config(value_kind=Tournament.RESULTCFG_VALUE_KIND_TIME),
        )

        sync_custom_mass_start_structure_for_division(tournament, division)

        stage = self._stage_model().objects.get(tournament=tournament, division=division)
        group = self._group_model().objects.get(stage=stage)

        result = result_model.objects.create(
            stage=stage,
            group=group,
            team=teams[0],
            round_number=1,
            value_kind=Tournament.RESULTCFG_VALUE_KIND_TIME,
            time_ms=12345,
            display_value="12.34",
            created_by=self.organizer,
            updated_by=self.organizer,
        )

        self.assertEqual(result.time_ms, 12345)
        self.assertIsNone(result.numeric_value)
        self.assertIsNone(result.place_value)

    def test_stage_mass_start_result_rejects_group_outside_entry_assignment(self):
        from django.core.exceptions import ValidationError
        from tournaments.views.tournaments import sync_custom_mass_start_structure_for_division

        result_model = self._result_model()

        result_config = self._result_config(
            stages=[
                {
                    Tournament.RESULTCFG_STAGE_NAME_KEY: "Grupy",
                    Tournament.RESULTCFG_STAGE_GROUPS_COUNT_KEY: 2,
                    Tournament.RESULTCFG_STAGE_ROUNDS_COUNT_KEY: 1,
                }
            ]
        )
        tournament, division, teams = self._create_mass_start_context(
            name="Turniej MASS_START błędna grupa",
            teams_count=4,
            result_config=result_config,
        )

        sync_custom_mass_start_structure_for_division(tournament, division)

        stage = self._stage_model().objects.get(tournament=tournament, division=division)
        groups = list(self._group_model().objects.filter(stage=stage).order_by("id"))
        first_entry = self._entry_model().objects.get(stage=stage, team=teams[0])

        wrong_group = groups[1] if first_entry.group_id == groups[0].id else groups[0]

        result = result_model(
            stage=stage,
            group=wrong_group,
            team=teams[0],
            round_number=1,
            value_kind=Tournament.RESULTCFG_VALUE_KIND_NUMBER,
            numeric_value="10",
        )

        with self.assertRaises(ValidationError):
            result.save()
