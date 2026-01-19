# backend/tournaments/models.py
"""
Moduł warstwy modelu domenowego odpowiedzialny za przechowywanie danych turnieju,
struktury organizacyjnej, uczestników oraz rozgrywek.

Definicje w tym pliku stanowią fundament dla konfiguracji turnieju,
generowania struktury rozgrywek oraz kontroli uprawnień w warstwie API.
"""

from __future__ import annotations

from datetime import datetime

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone


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

    Założenia:
    - Uprawnienia są per-asystent i trzymane w JSON (permissions).
    - effective_permissions() buduje uprawnienia efektywne jako:
        base (zależne od entry_mode) + override z permissions (jeśli klucz istnieje).
    - Brak fallbacków: jeśli nowa flaga (np. roster_edit) nie istnieje w permissions,
      to jej wartość wynika WYŁĄCZNIE z base.
    - Blokady organizer-only (publish/archive/manage_assistants/join_settings) są
      zawsze wycięte dla asystenta, niezależnie od payloadu.
    """

    class Role(models.TextChoices):
        ASSISTANT = "ASSISTANT", "Asystent"

    # ==== podstawowe (stare) ====
    PERM_TEAMS_EDIT = "teams_edit"
    PERM_SCHEDULE_EDIT = "schedule_edit"
    PERM_RESULTS_EDIT = "results_edit"
    PERM_BRACKET_EDIT = "bracket_edit"
    PERM_TOURNAMENT_EDIT = "tournament_edit"

    # ==== NOWE (bez fallbacków) ====
    PERM_ROSTER_EDIT = "roster_edit"                 # dodawanie/edycja zawodników w składach
    PERM_NAME_CHANGE_APPROVE = "name_change_approve" # akceptacja/odrzucanie kolejki zmian nazw

    # ==== organizer-only (asystent nigdy nie dostaje) ====
    PERM_PUBLISH = "publish"
    PERM_ARCHIVE = "archive"
    PERM_MANAGE_ASSISTANTS = "manage_assistants"
    PERM_JOIN_SETTINGS = "join_settings"

    # Domyślne bazowe uprawnienia w trybie MANAGER.
    # UWAGA: nowe flagi dajemy domyślnie False (bezpiecznie) – włączasz checkboxami w UI.
    DEFAULT_PERMISSIONS_MANAGER = {
        PERM_TEAMS_EDIT: True,
        PERM_SCHEDULE_EDIT: True,
        PERM_RESULTS_EDIT: True,
        PERM_BRACKET_EDIT: True,
        PERM_TOURNAMENT_EDIT: True,

        # NOWE (domyślnie WYŁĄCZONE, bez fallbacków)
        PERM_ROSTER_EDIT: True,
        PERM_NAME_CHANGE_APPROVE: True,
    }

    # W ORGANIZER_ONLY wszystko dla asystenta ma być zablokowane (zostaje tylko podgląd przez inne polityki).
    DEFAULT_PERMISSIONS_ORGANIZER_ONLY = {
        PERM_TEAMS_EDIT: False,
        PERM_SCHEDULE_EDIT: False,
        PERM_RESULTS_EDIT: False,
        PERM_BRACKET_EDIT: False,
        PERM_TOURNAMENT_EDIT: False,
        PERM_ROSTER_EDIT: False,
        PERM_NAME_CHANGE_APPROVE: False,
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
        """
        Zwraca uprawnienia efektywne asystenta.

        - Wybiera bazę w zależności od entry_mode.
        - Nadpisuje bazę kluczami z self.permissions (tylko jeśli permissions jest dict).
        - Wycinamy organizer-only klucze, niezależnie od tego co przyszło w JSON.
        """
        base = (
            self.DEFAULT_PERMISSIONS_ORGANIZER_ONLY
            if self.tournament.entry_mode == Tournament.EntryMode.ORGANIZER_ONLY
            else self.DEFAULT_PERMISSIONS_MANAGER
        )

        merged = dict(base)

        if isinstance(self.permissions, dict):
            merged.update(self.permissions)

        # twarde blokady — te rzeczy zawsze tylko organizer
        for k in (
            self.PERM_PUBLISH,
            self.PERM_ARCHIVE,
            self.PERM_MANAGE_ASSISTANTS,
            self.PERM_JOIN_SETTINGS,
        ):
            merged.pop(k, None)

        # Normalizacja typów do bool (żeby nie trafiły np. "true"/1)
        for k, v in list(merged.items()):
            merged[k] = bool(v)

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
# ZAWODNICY (SKŁAD DRUŻYNY)
# ============================================================

class TeamPlayer(models.Model):
    """
    Model reprezentujący zawodnika przypisanego do drużyny w ramach danego turnieju.

    Encja stanowi źródło danych dla składów drużynowych oraz incydentów meczowych,
    w których wymagane jest wskazanie konkretnego uczestnika (np. kartka, zmiana).
    """

    team = models.ForeignKey(
        Team,
        on_delete=models.CASCADE,
        related_name="players",
    )

    display_name = models.CharField(max_length=120)

    jersey_number = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="Indywidualny numer zawodnika (np. numer koszulki).",
    )

    is_active = models.BooleanField(
        default=True,
        db_index=True,
        help_text="Flaga logicznej aktywności zawodnika, pozwalająca zachować historię zdarzeń.",
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_team_players",
        help_text="Użytkownik, który wprowadził zawodnika do składu.",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["id"]
        constraints = [
            models.UniqueConstraint(
                fields=["team", "jersey_number"],
                condition=Q(jersey_number__isnull=False, is_active=True),
                name="uniq_active_jersey_number_per_team",
            )
        ]

    def __str__(self) -> str:
        return f"{self.display_name} ({self.team_id})"


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

    class ClockState(models.TextChoices):
        NOT_STARTED = "NOT_STARTED", "Nie rozpoczęty"
        RUNNING = "RUNNING", "W trakcie"
        PAUSED = "PAUSED", "Wstrzymany"
        STOPPED = "STOPPED", "Zatrzymany"

    class ClockPeriod(models.TextChoices):
        NONE = "NONE", "Brak"

        # Piłka nożna
        FH = "FH", "1 połowa"
        SH = "SH", "2 połowa"
        ET1 = "ET1", "Dogrywka 1"
        ET2 = "ET2", "Dogrywka 2"

        # Piłka ręczna (standard 2x30)
        H1 = "H1", "1 połowa (ręczna)"
        H2 = "H2", "2 połowa (ręczna)"

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
        help_text="Dla tenisa: lista zakończonych setów w gemach (opcjonalnie z tie-breakiem).",
    )

    # NOWE: stan bieżącego seta/gema (punkt po punkcie)
    tennis_state = models.JSONField(
        blank=True,
        null=True,
        default=None,
        help_text=(
            "Dla tenisa: bieżący stan punktów/gemów. "
            "Przykład: {home_games, away_games, home_points, away_points, in_tiebreak, home_tb, away_tb, set_index}."
        ),
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

    # ===== Zegar meczu =====
    clock_state = models.CharField(
        max_length=16,
        choices=ClockState.choices,
        default=ClockState.NOT_STARTED,
        db_index=True,
        help_text="Stan zegara wykorzystywanego do rejestrowania czasu zdarzeń meczowych.",
    )

    clock_period = models.CharField(
        max_length=8,
        choices=ClockPeriod.choices,
        default=ClockPeriod.NONE,
        db_index=True,
        help_text="Bieżący okres gry (np. połowa, dogrywka).",
    )

    clock_started_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Znacznik czasu uruchomienia aktualnego odcinka pomiaru czasu.",
    )

    clock_elapsed_seconds = models.PositiveIntegerField(
        default=0,
        help_text="Skumulowany czas (w sekundach) w obrębie bieżącego okresu, bez aktualnie trwającego odcinka.",
    )

    clock_added_seconds = models.PositiveIntegerField(
        default=0,
        help_text="Dodatkowy czas doliczony do bieżącego okresu (np. doliczony czas w piłce nożnej).",
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                check=~models.Q(home_team=models.F("away_team")),
                name="home_team_not_equal_away_team",
            )
        ]
        ordering = ["round_number", "id"]

    # ===== Pomocnicze wyliczenia zegara =====

    def clock_seconds_in_period(self, now: datetime | None = None) -> int:
        """
        Zwraca liczbę sekund, które upłynęły w bieżącym okresie gry.
        UWAGA: doliczamy clock_added_seconds, żeby działało 45+X itd.
        """
        now_dt = now or timezone.now()
        running = 0
        if self.clock_state == self.ClockState.RUNNING and self.clock_started_at:
            delta = now_dt - self.clock_started_at
            running = max(0, int(delta.total_seconds()))

        base = int(self.clock_elapsed_seconds or 0) + running
        added = int(self.clock_added_seconds or 0)
        return base + added

    def _clock_period_base_seconds(self) -> int:
        """
        Bazowy offset (sekundy) dla absolutnej osi czasu meczu.
        """
        d = self.tournament.discipline
        p = self.clock_period

        if d == Tournament.Discipline.FOOTBALL:
            mapping = {
                self.ClockPeriod.FH: 0,
                self.ClockPeriod.SH: 45 * 60,
                self.ClockPeriod.ET1: 90 * 60,
                self.ClockPeriod.ET2: 105 * 60,
            }
            return mapping.get(p, 0)

        if d == Tournament.Discipline.HANDBALL:
            mapping = {
                self.ClockPeriod.H1: 0,
                self.ClockPeriod.H2: 30 * 60,
            }
            return mapping.get(p, 0)

        return 0

    def clock_seconds_total(self, now: datetime | None = None) -> int:
        """
        Czas absolutny meczu (offset okresu + czas w okresie).
        """
        return self._clock_period_base_seconds() + self.clock_seconds_in_period(now=now)

    def clock_minute_total(self, now: datetime | None = None) -> int:
        """
        Minuta meczu w konwencji 1..N (np. 1,2,...).
        """
        seconds = self.clock_seconds_total(now=now)
        return int(seconds // 60) + 1

    def __str__(self) -> str:
        return f"{self.home_team} vs {self.away_team}"


# ============================================================
# INCYDENTY MECZOWE (BRAMKI, KARTKI, ZMIANY, KARY)
# ============================================================

class MatchIncident(models.Model):
    """
    Zdarzenie w trakcie meczu (oś czasu). Czas może pochodzić z zegara meczu lub ręcznie.
    """

    class Kind(models.TextChoices):
        GOAL = "GOAL", "Bramka"

        # Piłka nożna – rzut karny w trakcie gry (NIE seria po meczu)
        PENALTY_SCORED = "PENALTY_SCORED", "Rzut karny (gol)"
        PENALTY_MISSED = "PENALTY_MISSED", "Rzut karny (niewykorzystany)"

        YELLOW_CARD = "YELLOW_CARD", "Żółta kartka"
        RED_CARD = "RED_CARD", "Czerwona kartka"
        FOUL = "FOUL", "Faul"

        SUBSTITUTION = "SUBSTITUTION", "Zmiana"

        HANDBALL_TWO_MINUTES = "HANDBALL_TWO_MINUTES", "Kara 2 min (ręczna)"

        TENNIS_POINT = "TENNIS_POINT", "Punkt (tenis)"
        TENNIS_CODE_VIOLATION = "TENNIS_CODE_VIOLATION", "Naruszenie przepisów (tenis)"

        TIMEOUT = "TIMEOUT", "Przerwa/timeout"

    class TimeSource(models.TextChoices):
        CLOCK = "CLOCK", "Zegar meczu"
        MANUAL = "MANUAL", "Wprowadzony ręcznie"

    match = models.ForeignKey(
        Match,
        on_delete=models.CASCADE,
        related_name="incidents",
    )

    team = models.ForeignKey(
        Team,
        on_delete=models.CASCADE,
        related_name="incidents",
    )

    kind = models.CharField(
        max_length=40,
        choices=Kind.choices,
        db_index=True,
    )

    period = models.CharField(
        max_length=8,
        choices=Match.ClockPeriod.choices,
        default=Match.ClockPeriod.NONE,
        db_index=True,
        help_text="Okres gry w momencie rejestracji zdarzenia (np. połowa, dogrywka).",
    )

    time_source = models.CharField(
        max_length=8,
        choices=TimeSource.choices,
        default=TimeSource.CLOCK,
        help_text="Źródło czasu zdarzenia, istotne przy korektach oraz analizie przebiegu meczu.",
    )

    minute = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        db_index=True,
        help_text="Minuta zdarzenia w osi czasu meczu (może być pusta w dyscyplinach bez zegara).",
    )

    minute_raw = models.CharField(
        max_length=12,
        null=True,
        blank=True,
        help_text="Oryginalny zapis minuty (np. '90+3'), do wiernej prezentacji.",
    )

    player = models.ForeignKey(
        TeamPlayer,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="incidents",
        help_text="Zawodnik zdarzenia jednoosobowego (kartka, faul).",
    )

    player_in = models.ForeignKey(
        TeamPlayer,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="incidents_in",
        help_text="Zawodnik wchodzący (zmiana).",
    )

    player_out = models.ForeignKey(
        TeamPlayer,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="incidents_out",
        help_text="Zawodnik schodzący (zmiana).",
    )

    meta = models.JSONField(
        default=dict,
        blank=True,
        help_text="Dodatkowe dane zależne od dyscypliny i typu zdarzenia.",
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_match_incidents",
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
        indexes = [
            models.Index(fields=["match", "created_at"], name="idx_incident_match_time"),
            models.Index(fields=["match", "team", "kind"], name="idx_incident_m_team_kind"),
        ]
        constraints = [
            models.CheckConstraint(
                check=(~Q(kind="SUBSTITUTION") | (Q(player_in__isnull=False) & Q(player_out__isnull=False))),
                name="sub_req_players_in_out",
            ),
            models.CheckConstraint(
                check=(Q(kind="SUBSTITUTION") | (Q(player_in__isnull=True) & Q(player_out__isnull=True))),
                name="non_sub_no_players_in_out",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.match_id}:{self.team_id} {self.kind} @{self.minute or '-'}"

