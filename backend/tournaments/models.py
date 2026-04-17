# backend/tournaments/models.py
# Plik definiuje modele domenowe odpowiedzialne za konfigurację turnieju, dywizji, uczestników, etapów i wyników.

from __future__ import annotations

from datetime import datetime
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Max, Q
from django.utils import timezone
from django.utils.text import slugify


class Tournament(models.Model):
    class Discipline(models.TextChoices):
        FOOTBALL = "football", "Piłka nożna"
        VOLLEYBALL = "volleyball", "Siatkówka"
        BASKETBALL = "basketball", "Koszykówka"
        HANDBALL = "handball", "Piłka ręczna"
        TENNIS = "tennis", "Tenis"
        WRESTLING = "wrestling", "Zapasy"
        CUSTOM = "custom", "Inna / niestandardowa"

    class ResultMode(models.TextChoices):
        SCORE = "SCORE", "Klasyczny wynik"
        CUSTOM = "CUSTOM", "Wynik niestandardowy"

    class CompetitionType(models.TextChoices):
        TEAM = "TEAM", "Drużynowy"
        INDIVIDUAL = "INDIVIDUAL", "Indywidualny"

    class CompetitionModel(models.TextChoices):
        HEAD_TO_HEAD = "HEAD_TO_HEAD", "Pojedynki / mecze"
        MASS_START = "MASS_START", "Wszyscy razem"

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

    FORMATCFG_LEAGUE_LEGS_KEY = "league_matches"
    DEFAULT_LEAGUE_LEGS = 1

    RESULTCFG_CUSTOM_MODE_KEY = "custom_mode"
    RESULTCFG_VALUE_KIND_KEY = "value_kind"
    RESULTCFG_UNIT_PRESET_KEY = "unit_preset"
    RESULTCFG_UNIT_KEY = "unit"
    RESULTCFG_UNIT_LABEL_KEY = "unit_label"
    RESULTCFG_BETTER_RESULT_KEY = "better_result"
    RESULTCFG_DECIMAL_PLACES_KEY = "decimal_places"
    RESULTCFG_TIME_FORMAT_KEY = "time_format"
    RESULTCFG_ALLOW_TIES_KEY = "allow_ties"
    RESULTCFG_ROUNDS_COUNT_KEY = "rounds_count"
    RESULTCFG_AGGREGATION_MODE_KEY = "aggregation_mode"
    RESULTCFG_STAGES_KEY = "stages"

    RESULTCFG_POINTS_WIN_KEY = "points_win"
    RESULTCFG_POINTS_DRAW_KEY = "points_draw"
    RESULTCFG_POINTS_LOSS_KEY = "points_loss"
    RESULTCFG_ALLOW_DRAW_KEY = "allow_draw"
    RESULTCFG_ALLOW_OVERTIME_KEY = "allow_overtime"
    RESULTCFG_ALLOW_SHOOTOUT_KEY = "allow_shootout"
    RESULTCFG_POINTS_OVERTIME_WIN_KEY = "points_overtime_win"
    RESULTCFG_POINTS_OVERTIME_LOSS_KEY = "points_overtime_loss"
    RESULTCFG_POINTS_SHOOTOUT_WIN_KEY = "points_shootout_win"
    RESULTCFG_POINTS_SHOOTOUT_LOSS_KEY = "points_shootout_loss"
    RESULTCFG_LEGS_COUNT_KEY = "legs_count"
    RESULTCFG_BEST_OF_KEY = "best_of"

    RESULTCFG_STAGE_NAME_KEY = "name"
    RESULTCFG_STAGE_GROUPS_COUNT_KEY = "groups_count"
    RESULTCFG_STAGE_PARTICIPANTS_COUNT_KEY = "participants_count"
    RESULTCFG_STAGE_ADVANCE_COUNT_KEY = "advance_count"
    RESULTCFG_STAGE_ROUNDS_COUNT_KEY = "rounds_count"
    RESULTCFG_STAGE_AGGREGATION_MODE_KEY = "aggregation_mode"

    RESULTCFG_CUSTOM_MODE_HEAD_TO_HEAD_POINTS = "HEAD_TO_HEAD_POINTS"
    RESULTCFG_CUSTOM_MODE_MASS_START_MEASURED = "MASS_START_MEASURED"

    RESULTCFG_VALUE_KIND_NUMBER = "NUMBER"
    RESULTCFG_VALUE_KIND_TIME = "TIME"
    RESULTCFG_VALUE_KIND_PLACE = "PLACE"

    RESULTCFG_UNIT_PRESET_POINTS = "POINTS"
    RESULTCFG_UNIT_PRESET_SECONDS = "SECONDS"
    RESULTCFG_UNIT_PRESET_MILLISECONDS = "MILLISECONDS"
    RESULTCFG_UNIT_PRESET_MINUTES = "MINUTES"
    RESULTCFG_UNIT_PRESET_METERS = "METERS"
    RESULTCFG_UNIT_PRESET_CENTIMETERS = "CENTIMETERS"
    RESULTCFG_UNIT_PRESET_KILOGRAMS = "KILOGRAMS"
    RESULTCFG_UNIT_PRESET_GRAMS = "GRAMS"
    RESULTCFG_UNIT_PRESET_REPS = "REPS"
    RESULTCFG_UNIT_PRESET_PLACE = "PLACE"
    RESULTCFG_UNIT_PRESET_CUSTOM = "CUSTOM"

    RESULTCFG_BETTER_RESULT_HIGHER = "HIGHER"
    RESULTCFG_BETTER_RESULT_LOWER = "LOWER"

    RESULTCFG_TIME_FORMAT_HH_MM_SS = "HH:MM:SS"
    RESULTCFG_TIME_FORMAT_MM_SS = "MM:SS"
    RESULTCFG_TIME_FORMAT_MM_SS_HH = "MM:SS.hh"
    RESULTCFG_TIME_FORMAT_SS_HH = "SS.hh"

    RESULTCFG_AGGREGATION_SUM = "SUM"
    RESULTCFG_AGGREGATION_AVERAGE = "AVERAGE"
    RESULTCFG_AGGREGATION_BEST = "BEST"
    RESULTCFG_AGGREGATION_LAST_ROUND = "LAST_ROUND"

    MAX_CUSTOM_STAGE_LEVELS = 3

    name = models.CharField(max_length=255)

    discipline = models.CharField(
        max_length=50,
        choices=Discipline.choices,
    )

    # Pole przechowuje nazwę użytkownika dla dyscypliny niestandardowej.
    custom_discipline_name = models.CharField(
        max_length=120,
        blank=True,
        null=True,
    )

    organizer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="organized_tournaments",
    )

    # Pola konfiguracyjne pozostawiono przejściowo dla zgodności z istniejącą logiką.
    competition_type = models.CharField(
        max_length=16,
        choices=CompetitionType.choices,
        default=CompetitionType.TEAM,
    )

    competition_model = models.CharField(
        max_length=20,
        choices=CompetitionModel.choices,
        default=CompetitionModel.HEAD_TO_HEAD,
    )

    tournament_format = models.CharField(
        max_length=16,
        choices=TournamentFormat.choices,
        default=TournamentFormat.LEAGUE,
    )

    result_mode = models.CharField(
        max_length=16,
        choices=ResultMode.choices,
        default=ResultMode.SCORE,
    )

    format_config = models.JSONField(default=dict, blank=True)

    # JSON przechowuje konfigurację custom dla pojedynków albo etapów "wszyscy razem".
    result_config = models.JSONField(default=dict, blank=True)

    entry_mode = models.CharField(
        max_length=32,
        choices=EntryMode.choices,
        default=EntryMode.MANAGER,
    )

    # Flaga aktywuje dołączanie przez konto i kod turnieju.
    join_enabled = models.BooleanField(
        default=False,
        db_index=True,
        help_text="Czy użytkownicy mogą dołączać do turnieju przez konto + kod (join link + code).",
    )

    # Flaga aktywuje podgląd publiczny dla uczestników przed publikacją.
    participants_public_preview_enabled = models.BooleanField(
        default=False,
        db_index=True,
        help_text="Czy zarejestrowani uczestnicy mogą oglądać TournamentPublic przed publikacją turnieju.",
    )

    # Flaga rozdziela samodzielną zmianę nazwy od kolejki akceptacyjnej.
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
        help_text="Logiczne archiwum - turniej ukryty na głównych listach.",
    )

    access_code = models.CharField(max_length=20, blank=True, null=True)

    registration_code = models.CharField(
        max_length=32,
        blank=True,
        null=True,
        help_text="Kod dołączania uczestników (JOIN) używany, gdy join_enabled=true.",
    )

    description = models.TextField(blank=True, null=True)

    start_date = models.DateField(blank=True, null=True)
    end_date = models.DateField(blank=True, null=True)
    location = models.CharField(max_length=255, blank=True, null=True)

    created_at = models.DateTimeField(auto_now_add=True)

    @staticmethod
    def infer_default_competition_type(discipline: str) -> str:
        if discipline in (
            Tournament.Discipline.TENNIS,
            Tournament.Discipline.WRESTLING,
        ):
            return Tournament.CompetitionType.INDIVIDUAL
        return Tournament.CompetitionType.TEAM

    @staticmethod
    def infer_default_competition_model(discipline: str) -> str:
        if discipline == Tournament.Discipline.CUSTOM:
            return Tournament.CompetitionModel.MASS_START
        return Tournament.CompetitionModel.HEAD_TO_HEAD

    @staticmethod
    def allowed_formats_for_discipline(discipline: str) -> set[str]:
        return {
            Tournament.TournamentFormat.CUP,
            Tournament.TournamentFormat.LEAGUE,
            Tournament.TournamentFormat.MIXED,
        }

    def get_default_division(self):
        return self.divisions.filter(is_default=True).order_by("order", "id").first() or self.divisions.order_by(
            "order", "id"
        ).first()

    def build_default_division_payload(self) -> dict:
        return {
            "competition_type": self.competition_type,
            "competition_model": self.competition_model,
            "tournament_format": self.tournament_format,
            "result_mode": self.result_mode,
            "format_config": dict(self.format_config or {}),
            "result_config": dict(self.result_config or {}),
            "status": self.status,
        }

    def get_league_legs(self) -> int:
        raw = (self.format_config or {}).get(
            self.FORMATCFG_LEAGUE_LEGS_KEY,
            self.DEFAULT_LEAGUE_LEGS,
        )
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

    @classmethod
    def default_result_config(cls, result_mode: str) -> dict:
        if result_mode != cls.ResultMode.CUSTOM:
            return {}

        return {
            cls.RESULTCFG_CUSTOM_MODE_KEY: cls.RESULTCFG_CUSTOM_MODE_MASS_START_MEASURED,
            cls.RESULTCFG_VALUE_KIND_KEY: cls.RESULTCFG_VALUE_KIND_NUMBER,
            cls.RESULTCFG_UNIT_PRESET_KEY: cls.RESULTCFG_UNIT_PRESET_POINTS,
            cls.RESULTCFG_UNIT_KEY: "pkt",
            cls.RESULTCFG_UNIT_LABEL_KEY: "pkt",
            cls.RESULTCFG_BETTER_RESULT_KEY: cls.RESULTCFG_BETTER_RESULT_HIGHER,
            cls.RESULTCFG_DECIMAL_PLACES_KEY: 0,
            cls.RESULTCFG_TIME_FORMAT_KEY: None,
            cls.RESULTCFG_ALLOW_TIES_KEY: True,
            cls.RESULTCFG_ROUNDS_COUNT_KEY: 1,
            cls.RESULTCFG_AGGREGATION_MODE_KEY: cls.RESULTCFG_AGGREGATION_BEST,
            cls.RESULTCFG_STAGES_KEY: [
                {
                    cls.RESULTCFG_STAGE_NAME_KEY: "Etap 1",
                    cls.RESULTCFG_STAGE_GROUPS_COUNT_KEY: 1,
                    cls.RESULTCFG_STAGE_PARTICIPANTS_COUNT_KEY: None,
                    cls.RESULTCFG_STAGE_ADVANCE_COUNT_KEY: None,
                    cls.RESULTCFG_STAGE_ROUNDS_COUNT_KEY: 1,
                    cls.RESULTCFG_STAGE_AGGREGATION_MODE_KEY: cls.RESULTCFG_AGGREGATION_BEST,
                }
            ],
            cls.RESULTCFG_POINTS_WIN_KEY: 3,
            cls.RESULTCFG_POINTS_DRAW_KEY: 1,
            cls.RESULTCFG_POINTS_LOSS_KEY: 0,
            cls.RESULTCFG_ALLOW_DRAW_KEY: True,
            cls.RESULTCFG_ALLOW_OVERTIME_KEY: False,
            cls.RESULTCFG_ALLOW_SHOOTOUT_KEY: False,
            cls.RESULTCFG_POINTS_OVERTIME_WIN_KEY: 2,
            cls.RESULTCFG_POINTS_OVERTIME_LOSS_KEY: 1,
            cls.RESULTCFG_POINTS_SHOOTOUT_WIN_KEY: 2,
            cls.RESULTCFG_POINTS_SHOOTOUT_LOSS_KEY: 1,
            cls.RESULTCFG_LEGS_COUNT_KEY: 1,
            cls.RESULTCFG_BEST_OF_KEY: None,
        }

    @classmethod
    def _normalize_mass_start_stages(cls, stages, rounds_count_default: int, aggregation_default: str) -> list[dict]:
        if stages is None:
            stages = []
        if not isinstance(stages, list):
            raise ValueError("stages musi być listą etapów.")

        if not stages:
            stages = [
                {
                    cls.RESULTCFG_STAGE_NAME_KEY: "Etap 1",
                    cls.RESULTCFG_STAGE_GROUPS_COUNT_KEY: 1,
                    cls.RESULTCFG_STAGE_PARTICIPANTS_COUNT_KEY: None,
                    cls.RESULTCFG_STAGE_ADVANCE_COUNT_KEY: None,
                    cls.RESULTCFG_STAGE_ROUNDS_COUNT_KEY: rounds_count_default,
                    cls.RESULTCFG_STAGE_AGGREGATION_MODE_KEY: aggregation_default,
                }
            ]

        if len(stages) > cls.MAX_CUSTOM_STAGE_LEVELS:
            raise ValueError(
                f"Maksymalna liczba poziomów etapów dla trybu custom to {cls.MAX_CUSTOM_STAGE_LEVELS}."
            )

        normalized: list[dict] = []
        for index, item in enumerate(stages, start=1):
            if not isinstance(item, dict):
                raise ValueError("Każdy etap w stages musi być obiektem JSON.")

            name = str(item.get(cls.RESULTCFG_STAGE_NAME_KEY) or f"Etap {index}").strip()
            if not name:
                name = f"Etap {index}"

            try:
                groups_count = int(item.get(cls.RESULTCFG_STAGE_GROUPS_COUNT_KEY, 1))
            except (TypeError, ValueError) as exc:
                raise ValueError("groups_count musi być liczbą całkowitą.") from exc
            if groups_count < 1:
                raise ValueError("groups_count musi być większe lub równe 1.")

            participants_count_raw = item.get(cls.RESULTCFG_STAGE_PARTICIPANTS_COUNT_KEY)
            if participants_count_raw in ("", None):
                participants_count = None
            else:
                try:
                    participants_count = int(participants_count_raw)
                except (TypeError, ValueError) as exc:
                    raise ValueError("participants_count musi być liczbą całkowitą.") from exc
                if participants_count < 1:
                    raise ValueError("participants_count musi być większe lub równe 1.")

            advance_count_raw = item.get(cls.RESULTCFG_STAGE_ADVANCE_COUNT_KEY)
            if advance_count_raw in ("", None):
                advance_count = None
            else:
                try:
                    advance_count = int(advance_count_raw)
                except (TypeError, ValueError) as exc:
                    raise ValueError("advance_count musi być liczbą całkowitą.") from exc
                if advance_count < 1:
                    raise ValueError("advance_count musi być większe lub równe 1.")

            try:
                rounds_count = int(item.get(cls.RESULTCFG_STAGE_ROUNDS_COUNT_KEY, rounds_count_default))
            except (TypeError, ValueError) as exc:
                raise ValueError("rounds_count etapu musi być liczbą całkowitą.") from exc
            if rounds_count < 1 or rounds_count > 20:
                raise ValueError("rounds_count etapu musi być w zakresie 1-20.")

            aggregation_mode = str(
                item.get(cls.RESULTCFG_STAGE_AGGREGATION_MODE_KEY) or aggregation_default
            ).upper()
            if aggregation_mode not in (
                cls.RESULTCFG_AGGREGATION_SUM,
                cls.RESULTCFG_AGGREGATION_AVERAGE,
                cls.RESULTCFG_AGGREGATION_BEST,
                cls.RESULTCFG_AGGREGATION_LAST_ROUND,
            ):
                raise ValueError("Nieprawidłowy aggregation_mode etapu.")

            normalized.append(
                {
                    cls.RESULTCFG_STAGE_NAME_KEY: name,
                    cls.RESULTCFG_STAGE_GROUPS_COUNT_KEY: groups_count,
                    cls.RESULTCFG_STAGE_PARTICIPANTS_COUNT_KEY: participants_count,
                    cls.RESULTCFG_STAGE_ADVANCE_COUNT_KEY: advance_count,
                    cls.RESULTCFG_STAGE_ROUNDS_COUNT_KEY: rounds_count,
                    cls.RESULTCFG_STAGE_AGGREGATION_MODE_KEY: aggregation_mode,
                }
            )

        return normalized

    @classmethod
    def normalize_result_config(cls, result_mode: str, cfg) -> dict:
        if result_mode != cls.ResultMode.CUSTOM:
            return {}

        if cfg is None:
            cfg = {}
        if not isinstance(cfg, dict):
            raise ValueError("result_config musi być obiektem JSON (dict).")

        normalized = cls.default_result_config(result_mode)
        normalized.update(dict(cfg))

        custom_mode = str(normalized.get(cls.RESULTCFG_CUSTOM_MODE_KEY) or "").upper()
        if not custom_mode:
            points_keys = (
                cls.RESULTCFG_POINTS_WIN_KEY,
                cls.RESULTCFG_POINTS_DRAW_KEY,
                cls.RESULTCFG_POINTS_LOSS_KEY,
                cls.RESULTCFG_ALLOW_DRAW_KEY,
                cls.RESULTCFG_ALLOW_OVERTIME_KEY,
                cls.RESULTCFG_ALLOW_SHOOTOUT_KEY,
            )
            if any(key in normalized for key in points_keys):
                custom_mode = cls.RESULTCFG_CUSTOM_MODE_HEAD_TO_HEAD_POINTS
            else:
                custom_mode = cls.RESULTCFG_CUSTOM_MODE_MASS_START_MEASURED

        if custom_mode not in (
            cls.RESULTCFG_CUSTOM_MODE_HEAD_TO_HEAD_POINTS,
            cls.RESULTCFG_CUSTOM_MODE_MASS_START_MEASURED,
        ):
            raise ValueError(
                "custom_mode musi mieć wartość HEAD_TO_HEAD_POINTS albo MASS_START_MEASURED."
            )
        normalized[cls.RESULTCFG_CUSTOM_MODE_KEY] = custom_mode

        if custom_mode == cls.RESULTCFG_CUSTOM_MODE_MASS_START_MEASURED:
            value_kind = str(normalized.get(cls.RESULTCFG_VALUE_KIND_KEY) or "").upper()
            if value_kind not in (
                cls.RESULTCFG_VALUE_KIND_NUMBER,
                cls.RESULTCFG_VALUE_KIND_TIME,
                cls.RESULTCFG_VALUE_KIND_PLACE,
            ):
                raise ValueError("value_kind musi mieć wartość NUMBER, TIME albo PLACE.")
            normalized[cls.RESULTCFG_VALUE_KIND_KEY] = value_kind

            unit_preset = str(
                normalized.get(cls.RESULTCFG_UNIT_PRESET_KEY) or cls.RESULTCFG_UNIT_PRESET_CUSTOM
            ).upper()
            if unit_preset not in (
                cls.RESULTCFG_UNIT_PRESET_POINTS,
                cls.RESULTCFG_UNIT_PRESET_SECONDS,
                cls.RESULTCFG_UNIT_PRESET_MILLISECONDS,
                cls.RESULTCFG_UNIT_PRESET_MINUTES,
                cls.RESULTCFG_UNIT_PRESET_METERS,
                cls.RESULTCFG_UNIT_PRESET_CENTIMETERS,
                cls.RESULTCFG_UNIT_PRESET_KILOGRAMS,
                cls.RESULTCFG_UNIT_PRESET_GRAMS,
                cls.RESULTCFG_UNIT_PRESET_REPS,
                cls.RESULTCFG_UNIT_PRESET_PLACE,
                cls.RESULTCFG_UNIT_PRESET_CUSTOM,
            ):
                raise ValueError("Nieprawidłowy unit_preset.")
            normalized[cls.RESULTCFG_UNIT_PRESET_KEY] = unit_preset

            unit = str(normalized.get(cls.RESULTCFG_UNIT_KEY) or "").strip()
            unit_label = str(normalized.get(cls.RESULTCFG_UNIT_LABEL_KEY) or unit).strip()

            if unit_preset == cls.RESULTCFG_UNIT_PRESET_CUSTOM and not unit_label:
                raise ValueError("Dla unit_preset=CUSTOM podaj nazwę jednostki.")
            if value_kind == cls.RESULTCFG_VALUE_KIND_PLACE:
                unit = "miejsce"
                unit_label = "miejsce"
                normalized[cls.RESULTCFG_UNIT_PRESET_KEY] = cls.RESULTCFG_UNIT_PRESET_PLACE

            normalized[cls.RESULTCFG_UNIT_KEY] = unit
            normalized[cls.RESULTCFG_UNIT_LABEL_KEY] = unit_label
            normalized[cls.RESULTCFG_ALLOW_TIES_KEY] = bool(
                normalized.get(cls.RESULTCFG_ALLOW_TIES_KEY, True)
            )

            better_result = str(normalized.get(cls.RESULTCFG_BETTER_RESULT_KEY) or "").upper()
            if better_result not in (
                cls.RESULTCFG_BETTER_RESULT_HIGHER,
                cls.RESULTCFG_BETTER_RESULT_LOWER,
            ):
                raise ValueError("better_result musi mieć wartość HIGHER albo LOWER.")
            if value_kind in (cls.RESULTCFG_VALUE_KIND_TIME, cls.RESULTCFG_VALUE_KIND_PLACE):
                better_result = cls.RESULTCFG_BETTER_RESULT_LOWER
            normalized[cls.RESULTCFG_BETTER_RESULT_KEY] = better_result

            try:
                rounds_count = int(normalized.get(cls.RESULTCFG_ROUNDS_COUNT_KEY, 1))
            except (TypeError, ValueError) as exc:
                raise ValueError("rounds_count musi być liczbą całkowitą.") from exc
            if rounds_count < 1 or rounds_count > 20:
                raise ValueError("rounds_count musi być w zakresie 1-20.")
            normalized[cls.RESULTCFG_ROUNDS_COUNT_KEY] = rounds_count

            aggregation_mode = str(
                normalized.get(cls.RESULTCFG_AGGREGATION_MODE_KEY)
                or cls.RESULTCFG_AGGREGATION_BEST
            ).upper()
            if aggregation_mode not in (
                cls.RESULTCFG_AGGREGATION_SUM,
                cls.RESULTCFG_AGGREGATION_AVERAGE,
                cls.RESULTCFG_AGGREGATION_BEST,
                cls.RESULTCFG_AGGREGATION_LAST_ROUND,
            ):
                raise ValueError("Nieprawidłowy aggregation_mode.")
            normalized[cls.RESULTCFG_AGGREGATION_MODE_KEY] = aggregation_mode

            if value_kind == cls.RESULTCFG_VALUE_KIND_TIME:
                time_format = str(
                    normalized.get(cls.RESULTCFG_TIME_FORMAT_KEY)
                    or cls.RESULTCFG_TIME_FORMAT_MM_SS_HH
                ).strip()
                if time_format not in (
                    cls.RESULTCFG_TIME_FORMAT_HH_MM_SS,
                    cls.RESULTCFG_TIME_FORMAT_MM_SS,
                    cls.RESULTCFG_TIME_FORMAT_MM_SS_HH,
                    cls.RESULTCFG_TIME_FORMAT_SS_HH,
                ):
                    raise ValueError("Nieprawidłowy time_format.")
                normalized[cls.RESULTCFG_TIME_FORMAT_KEY] = time_format
                normalized[cls.RESULTCFG_DECIMAL_PLACES_KEY] = None
            elif value_kind == cls.RESULTCFG_VALUE_KIND_PLACE:
                normalized[cls.RESULTCFG_TIME_FORMAT_KEY] = None
                normalized[cls.RESULTCFG_DECIMAL_PLACES_KEY] = None
            else:
                raw_places = normalized.get(cls.RESULTCFG_DECIMAL_PLACES_KEY, 0)
                try:
                    decimal_places = int(raw_places)
                except (TypeError, ValueError) as exc:
                    raise ValueError("decimal_places musi być liczbą całkowitą.") from exc
                if decimal_places < 0 or decimal_places > 4:
                    raise ValueError("decimal_places musi być w zakresie 0-4.")
                normalized[cls.RESULTCFG_DECIMAL_PLACES_KEY] = decimal_places
                normalized[cls.RESULTCFG_TIME_FORMAT_KEY] = None

            normalized[cls.RESULTCFG_STAGES_KEY] = cls._normalize_mass_start_stages(
                normalized.get(cls.RESULTCFG_STAGES_KEY),
                rounds_count_default=rounds_count,
                aggregation_default=aggregation_mode,
            )

        else:
            integer_keys = (
                cls.RESULTCFG_POINTS_WIN_KEY,
                cls.RESULTCFG_POINTS_DRAW_KEY,
                cls.RESULTCFG_POINTS_LOSS_KEY,
                cls.RESULTCFG_POINTS_OVERTIME_WIN_KEY,
                cls.RESULTCFG_POINTS_OVERTIME_LOSS_KEY,
                cls.RESULTCFG_POINTS_SHOOTOUT_WIN_KEY,
                cls.RESULTCFG_POINTS_SHOOTOUT_LOSS_KEY,
            )
            for key in integer_keys:
                try:
                    normalized[key] = int(normalized.get(key, 0))
                except (TypeError, ValueError) as exc:
                    raise ValueError(f"{key} musi być liczbą całkowitą.") from exc

            normalized[cls.RESULTCFG_ALLOW_DRAW_KEY] = bool(
                normalized.get(cls.RESULTCFG_ALLOW_DRAW_KEY, True)
            )
            normalized[cls.RESULTCFG_ALLOW_OVERTIME_KEY] = bool(
                normalized.get(cls.RESULTCFG_ALLOW_OVERTIME_KEY, False)
            )
            normalized[cls.RESULTCFG_ALLOW_SHOOTOUT_KEY] = bool(
                normalized.get(cls.RESULTCFG_ALLOW_SHOOTOUT_KEY, False)
            )

            try:
                legs_count = int(normalized.get(cls.RESULTCFG_LEGS_COUNT_KEY, 1))
            except (TypeError, ValueError) as exc:
                raise ValueError("legs_count musi być liczbą całkowitą.") from exc
            if legs_count < 1 or legs_count > 9:
                raise ValueError("legs_count musi być w zakresie 1-9.")
            normalized[cls.RESULTCFG_LEGS_COUNT_KEY] = legs_count

            best_of_raw = normalized.get(cls.RESULTCFG_BEST_OF_KEY)
            if best_of_raw in ("", None):
                best_of = None
            else:
                try:
                    best_of = int(best_of_raw)
                except (TypeError, ValueError) as exc:
                    raise ValueError("best_of musi być liczbą całkowitą.") from exc
                if best_of < 1 or best_of % 2 == 0:
                    raise ValueError("best_of musi być dodatnią nieparzystą liczbą.")
            normalized[cls.RESULTCFG_BEST_OF_KEY] = best_of

            try:
                rounds_count = int(normalized.get(cls.RESULTCFG_ROUNDS_COUNT_KEY, 1))
            except (TypeError, ValueError) as exc:
                raise ValueError("rounds_count musi być liczbą całkowitą.") from exc
            if rounds_count < 1 or rounds_count > 20:
                raise ValueError("rounds_count musi być w zakresie 1-20.")
            normalized[cls.RESULTCFG_ROUNDS_COUNT_KEY] = rounds_count

            aggregation_mode = str(
                normalized.get(cls.RESULTCFG_AGGREGATION_MODE_KEY)
                or cls.RESULTCFG_AGGREGATION_SUM
            ).upper()
            if aggregation_mode not in (
                cls.RESULTCFG_AGGREGATION_SUM,
                cls.RESULTCFG_AGGREGATION_AVERAGE,
                cls.RESULTCFG_AGGREGATION_BEST,
                cls.RESULTCFG_AGGREGATION_LAST_ROUND,
            ):
                raise ValueError("Nieprawidłowy aggregation_mode.")
            normalized[cls.RESULTCFG_AGGREGATION_MODE_KEY] = aggregation_mode

            normalized[cls.RESULTCFG_VALUE_KIND_KEY] = None
            normalized[cls.RESULTCFG_UNIT_PRESET_KEY] = None
            normalized[cls.RESULTCFG_UNIT_KEY] = ""
            normalized[cls.RESULTCFG_UNIT_LABEL_KEY] = ""
            normalized[cls.RESULTCFG_BETTER_RESULT_KEY] = None
            normalized[cls.RESULTCFG_DECIMAL_PLACES_KEY] = None
            normalized[cls.RESULTCFG_TIME_FORMAT_KEY] = None
            normalized[cls.RESULTCFG_ALLOW_TIES_KEY] = False
            normalized[cls.RESULTCFG_STAGES_KEY] = []

        return normalized

    def uses_custom_results(self) -> bool:
        return self.result_mode == self.ResultMode.CUSTOM

    def get_result_config(self) -> dict:
        return self.normalize_result_config(self.result_mode, self.result_config)

    def get_custom_mode(self) -> str | None:
        return self.get_result_config().get(self.RESULTCFG_CUSTOM_MODE_KEY)

    def uses_mass_start(self) -> bool:
        if self.competition_model == self.CompetitionModel.MASS_START:
            return True
        return self.get_custom_mode() == self.RESULTCFG_CUSTOM_MODE_MASS_START_MEASURED

    def uses_head_to_head(self) -> bool:
        if self.competition_model == self.CompetitionModel.HEAD_TO_HEAD:
            return True
        return self.get_custom_mode() == self.RESULTCFG_CUSTOM_MODE_HEAD_TO_HEAD_POINTS

    def get_result_value_kind(self) -> str | None:
        return self.get_result_config().get(self.RESULTCFG_VALUE_KIND_KEY)

    def result_is_time(self) -> bool:
        return self.get_result_value_kind() == self.RESULTCFG_VALUE_KIND_TIME

    def result_is_number(self) -> bool:
        return self.get_result_value_kind() == self.RESULTCFG_VALUE_KIND_NUMBER

    def result_is_place(self) -> bool:
        return self.get_result_value_kind() == self.RESULTCFG_VALUE_KIND_PLACE

    def get_result_order(self) -> str | None:
        return self.get_result_config().get(self.RESULTCFG_BETTER_RESULT_KEY)

    def custom_result_lower_is_better(self) -> bool:
        return self.get_result_order() == self.RESULTCFG_BETTER_RESULT_LOWER

    def custom_result_higher_is_better(self) -> bool:
        return self.get_result_order() == self.RESULTCFG_BETTER_RESULT_HIGHER

    def get_mass_start_stages(self) -> list[dict]:
        cfg = self.get_result_config()
        if cfg.get(self.RESULTCFG_CUSTOM_MODE_KEY) != self.RESULTCFG_CUSTOM_MODE_MASS_START_MEASURED:
            return []
        return list(cfg.get(self.RESULTCFG_STAGES_KEY) or [])

    def __str__(self) -> str:
        return self.name


