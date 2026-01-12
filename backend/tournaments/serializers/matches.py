from __future__ import annotations

from typing import Any, Dict, Tuple

from rest_framework import serializers

from tournaments.models import Match, Stage, Tournament

BYE_TEAM_NAME = "__SYSTEM_BYE__"


def _third_place_value() -> str:
    return getattr(Stage.StageType, "THIRD_PLACE", "THIRD_PLACE")


def _is_knockout_like(stage_type: str | None) -> bool:
    return str(stage_type) in (str(Stage.StageType.KNOCKOUT), str(_third_place_value()))


def _tennis_target_sets(cfg: dict) -> int:
    """
    Tenis: best-of-3 albo best-of-5.
    Zwraca liczbę setów potrzebną do zwycięstwa:
    - best-of-3 => 2
    - best-of-5 => 3
    """
    best_of = int(cfg.get("tennis_best_of") or 3)
    if best_of not in (3, 5):
        raise serializers.ValidationError({"tennis_best_of": "Dozwolone wartości to 3 albo 5."})
    return best_of // 2 + 1


def _parse_int(v: Any, *, field: str) -> int:
    try:
        iv = int(v)
    except (TypeError, ValueError):
        raise serializers.ValidationError({field: "Wartość musi być liczbą całkowitą."})
    if iv < 0:
        raise serializers.ValidationError({field: "Wartość nie może być ujemna."})
    return iv


def _validate_tennis_tiebreak(tb_winner: int, tb_loser: int) -> None:
    """
    Tie-break: min 7, przewaga min 2.
    (Nie obsługujemy super tie-breaka do 10 w tej wersji; można dodać później jako opcję configu).
    """
    if tb_winner < 7:
        raise serializers.ValidationError({"tennis_sets": "Tie-break: zwycięzca musi mieć co najmniej 7 punktów."})
    if tb_winner - tb_loser < 2:
        raise serializers.ValidationError({"tennis_sets": "Tie-break: wymagana przewaga co najmniej 2 punktów."})


def _validate_single_tennis_set(
    set_obj: Dict[str, Any],
    *,
    set_index: int,
) -> Tuple[int, int]:
    """
    Waliduje pojedynczy set w gemach.

    Dozwolone wyniki (symetrycznie dla gospodarzy/gości):
    - 6:0 .. 6:4
    - 7:5
    - 7:6 (wymaga tie-breaka)

    Zwraca:
    - (home_games, away_games)
    """
    if not isinstance(set_obj, dict):
        raise serializers.ValidationError({"tennis_sets": f"Set #{set_index}: musi być obiektem JSON."})

    hg = _parse_int(set_obj.get("home_games"), field="tennis_sets")
    ag = _parse_int(set_obj.get("away_games"), field="tennis_sets")

    # wynik końcowy seta nie może być remisowy
    if hg == ag:
        raise serializers.ValidationError({"tennis_sets": f"Set #{set_index}: remis w gemach jest niedozwolony."})

    winner_games = max(hg, ag)
    loser_games = min(hg, ag)

    # 6:0..6:4
    if winner_games == 6:
        if loser_games > 4:
            raise serializers.ValidationError(
                {"tennis_sets": f"Set #{set_index}: wynik 6:{loser_games} jest niedozwolony."}
            )

        # tie-break nie powinien wystąpić
        if (set_obj.get("home_tiebreak") is not None) or (set_obj.get("away_tiebreak") is not None):
            raise serializers.ValidationError(
                {"tennis_sets": f"Set #{set_index}: tie-break dozwolony tylko przy 7:6."}
            )

        return hg, ag

    # 7:5 lub 7:6
    if winner_games == 7:
        if loser_games not in (5, 6):
            raise serializers.ValidationError(
                {"tennis_sets": f"Set #{set_index}: wynik 7:{loser_games} jest niedozwolony."}
            )

        # 7:5 -> bez tie-break
        if loser_games == 5:
            if (set_obj.get("home_tiebreak") is not None) or (set_obj.get("away_tiebreak") is not None):
                raise serializers.ValidationError(
                    {"tennis_sets": f"Set #{set_index}: tie-break dozwolony tylko przy 7:6."}
                )
            return hg, ag

        # 7:6 -> tie-break wymagany
        ht = set_obj.get("home_tiebreak")
        at = set_obj.get("away_tiebreak")
        if ht is None or at is None:
            raise serializers.ValidationError(
                {
                    "tennis_sets": (
                        f"Set #{set_index}: przy 7:6 wymagany jest tie-break "
                        "(home_tiebreak/away_tiebreak)."
                    )
                }
            )

        ht_i = _parse_int(ht, field="tennis_sets")
        at_i = _parse_int(at, field="tennis_sets")

        # TB winner/loser zależnie od zwycięzcy seta
        if hg > ag:
            _validate_tennis_tiebreak(ht_i, at_i)
        else:
            _validate_tennis_tiebreak(at_i, ht_i)

        return hg, ag

    raise serializers.ValidationError(
        {
            "tennis_sets": (
                f"Set #{set_index}: wynik {hg}:{ag} jest niedozwolony "
                "(zwycięzca musi mieć 6 lub 7 gemów)."
            )
        }
    )


