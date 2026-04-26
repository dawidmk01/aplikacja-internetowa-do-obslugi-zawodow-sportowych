# backend/users/models.py
# Plik definiuje model użytkownika oraz trwałe modele bezpieczeństwa dla operacji konta.

import uuid
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.base_user import BaseUserManager
from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin
from django.db import models
from django.db.models.functions import Lower
from django.utils import timezone


class UserManager(BaseUserManager):
    # Menedżer centralizuje tworzenie kont opartych wyłącznie na adresie e-mail.
    use_in_migrations = True

    def _normalize_email(self, email: str) -> str:
        return self.normalize_email(email).strip().lower()

    def create_user(self, email: str, password: str | None = None, **extra_fields):
        if not email:
            raise ValueError("Adres e-mail jest wymagany.")

        email = self._normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email: str, password: str | None = None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("is_active", True)

        if extra_fields.get("is_staff") is not True:
            raise ValueError("Superużytkownik musi mieć is_staff=True.")
        if extra_fields.get("is_superuser") is not True:
            raise ValueError("Superużytkownik musi mieć is_superuser=True.")

        return self.create_user(email=email, password=password, **extra_fields)


class User(AbstractBaseUser, PermissionsMixin):
    # Model reprezentuje konto techniczne identyfikowane wyłącznie przez adres e-mail.
    email = models.EmailField("adres e-mail", max_length=254, unique=True)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    date_joined = models.DateTimeField(default=timezone.now)

    objects = UserManager()

    EMAIL_FIELD = "email"
    USERNAME_FIELD = "email"
    REQUIRED_FIELDS: list[str] = []

    class Meta:
        constraints = [
            models.UniqueConstraint(
                Lower("email"),
                name="users_user_email_ci_unique",
            )
        ]

    def clean(self):
        super().clean()
        self.email = User.objects._normalize_email(self.email)

    def __str__(self):
        return self.email


class PasswordResetToken(models.Model):
    # Model utrzymuje jednorazowy token do zakończenia procesu resetu hasła.
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="password_reset_tokens",
    )
    token = models.UUIDField(default=uuid.uuid4, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()

    def save(self, *args, **kwargs):
        if not self.expires_at:
            self.expires_at = timezone.now() + timedelta(
                hours=getattr(settings, "PASSWORD_RESET_TOKEN_HOURS", 1)
            )
        super().save(*args, **kwargs)

    def is_valid(self) -> bool:
        return timezone.now() <= self.expires_at

    def __str__(self):
        return f"Password reset for {self.user_id}"


class AccountChangeToken(models.Model):
    # Model utrzymuje jednorazowy token potwierdzający zmianę adresu e-mail konta.
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="account_change_tokens",
    )
    new_value = models.CharField(max_length=254)
    token = models.UUIDField(default=uuid.uuid4, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)

    def save(self, *args, **kwargs):
        if not self.expires_at:
            self.expires_at = timezone.now() + timedelta(
                hours=getattr(settings, "ACCOUNT_CHANGE_TOKEN_HOURS", 1)
            )
        self.new_value = str(self.new_value or "").strip().lower()
        super().save(*args, **kwargs)

    def is_valid(self) -> bool:
        return self.consumed_at is None and timezone.now() <= self.expires_at

    def mark_consumed(self) -> None:
        self.consumed_at = timezone.now()
        self.save(update_fields=["consumed_at"])

    def __str__(self):
        return f"Email change for {self.user_id}"


class LoginEvent(models.Model):
    # Model zapisuje ślady bezpieczeństwa potrzebne do prezentacji historii logowań.
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="login_events",
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    success = models.BooleanField(default=False)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True, default="")
    login_identifier = models.CharField(max_length=254, blank=True, default="")
    failure_reason = models.CharField(max_length=255, blank=True, default="")

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        status = "success" if self.success else "failure"
        return f"Login {status} for {self.user_id or 'anonymous'}"


class UserSession(models.Model):
    # Model przechowuje aktywne i unieważnione sesje oparte o token odświeżania JWT.
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="sessions",
    )
    refresh_jti = models.CharField(max_length=255, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_seen_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField(null=True, blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(blank=True, default="")
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-last_seen_at", "-created_at"]

    @property
    def is_active(self) -> bool:
        if self.revoked_at is not None:
            return False
        if self.expires_at is None:
            return True
        return timezone.now() <= self.expires_at

    def mark_seen(self) -> None:
        self.last_seen_at = timezone.now()
        self.save(update_fields=["last_seen_at"])

    def mark_revoked(self) -> None:
        if self.revoked_at is None:
            self.revoked_at = timezone.now()
            self.save(update_fields=["revoked_at"])

    def __str__(self):
        return f"Session for {self.user_id}"
