# backend/tournaments/services/match_periods.py
# Plik centralizuje kontrakt okresów gry używany przez zegar, incydenty i komentarze live.

from __future__ import annotations

from dataclasses import dataclass

from tournaments.models import Match, Tournament


@dataclass(frozen=True)
class MatchPeriodSpec:
    value: str
    label: str
    base_seconds: int
    limit_seconds: int | None
    is_extra_time: bool = False
    is_break: bool = False


def _p(name: str, fallback: str) -> str:
    return getattr(Match.ClockPeriod, name, fallback)


def _discipline(match: Match) -> str:
    return str(getattr(match.tournament, "discipline", "") or "").lower()


def period_specs_for_discipline(discipline: str) -> tuple[MatchPeriodSpec, ...]:
    value = str(discipline or "").lower()

    if value == str(Tournament.Discipline.FOOTBALL).lower() or value == "football":
        return (
            MatchPeriodSpec(_p("FH", "FH"), "1 połowa", 0, 45 * 60),
            MatchPeriodSpec(_p("SH", "SH"), "2 połowa", 45 * 60, 45 * 60),
            MatchPeriodSpec(_p("ET1", "ET1"), "Dogrywka 1", 90 * 60, 15 * 60, is_extra_time=True),
            MatchPeriodSpec(_p("ET2", "ET2"), "Dogrywka 2", 105 * 60, 15 * 60, is_extra_time=True),
        )

    if value == str(Tournament.Discipline.HANDBALL).lower() or value == "handball":
        return (
            MatchPeriodSpec(_p("H1", "H1"), "1 połowa", 0, 30 * 60),
            MatchPeriodSpec(_p("H2", "H2"), "2 połowa", 30 * 60, 30 * 60),
            MatchPeriodSpec(_p("ET1", "ET1"), "Dogrywka 1", 60 * 60, 5 * 60, is_extra_time=True),
            MatchPeriodSpec(_p("ET2", "ET2"), "Dogrywka 2", 65 * 60, 5 * 60, is_extra_time=True),
        )

    if value == str(Tournament.Discipline.BASKETBALL).lower() or value == "basketball":
        return (
            MatchPeriodSpec(_p("Q1", "Q1"), "1 kwarta", 0, 10 * 60),
            MatchPeriodSpec(_p("Q2", "Q2"), "2 kwarta", 10 * 60, 10 * 60),
            MatchPeriodSpec(_p("Q3", "Q3"), "3 kwarta", 20 * 60, 10 * 60),
            MatchPeriodSpec(_p("Q4", "Q4"), "4 kwarta", 30 * 60, 10 * 60),
            MatchPeriodSpec(_p("OT1", "OT1"), "Dogrywka 1", 40 * 60, 5 * 60, is_extra_time=True),
            MatchPeriodSpec(_p("OT2", "OT2"), "Dogrywka 2", 45 * 60, 5 * 60, is_extra_time=True),
            MatchPeriodSpec(_p("OT3", "OT3"), "Dogrywka 3", 50 * 60, 5 * 60, is_extra_time=True),
            MatchPeriodSpec(_p("OT4", "OT4"), "Dogrywka 4", 55 * 60, 5 * 60, is_extra_time=True),
        )

    if value == str(Tournament.Discipline.WRESTLING).lower() or value == "wrestling":
        return (
            MatchPeriodSpec(_p("P1", "P1"), "1 okres", 0, 3 * 60),
            MatchPeriodSpec(_p("BREAK", "BREAK"), "Przerwa", 3 * 60, 30, is_break=True),
            MatchPeriodSpec(_p("P2", "P2"), "2 okres", 3 * 60, 3 * 60),
        )

    return ()


def period_spec_map_for_match(match: Match) -> dict[str, MatchPeriodSpec]:
    return {item.value: item for item in period_specs_for_discipline(_discipline(match))}


def allowed_periods_for_match(match: Match) -> set[str]:
    values = set(period_spec_map_for_match(match).keys())
    values.add(_p("NONE", "NONE"))
    return values


def default_period_for_match(match: Match) -> str:
    specs = period_specs_for_discipline(_discipline(match))
    return specs[0].value if specs else _p("NONE", "NONE")


def is_extra_time_period(period: str | None) -> bool:
    value = str(period or "").strip().upper()
    return value in {"ET", "ET1", "ET2", "OT", "OT1", "OT2", "OT3", "OT4"}


def is_break_period_for_match(match: Match, period: str | None) -> bool:
    spec = period_spec_map_for_match(match).get(str(period or ""))
    return bool(spec and spec.is_break)


def period_base_offset_seconds(match: Match, period: str | None = None) -> int:
    value = str(period or match.clock_period or "")
    spec = period_spec_map_for_match(match).get(value)
    return int(spec.base_seconds) if spec else 0


def period_limit_seconds(match: Match, period: str | None = None) -> int | None:
    value = str(period or match.clock_period or "")
    spec = period_spec_map_for_match(match).get(value)
    return spec.limit_seconds if spec else None


def default_period_for_score_scope(discipline: str, scope: str) -> str:
    scope_value = str(scope or "").strip().upper()
    discipline_value = str(discipline or "").strip().lower()

    if scope_value in {"EXTRA_TIME", "ET", "OT"}:
        if discipline_value in {str(Tournament.Discipline.BASKETBALL).lower(), "basketball"}:
            return _p("OT1", "OT1")
        return _p("ET1", "ET1")

    if discipline_value in {str(Tournament.Discipline.BASKETBALL).lower(), "basketball"}:
        return _p("Q1", "Q1")
    if discipline_value in {str(Tournament.Discipline.HANDBALL).lower(), "handball"}:
        return _p("H1", "H1")
    if discipline_value in {str(Tournament.Discipline.WRESTLING).lower(), "wrestling"}:
        return _p("P1", "P1")
    if discipline_value in {str(Tournament.Discipline.FOOTBALL).lower(), "football"}:
        return _p("FH", "FH")

    return _p("NONE", "NONE")
