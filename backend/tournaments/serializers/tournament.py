# backend/tournaments/serializers/tournament.py
from __future__ import annotations

from django.contrib.auth import get_user_model
from rest_framework import serializers

from tournaments.models import Match, Tournament, TournamentMembership, TournamentRegistration

User = get_user_model()

TENIS_POINTS_MODES = ("NONE", "PLT")
BYE_TEAM_NAME = "__SYSTEM_BYE__"

# Docelowo aktywne tylko te dwa:
ACTIVE_ENTRY_MODES = (Tournament.EntryMode.MANAGER, Tournament.EntryMode.ORGANIZER_ONLY)


def _normalize_format_config(discipline: str | None, cfg) -> dict:
    """
    Ujednolica format_config:
    - zawsze dict
    - dla tenisa: gwarantuje tennis_points_mode ∈ {NONE, PLT} (domyślnie NONE)
    - dla innych dyscyplin: usuwa tennis_points_mode, jeśli ktoś go podał
    """
    discipline = (discipline or "").lower()

    if cfg is None:
        cfg = {}
    if not isinstance(cfg, dict):
        raise serializers.ValidationError(
            {"format_config": "format_config musi być obiektem JSON (dict)."}
        )

    cfg = dict(cfg)  # kopia

    if discipline == "tennis":
        mode = cfg.get("tennis_points_mode") or "NONE"
        mode = str(mode).upper()
        if mode not in TENIS_POINTS_MODES:
            raise serializers.ValidationError(
                {
                    "format_config": {
                        "tennis_points_mode": f"Dozwolone: {', '.join(TENIS_POINTS_MODES)}"
                    }
                }
            )
        cfg["tennis_points_mode"] = mode
    else:
        cfg.pop("tennis_points_mode", None)

    return cfg


def _safe_entry_mode(value: str | None) -> str:
    """
    Defensive read:
    Jeśli w DB istnieje legacy entry_mode (np. SELF_REGISTER),
    to na wyjściu mapujemy go do MANAGER (żeby ChoiceField nie powodował 500).
    """
    if value in ACTIVE_ENTRY_MODES:
        return value
    return Tournament.EntryMode.MANAGER


