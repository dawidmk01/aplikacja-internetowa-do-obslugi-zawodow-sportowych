from __future__ import annotations

import math
from collections import defaultdict
from typing import DefaultDict, Iterable, List, Tuple, Optional

from django.db import transaction

from tournaments.models import Match, Stage, Team, Tournament


BYE_TEAM_NAME = "__SYSTEM_BYE__"


# ============================================================
# API PUBLICZNE
# ============================================================

@transaction.atomic
def generate_knockout_stage(tournament: Tournament) -> Stage:
    _validate_tournament(tournament)

    teams = _get_active_teams(tournament)
    cup_matches = _get_cup_matches(tournament)

    stage = Stage.objects.create(
        tournament=tournament,
        stage_type=Stage.StageType.KNOCKOUT,
        order=1,
        status=Stage.Status.OPEN,
    )

    bracket_size = _next_power_of_two(len(teams))
    byes_count = bracket_size - len(teams)

    bye_team: Optional[Team] = None
    if byes_count > 0:
        bye_team = _get_or_create_bye_team(tournament)

    pairs = _build_first_round_pairs(teams=teams, byes_count=byes_count, bye_team=bye_team)

    matches = _build_matches_for_pairs(
        tournament=tournament,
        stage=stage,
        pairs=pairs,
        matches_per_pair=cup_matches,
        bye_team=bye_team,
        round_number=1,
    )

    if len(teams) >= 2 and not matches:
        raise ValueError("Generator pucharowy nie utworzył żadnych meczów.")

    Match.objects.bulk_create(matches)

    tournament.status = Tournament.Status.CONFIGURED
    tournament.save(update_fields=["status"])

    return stage


@transaction.atomic
def generate_next_knockout_stage(stage: Stage) -> Stage:
    if stage.stage_type != Stage.StageType.KNOCKOUT:
        raise ValueError("Ten generator obsługuje wyłącznie etap typu KNOCKOUT.")

    if stage.status != Stage.Status.OPEN:
        raise ValueError("Etap został już zamknięty.")

    tournament = stage.tournament
    cup_matches = _get_cup_matches(tournament)

    matches = list(stage.matches.select_related("winner", "home_team", "away_team").all())
    if not matches:
        raise ValueError("Brak meczów w etapie KO.")

    if any(m.status != Match.Status.FINISHED for m in matches):
        raise ValueError("Nie wszystkie mecze etapu są zakończone.")

    advancers = _collect_pair_winners(matches, cup_matches=cup_matches)
    advancers = sorted({t.id: t for t in advancers}.values(), key=lambda t: t.id)

    stage.status = Stage.Status.CLOSED
    stage.save(update_fields=["status"])

    if len(advancers) == 1:
        tournament.status = Tournament.Status.FINISHED
        tournament.save(update_fields=["status"])
        return stage

    if len(advancers) % 2 != 0:
        raise ValueError(
            "Nieprawidłowa liczba awansujących drużyn. Sprawdź wyniki w bieżącym etapie KO."
        )

    next_stage = Stage.objects.create(
        tournament=tournament,
        stage_type=Stage.StageType.KNOCKOUT,
        order=stage.order + 1,
        status=Stage.Status.OPEN,
    )

    pairs: List[Tuple[Team, Team]] = []
    for i in range(0, len(advancers), 2):
        home = advancers[i]
        away = advancers[i + 1]
        if home.id == away.id:
            raise ValueError("Błąd logiki KO: drużyna nie może grać sama ze sobą.")
        pairs.append((home, away))

    created = _build_matches_for_pairs(
        tournament=tournament,
        stage=next_stage,
        pairs=pairs,
        matches_per_pair=cup_matches,
        bye_team=None,
        round_number=1,
    )
    Match.objects.bulk_create(created)

    # ========================================================
    # MECZ O 3. MIEJSCE
    # ========================================================
    if len(advancers) == 2 and _has_third_place(tournament):
        _maybe_create_third_place_stage(
            tournament=tournament,
            losers_source_matches=matches,  # półfinały
            order=next_stage.order,         # ten sam poziom co finał
            cup_matches=cup_matches,
        )

    return next_stage


# ============================================================
# THIRD PLACE – POMOCNICZE
# ============================================================

def _has_third_place(tournament: Tournament) -> bool:
    cfg = tournament.format_config or {}
    return bool(cfg.get("third_place", False))


def _get_third_place_matches(tournament: Tournament) -> int:
    cfg = tournament.format_config or {}
    try:
        v = int(cfg.get("third_place_matches", 1))
    except (TypeError, ValueError):
        return 1
    return v if v in (1, 2) else 1


