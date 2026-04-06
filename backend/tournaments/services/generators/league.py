# backend/tournaments/services/generators/league.py
# Plik generuje strukturę rozgrywek ligowych wraz z kolejkami i meczami dla aktywnej dywizji.

from __future__ import annotations

from typing import List, Optional, Tuple

from django.db import transaction

from tournaments.models import Division, Match, Stage, Team, Tournament

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


@transaction.atomic
def generate_league_stage(
    tournament: Tournament,
    division: Division | None = None,
) -> Stage:
    division = _resolve_division(tournament, division)

    _validate_tournament(tournament, division)

    teams = _get_active_teams_excluding_bye(tournament, division)
    league_matches = _get_league_matches(tournament, division)

    # Generator pracuje na jednym etapie ligi danej dywizji.
    stage, _created = Stage.objects.get_or_create(
        tournament=tournament,
        division=division,
        stage_type=Stage.StageType.LEAGUE,
        defaults={"order": 1, "status": Stage.Status.OPEN},
    )

    Match.objects.filter(stage=stage).delete()

    schedule = _round_robin_schedule(teams)

    matches: list[Match] = []
    current_round = 1

    # Druga runda odwraca gospodarza, aby zachować układ rewanżowy.
    for leg in range(league_matches):
        for round_pairs in schedule:
            for home, away in round_pairs:
                if leg == 0:
                    current_home, current_away = home, away
                else:
                    current_home, current_away = away, home

                matches.append(
                    Match(
                        tournament=tournament,
                        stage=stage,
                        home_team=current_home,
                        away_team=current_away,
                        round_number=current_round,
                        status=Match.Status.SCHEDULED,
                    )
                )
            current_round += 1

    if not matches:
        raise ValueError("Generator ligi nie utworzył żadnych meczów.")

    Match.objects.bulk_create(matches)
    _promote_after_generation(tournament, division)

    return stage


def _validate_tournament(
    tournament: Tournament,
    division: Division | None,
) -> None:
    allowed_statuses = {Tournament.Status.DRAFT, Tournament.Status.CONFIGURED}
    status_value = _runtime_status(tournament, division)
    if status_value not in allowed_statuses:
        raise ValueError(
            "Ligę można generować tylko dla dywizji w statusie DRAFT lub CONFIGURED. "
            f"Obecny status: {status_value}"
        )

    tournament_format = _runtime_tournament_format(tournament, division)
    if tournament_format != Tournament.TournamentFormat.LEAGUE:
        raise ValueError("Generator ligi obsługuje wyłącznie format LEAGUE.")


def _get_league_matches(
    tournament: Tournament,
    division: Division | None,
) -> int:
    cfg = _runtime_format_config(tournament, division)
    try:
        value = int(cfg.get("league_matches", 1))
    except (TypeError, ValueError):
        value = 1

    if value not in (1, 2):
        raise ValueError("Liczba rund (league_matches) musi wynosić 1 albo 2.")
    return value


def _get_active_teams_excluding_bye(
    tournament: Tournament,
    division: Division | None,
) -> List[Team]:
    # Wymuszenie nieaktywności BYE chroni generator przed wejściem technicznej drużyny do ligi.
    bye_qs = Team.objects.filter(tournament=tournament, name=BYE_TEAM_NAME)
    if division is not None:
        bye_qs = bye_qs.filter(division=division)
    bye_qs.update(is_active=False)

    teams_qs = tournament.teams.filter(is_active=True).exclude(name=BYE_TEAM_NAME)
    if division is not None:
        teams_qs = teams_qs.filter(division=division)

    teams = list(teams_qs.order_by("id"))

    if len(teams) < 2:
        raise ValueError("Liga wymaga co najmniej 2 aktywnych uczestników.")
    return teams


def _round_robin_schedule(teams: List[Team]) -> List[List[Tuple[Team, Team]]]:
    arr: List[Optional[Team]] = list(teams)

    # Nieparzysta liczba drużyn daje pauzę w kolejce, ale bez tworzenia meczu technicznego.
    if len(arr) % 2 == 1:
        arr.append(None)

    n = len(arr)
    rounds = n - 1
    half = n // 2

    schedule: list[list[tuple[Team, Team]]] = []

    for _ in range(rounds):
        round_matches: list[tuple[Team, Team]] = []

        for i in range(half):
            team_one = arr[i]
            team_two = arr[n - 1 - i]
            if team_one is not None and team_two is not None:
                round_matches.append((team_one, team_two))

        schedule.append(round_matches)

        # Rotacja Bergera utrzymuje poprawny układ par bez naruszania pierwszej pozycji.
        arr = [arr[0]] + [arr[-1]] + arr[1:-1]

    return schedule
