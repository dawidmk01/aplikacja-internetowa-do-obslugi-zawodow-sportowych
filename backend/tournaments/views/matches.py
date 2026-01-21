from __future__ import annotations

import math

from typing import Optional, List, Tuple, Dict, Any

from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone

from rest_framework import status
from rest_framework.generics import ListAPIView, RetrieveUpdateAPIView
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from tournaments.services.match_result import MatchResultService
from tournaments.services.match_outcome import (
    knockout_winner_id,
    validate_extra_time_consistency,
    validate_penalties_consistency,
)

from ..models import Match, Stage, Tournament, MatchIncident
from ..serializers import MatchResultUpdateSerializer, MatchSerializer
from ._helpers import (
    # PODGLĄD/ROLE (NOWA STRATEGIA)
    user_is_assistant,
    user_can_view_tournament,
    can_edit_schedule,
    can_edit_results,
    public_access_or_403,  # <-- NOWE: wspólna kontrola dostępu do TournamentPublic

    # KO helpers (bez zmian)
    _get_cup_matches,
    _sync_two_leg_pair_winner_if_possible,
    _try_auto_advance_knockout,
    handle_knockout_winner_change,
)

# ============================================================
# Local Helpers
# ============================================================

def _third_place_value() -> str:
    """Safely retrieves the value for Third Place stage type."""
    return getattr(Stage.StageType, "THIRD_PLACE", "THIRD_PLACE")


def _is_third_place_stage(stage: Stage) -> bool:
    return str(stage.stage_type) == str(_third_place_value())


def _is_tennis(tournament: Tournament) -> bool:
    return (getattr(tournament, "discipline", "") or "").lower() == "tennis"


def _get_pair_matches(stage: Stage, match: Match) -> List[Match]:
    """
    Returns matches belonging to the same pair (Home vs Away or Away vs Home) in the same stage.
    Used for two-legged ties.
    """
    if not match.home_team_id or not match.away_team_id:
        return [match]

    qs = Match.objects.filter(
        Q(home_team_id=match.home_team_id, away_team_id=match.away_team_id) |
        Q(home_team_id=match.away_team_id, away_team_id=match.home_team_id),
        stage=stage
    ).only(
        "id", "status", "winner_id",
        "home_team_id", "away_team_id",
        "home_score", "away_score",
        "tennis_sets",
        "went_to_extra_time", "home_extra_time_score", "away_extra_time_score",
        "decided_by_penalties", "home_penalty_score", "away_penalty_score",
        "result_entered",
    )
    return list(qs)


def _pair_is_complete_two_leg(group: List[Match]) -> bool:
    return len(group) == 2 and all(m.status == Match.Status.FINISHED for m in group)


def _pair_winner_id(group: List[Match]) -> Optional[int]:
    """
    Assumes _sync_two_leg_pair_winner_if_possible sets winner_id on BOTH matches when possible.
    """
    if not group:
        return None
    ids = {m.winner_id for m in group}
    if None in ids:
        return None
    if len(ids) == 1:
        return next(iter(ids))
    return None


def _handle_knockout_progression(
    tournament: Tournament,
    stage: Stage,
    old_winner_id: Optional[int],
    new_winner_id: Optional[int],
) -> None:
    """
    Applies only to the main KNOCKOUT tree (not Third Place).
    """
    if stage.stage_type != Stage.StageType.KNOCKOUT:
        return

    handle_knockout_winner_change(
        tournament=tournament,
        stage=stage,
        old_winner_id=old_winner_id,
        new_winner_id=new_winner_id,
    )

    if tournament.status != Tournament.Status.FINISHED:
        _try_auto_advance_knockout(stage)


def _stringify_validation_detail(detail: object) -> str:
    if detail is None:
        return "Nieprawidłowe dane."
    if isinstance(detail, str):
        return detail
    if isinstance(detail, list):
        return "; ".join(str(x) for x in detail)
    if isinstance(detail, dict):
        for k in ("non_field_errors", "tennis_sets", "detail"):
            v = detail.get(k)
            if v:
                if isinstance(v, list):
                    return "; ".join(str(x) for x in v)
                return str(v)
        return "; ".join(f"{k}: {v}" for k, v in detail.items())
    return str(detail)


def _validate_tennis_match_before_finish(match: Match, cfg: dict) -> Optional[str]:
    if not match.result_entered:
        return "Nie można zakończyć meczu tenisowego bez wprowadzenia wyniku."

    if match.tennis_sets is None:
        return "Brak danych setów (tennis_sets). Uzupełnij sety w gemach."

    if match.went_to_extra_time or match.decided_by_penalties:
        return "W tenisie nie obsługujemy dogrywki ani karnych."

    if match.home_extra_time_score is not None or match.away_extra_time_score is not None:
        return "W tenisie nie obsługujemy dogrywki (pola ET muszą być puste)."

    if match.home_penalty_score is not None or match.away_penalty_score is not None:
        return "W tenisie nie obsługujemy karnych (pola karnych muszą być puste)."

    try:
        from tournaments.serializers.matches import _validate_tennis_sets_and_compute_score
        home_sets, away_sets = _validate_tennis_sets_and_compute_score(match.tennis_sets, cfg=cfg)
    except Exception as e:
        detail = getattr(e, "detail", None)
        if detail is not None:
            return _stringify_validation_detail(detail)
        return str(e)

    hs = int(match.home_score or 0)
    aws = int(match.away_score or 0)

    if hs != home_sets or aws != away_sets:
        return "Niespójność danych: wynik setów nie zgadza się z tennis_sets. Zapisz wynik ponownie."

    return None