def _maybe_create_third_place_stage(
    *,
    tournament: Tournament,
    losers_source_matches: List[Match],
    order: int,
    cup_matches: int,
) -> None:
    if Stage.objects.filter(tournament=tournament, stage_type=Stage.StageType.THIRD_PLACE).exists():
        return

    losers = _collect_pair_losers(losers_source_matches, cup_matches=cup_matches)
    losers = sorted({t.id: t for t in losers}.values(), key=lambda t: t.id)

    if len(losers) != 2 or losers[0].id == losers[1].id:
        return

    third_place_stage = Stage.objects.create(
        tournament=tournament,
        stage_type=Stage.StageType.THIRD_PLACE,
        order=order,
        status=Stage.Status.OPEN,
    )

    legs = _get_third_place_matches(tournament)
    for leg in range(legs):
        h, a = (losers[0], losers[1]) if leg == 0 else (losers[1], losers[0])
        Match.objects.create(
            tournament=tournament,
            stage=third_place_stage,
            home_team=h,
            away_team=a,
            round_number=1,
            status=Match.Status.SCHEDULED,
        )


# ============================================================
# WALIDACJE / KONFIG
# ============================================================

def _get_cup_matches(tournament: Tournament) -> int:
    cfg = tournament.format_config or {}
    try:
        cup_matches = int(cfg.get("cup_matches", 1))
    except (TypeError, ValueError):
        cup_matches = 1
    return cup_matches if cup_matches in (1, 2) else 1


def _validate_tournament(tournament: Tournament) -> None:
    if tournament.status != Tournament.Status.DRAFT:
        raise ValueError("Faza pucharowa może być generowana tylko dla turnieju w statusie DRAFT.")
    if tournament.tournament_format != Tournament.TournamentFormat.CUP:
        raise ValueError("Generator pucharowy obsługuje wyłącznie format CUP.")


def _get_active_teams(tournament: Tournament) -> List[Team]:
    teams = list(tournament.teams.filter(is_active=True).order_by("id"))
    if len(teams) < 2:
        raise ValueError("Do wygenerowania fazy pucharowej wymaganych jest co najmniej dwóch uczestników.")
    return teams


def _get_or_create_bye_team(tournament: Tournament) -> Team:
    team, _created = Team.objects.get_or_create(
        tournament=tournament,
        name=BYE_TEAM_NAME,
        defaults={"is_active": False},
    )
    if team.is_active:
        team.is_active = False
        team.save(update_fields=["is_active"])
    return team


# ============================================================
# LOGIKA DRABINKI – RUNDA 1
# ============================================================

def _next_power_of_two(n: int) -> int:
    if n <= 1:
        return 1
    return 2 ** math.ceil(math.log2(n))


def _build_first_round_pairs(
    teams: List[Team],
    byes_count: int,
    bye_team: Optional[Team],
) -> List[Tuple[Team, Team]]:
    if byes_count < 0:
        raise ValueError("byes_count nie może być ujemne.")

    if byes_count == 0:
        if len(teams) % 2 != 0:
            raise ValueError("Dla braku BYE liczba drużyn musi być parzysta.")
        return [(teams[i], teams[i + 1]) for i in range(0, len(teams), 2)]

    if bye_team is None:
        raise ValueError("byes_count > 0 wymaga istnienia drużyny BYE.")

    if byes_count >= len(teams):
        raise ValueError("Nieprawidłowa liczba BYE względem liczby drużyn.")

    bye_teams = teams[:byes_count]
    play_teams = teams[byes_count:]

    if len(play_teams) % 2 != 0:
        raise ValueError("Błąd seeding KO: liczba drużyn grających w 1 rundzie musi być parzysta.")

    pairs: List[Tuple[Team, Team]] = []
    pairs.extend([(t, bye_team) for t in bye_teams])
    pairs.extend([(play_teams[i], play_teams[i + 1]) for i in range(0, len(play_teams), 2)])
    return pairs


def _build_matches_for_pairs(
    tournament: Tournament,
    stage: Stage,
    pairs: Iterable[Tuple[Team, Team]],
    matches_per_pair: int,
    bye_team: Optional[Team],
    round_number: int,
) -> List[Match]:
    matches: List[Match] = []
    bye_id = bye_team.id if bye_team else None

    for home, away in pairs:
        if bye_id is not None and away.id == bye_id:
            matches.append(
                Match(
                    tournament=tournament,
                    stage=stage,
                    home_team=home,
                    away_team=away,
                    round_number=round_number,
                    status=Match.Status.FINISHED,
                    winner=home,
                    home_score=1,
                    away_score=0,
                )
            )
            continue

        if matches_per_pair not in (1, 2):
            matches_per_pair = 1

        for leg in range(matches_per_pair):
            h, a = (home, away) if leg == 0 else (away, home)
            matches.append(
                Match(
                    tournament=tournament,
                    stage=stage,
                    home_team=h,
                    away_team=a,
                    round_number=round_number,
                    status=Match.Status.SCHEDULED,
                )
            )

    return matches


# ============================================================
# ZWYCIĘZCY / PRZEGRANI PAR
# ============================================================

def _pair_key(m: Match) -> Tuple[int, int]:
    a = m.home_team_id
    b = m.away_team_id
    return (a, b) if a < b else (b, a)


def _team_from_group(group: List[Match], team_id: int) -> Team:
    for m in group:
        if m.home_team_id == team_id:
            return m.home_team
        if m.away_team_id == team_id:
            return m.away_team
        if m.winner_id == team_id and m.winner is not None:
            return m.winner
    return Team.objects.get(pk=team_id)


