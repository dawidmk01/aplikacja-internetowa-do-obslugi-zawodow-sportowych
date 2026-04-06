# backend/tournaments/services/generators/knockout.py
# Plik generuje fazę pucharową oraz kolejne rundy drabinki w kontekście aktywnej dywizji.

from __future__ import annotations

import math
from collections import defaultdict
from typing import DefaultDict, Iterable, List, Optional, Tuple

from django.db import transaction

from tournaments.models import Division, Match, Stage, Team, Tournament
from tournaments.services.match_outcome import penalty_winner_id, team_goals_in_match

BYE_TEAM_NAME = "__SYSTEM_BYE__"


def _resolve_division(tournament: Tournament, division: Division | None = None) -> Division | None:
    if division is None:
        return tournament.get_default_division()

    if division.tournament_id != tournament.id:
        raise ValueError("Wskazana dywizja nie należy do tego turnieju.")

    return division


def _runtime_status(
    tournament: Tournament,
    division: Division | None,
) -> str:
    return division.status if division is not None else tournament.status


def _runtime_tournament_format(
    tournament: Tournament,
    division: Division | None,
) -> str:
    return division.tournament_format if division is not None else tournament.tournament_format


def _runtime_format_config(
    tournament: Tournament,
    division: Division | None,
) -> dict:
    if division is not None:
        return dict(division.format_config or {})
    return dict(tournament.format_config or {})


def _promote_after_generation(
    tournament: Tournament,
    division: Division | None,
) -> None:
    if division is not None and division.status == Tournament.Status.DRAFT:
        division.status = Tournament.Status.CONFIGURED
        division.save(update_fields=["status"])

    if tournament.status == Tournament.Status.DRAFT:
        tournament.status = Tournament.Status.CONFIGURED
        tournament.save(update_fields=["status"])


def _mark_finished(
    tournament: Tournament,
    division: Division | None,
) -> None:
    if division is None:
        tournament.status = Tournament.Status.FINISHED
        tournament.save(update_fields=["status"])
        return

    division.status = Tournament.Status.FINISHED
    division.save(update_fields=["status"])

    active_divisions = tournament.divisions.filter(is_archived=False)
    if active_divisions.exists() and not active_divisions.exclude(status=Tournament.Status.FINISHED).exists():
        tournament.status = Tournament.Status.FINISHED
        tournament.save(update_fields=["status"])


@transaction.atomic
def generate_knockout_stage(
    tournament: Tournament,
    *,
    division: Division | None = None,
    teams: Optional[List[Team]] = None,
    team_ids: Optional[List[int]] = None,
) -> Stage:
    division = _resolve_division(tournament, division)

    _validate_tournament(tournament, division)

    seed_teams = _resolve_seed_teams(
        tournament,
        division=division,
        teams=teams,
        team_ids=team_ids,
    )

    cup_matches = _get_cup_matches(tournament, division)
    final_matches = _get_final_matches(tournament, division)

    last_stage_qs = Stage.objects.filter(tournament=tournament)
    if division is not None:
        last_stage_qs = last_stage_qs.filter(division=division)
    last_stage = last_stage_qs.order_by("-order").first()
    new_order = (last_stage.order + 1) if last_stage else 1

    stage = Stage.objects.create(
        tournament=tournament,
        division=division,
        stage_type=Stage.StageType.KNOCKOUT,
        order=new_order,
        status=Stage.Status.OPEN,
    )

    bracket_size = _next_power_of_two(len(seed_teams))
    byes_count = bracket_size - len(seed_teams)

    bye_team: Optional[Team] = None
    if byes_count > 0:
        bye_team = _get_or_create_bye_team(tournament, division)

    pairs = _build_first_round_pairs(
        teams=seed_teams,
        byes_count=byes_count,
        bye_team=bye_team,
    )

    # Finał może mieć inną liczbę meczów niż wcześniejsze rundy.
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
    _promote_after_generation(tournament, division)

    return stage


