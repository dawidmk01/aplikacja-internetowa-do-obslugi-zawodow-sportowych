# backend/config/urls.py
# Plik mapuje główne wejścia HTTP dla panelu administracyjnego i API.

from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("tournaments.urls")),
    path("api/auth/", include("users.urls")),
]
