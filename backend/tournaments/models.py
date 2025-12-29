"""
Moduł warstwy modelu domenowego odpowiedzialny za przechowywanie danych turnieju,
struktury organizacyjnej, uczestników oraz rozgrywek.

Definicje w tym pliku stanowią fundament dla konfiguracji turnieju,
generowania struktury rozgrywek oraz kontroli uprawnień w warstwie API.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models


# ============================================================
# TURNIEJ
# ============================================================

class Tournament(models.Model):
    """
    Model reprezentujący turniej sportowy.

    Kluczowe pola konfiguracyjne:
    - competition_type: TEAM / INDIVIDUAL
    - tournament_format: LEAGUE / CUP / MIXED
    - participants_count: liczba slotów startowych (niekoniecznie zatwierdzonych uczestników)
    - format_config: JSON z dodatkowymi parametrami formatu (np. liczba "legs" w lidze)
    - entry_mode: tryb dodawania uczestników
    - status: cykl życia turnieju (DRAFT -> CONFIGURED -> RUNNING -> FINISHED)
    """

    # ===== Słowniki wartości domenowych =====

    class Discipline(models.TextChoices):
        FOOTBALL = "football", "Piłka nożna"
        VOLLEYBALL = "volleyball", "Siatkówka"
        BASKETBALL = "basketball", "Koszykówka"
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
        ORGANIZER_ONLY = "ORGANIZER_ONLY", "Tylko organizator"
        OPEN_APPROVAL = "OPEN_APPROVAL", "Zgłoszenia z zatwierdzaniem"
        ACCOUNT_BASED = "ACCOUNT_BASED", "Uczestnicy z kontami"

    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Szkic"
        CONFIGURED = "CONFIGURED", "Skonfigurowany"
        RUNNING = "RUNNING", "W trakcie"
        FINISHED = "FINISHED", "Zakończony"

    # ===== Stałe konfiguracyjne dla format_config =====

    FORMATCFG_LEAGUE_LEGS_KEY = "league_legs"
    DEFAULT_LEAGUE_LEGS = 1  # 1 = bez rewanżu, 2 = z rewanżem

    # ===== Dane identyfikacyjne =====

    name = models.CharField(max_length=255)
    discipline = models.CharField(max_length=50, choices=Discipline.choices)

    organizer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="organized_tournaments",
    )

    # ===== Konfiguracja rozgrywek =====

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

    participants_count = models.PositiveIntegerField(default=2)
    """
    Planowana liczba slotów turniejowych (nie liczba faktycznych uczestników).
    """

    format_config = models.JSONField(default=dict, blank=True)
    """
    Szczegółowa konfiguracja formatu.
    Dla ligi używamy m.in. klucza:
    - format_config["league_legs"] = 1 lub 2
    """

    entry_mode = models.CharField(
        max_length=32,
        choices=EntryMode.choices,
        default=EntryMode.ORGANIZER_ONLY,
    )

    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.DRAFT,
    )

    # ===== Dostępność =====

    is_published = models.BooleanField(default=False)
    access_code = models.CharField(max_length=20, blank=True, null=True)

    # ===== Ramy czasowe =====

    start_date = models.DateField(blank=True, null=True)
    end_date = models.DateField(blank=True, null=True)

    # ===== Metadane =====

    created_at = models.DateTimeField(auto_now_add=True)

    # ===== Reguły domenowe / helpery =====

    @staticmethod
    def infer_default_competition_type(discipline: str) -> str:
        if discipline in (
            Tournament.Discipline.TENNIS,
            Tournament.Discipline.WRESTLING,
        ):
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
        """
        Zwraca liczbę "legs" w rozgrywkach ligowych:
        - 1 = każdy z każdym raz
        - 2 = każdy z każdym + rewanż (odwrócenie gospodarza)
        """
        raw = (self.format_config or {}).get(self.FORMATCFG_LEAGUE_LEGS_KEY, self.DEFAULT_LEAGUE_LEGS)
        try:
            legs = int(raw)
        except (TypeError, ValueError):
            legs = self.DEFAULT_LEAGUE_LEGS

        if legs not in (1, 2):
            legs = self.DEFAULT_LEAGUE_LEGS
        return legs

    def set_league_legs(self, legs: int) -> None:
        """
        Ustawia liczbę "legs" w lidze w format_config.
        Wartości dopuszczalne: 1 lub 2.
        """
        legs = int(legs)
        if legs not in (1, 2):
            raise ValueError("league_legs musi wynosić 1 albo 2.")
        cfg = dict(self.format_config or {})
        cfg[self.FORMATCFG_LEAGUE_LEGS_KEY] = legs
        self.format_config = cfg

    def __str__(self) -> str:
        return self.name


# ============================================================
# ROLE ORGANIZACYJNE
# ============================================================

class TournamentMembership(models.Model):
    """
    Relacja użytkownik–turniej dla ról organizacyjnych.
    """

    class Role(models.TextChoices):
        ASSISTANT = "ASSISTANT", "Asystent"

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

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tournament", "user"],
                name="uniq_tournament_user",
            )
        ]


# ============================================================
# DYWIZJE / KATEGORIE
# ============================================================

class Division(models.Model):
    """
    Kategoria rozgrywek w obrębie turnieju (np. wagowa).
    """

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
# UCZESTNICY (DRUŻYNY / ZAWODNICY)
# ============================================================

class Team(models.Model):
    """
    Jednostka startowa turnieju (drużyna lub zawodnik).
    """

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

    name = models.CharField(max_length=255)
    is_active = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


# ============================================================
# ETAPY TURNIEJU
# ============================================================

class Stage(models.Model):
    """
    Etap turnieju (liga, grupy, puchar).
    """

    class StageType(models.TextChoices):
        LEAGUE = "LEAGUE", "Liga"
        GROUP = "GROUP", "Faza grupowa"
        KNOCKOUT = "KNOCKOUT", "Puchar (KO)"

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
    """
    Grupa w ramach etapu grupowego.
    """

    stage = models.ForeignKey(
        Stage,
        on_delete=models.CASCADE,
        related_name="groups",
    )

    name = models.CharField(max_length=50)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["stage", "name"],
                name="uniq_stage_group_name",
            )
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.stage})"


# ============================================================
# MECZE
# ============================================================

class Match(models.Model):
    """
    Pojedyncze spotkanie turniejowe.

    round_number:
    - w lidze odpowiada numerowi kolejki (1..N),
    - w pucharze może oznaczać rundę, ale może być też null, jeśli trzymasz to inaczej.
    """

    class Status(models.TextChoices):
        SCHEDULED = "SCHEDULED", "Zaplanowany"
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

    home_score = models.PositiveIntegerField(blank=True, null=True)
    away_score = models.PositiveIntegerField(blank=True, null=True)

    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.SCHEDULED,
    )

    round_number = models.PositiveIntegerField(blank=True, null=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                check=~models.Q(home_team=models.F("away_team")),
                name="home_team_not_equal_away_team",
            )
        ]

    def __str__(self) -> str:
        return f"{self.home_team} vs {self.away_team}"
