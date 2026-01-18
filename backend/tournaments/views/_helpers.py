# backend/tournaments/views/_helpers.py
from __future__ import annotations

from typing import Optional, Tuple, Any, Dict, Set

from django.db.models import Q
from rest_framework import status
from rest_framework.response import Response

from tournaments.services.generators.knockout import generate_next_knockout_stage
from tournaments.services.match_outcome import team_goals_in_match, penalty_winner_id

from ..models import Match, Stage, Team, Tournament, TournamentMembership, TournamentRegistration


# ============================================================
# UPRAWNIENIA (NOWY SYSTEM)
# ============================================================

# Klucze, które MUSZĄ być ustawione jawnie w raw permissions (bez żadnych fallbacków).
STRICT_EXPLICIT_KEYS: Set[str] = {
    TournamentMembership.PERM_ROSTER_EDIT,
    TournamentMembership.PERM_NAME_CHANGE_APPROVE,
}

# Klucze, które istnieją w "panelu uprawnień" (front potrzebuje ich zawsze w odpowiedzi).
PERMISSIONS_RESPONSE_KEYS: list[str] = [
    TournamentMembership.PERM_TEAMS_EDIT,
    TournamentMembership.PERM_SCHEDULE_EDIT,
    TournamentMembership.PERM_RESULTS_EDIT,
    TournamentMembership.PERM_BRACKET_EDIT,
    TournamentMembership.PERM_TOURNAMENT_EDIT,

    # nowe (bez fallbacków)
    TournamentMembership.PERM_ROSTER_EDIT,
    TournamentMembership.PERM_NAME_CHANGE_APPROVE,

    # organizer-only
    TournamentMembership.PERM_PUBLISH,
    TournamentMembership.PERM_ARCHIVE,
    TournamentMembership.PERM_MANAGE_ASSISTANTS,
    TournamentMembership.PERM_JOIN_SETTINGS,
]


def _normalize_args(user_or_tournament: Any, tournament_or_user: Any) -> tuple[Any, Tournament]:
    """
    Ujednolica stare/nowe wywołania:
    - user_can_manage_tournament(user, tournament)
    - user_can_manage_tournament(tournament, user)
    """
    if isinstance(user_or_tournament, Tournament):
        tournament = user_or_tournament
        user = tournament_or_user
    else:
        user = user_or_tournament
        tournament = tournament_or_user
    return user, tournament


def get_membership(user, tournament: Tournament) -> Optional[TournamentMembership]:
    if not user or not getattr(user, "is_authenticated", False):
        return None
    return TournamentMembership.objects.filter(
        tournament=tournament,
        user=user,
        role=TournamentMembership.Role.ASSISTANT,
    ).first()


def user_is_assistant(user, tournament: Tournament) -> bool:
    return get_membership(user, tournament) is not None


def user_is_registered_participant(user, tournament: Tournament) -> bool:
    if not user or not getattr(user, "is_authenticated", False):
        return False
    return TournamentRegistration.objects.filter(tournament=tournament, user=user).exists()


def participant_can_view_public_preview(tournament: Tournament) -> bool:
    """
    Uczestnik (TournamentRegistration) może oglądać TournamentPublic:
    - zawsze, gdy turniej jest opublikowany
    - albo gdy organizer włączy participants_public_preview_enabled
    """
    return bool(
        getattr(tournament, "is_published", False)
        or getattr(tournament, "participants_public_preview_enabled", False)
    )


def user_can_view_tournament(user, tournament: Tournament) -> bool:
    """
    Widoczność (podgląd) dla endpointów "panelowych" / autoryzowanych.

    Zasady:
    - organizator: tak
    - asystent: tak
    - uczestnik: tak, ale tylko gdy ma prawo do publicznego podglądu (publikacja lub preview enabled)
      (żeby nie obchodził blokady TournamentPublic przez inne endpointy jak teams/matches).
    """
    if not user or not getattr(user, "is_authenticated", False):
        return False

    if tournament.organizer_id == user.id:
        return True

    if user_is_assistant(user, tournament):
        return True

    if user_is_registered_participant(user, tournament):
        return participant_can_view_public_preview(tournament)

    return False


def _apply_strict_keys_from_raw(perms: Dict[str, Any], raw: Dict[str, Any]) -> Dict[str, Any]:
    """
    Wymusza politykę "bez fallbacków" dla STRICT_EXPLICIT_KEYS:
    - jeśli w raw nie ma klucza -> False
    - jeśli jest -> bool(raw[key])
    """
    for k in STRICT_EXPLICIT_KEYS:
        perms[k] = bool(raw.get(k, False))
    return perms


