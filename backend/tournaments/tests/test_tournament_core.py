# backend/tournaments/tests/test_tournament_core.py
# Plik zabezpiecza podstawowy kontrakt turnieju, tworzenie, dostęp, metadane i archiwizację.

from .helpers import *


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
