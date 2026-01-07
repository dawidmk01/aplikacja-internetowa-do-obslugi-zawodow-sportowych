"""
Moduł odpowiedzialny za obliczanie tabeli wyników (standings)
dla rozgrywek ligowych oraz faz grupowych.

Tabela jest liczona dynamicznie na podstawie zakończonych meczów.

Zasady kolejności w tabeli zgodne z Uchwałą PZPN (Organ prowadzący rozgrywki) – § 16 ust. 3:
1) punkty (overall)
2) przy równej liczbie punktów:
   - punkty w bezpośrednich spotkaniach (H2H)*
   - różnica bramek w bezpośrednich spotkaniach (H2H)*
3) różnica bramek (overall)
4) bramki zdobyte (overall)
5) liczba zwycięstw (overall)
6) liczba zwycięstw na wyjeździe (overall)
7) stabilny fallback: nazwa, team_id

* Kryteria H2H są stosowane wyłącznie, gdy zostały rozegrane wszystkie zaplanowane mecze
  pomiędzy zainteresowanymi drużynami (tj. wszystkie ich bezpośrednie spotkania w danym etapie).
"""

from __future__ import annotations

from dataclasses import dataclass
from itertools import combinations
from typing import Dict, Iterable, List, Tuple

from tournaments.models import Group, Match, Stage, Team, Tournament


# ============================================================
# STRUKTURA WIERSZA TABELI
# ============================================================

@dataclass
class StandingRow:
    team_id: int
    team_name: str

    played: int = 0
    wins: int = 0
    draws: int = 0
    losses: int = 0

    away_wins: int = 0  # wymagane do tie-breakera PZPN (większa liczba zwycięstw na wyjeździe)

    goals_for: int = 0
    goals_against: int = 0
    goal_difference: int = 0
    points: int = 0


# ============================================================
# API PUBLICZNE
# ============================================================

def compute_stage_standings(
    tournament: Tournament,
    stage: Stage,
    group: Group | None = None,
) -> list[StandingRow]:
    """
    Oblicza tabelę wyników dla wskazanego etapu.

    - dla ligi: group = None
    - dla fazy grupowej: group = konkretna grupa
    """
    teams = _get_teams_for_context(tournament, stage, group)
    rows = _initialize_rows(teams)

    # Do tabeli liczą się wyłącznie mecze zakończone.
    finished_matches_qs = _get_finished_matches(stage, group)
    finished_matches = list(finished_matches_qs)

    for match in finished_matches:
        _apply_match_result(rows, match)

    # RB wyliczana na końcu
    for row in rows.values():
        row.goal_difference = row.goals_for - row.goals_against

    # Do walidacji warunku „wszystkie zaplanowane H2H rozegrane” potrzebne są także mecze niezakończone.
    all_stage_matches = list(_get_all_matches(stage, group))

    return _sort_rows(rows.values(), finished_matches, all_stage_matches)


# ============================================================
# POBIERANIE DANYCH
# ============================================================

def _is_bye_team_name(name: str | None) -> bool:
    if not name:
        return False
    n = name.strip().upper()
    return (
        n == "BYE"
        or "SYSTEM_BYE" in n
        or n == "__SYSTEM_BYE__"
        or "__SYSTEM_BYE__" in n
    )


def _get_teams_for_context(
    tournament: Tournament,
    stage: Stage,
    group: Group | None,
) -> list[Team]:
    """
    Zwraca listę uczestników:
    - liga: wszyscy aktywni uczestnicy turnieju (bez „BYE”)
    - grupa: uczestnicy, którzy występują w meczach tej grupy (bez „BYE”)
    """
    if group is None:
        return list(
            tournament.teams.filter(is_active=True).exclude(name__iexact="BYE")
        )

    team_ids = set(
        Match.objects.filter(stage=stage, group=group).values_list("home_team_id", flat=True)
    ) | set(
        Match.objects.filter(stage=stage, group=group).values_list("away_team_id", flat=True)
    )

    qs = Team.objects.filter(id__in=team_ids)

    # Jeśli w systemie BYE jest osobnym rekordem Team – nie powinien pojawić się w tabeli.
    qs = qs.exclude(name__iexact="BYE")

    # Jeśli korzystasz z is_active dla BYE – warto utrzymać spójność również w grupach.
    qs = qs.filter(is_active=True)

    return list(qs)


def _get_finished_matches(stage: Stage, group: Group | None):
    """
    Zwraca zakończone mecze dla etapu lub grupy.
    """
    qs = Match.objects.filter(stage=stage, status=Match.Status.FINISHED)
    if group:
        qs = qs.filter(group=group)
    return qs


def _get_all_matches(stage: Stage, group: Group | None):
    """
    Zwraca wszystkie mecze dla etapu lub grupy (w tym niezakończone),
    potrzebne do sprawdzenia warunku zastosowania H2H.
    """
    qs = Match.objects.filter(stage=stage)
    if group:
        qs = qs.filter(group=group)
    return qs


# ============================================================
# LOGIKA TABELI
# ============================================================

def _initialize_rows(teams: list[Team]) -> dict[int, StandingRow]:
    # Ochrona przed „BYE” nawet jeśli przeszło przez QS.
    filtered = [t for t in teams if not _is_bye_team_name(t.name)]
    return {
        team.id: StandingRow(
            team_id=team.id,
            team_name=team.name,
        )
        for team in filtered
    }