class TournamentMembership(models.Model):
    class Role(models.TextChoices):
        ASSISTANT = "ASSISTANT", "Asystent"

    class Status(models.TextChoices):
        PENDING = "PENDING", "Oczekuje"
        ACCEPTED = "ACCEPTED", "Zaakceptowane"
        DECLINED = "DECLINED", "Odrzucone"

    PERM_TEAMS_EDIT = "teams_edit"
    PERM_SCHEDULE_EDIT = "schedule_edit"
    PERM_RESULTS_EDIT = "results_edit"
    PERM_BRACKET_EDIT = "bracket_edit"
    PERM_TOURNAMENT_EDIT = "tournament_edit"
    PERM_ROSTER_EDIT = "roster_edit"
    PERM_NAME_CHANGE_APPROVE = "name_change_approve"

    # Te uprawnienia pozostają zarezerwowane wyłącznie dla organizatora.
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
        PERM_ROSTER_EDIT: True,
        PERM_NAME_CHANGE_APPROVE: True,
    }

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

    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
        help_text="Status zaproszenia asystenta w obrębie turnieju.",
    )

    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="sent_tournament_memberships",
        null=True,
        blank=True,
        help_text="Użytkownik, który utworzył lub ponowił zaproszenie asystenta.",
    )

    responded_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Znacznik czasu akceptacji albo odrzucenia zaproszenia asystenta.",
    )

    permissions = models.JSONField(
        default=dict,
        blank=True,
        help_text="Granularne uprawnienia asystenta w danym turnieju (JSON).",
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tournament", "user"],
                name="uniq_tournament_user",
            )
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

        # Twarde blokady chronią operacje zastrzeżone dla organizatora.
        for key in (
            self.PERM_PUBLISH,
            self.PERM_ARCHIVE,
            self.PERM_MANAGE_ASSISTANTS,
            self.PERM_JOIN_SETTINGS,
        ):
            merged.pop(key, None)

        # Normalizacja zapobiega przenikaniu niejednoznacznych typów z JSON.
        for key, value in list(merged.items()):
            merged[key] = bool(value)

        return merged

    def mark_pending(self, *, invited_by=None) -> None:
        self.status = self.Status.PENDING
        self.invited_by = invited_by
        self.responded_at = None

    def mark_accepted(self) -> None:
        self.status = self.Status.ACCEPTED
        self.responded_at = timezone.now()

    def mark_declined(self) -> None:
        self.status = self.Status.DECLINED
        self.responded_at = timezone.now()


