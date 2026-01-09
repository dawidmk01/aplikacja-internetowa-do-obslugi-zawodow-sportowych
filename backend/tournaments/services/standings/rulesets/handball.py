from __future__ import annotations

from itertools import groupby
from typing import Dict, Iterable, List, Tuple, Set

from tournaments.models import Match
from tournaments.services.standings.types import StandingRow
from tournaments.services.standings.rulesets.base import StandingsRuleset
from tournaments.services.match_outcome import final_score


class HandballRuleset(StandingsRuleset):
    """
    Piłka ręczna – zasady tabeli wzorowane na regulaminie Superligi.

    Punktacja (założenie):
    - Wygrana w reg. czasie: 3 pkt
    - Wygrana po karnych: 2 pkt
    - Porażka po karnych: 1 pkt
    - Porażka w reg. czasie: 0 pkt

    Kolejność sortowania:
    1. W trakcie etapu: Pkt -> Bilans ogólny -> Bramki ogólne -> Nazwa
    2. Po etapie (dla miejsc ex aequo punktowo):
       - Mała tabela (mecze bezpośrednie): Pkt H2H -> Bilans H2H -> Bramki H2H
       - Jeśli nadal remis: Bilans ogólny -> Bramki ogólne -> Nazwa
    """

    def sort_rows(
            self,
            rows: Iterable[StandingRow],
            finished_matches: List[Match],
            all_stage_matches: List[Match],
    ) -> List[StandingRow]:
        # Konwersja na listę, aby móc sortować wielokrotnie
        rows_list = list(rows)

        # Sprawdzenie, czy wszystkie mecze w etapie są zakończone
        stage_complete = all(m.status == Match.Status.FINISHED for m in all_stage_matches)

        # 1. Sortowanie wstępne (Dla "W trakcie" jest to finalne. Dla "Po etapie" ustawia kolejność grup).
        # Klucz: Pkt DESC, Bilans DESC, Bramki zdobyte DESC, Nazwa ASC
        rows_list.sort(
            key=lambda r: (
                -r.points,
                -r.goal_difference,
                -r.goals_for,
                r.team_name.lower(),
                r.team_id,
            )
        )

        if not stage_complete:
            return rows_list

        # 2. Etap zakończony -> Rozstrzyganie remisów punktowych (H2H)
        result: List[StandingRow] = []

        # Używamy groupby, ponieważ lista jest już posortowana po punktach (malejąco)
        for points, group in groupby(rows_list, key=lambda r: r.points):
            block = list(group)

            # Jeśli w grupie punktowej jest tylko jedna drużyna, nie ma co liczyć H2H
            if len(block) == 1:
                result.append(block[0])
                continue

            # Mamy remis punktowy (2 lub więcej drużyn) -> Liczymy H2H
            tied_ids = {r.team_id for r in block}
            h2h_pts, h2h_diff, h2h_gf = _compute_h2h_stats(tied_ids, finished_matches)

            block.sort(
                key=lambda r: (
                    -h2h_pts.get(r.team_id, 0),  # 1. Pkt w meczach bezpośrednich
                    -h2h_diff.get(r.team_id, 0),  # 2. Różnica bramek w meczach bezpośrednich
                    -h2h_gf.get(r.team_id, 0),  # 3. Bramki zdobyte w meczach bezpośrednich
                    -r.goal_difference,  # 4. Fallback: Bilans ogólny
                    -r.goals_for,  # 5. Fallback: Bramki ogólne
                    r.team_name.lower(),  # 6. Nazwa
                    r.team_id,  # 7. ID (determinizm)
                )
            )
            result.extend(block)

        return result


def _compute_h2h_stats(
        tied_team_ids: Set[int],
        finished_matches: List[Match],
) -> Tuple[Dict[int, int], Dict[int, int], Dict[int, int]]:
    """
    Oblicza statystyki H2H dla podzbioru drużyn.
    Zwraca krotkę słowników: (punkty, różnica_bramek, bramki_zdobyte).
    """
    pts: Dict[int, int] = {tid: 0 for tid in tied_team_ids}
    diff: Dict[int, int] = {tid: 0 for tid in tied_team_ids}
    gf: Dict[int, int] = {tid: 0 for tid in tied_team_ids}

    # Iterujemy tylko raz po zakończonych meczach
    for m in finished_matches:
        h_id = m.home_team_id
        a_id = m.away_team_id

        # Interesują nas tylko mecze "wewnętrzne" pomiędzy zainteresowanymi drużynami
        if h_id not in tied_team_ids or a_id not in tied_team_ids:
            continue

        # Wynik bramkowy (zwykle bez karnych decydujących o awansie, tylko gra)
        hs, aws = final_score(m)

        # Aktualizacja bramek i różnicy
        gf[h_id] += hs
        gf[a_id] += aws
        diff[h_id] += (hs - aws)
        diff[a_id] += (aws - hs)

        # Logika punktowa (3-2-1-0)
        if hs > aws:
            pts[h_id] += 3
        elif hs < aws:
            pts[a_id] += 3
        else:
            # Remis bramkowy -> sprawdzamy karne
            if (
                    m.decided_by_penalties
                    and m.home_penalty_score is not None
                    and m.away_penalty_score is not None
            ):
                if m.home_penalty_score > m.away_penalty_score:
                    pts[h_id] += 2
                    pts[a_id] += 1
                elif m.home_penalty_score < m.away_penalty_score:
                    pts[a_id] += 2
                    pts[h_id] += 1
                else:
                    # Teoretycznie niemożliwe w karnych, ale bezpieczny fallback
                    pts[h_id] += 1
                    pts[a_id] += 1
            else:
                # Czysty remis (np. faza grupowa bez przymusu wyłaniania zwycięzcy
                # lub brak danych o karnych)
                pts[h_id] += 1
                pts[a_id] += 1

    return pts, diff, gf


# Alias kompatybilności
HandballSuperligaRuleset = HandballRuleset