def _tennis_winner_id_from_sets(match: Match) -> Optional[int]:
    hs = int(match.home_score or 0)
    aws = int(match.away_score or 0)
    if hs == aws:
        return None
    return match.home_team_id if hs > aws else match.away_team_id


def _is_mixed(tournament: Tournament) -> bool:
    return str(getattr(tournament, "tournament_format", "")).upper() == "MIXED"


def _knockout_exists(tournament: Tournament) -> bool:
    return Stage.objects.filter(
        tournament=tournament,
        stage_type=Stage.StageType.KNOCKOUT,
    ).exists()


def _knockout_has_started(tournament: Tournament) -> bool:
    qs = Match.objects.filter(
        tournament=tournament,
        stage__stage_type=Stage.StageType.KNOCKOUT,
    )
    if qs.filter(result_entered=True).exists():
        return True
    if qs.exclude(status=Match.Status.SCHEDULED).exists():
        return True
    return False


def _import_advance_from_groups():
    from tournaments.services.advance_from_groups import advance_from_groups
    return advance_from_groups


def _regenerate_knockout_from_groups_if_safe(tournament: Tournament) -> None:
    if not _is_mixed(tournament):
        return
    if not _knockout_exists(tournament):
        return
    if _knockout_has_started(tournament):
        return

    third_place = _third_place_value()

    Stage.objects.filter(
        tournament=tournament,
        stage_type__in=[Stage.StageType.KNOCKOUT, third_place],
    ).delete()

    advance_from_groups = _import_advance_from_groups()
    advance_from_groups(tournament)


SYNC_CODE_WOULD_DELETE_FILLED = "INCIDENTS_SYNC_WOULD_DELETE_FILLED"


# =========================
# Score <-> incidents (GOAL) sync
# =========================

def _incident_goal_points(discipline: str, meta: object) -> int:
    """
    GOAL punktacja:
    - koszykówka: meta.points = 1/2/3 (domyślnie 1)
    - reszta: 1
    """
    if discipline == Tournament.Discipline.BASKETBALL:
        m = meta if isinstance(meta, dict) else {}
        raw = m.get("points", 1)
        try:
            pts = int(raw or 1)
        except (TypeError, ValueError):
            pts = 1
        return pts if pts in (1, 2, 3) else 1
    return 1


def _is_goal_based_or_basketball(discipline: str) -> bool:
    return discipline in (
        Tournament.Discipline.FOOTBALL,
        Tournament.Discipline.HANDBALL,
        Tournament.Discipline.BASKETBALL,
    )


def _incident_counts_for_main_score(discipline: str, period: object) -> bool:
    """
    Na tym etapie pilnujemy spójności głównego wyniku (home_score/away_score)
    z incydentami GOAL. Jeżeli w przyszłości rozdzielisz ET na osobne pola,
    to ET1/ET2 nie powinny liczyć się do main-score.
    """
    p = str(period or "").strip() or "NONE"

    if discipline == Tournament.Discipline.FOOTBALL:
        return p in {"NONE", "FH", "SH"}  # ET1/ET2 pomijamy
    if discipline == Tournament.Discipline.HANDBALL:
        return p in {"NONE", "H1", "H2"}
    # kosz + pozostałe: liczymy wszystko
    return True


def _goal_incident_is_filled(i: MatchIncident) -> bool:
    """
    Uznajemy, że incydent GOAL jest "uzupełniony", jeśli ma jakiekolwiek dane
    operatora: zawodnika lub czas.
    """
    if getattr(i, "player_id", None):
        return True
    if getattr(i, "minute", None) is not None:
        return True
    mr = (getattr(i, "minute_raw", None) or "").strip()
    return bool(mr)


def _sum_goal_points_for_team(match: Match, *, team_id: int) -> int:
    d = match.tournament.discipline
    if not team_id:
        return 0
    qs = (
        MatchIncident.objects
        .filter(match_id=match.id, kind="GOAL", team_id=team_id)
        .only("id", "team_id", "meta", "period")
    )
    total = 0
    for i in qs:
        if not _incident_counts_for_main_score(d, i.period):
            continue
        total += _incident_goal_points(d, i.meta)
    return int(total)