def _validate_tennis_sets_and_compute_score_for_save(
    tennis_sets: Any,
    *,
    cfg: dict,
) -> Tuple[int, int, bool]:
    """
    WALIDACJA dla PATCH /result/ (zapis bez kończenia meczu).

    - tennis_sets musi być listą zakończonych setów (każdy set zgodny z zasadami).
    - liczba setów <= best_of (3 lub 5).
    - dopuszcza wynik częściowy (np. 1:1) – mecz nie musi być rozstrzygnięty.
    - ale jeśli już jest rozstrzygnięty (ktoś osiągnął target), nie wolno dopisywać kolejnych setów.

    Zwraca: (home_sets, away_sets, decided)
    """
    if tennis_sets is None:
        raise serializers.ValidationError(
            {"tennis_sets": "Dla tenisa wymagane jest pole tennis_sets (lista setów w gemach)."}
        )

    if not isinstance(tennis_sets, list):
        raise serializers.ValidationError({"tennis_sets": "tennis_sets musi być listą setów."})

    target_sets = _tennis_target_sets(cfg)  # 2 lub 3
    best_of = target_sets * 2 - 1

    if len(tennis_sets) == 0:
        raise serializers.ValidationError({"tennis_sets": "tennis_sets nie może być puste."})
    if len(tennis_sets) > best_of:
        raise serializers.ValidationError({"tennis_sets": f"Zbyt wiele setów dla best-of-{best_of}."})

    home_sets = 0
    away_sets = 0

    for i, s in enumerate(tennis_sets, start=1):
        hg, ag = _validate_single_tennis_set(s, set_index=i)

        if hg > ag:
            home_sets += 1
        else:
            away_sets += 1

        # nie pozwalamy dopisywać setów po osiągnięciu target_sets
        if home_sets == target_sets or away_sets == target_sets:
            if i != len(tennis_sets):
                raise serializers.ValidationError(
                    {"tennis_sets": "Nie można mieć dodatkowych setów po rozstrzygnięciu meczu."}
                )

        # defensywnie: nie można przekroczyć target_sets
        if home_sets > target_sets or away_sets > target_sets:
            raise serializers.ValidationError(
                {"tennis_sets": f"Nieprawidłowy wynik: liczba wygranych setów nie może przekroczyć {target_sets}."}
            )

    decided = (home_sets == target_sets) or (away_sets == target_sets)
    return home_sets, away_sets, decided


def _validate_tennis_sets_and_compute_score_for_finish(
    tennis_sets: Any,
    *,
    cfg: dict,
) -> Tuple[int, int]:
    """
    WALIDACJA dla FINISH (powinna być użyta w POST /finish/).

    Wymusza, że mecz jest rozstrzygnięty zgodnie z best-of:
    - best-of-3: zwycięzca ma 2
    - best-of-5: zwycięzca ma 3
    """
    home_sets, away_sets, decided = _validate_tennis_sets_and_compute_score_for_save(tennis_sets, cfg=cfg)
    target_sets = _tennis_target_sets(cfg)

    if not decided:
        raise serializers.ValidationError({"tennis_sets": f"Aby zakończyć mecz, zwycięzca musi mieć {target_sets} sety."})

    if home_sets == away_sets:
        raise serializers.ValidationError({"tennis_sets": "Mecz tenisowy nie może zakończyć się remisem w setach."})

    # Zwycięzca musi mieć dokładnie target_sets
    if max(home_sets, away_sets) != target_sets:
        raise serializers.ValidationError(
            {"tennis_sets": f"Nieprawidłowa liczba wygranych setów: zwycięzca musi mieć {target_sets} sety."}
        )

    return home_sets, away_sets


