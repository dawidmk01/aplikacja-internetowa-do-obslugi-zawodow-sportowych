# backend/tournaments/services/standings/compute.py
# Plik oblicza klasyfikację etapu na podstawie zakończonych meczów i reguł dyscypliny.

from __future__ import annotations

from decimal import Decimal
from typing import Any, Literal, Tuple

from tournaments.models import Group, Match, MatchCustomResult, Stage, Team, Tournament
from tournaments.services.match_outcome import final_score
from tournaments.services.standings.rulesets.base import StandingsRuleset
from tournaments.services.standings.rulesets.football import FootballPZPNRuleset
from tournaments.services.standings.rulesets.handball import HandballSuperligaRuleset
from tournaments.services.standings.rulesets.tennis import TennisRuleset
from tournaments.services.standings.types import StandingRow

BYE_TEAM_NAME = "__SYSTEM_BYE__"

TennisPointsMode = Literal["NONE", "PLT"]


def _is_custom_result_mode(tournament: Tournament) -> bool:
    return getattr(tournament, "result_mode", Tournament.ResultMode.SCORE) == Tournament.ResultMode.CUSTOM


def _get_ruleset(tournament: Tournament) -> StandingsRuleset:
    discipline = getattr(tournament, "discipline", None)

    if discipline in (Tournament.Discipline.FOOTBALL, "football", "FOOTBALL"):
        return FootballPZPNRuleset()

    if discipline in (Tournament.Discipline.HANDBALL, "handball", "HANDBALL"):
        return HandballSuperligaRuleset()

    if discipline in (Tournament.Discipline.TENNIS, "tennis", "TENNIS"):
        cfg = getattr(tournament, "format_config", None) or {}
        mode = (cfg.get("tennis_points_mode") or "NONE").upper()
        return TennisRuleset(points_mode="PLT" if mode == "PLT" else "NONE")

    return FootballPZPNRuleset()


def _custom_head_to_head_mode(tournament: Tournament) -> str:
    cfg = tournament.get_result_config()
    return str(cfg.get("head_to_head_mode") or cfg.get("custom_mode") or "").upper()


def _custom_competition_model(tournament: Tournament) -> str:
    return str(getattr(tournament, "competition_model", "") or "").upper()


def _uses_custom_points_table(tournament: Tournament) -> bool:
    if not _is_custom_result_mode(tournament):
        return False
    if _custom_competition_model(tournament) != Tournament.CompetitionModel.HEAD_TO_HEAD:
        return False
    mode = _custom_head_to_head_mode(tournament)
    return mode in {"POINTS_TABLE", "HEAD_TO_HEAD_POINTS"}


def _uses_custom_measured_ranking(tournament: Tournament) -> bool:
    if not _is_custom_result_mode(tournament):
        return False

    if _custom_competition_model(tournament) == Tournament.CompetitionModel.MASS_START:
        return True

    mode = _custom_head_to_head_mode(tournament)
    return mode in {"MEASURED_RESULT", "MASS_START_MEASURED"}


def compute_stage_standings(
    tournament: Tournament,
    stage: Stage,
    group: Group | None = None,
) -> list[StandingRow]:
    teams = _get_teams_for_context(tournament, stage, group)
    rows = _initialize_rows(teams)

    if _uses_custom_points_table(tournament):
        return _compute_custom_points_stage_standings(tournament, stage, group, rows)

    if _uses_custom_measured_ranking(tournament):
        return _compute_custom_measured_stage_standings(tournament, stage, group, rows)

    ruleset = _get_ruleset(tournament)

    finished_matches = list(_get_finished_matches(stage, group))
    all_stage_matches = list(_get_all_matches(stage, group))

    for match in finished_matches:
        _apply_match_result(rows, match, tournament)

    for row in rows.values():
        row.goal_difference = row.goals_for - row.goals_against
        row.games_difference = row.games_for - row.games_against

    return ruleset.sort_rows(rows.values(), finished_matches, all_stage_matches)


