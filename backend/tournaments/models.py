"""
Moduł warstwy modelu domenowego odpowiedzialny za przechowywanie danych turnieju,
struktury organizacyjnej, uczestników oraz rozgrywek.

Definicje w tym pliku stanowią fundament dla konfiguracji turnieju,
generowania struktury rozgrywek oraz kontroli uprawnień w warstwie API.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models
from django.db.models import Q


# ============================================================
# TURNIEJ
# ============================================================

class Tournament(models.Model):
    """
    Model reprezentujący turniej sportowy.

    Cykl życia:
    - status: DRAFT → CONFIGURED → RUNNING → FINISHED

    Docelowa logika:
    - entry_mode steruje WYŁĄCZNIE panelem zarządzania (kto może edytować).
      Aktywne tryby: MANAGER, ORGANIZER_ONLY.
    - dołączanie uczestników przez konto+kody to osobny toggle: join_enabled
      (działa zarówno w MANAGER jak i ORGANIZER_ONLY, ale toggle zmienia tylko organizator).
    - podgląd TournamentPublic (strona publiczna) to osobna polityka:
      * public widzi tylko gdy is_published=True (+ ewentualny access_code),
      * uczestnik (TournamentRegistration) może dostać preview przed publikacją tylko gdy
        participants_public_preview_enabled=True.
    - samodzielna zmiana nazwy przez uczestników:
      * jeśli participants_self_rename_enabled=True -> zmiana nazwy może dziać się od razu (bez kodu)
      * jeśli False -> tworzymy prośbę (kolejka) do akceptacji organizatora/asystenta.
    """

    class Discipline(models.TextChoices):
        FOOTBALL = "football", "Piłka nożna"
        VOLLEYBALL = "volleyball", "Siatkówka"
        BASKETBALL = "basketball", "Koszykówka"
        HANDBALL = "handball", "Piłka ręczna"
        TENNIS = "tennis", "Tenis"
        WRESTLING = "wrestling", "Zapasy"

    class CompetitionType(models.TextChoices):
        TEAM = "TEAM", "Drużynowy"
        INDIVIDUAL = "INDIVIDUAL", "Indywidualny"

    class TournamentFormat(models.TextChoices):
        CUP = "CUP", "Puchar"
        LEAGUE = "LEAGUE", "Liga"
        MIXED = "MIXED", "Mieszany"

    class EntryMode(models.TextChoices):
        MANAGER = "MANAGER", "Organizator + asystenci"
        ORGANIZER_ONLY = "ORGANIZER_ONLY", "Tylko organizator"

    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Szkic"
        CONFIGURED = "CONFIGURED", "Skonfigurowany"
        RUNNING = "RUNNING", "W trakcie"
        FINISHED = "FINISHED", "Zakończony"

    # Ujednolicenie klucza z Frontendem i bazą danych
    FORMATCFG_LEAGUE_LEGS_KEY = "league_matches"
    DEFAULT_LEAGUE_LEGS = 1

    name = models.CharField(max_length=255)

    discipline = models.CharField(
        max_length=50,
        choices=Discipline.choices,
    )

    organizer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="organized_tournaments",
    )

    competition_type = models.CharField(
        max_length=16,
        choices=CompetitionType.choices,
        default=CompetitionType.TEAM,
    )

    tournament_format = models.CharField(
        max_length=16,
        choices=TournamentFormat.choices,
        default=TournamentFormat.LEAGUE,
    )

    format_config = models.JSONField(default=dict, blank=True)

    # Panel management mode (nie mieszać z dołączaniem uczestników)
    entry_mode = models.CharField(
        max_length=32,
        choices=EntryMode.choices,
        default=EntryMode.MANAGER,
    )

    # Toggle dołączania przez konto + kod (działa w MANAGER i ORGANIZER_ONLY)
    join_enabled = models.BooleanField(
        default=False,
        db_index=True,
        help_text="Czy użytkownicy mogą dołączać do turnieju przez konto + kod (join link + code).",
    )

    # Czy uczestnik (TournamentRegistration) ma prawo podglądu TournamentPublic przed publikacją
    participants_public_preview_enabled = models.BooleanField(
        default=False,
        db_index=True,
        help_text="Czy zarejestrowani uczestnicy mogą oglądać TournamentPublic przed publikacją turnieju.",
    )

    # NOWE: czy uczestnicy mogą samodzielnie zmieniać swoją nazwę (bez akceptacji)
    # Domyślnie True, żeby nie zepsuć dotychczasowego UX (działa jak teraz).
    participants_self_rename_enabled = models.BooleanField(
        default=True,
        db_index=True,
        help_text="Czy uczestnicy mogą samodzielnie zmieniać nazwę (bez akceptacji organizatora/asystenta).",
    )

    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.DRAFT,
    )

    is_published = models.BooleanField(default=False)

    is_archived = models.BooleanField(
        default=False,
        db_index=True,
        help_text="Logiczne archiwum – turniej ukryty na głównych listach",
    )

    # Kod dostępu do podglądu publicznego
    access_code = models.CharField(max_length=20, blank=True, null=True)

    # Kod dołączania uczestników (JOIN CODE)
    registration_code = models.CharField(
        max_length=32,
        blank=True,
        null=True,
        help_text="Kod dołączania uczestników (JOIN) używany, gdy join_enabled=true.",
    )

    # Opis turnieju (widoczny w panelu publicznym)
    description = models.TextField(blank=True, null=True)

    # Harmonogram turnieju (opcjonalny)
    start_date = models.DateField(blank=True, null=True)
    end_date = models.DateField(blank=True, null=True)
    location = models.CharField(max_length=255, blank=True, null=True)

    created_at = models.DateTimeField(auto_now_add=True)

    @staticmethod
    def infer_default_competition_type(discipline: str) -> str:
        if discipline in (Tournament.Discipline.TENNIS, Tournament.Discipline.WRESTLING):
            return Tournament.CompetitionType.INDIVIDUAL
        return Tournament.CompetitionType.TEAM

    @staticmethod
    def allowed_formats_for_discipline(discipline: str) -> set[str]:
        return {
            Tournament.TournamentFormat.CUP,
            Tournament.TournamentFormat.LEAGUE,
            Tournament.TournamentFormat.MIXED,
        }

    def get_league_legs(self) -> int:
        raw = (self.format_config or {}).get(self.FORMATCFG_LEAGUE_LEGS_KEY, self.DEFAULT_LEAGUE_LEGS)
        try:
            value = int(raw)
        except (TypeError, ValueError):
            return self.DEFAULT_LEAGUE_LEGS
        return value if value in (1, 2) else self.DEFAULT_LEAGUE_LEGS

    def set_league_legs(self, legs: int) -> None:
        if legs not in (1, 2):
            raise ValueError("league_legs musi wynosić 1 albo 2")
        cfg = dict(self.format_config or {})
        cfg[self.FORMATCFG_LEAGUE_LEGS_KEY] = legs
        self.format_config = cfg

    def __str__(self) -> str:
        return self.name


# ============================================================
# ROLE ORGANIZACYJNE + UPRAWNIENIA (PER-ASYSTENT)
# ============================================================

class TournamentMembership(models.Model):
    """
    Membership asystenta w turnieju + granularne uprawnienia.
    """

    class Role(models.TextChoices):
        ASSISTANT = "ASSISTANT", "Asystent"

    PERM_TEAMS_EDIT = "teams_edit"
    PERM_SCHEDULE_EDIT = "schedule_edit"
    PERM_RESULTS_EDIT = "results_edit"
    PERM_BRACKET_EDIT = "bracket_edit"
    PERM_TOURNAMENT_EDIT = "tournament_edit"

    PERM_PUBLISH = "publish"
    PERM_ARCHIVE = "archive"
    PERM_MANAGE_ASSISTANTS = "manage_assistants"
    PERM_JOIN_SETTINGS = "join_settings"

    DEFAULT_PERMISSIONS_MANAGER = {
        PERM_TEAMS_EDIT: True,
        PERM_SCHEDULE_EDIT: True,
        PERM_RESULTS_EDIT: True,
        PERM_BRACKET_EDIT: True,
        PERM_TOURNAMENT_EDIT: True,
    }

    DEFAULT_PERMISSIONS_ORGANIZER_ONLY = {
        PERM_TEAMS_EDIT: False,
        PERM_SCHEDULE_EDIT: False,
        PERM_RESULTS_EDIT: False,
        PERM_BRACKET_EDIT: False,
        PERM_TOURNAMENT_EDIT: False,
    }

    tournament = models.ForeignKey(
        Tournament,
        on_delete=models.CASCADE,
        related_name="memberships",
    )

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="tournament_memberships",
    )

    role = models.CharField(
        max_length=20,
        choices=Role.choices,
        default=Role.ASSISTANT,
    )

    permissions = models.JSONField(
        default=dict,
        blank=True,
        help_text="Granularne uprawnienia asystenta w danym turnieju (JSON).",
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["tournament", "user"], name="uniq_tournament_user")
        ]

    def effective_permissions(self) -> dict:
        base = (
            self.DEFAULT_PERMISSIONS_ORGANIZER_ONLY
            if self.tournament.entry_mode == Tournament.EntryMode.ORGANIZER_ONLY
            else self.DEFAULT_PERMISSIONS_MANAGER
        )
        merged = dict(base)
        if isinstance(self.permissions, dict):
            merged.update(self.permissions)

        for k in (
            self.PERM_PUBLISH,
            self.PERM_ARCHIVE,
            self.PERM_MANAGE_ASSISTANTS,
            self.PERM_JOIN_SETTINGS,
        ):
            merged.pop(k, None)

        return merged


# ============================================================
# REJESTRACJE UCZESTNIKÓW (KONTA)
# ============================================================

class TournamentRegistration(models.Model):
    tournament = models.ForeignKey(
        Tournament,
        on_delete=models.CASCADE,
        related_name="registrations",
    )

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="tournament_registrations",
    )

    team = models.ForeignKey(
        "Team",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="registrations",
    )

    display_name = models.CharField(max_length=80)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tournament", "user"],
                name="uniq_registration_tournament_user",
            )
        ]

    def __str__(self) -> str:
        return f"{self.tournament_id}:{self.user_id} -> {self.display_name}"


# ============================================================
# KOLEJKA PRÓŚB O ZMIANĘ NAZWY (uczestnicy)
# ============================================================

class TeamNameChangeRequest(models.Model):
    """
    Prośba o zmianę nazwy Team złożona przez uczestnika.
    Używane, gdy (docelowo) tournament.participants_self_rename_enabled == False.

    Flow:
    - PENDING -> (APPROVED | REJECTED)
    - approve: zmienia Team.name + (opcjonalnie) TournamentRegistration.display_name
    """

    class Status(models.TextChoices):
        PENDING = "PENDING", "Oczekuje"
        APPROVED = "APPROVED", "Zaakceptowana"
        REJECTED = "REJECTED", "Odrzucona"

    tournament = models.ForeignKey(
        Tournament,
        on_delete=models.CASCADE,
        related_name="name_change_requests",
    )

    team = models.ForeignKey(
        "Team",
        on_delete=models.CASCADE,
        related_name="name_change_requests",
    )

    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="team_name_change_requests",
    )

    old_name = models.CharField(max_length=255)
    requested_name = models.CharField(max_length=255)

    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
    )

    decided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="team_name_change_decisions",
    )

    decided_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["team"],
                condition=Q(status="PENDING"),
                name="uniq_pending_name_change_per_team",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.tournament_id}:{self.team_id} {self.status} {self.old_name} -> {self.requested_name}"

# ============================================================
# DYWIZJE
# ============================================================

class Division(models.Model):
    tournament = models.ForeignKey(
        Tournament,
        on_delete=models.CASCADE,
        related_name="divisions",
    )

    name = models.CharField(max_length=120)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tournament", "name"],
                name="uniq_tournament_division_name",
            )
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.tournament})"


# ============================================================
# UCZESTNICY
# ============================================================

class Team(models.Model):
    tournament = models.ForeignKey(
        Tournament,
        on_delete=models.CASCADE,
        related_name="teams",
    )

    division = models.ForeignKey(
        Division,
        on_delete=models.SET_NULL,
        related_name="participants",
        blank=True,
        null=True,
    )

    registered_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="registered_teams",
        help_text="(Opcionalne) Użytkownik powiązany ze slotem Team. Preferuj TournamentRegistration.team.",
    )

    name = models.CharField(max_length=255)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        if self.registered_user_id:
            return f"{self.name} (U: {self.registered_user_id})"
        return self.name


# ============================================================
# ETAPY
# ============================================================

class Stage(models.Model):
    class StageType(models.TextChoices):
        LEAGUE = "LEAGUE", "Liga"
        GROUP = "GROUP", "Faza grupowa"
        KNOCKOUT = "KNOCKOUT", "Puchar (KO)"
        THIRD_PLACE = "THIRD_PLACE", "Mecz o 3. miejsce"

    class Status(models.TextChoices):
        OPEN = "OPEN", "Otwarty"
        CLOSED = "CLOSED", "Zamknięty"

    tournament = models.ForeignKey(
        Tournament,
        on_delete=models.CASCADE,
        related_name="stages",
    )

    division = models.ForeignKey(
        Division,
        on_delete=models.SET_NULL,
        related_name="stages",
        blank=True,
        null=True,
    )

    stage_type = models.CharField(
        max_length=20,
        choices=StageType.choices,
    )

    status = models.CharField(
        max_length=10,
        choices=Status.choices,
        default=Status.OPEN,
    )

    order = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["order"]

    def __str__(self) -> str:
        return f"{self.stage_type} ({self.tournament})"


# ============================================================
# GRUPY
# ============================================================

class Group(models.Model):
    stage = models.ForeignKey(
        Stage,
        on_delete=models.CASCADE,
        related_name="groups",
    )

    name = models.CharField(max_length=50)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["stage", "name"], name="uniq_stage_group_name")
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.stage})"


# ============================================================
# MECZE
# ============================================================

class Match(models.Model):
    class Status(models.TextChoices):
        SCHEDULED = "SCHEDULED", "Zaplanowany"
        IN_PROGRESS = "IN_PROGRESS", "W trakcie"
        FINISHED = "FINISHED", "Zakończony"

    tournament = models.ForeignKey(
        Tournament,
        on_delete=models.CASCADE,
        related_name="matches",
    )

    stage = models.ForeignKey(
        Stage,
        on_delete=models.CASCADE,
        related_name="matches",
    )

    group = models.ForeignKey(
        Group,
        on_delete=models.SET_NULL,
        related_name="matches",
        blank=True,
        null=True,
        help_text="Grupa (tylko dla fazy grupowej)",
    )

    home_team = models.ForeignKey(
        Team,
        on_delete=models.CASCADE,
        related_name="home_matches",
    )

    away_team = models.ForeignKey(
        Team,
        on_delete=models.CASCADE,
        related_name="away_matches",
    )

    home_score = models.PositiveIntegerField(default=0)
    away_score = models.PositiveIntegerField(default=0)

    tennis_sets = models.JSONField(
        blank=True,
        null=True,
        default=None,
        help_text="Dla tenisa: lista setów w gemach (opcjonalnie z tie-breakiem).",
    )

    went_to_extra_time = models.BooleanField(default=False)
    home_extra_time_score = models.PositiveSmallIntegerField(null=True, blank=True)
    away_extra_time_score = models.PositiveSmallIntegerField(null=True, blank=True)

    decided_by_penalties = models.BooleanField(default=False)
    home_penalty_score = models.PositiveSmallIntegerField(null=True, blank=True)
    away_penalty_score = models.PositiveSmallIntegerField(null=True, blank=True)

    result_entered = models.BooleanField(default=False)

    winner = models.ForeignKey(
        Team,
        on_delete=models.SET_NULL,
        related_name="won_matches",
        blank=True,
        null=True,
        help_text="Zwycięzca meczu (wymagany w KO)",
    )

    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.SCHEDULED,
    )

    round_number = models.PositiveIntegerField(
        blank=True,
        null=True,
        db_index=True,
        help_text="Numer kolejki / rundy",
    )

    scheduled_date = models.DateField(blank=True, null=True)
    scheduled_time = models.TimeField(blank=True, null=True)
    location = models.CharField(max_length=255, blank=True, null=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                check=~models.Q(home_team=models.F("away_team")),
                name="home_team_not_equal_away_team",
            )
        ]
        ordering = ["round_number", "id"]

    def __str__(self) -> str:
        return f"{self.home_team} vs {self.away_team}"