def _points_to_basketball_chunks(diff: int) -> List[int]:
    """Rozbij różnicę punktów na listę 3/2/1 (greedy)."""
    left = max(0, int(diff))
    out: List[int] = []
    for p in (3, 2, 1):
        while left >= p:
            out.append(p)
            left -= p
    return out


def _sync_score_to_goal_incidents_or_409(
    match: Match,
    *,
    force: bool,
    created_by_id: Optional[int] = None,
) -> Optional[Response]:
    """
    Szybki wynik = źródło prawdy.

    Dla football/handball/basketball synchronizujemy incydenty GOAL tak, aby
    suma incydentów (w main periods) == match.home_score / match.away_score.

    - dodajemy placeholdery GOAL z meta._score_delta=0 (żeby nie "podnosiły" wyniku),
    - usuwamy nadmiarowe GOAL: najpierw puste, potem (opcjonalnie) uzupełnione.
    - jeżeli musielibyśmy usunąć uzupełnione i force==False => 409 + kod.
    """
    t = match.tournament
    d = t.discipline

    if _is_tennis(t):
        return None
    if not _is_goal_based_or_basketball(d):
        return None
    if not match.home_team_id or not match.away_team_id:
        return None

    desired_home = int(match.home_score or 0)
    desired_away = int(match.away_score or 0)

    # Zbierz kandydatów do zmian
    qs = (
        MatchIncident.objects
        .filter(match_id=match.id, kind="GOAL")
        .only("id", "team_id", "meta", "period", "player_id", "minute", "minute_raw")
        .order_by("-id")
    )

    by_team: Dict[int, List[MatchIncident]] = {match.home_team_id: [], match.away_team_id: []}
    for i in qs:
        if i.team_id not in by_team:
            continue
        if not _incident_counts_for_main_score(d, i.period):
            continue
        by_team[i.team_id].append(i)

    def current_points(team_id: int) -> int:
        total = 0
        for i in by_team.get(team_id, []):
            total += _incident_goal_points(d, i.meta)
        return int(total)

    cur_home = current_points(match.home_team_id)
    cur_away = current_points(match.away_team_id)

    to_delete: List[MatchIncident] = []
    would_delete_filled: List[MatchIncident] = []

    def plan_deletions(team_id: int, cur: int, desired: int) -> int:
        """Zwraca nową wartość cur po zaplanowaniu usunięć."""
        if cur <= desired:
            return cur

        # preferuj usuwanie pustych (nieuzupełnionych)
        candidates = by_team.get(team_id, [])
        candidates_sorted = sorted(candidates, key=lambda x: (_goal_incident_is_filled(x), -int(x.id)))

        new_cur = cur
        for inc in candidates_sorted:
            if new_cur <= desired:
                break
            pts = _incident_goal_points(d, inc.meta)
            new_cur -= pts
            to_delete.append(inc)
            if _goal_incident_is_filled(inc):
                would_delete_filled.append(inc)

        return int(new_cur)

    new_home_after_del = plan_deletions(match.home_team_id, cur_home, desired_home)
    new_away_after_del = plan_deletions(match.away_team_id, cur_away, desired_away)

    if would_delete_filled and not force:
        return Response(
            {
                "detail": (
                    "Konflikt synchronizacji: Zmiana szybkiego wyniku wymaga usunięcia uzupełnionych incydentów "
                    "(zawodnik/czas). Użyj opcji \"Wymuś\", jeśli chcesz kontynuować."
                ),
                "code": "INCIDENTS_SYNC_WOULD_DELETE_FILLED",
                "would_delete": [i.id for i in would_delete_filled],
            },
            status=status.HTTP_409_CONFLICT,
        )


    # Usuń zaplanowane
    if to_delete:
        MatchIncident.objects.filter(id__in=[i.id for i in to_delete]).delete()

    # Po usunięciach policz ponownie (żeby poprawnie obsłużyć kosz 2/3 pkt)
    match.refresh_from_db(fields=["home_score", "away_score"])
    cur_home2 = _sum_goal_points_for_team(match, team_id=match.home_team_id)
    cur_away2 = _sum_goal_points_for_team(match, team_id=match.away_team_id)

    def create_placeholders(team_id: int, need_points: int) -> None:
        if need_points <= 0:
            return
        if d == Tournament.Discipline.BASKETBALL:
            chunks = _points_to_basketball_chunks(need_points)
            for pts in chunks:
                MatchIncident.objects.create(
                    match_id=match.id,
                    team_id=team_id,
                    kind="GOAL",
                    period="NONE",
                    time_source="MANUAL",
                    minute=None,
                    minute_raw=None,
                    player_id=None,
                    meta={"points": pts, "_score_delta": 0, "source": "FAST_SCORE"},
                    created_by_id=created_by_id,
                )
        else:
            for _ in range(int(need_points)):
                MatchIncident.objects.create(
                    match_id=match.id,
                    team_id=team_id,
                    kind="GOAL",
                    period="NONE",
                    time_source="MANUAL",
                    minute=None,
                    minute_raw=None,
                    player_id=None,
                    meta={"_score_delta": 0, "source": "FAST_SCORE"},
                    created_by_id=created_by_id,
                )

    need_home = int(desired_home) - int(cur_home2)
    need_away = int(desired_away) - int(cur_away2)
    if need_home > 0:
        create_placeholders(match.home_team_id, need_home)
    if need_away > 0:
        create_placeholders(match.away_team_id, need_away)

    return None







