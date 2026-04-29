# backend/users/password_validation.py
# Plik definiuje dodatkowe reguły bezpieczeństwa haseł użytkowników.

import re

from django.core.exceptions import ValidationError
from django.utils.translation import gettext as _


class PasswordComplexityValidator:
    """Waliduje złożoność hasła oraz podobieństwo do danych konta."""

    def validate(self, password, user=None):
        raw_password = str(password or "")
        normalized_password = raw_password.strip().lower()

        email = str(getattr(user, "email", "") or "").strip().lower()
        email_local_part = email.split("@", 1)[0] if "@" in email else ""

        if email and normalized_password in {email, email_local_part}:
            raise ValidationError(
                _("Hasło jest zbyt podobne do adresu e-mail."),
                code="password_matches_email",
            )

        errors = []

        if not re.search(r"[a-z]", raw_password):
            errors.append(
                ValidationError(
                    _("Hasło musi zawierać co najmniej jedną małą literę."),
                    code="password_missing_lowercase",
                )
            )

        if not re.search(r"[A-Z]", raw_password):
            errors.append(
                ValidationError(
                    _("Hasło musi zawierać co najmniej jedną dużą literę."),
                    code="password_missing_uppercase",
                )
            )

        if not re.search(r"[0-9]|[^A-Za-z0-9]", raw_password):
            errors.append(
                ValidationError(
                    _("Hasło musi zawierać co najmniej jedną cyfrę albo znak specjalny."),
                    code="password_missing_digit_or_special",
                )
            )

        if errors:
            raise ValidationError(errors)

    def get_help_text(self):
        return _(
            "Hasło musi mieć co najmniej 8 znaków, zawierać małą literę, "
            "dużą literę oraz cyfrę albo znak specjalny."
        )