class TournamentAssistantInvite(models.Model):
    class Status(models.TextChoices):
        PENDING = "PENDING", "Oczekuje"
        ACCEPTED = "ACCEPTED", "Zaakceptowane"
        DECLINED = "DECLINED", "Odrzucone"
        CANCELED = "CANCELED", "Cofnięte"

    tournament = models.ForeignKey(
        Tournament,
        on_delete=models.CASCADE,
        related_name="assistant_invites",
    )

    invited_email = models.EmailField(
        max_length=254,
        help_text="Adres e-mail, na który zostało zapisane zaproszenie asystenta.",
    )

    normalized_email = models.CharField(
        max_length=254,
        db_index=True,
        help_text="Znormalizowany adres e-mail używany do dopasowania zaproszenia po logowaniu.",
    )

    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="sent_tournament_assistant_invites",
        null=True,
        blank=True,
        help_text="Organizator, który utworzył albo ponowił zaproszenie.",
    )

    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
        help_text="Status zaproszenia asystenta zapisany niezależnie od istnienia konta użytkownika.",
    )

    permissions = models.JSONField(
        default=dict,
        blank=True,
        help_text="Uprawnienia, które zostaną nadane po akceptacji zaproszenia.",
    )

    responded_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text="Znacznik czasu akceptacji, odrzucenia albo cofnięcia zaproszenia.",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["tournament", "normalized_email"],
                name="uniq_tournament_assistant_invite_email",
            )
        ]

    def save(self, *args, **kwargs):
        normalized = str(self.invited_email or "").strip().lower()
        self.invited_email = normalized
        self.normalized_email = normalized
        return super().save(*args, **kwargs)

    def normalized_permissions(self) -> dict:
        allowed_keys = {
            TournamentMembership.PERM_TEAMS_EDIT,
            TournamentMembership.PERM_ROSTER_EDIT,
            TournamentMembership.PERM_SCHEDULE_EDIT,
            TournamentMembership.PERM_RESULTS_EDIT,
            TournamentMembership.PERM_BRACKET_EDIT,
            TournamentMembership.PERM_TOURNAMENT_EDIT,
            TournamentMembership.PERM_NAME_CHANGE_APPROVE,
        }

        raw = self.permissions or {}
        if not isinstance(raw, dict):
            return {}

        return {key: bool(raw.get(key, False)) for key in allowed_keys}

    def mark_pending(self, *, invited_by=None, permissions: dict | None = None) -> None:
        self.status = self.Status.PENDING
        self.invited_by = invited_by
        self.responded_at = None
        if permissions is not None:
            self.permissions = dict(permissions)

    def mark_accepted(self) -> None:
        self.status = self.Status.ACCEPTED
        self.responded_at = timezone.now()

    def mark_declined(self) -> None:
        self.status = self.Status.DECLINED
        self.responded_at = timezone.now()

    def mark_canceled(self) -> None:
        self.status = self.Status.CANCELED
        self.responded_at = timezone.now()