@transaction.atomic
def generate_next_knockout_stage(stage: Stage) -> Stage:
    if stage.stage_type != Stage.StageType.KNOCKOUT:
        raise ValueError("Ten generator obsługuje wyłącznie etap typu KNOCKOUT.")

    if stage.status != Stage.Status.OPEN:
        raise ValueError("Etap został już zamknięty.")

    tournament = stage.tournament
    division = getattr(stage, "division", None)

    cup_matches = _get_cup_matches(tournament, division)
    final_matches = _get_final_matches(tournament, division)

    matches = list(stage.matches.select_related("winner", "home_team", "away_team").all())
    if not matches:
        raise ValueError("Brak meczów w etapie KO.")

    if any(match.status != Match.Status.FINISHED for match in matches):
        raise ValueError("Nie wszystkie mecze etapu są zakończone.")

    advancers = _collect_pair_winners(matches, cup_matches=cup_matches)
    advancers = sorted({team.id: team for team in advancers}.values(), key=lambda team: team.id)

    stage.status = Stage.Status.CLOSED
    stage.save(update_fields=["status"])

    if len(advancers) == 1:
        _mark_finished(tournament, division)
        return stage

    if len(advancers) % 2 != 0:
        raise ValueError("Nieprawidłowa liczba awansujących drużyn.")

    next_stage = Stage.objects.create(
        tournament=tournament,
        division=division,
        stage_type=Stage.StageType.KNOCKOUT,
        order=stage.order + 1,
        status=Stage.Status.OPEN,
    )

    pairs: List[Tuple[Team, Team]] = []
    for index in range(0, len(advancers), 2):
        home = advancers[index]
        away = advancers[index + 1]
        if home.id == away.id:
            raise ValueError("Błąd logiki KO: drużyna nie może grać sama ze sobą.")
        pairs.append((home, away))

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

    # Mecz o 3. miejsce powstaje po półfinałach tylko wtedy, gdy włączono go w konfiguracji.
    if len(advancers) == 2 and _has_third_place(tournament, division):
        _maybe_create_third_place_stage(
            tournament=tournament,
            division=division,
            losers_source_matches=matches,
            order=next_stage.order,
            cup_matches=cup_matches,
        )

    _promote_after_generation(tournament, division)
    return next_stage


def _has_third_place(
    tournament: Tournament,
    division: Division | None,
) -> bool:
    cfg = _runtime_format_config(tournament, division)
    return bool(cfg.get("third_place", False))


def _get_third_place_matches(
    tournament: Tournament,
    division: Division | None,
) -> int:
    cfg = _runtime_format_config(tournament, division)
    try:
        value = int(cfg.get("third_place_matches", 1))
    except (TypeError, ValueError):
        return 1
    return value if value in (1, 2) else 1


def _maybe_create_third_place_stage(
    *,
    tournament: Tournament,
    division: Division | None,
    losers_source_matches: List[Match],
    order: int,
    cup_matches: int,
) -> None:
    stage_qs = Stage.objects.filter(tournament=tournament, stage_type=Stage.StageType.THIRD_PLACE)
    if division is not None:
        stage_qs = stage_qs.filter(division=division)

    if stage_qs.exists():
        return

    losers = _collect_pair_losers(losers_source_matches, cup_matches=cup_matches)
    losers = sorted({team.id: team for team in losers}.values(), key=lambda team: team.id)

    if len(losers) != 2 or losers[0].id == losers[1].id:
        return

    third_place_stage = Stage.objects.create(
        tournament=tournament,
        division=division,
        stage_type=Stage.StageType.THIRD_PLACE,
        order=order,
        status=Stage.Status.OPEN,
    )

    legs = _get_third_place_matches(tournament, division)
    for leg in range(legs):
        home, away = (losers[0], losers[1]) if leg == 0 else (losers[1], losers[0])
        Match.objects.create(
            tournament=tournament,
            stage=third_place_stage,
            home_team=home,
            away_team=away,
            round_number=1,
            status=Match.Status.SCHEDULED,
        )


def _get_cup_matches(
    tournament: Tournament,
    division: Division | None,
) -> int:
    cfg = _runtime_format_config(tournament, division)
    try:
        cup_matches = int(cfg.get("cup_matches", 1))
    except (TypeError, ValueError):
        cup_matches = 1
    return cup_matches if cup_matches in (1, 2) else 1


def _get_final_matches(
    tournament: Tournament,
    division: Division | None,
) -> int:
    cfg = _runtime_format_config(tournament, division)
    try:
        final_matches = int(cfg.get("final_matches", 1))
    except (TypeError, ValueError):
        final_matches = 1
    return final_matches if final_matches in (1, 2) else 1


