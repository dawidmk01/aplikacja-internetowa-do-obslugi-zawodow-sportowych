from django.contrib import admin

from .models import (
    Match,
    MatchCommentaryEntry,
    Team,
    Tournament,
    TournamentCommentaryPhrase,
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


# ============================================================
# LIVE: KOMENTARZE MECZOWE
# ============================================================


@admin.register(MatchCommentaryEntry)
class MatchCommentaryEntryAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "match",
        "minute",
        "minute_raw",
        "period",
        "time_source",
        "created_by",
        "created_at",
    )

    list_filter = (
        "period",
        "time_source",
        "created_at",
    )

    search_fields = (
        "text",
        "match__home_team__name",
        "match__away_team__name",
        "match__tournament__name",
    )

    raw_id_fields = (
        "match",
        "created_by",
    )

    ordering = (
        "-created_at",
        "-id",
    )


# ============================================================
# LIVE: SŁOWNIK FRAZ
# ============================================================


@admin.register(TournamentCommentaryPhrase)
class TournamentCommentaryPhraseAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "tournament",
        "kind",
        "category",
        "text",
        "order",
        "is_active",
        "created_by",
        "updated_at",
    )

    list_filter = (
        "kind",
        "category",
        "is_active",
        "updated_at",
    )

    search_fields = (
        "text",
        "tournament__name",
    )

    raw_id_fields = (
        "tournament",
        "created_by",
    )

    ordering = (
        "tournament",
        "kind",
        "category",
        "order",
        "id",
    )
