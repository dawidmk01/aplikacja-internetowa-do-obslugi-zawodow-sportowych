from __future__ import annotations

from typing import Optional, Tuple

from tournaments.models import Match


def regular_score(match: Match) -> Tuple[int, int]:
    return (int(match.home_score or 0), int(match.away_score or 0))


def extra_time_score(match: Match) -> Tuple[int, int]:
    if not getattr(match, "went_to_extra_time", False):
        return (0, 0)
    return (int(match.home_extra_time_score or 0), int(match.away_extra_time_score or 0))


def final_score(match: Match) -> Tuple[int, int]:
    rh, ra = regular_score(match)
    eh, ea = extra_time_score(match)
    return (rh + eh, ra + ea)


def is_draw_after_final(match: Match) -> bool:
    fh, fa = final_score(match)
    return fh == fa


def penalty_winner_id(match: Match) -> Optional[int]:
    """
    Zwraca winner_id z karnych, jeśli:
    - decided_by_penalties=True
    - oba wyniki karne są ustawione
    - nie są równe
    """
    if not match.decided_by_penalties:
        return None
    if match.home_penalty_score is None or match.away_penalty_score is None:
        return None
    if match.home_penalty_score == match.away_penalty_score:
        return None
    return match.home_team_id if match.home_penalty_score > match.away_penalty_score else match.away_team_id


def knockout_winner_id(match: Match) -> Optional[int]:
    """
    KO: najpierw wynik końcowy (reg+dogrywka), jeśli remis -> karne.
    """
    fh, fa = final_score(match)
    if fh != fa:
        return match.home_team_id if fh > fa else match.away_team_id
    return penalty_winner_id(match)


def validate_penalties_consistency(match: Match) -> Optional[str]:
    """
    Miękka walidacja spójności danych:
    - karne mają sens tylko jeśli wynik końcowy jest remisowy.
    """
    if match.decided_by_penalties:
        if not is_draw_after_final(match):
            return "Karne mogą wystąpić wyłącznie przy remisie po regulaminie/dogrywce."
        if penalty_winner_id(match) is None:
            return "Jeśli zaznaczono karne, musisz podać różny wynik karnych (home_penalty_score != away_penalty_score)."
    return None


def validate_extra_time_consistency(match: Match) -> Optional[str]:
    if getattr(match, "went_to_extra_time", False):
        if match.home_extra_time_score is None or match.away_extra_time_score is None:
            return "Jeśli zaznaczono dogrywkę, musisz podać wynik dogrywki (home_extra_time_score, away_extra_time_score)."
    return None


def team_goals_in_match(match: Match, team_id: int) -> int:
    """
    Gole drużyny w meczu do agregatu (reg+dogrywka). Karne nie wchodzą.
    """
    fh, fa = final_score(match)
    if match.home_team_id == team_id:
        return fh
    if match.away_team_id == team_id:
        return fa
    return 0