def _validate_tournament(
    tournament: Tournament,
    division: Division | None,
) -> None:
    allowed_statuses = {
        Tournament.Status.DRAFT,
        Tournament.Status.CONFIGURED,
        Tournament.Status.RUNNING,
    }
    status_value = _runtime_status(tournament, division)
    if status_value not in allowed_statuses:
        raise ValueError(
            "Faza pucharowa może być generowana tylko dla dywizji w statusie DRAFT/CONFIGURED/RUNNING."
        )

    allowed_formats = {Tournament.TournamentFormat.CUP, Tournament.TournamentFormat.MIXED}
    tournament_format = _runtime_tournament_format(tournament, division)
    if tournament_format not in allowed_formats:
        raise ValueError("Generator pucharowy obsługuje wyłącznie format CUP lub MIXED.")


def _resolve_seed_teams(
    tournament: Tournament,
    *,
    division: Division | None,
    teams: Optional[List[Team]] = None,
    team_ids: Optional[List[int]] = None,
) -> List[Team]:
    if teams is not None and team_ids is not None:
        raise ValueError("Podaj albo teams, albo team_ids (nie oba na raz).")

    if teams is not None:
        cleaned: List[Team] = []
        for team in teams:
            if team.tournament_id != tournament.id:
                raise ValueError("Przekazano drużynę z innego turnieju (błędny seeding).")
            if division is not None and team.division_id != division.id:
                raise ValueError("Przekazano drużynę z innej dywizji (błędny seeding).")
            if team.name == BYE_TEAM_NAME:
                continue
            cleaned.append(team)

        if len(cleaned) < 2:
            raise ValueError("Do wygenerowania fazy pucharowej wymaganych jest co najmniej dwóch uczestników.")
        return cleaned

    if team_ids is not None:
        teams_qs = Team.objects.filter(tournament=tournament, id__in=team_ids)
        if division is not None:
            teams_qs = teams_qs.filter(division=division)

        teams_map = teams_qs.in_bulk()
        missing = [team_id for team_id in team_ids if team_id not in teams_map]
        if missing:
            raise ValueError(f"Nie znaleziono drużyn o ID: {missing}")

        ordered: List[Team] = []
        for team_id in team_ids:
            team = teams_map[team_id]
            if team.name == BYE_TEAM_NAME:
                continue
            ordered.append(team)

        if len(ordered) < 2:
            raise ValueError("Do wygenerowania fazy pucharowej wymaganych jest co najmniej dwóch uczestników.")
        return ordered

    all_teams_qs = tournament.teams.exclude(name=BYE_TEAM_NAME)
    if division is not None:
        all_teams_qs = all_teams_qs.filter(division=division)

    all_teams = list(all_teams_qs.order_by("id"))
    if len(all_teams) < 2:
        raise ValueError("Do wygenerowania fazy pucharowej wymaganych jest co najmniej dwóch uczestników.")
    return all_teams