def get_my_permissions(user, tournament: Tournament) -> Dict[str, bool]:
    """
    Zwraca uprawnienia dla frontu:
    - organizator: wszystko True (w tym organizer-only)
    - asystent: effective_permissions(), ALE:
        * w ORGANIZER_ONLY wszystkie akcje edycyjne są blokowane
        * STRICT_EXPLICIT_KEYS (roster/name_change_approve) bierzemy WYŁĄCZNIE z raw permissions (bez fallbacków)
    - inni: wszystko False
    """
    # Organizer
    if user and getattr(user, "is_authenticated", False) and tournament.organizer_id == user.id:
        return {k: True for k in PERMISSIONS_RESPONSE_KEYS}

    # Brak membership -> wszystko False
    m = get_membership(user, tournament)
    if not m:
        return {k: False for k in PERMISSIONS_RESPONSE_KEYS}

    # ORGANIZER_ONLY: asystent ma podgląd, ale żadnej edycji
    if tournament.entry_mode == Tournament.EntryMode.ORGANIZER_ONLY:
        return {k: False for k in PERMISSIONS_RESPONSE_KEYS}

    # Asystent w MANAGER
    perms: Dict[str, Any] = dict(m.effective_permissions() or {})
    raw: Dict[str, Any] = dict(m.permissions or {})

    # organizer-only zawsze false dla asystenta
    perms[TournamentMembership.PERM_PUBLISH] = False
    perms[TournamentMembership.PERM_ARCHIVE] = False
    perms[TournamentMembership.PERM_MANAGE_ASSISTANTS] = False
    perms[TournamentMembership.PERM_JOIN_SETTINGS] = False

    # nowe klucze: bez fallbacków
    perms = _apply_strict_keys_from_raw(perms, raw)

    # normalizacja: zawsze zwracamy komplet kluczy jako bool
    out: Dict[str, bool] = {}
    for k in PERMISSIONS_RESPONSE_KEYS:
        out[k] = bool(perms.get(k, False))
    return out


def assistant_has_perm(user, tournament: Tournament, perm_key: str) -> bool:
    """
    Sprawdza uprawnienie asystenta do KONKRETNEJ AKCJI.
    - organizator: zawsze True
    - asystent: tylko w MANAGER i tylko jeśli ma perm_key==True
    - w ORGANIZER_ONLY: zawsze False dla edycji (podgląd zostaje w innych endpointach)
    - STRICT_EXPLICIT_KEYS: sprawdzamy WYŁĄCZNIE w raw permissions (bez fallbacków)
    """
    if not user or not getattr(user, "is_authenticated", False):
        return False

    if tournament.organizer_id == user.id:
        return True

    m = get_membership(user, tournament)
    if not m:
        return False

    if tournament.entry_mode != Tournament.EntryMode.MANAGER:
        return False

    # nowe klucze: bez fallbacków
    if perm_key in STRICT_EXPLICIT_KEYS:
        raw = m.permissions or {}
        return bool(raw.get(perm_key, False))

    # pozostałe: z effective_permissions (bo mogą mieć domyślne bazowe zależne od entry_mode)
    perms = m.effective_permissions() or {}
    return bool(perms.get(perm_key, False))


def user_can_manage_tournament(user_or_tournament, tournament_or_user) -> bool:
    """
    Legacy: "czy może edytować" (MANAGER + membership).
    Zostawione jako legacy, ale NIE używamy już do nowych akcji.
    """
    user, tournament = _normalize_args(user_or_tournament, tournament_or_user)

    if not user or not getattr(user, "is_authenticated", False):
        return False

    if tournament.organizer_id == user.id:
        return True

    if tournament.entry_mode != Tournament.EntryMode.MANAGER:
        return False

    return TournamentMembership.objects.filter(
        tournament=tournament,
        user=user,
        role=TournamentMembership.Role.ASSISTANT,
    ).exists()


def can_edit_teams(user, tournament: Tournament) -> bool:
    return assistant_has_perm(user, tournament, TournamentMembership.PERM_TEAMS_EDIT)


def can_edit_schedule(user, tournament: Tournament) -> bool:
    return assistant_has_perm(user, tournament, TournamentMembership.PERM_SCHEDULE_EDIT)


def can_edit_results(user, tournament: Tournament) -> bool:
    return assistant_has_perm(user, tournament, TournamentMembership.PERM_RESULTS_EDIT)


def can_edit_bracket(user, tournament: Tournament) -> bool:
    return assistant_has_perm(user, tournament, TournamentMembership.PERM_BRACKET_EDIT)


def can_edit_tournament_detail(user, tournament: Tournament) -> bool:
    return assistant_has_perm(user, tournament, TournamentMembership.PERM_TOURNAMENT_EDIT)


