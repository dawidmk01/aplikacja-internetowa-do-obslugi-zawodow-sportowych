# backend/tournaments/admin.py
# Plik definiuje konfigurację panelu administracyjnego dla modeli turniejowych, live i dywizji.

from django.contrib import admin
from django.db.models import Count

from .models import (
    Division,
    DivisionChangeRequest,
    Group,
    Match,
    MatchCommentaryEntry,
    MatchCustomResult,
    MatchIncident,
    Stage,
    StageMassStartEntry,
    StageMassStartResult,
    Team,
    TeamNameChangeRequest,
    TeamPlayer,
    Tournament,
    TournamentAssistantInvite,
    TournamentCommentaryPhrase,
    TournamentMembership,
    TournamentRegistration,
)


# ===== Funkcje pomocnicze admina =====


def short_text(value: str | None, limit: int = 80) -> str:
    text = str(value or "").strip()
    if not text:
        return "-"
    return text[:limit] + ("..." if len(text) > limit else "")


# ===== Inline dla widoku turnieju =====


class DivisionInline(admin.TabularInline):
    model = Division
    extra = 0
    fields = ("name", "slug", "order", "is_default", "is_archived", "status", "created_at")
    readonly_fields = ("created_at",)
    show_change_link = True


class TournamentMembershipInline(admin.TabularInline):
    model = TournamentMembership
    extra = 0
    fields = ("user", "role", "status", "invited_by", "responded_at", "created_at")
    readonly_fields = ("created_at",)
    raw_id_fields = ("user", "invited_by")
    show_change_link = True


class TournamentAssistantInviteInline(admin.TabularInline):
    model = TournamentAssistantInvite
    extra = 0
    fields = ("invited_email", "status", "invited_by", "responded_at", "created_at")
    readonly_fields = ("normalized_email", "responded_at", "created_at", "updated_at")
    raw_id_fields = ("invited_by",)
    show_change_link = True


class TeamInline(admin.TabularInline):
    model = Team
    extra = 0
    fields = ("division", "name", "registered_user", "is_active", "created_at")
    readonly_fields = ("created_at",)
    raw_id_fields = ("division", "registered_user")
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
        "scoreline",
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
        "scoreline",
    )
    show_change_link = True

    # Odczyt dywizji przez etap pozwala rozróżnić mecze wielu dywizji w jednym turnieju.
    @admin.display(description="Division")
    def division_name(self, obj: Match) -> str:
        if not obj or not getattr(obj, "stage_id", None):
            return "-"
        division = getattr(obj.stage, "division", None)
        return division.name if division else "-"

    @admin.display(description="Score")
    def scoreline(self, obj: Match) -> str:
        if not obj or not getattr(obj, "pk", None):
            return "-"
        return f"{obj.home_score}:{obj.away_score}"


# ===== Inline dla struktury sportowej =====


class StageInline(admin.TabularInline):
    model = Stage
    extra = 0
    fields = ("stage_type", "status", "order", "scheduled_date", "scheduled_time", "location", "is_archived")
    readonly_fields = ("created_at",)
    show_change_link = True


class GroupInline(admin.TabularInline):
    model = Group
    extra = 0
    fields = ("name", "scheduled_date", "scheduled_time", "location")
    show_change_link = True


class TeamPlayerInline(admin.TabularInline):
    model = TeamPlayer
    extra = 0
    fields = ("display_name", "jersey_number", "is_active", "created_by", "created_at")
    readonly_fields = ("created_at",)
    raw_id_fields = ("created_by",)
    show_change_link = True


class MatchIncidentInline(admin.TabularInline):
    model = MatchIncident
    extra = 0
    fields = ("team", "kind", "period", "time_source", "minute_raw", "player", "created_by", "created_at")
    readonly_fields = ("created_at",)
    raw_id_fields = ("team", "player", "created_by")
    show_change_link = True


class MatchCommentaryEntryInline(admin.TabularInline):
    model = MatchCommentaryEntry
    extra = 0
    fields = ("period", "time_source", "minute_raw", "text_preview", "created_by", "created_at")
    readonly_fields = ("text_preview", "created_at")
    raw_id_fields = ("created_by",)
    show_change_link = True

    @admin.display(description="Comment")
    def text_preview(self, obj: MatchCommentaryEntry) -> str:
        return short_text(obj.text)


class MatchCustomResultInline(admin.TabularInline):
    model = MatchCustomResult
    extra = 0
    fields = ("team", "value_kind", "display_value", "rank", "is_active", "updated_at")
    readonly_fields = ("updated_at",)
    raw_id_fields = ("team",)
    show_change_link = True


