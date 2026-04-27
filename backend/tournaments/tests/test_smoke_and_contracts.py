# backend/tournaments/tests/test_smoke_and_contracts.py
# Plik zabezpiecza importowalność aplikacji, modele domenowe oraz kontrakt routingu API.

from .helpers import *


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
        "DivisionChangeRequest",
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
        "DivisionChangeRequest",
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