def _apply_match_result(
    rows: dict[int, StandingRow],
    match: Match,
) -> None:
    home = rows.get(match.home_team_id)
    away = rows.get(match.away_team_id)

    if not home or not away:
        return

    hs = match.home_score or 0
    aws = match.away_score or 0

    home.played += 1
    away.played += 1

    home.goals_for += hs
    home.goals_against += aws
    away.goals_for += aws
    away.goals_against += hs

    if hs > aws:
        home.wins += 1
        away.losses += 1
        home.points += 3
    elif hs < aws:
        away.wins += 1
        away.away_wins += 1  # zwycięstwo na wyjeździe
        home.losses += 1
        away.points += 3
    else:
        home.draws += 1
        away.draws += 1
        home.points += 1
        away.points += 1


# --------------------------
# HEAD-TO-HEAD (H2H)
# --------------------------

def _all_h2h_matches_finished(
    tied_team_ids: set[int],
    all_stage_matches: List[Match],
) -> bool:
    """
    Warunek z §16 ust.3 pkt 3:
    H2H (lit. a-b) stosuje się wyłącznie, gdy zostały rozegrane wszystkie zaplanowane mecze
    pomiędzy zainteresowanymi drużynami.

    Implementacja:
    - dla każdej pary drużyn w bloku remisowym musi istnieć co najmniej jeden mecz w etapie,
    - oraz wszystkie mecze tej pary muszą mieć status FINISHED.
    """
    if len(tied_team_ids) < 2:
        return False

    pair_statuses: Dict[Tuple[int, int], List[str]] = {}

    for m in all_stage_matches:
        h = m.home_team_id
        a = m.away_team_id
        if h in tied_team_ids and a in tied_team_ids:
            p = (min(h, a), max(h, a))
            pair_statuses.setdefault(p, []).append(m.status)

    for t1, t2 in combinations(sorted(tied_team_ids), 2):
        p = (t1, t2)
        statuses = pair_statuses.get(p)
        if not statuses:
            return False
        if not all(s == Match.Status.FINISHED for s in statuses):
            return False

    return True


def _compute_h2h_stats(
    tied_team_ids: set[int],
    finished_matches: List[Match],
) -> Dict[int, Tuple[int, int]]:
    """
    Statystyki H2H dla podzbioru drużyn (mini-tabela):
    (punkty_h2h, gd_h2h)
    """
    # pts, gd
    stats: Dict[int, List[int]] = {tid: [0, 0] for tid in tied_team_ids}

    for m in finished_matches:
        h = m.home_team_id
        a = m.away_team_id
        if h not in tied_team_ids or a not in tied_team_ids:
            continue

        hs = m.home_score or 0
        aws = m.away_score or 0

        # różnica bramek w H2H
        stats[h][1] += (hs - aws)
        stats[a][1] += (aws - hs)

        # punkty w H2H
        if hs > aws:
            stats[h][0] += 3
        elif hs < aws:
            stats[a][0] += 3
        else:
            stats[h][0] += 1
            stats[a][0] += 1

    return {tid: (v[0], v[1]) for tid, v in stats.items()}


def _sort_rows(
    rows: Iterable[StandingRow],
    finished_matches: List[Match],
    all_stage_matches: List[Match],
) -> List[StandingRow]:
    """
    Sortowanie tabeli zgodnie z §16 ust.3 (PZPN).

    Uwaga:
    - blokowanie po „overall points” jest konieczne, bo H2H stosuje się wyłącznie w obrębie remisu punktowego,
    - H2H jest używane tylko wtedy, gdy wszystkie bezpośrednie mecze w danym bloku zostały rozegrane.
    """
    rows_list = list(rows)

    # Sort wstępny – wyłącznie po punktach, aby bloki remisowe były spójne.
    rows_list.sort(
        key=lambda r: (
            -r.points,
            r.team_name.lower(),
            r.team_id,
        )
    )

    result: List[StandingRow] = []
    i = 0
    n = len(rows_list)

    while i < n:
        j = i + 1
        while j < n and rows_list[j].points == rows_list[i].points:
            j += 1

        block = rows_list[i:j]
        if len(block) <= 1:
            result.extend(block)
            i = j
            continue

        tied_ids = {r.team_id for r in block}

        use_h2h = _all_h2h_matches_finished(tied_ids, all_stage_matches)

        if use_h2h:
            h2h = _compute_h2h_stats(tied_ids, finished_matches)

            block.sort(
                key=lambda r: (
                    -h2h.get(r.team_id, (0, 0))[0],   # H2H points
                    -h2h.get(r.team_id, (0, 0))[1],   # H2H goal diff
                    -r.goal_difference,               # overall GD
                    -r.goals_for,                     # overall goals scored
                    -r.wins,                          # overall wins
                    -r.away_wins,                     # overall away wins
                    r.team_name.lower(),
                    r.team_id,
                )
            )
        else:
            # Gdy H2H nie może być zastosowane (nie wszystkie bezpośrednie mecze rozegrane),
            # przechodzimy od razu do kryteriów ogólnych.
            block.sort(
                key=lambda r: (
                    -r.goal_difference,               # overall GD
                    -r.goals_for,                     # overall goals scored
                    -r.wins,                          # overall wins
                    -r.away_wins,                     # overall away wins
                    r.team_name.lower(),
                    r.team_id,
                )
            )

        result.extend(block)
        i = j

    return result