class TournamentRegistration(models.Model):
    tournament = models.ForeignKey(
        Tournament,
        on_delete=models.CASCADE,
        related_name="registrations",
    )

    division = models.ForeignKey(
        "Division",
        on_delete=models.PROTECT,
        related_name="registrations",
        blank=True,
        null=True,
        help_text="Dywizja rejestracji. Pole pozostaje opcjonalne wyłącznie na czas migracji starszych danych.",
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
                fields=["division", "user"],
                condition=Q(division__isnull=False),
                name="uniq_registration_division_user",
            ),
            models.UniqueConstraint(
                fields=["tournament", "user"],
                condition=Q(division__isnull=True),
                name="uniq_registration_tournament_user_without_division",
            ),
        ]

    def clean(self) -> None:
        if self.division_id and self.division and self.division.tournament_id != self.tournament_id:
            raise ValidationError("Dywizja rejestracji musi należeć do tego samego turnieju.")

        if self.team_id and self.team:
            if self.team.tournament_id != self.tournament_id:
                raise ValidationError("Uczestnik rejestracji musi należeć do tego samego turnieju.")
            if self.division_id and self.team.division_id and self.team.division_id != self.division_id:
                raise ValidationError("Dywizja rejestracji musi być zgodna z dywizją przypisanego uczestnika.")
            if not self.division_id and self.team.division_id:
                self.division = self.team.division

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f"{self.tournament_id}:{self.user_id} -> {self.display_name}"