class StageMassStartEntryInline(admin.TabularInline):
    model = StageMassStartEntry
    fk_name = "stage"
    extra = 0
    fields = ("group", "team", "seed", "source_stage", "source_group", "source_rank", "is_active")
    raw_id_fields = ("group", "team", "source_stage", "source_group")
    show_change_link = True


class StageMassStartResultInline(admin.TabularInline):
    model = StageMassStartResult
    extra = 0
    fields = ("group", "team", "round_number", "value_kind", "result_status", "display_value", "rank", "updated_at")
    readonly_fields = ("updated_at",)
    raw_id_fields = ("group", "team")
    show_change_link = True


# ===== Turnieje i konfiguracja =====


@admin.register(Tournament)
class TournamentAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "name",
        "discipline",
        "competition_model",
        "tournament_format",
        "result_mode",
        "status",
        "is_published",
        "is_archived",
        "divisions_count",
        "teams_count",
        "matches_count",
        "created_at",
    )
    list_filter = (
        "discipline",
        "competition_type",
        "competition_model",
        "tournament_format",
        "result_mode",
        "entry_mode",
        "status",
        "is_published",
        "is_archived",
        "join_enabled",
        "participants_public_preview_enabled",
        "participants_self_rename_enabled",
    )
    search_fields = ("name", "organizer__email", "access_code", "registration_code", "location")
    readonly_fields = ("created_at",)
    raw_id_fields = ("organizer",)
    list_select_related = ("organizer",)
    ordering = ("-created_at", "-id")
    save_on_top = True
    inlines = (
        DivisionInline,
        TournamentMembershipInline,
        TournamentAssistantInviteInline,
        TeamInline,
        MatchInline,
    )

    fieldsets = (
        ("Basic information", {"fields": ("name", "description", "discipline", "custom_discipline_name", "organizer")}),
        ("Competition model", {"fields": ("competition_type", "competition_model", "tournament_format", "result_mode", "entry_mode")}),
        ("Technical configuration", {"fields": ("format_config", "result_config")}),
        ("Publication and access", {"fields": ("status", "is_published", "is_archived", "join_enabled", "participants_public_preview_enabled", "participants_self_rename_enabled", "access_code", "registration_code")}),
        ("Date and location", {"fields": ("start_date", "end_date", "location")}),
        ("Metadata", {"fields": ("created_at",)}),
    )

    def get_queryset(self, request):
        qs = super().get_queryset(request)
        return qs.annotate(
            _divisions_count=Count("divisions", distinct=True),
            _teams_count=Count("teams", distinct=True),
            _matches_count=Count("matches", distinct=True),
        )

    @admin.display(description="Divisions", ordering="_divisions_count")
    def divisions_count(self, obj: Tournament) -> int:
        return int(getattr(obj, "_divisions_count", 0) or 0)

    @admin.display(description="Participants", ordering="_teams_count")
    def teams_count(self, obj: Tournament) -> int:
        return int(getattr(obj, "_teams_count", 0) or 0)

    @admin.display(description="Matches", ordering="_matches_count")
    def matches_count(self, obj: Tournament) -> int:
        return int(getattr(obj, "_matches_count", 0) or 0)


@admin.register(Division)
class DivisionAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "name",
        "tournament",
        "order",
        "is_default",
        "is_archived",
        "competition_model",
        "tournament_format",
        "result_mode",
        "status",
        "participants_count",
        "stages_count",
    )
    list_filter = ("is_default", "is_archived", "competition_model", "tournament_format", "result_mode", "status")
    search_fields = ("name", "slug", "tournament__name")
    readonly_fields = ("created_at", "updated_at")
    raw_id_fields = ("tournament",)
    list_select_related = ("tournament",)
    ordering = ("tournament", "order", "id")
    inlines = (StageInline, TeamInline)

    fieldsets = (
        ("Identification", {"fields": ("tournament", "name", "slug", "order", "is_default", "is_archived")}),
        ("Competition model", {"fields": ("competition_type", "competition_model", "tournament_format", "result_mode", "status")}),
        ("Technical configuration", {"fields": ("format_config", "result_config")}),
        ("Metadata", {"fields": ("created_at", "updated_at")}),
    )

    def get_queryset(self, request):
        qs = super().get_queryset(request)
        return qs.annotate(
            _participants_count=Count("participants", distinct=True),
            _stages_count=Count("stages", distinct=True),
        )

    @admin.display(description="Participants", ordering="_participants_count")
    def participants_count(self, obj: Division) -> int:
        return int(getattr(obj, "_participants_count", 0) or 0)

    @admin.display(description="Stages", ordering="_stages_count")
    def stages_count(self, obj: Division) -> int:
        return int(getattr(obj, "_stages_count", 0) or 0)


