from django.contrib import admin

from .models import (
    Tournament,
    Team,
)


# ============================================================
# INLINE: DRUŻYNY TURNIEJU
# ============================================================

class TeamInline(admin.TabularInline):
    model = Team
    extra = 0
    fields = ("name", "status", "is_active")
    show_change_link = True


# ============================================================
# TURNIEJ
# ============================================================

@admin.register(Tournament)
class TournamentAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "discipline",
        "tournament_format",
        "status",
        "is_published",
        "start_date",
        "end_date",
    )
    list_filter = (
        "discipline",
        "tournament_format",
        "status",
        "is_published",
    )
    search_fields = ("name",)

    inlines = [TeamInline]