class TeamNameChangeRequest(models.Model):
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

    def clean(self) -> None:
        if self.team.tournament_id != self.tournament_id:
            raise ValidationError("Wniosek o zmianę nazwy musi wskazywać uczestnika z tego samego turnieju.")

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)

    def __str__(self) -> str:
        return (
            f"{self.tournament_id}:{self.team_id} "
            f"{self.status} {self.old_name} -> {self.requested_name}"
        )


class Division(models.Model):
    tournament = models.ForeignKey(
        Tournament,
        on_delete=models.CASCADE,
        related_name="divisions",
    )

    name = models.CharField(max_length=120)

    slug = models.SlugField(
        max_length=140,
        blank=True,
        help_text="Stabilny identyfikator dywizji wykorzystywany w URL i przełączaniu kontekstu.",
    )

    order = models.PositiveIntegerField(
        default=0,
        db_index=True,
        help_text="Kolejność prezentacji dywizji w obrębie turnieju.",
    )

    is_default = models.BooleanField(
        default=False,
        db_index=True,
        help_text="Flaga wskazuje dywizję domyślnie otwieraną w panelu oraz w widokach publicznych.",
    )

    is_archived = models.BooleanField(
        default=False,
        db_index=True,
        help_text="Logiczne archiwum dywizji bez usuwania jej historii sportowej.",
    )

    competition_type = models.CharField(
        max_length=16,
        choices=Tournament.CompetitionType.choices,
        default=Tournament.CompetitionType.TEAM,
    )

    competition_model = models.CharField(
        max_length=20,
        choices=Tournament.CompetitionModel.choices,
        default=Tournament.CompetitionModel.HEAD_TO_HEAD,
    )

    tournament_format = models.CharField(
        max_length=16,
        choices=Tournament.TournamentFormat.choices,
        default=Tournament.TournamentFormat.LEAGUE,
    )

    result_mode = models.CharField(
        max_length=16,
        choices=Tournament.ResultMode.choices,
        default=Tournament.ResultMode.SCORE,
    )

    format_config = models.JSONField(default=dict, blank=True)
    result_config = models.JSONField(default=dict, blank=True)

    status = models.CharField(
        max_length=20,
        choices=Tournament.Status.choices,
        default=Tournament.Status.DRAFT,
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["order", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["tournament", "name"],
                name="uniq_tournament_division_name",
            ),
            models.UniqueConstraint(
                fields=["tournament", "slug"],
                name="uniq_tournament_division_slug",
            ),
            models.UniqueConstraint(
                fields=["tournament"],
                condition=Q(is_default=True),
                name="uniq_default_division_per_tournament",
            ),
        ]
        indexes = [
            models.Index(fields=["tournament", "order"], name="idx_division_tournament_order"),
            models.Index(fields=["tournament", "is_archived"], name="idx_division_tournament_arch"),
        ]

    @staticmethod
    def infer_default_competition_type(discipline: str) -> str:
        return Tournament.infer_default_competition_type(discipline)

    @staticmethod
    def infer_default_competition_model(discipline: str) -> str:
        return Tournament.infer_default_competition_model(discipline)

    @staticmethod
    def allowed_formats_for_discipline(discipline: str) -> set[str]:
        return Tournament.allowed_formats_for_discipline(discipline)

    @classmethod
    def default_result_config(cls, result_mode: str) -> dict:
        return Tournament.default_result_config(result_mode)

    @classmethod
    def normalize_result_config(cls, result_mode: str, cfg) -> dict:
        return Tournament.normalize_result_config(result_mode, cfg)

    def get_league_legs(self) -> int:
        raw = (self.format_config or {}).get(
            Tournament.FORMATCFG_LEAGUE_LEGS_KEY,
            Tournament.DEFAULT_LEAGUE_LEGS,
        )
        try:
            value = int(raw)
        except (TypeError, ValueError):
            return Tournament.DEFAULT_LEAGUE_LEGS
        return value if value in (1, 2) else Tournament.DEFAULT_LEAGUE_LEGS

    def set_league_legs(self, legs: int) -> None:
        if legs not in (1, 2):
            raise ValueError("league_legs musi wynosić 1 albo 2")
        cfg = dict(self.format_config or {})
        cfg[Tournament.FORMATCFG_LEAGUE_LEGS_KEY] = legs
        self.format_config = cfg

    def uses_custom_results(self) -> bool:
        return self.result_mode == Tournament.ResultMode.CUSTOM

    def get_result_config(self) -> dict:
        return self.normalize_result_config(self.result_mode, self.result_config)

    def get_custom_mode(self) -> str | None:
        return self.get_result_config().get(Tournament.RESULTCFG_CUSTOM_MODE_KEY)

    def uses_mass_start(self) -> bool:
        if self.competition_model == Tournament.CompetitionModel.MASS_START:
            return True
        return self.get_custom_mode() == Tournament.RESULTCFG_CUSTOM_MODE_MASS_START_MEASURED

    def uses_head_to_head(self) -> bool:
        if self.competition_model == Tournament.CompetitionModel.HEAD_TO_HEAD:
            return True
        return self.get_custom_mode() == Tournament.RESULTCFG_CUSTOM_MODE_HEAD_TO_HEAD_POINTS

    def get_result_value_kind(self) -> str | None:
        return self.get_result_config().get(Tournament.RESULTCFG_VALUE_KIND_KEY)

    def result_is_time(self) -> bool:
        return self.get_result_value_kind() == Tournament.RESULTCFG_VALUE_KIND_TIME

    def result_is_number(self) -> bool:
        return self.get_result_value_kind() == Tournament.RESULTCFG_VALUE_KIND_NUMBER

    def result_is_place(self) -> bool:
        return self.get_result_value_kind() == Tournament.RESULTCFG_VALUE_KIND_PLACE

    def get_result_order(self) -> str | None:
        return self.get_result_config().get(Tournament.RESULTCFG_BETTER_RESULT_KEY)

    def custom_result_lower_is_better(self) -> bool:
        return self.get_result_order() == Tournament.RESULTCFG_BETTER_RESULT_LOWER

    def custom_result_higher_is_better(self) -> bool:
        return self.get_result_order() == Tournament.RESULTCFG_BETTER_RESULT_HIGHER

    def get_mass_start_stages(self) -> list[dict]:
        cfg = self.get_result_config()
        if cfg.get(Tournament.RESULTCFG_CUSTOM_MODE_KEY) != Tournament.RESULTCFG_CUSTOM_MODE_MASS_START_MEASURED:
            return []
        return list(cfg.get(Tournament.RESULTCFG_STAGES_KEY) or [])

    def clean(self) -> None:
        allowed_formats = self.allowed_formats_for_discipline(self.tournament.discipline)
        if self.tournament_format not in allowed_formats:
            raise ValidationError("Wybrany format nie jest dostępny dla wskazanej dyscypliny.")

        if self.competition_type not in dict(Tournament.CompetitionType.choices):
            raise ValidationError("Nieprawidłowy competition_type dla dywizji.")

        if self.competition_model not in dict(Tournament.CompetitionModel.choices):
            raise ValidationError("Nieprawidłowy competition_model dla dywizji.")

        if self.result_mode not in dict(Tournament.ResultMode.choices):
            raise ValidationError("Nieprawidłowy result_mode dla dywizji.")

        if not isinstance(self.format_config or {}, dict):
            raise ValidationError("format_config musi być obiektem JSON (dict).")

        try:
            self.result_config = self.normalize_result_config(self.result_mode, self.result_config)
        except ValueError as exc:
            raise ValidationError({"result_config": str(exc)}) from exc

    def save(self, *args, **kwargs):
        if not self.order:
            max_order = (
                Division.objects.filter(tournament=self.tournament).exclude(pk=self.pk).aggregate(max_order=Max("order"))[
                    "max_order"
                ]
                or 0
            )
            self.order = max_order + 1

        base_slug = slugify(self.slug or self.name)[:140] or "dywizja"
        slug = base_slug
        index = 2
        while Division.objects.filter(tournament=self.tournament, slug=slug).exclude(pk=self.pk).exists():
            suffix = f"-{index}"
            slug = f"{base_slug[: 140 - len(suffix)]}{suffix}"
            index += 1
        self.slug = slug

        self.full_clean()
        return super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f"{self.name} ({self.tournament})"


class Team(models.Model):
    tournament = models.ForeignKey(
        Tournament,
        on_delete=models.CASCADE,
        related_name="teams",
    )

    division = models.ForeignKey(
        Division,
        on_delete=models.PROTECT,
        related_name="participants",
        blank=True,
        null=True,
        help_text="Dywizja uczestnika. Pole pozostaje opcjonalne wyłącznie na czas migracji starszych danych.",
    )

    # Powiązanie zachowano dla zgodności, ale preferowanym źródłem relacji jest rejestracja.
    registered_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="registered_teams",
        help_text="(Opcjonalne) Użytkownik powiązany ze slotem Team. Preferuj TournamentRegistration.team.",
    )

    name = models.CharField(max_length=255)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def clean(self) -> None:
        if self.division_id and self.division and self.division.tournament_id != self.tournament_id:
            raise ValidationError("Dywizja uczestnika musi należeć do tego samego turnieju.")

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)

    def __str__(self) -> str:
        if self.registered_user_id:
            return f"{self.name} (U: {self.registered_user_id})"
        return self.name