MANUAL_SCORE_CODE_WOULD_DELETE_REAL = "MANUAL_SCORE_WOULD_DELETE_REAL_GOALS"


def _incident_scope(match: Match, i: MatchIncident) -> str:
    """
    Określa bucket wyniku, do którego liczy się dany GOAL:
    - preferujemy meta.scope ("EXTRA_TIME")
    - fallback na period ET/ET1/ET2
    """
    m = i.meta if isinstance(getattr(i, "meta", None), dict) else {}
    s = str(m.get("scope") or "").strip().upper()
    if s == "EXTRA_TIME":
        return "EXTRA_TIME"

    p = str(getattr(i, "period", None) or "").strip().upper()
    if p in {"ET", "ET1", "ET2"}:
        return "EXTRA_TIME"

    return "REGULAR"


def _goal_incident_is_synthetic(i: MatchIncident) -> bool:
    """
    Syntetyczne = wygenerowane przez szybki/ręczny wynik (a nie realne zdarzenie live).
    """
    m = i.meta if isinstance(getattr(i, "meta", None), dict) else {}
    if m.get("synthetic") is True:
        return True
    src = str(m.get("source") or m.get("origin") or "").strip().upper()
    return src in {"FAST_SCORE", "MANUAL_SCORE"}


def _sum_goal_points_for_team_scoped(match: Match, *, team_id: int, scope: str) -> int:
    d = match.tournament.discipline
    if not team_id:
        return 0
    qs = (
        MatchIncident.objects
        .filter(match_id=match.id, kind="GOAL", team_id=team_id)
        .only("id", "team_id", "meta", "period")
    )
    total = 0
    want = str(scope or "REGULAR").upper()
    for i in qs:
        if _incident_scope(match, i) != want:
            continue
        total += _incident_goal_points(d, i.meta)
    return int(total)


def _clock_minute_payload(match: Match) -> Tuple[str, Optional[int], Optional[str]]:
    """
    Jeśli zegar działa (RUNNING), to syntetyczne incydenty dostają minutę z zegara.
    Zwraca: (time_source, minute, minute_raw)
    """
    state = str(getattr(match, "clock_state", "") or "")
    is_running = state == str(getattr(Match.ClockState, "RUNNING", "RUNNING"))
    if not is_running:
        return ("MANUAL", None, None)

    now = timezone.now()
    elapsed = int(getattr(match, "clock_elapsed_seconds", 0) or 0)
    started_at = getattr(match, "clock_started_at", None)
    if started_at:
        try:
            delta = int((now - started_at).total_seconds())
        except Exception:
            delta = 0
        if delta < 0:
            delta = 0
        elapsed += delta

    # cap (UI safety)
    if elapsed > _MAX_MATCH_SECONDS:
        elapsed = _MAX_MATCH_SECONDS
    if elapsed < 0:
        elapsed = 0

    minute = int(math.ceil(elapsed / 60.0)) if elapsed > 0 else 0
    return ("CLOCK", minute, str(minute))


def _default_period_for_scope(discipline: str, scope: str) -> str:
    if str(scope).upper() == "EXTRA_TIME":
        # dla czytelności w UI
        if discipline in (Tournament.Discipline.FOOTBALL, Tournament.Discipline.HANDBALL):
            return "ET1"
        return "ET"
    return "NONE"


