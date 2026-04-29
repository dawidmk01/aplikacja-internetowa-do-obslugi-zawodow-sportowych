# backend/users/tests.py
# Plik weryfikuje integracyjnie scenariusze uwierzytelniania, sesji i operacji bezpieczeństwa konta.

from datetime import timedelta
from unittest.mock import patch

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import mail
from django.db import IntegrityError, transaction
from django.test import override_settings
from django.utils import timezone

from rest_framework import status
from rest_framework.test import APIClient, APITestCase

from .models import AccountChangeToken, LoginEvent, PasswordResetToken, UserSession

User = get_user_model()

@override_settings(
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    FRONTEND_RESET_URL="http://localhost:5173/reset-password",
    FRONTEND_ACCOUNT_CONFIRM_URL="http://localhost:5173/account",
)
class AuthFlowTests(APITestCase):
    def setUp(self):
        self.register_url = "/api/auth/register/"
        self.login_url = "/api/auth/login/"
        self.refresh_url = "/api/auth/refresh/"
        self.logout_url = "/api/auth/logout/"
        self.logout_others_url = "/api/auth/logout-others/"
        self.logout_all_url = "/api/auth/logout-all/"
        self.me_url = "/api/auth/me/"
        self.password_reset_url = "/api/auth/password-reset/"
        self.password_reset_confirm_url = "/api/auth/password-reset/confirm/"
        self.change_password_url = "/api/auth/change-password/"
        self.change_email_url = "/api/auth/change-email/"
        self.confirm_email_change_url = "/api/auth/confirm-email-change/"
        self.login_events_url = "/api/auth/login-events/"
        self.sessions_url = "/api/auth/sessions/"

        self.email = "dawid@example.com"
        self.second_email = "anna@example.com"
        self.new_email = "nowy@example.com"
        self.password = "BardzoMocneHaslo123!"
        self.new_password = "NoweMocneHaslo123!"
        self.refresh_cookie_name = settings.AUTH_REFRESH_COOKIE_NAME

        mail.outbox = []

    # ===== Pomocnicze operacje testowe =====

    def create_user(self, **kwargs):
        data = {
            "email": self.email,
            "password": self.password,
        }
        data.update(kwargs)
        return User.objects.create_user(**data)

    def login_pair(self, email=None, password=None, client=None, **extra):
        used_client = client or self.client
        return used_client.post(
            self.login_url,
            {
                "email": self.email if email is None else email,
                "password": self.password if password is None else password,
            },
            format="json",
            **extra,
        )

    def authorize_client(self, client=None, email=None, password=None):
        used_client = client or self.client
        response = self.login_pair(email=email, password=password, client=used_client)
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        access = response.data["access"]
        used_client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
        return response

    # ===== Model użytkownika =====

    def test_user_manager_normalizes_email(self):
        user = User.objects.create_user(
            email=" Dawid@Example.COM ",
            password=self.password,
        )

        self.assertEqual(user.email, self.email)

    def test_user_manager_requires_email(self):
        with self.assertRaises(ValueError):
            User.objects.create_user(email="", password=self.password)

    def test_create_superuser_sets_required_flags(self):
        user = User.objects.create_superuser(
            email="admin@example.com",
            password=self.password,
        )

        self.assertTrue(user.is_staff)
        self.assertTrue(user.is_superuser)
        self.assertTrue(user.is_active)

    def test_create_superuser_rejects_missing_staff_flag(self):
        with self.assertRaises(ValueError):
            User.objects.create_superuser(
                email="admin@example.com",
                password=self.password,
                is_staff=False,
            )

    def test_create_superuser_rejects_missing_superuser_flag(self):
        with self.assertRaises(ValueError):
            User.objects.create_superuser(
                email="admin@example.com",
                password=self.password,
                is_superuser=False,
            )

    def test_user_clean_normalizes_email(self):
        user = User(email=" Dawid@Example.COM ")

        user.clean()

        self.assertEqual(user.email, self.email)

    def test_user_string_representation_uses_email(self):
        user = self.create_user()

        self.assertEqual(str(user), self.email)

    def test_user_email_unique_constraint_is_case_insensitive(self):
        self.create_user()

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                User.objects.create_user(
                    email="DAWID@EXAMPLE.COM",
                    password=self.password,
                )

    @override_settings(PASSWORD_RESET_TOKEN_HOURS=3)
    def test_password_reset_token_sets_expiration_from_settings(self):
        user = self.create_user()
        before = timezone.now() + timedelta(hours=3) - timedelta(seconds=5)

        token = PasswordResetToken.objects.create(user=user)

        after = timezone.now() + timedelta(hours=3) + timedelta(seconds=5)
        self.assertGreaterEqual(token.expires_at, before)
        self.assertLessEqual(token.expires_at, after)
        self.assertTrue(token.is_valid())
        self.assertEqual(str(token), f"Password reset for {user.id}")

    @override_settings(ACCOUNT_CHANGE_TOKEN_HOURS=2)
    def test_account_change_token_sets_expiration_from_settings(self):
        user = self.create_user()
        before = timezone.now() + timedelta(hours=2) - timedelta(seconds=5)

        token = AccountChangeToken.objects.create(user=user, new_value=" Nowy@Example.COM ")

        after = timezone.now() + timedelta(hours=2) + timedelta(seconds=5)
        self.assertEqual(token.new_value, self.new_email)
        self.assertGreaterEqual(token.expires_at, before)
        self.assertLessEqual(token.expires_at, after)
        self.assertTrue(token.is_valid())
        self.assertEqual(str(token), f"Email change for {user.id}")

    def test_account_change_token_is_invalid_after_consumption(self):
        user = self.create_user()
        token = AccountChangeToken.objects.create(user=user, new_value=self.new_email)

        token.mark_consumed()
        token.refresh_from_db()

        self.assertIsNotNone(token.consumed_at)
        self.assertFalse(token.is_valid())

    # ===== Rejestracja =====

    def test_register_success(self):
        response = self.client.post(
            self.register_url,
            {
                "email": self.email,
                "password": self.password,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(User.objects.filter(email=self.email).exists())
        self.assertEqual(response.data["email"], self.email)
        self.assertNotIn("username", response.data)

    def test_register_normalizes_email(self):
        response = self.client.post(
            self.register_url,
            {
                "email": " Dawid@Example.COM ",
                "password": self.password,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(User.objects.filter(email=self.email).exists())
        self.assertEqual(response.data["email"], self.email)

    def test_register_rejects_missing_email(self):
        response = self.client.post(
            self.register_url,
            {
                "email": "",
                "password": self.password,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("detail", response.data)

    def test_register_rejects_missing_password(self):
        response = self.client.post(
            self.register_url,
            {
                "email": self.email,
                "password": "",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("detail", response.data)

    def test_register_rejects_invalid_email(self):
        response = self.client.post(
            self.register_url,
            {
                "email": "niepoprawny-email",
                "password": self.password,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("detail", response.data)

    def test_register_rejects_duplicate_email(self):
        self.create_user()

        response = self.client.post(
            self.register_url,
            {
                "email": self.email,
                "password": self.password,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("detail", response.data)

    def test_register_rejects_duplicate_email_case_insensitive(self):
        self.create_user()

        response = self.client.post(
            self.register_url,
            {
                "email": "DAWID@EXAMPLE.COM",
                "password": self.password,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(User.objects.count(), 1)

    def test_register_rejects_weak_password(self):
        response = self.client.post(
            self.register_url,
            {
                "email": self.email,
                "password": "12345678",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("detail", response.data)
        self.assertFalse(User.objects.filter(email=self.email).exists())

    def test_register_response_exposes_only_public_fields(self):
        response = self.client.post(
            self.register_url,
            {
                "email": self.email,
                "password": self.password,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(set(response.data.keys()), {"id", "email"})

    def test_register_rejects_too_short_password(self):
        response = self.client.post(
            self.register_url,
            {
                "email": self.email,
                "password": "Ab1!",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("detail", response.data)
        self.assertFalse(User.objects.filter(email=self.email).exists())

    def test_register_rejects_numeric_password(self):
        response = self.client.post(
            self.register_url,
            {
                "email": self.email,
                "password": "987654321987654321",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("detail", response.data)
        self.assertFalse(User.objects.filter(email=self.email).exists())

    def test_register_rejects_password_too_similar_to_email(self):
        response = self.client.post(
            self.register_url,
            {
                "email": self.email,
                "password": self.email,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("detail", response.data)
        self.assertFalse(User.objects.filter(email=self.email).exists())

    def test_register_rejects_password_too_similar_to_email_local_part(self):
        response = self.client.post(
            self.register_url,
            {
                "email": self.email,
                "password": "dawid",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("detail", response.data)
        self.assertFalse(User.objects.filter(email=self.email).exists())

    def test_register_rejects_password_without_uppercase(self):
        response = self.client.post(
            self.register_url,
            {
                "email": self.email,
                "password": "bezpiecznehaslo1",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("detail", response.data)
        self.assertFalse(User.objects.filter(email=self.email).exists())

    def test_register_rejects_password_without_lowercase(self):
        response = self.client.post(
            self.register_url,
            {
                "email": self.email,
                "password": "BEZPIECZNEHASLO1",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("detail", response.data)
        self.assertFalse(User.objects.filter(email=self.email).exists())

    def test_register_rejects_password_without_digit_or_special(self):
        response = self.client.post(
            self.register_url,
            {
                "email": self.email,
                "password": "BezpieczneHaslo",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("detail", response.data)
        self.assertFalse(User.objects.filter(email=self.email).exists())

    # ===== Logowanie i historia logowań =====

    def test_login_returns_access_and_refresh_cookie(self):
        self.create_user()

        response = self.login_pair()

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("access", response.data)
        self.assertNotIn("refresh", response.data)

        # Refresh ma być zwracany wyłącznie w cookie HttpOnly.
        self.assertIn(self.refresh_cookie_name, response.cookies)
        self.assertTrue(response.cookies[self.refresh_cookie_name].value)

    def test_login_accepts_email_case_insensitive(self):
        self.create_user()

        response = self.login_pair(email="DAWID@EXAMPLE.COM")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("access", response.data)

    def test_login_rejects_missing_email(self):
        response = self.login_pair(email="")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("detail", response.data)

    def test_login_rejects_missing_password(self):
        response = self.login_pair(password="")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("detail", response.data)

    def test_login_rejects_invalid_email_format(self):
        response = self.login_pair(email="niepoprawny-email")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("detail", response.data)
        self.assertEqual(LoginEvent.objects.count(), 0)

    def test_login_rejects_invalid_credentials_with_generic_detail(self):
        self.create_user()

        response = self.login_pair(password="NiepoprawneHaslo123!")

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertIn("detail", response.data)

    def test_login_rejects_missing_account_with_generic_detail(self):
        response = self.login_pair(email="brak@example.com")

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertIn("detail", response.data)

    def test_successful_login_creates_login_event(self):
        user = self.create_user()

        response = self.login_pair(
            email=" Dawid@Example.COM ",
            HTTP_USER_AGENT="Mozilla/5.0 Windows Chrome/120.0.0.0",
            REMOTE_ADDR="192.168.10.25",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        event = LoginEvent.objects.get()
        self.assertEqual(event.user_id, user.id)
        self.assertTrue(event.success)
        self.assertEqual(event.login_identifier, self.email)
        self.assertEqual(event.ip_address, "192.168.10.25")

    def test_failed_login_creates_login_event_for_existing_account(self):
        user = self.create_user()

        response = self.login_pair(password="NiepoprawneHaslo123!")

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

        event = LoginEvent.objects.get()
        self.assertEqual(event.user_id, user.id)
        self.assertFalse(event.success)
        self.assertEqual(event.failure_reason, "invalid_credentials")
        self.assertEqual(event.login_identifier, self.email)

    def test_failed_login_for_missing_account_creates_anonymous_login_event(self):
        response = self.login_pair(email="brak@example.com")

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

        event = LoginEvent.objects.get()
        self.assertIsNone(event.user)
        self.assertFalse(event.success)
        self.assertEqual(event.failure_reason, "invalid_credentials")
        self.assertEqual(event.login_identifier, "brak@example.com")

    def test_login_events_require_authentication(self):
        response = self.client.get(self.login_events_url)

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_login_events_return_masked_ip_and_device_label(self):
        self.create_user()

        login_response = self.login_pair(
            HTTP_USER_AGENT="Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0",
            REMOTE_ADDR="192.168.10.25",
        )
        access = login_response.data["access"]

        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
        response = self.client.get(self.login_events_url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data["results"]), 1)

        event = response.data["results"][0]
        self.assertTrue(event["success"])
        self.assertEqual(event["ip_masked"], "192.168.xxx.xxx")
        self.assertEqual(event["device_label"], "Chrome na Windows")
        self.assertNotIn("login_identifier", event)

    def test_login_rejects_inactive_user_with_generic_detail_and_event(self):
        user = self.create_user(is_active=False)

        response = self.login_pair()

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertIn("detail", response.data)

        event = LoginEvent.objects.get()
        self.assertEqual(event.user_id, user.id)
        self.assertFalse(event.success)
        self.assertEqual(event.failure_reason, "invalid_credentials")
        self.assertEqual(event.login_identifier, self.email)

    def test_successful_login_updates_last_login(self):
        user = self.create_user()
        self.assertIsNone(user.last_login)

        response = self.login_pair()

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        user.refresh_from_db()
        self.assertIsNotNone(user.last_login)

    def test_successful_login_uses_first_forwarded_ip_address(self):
        self.create_user()

        response = self.login_pair(
            HTTP_X_FORWARDED_FOR="203.0.113.7, 10.0.0.1",
            REMOTE_ADDR="127.0.0.1",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        event = LoginEvent.objects.get()
        self.assertEqual(event.ip_address, "203.0.113.7")

    def test_login_events_apply_limit_parameter(self):
        user = self.create_user()
        self.authorize_client()
        LoginEvent.objects.all().delete()

        for index in range(3):
            LoginEvent.objects.create(
                user=user,
                success=True,
                ip_address=f"192.168.1.{index + 1}",
                user_agent="Mozilla/5.0 Firefox/120.0",
            )

        response = self.client.get(self.login_events_url, {"limit": "2"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data["results"]), 2)

    def test_login_events_invalid_limit_uses_default(self):
        user = self.create_user()
        self.authorize_client()
        LoginEvent.objects.all().delete()

        for index in range(3):
            LoginEvent.objects.create(user=user, success=bool(index % 2))

        response = self.client.get(self.login_events_url, {"limit": "nie-liczba"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data["results"]), 3)

    def test_login_events_limit_is_at_least_one(self):
        user = self.create_user()
        self.authorize_client()
        LoginEvent.objects.all().delete()

        LoginEvent.objects.create(user=user, success=True)
        LoginEvent.objects.create(user=user, success=False)

        response = self.client.get(self.login_events_url, {"limit": "0"})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data["results"]), 1)

    def test_login_events_mask_ipv6_and_detect_ios_safari(self):
        user = self.create_user()
        self.authorize_client()
        LoginEvent.objects.all().delete()

        LoginEvent.objects.create(
            user=user,
            success=True,
            ip_address="2001:db8:85a3::8a2e:370:7334",
            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile Safari/604.1",
        )

        response = self.client.get(self.login_events_url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        event = response.data["results"][0]
        self.assertEqual(event["ip_masked"], "2001:db8:85a3:xxxx")
        self.assertEqual(event["device_label"], "Safari na iOS")

    # ===== Dane bieżącego użytkownika =====

    def test_me_requires_authentication(self):
        response = self.client.get(self.me_url)

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_me_requires_valid_access_token(self):
        self.create_user()
        login_response = self.login_pair()
        access = login_response.data["access"]

        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
        response = self.client.get(self.me_url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["email"], self.email)
        self.assertNotIn("username", response.data)
        self.assertNotIn("password", response.data)

    def test_me_response_exposes_expected_public_fields_only(self):
        self.create_user()
        self.authorize_client()

        response = self.client.get(self.me_url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            set(response.data.keys()),
            {"id", "email", "is_staff", "email_verified", "created_at"},
        )
        self.assertEqual(response.data["email"], self.email)
        self.assertIsNone(response.data["email_verified"])
        self.assertFalse(response.data["is_staff"])

    def test_me_rejects_invalid_access_token(self):
        self.client.credentials(HTTP_AUTHORIZATION="Bearer niepoprawny-token")

        response = self.client.get(self.me_url)

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    # ===== Tokeny odświeżania i wylogowanie =====

    def test_refresh_without_cookie_returns_unauthorized(self):
        response = self.client.post(self.refresh_url, format="json")

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertIn("detail", response.data)

    def test_refresh_with_invalid_token_returns_unauthorized_and_clears_cookie(self):
        self.client.cookies[self.refresh_cookie_name] = "niepoprawny-token"

        response = self.client.post(self.refresh_url, format="json")

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertIn("detail", response.data)
        self.assertIn(self.refresh_cookie_name, response.cookies)

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

    def test_logout_without_refresh_token_still_returns_success(self):
        response = self.client.post(self.logout_url, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("detail", response.data)

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

    def test_logout_all_requires_authentication(self):
        response = self.client.post(self.logout_all_url, format="json")

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_logout_all_blacklists_current_session(self):
        self.create_user()
        login_response = self.authorize_client()
        refresh = login_response.cookies[self.refresh_cookie_name].value

        response = self.client.post(self.logout_all_url, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("detail", response.data)

        stale_client = APIClient()
        stale_client.cookies[self.refresh_cookie_name] = refresh
        refresh_response = stale_client.post(self.refresh_url, format="json")

        self.assertEqual(refresh_response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_logout_others_requires_authentication(self):
        response = self.client.post(self.logout_others_url, format="json")

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_logout_others_keeps_current_session_and_blacklists_other_sessions(self):
        self.create_user()

        first_login = self.authorize_client()
        first_refresh = first_login.cookies[self.refresh_cookie_name].value

        other_client = APIClient()
        other_login = self.login_pair(client=other_client)
        other_refresh = other_login.cookies[self.refresh_cookie_name].value

        response = self.client.post(self.logout_others_url, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("detail", response.data)

        current_client = APIClient()
        current_client.cookies[self.refresh_cookie_name] = first_refresh
        current_refresh_response = current_client.post(self.refresh_url, format="json")

        self.assertEqual(current_refresh_response.status_code, status.HTTP_200_OK)

        stale_client = APIClient()
        stale_client.cookies[self.refresh_cookie_name] = other_refresh
        stale_refresh_response = stale_client.post(self.refresh_url, format="json")

        self.assertEqual(stale_refresh_response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_refresh_accepts_refresh_token_from_request_body(self):
        self.create_user()
        login_response = self.login_pair()
        refresh = login_response.cookies[self.refresh_cookie_name].value

        fresh_client = APIClient()
        response = fresh_client.post(
            self.refresh_url,
            {"refresh": refresh},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("access", response.data)
        self.assertNotIn("refresh", response.data)
        self.assertIn(self.refresh_cookie_name, response.cookies)

    def test_logout_accepts_refresh_token_from_request_body(self):
        self.create_user()
        login_response = self.login_pair()
        refresh = login_response.cookies[self.refresh_cookie_name].value

        fresh_client = APIClient()
        response = fresh_client.post(
            self.logout_url,
            {"refresh": refresh},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("detail", response.data)

        stale_client = APIClient()
        stale_client.cookies[self.refresh_cookie_name] = refresh
        refresh_response = stale_client.post(self.refresh_url, format="json")

        self.assertEqual(refresh_response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_logout_all_returns_blacklisted_token_count(self):
        self.create_user()
        self.authorize_client()

        response = self.client.post(self.logout_all_url, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(response.data["blacklisted_count"], 1)

    def test_logout_others_returns_blacklisted_token_count(self):
        self.create_user()
        self.authorize_client()
        other_client = APIClient()
        self.login_pair(client=other_client)

        response = self.client.post(self.logout_others_url, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(response.data["blacklisted_count"], 1)



    def test_login_creates_active_user_session(self):
        user = self.create_user()

        response = self.login_pair(
            HTTP_USER_AGENT="Mozilla/5.0 Windows Chrome/120.0.0.0",
            REMOTE_ADDR="192.168.10.25",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        session = UserSession.objects.get(user=user)
        self.assertIsNone(session.revoked_at)
        self.assertTrue(session.refresh_jti)
        self.assertEqual(session.ip_address, "192.168.10.25")
        self.assertIn("Chrome", session.user_agent)

    def test_sessions_require_authentication(self):
        response = self.client.get(self.sessions_url)

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_sessions_list_returns_current_session(self):
        self.create_user()
        self.authorize_client()

        response = self.client.get(self.sessions_url)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data["results"]), 1)
        session = response.data["results"][0]
        self.assertTrue(session["current"])
        self.assertIn("device_label", session)
        self.assertIn("ip_masked", session)
        self.assertIn("last_seen_at", session)

    def test_session_delete_revokes_other_session_and_blacklists_refresh(self):
        self.create_user()
        self.authorize_client()

        other_client = APIClient()
        other_login = self.login_pair(client=other_client)
        other_refresh = other_login.cookies[self.refresh_cookie_name].value

        list_response = self.client.get(self.sessions_url)
        other_session = next(item for item in list_response.data["results"] if not item["current"])

        delete_response = self.client.delete(f"{self.sessions_url}{other_session['id']}/")

        self.assertEqual(delete_response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertIsNotNone(UserSession.objects.get(id=other_session["id"]).revoked_at)

        stale_client = APIClient()
        stale_client.cookies[self.refresh_cookie_name] = other_refresh
        refresh_response = stale_client.post(self.refresh_url, format="json")

        self.assertEqual(refresh_response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_logout_others_marks_other_sessions_revoked(self):
        self.create_user()
        first_login = self.authorize_client()
        first_refresh = first_login.cookies[self.refresh_cookie_name].value

        other_client = APIClient()
        self.login_pair(client=other_client)

        response = self.client.post(self.logout_others_url, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(UserSession.objects.filter(revoked_at__isnull=True).count(), 1)

        current_client = APIClient()
        current_client.cookies[self.refresh_cookie_name] = first_refresh
        refresh_response = current_client.post(self.refresh_url, format="json")

        self.assertEqual(refresh_response.status_code, status.HTTP_200_OK)

    def test_logout_all_marks_all_sessions_revoked(self):
        self.create_user()
        self.authorize_client()

        other_client = APIClient()
        self.login_pair(client=other_client)

        response = self.client.post(self.logout_all_url, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(UserSession.objects.filter(revoked_at__isnull=True).count(), 0)

    def test_change_password_revokes_all_user_sessions(self):
        self.create_user()
        self.authorize_client()

        other_client = APIClient()
        self.login_pair(client=other_client)

        response = self.client.post(
            self.change_password_url,
            {
                "current_password": self.password,
                "new_password": self.new_password,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(UserSession.objects.filter(revoked_at__isnull=True).count(), 0)


    # ===== Reset hasła =====

    def test_password_reset_request_returns_same_safe_detail(self):
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

    def test_password_reset_request_rejects_missing_email(self):
        response = self.client.post(
            self.password_reset_url,
            {"email": ""},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("detail", response.data)

    def test_password_reset_request_rejects_invalid_email(self):
        response = self.client.post(
            self.password_reset_url,
            {"email": "niepoprawny-email"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("detail", response.data)

    def test_password_reset_request_for_existing_account_creates_token_and_email(self):
        user = self.create_user()

        response = self.client.post(
            self.password_reset_url,
            {"email": self.email},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(PasswordResetToken.objects.filter(user=user).count(), 1)
        self.assertEqual(len(mail.outbox), 1)

        token = PasswordResetToken.objects.get(user=user)
        self.assertIn(str(token.token), mail.outbox[0].body)
        self.assertIn(settings.FRONTEND_RESET_URL, mail.outbox[0].body)

    def test_password_reset_request_for_missing_account_does_not_create_token_or_email(self):
        response = self.client.post(
            self.password_reset_url,
            {"email": "brak@example.com"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(PasswordResetToken.objects.count(), 0)
        self.assertEqual(len(mail.outbox), 0)

    def test_password_reset_request_replaces_previous_token(self):
        user = self.create_user()

        first_response = self.client.post(
            self.password_reset_url,
            {"email": self.email},
            format="json",
        )
        first_token = PasswordResetToken.objects.get(user=user)

        second_response = self.client.post(
            self.password_reset_url,
            {"email": self.email},
            format="json",
        )
        second_token = PasswordResetToken.objects.get(user=user)

        self.assertEqual(first_response.status_code, status.HTTP_200_OK)
        self.assertEqual(second_response.status_code, status.HTTP_200_OK)
        self.assertEqual(PasswordResetToken.objects.filter(user=user).count(), 1)
        self.assertNotEqual(first_token.token, second_token.token)

    def test_password_reset_confirm_rejects_missing_data(self):
        response = self.client.post(
            self.password_reset_confirm_url,
            {
                "token": "",
                "new_password": "",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("detail", response.data)

    def test_password_reset_confirm_rejects_invalid_token(self):
        response = self.client.post(
            self.password_reset_confirm_url,
            {
                "token": "00000000-0000-0000-0000-000000000000",
                "new_password": self.new_password,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("detail", response.data)

    def test_password_reset_confirm_rejects_expired_token(self):
        user = self.create_user()
        token = PasswordResetToken.objects.create(user=user)
        token.expires_at = timezone.now() - timedelta(minutes=1)
        token.save(update_fields=["expires_at"])

        response = self.client.post(
            self.password_reset_confirm_url,
            {
                "token": str(token.token),
                "new_password": self.new_password,
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
        self.assertIn("detail", response.data)
        self.assertTrue(PasswordResetToken.objects.filter(pk=token.pk).exists())

    def test_password_reset_confirm_changes_password_and_deletes_token(self):
        user = self.create_user()
        token = PasswordResetToken.objects.create(user=user)

        response = self.client.post(
            self.password_reset_confirm_url,
            {
                "token": str(token.token),
                "new_password": self.new_password,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(PasswordResetToken.objects.filter(pk=token.pk).exists())

        user.refresh_from_db()
        self.assertTrue(user.check_password(self.new_password))

    def test_password_reset_confirm_prevents_token_reuse(self):
        user = self.create_user()
        token = PasswordResetToken.objects.create(user=user)

        first_response = self.client.post(
            self.password_reset_confirm_url,
            {
                "token": str(token.token),
                "new_password": self.new_password,
            },
            format="json",
        )
        second_response = self.client.post(
            self.password_reset_confirm_url,
            {
                "token": str(token.token),
                "new_password": "JeszczeNowszeHaslo123!",
            },
            format="json",
        )

        self.assertEqual(first_response.status_code, status.HTTP_200_OK)
        self.assertEqual(second_response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_password_reset_confirm_allows_login_only_with_new_password(self):
        self.create_user()
        token = PasswordResetToken.objects.get_or_create(user=User.objects.get(email=self.email))[0]

        response = self.client.post(
            self.password_reset_confirm_url,
            {
                "token": str(token.token),
                "new_password": self.new_password,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        old_login = self.login_pair(password=self.password, client=APIClient())
        new_login = self.login_pair(password=self.new_password, client=APIClient())

        self.assertEqual(old_login.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(new_login.status_code, status.HTTP_200_OK)

    def test_password_reset_request_normalizes_email(self):
        user = self.create_user()

        response = self.client.post(
            self.password_reset_url,
            {"email": " Dawid@Example.COM "},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(PasswordResetToken.objects.filter(user=user).count(), 1)
        self.assertEqual(len(mail.outbox), 1)

    def test_password_reset_request_handles_email_delivery_failure_safely(self):
        user = self.create_user()

        with patch("users.views.send_mail", side_effect=Exception("SMTP error")):
            response = self.client.post(
                self.password_reset_url,
                {"email": self.email},
                format="json",
            )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("detail", response.data)
        self.assertEqual(PasswordResetToken.objects.filter(user=user).count(), 0)

    def test_password_reset_confirm_rejects_numeric_password(self):
        user = self.create_user()
        token = PasswordResetToken.objects.create(user=user)

        response = self.client.post(
            self.password_reset_confirm_url,
            {
                "token": str(token.token),
                "new_password": "987654321987654321",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("detail", response.data)
        self.assertTrue(PasswordResetToken.objects.filter(pk=token.pk).exists())

    # ===== Zmiana hasła =====

    def test_change_password_requires_authentication(self):
        response = self.client.post(
            self.change_password_url,
            {
                "current_password": self.password,
                "new_password": self.new_password,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_change_password_rejects_missing_data(self):
        self.create_user()
        self.authorize_client()

        response = self.client.post(
            self.change_password_url,
            {
                "current_password": "",
                "new_password": "",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("detail", response.data)

    def test_change_password_rejects_invalid_current_password(self):
        self.create_user()
        self.authorize_client()

        response = self.client.post(
            self.change_password_url,
            {
                "current_password": "NiepoprawneHaslo123!",
                "new_password": self.new_password,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("detail", response.data)

    def test_change_password_rejects_weak_new_password(self):
        self.create_user()
        self.authorize_client()

        response = self.client.post(
            self.change_password_url,
            {
                "current_password": self.password,
                "new_password": "12345678",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("detail", response.data)

    def test_change_password_changes_password_and_invalidates_sessions(self):
        self.create_user()
        login_response = self.authorize_client()
        refresh = login_response.cookies[self.refresh_cookie_name].value

        response = self.client.post(
            self.change_password_url,
            {
                "current_password": self.password,
                "new_password": self.new_password,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("detail", response.data)

        stale_client = APIClient()
        stale_client.cookies[self.refresh_cookie_name] = refresh
        refresh_response = stale_client.post(self.refresh_url, format="json")

        old_login = self.login_pair(password=self.password, client=APIClient())
        new_login = self.login_pair(password=self.new_password, client=APIClient())

        self.assertEqual(refresh_response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(old_login.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(new_login.status_code, status.HTTP_200_OK)

    def test_change_password_deletes_pending_email_change_tokens(self):
        user = self.create_user()
        AccountChangeToken.objects.create(user=user, new_value=self.new_email)
        self.authorize_client()

        response = self.client.post(
            self.change_password_url,
            {
                "current_password": self.password,
                "new_password": self.new_password,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(AccountChangeToken.objects.filter(user=user).count(), 0)

    def test_change_password_clears_refresh_cookie(self):
        self.create_user()
        self.authorize_client()

        response = self.client.post(
            self.change_password_url,
            {
                "current_password": self.password,
                "new_password": self.new_password,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn(self.refresh_cookie_name, response.cookies)

    def test_change_password_rejects_numeric_new_password(self):
        self.create_user()
        self.authorize_client()

        response = self.client.post(
            self.change_password_url,
            {
                "current_password": self.password,
                "new_password": "987654321987654321",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("detail", response.data)

    # ===== Zmiana adresu e-mail =====

    def test_change_email_requires_authentication(self):
        response = self.client.post(
            self.change_email_url,
            {
                "new_email": self.new_email,
                "current_password": self.password,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_change_email_rejects_missing_data(self):
        self.create_user()
        self.authorize_client()

        response = self.client.post(
            self.change_email_url,
            {
                "new_email": "",
                "current_password": "",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("detail", response.data)

    def test_change_email_rejects_invalid_email(self):
        self.create_user()
        self.authorize_client()

        response = self.client.post(
            self.change_email_url,
            {
                "new_email": "niepoprawny-email",
                "current_password": self.password,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("detail", response.data)

    def test_change_email_rejects_invalid_current_password(self):
        self.create_user()
        self.authorize_client()

        response = self.client.post(
            self.change_email_url,
            {
                "new_email": self.new_email,
                "current_password": "NiepoprawneHaslo123!",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("detail", response.data)

    def test_change_email_rejects_same_email(self):
        self.create_user()
        self.authorize_client()

        response = self.client.post(
            self.change_email_url,
            {
                "new_email": "DAWID@EXAMPLE.COM",
                "current_password": self.password,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("detail", response.data)

    def test_change_email_rejects_email_used_by_other_account(self):
        self.create_user()
        User.objects.create_user(email=self.second_email, password=self.password)
        self.authorize_client()

        response = self.client.post(
            self.change_email_url,
            {
                "new_email": self.second_email.upper(),
                "current_password": self.password,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("detail", response.data)

    def test_change_email_creates_confirmation_token_and_email(self):
        user = self.create_user()
        self.authorize_client()

        response = self.client.post(
            self.change_email_url,
            {
                "new_email": " Nowy@Example.COM ",
                "current_password": self.password,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(AccountChangeToken.objects.filter(user=user).count(), 1)
        self.assertEqual(len(mail.outbox), 1)

        token = AccountChangeToken.objects.get(user=user)
        self.assertEqual(token.new_value, self.new_email)
        self.assertIn(str(token.token), mail.outbox[0].body)
        self.assertIn(settings.FRONTEND_ACCOUNT_CONFIRM_URL, mail.outbox[0].body)

    def test_change_email_replaces_previous_token(self):
        user = self.create_user()
        self.authorize_client()

        self.client.post(
            self.change_email_url,
            {
                "new_email": self.new_email,
                "current_password": self.password,
            },
            format="json",
        )
        first_token = AccountChangeToken.objects.get(user=user)

        self.client.post(
            self.change_email_url,
            {
                "new_email": "drugi@example.com",
                "current_password": self.password,
            },
            format="json",
        )
        second_token = AccountChangeToken.objects.get(user=user)

        self.assertEqual(AccountChangeToken.objects.filter(user=user).count(), 1)
        self.assertNotEqual(first_token.token, second_token.token)
        self.assertEqual(second_token.new_value, "drugi@example.com")

    def test_confirm_email_change_rejects_missing_token(self):
        response = self.client.post(
            self.confirm_email_change_url,
            {"token": ""},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("detail", response.data)

    def test_confirm_email_change_rejects_invalid_token(self):
        response = self.client.post(
            self.confirm_email_change_url,
            {"token": "00000000-0000-0000-0000-000000000000"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("detail", response.data)

    def test_confirm_email_change_rejects_expired_token_and_deletes_it(self):
        user = self.create_user()
        token = AccountChangeToken.objects.create(user=user, new_value=self.new_email)
        token.expires_at = timezone.now() - timedelta(minutes=1)
        token.save(update_fields=["expires_at"])

        response = self.client.post(
            self.confirm_email_change_url,
            {"token": str(token.token)},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("detail", response.data)
        self.assertFalse(AccountChangeToken.objects.filter(pk=token.pk).exists())

    def test_confirm_email_change_rejects_email_used_by_other_account(self):
        user = self.create_user()
        User.objects.create_user(email=self.second_email, password=self.password)
        token = AccountChangeToken.objects.create(user=user, new_value=self.second_email)

        response = self.client.post(
            self.confirm_email_change_url,
            {"token": str(token.token)},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("detail", response.data)
        self.assertFalse(AccountChangeToken.objects.filter(pk=token.pk).exists())

    def test_confirm_email_change_updates_email_and_marks_token_consumed(self):
        user = self.create_user()
        token = AccountChangeToken.objects.create(user=user, new_value=" Nowy@Example.COM ")

        response = self.client.post(
            self.confirm_email_change_url,
            {"token": str(token.token)},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn("detail", response.data)

        user.refresh_from_db()
        token.refresh_from_db()

        self.assertEqual(user.email, self.new_email)
        self.assertIsNotNone(token.consumed_at)

    def test_confirm_email_change_allows_login_only_with_new_email(self):
        user = self.create_user()
        token = AccountChangeToken.objects.create(user=user, new_value=self.new_email)

        response = self.client.post(
            self.confirm_email_change_url,
            {"token": str(token.token)},
            format="json",
        )

        old_login = self.login_pair(email=self.email, client=APIClient())
        new_login = self.login_pair(email=self.new_email, client=APIClient())

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(old_login.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(new_login.status_code, status.HTTP_200_OK)

    def test_change_email_sends_confirmation_to_current_email(self):
        self.create_user()
        self.authorize_client()

        response = self.client.post(
            self.change_email_url,
            {
                "new_email": self.new_email,
                "current_password": self.password,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, [self.email])
        self.assertNotIn(self.new_email, mail.outbox[0].to)

    def test_change_email_handles_email_delivery_failure_and_deletes_token(self):
        user = self.create_user()
        self.authorize_client()

        with patch("users.views.send_mail", side_effect=Exception("SMTP error")):
            response = self.client.post(
                self.change_email_url,
                {
                    "new_email": self.new_email,
                    "current_password": self.password,
                },
                format="json",
            )

        self.assertEqual(response.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)
        self.assertIn("detail", response.data)
        self.assertEqual(AccountChangeToken.objects.filter(user=user).count(), 0)

    def test_confirm_email_change_rejects_invalid_email_stored_in_token_and_deletes_it(self):
        user = self.create_user()
        token = AccountChangeToken.objects.create(user=user, new_value="niepoprawny-email")

        response = self.client.post(
            self.confirm_email_change_url,
            {"token": str(token.token)},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn("detail", response.data)
        self.assertFalse(AccountChangeToken.objects.filter(pk=token.pk).exists())

    def test_confirm_email_change_prevents_token_reuse_and_deletes_consumed_token(self):
        user = self.create_user()
        token = AccountChangeToken.objects.create(user=user, new_value=self.new_email)

        first_response = self.client.post(
            self.confirm_email_change_url,
            {"token": str(token.token)},
            format="json",
        )
        second_response = self.client.post(
            self.confirm_email_change_url,
            {"token": str(token.token)},
            format="json",
        )

        self.assertEqual(first_response.status_code, status.HTTP_200_OK)
        self.assertEqual(second_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(AccountChangeToken.objects.filter(pk=token.pk).exists())