# NOWE (bez fallbacków)
def can_edit_roster(user, tournament: Tournament) -> bool:
    """
    Edycja składów (zawodników) – niezależne od teams_edit.
    """
    return assistant_has_perm(user, tournament, TournamentMembership.PERM_ROSTER_EDIT)


def can_approve_name_changes(user, tournament: Tournament) -> bool:
    """
    Akceptacja/odrzucenie próśb o zmianę nazwy – niezależne od teams_edit.
    """
    return assistant_has_perm(user, tournament, TournamentMembership.PERM_NAME_CHANGE_APPROVE)


def can_manage_assistants(user, tournament: Tournament) -> bool:
    return bool(user and getattr(user, "is_authenticated", False) and tournament.organizer_id == user.id)


def can_manage_join_settings(user, tournament: Tournament) -> bool:
    return bool(user and getattr(user, "is_authenticated", False) and tournament.organizer_id == user.id)


# ============================================================
# DOSTĘP DO TOURNAMENT PUBLIC (WSPÓLNY HELPER)
# ============================================================

def public_access_or_403(request, tournament: Tournament) -> Optional[Response]:
    """
    Polityka dostępu dla "publicznych" zasobów (TournamentPublic: detail/matches/standings).

    - organizer/asystent -> OK zawsze (zalogowany)
    - uczestnik (TournamentRegistration) -> OK tylko, gdy:
        * turniej jest opublikowany, LUB
        * participants_public_preview_enabled == True
    - public (anonim / brak uprawnień):
        * wymaga is_published == True
        * jeśli access_code ustawione -> wymagamy ?code=...
    """
    user = getattr(request, "user", None)

    if user and getattr(user, "is_authenticated", False):
        if tournament.organizer_id == user.id:
            return None
        if user_is_assistant(user, tournament):
            return None

        if TournamentRegistration.objects.filter(tournament=tournament, user=user).exists():
            if participant_can_view_public_preview(tournament):
                return None
            return Response(
                {"detail": "Podgląd dla uczestników jest wyłączony. Poczekaj na publikację turnieju."},
                status=status.HTTP_403_FORBIDDEN,
            )

    if not getattr(tournament, "is_published", False):
        return Response({"detail": "Turniej nie jest dostępny."}, status=status.HTTP_403_FORBIDDEN)

    access_code = getattr(tournament, "access_code", None)
    if access_code:
        if request.query_params.get("code") != access_code:
            return Response({"detail": "Wymagany poprawny kod dostępu."}, status=status.HTTP_403_FORBIDDEN)

    return None


# ============================================================
# KO (KONFIG + KLUCZE PAR)
# ============================================================

def _get_cup_matches(tournament: Tournament) -> int:
    cfg = tournament.format_config or {}
    raw = cfg.get("cup_matches", 1)
    try:
        n = int(raw)
    except (TypeError, ValueError):
        n = 1
    return n if n in (1, 2) else 1


def _pair_key_ids(home_id: int, away_id: int) -> Tuple[int, int]:
    return (home_id, away_id) if home_id < away_id else (away_id, home_id)


def _sync_two_leg_pair_winner_if_possible(stage: Stage, tournament: Tournament, match: Match) -> None:
    if _get_cup_matches(tournament) != 2:
        return

    key = _pair_key_ids(match.home_team_id, match.away_team_id)

    group = list(
        Match.objects.filter(stage=stage).only(
            "id",
            "status",
            "winner_id",
            "home_team_id",
            "away_team_id",
            "home_score",
            "away_score",
            "went_to_extra_time",
            "home_extra_time_score",
            "away_extra_time_score",
            "decided_by_penalties",
            "home_penalty_score",
            "away_penalty_score",
        )
    )
    group = [m for m in group if _pair_key_ids(m.home_team_id, m.away_team_id) == key]

    if len(group) != 2:
        return
    if any(m.status != Match.Status.FINISHED for m in group):
        return

    team_ids = list({group[0].home_team_id, group[0].away_team_id})
    if len(team_ids) != 2:
        return

    t1, t2 = team_ids[0], team_ids[1]

    g1 = sum(team_goals_in_match(m, t1) for m in group)
    g2 = sum(team_goals_in_match(m, t2) for m in group)

    ids = [group[0].id, group[1].id]

    if g1 != g2:
        winner_id = t1 if g1 > g2 else t2
        Match.objects.filter(id__in=ids).update(winner_id=winner_id)
        return

    second_leg = max(group, key=lambda m: m.id)
    pw = penalty_winner_id(second_leg)

    if pw is not None:
        Match.objects.filter(id__in=ids).update(winner_id=pw)
        return

    Match.objects.filter(id__in=ids).update(winner=None)


