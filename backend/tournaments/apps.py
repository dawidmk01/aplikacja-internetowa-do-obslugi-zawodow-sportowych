# backend/tournaments/apps.py
# Plik definiuje konfigurację aplikacji Django dla modułu turniejowego.

from django.apps import AppConfig


class TournamentsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "tournaments"
