# backend/users/models.py
# Plik definiuje trwałe modele bezpieczeństwa związane z resetem hasła, zmianą danych konta i historią logowań.

import uuid
from datetime import timedelta

from django.conf import settings
from django.db import models
from django.utils import timezone


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
            self.expires_at = timezone.now() + timedelta(hours=1)
        super().save(*args, **kwargs)

    def is_valid(self) -> bool:
        return timezone.now() <= self.expires_at

    def __str__(self):
        return f"Password reset for {self.user_id}"


class AccountChangeToken(models.Model):
    # Model utrzymuje jednorazowy token potwierdzający zmianę loginu albo adresu e-mail.
    class ChangeType(models.TextChoices):
        EMAIL = "EMAIL", "Email"
        USERNAME = "USERNAME", "Username"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="account_change_tokens",
    )
    change_type = models.CharField(max_length=16, choices=ChangeType.choices)
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
        super().save(*args, **kwargs)

    def is_valid(self) -> bool:
        return self.consumed_at is None and timezone.now() <= self.expires_at

    def mark_consumed(self) -> None:
        self.consumed_at = timezone.now()
        self.save(update_fields=["consumed_at"])

    def __str__(self):
        return f"{self.change_type} change for {self.user_id}"


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
    login_identifier = models.CharField(max_length=150, blank=True, default="")
    failure_reason = models.CharField(max_length=255, blank=True, default="")

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        status = "success" if self.success else "failure"
        return f"Login {status} for {self.user_id or 'anonymous'}"