# ============================================================
# KOMPATYBILNOŚĆ: nazwa, której szuka /finish/
# (naprawia błąd importu: cannot import name ...)
# ============================================================
def _validate_tennis_sets_and_compute_score(
    tennis_sets: Any,
    *,
    cfg: dict,
) -> Tuple[int, int]:
    """
    Alias kompatybilności dla kodu, który importuje:
      from tournaments.serializers.matches import _validate_tennis_sets_and_compute_score

    Domyślnie zachowuje się jak walidacja dla FINISH.
    """
    return _validate_tennis_sets_and_compute_score_for_finish(tennis_sets, cfg=cfg)


class MatchSerializer(serializers.ModelSerializer):
    """
    Serializer do listy meczów (UI).

    Dla tenisa:
    - home_score/away_score = sety,
    - tennis_sets = sety w gemach (opcjonalnie z tie-break).
    """

    home_team_id = serializers.IntegerField(source="home_team.id", read_only=True)
    away_team_id = serializers.IntegerField(source="away_team.id", read_only=True)

    home_team_name = serializers.CharField(source="home_team.name", read_only=True)
    away_team_name = serializers.CharField(source="away_team.name", read_only=True)

    stage_type = serializers.CharField(source="stage.stage_type", read_only=True)
    stage_id = serializers.IntegerField(source="stage.id", read_only=True)
    stage_order = serializers.IntegerField(source="stage.order", read_only=True)

    group_name = serializers.CharField(source="group.name", read_only=True, allow_null=True)

    winner_id = serializers.IntegerField(source="winner.id", read_only=True, allow_null=True)

    is_technical = serializers.SerializerMethodField()

    class Meta:
        model = Match
        fields = (
            "id",
            "stage_id",
            "stage_order",
            "stage_type",
            "group_name",
            "round_number",
            "home_team_id",
            "away_team_id",
            "home_team_name",
            "away_team_name",
            "home_score",
            "away_score",
            "tennis_sets",
            "went_to_extra_time",
            "home_extra_time_score",
            "away_extra_time_score",
            "decided_by_penalties",
            "home_penalty_score",
            "away_penalty_score",
            "result_entered",
            "winner_id",
            "status",
            "scheduled_date",
            "scheduled_time",
            "location",
            "is_technical",
        )

    def get_is_technical(self, obj: Match) -> bool:
        return (
            obj.home_team and obj.home_team.name == BYE_TEAM_NAME
        ) or (
            obj.away_team and obj.away_team.name == BYE_TEAM_NAME
        )


class MatchScheduleUpdateSerializer(serializers.ModelSerializer):
    """
    PATCH /api/matches/:id/
    """

    class Meta:
        model = Match
        fields = ("scheduled_date", "scheduled_time", "location")


