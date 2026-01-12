from __future__ import annotations

from typing import Any, Iterable, Tuple

from tournaments.models import Group, Match, Stage, Team, Tournament
from tournaments.services.match_outcome import final_score
from tournaments.services.standings.rulesets.base import StandingsRuleset
from tournaments.services.standings.rulesets.football import FootballPZPNRuleset
from tournaments.services.standings.rulesets.handball import HandballSuperligaRuleset
from tournaments.services.standings.rulesets.tennis import TennisRuleset
from tournaments.services.standings.types import StandingRow


BYE_TEAM_NAME = "__SYSTEM_BYE__"


def _get_ruleset(tournament: Tournament) -> StandingsRuleset:
    discipline = getattr(tournament, "discipline", None)

    if discipline in ("football", "FOOTBALL"):
        return FootballPZPNRuleset()
    if discipline in ("handball", "HANDBALL"):
        return HandballSuperligaRuleset()
    if discipline in ("tennis", "TENNIS"):
        return TennisRuleset()

    return FootballPZPNRuleset()


def compute_stage_standings(
    tournament: Tournament,
    stage: Stage,
    group: Group | None = None,
) -> list[StandingRow]:
    """
    Kluczowa zasada (Wariant B):
    - Standings liczymy z uczestników *kontekstu etapu/grupy*,
      a nie z Team.is_active.
    Dzięki temu:
    - po awansie do KO i zmianie is_active drużyny NIE znikają z tabel grup,
    - zmiany wyników w grupach nadal mogą zmienić kolejność/awans.
    """
    ruleset = _get_ruleset(tournament)

    teams = _get_teams_for_context(tournament, stage, group)
    rows = _initialize_rows(teams)

    finished_matches = list(_get_finished_matches(stage, group))
    all_stage_matches = list(_get_all_matches(stage, group))

    for match in finished_matches:
        _apply_match_result(rows, match, tournament)

    # różnice “setów” (tenis) lub bramek/punktów (inne)
    for row in rows.values():
        row.goal_difference = row.goals_for - row.goals_against
        row.games_difference = row.games_for - row.games_against

    return ruleset.sort_rows(rows.values(), finished_matches, all_stage_matches)


def _get_teams_for_context(tournament: Tournament, stage: Stage, group: Group | None) -> list[Team]:
    # UWAGA: standings mają pokazywać skład z meczów/turnieju,
    # a nie zależeć od Team.is_active (bo eliminacje ≠ dezaktywacja).
    if group is None:
        return list(tournament.teams.exclude(name=BYE_TEAM_NAME).order_by("id"))

    team_ids = set(
        Match.objects.filter(stage=stage, group=group).values_list("home_team_id", flat=True)
    ) | set(
        Match.objects.filter(stage=stage, group=group).values_list("away_team_id", flat=True)
    )

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
    return {t.id: StandingRow(team_id=t.id, team_name=t.name) for t in teams}


def _safe_int(v: Any) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def _tennis_games_from_match(match: Match) -> Tuple[int, int]:
    """
    Tenis: z match.tennis_sets wyliczamy sumę gemów:
    - home_games = suma set_obj["home_games"]
    - away_games = suma set_obj["away_games"]

    Tie-break (home_tiebreak/away_tiebreak) NIE jest liczony jako gemy.
    Funkcja jest defensywna: jeśli struktura jest częściowo błędna, liczy to co się da.
    """
    sets = getattr(match, "tennis_sets", None)
    if not isinstance(sets, list):
        return (0, 0)

    hg_sum = 0
    ag_sum = 0

    for s in sets:
        if not isinstance(s, dict):
            continue
        hg_sum += _safe_int(s.get("home_games"))
        ag_sum += _safe_int(s.get("away_games"))

    return (hg_sum, ag_sum)


def _apply_match_result(rows: dict[int, StandingRow], match: Match, tournament: Tournament) -> None:
    home = rows.get(match.home_team_id)
    away = rows.get(match.away_team_id)
    if not home or not away:
        return

    hs, aws = final_score(match)

    home.played += 1
    away.played += 1

    # goals_*:
    # - tenis: sety (final_score = sety)
    # - inne: bramki/punkty (final_score = reg+ET)
    home.goals_for += hs
    home.goals_against += aws
    away.goals_for += aws
    away.goals_against += hs

    discipline = getattr(tournament, "discipline", None)
    is_handball = discipline in ("handball", "HANDBALL")
    is_tennis = discipline in ("tennis", "TENNIS")

    # -----------------------
    # TENIS: punkty + gemy
    # -----------------------
    if is_tennis:
        # gemy jako tie-break w tabeli
        home_games, away_games = _tennis_games_from_match(match)
        home.games_for += home_games
        home.games_against += away_games
        away.games_for += away_games
        away.games_against += home_games

        # 1 pkt za zwycięstwo (spójne z Twoją dotychczasową logiką)
        if hs > aws:
            home.wins += 1
            away.losses += 1
            home.points += 1
            return

        if hs < aws:
            away.wins += 1
            away.away_wins += 1  # nie ma znaczenia w tenisie, ale pole istnieje
            home.losses += 1
            away.points += 1
            return

        # defensywny fallback (remis w setach nie powinien przejść walidacji)
        home.draws += 1
        away.draws += 1
        return

    # -----------------------
    # FOOTBALL / HANDBALL: standard 3 pkt za wygraną
    # -----------------------
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

    # remis po wyniku końcowym (reg+dogrywka)
    if is_handball:
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
                # teoretycznie nie powinno się zdarzyć w karnych
                home.draws += 1
                away.draws += 1
        else:
            home.draws += 1
            away.draws += 1
            home.points += 1
            away.points += 1
        return

    # football / default
    home.draws += 1
    away.draws += 1
    home.points += 1
    away.points += 1