def _compute_custom_points_stage_standings(
    tournament: Tournament,
    stage: Stage,
    group: Group | None,
    rows: dict[int, StandingRow],
) -> list[StandingRow]:
    cfg = tournament.get_result_config()
    finished_matches = list(_get_finished_matches(stage, group))
    all_stage_matches = list(_get_all_matches(stage, group))

    for match in finished_matches:
        _apply_custom_points_match_result(rows, match, cfg)

    ranked = list(rows.values())
    for row in ranked:
        row.is_custom_result = False
        row.custom_mode = "POINTS_TABLE"
        row.goal_difference = row.goals_for - row.goals_against

    ranked.sort(
        key=lambda row: (
            row.points,
            row.wins,
            row.goal_difference,
            row.goals_for,
            -row.losses,
            row.team_name.strip().lower(),
            row.team_id,
        ),
        reverse=True,
    )

    for index, row in enumerate(ranked, start=1):
        row.rank = index

    # H2H można dopiąć później, jeśli standings rules dla custom będą potrzebne.
    _ = all_stage_matches
    return ranked


def _compute_custom_measured_stage_standings(
    tournament: Tournament,
    stage: Stage,
    group: Group | None,
    rows: dict[int, StandingRow],
) -> list[StandingRow]:
    cfg = tournament.get_result_config()
    allow_ties = bool(cfg.get(Tournament.RESULTCFG_ALLOW_TIES_KEY, True))
    lower_is_better = tournament.custom_result_lower_is_better()
    custom_mode = (
        "MASS_START"
        if _custom_competition_model(tournament) == Tournament.CompetitionModel.MASS_START
        else "MEASURED_RESULT"
    )

    results = list(_get_custom_results_for_context(stage, group))
    best_results_by_team: dict[int, MatchCustomResult] = {}
    attempts_count_by_team: dict[int, int] = {}

    for result in results:
        attempts_count_by_team[result.team_id] = attempts_count_by_team.get(result.team_id, 0) + 1
        current = best_results_by_team.get(result.team_id)
        if current is None or _is_better_custom_result(result, current, lower_is_better):
            best_results_by_team[result.team_id] = result

    for team_id, row in rows.items():
        best_result = best_results_by_team.get(team_id)
        row.is_custom_result = True
        row.custom_mode = custom_mode
        row.custom_value_kind = tournament.get_result_value_kind()

        if best_result is None:
            row.played = attempts_count_by_team.get(team_id, 0)
            continue

        row.played = attempts_count_by_team.get(team_id, 1)
        row.custom_result_display = best_result.display_value
        sort_value = best_result.get_sort_value()

        if best_result.value_kind == MatchCustomResult.ValueKind.TIME:
            row.custom_result_time_ms = int(best_result.time_ms or 0)
            row.custom_sort_value = row.custom_result_time_ms
        elif best_result.value_kind == MatchCustomResult.ValueKind.PLACE:
            if sort_value is not None:
                row.custom_result_place = int(sort_value)
                row.custom_sort_value = row.custom_result_place
        else:
            if sort_value is not None:
                row.custom_result_numeric = str(sort_value)
                row.custom_sort_value = str(sort_value)

    ranked_rows = [row for row in rows.values() if row.custom_sort_value is not None]
    unranked_rows = [row for row in rows.values() if row.custom_sort_value is None]

    ranked_rows.sort(
        key=lambda row: (_custom_row_sort_key(row), row.team_name.strip().lower(), row.team_id),
        reverse=not lower_is_better,
    )

    previous_value = None
    previous_rank = None

    for index, row in enumerate(ranked_rows, start=1):
        current_value = _custom_row_sort_key(row)

        if allow_ties and previous_value is not None and current_value == previous_value:
            row.rank = previous_rank
        else:
            row.rank = index

        previous_value = current_value
        previous_rank = row.rank

    unranked_rows.sort(key=lambda row: (row.team_name.strip().lower(), row.team_id))

    return ranked_rows + unranked_rows


def _get_custom_results_for_context(stage: Stage, group: Group | None):
    qs = (
        MatchCustomResult.objects.select_related("match", "team")
        .filter(
            match__stage=stage,
            is_active=True,
            team__is_active=True,
        )
        .exclude(team__name=BYE_TEAM_NAME)
    )

    if group is not None:
        qs = qs.filter(match__group=group)

    return qs.order_by("match_id", "team_id", "id")


def _is_better_custom_result(
    candidate: MatchCustomResult,
    current: MatchCustomResult,
    lower_is_better: bool,
) -> bool:
    candidate_value = candidate.get_sort_value()
    current_value = current.get_sort_value()

    if current_value is None:
        return True
    if candidate_value is None:
        return False

    if lower_is_better:
        return candidate_value < current_value

    return candidate_value > current_value


