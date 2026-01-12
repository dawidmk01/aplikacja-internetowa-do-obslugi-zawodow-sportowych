from __future__ import annotations

from typing import Optional, Tuple

from tournaments.models import Match


def _discipline(match: Match) -> str:
    """
    Bezpieczne pobranie dyscypliny z turnieju.
    """
    try:
        return (getattr(match.tournament, "discipline", "") or "").lower()
    except Exception:
        return ""


def regular_score(match: Match) -> Tuple[int, int]:
    """
    Wynik podstawowy:
    - dla piłki/kosza/ręcznej: bramki/punkty w czasie regulaminowym,
    - dla tenisa: liczba setów (wyliczana z tennis_sets w serializerze).
    """
    return (int(match.home_score or 0), int(match.away_score or 0))


def extra_time_score(match: Match) -> Tuple[int, int]:
    """
    Wynik dogrywki:
    - dla większości dyscyplin: dodawany do wyniku końcowego,
    - dla tenisa: dogrywka nie istnieje -> zawsze (0,0).
    """
    if _discipline(match) == "tennis":
        return (0, 0)

    if not getattr(match, "went_to_extra_time", False):
        return (0, 0)

    return (int(match.home_extra_time_score or 0), int(match.away_extra_time_score or 0))


def final_score(match: Match) -> Tuple[int, int]:
    """
    Wynik końcowy:
    - standard: regulamin + dogrywka,
    - tenis: sety (bez dogrywki i bez karnych).
    """
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

    Tenis: karnych nie ma -> zawsze None.
    """
    if _discipline(match) == "tennis":
        return None

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

    Tenis: zwycięzca wynika z setów (final_score), remis niedozwolony.
    """
    fh, fa = final_score(match)
    if fh != fa:
        return match.home_team_id if fh > fa else match.away_team_id

    # Remis:
    # - tenis: niedozwolony -> brak zwycięzcy
    # - inne: próbujemy rozstrzygnąć karnymi
    if _discipline(match) == "tennis":
        return None

    return penalty_winner_id(match)


def validate_penalties_consistency(match: Match) -> Optional[str]:
    """
    Miękka walidacja spójności danych:
    - karne mają sens tylko jeśli wynik końcowy jest remisowy.
    - tenis: karne niedozwolone.
    """
    if _discipline(match) == "tennis":
        if match.decided_by_penalties or match.home_penalty_score is not None or match.away_penalty_score is not None:
            return "W tenisie karne są niedozwolone."
        return None

    if match.decided_by_penalties:
        if not is_draw_after_final(match):
            return "Karne mogą wystąpić wyłącznie przy remisie po regulaminie/dogrywce."
        if penalty_winner_id(match) is None:
            return "Jeśli zaznaczono karne, musisz podać różny wynik karnych (home_penalty_score != away_penalty_score)."
    return None


def validate_extra_time_consistency(match: Match) -> Optional[str]:
    """
    - tenis: dogrywka niedozwolona,
    - pozostałe: jeśli zaznaczona dogrywka, wymagamy wyniku ET.
    """
    if _discipline(match) == "tennis":
        if getattr(match, "went_to_extra_time", False) or match.home_extra_time_score is not None or match.away_extra_time_score is not None:
            return "W tenisie dogrywka jest niedozwolona."
        return None

    if getattr(match, "went_to_extra_time", False):
        if match.home_extra_time_score is None or match.away_extra_time_score is None:
            return "Jeśli zaznaczono dogrywkę, musisz podać wynik dogrywki (home_extra_time_score, away_extra_time_score)."
    return None


def team_goals_in_match(match: Match, team_id: int) -> int:
    """
    Wynik drużyny w meczu do agregatu (reg+dogrywka). Karne nie wchodzą.

    UWAGA:
    - Dla tenisa funkcja zwraca sety (nie gemy).
      Dwumecze w tenisie są blokowane na poziomie logiki turnieju, więc to jest OK.
    """
    fh, fa = final_score(match)
    if match.home_team_id == team_id:
        return fh
    if match.away_team_id == team_id:
        return fa
    return 0
