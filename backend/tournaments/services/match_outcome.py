# backend/tournaments/services/match_outcome.py
# Plik udostępnia helpery obliczające wynik końcowy, zwycięzcę i spójność danych meczu.

from __future__ import annotations

from typing import Optional, Tuple

from tournaments.models import Match


def _discipline(match: Match) -> str:
    # Bezpieczny odczyt dyscypliny chroni helpery przed błędem na niepełnym obiekcie.
    try:
        return (getattr(match.tournament, "discipline", "") or "").lower()
    except Exception:
        return ""


def _wrestling_method(match: Match) -> str:
    return str(getattr(match, "wrestling_result_method", "") or "").upper().strip()


def _disallows_extra_time(match: Match) -> bool:
    discipline = _discipline(match)
    return discipline in {"tennis", "wrestling"}


def _disallows_penalties(match: Match) -> bool:
    discipline = _discipline(match)
    return discipline in {"tennis", "basketball", "wrestling"}


def regular_score(match: Match) -> Tuple[int, int]:
    return (int(match.home_score or 0), int(match.away_score or 0))


def extra_time_score(match: Match) -> Tuple[int, int]:
    if _disallows_extra_time(match):
        return (0, 0)

    if not getattr(match, "went_to_extra_time", False):
        return (0, 0)

    return (
        int(match.home_extra_time_score or 0),
        int(match.away_extra_time_score or 0),
    )


def final_score(match: Match) -> Tuple[int, int]:
    regular_home, regular_away = regular_score(match)
    extra_home, extra_away = extra_time_score(match)
    return (regular_home + extra_home, regular_away + extra_away)


def is_draw_after_final(match: Match) -> bool:
    final_home, final_away = final_score(match)
    return final_home == final_away


def penalty_winner_id(match: Match) -> Optional[int]:
    if _disallows_penalties(match):
        return None

    if not match.decided_by_penalties:
        return None
    if match.home_penalty_score is None or match.away_penalty_score is None:
        return None
    if match.home_penalty_score == match.away_penalty_score:
        return None
    return (
        match.home_team_id
        if match.home_penalty_score > match.away_penalty_score
        else match.away_team_id
    )


def knockout_winner_id(match: Match) -> Optional[int]:
    final_home, final_away = final_score(match)
    if final_home != final_away:
        return match.home_team_id if final_home > final_away else match.away_team_id

    # Przy remisie KO próbuje rozstrzygnięcia karnymi wyłącznie w dyscyplinach, które je dopuszczają.
    if _disallows_penalties(match):
        return None

    return penalty_winner_id(match)


def validate_penalties_consistency(match: Match) -> Optional[str]:
    discipline = _discipline(match)

    if discipline == "tennis":
        if (
            match.decided_by_penalties
            or match.home_penalty_score is not None
            or match.away_penalty_score is not None
        ):
            return "W tenisie karne są niedozwolone."
        return None

    if discipline == "basketball":
        if (
            match.decided_by_penalties
            or match.home_penalty_score is not None
            or match.away_penalty_score is not None
        ):
            return "W koszykówce karne są niedozwolone."
        return None

    if discipline == "wrestling":
        if (
            match.decided_by_penalties
            or match.home_penalty_score is not None
            or match.away_penalty_score is not None
        ):
            return "W zapasach karne są niedozwolone."
        return None

    # Karne mają sens wyłącznie przy remisie po regulaminie i dogrywce.
    if match.decided_by_penalties:
        if not is_draw_after_final(match):
            return "Karne mogą wystąpić wyłącznie przy remisie po regulaminie/dogrywce."
        if penalty_winner_id(match) is None:
            return (
                "Jeśli zaznaczono karne, musisz podać różny wynik karnych "
                "(home_penalty_score != away_penalty_score)."
            )
    return None


def validate_extra_time_consistency(match: Match) -> Optional[str]:
    discipline = _discipline(match)

    if discipline == "tennis":
        if (
            getattr(match, "went_to_extra_time", False)
            or match.home_extra_time_score is not None
            or match.away_extra_time_score is not None
        ):
            return "W tenisie dogrywka jest niedozwolona."
        return None

    if discipline == "wrestling":
        if (
            getattr(match, "went_to_extra_time", False)
            or match.home_extra_time_score is not None
            or match.away_extra_time_score is not None
        ):
            return "W zapasach dogrywka jest niedozwolona."
        return None

    if getattr(match, "went_to_extra_time", False):
        if match.home_extra_time_score is None or match.away_extra_time_score is None:
            return (
                "Jeśli zaznaczono dogrywkę, musisz podać wynik dogrywki "
                "(home_extra_time_score, away_extra_time_score)."
            )

    return None


def validate_basketball_consistency(match: Match) -> Optional[str]:
    if _discipline(match) != "basketball":
        return None

    if match.decided_by_penalties:
        return "W koszykówce karne są niedozwolone."

    if is_draw_after_final(match):
        return (
            "W koszykówce wynik końcowy nie może pozostać remisowy. "
            "Jeśli po czasie podstawowym był remis, mecz powinien zostać rozstrzygnięty dogrywką."
        )

    return None


def validate_wrestling_consistency(match: Match) -> Optional[str]:
    if _discipline(match) != "wrestling":
        return None

    if (
        match.decided_by_penalties
        or match.home_penalty_score is not None
        or match.away_penalty_score is not None
    ):
        return "W zapasach karne są niedozwolone."

    if (
        getattr(match, "went_to_extra_time", False)
        or match.home_extra_time_score is not None
        or match.away_extra_time_score is not None
    ):
        return "W zapasach dogrywka jest niedozwolona."

    # W zapasach remis punktów technicznych może wystąpić, ale powinien być wtedy
    # rozstrzygnięty metodą walki albo zapisanym zwycięzcą po kryteriach.
    if (
        match.result_entered
        and int(match.home_score or 0) == int(match.away_score or 0)
        and match.winner_id is None
        and not _wrestling_method(match)
    ):
        return (
            "W zapasach przy remisie punktów technicznych należy wskazać metodę rozstrzygnięcia "
            "lub zwycięzcę wynikającego z kryteriów walki."
        )

    return None


def team_goals_in_match(match: Match, team_id: int) -> int:
    # Agregat liczy wyłącznie regulamin i dogrywkę, bez karnych.
    final_home, final_away = final_score(match)
    if match.home_team_id == team_id:
        return final_home
    if match.away_team_id == team_id:
        return final_away
    return 0