class TeamPlayer(models.Model):
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

    # Aktywność logiczna pozwala zachować historię bez fizycznego usuwania zawodnika.
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


class Stage(models.Model):
    class StageType(models.TextChoices):
        LEAGUE = "LEAGUE", "Liga"
        GROUP = "GROUP", "Faza grupowa"
        KNOCKOUT = "KNOCKOUT", "Puchar (KO)"
        THIRD_PLACE = "THIRD_PLACE", "Mecz o 3. miejsce"
        MASS_START = "MASS_START", "Etap wszyscy razem"

    class Status(models.TextChoices):
        PLANNED = "PLANNED", "Zaplanowany"
        OPEN = "OPEN", "Otwarty"
        CLOSED = "CLOSED", "Zamknięty"

    tournament = models.ForeignKey(
        Tournament,
        on_delete=models.CASCADE,
        related_name="stages",
    )

    division = models.ForeignKey(
        Division,
        on_delete=models.PROTECT,
        related_name="stages",
        blank=True,
        null=True,
        help_text="Dywizja etapu. Pole pozostaje opcjonalne wyłącznie na czas migracji starszych danych.",
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

    scheduled_date = models.DateField(
        null=True,
        blank=True,
        help_text="Data obowiązująca dla całego etapu, gdy harmonogram jest planowany etapami.",
    )

    scheduled_time = models.TimeField(
        null=True,
        blank=True,
        help_text="Godzina obowiązująca dla całego etapu, gdy harmonogram jest planowany etapami.",
    )

    location = models.CharField(
        max_length=255,
        blank=True,
        null=True,
        help_text="Domyślna lokalizacja całego etapu w harmonogramie trybu MASS_START.",
    )

    order = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["order"]
        constraints = [
            models.UniqueConstraint(
                fields=["division", "order"],
                condition=Q(division__isnull=False),
                name="uniq_stage_order_per_division",
            ),
            models.UniqueConstraint(
                fields=["tournament", "order"],
                condition=Q(division__isnull=True),
                name="uniq_stage_order_per_tournament_without_division",
            ),
        ]

    def get_competition_context(self):
        return self.division or self.tournament

    def clean(self) -> None:
        if self.division_id and self.division and self.division.tournament_id != self.tournament_id:
            raise ValidationError("Dywizja etapu musi należeć do tego samego turnieju.")

        context = self.get_competition_context()
        if self.stage_type == self.StageType.MASS_START and not context.uses_mass_start():
            raise ValidationError("Etap MASS_START wymaga konfiguracji dywizji lub turnieju zgodnej z modelem MASS_START.")

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f"{self.stage_type} ({self.tournament})"


class Group(models.Model):
    stage = models.ForeignKey(
        Stage,
        on_delete=models.CASCADE,
        related_name="groups",
    )

    name = models.CharField(max_length=50)

    scheduled_date = models.DateField(
        null=True,
        blank=True,
        help_text="Data obowiązująca dla grupy w harmonogramie trybu MASS_START.",
    )

    scheduled_time = models.TimeField(
        null=True,
        blank=True,
        help_text="Godzina obowiązująca dla grupy w harmonogramie trybu MASS_START.",
    )

    location = models.CharField(
        max_length=255,
        blank=True,
        null=True,
        help_text="Lokalizacja przypisana do konkretnej grupy etapu.",
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["stage", "name"],
                name="uniq_stage_group_name",
            )
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.stage})"


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
        FH = "FH", "1 połowa"
        SH = "SH", "2 połowa"
        ET1 = "ET1", "Dogrywka 1"
        ET2 = "ET2", "Dogrywka 2"
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
        help_text="Grupa (tylko dla fazy grupowej).",
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

    # Pole przechowuje zamknięte sety dla dyscypliny tenisowej.
    tennis_sets = models.JSONField(
        blank=True,
        null=True,
        default=None,
        help_text="Dla tenisa: lista zakończonych setów w gemach (opcjonalnie z tie-breakiem).",
    )

    # Pole przechowuje bieżący stan punktacji podczas gry punkt po punkcie.
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

    # Zwycięzca jest wymagany przede wszystkim w logice pucharowej.
    winner = models.ForeignKey(
        Team,
        on_delete=models.SET_NULL,
        related_name="won_matches",
        blank=True,
        null=True,
        help_text="Zwycięzca meczu (wymagany w KO).",
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
        help_text="Numer kolejki / rundy.",
    )

    scheduled_date = models.DateField(blank=True, null=True)
    scheduled_time = models.TimeField(blank=True, null=True)
    location = models.CharField(max_length=255, blank=True, null=True)

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

    # Pole przechowuje czas skumulowany poza aktualnie trwającym odcinkiem.
    clock_elapsed_seconds = models.PositiveIntegerField(
        default=0,
        help_text="Skumulowany czas (w sekundach) w obrębie bieżącego okresu, bez aktualnie trwającego odcinka.",
    )

    # Pole pozwala doliczać czas dodatkowy bez zmiany bazowego przebiegu zegara.
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

    def get_competition_context(self):
        return self.stage.get_competition_context()

    def clean(self) -> None:
        if self.stage.tournament_id != self.tournament_id:
            raise ValidationError("Etap meczu musi należeć do tego samego turnieju co mecz.")

        if self.home_team.tournament_id != self.tournament_id or self.away_team.tournament_id != self.tournament_id:
            raise ValidationError("Obie strony meczu muszą należeć do tego samego turnieju co mecz.")

        stage_division_id = self.stage.division_id
        if stage_division_id:
            if self.home_team.division_id != stage_division_id or self.away_team.division_id != stage_division_id:
                raise ValidationError("Obie strony meczu muszą należeć do dywizji etapu.")
        elif self.home_team.division_id and self.away_team.division_id and self.home_team.division_id != self.away_team.division_id:
            raise ValidationError("Mecz bez dywizji etapu nie może łączyć uczestników z różnych dywizji.")

        if self.group_id and self.group and self.group.stage_id != self.stage_id:
            raise ValidationError("Grupa meczu musi należeć do wskazanego etapu.")

        if self.winner_id and self.winner_id not in (self.home_team_id, self.away_team_id):
            raise ValidationError("Zwycięzca meczu musi być jednym z uczestników tego meczu.")

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)

    def clock_seconds_in_period(self, now: datetime | None = None) -> int:
        now_dt = now or timezone.now()
        running = 0
        if self.clock_state == self.ClockState.RUNNING and self.clock_started_at:
            delta = now_dt - self.clock_started_at
            running = max(0, int(delta.total_seconds()))

        base = int(self.clock_elapsed_seconds or 0) + running
        added = int(self.clock_added_seconds or 0)
        return base + added

    def _clock_period_base_seconds(self) -> int:
        discipline = self.tournament.discipline
        period = self.clock_period

        if discipline == Tournament.Discipline.FOOTBALL:
            mapping = {
                self.ClockPeriod.FH: 0,
                self.ClockPeriod.SH: 45 * 60,
                self.ClockPeriod.ET1: 90 * 60,
                self.ClockPeriod.ET2: 105 * 60,
            }
            return mapping.get(period, 0)

        if discipline == Tournament.Discipline.HANDBALL:
            mapping = {
                self.ClockPeriod.H1: 0,
                self.ClockPeriod.H2: 30 * 60,
            }
            return mapping.get(period, 0)

        return 0

    def clock_seconds_total(self, now: datetime | None = None) -> int:
        return self._clock_period_base_seconds() + self.clock_seconds_in_period(now=now)

    def clock_minute_total(self, now: datetime | None = None) -> int:
        seconds = self.clock_seconds_total(now=now)
        return int(seconds // 60) + 1

    def __str__(self) -> str:
        return f"{self.home_team} vs {self.away_team}"


class MatchCustomResult(models.Model):
    # Model pozostaje dla wyników custom przypisanych do pojedynczego pojedynku.
    class ValueKind(models.TextChoices):
        NUMBER = Tournament.RESULTCFG_VALUE_KIND_NUMBER, "Liczba"
        TIME = Tournament.RESULTCFG_VALUE_KIND_TIME, "Czas"
        PLACE = Tournament.RESULTCFG_VALUE_KIND_PLACE, "Miejsce"

    match = models.ForeignKey(
        Match,
        on_delete=models.CASCADE,
        related_name="custom_results",
    )

    team = models.ForeignKey(
        Team,
        on_delete=models.CASCADE,
        related_name="custom_match_results",
    )

    # Snapshot konfiguracji utrzymuje stabilność wyniku po późniejszych zmianach ustawień.
    value_kind = models.CharField(
        max_length=16,
        choices=ValueKind.choices,
    )

    numeric_value = models.DecimalField(
        max_digits=14,
        decimal_places=4,
        null=True,
        blank=True,
        help_text="Wartość liczbowa dla trybu NUMBER.",
    )

    time_ms = models.BigIntegerField(
        null=True,
        blank=True,
        help_text="Wartość czasu w milisekundach dla trybu TIME.",
    )

    place_value = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="Miejsce dla trybu PLACE.",
    )

    display_value = models.CharField(
        max_length=64,
        blank=True,
        default="",
        help_text="Sformatowana wartość prezentacyjna zwracana do UI.",
    )

    # Flaga pozwala pominąć uczestnika bez fizycznego usuwania rekordu.
    is_active = models.BooleanField(
        default=True,
        db_index=True,
    )

    # Pozycja może być zapisana po klasyfikacji etapu, ale nie jest wymagana przy zapisie.
    rank = models.PositiveIntegerField(
        null=True,
        blank=True,
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_match_custom_results",
    )

    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="updated_match_custom_results",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["rank", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["match", "team"],
                name="uniq_custom_result_match_team",
            ),
            models.CheckConstraint(
                check=(
                    Q(numeric_value__isnull=False)
                    | Q(time_ms__isnull=False)
                    | Q(place_value__isnull=False)
                ),
                name="custom_result_has_some_value",
            ),
            models.CheckConstraint(
                check=Q(time_ms__isnull=True) | Q(time_ms__gte=0),
                name="custom_result_time_ms_non_negative",
            ),
            models.CheckConstraint(
                check=Q(place_value__isnull=True) | Q(place_value__gte=1),
                name="custom_result_place_positive",
            ),
        ]
        indexes = [
            models.Index(fields=["match", "rank"], name="idx_custom_result_match_rank"),
            models.Index(fields=["team", "match"], name="idx_custom_result_team_match"),
        ]

    def clean(self) -> None:
        tournament = self.match.tournament
        context = self.match.get_competition_context()

        if not context.uses_custom_results():
            raise ValidationError("Wynik custom można zapisać tylko dla kontekstu z result_mode=CUSTOM.")

        if context.get_custom_mode() == Tournament.RESULTCFG_CUSTOM_MODE_HEAD_TO_HEAD_POINTS:
            raise ValidationError("Ten model nie obsługuje punktowego trybu HEAD_TO_HEAD_POINTS.")

        if self.team.tournament_id != tournament.id:
            raise ValidationError("Uczestnik wyniku musi należeć do tego samego turnieju co mecz.")

        if self.team_id not in (self.match.home_team_id, self.match.away_team_id):
            raise ValidationError("Uczestnik wyniku musi być jednym z uczestników tego meczu.")

        if self.match.stage.division_id and self.team.division_id != self.match.stage.division_id:
            raise ValidationError("Uczestnik wyniku musi należeć do dywizji etapu meczu.")

        expected_kind = context.get_result_value_kind()
        if self.value_kind != expected_kind:
            raise ValidationError("value_kind wyniku nie zgadza się z konfiguracją dywizji lub turnieju.")

        if self.value_kind == self.ValueKind.TIME:
            if self.time_ms is None:
                raise ValidationError("Dla value_kind=TIME wymagane jest pole time_ms.")
            if self.numeric_value is not None or self.place_value is not None:
                raise ValidationError("Dla value_kind=TIME pozostałe pola wartości muszą być puste.")
            if int(self.time_ms) < 0:
                raise ValidationError("time_ms nie może być ujemne.")

        elif self.value_kind == self.ValueKind.PLACE:
            if self.place_value is None:
                raise ValidationError("Dla value_kind=PLACE wymagane jest pole place_value.")
            if self.numeric_value is not None or self.time_ms is not None:
                raise ValidationError("Dla value_kind=PLACE pozostałe pola wartości muszą być puste.")

        else:
            if self.numeric_value is None:
                raise ValidationError("Dla value_kind=NUMBER wymagane jest pole numeric_value.")
            if self.time_ms is not None or self.place_value is not None:
                raise ValidationError("Dla value_kind=NUMBER pozostałe pola wartości muszą być puste.")

            decimal_places = context.get_result_config().get(
                Tournament.RESULTCFG_DECIMAL_PLACES_KEY,
                0,
            )
            try:
                quantized = self._quantize_numeric(self.numeric_value, decimal_places)
            except InvalidOperation as exc:
                raise ValidationError("Nieprawidłowa wartość numeric_value.") from exc
            self.numeric_value = quantized

    @staticmethod
    def _quantize_numeric(value: Decimal | str | float | int, decimal_places: int) -> Decimal:
        decimal_value = value if isinstance(value, Decimal) else Decimal(str(value))
        exponent = Decimal("1").scaleb(-int(decimal_places))
        return decimal_value.quantize(exponent)

    def get_sort_value(self):
        if self.value_kind == self.ValueKind.TIME:
            return int(self.time_ms or 0)
        if self.value_kind == self.ValueKind.PLACE:
            return int(self.place_value or 0)
        if self.numeric_value is None:
            return None
        return Decimal(self.numeric_value)

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f"{self.match_id}:{self.team_id} {self.display_value or self.get_sort_value()}"


