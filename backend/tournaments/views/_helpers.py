from __future__ import annotations

from typing import Optional, Tuple

from django.db.models import Q

from tournaments.services.generators.knockout import generate_next_knockout_stage
from tournaments.services.match_outcome import team_goals_in_match, penalty_winner_id

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
    Dla cup_matches=2 (dwumecz):
    - jeśli para ma 2 mecze i oba są FINISHED, liczymy agregat bramek,
      gdzie bramki = (wynik regulaminowy + dogrywka), karne NIE wchodzą do agregatu.
    - jeśli agregat rozstrzyga -> ustawiamy winner na OBU meczach pary,
    - jeśli agregat remisowy -> próbujemy rozstrzygnąć karnymi w REWANŻU,
    - jeśli nadal brak rozstrzygnięcia -> czyścimy winner na OBU meczach.
    """
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

    # BYE/walkower może mieć 1 mecz — nie liczymy dwumeczu.
    if len(group) == 1:
        return

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


# ============================================================
# KO (ROLLBACK / PROPAGACJA / SOFT RESET)
# ============================================================

def _knockout_downstream_stages(tournament: Tournament, after_order: int):
    """
    Zwraca etapy KO downstream (tylko StageType.KNOCKOUT) po wskazanym order.
    """
    return Stage.objects.filter(
        tournament=tournament,
        stage_type=Stage.StageType.KNOCKOUT,
        order__gt=after_order,
    ).order_by("order")


def _knockout_downstream_has_results(tournament: Tournament, after_order: int) -> bool:
    """
    Czy w downstream KO są już wyniki? (FINISHED lub wprowadzone bramki/winner)
    Jeśli tak -> nie wolno soft-resetować, trzeba hard-rollback.
    """
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


def _soft_reset_downstream_for_team_change(
    *,
    tournament: Tournament,
    after_order: int,
    old_team_id: int,
    new_team: Team,
) -> None:
    """
    Soft reset:
    - podmienia old_team_id -> new_team w KO/THIRD_PLACE po danym order
    - czyści wynik/winner/status w dotkniętych meczach
    - otwiera etapy (OPEN) po danym order
    """
    # Dotykamy zarówno KO jak i THIRD_PLACE, bo 3. miejsce zależy od półfinałów.
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
            # To jest stan niemożliwy -> w takiej sytuacji nie próbujemy „magii”
            raise ValueError("Kolizja w KO: po podmianie drużyn mecz stał się home==away.")

        # Czyścimy wynik i stan meczu – bo to już inna para.
        m.home_score = None
        m.away_score = None
        m.winner = None
        m.status = Match.Status.SCHEDULED
        m.result_entered = False

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
            ],
        )

    # Otwieramy downstream etapy (KO i 3 miejsce)
    Stage.objects.filter(
        tournament=tournament,
        order__gt=after_order,
        stage_type__in=[Stage.StageType.KNOCKOUT, Stage.StageType.THIRD_PLACE],
    ).exclude(status=Stage.Status.OPEN).update(status=Stage.Status.OPEN)

    # Jeśli turniej był FINISHED, a grzebiemy w drabince -> wraca do CONFIGURED
    if tournament.status == Tournament.Status.FINISHED:
        tournament.status = Tournament.Status.CONFIGURED
        tournament.save(update_fields=["status"])


def rollback_knockout_after_stage(stage: Stage) -> int:
    """
    Hard rollback: usuwa wszystkie downstream etapy KO po danym etapie (tylko KO).
    """
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
    """
    Centralna decyzja po zmianie zwycięzcy (KO):
    - jeśli winner się nie zmienił -> nic
    - jeśli nie ma downstream -> nic
    - jeśli new_winner_id jest None -> hard rollback (downstream nieważny)
    - jeśli downstream ma wyniki -> hard rollback
    - w innym przypadku -> soft reset (podmień drużynę w downstream i wyczyść tylko dotknięte mecze)

    Uwaga:
    - Wywołuj TYLKO dla stage_type == KNOCKOUT.
    - Dla THIRD_PLACE nie propagujemy nic dalej (bo to koniec ścieżki).
    """
    if stage.stage_type != Stage.StageType.KNOCKOUT:
        return

    if old_winner_id == new_winner_id:
        return

    if not _knockout_downstream_stages(tournament, stage.order).exists():
        return

    # Jeśli nie ma rozstrzygnięcia po zmianie -> downstream staje się nieważny
    if new_winner_id is None:
        rollback_knockout_after_stage(stage)
        return

    # Jeśli downstream ma już wyniki -> rollback (bezpieczniej)
    if _knockout_downstream_has_results(tournament, stage.order):
        rollback_knockout_after_stage(stage)
        return

    # Soft reset: zamiana drużyny w downstream
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


# ============================================================
# AUTO-PROGRES KO
# ============================================================

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