@admin.register(TournamentMembership)
class TournamentMembershipAdmin(admin.ModelAdmin):
    list_display = ("id", "tournament", "user", "role", "status", "invited_by", "responded_at", "created_at")
    list_filter = ("role", "status", "created_at", "responded_at")
    search_fields = ("tournament__name", "user__email", "invited_by__email")
    readonly_fields = ("created_at",)
    raw_id_fields = ("tournament", "user", "invited_by")
    list_select_related = ("tournament", "user", "invited_by")
    ordering = ("-created_at", "-id")


@admin.register(TournamentAssistantInvite)
class TournamentAssistantInviteAdmin(admin.ModelAdmin):
    list_display = ("id", "tournament", "invited_email", "status", "invited_by", "responded_at", "created_at", "updated_at")
    list_filter = ("status", "created_at", "updated_at", "responded_at")
    search_fields = ("tournament__name", "invited_email", "normalized_email", "invited_by__email")
    readonly_fields = ("normalized_email", "created_at", "updated_at")
    raw_id_fields = ("tournament", "invited_by")
    list_select_related = ("tournament", "invited_by")
    ordering = ("-created_at", "-id")


@admin.register(TournamentRegistration)
class TournamentRegistrationAdmin(admin.ModelAdmin):
    list_display = ("id", "tournament", "division", "user", "team", "display_name", "created_at", "updated_at")
    list_filter = ("created_at", "updated_at", "division")
    search_fields = ("tournament__name", "division__name", "user__email", "team__name", "display_name")
    readonly_fields = ("created_at", "updated_at")
    raw_id_fields = ("tournament", "division", "user", "team")
    list_select_related = ("tournament", "division", "user", "team")
    ordering = ("-created_at", "-id")


@admin.register(TeamNameChangeRequest)
class TeamNameChangeRequestAdmin(admin.ModelAdmin):
    list_display = ("id", "tournament", "team", "requested_name", "status", "requested_by", "decided_by", "decided_at", "created_at")
    list_filter = ("status", "created_at", "decided_at")
    search_fields = ("tournament__name", "team__name", "requested_by__email", "old_name", "requested_name")
    readonly_fields = ("created_at",)
    raw_id_fields = ("tournament", "team", "requested_by", "decided_by")
    list_select_related = ("tournament", "team", "requested_by", "decided_by")
    ordering = ("-created_at", "-id")


@admin.register(DivisionChangeRequest)
class DivisionChangeRequestAdmin(admin.ModelAdmin):
    list_display = ("id", "tournament", "team", "from_division", "to_division", "status", "requested_by", "decided_by", "decided_at", "created_at")
    list_filter = ("status", "created_at", "decided_at", "from_division", "to_division")
    search_fields = ("tournament__name", "team__name", "requested_by__email", "from_division__name", "to_division__name")
    readonly_fields = ("created_at",)
    raw_id_fields = ("tournament", "registration", "team", "requested_by", "from_division", "to_division", "decided_by")
    list_select_related = ("tournament", "registration", "team", "requested_by", "from_division", "to_division", "decided_by")
    ordering = ("-created_at", "-id")


# ===== Uczestnicy i struktura rozgrywek =====


@admin.register(Team)
class TeamAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "tournament", "division", "registered_user", "is_active", "players_count", "created_at")
    list_filter = ("is_active", "created_at", "division")
    search_fields = ("name", "tournament__name", "division__name", "registered_user__email")
    readonly_fields = ("created_at",)
    raw_id_fields = ("tournament", "division", "registered_user")
    list_select_related = ("tournament", "division", "registered_user")
    ordering = ("tournament", "division", "name", "id")
    inlines = (TeamPlayerInline,)

    def get_queryset(self, request):
        qs = super().get_queryset(request)
        return qs.annotate(_players_count=Count("players", distinct=True))

    @admin.display(description="Players", ordering="_players_count")
    def players_count(self, obj: Team) -> int:
        return int(getattr(obj, "_players_count", 0) or 0)


@admin.register(TeamPlayer)
class TeamPlayerAdmin(admin.ModelAdmin):
    list_display = ("id", "display_name", "team", "jersey_number", "is_active", "created_by", "created_at", "updated_at")
    list_filter = ("is_active", "created_at", "updated_at")
    search_fields = ("display_name", "team__name", "team__tournament__name", "created_by__email")
    readonly_fields = ("created_at", "updated_at")
    raw_id_fields = ("team", "created_by")
    list_select_related = ("team", "team__tournament", "created_by")
    ordering = ("team", "id")


