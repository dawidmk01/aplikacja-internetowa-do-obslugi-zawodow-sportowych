from __future__ import annotations

from typing import Optional, Tuple

from django.db.models import Q

from tournaments.services.generators.knockout import generate_next_knockout_stage

from ..models import Match, Stage, Team, Tournament, TournamentMembership


# ============================================================
# UPRAWNIENIA
# ============================================================

def user_can_manage_tournament(user, tournament: Tournament) -> bool:
    if not user or not user.is_authenticated:
        return False

    if tournament.organizer_id == user.id:
        return True

    return tournament.memberships.filter(
        user=user,
        role=TournamentMembership.Role.ASSISTANT,
    ).exists()


# ============================================================
# KO (KONFIG + KLUCZE PAR)
# ============================================================

def _get_cup_matches(tournament: Tournament) -> int:
    """
    Liczba meczów na parę w KO.
    Wspierane: 1 lub 2. Inne wartości -> 1.
    """
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
    """
    Dla cup_matches=2:
    - jeśli para ma 2 mecze i oba są FINISHED, liczymy agregat bramek,
    - jeśli agregat rozstrzyga -> ustawiamy winner na OBU meczach pary,
    - jeśli agregat remisowy -> czyścimy winner na OBU meczach.
    """
    if _get_cup_matches(tournament) != 2:
        return

    key = _pair_key_ids(match.home_team_id, match.away_team_id)

    group = list(
        Match.objects.filter(stage=stage)
        .only("id", "status", "winner_id", "home_team_id", "away_team_id", "home_score", "away_score")
    )
    group = [m for m in group if _pair_key_ids(m.home_team_id, m.away_team_id) == key]

    # BYE/walkower ma zwykle tylko 1 mecz — nie liczymy agregatu.
    if len(group) == 1:
        return

    if len(group) != 2:
        return

    if any(m.status != Match.Status.FINISHED for m in group):
        return

    goals: dict[int, int] = {}
    for m in group:
        hs = int(m.home_score or 0)
        a_s = int(m.away_score or 0)
        goals[m.home_team_id] = goals.get(m.home_team_id, 0) + hs
        goals[m.away_team_id] = goals.get(m.away_team_id, 0) + a_s

    team_ids = list({group[0].home_team_id, group[0].away_team_id})
    if len(team_ids) != 2:
        return

    t1, t2 = team_ids[0], team_ids[1]
    g1, g2 = goals.get(t1, 0), goals.get(t2, 0)

    ids = [group[0].id, group[1].id]

    if g1 == g2:
        Match.objects.filter(id__in=ids).update(winner=None)
        return

    winner_id = t1 if g1 > g2 else t2
    Match.objects.filter(id__in=ids).update(winner_id=winner_id)


# ============================================================
# KO (ROLLBACK / PROPAGACJA)
# ============================================================

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
        | Q(home_score__isnull=False)
        | Q(away_score__isnull=False)
        | Q(winner__isnull=False)
    ).exists()


def _soft_propagate_knockout_winner_change(
    tournament: Tournament,
    after_order: int,
    old_team_id: Optional[int],
    new_team: Optional[Team],
) -> None:
    if not old_team_id:
        return
    if new_team is None:
        return

    downstream_matches = Match.objects.filter(
        tournament=tournament,
        stage__stage_type=Stage.StageType.KNOCKOUT,
        stage__order__gt=after_order,
    ).select_related("stage")

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

        m.home_score = None
        m.away_score = None
        m.winner = None
        m.status = Match.Status.SCHEDULED

        to_update.append(m)

    if to_update:
        Match.objects.bulk_update(
            to_update,
            ["home_team", "away_team", "home_score", "away_score", "winner", "status"],
        )

    Stage.objects.filter(
        tournament=tournament,
        stage_type=Stage.StageType.KNOCKOUT,
        order__gt=after_order,
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


def _try_auto_advance_knockout(stage: Stage) -> None:
    """
    Auto-progres KO:
    - jeśli etap KO ma komplet rozstrzygniętych meczów (FINISHED + winner),
      i nie ma jeszcze następnego etapu KO,
      generujemy kolejny etap.

    Ważne: generator może rzucić ValueError (np. niespójni zwycięzcy w dwumeczu).
    To NIE może robić 500.
    """
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