class TournamentSerializer(serializers.ModelSerializer):
    """
    Zasady:
    - entry_mode steruje WYŁĄCZNIE panelem (MANAGER / ORGANIZER_ONLY)
    - allow_join_by_code to toggle dołączania uczestników przez konto + kod
    - join_code to kod dołączania (dla uczestników)
    - kody (access_code, join_code) zwracamy TYLKO organizerowi
    """

    my_role = serializers.SerializerMethodField()
    matches_started = serializers.SerializerMethodField()
    my_permissions = serializers.SerializerMethodField()

    # ==========
    # API kontrakt dla frontu (spójne nazwy)
    # model może mieć legacy: join_enabled + registration_code
    # ==========
    allow_join_by_code = serializers.BooleanField(required=False, source="join_enabled")
    join_code = serializers.CharField(
        required=False,
        allow_null=True,
        allow_blank=True,
        source="registration_code",
    )

    class Meta:
        model = Tournament
        fields = "__all__"
        read_only_fields = (
            "organizer",
            "status",
            "created_at",
            "my_role",
            "matches_started",
            "my_permissions",
        )

    # ============================================================
    # UKRYWANIE / NORMALIZACJA PÓL (READ)
    # ============================================================

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")

        # Defensive: entry_mode z DB może mieć legacy wartość -> mapujemy na MANAGER
        if "entry_mode" in data:
            data["entry_mode"] = _safe_entry_mode(data.get("entry_mode"))

        # Nie chcemy dubli nazw (legacy) w API — trzymamy kontrakt frontendowy:
        # allow_join_by_code + join_code
        data.pop("join_enabled", None)
        data.pop("registration_code", None)

        # Kody widoczne tylko dla organizatora:
        # - access_code (kod dla widzów)
        # - join_code (kod dla uczestników)
        if not request or not request.user.is_authenticated or instance.organizer_id != request.user.id:
            data.pop("access_code", None)
            data.pop("join_code", None)

        return data

    # ============================================================
    # WALIDACJA FORMATU VS DYSCYPLINA
    # ============================================================

    def validate_tournament_format(self, value):
        discipline = (
            self.initial_data.get("discipline")
            or (self.instance.discipline if self.instance else None)
        )

        if discipline:
            allowed = Tournament.allowed_formats_for_discipline(discipline)
            if value not in allowed:
                raise serializers.ValidationError(
                    "Wybrany format nie jest dostępny dla tej dyscypliny."
                )
        return value

    def validate_format_config(self, value):
        discipline = (
            self.initial_data.get("discipline")
            or (self.instance.discipline if self.instance else None)
        )
        return _normalize_format_config(discipline, value)

    def validate_entry_mode(self, value: str):
        # Docelowo akceptujemy TYLKO aktywne tryby panelu.
        if value not in ACTIVE_ENTRY_MODES:
            raise serializers.ValidationError(
                "Nieprawidłowy tryb panelu. Dozwolone: MANAGER, ORGANIZER_ONLY."
            )
        return value

    # ============================================================
    # WALIDACJA KONTEKSTOWA (STATUS / ROLE)
    # ============================================================

    def validate(self, attrs):
        request = self.context.get("request")
        instance = self.instance

        # Normalizacja format_config gdy przychodzi w PATCH/POST
        if "format_config" in attrs:
            discipline = attrs.get("discipline") or (instance.discipline if instance else None)
            attrs["format_config"] = _normalize_format_config(discipline, attrs.get("format_config"))

        # =========================
        # Walidacja join-by-code (kontrakt frontendowy)
        #
        # Ponieważ mamy source mapping:
        # - allow_join_by_code -> join_enabled
        # - join_code -> registration_code
        # to tutaj operujemy na kluczach MODELowych (join_enabled/registration_code),
        # bo właśnie takie będą w attrs po zmapowaniu.
        # =========================
        join_enabled = attrs.get("join_enabled", None)
        reg_code = attrs.get("registration_code", None)

        if join_enabled is True:
            code = (reg_code or "").strip()
            if len(code) < 3:
                raise serializers.ValidationError(
                    {"join_code": "Dla dołączania przez kod wymagany jest kod (min. 3 znaki)."}
                )
            attrs["registration_code"] = code
        elif join_enabled is False:
            # jeśli wyłączamy, czyścimy kod
            attrs["registration_code"] = None

        # CREATE lub brak usera: nie narzucamy reguł zmian po DRAFT
        if not request or not request.user.is_authenticated or not instance:
            # Przy CREATE też pilnujemy entry_mode (jeśli podany)
            if "entry_mode" in attrs:
                attrs["entry_mode"] = self.validate_entry_mode(attrs["entry_mode"])
            return attrs

        # --------------------------------------------
        # Dyscyplina po DRAFT -> tylko change-discipline
        # --------------------------------------------
        if instance.status != Tournament.Status.DRAFT and "discipline" in attrs:
            raise serializers.ValidationError(
                {
                    "discipline": (
                        "Zmiana dyscypliny po konfiguracji turnieju wymaga resetu. "
                        "Użyj endpointu: POST /api/tournaments/<id>/change-discipline/"
                    )
                }
            )

        # --------------------------------------------
        # Setup po DRAFT -> tylko change-setup
        # --------------------------------------------
        if instance.status != Tournament.Status.DRAFT and any(
            f in attrs for f in ("tournament_format", "format_config")
        ):
            raise serializers.ValidationError(
                {
                    "detail": (
                        "Zmiana konfiguracji turnieju po wygenerowaniu rozgrywek "
                        "wymaga resetu etapów i meczów. "
                        "Użyj endpointu: POST /api/tournaments/<id>/change-setup/"
                    )
                }
            )

        # ============================================================
        # UPRAWNIENIA (WRITE)
        # ============================================================

        is_organizer = instance.organizer_id == request.user.id
        is_assistant = instance.memberships.filter(
            user=request.user,
            role=TournamentMembership.Role.ASSISTANT,
        ).exists()

        # Pola organizer-only (WRITE)
        # - publikacja, kody, tryb panelu, toggle join, join-code
        if not is_organizer:
            for field in (
                "is_published",
                "access_code",
                "entry_mode",
                "join_enabled",        # model
                "registration_code",   # model
                # defensywnie (gdyby gdzieś trafiły jeszcze nazwy z frontu)
                "allow_join_by_code",
                "join_code",
            ):
                attrs.pop(field, None)

        # Konfiguracja sportowa: organizer lub asystent
        if not (is_organizer or is_assistant):
            for field in (
                "competition_type",
                "tournament_format",
                "format_config",
            ):
                attrs.pop(field, None)

        # Jeśli organizer zmienia entry_mode, to pilnujemy tylko 2 trybów
        if is_organizer and "entry_mode" in attrs:
            attrs["entry_mode"] = self.validate_entry_mode(attrs["entry_mode"])

        return attrs

    # ============================================================
    # CREATE
    # ============================================================

    def create(self, validated_data):
        if "competition_type" not in validated_data:
            validated_data["competition_type"] = Tournament.infer_default_competition_type(
                validated_data.get("discipline")
            )

        discipline = (validated_data.get("discipline") or "").lower()
        validated_data["format_config"] = _normalize_format_config(
            discipline,
            validated_data.get("format_config"),
        )

        # entry_mode domyślnie MANAGER (model), ale jeśli podany — tylko aktywne
        if "entry_mode" in validated_data:
            validated_data["entry_mode"] = self.validate_entry_mode(validated_data["entry_mode"])

        return super().create(validated_data)

    # ============================================================
    # META
    # ============================================================

    def get_my_role(self, obj):
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return None

        if obj.organizer_id == request.user.id:
            return "ORGANIZER"

        if obj.memberships.filter(
            user=request.user,
            role=TournamentMembership.Role.ASSISTANT,
        ).exists():
            return TournamentMembership.Role.ASSISTANT

        if TournamentRegistration.objects.filter(tournament=obj, user=request.user).exists():
            return "PARTICIPANT"

        return None

    def get_my_permissions(self, obj: Tournament) -> dict:
        """
        Kontrakt dla frontu: uprawnienia do AKCJI (granularnie).
        Zwracamy pełny zestaw kluczy PERM_* (łącznie z nowymi).
        """
        request = self.context.get("request")
        user = request.user if request and request.user and request.user.is_authenticated else None

        # Pełny "szablon" odpowiedzi (zawsze te same klucze)
        base = {
            TournamentMembership.PERM_TEAMS_EDIT: False,
            TournamentMembership.PERM_ROSTER_EDIT: False,
            TournamentMembership.PERM_SCHEDULE_EDIT: False,
            TournamentMembership.PERM_RESULTS_EDIT: False,
            TournamentMembership.PERM_BRACKET_EDIT: False,
            TournamentMembership.PERM_TOURNAMENT_EDIT: False,

            # organizer-only (asystent zawsze false)
            TournamentMembership.PERM_PUBLISH: False,
            TournamentMembership.PERM_ARCHIVE: False,
            TournamentMembership.PERM_MANAGE_ASSISTANTS: False,
            TournamentMembership.PERM_JOIN_SETTINGS: False,

            # NOWE
            TournamentMembership.PERM_NAME_CHANGE_APPROVE: False,
        }

        # Organizer ma pełne prawa (łącznie z organizer-only)
        if user and obj.organizer_id == user.id:
            return {
                TournamentMembership.PERM_TEAMS_EDIT: True,
                TournamentMembership.PERM_ROSTER_EDIT: True,
                TournamentMembership.PERM_SCHEDULE_EDIT: True,
                TournamentMembership.PERM_RESULTS_EDIT: True,
                TournamentMembership.PERM_BRACKET_EDIT: True,
                TournamentMembership.PERM_TOURNAMENT_EDIT: True,

                TournamentMembership.PERM_NAME_CHANGE_APPROVE: True,

                TournamentMembership.PERM_PUBLISH: True,
                TournamentMembership.PERM_ARCHIVE: True,
                TournamentMembership.PERM_MANAGE_ASSISTANTS: True,
                TournamentMembership.PERM_JOIN_SETTINGS: True,
            }

        # Asystent
        m = None
        if user:
            m = TournamentMembership.objects.filter(
                tournament=obj,
                user=user,
                role=TournamentMembership.Role.ASSISTANT,
            ).first()

        if not m:
            return base

        # W ORGANIZER_ONLY: asystent ma podgląd, edycja twardo False
        if _safe_entry_mode(obj.entry_mode) == Tournament.EntryMode.ORGANIZER_ONLY:
            return base

        # W MANAGER: bierzemy effective_permissions (ale organizer-only dalej false)
        eff = m.effective_permissions()

        base.update(
            {
                TournamentMembership.PERM_TEAMS_EDIT: bool(eff.get(TournamentMembership.PERM_TEAMS_EDIT)),
                TournamentMembership.PERM_ROSTER_EDIT: bool(eff.get(TournamentMembership.PERM_ROSTER_EDIT)),
                TournamentMembership.PERM_SCHEDULE_EDIT: bool(eff.get(TournamentMembership.PERM_SCHEDULE_EDIT)),
                TournamentMembership.PERM_RESULTS_EDIT: bool(eff.get(TournamentMembership.PERM_RESULTS_EDIT)),
                TournamentMembership.PERM_BRACKET_EDIT: bool(eff.get(TournamentMembership.PERM_BRACKET_EDIT)),
                TournamentMembership.PERM_TOURNAMENT_EDIT: bool(eff.get(TournamentMembership.PERM_TOURNAMENT_EDIT)),

                TournamentMembership.PERM_NAME_CHANGE_APPROVE: bool(
                    eff.get(TournamentMembership.PERM_NAME_CHANGE_APPROVE)),
            }
        )
        return base

    def get_matches_started(self, obj: Tournament) -> bool:
        """
        True tylko jeśli rozpoczął się REALNY mecz (nie techniczny BYE):
        istnieje mecz IN_PROGRESS lub FINISHED, w którym NIE gra __SYSTEM_BYE__.
        """
        return (
            obj.matches.exclude(home_team__name=BYE_TEAM_NAME)
            .exclude(away_team__name=BYE_TEAM_NAME)
            .filter(status__in=(Match.Status.IN_PROGRESS, Match.Status.FINISHED))
            .exists()
        )


class TournamentMetaUpdateSerializer(serializers.ModelSerializer):
    """
    Serializer do edycji pól meta turnieju:
    - start_date, end_date, location
    - description
    Endpoint: PATCH /api/tournaments/{id}/meta/
    """

    class Meta:
        model = Tournament
        fields = ("start_date", "end_date", "location", "description")

    def validate(self, attrs):
        start = attrs.get("start_date", getattr(self.instance, "start_date", None))
        end = attrs.get("end_date", getattr(self.instance, "end_date", None))
        if start and end and end < start:
            raise serializers.ValidationError(
                {"end_date": "Data zakończenia nie może być wcześniejsza niż data rozpoczęcia."}
            )
        return attrs