class StageMassStartEntry(models.Model):
    # Model przechowuje realną obsadę etapu MASS_START po jego wygenerowaniu.
    stage = models.ForeignKey(
        Stage,
        on_delete=models.CASCADE,
        related_name="mass_start_entries",
    )

    group = models.ForeignKey(
        Group,
        on_delete=models.SET_NULL,
        related_name="mass_start_entries",
        blank=True,
        null=True,
    )

    team = models.ForeignKey(
        Team,
        on_delete=models.CASCADE,
        related_name="mass_start_entries",
    )

    seed = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="Kolejność wejściowa uczestnika w obrębie wygenerowanego etapu.",
    )

    source_stage = models.ForeignKey(
        Stage,
        on_delete=models.SET_NULL,
        related_name="advanced_mass_start_entries",
        null=True,
        blank=True,
        help_text="Etap źródłowy, z którego uczestnik awansował do bieżącego etapu.",
    )

    source_group = models.ForeignKey(
        Group,
        on_delete=models.SET_NULL,
        related_name="advanced_mass_start_entries",
        null=True,
        blank=True,
        help_text="Grupa źródłowa, z której uczestnik awansował do bieżącego etapu.",
    )

    source_rank = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="Miejsce zajęte w etapie źródłowym podczas generowania awansu.",
    )

    is_active = models.BooleanField(
        default=True,
        db_index=True,
        help_text="Flaga logicznej aktywności wpisu obsady etapu.",
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["stage_id", "group_id", "seed", "team_id", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["stage", "team"],
                name="uniq_mass_start_entry_stage_team",
            ),
        ]
        indexes = [
            models.Index(fields=["stage", "group", "seed"], name="idx_mse_stage_grp_seed"),
            models.Index(fields=["team", "stage"], name="idx_mass_entry_team_stage"),
        ]

    def clean(self) -> None:
        tournament = self.stage.tournament
        context = self.stage.get_competition_context()

        if not context.uses_custom_results():
            raise ValidationError("Obsada etapu MASS_START jest dostępna tylko dla kontekstu z result_mode=CUSTOM.")

        if context.get_custom_mode() != Tournament.RESULTCFG_CUSTOM_MODE_MASS_START_MEASURED:
            raise ValidationError("Ten model obsługuje wyłącznie tryb MASS_START_MEASURED.")

        if not context.uses_mass_start():
            raise ValidationError("Ten model obsługuje wyłącznie turniej lub dywizję w modelu MASS_START.")

        if self.stage.stage_type != Stage.StageType.MASS_START:
            raise ValidationError("Obsada MASS_START może dotyczyć wyłącznie etapu typu MASS_START.")

        if self.team.tournament_id != tournament.id:
            raise ValidationError("Uczestnik obsady musi należeć do tego samego turnieju co etap.")

        if self.stage.division_id and self.team.division_id != self.stage.division_id:
            raise ValidationError("Uczestnik obsady musi należeć do dywizji etapu.")

        if self.group_id and self.group and self.group.stage_id != self.stage_id:
            raise ValidationError("Grupa obsady musi należeć do wskazanego etapu.")

        if self.source_stage_id and self.source_stage and self.source_stage.tournament_id != tournament.id:
            raise ValidationError("Etap źródłowy musi należeć do tego samego turnieju.")

        if self.source_stage_id and self.stage.division_id and self.source_stage.division_id != self.stage.division_id:
            raise ValidationError("Etap źródłowy awansu musi należeć do tej samej dywizji co etap docelowy.")

        if self.source_group_id and self.source_group and self.source_stage_id and self.source_group.stage_id != self.source_stage_id:
            raise ValidationError("Grupa źródłowa musi należeć do wskazanego etapu źródłowego.")

        if self.seed is not None and self.seed < 1:
            raise ValidationError("seed musi być większe lub równe 1.")

        if self.source_rank is not None and self.source_rank < 1:
            raise ValidationError("source_rank musi być większe lub równe 1.")

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f"{self.stage_id}:{self.team_id} seed={self.seed or '-'}"