def _get_or_create_bye_team(
    tournament: Tournament,
    division: Division | None,
) -> Team:
    team, _created = Team.objects.get_or_create(
        tournament=tournament,
        division=division,
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
        return [(teams[index], teams[index + 1]) for index in range(0, len(teams), 2)]

    if bye_team is None:
        raise ValueError("byes_count > 0 wymaga istnienia drużyny BYE.")

    if byes_count >= len(teams):
        raise ValueError("Nieprawidłowa liczba BYE względem liczby drużyn.")

    bye_teams = teams[:byes_count]
    play_teams = teams[byes_count:]

    if len(play_teams) % 2 != 0:
        raise ValueError("Błąd seeding KO: liczba drużyn grających w 1 rundzie musi być parzysta.")

    pairs: List[Tuple[Team, Team]] = []
    pairs.extend([(team, bye_team) for team in bye_teams])
    pairs.extend([(play_teams[index], play_teams[index + 1]) for index in range(0, len(play_teams), 2)])
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
        # Walkower BYE zamyka parę od razu bez tworzenia dodatkowych legów.
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
            current_home, current_away = (home, away) if leg == 0 else (away, home)
            matches.append(
                Match(
                    tournament=tournament,
                    stage=stage,
                    home_team=current_home,
                    away_team=current_away,
                    round_number=round_number,
                    status=Match.Status.SCHEDULED,
                )
            )

    return matches


def _pair_key(match: Match) -> Tuple[int, int]:
    home_id = match.home_team_id
    away_id = match.away_team_id
    return (home_id, away_id) if home_id < away_id else (away_id, home_id)


def _team_from_group(group: List[Match], team_id: int) -> Team:
    for match in group:
        if match.home_team_id == team_id:
            return match.home_team
        if match.away_team_id == team_id:
            return match.away_team
        if match.winner_id == team_id and match.winner is not None:
            return match.winner
    return Team.objects.get(pk=team_id)


def _is_bye_match(group: List[Match]) -> bool:
    match = group[0]
    return (match.home_team and match.home_team.name == BYE_TEAM_NAME) or (
        match.away_team and match.away_team.name == BYE_TEAM_NAME
    )


def _collect_pair_winners(matches: List[Match], *, cup_matches: int) -> List[Team]:
    if cup_matches not in (1, 2):
        cup_matches = 1

    grouped: DefaultDict[Tuple[int, int], List[Match]] = defaultdict(list)
    for match in matches:
        grouped[_pair_key(match)].append(match)

    winners: List[Team] = []

    for _key, group in grouped.items():
        if any(match.status != Match.Status.FINISHED for match in group):
            raise ValueError("Nie wszystkie mecze pary są zakończone.")

        if len(group) == 1 and _is_bye_match(group):
            if not group[0].winner_id:
                raise ValueError("Brak zwycięzcy walkoweru (BYE) w KO.")
            winners.append(group[0].winner)
            continue

        if cup_matches == 1:
            if len(group) != 1:
                raise ValueError("KO (cup_matches=1) wymaga dokładnie 1 meczu w parze.")
            if group[0].winner_id is None:
                raise ValueError("Brak zwycięzcy meczu w fazie pucharowej (KO).")
            winners.append(group[0].winner)
            continue

        if len(group) != 2:
            raise ValueError("Dwumecz wymaga dokładnie 2 meczów w parze.")

        # Spójny winner_id na obu meczach ma pierwszeństwo przed liczeniem agregatu.
        if all(match.winner_id is not None for match in group):
            winner_ids = {match.winner_id for match in group}
            if len(winner_ids) == 1:
                winners.append(group[0].winner)
                continue

        team_ids: set[int] = {group[0].home_team_id, group[0].away_team_id}
        if len(team_ids) != 2:
            raise ValueError("Błąd danych KO: para nie ma dokładnie 2 drużyn.")

        first_team_id, second_team_id = list(team_ids)
        first_team_goals = sum(team_goals_in_match(match, first_team_id) for match in group)
        second_team_goals = sum(team_goals_in_match(match, second_team_id) for match in group)

        if first_team_goals != second_team_goals:
            winner_id = first_team_id if first_team_goals > second_team_goals else second_team_id
            Match.objects.filter(pk__in=[match.pk for match in group]).update(winner_id=winner_id)
            winners.append(_team_from_group(group, winner_id))
            continue

        # Karne w rewanżu domykają remisowy agregat.
        second_leg = max(group, key=lambda match: match.id)
        penalty_winner = penalty_winner_id(second_leg)
        if penalty_winner is not None:
            Match.objects.filter(pk__in=[match.pk for match in group]).update(winner_id=penalty_winner)
            winners.append(_team_from_group(group, penalty_winner))
            continue

        raise ValueError("Dwumecz: remis w agregacie i brak karnych w rewanżu.")

    return winners


def _collect_pair_losers(matches: List[Match], *, cup_matches: int) -> List[Team]:
    grouped: DefaultDict[Tuple[int, int], List[Match]] = defaultdict(list)
    for match in matches:
        grouped[_pair_key(match)].append(match)

    losers: List[Team] = []

    for _key, group in grouped.items():
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
            first_team_id, second_team_id = list(team_ids)
            loser_id = second_team_id if winner_id == first_team_id else first_team_id
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

        first_team_id, second_team_id = list(team_ids)
        loser_id = second_team_id if winner_id == first_team_id else first_team_id
        losers.append(_team_from_group(group, loser_id))

    return losers
