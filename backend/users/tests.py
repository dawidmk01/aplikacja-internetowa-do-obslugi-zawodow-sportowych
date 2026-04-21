# backend/users/tests.py
# Plik weryfikuje integracyjnie podstawowe scenariusze uwierzytelniania i resetu hasła.

from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone

from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from .models import PasswordResetToken

User = get_user_model()


@override_settings(
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    FRONTEND_RESET_URL="http://localhost:5173/reset-password",
)
class AuthFlowTests(APITestCase):
    def setUp(self):
        self.register_url = "/api/auth/register/"
        self.login_url = "/api/auth/login/"
        self.refresh_url = "/api/auth/refresh/"
        self.logout_url = "/api/auth/logout/"
        self.me_url = "/api/auth/me/"
        self.password_reset_url = "/api/auth/password-reset/"
        self.password_reset_confirm_url = "/api/auth/password-reset/confirm/"

        self.username = "dawid"
        self.email = "dawid@example.com"
        self.password = "BardzoMocneHaslo123!"
        self.refresh_cookie_name = settings.AUTH_REFRESH_COOKIE_NAME

    def create_user(self, **kwargs):
        data = {
            "username": self.username,
            "email": self.email,
            "password": self.password,
        }
        data.update(kwargs)
        return User.objects.create_user(**data)

    def login_pair(self, username=None, password=None):
        return self.client.post(
            self.login_url,
            {
                "username": username or self.username,
                "password": password or self.password,
            },
            format="json",
        )

    def test_register_success(self):
        response = self.client.post(
            self.register_url,
            {
                "username": self.username,
                "email": self.email,
                "password": self.password,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(User.objects.filter(username=self.username).exists())

    def test_register_rejects_weak_password(self):
        response = self.client.post(
            self.register_url,
            {
                "username": self.username,
                "email": self.email,
                "password": "12345678",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(User.objects.filter(username=self.username).exists())

    def test_login_returns_access_and_refresh_cookie(self):
        self.create_user()

        response = self.login_pair()

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("access", response.data)
        self.assertNotIn("refresh", response.data)

        # Refresh ma być zwracany wyłącznie w cookie HttpOnly.
        self.assertIn(self.refresh_cookie_name, response.cookies)
        self.assertTrue(response.cookies[self.refresh_cookie_name].value)

    def test_me_requires_valid_access_token(self):
        self.create_user()
        login_response = self.login_pair()
        access = login_response.data["access"]

        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
        response = self.client.get(self.me_url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["username"], self.username)

    def test_refresh_rotates_and_blacklists_previous_refresh(self):
        self.create_user()
        login_response = self.login_pair()
        old_refresh = login_response.cookies[self.refresh_cookie_name].value

        # Główny klient ma już cookie po loginie.
        first_refresh_response = self.client.post(self.refresh_url, format="json")

        self.assertEqual(first_refresh_response.status_code, status.HTTP_200_OK)
        self.assertIn("access", first_refresh_response.data)
        self.assertNotIn("refresh", first_refresh_response.data)
        self.assertIn(self.refresh_cookie_name, first_refresh_response.cookies)

        rotated_refresh = first_refresh_response.cookies[self.refresh_cookie_name].value
        self.assertTrue(rotated_refresh)
        self.assertNotEqual(old_refresh, rotated_refresh)

        # Stary refresh po rotacji ma zostać odrzucony.
        stale_client = APIClient()
        stale_client.cookies[self.refresh_cookie_name] = old_refresh

        second_refresh_response = stale_client.post(self.refresh_url, format="json")

        self.assertEqual(second_refresh_response.status_code, status.HTTP_401_UNAUTHORIZED)

        # Nowy refresh zapisany w kliencie powinien nadal działać.
        third_refresh_response = self.client.post(self.refresh_url, format="json")

        self.assertEqual(third_refresh_response.status_code, status.HTTP_200_OK)
        self.assertIn("access", third_refresh_response.data)
        self.assertNotIn("refresh", third_refresh_response.data)

    def test_logout_blacklists_refresh_token(self):
        self.create_user()
        login_response = self.login_pair()
        refresh = login_response.cookies[self.refresh_cookie_name].value

        logout_response = self.client.post(self.logout_url, format="json")

        self.assertEqual(logout_response.status_code, status.HTTP_200_OK)
        self.assertIn(self.refresh_cookie_name, logout_response.cookies)

        # Stary refresh po wylogowaniu ma zostać odrzucony.
        stale_client = APIClient()
        stale_client.cookies[self.refresh_cookie_name] = refresh

        refresh_response = stale_client.post(self.refresh_url, format="json")

        self.assertEqual(refresh_response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_password_reset_request_returns_same_safe_message(self):
        self.create_user()

        existing_response = self.client.post(
            self.password_reset_url,
            {"email": self.email},
            format="json",
        )
        missing_response = self.client.post(
            self.password_reset_url,
            {"email": "brak@example.com"},
            format="json",
        )

        self.assertEqual(existing_response.status_code, status.HTTP_200_OK)
        self.assertEqual(missing_response.status_code, status.HTTP_200_OK)
        self.assertEqual(existing_response.data["detail"], missing_response.data["detail"])

    def test_password_reset_confirm_rejects_expired_token(self):
        user = self.create_user()
        token = PasswordResetToken.objects.create(user=user)
        token.expires_at = timezone.now() - timedelta(minutes=1)
        token.save(update_fields=["expires_at"])

        response = self.client.post(
            self.password_reset_confirm_url,
            {
                "token": str(token.token),
                "new_password": "NoweMocneHaslo123!",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(PasswordResetToken.objects.filter(pk=token.pk).exists())

    def test_password_reset_confirm_rejects_weak_password(self):
        user = self.create_user()
        token = PasswordResetToken.objects.create(user=user)

        response = self.client.post(
            self.password_reset_confirm_url,
            {
                "token": str(token.token),
                "new_password": "12345678",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(PasswordResetToken.objects.filter(pk=token.pk).exists())

    def test_password_reset_confirm_changes_password_and_deletes_token(self):
        user = self.create_user()
        token = PasswordResetToken.objects.create(user=user)
        new_password = "NoweMocneHaslo123!"

        response = self.client.post(
            self.password_reset_confirm_url,
            {
                "token": str(token.token),
                "new_password": new_password,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(PasswordResetToken.objects.filter(pk=token.pk).exists())

        user.refresh_from_db()
        self.assertTrue(user.check_password(new_password))