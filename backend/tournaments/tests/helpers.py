# backend/tournaments/tests/helpers.py
# Plik udostępnia wspólne importy i funkcje pomocnicze dla testów domeny turniejów.

from importlib import import_module

from django.apps import apps
from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase
from django.urls import URLPattern, URLResolver

from rest_framework.test import APIClient

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

__all__ = [
    "APIClient",
    "Division",
    "SimpleTestCase",
    "Team",
    "TestCase",
    "Tournament",
    "URLPattern",
    "URLResolver",
    "apps",
    "create_test_user",
    "import_module",
]