def _custom_row_sort_key(row: StandingRow):
    if row.custom_result_place is not None:
        return int(row.custom_result_place)

    if row.custom_result_time_ms is not None:
        return int(row.custom_result_time_ms)

    if row.custom_result_numeric is not None:
        return Decimal(row.custom_result_numeric)

    return Decimal("0")


def _get_teams_for_context(
    tournament: Tournament,
    stage: Stage,
    group: Group | None,
) -> list[Team]:
    if group is None:
        return list(tournament.teams.exclude(name=BYE_TEAM_NAME).order_by("id"))

    home_team_ids = set(
        Match.objects.filter(stage=stage, group=group).values_list("home_team_id", flat=True)
    )
    away_team_ids = set(
        Match.objects.filter(stage=stage, group=group).values_list("away_team_id", flat=True)
    )
    team_ids = home_team_ids | away_team_ids

    return list(
        Team.objects.filter(id__in=team_ids).exclude(name=BYE_TEAM_NAME).order_by("id")
    )


def _get_finished_matches(stage: Stage, group: Group | None):
    qs = Match.objects.filter(stage=stage, status=Match.Status.FINISHED)
    if group is not None:
        qs = qs.filter(group=group)
    return qs


def _get_all_matches(stage: Stage, group: Group | None):
    qs = Match.objects.filter(stage=stage)
    if group is not None:
        qs = qs.filter(group=group)
    return qs


def _initialize_rows(teams: list[Team]) -> dict[int, StandingRow]:
    return {team.id: StandingRow(team_id=team.id, team_name=team.name) for team in teams}


def _safe_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _tennis_games_from_match(match: Match) -> Tuple[int, int]:
    sets = getattr(match, "tennis_sets", None)
    if not isinstance(sets, list):
        return (0, 0)

    home_games_sum = 0
    away_games_sum = 0

    for set_item in sets:
        if not isinstance(set_item, dict):
            continue
        home_games_sum += _safe_int(set_item.get("home_games"))
        away_games_sum += _safe_int(set_item.get("away_games"))

    return (home_games_sum, away_games_sum)


def _tennis_points_mode(tournament: Tournament) -> TennisPointsMode:
    cfg = getattr(tournament, "format_config", None) or {}
    mode = (cfg.get("tennis_points_mode") or "NONE").upper()
    return "PLT" if mode == "PLT" else "NONE"


def _plt_points_from_sets(match: Match, home_sets: int, away_sets: int) -> Tuple[int, int]:
    tennis_sets = getattr(match, "tennis_sets", None)

    if (not tennis_sets) and home_sets == 0 and away_sets == 0:
        return (0, 0)

    if home_sets == away_sets:
        return (0, 0)

    home_won = home_sets > away_sets
    loser_sets = min(home_sets, away_sets)

    if loser_sets == 0:
        return (10, 2) if home_won else (2, 10)

    return (8, 4) if home_won else (4, 8)


def _custom_points_value(cfg: dict, key: str, default: int = 0) -> int:
    try:
        return int(cfg.get(key, default))
    except (TypeError, ValueError):
        return default


def _resolve_custom_match_outcome(match: Match) -> tuple[str, int | None]:
    hs, aws = final_score(match)

    if hs > aws:
        return ("REGULATION", match.home_team_id)
    if hs < aws:
        return ("REGULATION", match.away_team_id)

    if (
        match.decided_by_penalties
        and match.home_penalty_score is not None
        and match.away_penalty_score is not None
    ):
        if match.home_penalty_score > match.away_penalty_score:
            return ("SHOOTOUT", match.home_team_id)
        if match.home_penalty_score < match.away_penalty_score:
            return ("SHOOTOUT", match.away_team_id)

    if (
        match.went_to_extra_time
        and match.home_extra_time_score is not None
        and match.away_extra_time_score is not None
    ):
        if match.home_extra_time_score > match.away_extra_time_score:
            return ("OVERTIME", match.home_team_id)
        if match.home_extra_time_score < match.away_extra_time_score:
            return ("OVERTIME", match.away_team_id)

    return ("DRAW", None)


