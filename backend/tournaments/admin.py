# backend/tournaments/admin.py
# Plik definiuje konfigurację panelu administracyjnego dla modeli turniejowych, live i dywizji.

from django.contrib import admin

from .models import (
    Division,
    Match,
    MatchCommentaryEntry,
    Team,
    Tournament,
    TournamentCommentaryPhrase,
)


class DivisionInline(admin.TabularInline):
    model = Division
    extra = 0
    fields = ("name", "created_at")
    readonly_fields = ("created_at",)
    show_change_link = True


class TeamInline(admin.TabularInline):
    model = Team
    extra = 0
    fields = ("division", "name", "is_active")
    show_change_link = True


class MatchInline(admin.TabularInline):
    model = Match
    extra = 0

    fields = (
        "division_name",
        "stage",
        "group",
        "round_number",
        "home_team",
        "away_team",
        "home_score",
        "away_score",
        "scheduled_date",
        "scheduled_time",
        "location",
        "status",
    )

    readonly_fields = (
        "division_name",
        "stage",
        "group",
        "round_number",
        "home_team",
        "away_team",
    )

    show_change_link = True

    # Odczyt dywizji przez etap pozwala rozróżnić mecze wielu dywizji w jednym turnieju.
    def division_name(self, obj):
        if not obj or not getattr(obj, "stage_id", None):
            return "-"
        division = getattr(obj.stage, "division", None)
        return division.name if division else "-"

    division_name.short_description = "Dywizja"


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
        DivisionInline,
        TeamInline,
        MatchInline,
    ]


@admin.register(Division)
class DivisionAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "name",
        "tournament",
        "created_at",
    )

    list_filter = ("tournament",)
    search_fields = ("name", "tournament__name")
    ordering = ("tournament", "id")


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
        "match__stage__division",
    )

    search_fields = (
        "text",
        "match__home_team__name",
        "match__away_team__name",
        "match__tournament__name",
        "match__stage__division__name",
    )

    raw_id_fields = (
        "match",
        "created_by",
    )

    ordering = (
        "-created_at",
        "-id",
    )


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