def _apply_manual_result_via_goal_incidents_or_409(
    match: Match,
    *,
    force: bool,
    created_by_id: Optional[int] = None,
) -> Optional[Response]:
    """
    Ręczny "sztywny" wynik działa przez incydenty GOAL:
    - dodajemy brakujące GOAL jako syntetyczne (meta.synthetic/source=MANUAL_SCORE)
    - odejmujemy tylko syntetyczne (chyba że force==True)
    - jeżeli zegar RUNNING, syntetyczne dostają minute z zegara

    Obsługujemy dwa scope'y:
    - REGULAR => home_score/away_score
    - EXTRA_TIME => home_extra_time_score/away_extra_time_score (gdy went_to_extra_time)
    """
    t = match.tournament
    d = t.discipline

    if _is_tennis(t):
        return None
    if not _is_goal_based_or_basketball(d):
        return None
    if not match.home_team_id or not match.away_team_id:
        return None

    desired_regular_home = int(match.home_score or 0)
    desired_regular_away = int(match.away_score or 0)

    et_enabled = bool(getattr(match, "went_to_extra_time", False))
    desired_et_home = int(match.home_extra_time_score or 0) if et_enabled else 0
    desired_et_away = int(match.away_extra_time_score or 0) if et_enabled else 0

    # jeśli ktoś wpisał ET>0, dopnij toggle
    if (desired_et_home > 0 or desired_et_away > 0) and not et_enabled:
        match.went_to_extra_time = True
        et_enabled = True

    desired_map: Dict[Tuple[int, str], int] = {
        (match.home_team_id, "REGULAR"): desired_regular_home,
        (match.away_team_id, "REGULAR"): desired_regular_away,
        (match.home_team_id, "EXTRA_TIME"): desired_et_home if et_enabled else 0,
        (match.away_team_id, "EXTRA_TIME"): desired_et_away if et_enabled else 0,
    }

    qs = (
        MatchIncident.objects
        .filter(match_id=match.id, kind="GOAL")
        .only("id", "team_id", "meta", "period", "player_id", "minute", "minute_raw")
        .order_by("-id")
    )

    by_key: Dict[Tuple[int, str], List[MatchIncident]] = {
        (match.home_team_id, "REGULAR"): [],
        (match.away_team_id, "REGULAR"): [],
        (match.home_team_id, "EXTRA_TIME"): [],
        (match.away_team_id, "EXTRA_TIME"): [],
    }

    for i in qs:
        if i.team_id not in (match.home_team_id, match.away_team_id):
            continue
        scope = _incident_scope(match, i)
        key = (i.team_id, scope)
        if key in by_key:
            by_key[key].append(i)

    def current_points(key: Tuple[int, str]) -> int:
        total = 0
        for i in by_key.get(key, []):
            total += _incident_goal_points(d, i.meta)
        return int(total)

    to_delete: List[MatchIncident] = []
    would_delete_real: List[MatchIncident] = []

    def plan_deletions(key: Tuple[int, str], cur: int, desired: int) -> int:
        if cur <= desired:
            return cur

        candidates = by_key.get(key, [])
        # preferuj syntetyczne, potem "puste", potem najnowsze
        def _sort_k(inc: MatchIncident):
            synthetic = _goal_incident_is_synthetic(inc)
            filled = _goal_incident_is_filled(inc)
            return (0 if synthetic else 1, 0 if not filled else 1, -int(inc.id))

        candidates_sorted = sorted(candidates, key=_sort_k)

        new_cur = cur
        for inc in candidates_sorted:
            if new_cur <= desired:
                break
            pts = _incident_goal_points(d, inc.meta)
            new_cur -= pts
            to_delete.append(inc)
            if not _goal_incident_is_synthetic(inc):
                would_delete_real.append(inc)
        return int(new_cur)

    for key, desired in desired_map.items():
        cur = current_points(key)
        plan_deletions(key, cur, desired)

    if would_delete_real and not force:
        return Response(
            {
                "detail": (
                    "Konflikt: obniżenie wyniku wymaga usunięcia REALNYCH bramek/punktów (incydenty live). "
                    "Usuń je ręcznie z listy incydentów lub użyj opcji \"Wymuś\"."
                ),
                "code": MANUAL_SCORE_CODE_WOULD_DELETE_REAL,
                "would_delete": [i.id for i in would_delete_real],
            },
            status=status.HTTP_409_CONFLICT,
        )

    if to_delete:
        MatchIncident.objects.filter(id__in=[i.id for i in to_delete]).delete()

    # Po usunięciach policz ponownie i dodaj brakujące
    time_source, minute, minute_raw = _clock_minute_payload(match)

    def create_synthetic(team_id: int, scope: str, need_points: int) -> None:
        if need_points <= 0:
            return
        meta_base: Dict[str, Any] = {"synthetic": True, "source": "MANUAL_SCORE"}
        if str(scope).upper() == "EXTRA_TIME":
            meta_base["scope"] = "EXTRA_TIME"

        period = _default_period_for_scope(d, scope)

        if d == Tournament.Discipline.BASKETBALL:
            chunks = _points_to_basketball_chunks(need_points)
            for pts in chunks:
                meta = dict(meta_base)
                meta["points"] = pts
                MatchIncident.objects.create(
                    match_id=match.id,
                    team_id=team_id,
                    kind="GOAL",
                    period=period,
                    time_source=time_source,
                    minute=minute,
                    minute_raw=minute_raw,
                    player_id=None,
                    meta=meta,
                    created_by_id=created_by_id,
                )
        else:
            for _ in range(int(need_points)):
                MatchIncident.objects.create(
                    match_id=match.id,
                    team_id=team_id,
                    kind="GOAL",
                    period=period,
                    time_source=time_source,
                    minute=minute,
                    minute_raw=minute_raw,
                    player_id=None,
                    meta=dict(meta_base),
                    created_by_id=created_by_id,
                )

    # aktualne po delete
    cur_reg_home = _sum_goal_points_for_team_scoped(match, team_id=match.home_team_id, scope="REGULAR")
    cur_reg_away = _sum_goal_points_for_team_scoped(match, team_id=match.away_team_id, scope="REGULAR")
    cur_et_home = _sum_goal_points_for_team_scoped(match, team_id=match.home_team_id, scope="EXTRA_TIME")
    cur_et_away = _sum_goal_points_for_team_scoped(match, team_id=match.away_team_id, scope="EXTRA_TIME")

    create_synthetic(match.home_team_id, "REGULAR", desired_regular_home - cur_reg_home)
    create_synthetic(match.away_team_id, "REGULAR", desired_regular_away - cur_reg_away)

    if et_enabled:
        create_synthetic(match.home_team_id, "EXTRA_TIME", desired_et_home - cur_et_home)
        create_synthetic(match.away_team_id, "EXTRA_TIME", desired_et_away - cur_et_away)

    # Zapisz pola wynikowe jako cache z incydentów (spójność na przyszłość)
    # (po create musimy policzyć jeszcze raz)
    reg_home = _sum_goal_points_for_team_scoped(match, team_id=match.home_team_id, scope="REGULAR")
    reg_away = _sum_goal_points_for_team_scoped(match, team_id=match.away_team_id, scope="REGULAR")
    et_home = _sum_goal_points_for_team_scoped(match, team_id=match.home_team_id, scope="EXTRA_TIME")
    et_away = _sum_goal_points_for_team_scoped(match, team_id=match.away_team_id, scope="EXTRA_TIME")

    match.home_score = reg_home
    match.away_score = reg_away

    update_fields = ["home_score", "away_score", "went_to_extra_time"]

    if et_enabled:
        match.went_to_extra_time = True
        match.home_extra_time_score = et_home
        match.away_extra_time_score = et_away
        update_fields += ["home_extra_time_score", "away_extra_time_score"]
    else:
        # gdy ET wyłączone, czyścimy cache ET
        match.home_extra_time_score = None
        match.away_extra_time_score = None
        update_fields += ["home_extra_time_score", "away_extra_time_score"]

    match.save(update_fields=update_fields)

    return None