class MatchResultUpdateSerializer(serializers.ModelSerializer):
    """
    PATCH /api/matches/:id/result/

    Cel: tylko zapis pól wyniku (w tym dogrywka/karne), bez kończenia meczu.
    Status FINISHED ustawiamy wyłącznie w POST /finish/.

    Dla tenisa:
    - głównym źródłem prawdy jest tennis_sets (sety w gemach),
    - home_score/away_score ustawiamy automatycznie na podstawie tennis_sets (sety),
    - dogrywka/karne są zawsze wyłączone.
    """

    home_score = serializers.IntegerField(required=False, allow_null=False, min_value=0)
    away_score = serializers.IntegerField(required=False, allow_null=False, min_value=0)

    tennis_sets = serializers.JSONField(required=False, allow_null=True)

    went_to_extra_time = serializers.BooleanField(required=False)
    home_extra_time_score = serializers.IntegerField(required=False, allow_null=True, min_value=0)
    away_extra_time_score = serializers.IntegerField(required=False, allow_null=True, min_value=0)

    decided_by_penalties = serializers.BooleanField(required=False)
    home_penalty_score = serializers.IntegerField(required=False, allow_null=True, min_value=0)
    away_penalty_score = serializers.IntegerField(required=False, allow_null=True, min_value=0)

    status = serializers.CharField(read_only=True)

    class Meta:
        model = Match
        fields = (
            "home_score",
            "away_score",
            "tennis_sets",
            "went_to_extra_time",
            "home_extra_time_score",
            "away_extra_time_score",
            "decided_by_penalties",
            "home_penalty_score",
            "away_penalty_score",
            "status",
        )

    def update(self, instance: Match, validated_data):
        stage_type = getattr(instance.stage, "stage_type", None)
        tournament: Tournament = instance.tournament
        discipline = (getattr(tournament, "discipline", "") or "").lower()
        cfg = tournament.format_config or {}

        touched_keys = {
            "home_score", "away_score",
            "tennis_sets",
            "went_to_extra_time", "home_extra_time_score", "away_extra_time_score",
            "decided_by_penalties", "home_penalty_score", "away_penalty_score",
        }
        if any(k in validated_data for k in touched_keys):
            instance.result_entered = True

        # 1) set values (only provided)
        for k, v in validated_data.items():
            setattr(instance, k, v)

        # 2) checkbox normalization (hard cleanup)
        if not instance.went_to_extra_time:
            instance.home_extra_time_score = None
            instance.away_extra_time_score = None

        if not instance.decided_by_penalties:
            instance.home_penalty_score = None
            instance.away_penalty_score = None

        # 3) domain constraints (soft cleanup on PATCH)
        knockout_like = _is_knockout_like(stage_type)

        # --- TENIS
        if discipline == "tennis":
            # tenis nigdy nie używa ET ani karnych
            instance.went_to_extra_time = False
            instance.home_extra_time_score = None
            instance.away_extra_time_score = None
            instance.decided_by_penalties = False
            instance.home_penalty_score = None
            instance.away_penalty_score = None

            # tennis_sets jest źródłem prawdy dla setów
            home_sets, away_sets, _decided = _validate_tennis_sets_and_compute_score_for_save(
                instance.tennis_sets,
                cfg=cfg,
            )

            # wynik w setach wynika z tennis_sets
            instance.home_score = home_sets
            instance.away_score = away_sets

            instance.save()
            return instance

        # --- pozostałe dyscypliny: defensywnie czyścimy tennis_sets
        instance.tennis_sets = None

        # non-handball: ET/pen only in KO-like
        if discipline != "handball" and not knockout_like:
            instance.went_to_extra_time = False
            instance.home_extra_time_score = None
            instance.away_extra_time_score = None
            instance.decided_by_penalties = False
            instance.home_penalty_score = None
            instance.away_penalty_score = None

        # handball KO: config may forbid overtime
        if discipline == "handball" and knockout_like:
            tiebreak = (cfg.get("handball_knockout_tiebreak") or "OVERTIME_PENALTIES").upper()
            if tiebreak == "PENALTIES":
                instance.went_to_extra_time = False
                instance.home_extra_time_score = None
                instance.away_extra_time_score = None

        # handball league/group: tie-break only makes sense on draw
        if discipline == "handball" and str(stage_type) in (str(Stage.StageType.LEAGUE), str(Stage.StageType.GROUP)):
            if instance.home_score != instance.away_score:
                instance.went_to_extra_time = False
                instance.home_extra_time_score = None
                instance.away_extra_time_score = None
                instance.decided_by_penalties = False
                instance.home_penalty_score = None
                instance.away_penalty_score = None
            else:
                draw_mode = (cfg.get("handball_table_draw_mode") or "ALLOW_DRAW").upper()
                if draw_mode == "ALLOW_DRAW":
                    instance.went_to_extra_time = False
                    instance.home_extra_time_score = None
                    instance.away_extra_time_score = None
                    instance.decided_by_penalties = False
                    instance.home_penalty_score = None
                    instance.away_penalty_score = None
                elif draw_mode == "PENALTIES":
                    instance.went_to_extra_time = False
                    instance.home_extra_time_score = None
                    instance.away_extra_time_score = None

        instance.save()
        return instance