def _apply_custom_points_match_result(rows: dict[int, StandingRow], match: Match, cfg: dict) -> None:
    home = rows.get(match.home_team_id)
    away = rows.get(match.away_team_id)
    if not home or not away:
        return

    hs, aws = final_score(match)
    outcome_type, winner_id = _resolve_custom_match_outcome(match)

    home.played += 1
    away.played += 1

    home.goals_for += hs
    home.goals_against += aws
    away.goals_for += aws
    away.goals_against += hs

    points_win = _custom_points_value(cfg, Tournament.RESULTCFG_POINTS_WIN_KEY, 3)
    points_draw = _custom_points_value(cfg, Tournament.RESULTCFG_POINTS_DRAW_KEY, 1)
    points_loss = _custom_points_value(cfg, Tournament.RESULTCFG_POINTS_LOSS_KEY, 0)
    points_ot_win = _custom_points_value(
        cfg, Tournament.RESULTCFG_POINTS_OVERTIME_WIN_KEY, points_win
    )
    points_ot_loss = _custom_points_value(
        cfg, Tournament.RESULTCFG_POINTS_OVERTIME_LOSS_KEY, points_loss
    )
    points_so_win = _custom_points_value(
        cfg, Tournament.RESULTCFG_POINTS_SHOOTOUT_WIN_KEY, points_win
    )
    points_so_loss = _custom_points_value(
        cfg, Tournament.RESULTCFG_POINTS_SHOOTOUT_LOSS_KEY, points_loss
    )

    if outcome_type == "DRAW":
        home.draws += 1
        away.draws += 1
        home.points += points_draw
        away.points += points_draw
        return

    if winner_id == match.home_team_id:
        winner = home
        loser = away
        winner_is_away = False
    else:
        winner = away
        loser = home
        winner_is_away = True

    winner.wins += 1
    if winner_is_away:
        winner.away_wins += 1
    loser.losses += 1

    if outcome_type == "OVERTIME":
        winner.points += points_ot_win
        loser.points += points_ot_loss
        return

    if outcome_type == "SHOOTOUT":
        winner.penalty_wins += 1
        loser.penalty_losses += 1
        winner.points += points_so_win
        loser.points += points_so_loss
        return

    winner.points += points_win
    loser.points += points_loss


def _apply_match_result(
    rows: dict[int, StandingRow],
    match: Match,
    tournament: Tournament,
) -> None:
    home = rows.get(match.home_team_id)
    away = rows.get(match.away_team_id)
    if not home or not away:
        return

    hs, aws = final_score(match)

    home.played += 1
    away.played += 1

    home.goals_for += hs
    home.goals_against += aws
    away.goals_for += aws
    away.goals_against += hs

    discipline = getattr(tournament, "discipline", None)
    is_handball = discipline in (
        Tournament.Discipline.HANDBALL,
        "handball",
        "HANDBALL",
    )
    is_tennis = discipline in (
        Tournament.Discipline.TENNIS,
        "tennis",
        "TENNIS",
    )

    if is_tennis:
        home_games, away_games = _tennis_games_from_match(match)
        home.games_for += home_games
        home.games_against += away_games
        away.games_for += away_games
        away.games_against += home_games

        if hs > aws:
            home.wins += 1
            away.losses += 1
        elif hs < aws:
            away.wins += 1
            away.away_wins += 1
            home.losses += 1
        else:
            home.draws += 1
            away.draws += 1
            return

        mode = _tennis_points_mode(tournament)
        if mode == "PLT":
            points_home, points_away = _plt_points_from_sets(match, hs, aws)
            home.points += points_home
            away.points += points_away

        return

    if not is_handball:
        if hs > aws:
            home.wins += 1
            away.losses += 1
            home.points += 3
            return

        if hs < aws:
            away.wins += 1
            away.away_wins += 1
            home.losses += 1
            away.points += 3
            return

        home.draws += 1
        away.draws += 1
        home.points += 1
        away.points += 1
        return

    if hs > aws:
        home.wins += 1
        away.losses += 1
        home.points += 3
        return

    if hs < aws:
        away.wins += 1
        away.away_wins += 1
        home.losses += 1
        away.points += 3
        return

    if (
        match.decided_by_penalties
        and match.home_penalty_score is not None
        and match.away_penalty_score is not None
    ):
        if match.home_penalty_score > match.away_penalty_score:
            home.wins += 1
            home.penalty_wins += 1
            away.losses += 1
            away.penalty_losses += 1
            home.points += 2
            away.points += 1
        elif match.home_penalty_score < match.away_penalty_score:
            away.wins += 1
            away.penalty_wins += 1
            away.away_wins += 1
            home.losses += 1
            home.penalty_losses += 1
            away.points += 2
            home.points += 1
        else:
            home.draws += 1
            away.draws += 1
    else:
        home.draws += 1
        away.draws += 1
        home.points += 1
        away.points += 1
