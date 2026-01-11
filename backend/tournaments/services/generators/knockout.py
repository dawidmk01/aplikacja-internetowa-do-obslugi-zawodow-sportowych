from __future__ import annotations

import math
from collections import defaultdict
from typing import DefaultDict, Iterable, List, Tuple, Optional

from django.db import transaction

from tournaments.models import Match, Stage, Team, Tournament
from tournaments.services.match_outcome import team_goals_in_match, penalty_winner_id


BYE_TEAM_NAME = "__SYSTEM_BYE__"


@transaction.atomic
def generate_knockout_stage(
    tournament: Tournament,
    *,
    teams: Optional[List[Team]] = None,
    team_ids: Optional[List[int]] = None,
) -> Stage:
    """
    WARIANT B (docelowy):
    - Generator KO NIE bazuje na Team.is_active.
    - Możesz przekazać jawnie listę drużyn (teams) lub listę ID (team_ids),
      a generator zachowa kolejność jako seeding.

    Jeśli nic nie przekażesz: generator weźmie wszystkie drużyny turnieju (bez BYE).
    """
    _validate_tournament(tournament)

    seed_teams = _resolve_seed_teams(tournament, teams=teams, team_ids=team_ids)

    # ile meczów na rundy "poza finałem"
    cup_matches = _get_cup_matches(tournament)
    # ile meczów ma finał
    final_matches = _get_final_matches(tournament)

    last_stage = Stage.objects.filter(tournament=tournament).order_by("-order").first()
    new_order = (last_stage.order + 1) if last_stage else 1

    stage = Stage.objects.create(
        tournament=tournament,
        stage_type=Stage.StageType.KNOCKOUT,
        order=new_order,
        status=Stage.Status.OPEN,
    )

    bracket_size = _next_power_of_two(len(seed_teams))
    byes_count = bracket_size - len(seed_teams)

    bye_team: Optional[Team] = None
    if byes_count > 0:
        bye_team = _get_or_create_bye_team(tournament)

    pairs = _build_first_round_pairs(teams=seed_teams, byes_count=byes_count, bye_team=bye_team)

    # Jeśli to od razu finał (2 drużyny) -> użyj final_matches, a nie cup_matches
    matches_per_pair = final_matches if len(seed_teams) == 2 else cup_matches

    matches = _build_matches_for_pairs(
        tournament=tournament,
        stage=stage,
        pairs=pairs,
        matches_per_pair=matches_per_pair,
        bye_team=bye_team,
        round_number=1,
    )

    if len(seed_teams) >= 2 and not matches:
        raise ValueError("Generator pucharowy nie utworzył żadnych meczów.")

    Match.objects.bulk_create(matches)

    if tournament.status == Tournament.Status.DRAFT:
        tournament.status = Tournament.Status.CONFIGURED
        tournament.save(update_fields=["status"])

    return stage


@transaction.atomic
def generate_next_knockout_stage(stage: Stage) -> Stage:
    # ✅ poprawny warunek (bez literówki KNOCKCKOUT)
    if stage.stage_type != Stage.StageType.KNOCKOUT:
        raise ValueError("Ten generator obsługuje wyłącznie etap typu KNOCKOUT.")

    if stage.status != Stage.Status.OPEN:
        raise ValueError("Etap został już zamknięty.")

    tournament = stage.tournament
    cup_matches = _get_cup_matches(tournament)
    final_matches = _get_final_matches(tournament)

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
        raise ValueError("Nieprawidłowa liczba awansujących drużyn.")

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

    # ✅ jeśli to finał (zostają 2 drużyny) -> użyj final_matches
    matches_per_pair = final_matches if len(advancers) == 2 else cup_matches

    created = _build_matches_for_pairs(
        tournament=tournament,
        stage=next_stage,
        pairs=pairs,
        matches_per_pair=matches_per_pair,
        bye_team=None,
        round_number=1,
    )
    Match.objects.bulk_create(created)

    # MECZ O 3. MIEJSCE (po półfinałach)
    if len(advancers) == 2 and _has_third_place(tournament):
        _maybe_create_third_place_stage(
            tournament=tournament,
            losers_source_matches=matches,
            order=next_stage.order,
            cup_matches=cup_matches,
        )

    return next_stage


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


def _get_cup_matches(tournament: Tournament) -> int:
    cfg = tournament.format_config or {}
    try:
        cup_matches = int(cfg.get("cup_matches", 1))
    except (TypeError, ValueError):
        cup_matches = 1
    return cup_matches if cup_matches in (1, 2) else 1


def _get_final_matches(tournament: Tournament) -> int:
    cfg = tournament.format_config or {}
    try:
        final_matches = int(cfg.get("final_matches", 1))
    except (TypeError, ValueError):
        final_matches = 1
    return final_matches if final_matches in (1, 2) else 1