# =========================
# Match clock helpers
# =========================

_MAX_MATCH_SECONDS = 3 * 60 * 60  # 3h hard limit (UI safety)

def _stop_match_clock(match: Match) -> None:
    """Stops the match clock and persists the accumulated elapsed seconds (capped)."""
    now = timezone.now()
    elapsed = int(getattr(match, "clock_elapsed_seconds", 0) or 0)

    started_at = getattr(match, "clock_started_at", None)
    if started_at:
        try:
            delta = int((now - started_at).total_seconds())
        except Exception:
            delta = 0
        if delta < 0:
            delta = 0
        elapsed += delta

    if elapsed > _MAX_MATCH_SECONDS:
        elapsed = _MAX_MATCH_SECONDS

    match.clock_elapsed_seconds = elapsed
    match.clock_started_at = None
    match.clock_state = Match.ClockState.STOPPED


def _continue_match_clock(match: Match) -> None:
    """Resumes the match clock from the current elapsed seconds."""
    now = timezone.now()
    if int(getattr(match, "clock_elapsed_seconds", 0) or 0) >= _MAX_MATCH_SECONDS:
        # do not resume beyond limit
        match.clock_state = Match.ClockState.STOPPED
        match.clock_started_at = None
        return

    match.clock_state = Match.ClockState.RUNNING
    match.clock_started_at = now


# ============================================================
# Views
# ============================================================

class TournamentMatchListView(ListAPIView):
    """
    Lista meczów dla panelu (organizator/asystent).
    NOWA STRATEGIA: asystent ma podgląd także w ORGANIZER_ONLY.
    """
    serializer_class = MatchSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        tournament = get_object_or_404(Tournament, pk=self.kwargs["pk"])

        user = self.request.user
        is_panel_user = (tournament.organizer_id == user.id) or user_is_assistant(user, tournament)
        if not is_panel_user:
            return Match.objects.none()

        return (
            Match.objects.filter(tournament=tournament)
            .select_related("home_team", "away_team", "stage")
            .order_by("stage__order", "round_number", "id")
        )


class TournamentPublicMatchListView(ListAPIView):
    """
    Publiczna lista meczów dla widza.
    """
    serializer_class = MatchSerializer
    permission_classes = [AllowAny]

    def get_queryset(self):
        tournament = get_object_or_404(Tournament, pk=self.kwargs["pk"])
        denied = public_access_or_403(self.request, tournament)
        if denied is not None:
            return Match.objects.none()

        return (
            Match.objects.filter(tournament=tournament)
            .select_related("home_team", "away_team", "stage")
            .order_by("stage__order", "round_number", "id")
        )

    def list(self, request, *args, **kwargs):
        tournament = get_object_or_404(Tournament, pk=self.kwargs["pk"])
        denied = public_access_or_403(request, tournament)
        if denied is not None:
            return denied
        return super().list(request, *args, **kwargs)


