from django.contrib import admin

from .models import (
    Tournament,
    Team,
    Match,
)


# ============================================================
# INLINE: DRUŻYNY TURNIEJU
# ============================================================

class TeamInline(admin.TabularInline):
    model = Team
    extra = 0
    fields = ("name", "is_active")
    show_change_link = True


# ============================================================
# INLINE: MECZE TURNIEJU
# ============================================================

class MatchInline(admin.TabularInline):
    model = Match
    extra = 0

    fields = (
        "stage",
        "group",
        "round_number",
        "home_team",
        "away_team",

        # ===== WYNIKI =====
        "home_score",
        "away_score",

        # ===== HARMONOGRAM =====
        "scheduled_date",
        "scheduled_time",
        "location",

        # ===== STATUS =====
        "status",
    )

    readonly_fields = (
        "stage",
        "group",
        "round_number",
        "home_team",
        "away_team",
    )

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

    inlines = [
        TeamInline,
        MatchInline,
    ]