@admin.register(Stage)
class StageAdmin(admin.ModelAdmin):
    list_display = ("id", "tournament", "division", "stage_type", "status", "order", "scheduled_date", "scheduled_time", "is_archived", "groups_count", "matches_count")
    list_filter = ("stage_type", "status", "is_archived", "scheduled_date", "division")
    search_fields = ("tournament__name", "division__name", "location", "archive_reason")
    readonly_fields = ("created_at",)
    raw_id_fields = ("tournament", "division")
    list_select_related = ("tournament", "division")
    ordering = ("tournament", "division", "order", "id")
    inlines = (GroupInline, StageMassStartEntryInline, StageMassStartResultInline)

    def get_queryset(self, request):
        qs = super().get_queryset(request)
        return qs.annotate(
            _groups_count=Count("groups", distinct=True),
            _matches_count=Count("matches", distinct=True),
        )

    @admin.display(description="Groups", ordering="_groups_count")
    def groups_count(self, obj: Stage) -> int:
        return int(getattr(obj, "_groups_count", 0) or 0)

    @admin.display(description="Matches", ordering="_matches_count")
    def matches_count(self, obj: Stage) -> int:
        return int(getattr(obj, "_matches_count", 0) or 0)


@admin.register(Group)
class GroupAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "stage", "tournament_name", "division_name", "scheduled_date", "scheduled_time", "location")
    list_filter = ("stage__stage_type", "stage__status", "scheduled_date")
    search_fields = ("name", "stage__tournament__name", "stage__division__name", "location")
    raw_id_fields = ("stage",)
    list_select_related = ("stage", "stage__tournament", "stage__division")
    ordering = ("stage", "name", "id")

    @admin.display(description="Tournament")
    def tournament_name(self, obj: Group) -> str:
        return obj.stage.tournament.name

    @admin.display(description="Division")
    def division_name(self, obj: Group) -> str:
        return obj.stage.division.name if obj.stage.division_id else "-"


# ===== Mecze, LIVE i wyniki =====


@admin.register(Match)
class MatchAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "tournament",
        "division_name",
        "stage",
        "group",
        "round_number",
        "home_team",
        "away_team",
        "scoreline",
        "status",
        "clock_state",
        "clock_period",
        "scheduled_date",
        "scheduled_time",
    )
    list_filter = (
        "status",
        "clock_state",
        "clock_period",
        "stage__stage_type",
        "stage__division",
        "scheduled_date",
        "result_entered",
        "went_to_extra_time",
        "decided_by_penalties",
    )
    search_fields = (
        "tournament__name",
        "stage__division__name",
        "home_team__name",
        "away_team__name",
        "location",
    )
    readonly_fields = ("created_at", "scoreline", "clock_total_seconds")
    raw_id_fields = ("tournament", "stage", "group", "home_team", "away_team", "winner")
    list_select_related = ("tournament", "stage", "stage__division", "group", "home_team", "away_team", "winner")
    ordering = ("tournament", "stage__division", "stage__order", "round_number", "id")
    save_on_top = True
    inlines = (MatchIncidentInline, MatchCommentaryEntryInline, MatchCustomResultInline)

    fieldsets = (
        ("Context", {"fields": ("tournament", "stage", "group", "round_number")}),
        ("Participants", {"fields": ("home_team", "away_team", "winner")}),
        ("Result", {"fields": ("home_score", "away_score", "scoreline", "result_entered", "tennis_sets", "tennis_state", "went_to_extra_time", "home_extra_time_score", "away_extra_time_score", "decided_by_penalties", "home_penalty_score", "away_penalty_score", "wrestling_result_method", "home_classification_points", "away_classification_points")}),
        ("Schedule", {"fields": ("scheduled_date", "scheduled_time", "location", "status")}),
        ("LIVE clock", {"fields": ("clock_state", "clock_period", "clock_started_at", "clock_elapsed_seconds", "clock_added_seconds", "clock_total_seconds")}),
        ("Metadata", {"fields": ("created_at",)}),
    )

    @admin.display(description="Division")
    def division_name(self, obj: Match) -> str:
        return obj.stage.division.name if obj.stage.division_id else "-"

    @admin.display(description="Score")
    def scoreline(self, obj: Match) -> str:
        return f"{obj.home_score}:{obj.away_score}"

    @admin.display(description="Total clock time")
    def clock_total_seconds(self, obj: Match) -> int:
        return obj.clock_seconds_total()