def _knockout_downstream_stages(tournament: Tournament, after_order: int):
    return Stage.objects.filter(
        tournament=tournament,
        stage_type=Stage.StageType.KNOCKOUT,
        order__gt=after_order,
    ).order_by("order")


def _knockout_downstream_has_results(tournament: Tournament, after_order: int) -> bool:
    qs = Match.objects.filter(
        tournament=tournament,
        stage__stage_type=Stage.StageType.KNOCKOUT,
        stage__order__gt=after_order,
    )
    return qs.filter(
        Q(status=Match.Status.FINISHED)
        | Q(result_entered=True)
        | Q(winner__isnull=False)
    ).exists()


def _soft_reset_downstream_for_team_change(
    *,
    tournament: Tournament,
    after_order: int,
    old_team_id: int,
    new_team: Team,
) -> None:
    downstream_matches = (
        Match.objects.filter(
            tournament=tournament,
            stage__order__gt=after_order,
            stage__stage_type__in=[Stage.StageType.KNOCKOUT, Stage.StageType.THIRD_PLACE],
        )
        .select_related("stage")
    )

    to_update = []
    for m in downstream_matches:
        changed = False

        if m.home_team_id == old_team_id:
            m.home_team = new_team
            changed = True
        if m.away_team_id == old_team_id:
            m.away_team = new_team
            changed = True

        if not changed:
            continue

        if m.home_team_id == m.away_team_id:
            raise ValueError("Kolizja w KO: po podmianie drużyn mecz stał się home==away.")

        m.home_score = 0
        m.away_score = 0
        m.winner = None
        m.status = Match.Status.SCHEDULED
        m.result_entered = False

        m.tennis_sets = None
        m.went_to_extra_time = False
        m.home_extra_time_score = None
        m.away_extra_time_score = None
        m.decided_by_penalties = False
        m.home_penalty_score = None
        m.away_penalty_score = None

        to_update.append(m)

    if to_update:
        Match.objects.bulk_update(
            to_update,
            [
                "home_team",
                "away_team",
                "home_score",
                "away_score",
                "winner",
                "status",
                "result_entered",
                "tennis_sets",
                "went_to_extra_time",
                "home_extra_time_score",
                "away_extra_time_score",
                "decided_by_penalties",
                "home_penalty_score",
                "away_penalty_score",
            ],
        )

    Stage.objects.filter(
        tournament=tournament,
        order__gt=after_order,
        stage_type__in=[Stage.StageType.KNOCKOUT, Stage.StageType.THIRD_PLACE],
    ).exclude(status=Stage.Status.OPEN).update(status=Stage.Status.OPEN)

    if tournament.status == Tournament.Status.FINISHED:
        tournament.status = Tournament.Status.CONFIGURED
        tournament.save(update_fields=["status"])


def rollback_knockout_after_stage(stage: Stage) -> int:
    tournament = stage.tournament
    downstream_stages = _knockout_downstream_stages(tournament, stage.order)

    if not downstream_stages.exists():
        return 0

    Match.objects.filter(stage__in=downstream_stages).delete()
    deleted_count = downstream_stages.count()
    downstream_stages.delete()

    if tournament.status == Tournament.Status.FINISHED:
        tournament.status = Tournament.Status.CONFIGURED
        tournament.save(update_fields=["status"])

    return deleted_count


def handle_knockout_winner_change(
    *,
    tournament: Tournament,
    stage: Stage,
    old_winner_id: Optional[int],
    new_winner_id: Optional[int],
) -> None:
    if stage.stage_type != Stage.StageType.KNOCKOUT:
        return

    if old_winner_id == new_winner_id:
        return

    if not _knockout_downstream_stages(tournament, stage.order).exists():
        return

    if new_winner_id is None:
        rollback_knockout_after_stage(stage)
        return

    if _knockout_downstream_has_results(tournament, stage.order):
        rollback_knockout_after_stage(stage)
        return

    new_team = Team.objects.filter(pk=new_winner_id).first()
    if not new_team:
        rollback_knockout_after_stage(stage)
        return

    try:
        _soft_reset_downstream_for_team_change(
            tournament=tournament,
            after_order=stage.order,
            old_team_id=old_winner_id or 0,
            new_team=new_team,
        )
    except ValueError:
        rollback_knockout_after_stage(stage)


def _try_auto_advance_knockout(stage: Stage) -> None:
    tournament = stage.tournament

    if _knockout_downstream_stages(tournament, stage.order).exists():
        return

    matches = list(stage.matches.all())
    if not matches:
        return

    if any(m.status != Match.Status.FINISHED or not m.winner_id for m in matches):
        return

    if stage.status != Stage.Status.OPEN:
        stage.status = Stage.Status.OPEN
        stage.save(update_fields=["status"])

    try:
        generate_next_knockout_stage(stage)
    except ValueError:
        return