def _is_bye_match(group: List[Match]) -> bool:
    # BYE rozpoznajemy po nazwie drużyny systemowej
    m = group[0]
    return (m.home_team and m.home_team.name == BYE_TEAM_NAME) or (m.away_team and m.away_team.name == BYE_TEAM_NAME)


def _collect_pair_winners(matches: List[Match], *, cup_matches: int) -> List[Team]:
    if cup_matches not in (1, 2):
        cup_matches = 1

    grouped: DefaultDict[Tuple[int, int], List[Match]] = defaultdict(list)
    for m in matches:
        grouped[_pair_key(m)].append(m)

    winners: List[Team] = []

    for _, group in grouped.items():
        if any(m.status != Match.Status.FINISHED for m in group):
            raise ValueError("Nie wszystkie mecze pary są zakończone.")

        # BYE (tylko gdy faktycznie grał __SYSTEM_BYE__)
        if len(group) == 1 and _is_bye_match(group):
            if not group[0].winner_id:
                raise ValueError("Brak zwycięzcy walkoweru (BYE) w KO.")
            winners.append(group[0].winner)  # type: ignore[arg-type]
            continue

        # cup_matches == 1: normalna para ma 1 mecz
        if cup_matches == 1:
            if len(group) != 1:
                raise ValueError("KO (cup_matches=1) wymaga dokładnie 1 meczu w parze.")
            if group[0].winner_id is None:
                raise ValueError("Brak zwycięzcy meczu w fazie pucharowej (KO).")
            winners.append(group[0].winner)  # type: ignore[arg-type]
            continue

        # cup_matches == 2
        if len(group) != 2:
            raise ValueError("Dwumecz wymaga dokładnie 2 meczów w parze.")

        winner_ids_nonnull = {m.winner_id for m in group if m.winner_id is not None}
        if len(winner_ids_nonnull) == 1 and len(winner_ids_nonnull) == len(group):
            winners.append(group[0].winner)  # type: ignore[arg-type]
            continue

        totals: dict[int, int] = {}
        team_ids: set[int] = set()

        for m in group:
            team_ids.add(m.home_team_id)
            team_ids.add(m.away_team_id)
            totals[m.home_team_id] = totals.get(m.home_team_id, 0) + int(m.home_score)
            totals[m.away_team_id] = totals.get(m.away_team_id, 0) + int(m.away_score)

        if len(team_ids) != 2:
            raise ValueError("Błąd danych KO: para nie ma dokładnie 2 drużyn.")

        t1, t2 = list(team_ids)
        g1, g2 = totals.get(t1, 0), totals.get(t2, 0)

        if g1 == g2:
            raise ValueError("Dwumecz nie ma rozstrzygnięcia (remis w agregacie).")

        winner_id = t1 if g1 > g2 else t2
        Match.objects.filter(pk__in=[m.pk for m in group]).update(winner_id=winner_id)
        winners.append(_team_from_group(group, winner_id))

    return winners


def _collect_pair_losers(matches: List[Match], *, cup_matches: int) -> List[Team]:
    """
    Zwraca przegranych z każdej pary w etapie. Używane do meczu o 3 miejsce po półfinale.
    Poprawka: przy cup_matches=1 normalna para ma len(group)==1 i NIE może być pomijana.
    """
    grouped: DefaultDict[Tuple[int, int], List[Match]] = defaultdict(list)
    for m in matches:
        grouped[_pair_key(m)].append(m)

    losers: List[Team] = []

    for _, group in grouped.items():
        # Pomijamy tylko realne BYE
        if len(group) == 1 and _is_bye_match(group):
            continue

        # cup_matches=1 -> 1 mecz w parze
        if cup_matches == 1:
            if len(group) != 1:
                raise ValueError("KO (cup_matches=1) wymaga dokładnie 1 meczu w parze (do loserów).")
            winner_id = group[0].winner_id
            if not winner_id:
                raise ValueError("Brak zwycięzcy w parze (nie można wyznaczyć przegranego).")

            team_ids = {group[0].home_team_id, group[0].away_team_id}
            if len(team_ids) != 2:
                raise ValueError("Błąd danych: para nie ma dokładnie 2 drużyn.")
            t1, t2 = list(team_ids)
            loser_id = t2 if winner_id == t1 else t1
            losers.append(_team_from_group(group, loser_id))
            continue

        # cup_matches=2 -> 2 mecze
        if len(group) != 2:
            raise ValueError("Dwumecz wymaga dokładnie 2 meczów w parze (do loserów).")

        winner_id = group[0].winner_id
        if not winner_id:
            raise ValueError("Brak zwycięzcy w parze (nie można wyznaczyć przegranego).")

        team_ids = {group[0].home_team_id, group[0].away_team_id}
        if len(team_ids) != 2:
            raise ValueError("Błąd danych: para nie ma dokładnie 2 drużyn.")

        t1, t2 = list(team_ids)
        loser_id = t2 if winner_id == t1 else t1
        losers.append(_team_from_group(group, loser_id))

    return losers
