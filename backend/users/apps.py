# backend/users/apps.py
# Plik definiuje konfigurację aplikacji użytkowników dla rejestracji w Django.

from django.apps import AppConfig


class UsersConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "users"