@admin.register(MatchCustomResult)
class MatchCustomResultAdmin(admin.ModelAdmin):
    list_display = ("id", "match", "team", "value_kind", "display_value", "rank", "is_active", "created_by", "updated_by", "updated_at")
    list_filter = ("value_kind", "is_active", "created_at", "updated_at")
    search_fields = ("match__tournament__name", "team__name", "display_value")
    readonly_fields = ("created_at", "updated_at")
    raw_id_fields = ("match", "team", "created_by", "updated_by")
    list_select_related = ("match", "match__tournament", "team", "created_by", "updated_by")
    ordering = ("match", "rank", "id")


@admin.register(StageMassStartEntry)
class StageMassStartEntryAdmin(admin.ModelAdmin):
    list_display = ("id", "stage", "group", "team", "seed", "source_stage", "source_group", "source_rank", "is_active", "created_at")
    list_filter = ("is_active", "created_at", "stage__division")
    search_fields = ("stage__tournament__name", "stage__division__name", "group__name", "team__name")
    readonly_fields = ("created_at",)
    raw_id_fields = ("stage", "group", "team", "source_stage", "source_group")
    list_select_related = ("stage", "stage__tournament", "stage__division", "group", "team", "source_stage", "source_group")
    ordering = ("stage", "group", "seed", "team", "id")


@admin.register(StageMassStartResult)
class StageMassStartResultAdmin(admin.ModelAdmin):
    list_display = ("id", "stage", "group", "team", "round_number", "value_kind", "result_status", "display_value", "rank", "is_active", "updated_at")
    list_filter = ("value_kind", "result_status", "is_active", "created_at", "updated_at", "stage__division")
    search_fields = ("stage__tournament__name", "stage__division__name", "group__name", "team__name", "display_value")
    readonly_fields = ("created_at", "updated_at")
    raw_id_fields = ("stage", "group", "team", "created_by", "updated_by")
    list_select_related = ("stage", "stage__tournament", "stage__division", "group", "team", "created_by", "updated_by")
    ordering = ("stage", "group", "rank", "round_number", "id")


@admin.register(MatchIncident)
class MatchIncidentAdmin(admin.ModelAdmin):
    list_display = ("id", "match", "team", "kind", "period", "time_source", "minute", "minute_raw", "player", "created_by", "created_at")
    list_filter = ("kind", "period", "time_source", "created_at", "match__stage__division")
    search_fields = ("match__tournament__name", "match__home_team__name", "match__away_team__name", "team__name", "player__display_name", "minute_raw")
    readonly_fields = ("created_at",)
    raw_id_fields = ("match", "team", "player", "player_in", "player_out", "created_by")
    list_select_related = ("match", "match__tournament", "match__stage", "match__stage__division", "team", "player", "player_in", "player_out", "created_by")
    ordering = ("-created_at", "-id")


@admin.register(MatchCommentaryEntry)
class MatchCommentaryEntryAdmin(admin.ModelAdmin):
    list_display = ("id", "match", "minute", "minute_raw", "period", "time_source", "text_preview", "created_by", "created_at")
    list_filter = ("period", "time_source", "created_at", "match__stage__division")
    search_fields = ("text", "match__home_team__name", "match__away_team__name", "match__tournament__name", "match__stage__division__name")
    readonly_fields = ("created_at",)
    raw_id_fields = ("match", "created_by")
    list_select_related = ("match", "match__tournament", "match__stage", "match__stage__division", "created_by")
    ordering = ("-created_at", "-id")

    @admin.display(description="Comment")
    def text_preview(self, obj: MatchCommentaryEntry) -> str:
        return short_text(obj.text)


@admin.register(TournamentCommentaryPhrase)
class TournamentCommentaryPhraseAdmin(admin.ModelAdmin):
    list_display = ("id", "tournament", "kind", "category", "text_preview", "order", "is_active", "created_by", "updated_at")
    list_filter = ("kind", "category", "is_active", "updated_at")
    search_fields = ("text", "tournament__name", "category", "created_by__email")
    readonly_fields = ("created_at", "updated_at")
    raw_id_fields = ("tournament", "created_by")
    list_select_related = ("tournament", "created_by")
    ordering = ("tournament", "kind", "category", "order", "id")

    @admin.display(description="Text")
    def text_preview(self, obj: TournamentCommentaryPhrase) -> str:
        return short_text(obj.text)