class StageMassStartResult(models.Model):
    # Model przechowuje wyniki etapów "wszyscy razem" bez parowania uczestników w mecze.
    class ValueKind(models.TextChoices):
        NUMBER = Tournament.RESULTCFG_VALUE_KIND_NUMBER, "Liczba"
        TIME = Tournament.RESULTCFG_VALUE_KIND_TIME, "Czas"
        PLACE = Tournament.RESULTCFG_VALUE_KIND_PLACE, "Miejsce"

    stage = models.ForeignKey(
        Stage,
        on_delete=models.CASCADE,
        related_name="mass_start_results",
    )

    group = models.ForeignKey(
        Group,
        on_delete=models.SET_NULL,
        related_name="mass_start_results",
        blank=True,
        null=True,
    )

    team = models.ForeignKey(
        Team,
        on_delete=models.CASCADE,
        related_name="mass_start_stage_results",
    )

    round_number = models.PositiveSmallIntegerField(
        default=1,
        help_text="Numer próby / rundy w obrębie etapu.",
    )

    value_kind = models.CharField(
        max_length=16,
        choices=ValueKind.choices,
    )

    numeric_value = models.DecimalField(
        max_digits=14,
        decimal_places=4,
        null=True,
        blank=True,
    )

    time_ms = models.BigIntegerField(
        null=True,
        blank=True,
    )

    place_value = models.PositiveIntegerField(
        null=True,
        blank=True,
    )

    display_value = models.CharField(
        max_length=64,
        blank=True,
        default="",
    )

    is_active = models.BooleanField(
        default=True,
        db_index=True,
    )

    rank = models.PositiveIntegerField(
        null=True,
        blank=True,
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_mass_start_results",
    )

    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="updated_mass_start_results",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["group_id", "rank", "round_number", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["stage", "team", "round_number"],
                name="uniq_mass_start_stage_team_round",
            ),
            models.CheckConstraint(
                check=(
                    Q(numeric_value__isnull=False)
                    | Q(time_ms__isnull=False)
                    | Q(place_value__isnull=False)
                ),
                name="mass_start_result_has_some_value",
            ),
            models.CheckConstraint(
                check=Q(time_ms__isnull=True) | Q(time_ms__gte=0),
                name="mass_start_result_time_ms_non_negative",
            ),
            models.CheckConstraint(
                check=Q(place_value__isnull=True) | Q(place_value__gte=1),
                name="mass_start_result_place_positive",
            ),
        ]
        indexes = [
            models.Index(fields=["stage", "group", "rank"], name="idx_mass_stage_group_rank"),
            models.Index(fields=["team", "stage"], name="idx_mass_team_stage"),
        ]

    def clean(self) -> None:
        tournament = self.stage.tournament
        context = self.stage.get_competition_context()

        if not context.uses_custom_results():
            raise ValidationError("Wynik etapu custom można zapisać tylko dla kontekstu z result_mode=CUSTOM.")

        if context.get_custom_mode() != Tournament.RESULTCFG_CUSTOM_MODE_MASS_START_MEASURED:
            raise ValidationError("Ten model obsługuje wyłącznie tryb MASS_START_MEASURED.")

        if not context.uses_mass_start():
            raise ValidationError("Ten model obsługuje wyłącznie turniej lub dywizję w modelu MASS_START.")

        if self.team.tournament_id != tournament.id:
            raise ValidationError("Uczestnik wyniku musi należeć do tego samego turnieju co etap.")

        if self.stage.division_id and self.team.division_id != self.stage.division_id:
            raise ValidationError("Uczestnik wyniku musi należeć do dywizji etapu.")

        if self.group_id and self.group and self.group.stage_id != self.stage_id:
            raise ValidationError("Grupa wyniku musi należeć do wskazanego etapu.")

        if not StageMassStartEntry.objects.filter(
            stage=self.stage,
            team=self.team,
            is_active=True,
        ).exists():
            raise ValidationError("Nie można zapisać wyniku dla uczestnika, który nie należy do wygenerowanej obsady tego etapu.")

        if self.group_id and not StageMassStartEntry.objects.filter(
            stage=self.stage,
            group=self.group,
            team=self.team,
            is_active=True,
        ).exists():
            raise ValidationError("Nie można zapisać wyniku dla uczestnika poza przypisaną grupą etapu.")

        expected_kind = context.get_result_value_kind()
        if self.value_kind != expected_kind:
            raise ValidationError("value_kind wyniku nie zgadza się z konfiguracją dywizji lub turnieju.")

        if self.round_number < 1:
            raise ValidationError("round_number musi być większe lub równe 1.")

        if self.value_kind == self.ValueKind.TIME:
            if self.time_ms is None:
                raise ValidationError("Dla value_kind=TIME wymagane jest pole time_ms.")
            if self.numeric_value is not None or self.place_value is not None:
                raise ValidationError("Dla value_kind=TIME pozostałe pola wartości muszą być puste.")
            if int(self.time_ms) < 0:
                raise ValidationError("time_ms nie może być ujemne.")

        elif self.value_kind == self.ValueKind.PLACE:
            if self.place_value is None:
                raise ValidationError("Dla value_kind=PLACE wymagane jest pole place_value.")
            if self.numeric_value is not None or self.time_ms is not None:
                raise ValidationError("Dla value_kind=PLACE pozostałe pola wartości muszą być puste.")

        else:
            if self.numeric_value is None:
                raise ValidationError("Dla value_kind=NUMBER wymagane jest pole numeric_value.")
            if self.time_ms is not None or self.place_value is not None:
                raise ValidationError("Dla value_kind=NUMBER pozostałe pola wartości muszą być puste.")

            decimal_places = context.get_result_config().get(
                Tournament.RESULTCFG_DECIMAL_PLACES_KEY,
                0,
            )
            try:
                quantized = MatchCustomResult._quantize_numeric(self.numeric_value, decimal_places)
            except InvalidOperation as exc:
                raise ValidationError("Nieprawidłowa wartość numeric_value.") from exc
            self.numeric_value = quantized

    def get_sort_value(self):
        if self.value_kind == self.ValueKind.TIME:
            return int(self.time_ms or 0)
        if self.value_kind == self.ValueKind.PLACE:
            return int(self.place_value or 0)
        if self.numeric_value is None:
            return None
        return Decimal(self.numeric_value)

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f"{self.stage_id}:{self.team_id}:R{self.round_number} {self.display_value or self.get_sort_value()}"


class MatchIncident(models.Model):
    class Kind(models.TextChoices):
        GOAL = "GOAL", "Bramka"
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

    # Pole zachowuje oryginalny zapis czasu do wiernej prezentacji.
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

    # Meta przechowuje dane zależne od rodzaju zdarzenia bez rozbijania modelu.
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
                check=(
                    ~Q(kind="SUBSTITUTION")
                    | (Q(player_in__isnull=False) & Q(player_out__isnull=False))
                ),
                name="sub_req_players_in_out",
            ),
            models.CheckConstraint(
                check=(
                    Q(kind="SUBSTITUTION")
                    | (Q(player_in__isnull=True) & Q(player_out__isnull=True))
                ),
                name="non_sub_no_players_in_out",
            ),
        ]

    def clean(self) -> None:
        if self.team.tournament_id != self.match.tournament_id:
            raise ValidationError("Drużyna zdarzenia musi należeć do tego samego turnieju co mecz.")

        if self.match.stage.division_id and self.team.division_id != self.match.stage.division_id:
            raise ValidationError("Drużyna zdarzenia musi należeć do dywizji meczu.")

        if self.player_id and self.player and self.player.team_id != self.team_id:
            raise ValidationError("Zawodnik zdarzenia musi należeć do wskazanej drużyny.")

        if self.player_in_id and self.player_in and self.player_in.team_id != self.team_id:
            raise ValidationError("Zawodnik wchodzący musi należeć do wskazanej drużyny.")

        if self.player_out_id and self.player_out and self.player_out.team_id != self.team_id:
            raise ValidationError("Zawodnik schodzący musi należeć do wskazanej drużyny.")

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f"{self.match_id}:{self.team_id} {self.kind} @{self.minute or '-'}"


class MatchCommentaryEntry(models.Model):
    class TimeSource(models.TextChoices):
        CLOCK = "CLOCK", "Zegar meczu"
        MANUAL = "MANUAL", "Wprowadzony ręcznie"

    match = models.ForeignKey(
        Match,
        on_delete=models.CASCADE,
        related_name="commentary_entries",
    )

    period = models.CharField(
        max_length=8,
        choices=Match.ClockPeriod.choices,
        default=Match.ClockPeriod.NONE,
        db_index=True,
        help_text="Okres gry w momencie dodania komentarza (np. połowa, dogrywka).",
    )

    time_source = models.CharField(
        max_length=8,
        choices=TimeSource.choices,
        default=TimeSource.CLOCK,
        help_text="Źródło czasu komentarza, istotne przy korektach oraz analizie osi czasu.",
    )

    minute = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        db_index=True,
        help_text="Minuta komentarza w osi czasu meczu (może być pusta w dyscyplinach bez zegara).",
    )

    minute_raw = models.CharField(
        max_length=12,
        null=True,
        blank=True,
        help_text="Oryginalny zapis minuty (np. '90+3'), do wiernej prezentacji.",
    )

    text = models.TextField()

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_match_commentary_entries",
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
        indexes = [
            models.Index(fields=["match", "created_at"], name="idx_comm_match_time"),
            models.Index(fields=["match", "minute"], name="idx_comm_match_minute"),
        ]

    def __str__(self) -> str:
        return f"{self.match_id} @{self.minute or '-'}: {self.text[:30]}"


class TournamentCommentaryPhrase(models.Model):
    class Kind(models.TextChoices):
        TOKEN = "TOKEN", "Słowo"
        TEMPLATE = "TEMPLATE", "Zwrot"

    tournament = models.ForeignKey(
        Tournament,
        on_delete=models.CASCADE,
        related_name="commentary_phrases",
    )

    kind = models.CharField(
        max_length=16,
        choices=Kind.choices,
        default=Kind.TOKEN,
        db_index=True,
    )

    # Kategoria wspiera porządkowanie słownika po stronie panelu live.
    category = models.CharField(
        max_length=40,
        null=True,
        blank=True,
        db_index=True,
        help_text="Opcjonalna kategoria UI (np. akcje, oceny, gotowce).",
    )

    text = models.CharField(max_length=280)

    # Kolejność utrzymuje stabilny układ fraz w UI.
    order = models.PositiveIntegerField(
        default=0,
        help_text="Kolejność prezentacji w UI w ramach (kind, category).",
    )

    # Aktywność logiczna umożliwia zachowanie historii zmian słownika.
    is_active = models.BooleanField(
        default=True,
        db_index=True,
        help_text="Flaga logicznej aktywności, pozwalająca zachować historię zmian słownika.",
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_commentary_phrases",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["kind", "category", "order", "id"]
        indexes = [
            models.Index(
                fields=["tournament", "kind", "is_active"],
                name="idx_phrase_t_kind_on",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.tournament_id}:{self.kind} {self.text[:40]}"
