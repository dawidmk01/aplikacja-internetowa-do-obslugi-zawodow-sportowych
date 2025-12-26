from django.contrib import admin
from .models import Tournament


@admin.register(Tournament)
class TournamentAdmin(admin.ModelAdmin):
    list_display = ("name", "discipline", "is_private", "start_date", "end_date")
    list_filter = ("discipline", "is_private")
    search_fields = ("name",)