class MatchScheduleUpdateView(RetrieveUpdateAPIView):
    """
    PATCH /api/matches/<id>/
    Edycja harmonogramu – granularnie (schedule_edit).
    """
    queryset = Match.objects.all()
    serializer_class = MatchSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        return Match.objects.filter(
            Q(tournament__organizer=user) | Q(tournament__memberships__user=user)
        ).distinct()

    def update(self, request, *args, **kwargs):
        match = self.get_object()
        tournament = match.tournament

        if not can_edit_schedule(request.user, tournament):
            return Response(
                {"detail": "Nie masz uprawnień do edycji harmonogramu. Dostępny jest tylko podgląd."},
                status=status.HTTP_403_FORBIDDEN,
            )

        allowed_fields = {"scheduled_date", "scheduled_time", "location"}
        data = {k: v for k, v in request.data.items() if k in allowed_fields}

        serializer = self.get_serializer(match, data=data, partial=True)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)

        return Response(serializer.data, status=status.HTTP_200_OK)


class MatchResultUpdateView(RetrieveUpdateAPIView):
    """
    PATCH /api/matches/<pk>/result/
    Edycja wyników – granularnie (results_edit).
    """
    serializer_class = MatchResultUpdateSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        return (
            Match.objects.filter(
                Q(tournament__organizer=user) | Q(tournament__memberships__user=user)
            )
            .select_related("stage", "tournament")
            .distinct()
        )

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        # zablokuj rekord meczu na czas update
        match = self.get_object()
        match = (
            Match.objects
            .select_related("stage", "tournament")
            .select_for_update()
            .get(pk=match.pk)
        )

        tournament = match.tournament

        if not can_edit_results(request.user, tournament):
            return Response(
                {"detail": "Nie masz uprawnień do edycji wyników. Dostępny jest tylko podgląd."},
                status=status.HTTP_403_FORBIDDEN,
            )

        stage = match.stage

        old_single_winner_id = match.winner_id
        cup_matches = _get_cup_matches(tournament)
        is_knockout_like = stage.stage_type == Stage.StageType.KNOCKOUT or _is_third_place_stage(stage)

        if is_knockout_like and _is_tennis(tournament) and cup_matches == 2:
            return Response(
                {"detail": "Tenis nie wspiera trybu dwumeczu (cup_matches=2)."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        old_pair_winner = None
        if is_knockout_like and cup_matches == 2:
            old_pair_winner = _pair_winner_id(_get_pair_matches(stage, match))

        serializer = self.get_serializer(match, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)

        force = str(request.query_params.get("force") or "").strip().lower() in {"1", "true", "yes"}

        match = serializer.save()

        # Szybki wynik jest źródłem prawdy: dopasuj incydenty GOAL do wyniku.
        resp = _apply_manual_result_via_goal_incidents_or_409(match, force=force, created_by_id=request.user.id)
        if resp is not None:
            return resp

        if stage.stage_type in (Stage.StageType.LEAGUE, Stage.StageType.GROUP):
            try:
                MatchResultService.apply_result(match)
            except Exception:
                pass

            try:
                _regenerate_knockout_from_groups_if_safe(tournament)
            except Exception:
                pass

            return Response(MatchSerializer(match).data, status=status.HTTP_200_OK)

        if is_knockout_like:
            if cup_matches == 1:
                if _is_tennis(tournament):
                    new_winner_id = _tennis_winner_id_from_sets(match)
                else:
                    new_winner_id = knockout_winner_id(match)

                if new_winner_id != match.winner_id:
                    match.winner_id = new_winner_id
                    match.save(update_fields=["winner"])

                _handle_knockout_progression(tournament, stage, old_single_winner_id, new_winner_id)

            elif cup_matches == 2:
                _sync_two_leg_pair_winner_if_possible(stage, tournament, match)
                new_pair_winner = _pair_winner_id(_get_pair_matches(stage, match))
                _handle_knockout_progression(tournament, stage, old_pair_winner, new_pair_winner)

        return Response(MatchSerializer(match).data, status=status.HTTP_200_OK)


class FinishMatchView(APIView):
    """
    POST /api/matches/<pk>/finish/
    Finish – także traktujemy jako edycję wyników (results_edit).
    """
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, *args, **kwargs):
        match_id = kwargs.get("pk") or kwargs.get("id")
        if not match_id:
            return Response({"detail": "Brak identyfikatora meczu."}, status=status.HTTP_400_BAD_REQUEST)

        match = get_object_or_404(
            Match.objects.select_related("stage", "tournament", "home_team", "away_team").select_for_update(),
            pk=match_id,
        )
        tournament = match.tournament
        stage = match.stage

        if not can_edit_results(request.user, tournament):
            return Response(
                {"detail": "Nie masz uprawnień do zatwierdzania wyników. Dostępny jest tylko podgląd."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Szybki wynik jest źródłem prawdy: przy zakończeniu też domykamy sync do incydentów.
        force = str(request.query_params.get("force") or "").strip().lower() in {"1", "true", "yes"}
        resp = _apply_manual_result_via_goal_incidents_or_409(match, force=force, created_by_id=request.user.id)
        if resp is not None:
            return resp

        cfg = tournament.format_config or {}

        if stage.stage_type in (Stage.StageType.LEAGUE, Stage.StageType.GROUP):
            if _is_tennis(tournament):
                err2 = _validate_tennis_match_before_finish(match, cfg)
                if err2:
                    return Response({"detail": err2}, status=status.HTTP_400_BAD_REQUEST)

            try:
                MatchResultService.apply_result(match)
            except Exception:
                pass

            match.status = Match.Status.FINISHED
            _stop_match_clock(match)
            match.save(update_fields=["status", "clock_state", "clock_started_at", "clock_elapsed_seconds"])

            try:
                _regenerate_knockout_from_groups_if_safe(tournament)
            except Exception:
                pass

            return Response({"detail": "Mecz zakończony."}, status=status.HTTP_200_OK)

        cup_matches = _get_cup_matches(tournament)
        is_knockout_like = stage.stage_type == Stage.StageType.KNOCKOUT or _is_third_place_stage(stage)

        if is_knockout_like:
            if not match.result_entered:
                return Response(
                    {"detail": "Nie można zakończyć meczu KO bez wprowadzenia wyniku."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if _is_tennis(tournament):
                if cup_matches == 2:
                    return Response(
                        {"detail": "Tenis nie wspiera trybu dwumeczu (cup_matches=2)."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                err3 = _validate_tennis_match_before_finish(match, cfg)
                if err3:
                    return Response({"detail": err3}, status=status.HTTP_400_BAD_REQUEST)

            if match.home_score is None or match.away_score is None:
                return Response(
                    {"detail": "Brak kompletnego wyniku — uzupełnij bramki/punkty."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if cup_matches == 1:
                err4 = validate_extra_time_consistency(match) or validate_penalties_consistency(match)
                if err4 and not _is_tennis(tournament):
                    return Response({"detail": err4}, status=status.HTTP_400_BAD_REQUEST)

                winner_id = _tennis_winner_id_from_sets(match) if _is_tennis(tournament) else knockout_winner_id(match)

                if winner_id is None:
                    return Response(
                        {"detail": "Mecz pucharowy musi mieć zwycięzcę."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                old_winner_id = match.winner_id
                match.winner_id = winner_id
                match.status = Match.Status.FINISHED
                _stop_match_clock(match)
                match.save(update_fields=["winner", "status", "clock_state", "clock_started_at", "clock_elapsed_seconds"])

                _handle_knockout_progression(tournament, stage, old_winner_id, winner_id)
                return Response({"detail": "Mecz zakończony."}, status=status.HTTP_200_OK)

            elif cup_matches == 2:
                old_pair_winner = _pair_winner_id(_get_pair_matches(stage, match))

                if match.status != Match.Status.FINISHED:
                    match.status = Match.Status.FINISHED
                    _stop_match_clock(match)
                    match.save(update_fields=["status", "clock_state", "clock_started_at", "clock_elapsed_seconds"])

                _sync_two_leg_pair_winner_if_possible(stage, tournament, match)

                group = _get_pair_matches(stage, match)
                if _pair_is_complete_two_leg(group):
                    new_pair_winner = _pair_winner_id(group)
                    if not new_pair_winner:
                        match.status = Match.Status.SCHEDULED
                        match.save(update_fields=["status"])
                        return Response(
                            {"detail": "Dwumecz musi być rozstrzygnięty."},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                else:
                    new_pair_winner = None

                _handle_knockout_progression(tournament, stage, old_pair_winner, new_pair_winner)
                return Response({"detail": "Mecz zakończony."}, status=status.HTTP_200_OK)

        return Response({"detail": "Nieobsługiwany typ etapu."}, status=status.HTTP_400_BAD_REQUEST)



class ContinueMatchView(APIView):
    """
    POST /api/matches/<pk>/continue/
    Cofnięcie meczu z Zakończony -> W trakcie + wznowienie zegara od miejsca zatrzymania.
    """
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, *args, **kwargs):
        match_id = kwargs.get("pk") or kwargs.get("id")
        if not match_id:
            return Response({"detail": "Brak identyfikatora meczu."}, status=status.HTTP_400_BAD_REQUEST)

        match = get_object_or_404(
            Match.objects.select_related("stage", "tournament", "home_team", "away_team").select_for_update(),
            pk=match_id,
        )
        tournament = match.tournament

        if not can_edit_results(request.user, tournament):
            return Response(
                {"detail": "Nie masz uprawnień do kontynuowania meczu. Dostępny jest tylko podgląd."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Dozwolone tylko z FINISHED -> IN_PROGRESS
        if match.status != Match.Status.FINISHED:
            return Response(
                {"detail": "Mecz nie jest zakończony — nie ma czego kontynuować."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        match.status = Match.Status.IN_PROGRESS
        _continue_match_clock(match)

        match.save(update_fields=["status", "clock_state", "clock_started_at"])

        return Response(MatchSerializer(match).data, status=status.HTTP_200_OK)