def _validate_tournament(tournament: Tournament) -> None:
    allowed_statuses = {
        Tournament.Status.DRAFT,
        Tournament.Status.CONFIGURED,
        Tournament.Status.RUNNING,
    }
    if tournament.status not in allowed_statuses:
        raise ValueError("Faza pucharowa może być generowana tylko dla turnieju w statusie DRAFT/CONFIGURED/RUNNING.")

    allowed_formats = {Tournament.TournamentFormat.CUP, Tournament.TournamentFormat.MIXED}
    if tournament.tournament_format not in allowed_formats:
        raise ValueError("Generator pucharowy obsługuje wyłącznie format CUP lub MIXED.")


def _resolve_seed_teams(
    tournament: Tournament,
    *,
    teams: Optional[List[Team]] = None,
    team_ids: Optional[List[int]] = None,
) -> List[Team]:
    if teams is not None and team_ids is not None:
        raise ValueError("Podaj albo teams, albo team_ids (nie oba na raz).")

    if teams is not None:
        cleaned: List[Team] = []
        for t in teams:
            if t.tournament_id != tournament.id:
                raise ValueError("Przekazano drużynę z innego turnieju (błędny seeding).")
            if t.name == BYE_TEAM_NAME:
                continue
            cleaned.append(t)

        if len(cleaned) < 2:
            raise ValueError("Do wygenerowania fazy pucharowej wymaganych jest co najmniej dwóch uczestników.")
        return cleaned

    if team_ids is not None:
        teams_map = Team.objects.filter(tournament=tournament, id__in=team_ids).in_bulk()
        missing = [tid for tid in team_ids if tid not in teams_map]
        if missing:
            raise ValueError(f"Nie znaleziono drużyn o ID: {missing}")

        ordered: List[Team] = []
        for tid in team_ids:
            t = teams_map[tid]
            if t.name == BYE_TEAM_NAME:
                continue
            ordered.append(t)

        if len(ordered) < 2:
            raise ValueError("Do wygenerowania fazy pucharowej wymaganych jest co najmniej dwóch uczestników.")
        return ordered

    all_teams = list(tournament.teams.exclude(name=BYE_TEAM_NAME).order_by("id"))
    if len(all_teams) < 2:
        raise ValueError("Do wygenerowania fazy pucharowej wymaganych jest co najmniej dwóch uczestników.")
    return all_teams


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

    if matches_per_pair not in (1, 2):
        matches_per_pair = 1

    for home, away in pairs:
        # BYE -> walkower
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

        # BYE
        if len(group) == 1 and _is_bye_match(group):
            if not group[0].winner_id:
                raise ValueError("Brak zwycięzcy walkoweru (BYE) w KO.")
            winners.append(group[0].winner)  # type: ignore[arg-type]
            continue

        # cup_matches == 1
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

        # 1) Jeśli winner_id jest spójny na OBU meczach, używamy go bez liczenia agregatu.
        if all(m.winner_id is not None for m in group):
            wid = {m.winner_id for m in group}
            if len(wid) == 1:
                winners.append(group[0].winner)  # type: ignore[arg-type]
                continue

        # 2) Liczymy agregat bramek (reg+dogrywka), karne NIE wchodzą do agregatu.
        team_ids: set[int] = {group[0].home_team_id, group[0].away_team_id}
        if len(team_ids) != 2:
            raise ValueError("Błąd danych KO: para nie ma dokładnie 2 drużyn.")

        t1, t2 = list(team_ids)
        g1 = sum(team_goals_in_match(m, t1) for m in group)
        g2 = sum(team_goals_in_match(m, t2) for m in group)

        if g1 != g2:
            winner_id = t1 if g1 > g2 else t2
            Match.objects.filter(pk__in=[m.pk for m in group]).update(winner_id=winner_id)
            winners.append(_team_from_group(group, winner_id))
            continue

        # 2b) agregat remisowy → karne w rewanżu (mecz o większym ID)
        second_leg = max(group, key=lambda m: m.id)
        pw = penalty_winner_id(second_leg)
        if pw is not None:
            Match.objects.filter(pk__in=[m.pk for m in group]).update(winner_id=pw)
            winners.append(_team_from_group(group, pw))
            continue

        raise ValueError("Dwumecz: remis w agregacie i brak karnych w rewanżu.")

    return winners


def _collect_pair_losers(matches: List[Match], *, cup_matches: int) -> List[Team]:
    grouped: DefaultDict[Tuple[int, int], List[Match]] = defaultdict(list)
    for m in matches:
        grouped[_pair_key(m)].append(m)

    losers: List[Team] = []

    for _, group in grouped.items():
        if len(group) == 1 and _is_bye_match(group):
            continue

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
