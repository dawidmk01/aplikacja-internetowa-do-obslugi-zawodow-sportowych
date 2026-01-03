"""
Generator rozgrywek pucharowych (KO – single elimination).

Obsługuje:
- generowanie pierwszej rundy,
- wolne losy (BYE) wyłącznie w pierwszym etapie KO,
- dynamiczne generowanie kolejnych rund po zatwierdzeniu etapu.

Zasady domenowe:
- BYE jest cechą RUNDY, nie zawodnika,
- BYE występuje wyłącznie w PIERWSZYM etapie KO,
- w kolejnych etapach liczba drużyn MUSI być parzysta,
- liczba drużyn maleje aż do jednego zwycięzcy.

Uwaga implementacyjna:
- Aby zachować „pełną rundę” drabinki w bazie (bracket_size/2 par),
  BYE zapisujemy jako walkowerowy Match przeciwko technicznej drużynie systemowej
  (__SYSTEM_BYE__), która ma is_active=False i nie jest traktowana jako uczestnik.
"""

from __future__ import annotations

import math
from collections import defaultdict
from typing import DefaultDict, Iterable, List, Tuple, Optional

from django.db import transaction

from tournaments.models import Match, Stage, Team, Tournament


BYE_TEAM_NAME = "__SYSTEM_BYE__"


# ============================================================
# API PUBLICZNE
# ============================================================

@transaction.atomic
def generate_knockout_stage(tournament: Tournament) -> Stage:
    """
    Generuje PIERWSZY etap fazy pucharowej (KO).

    - Tworzy „pełną rundę” drabinki: bracket_size / 2 par.
    - BYE zapisuje jako walkowerowy Match vs drużyna techniczna __SYSTEM_BYE__.
    """
    _validate_tournament(tournament)

    teams = _get_active_teams(tournament)

    # Jeżeli turniej ma tylko 2 zespoły, to to jest "finał" od razu,
    # ale nadal stosujemy ten sam mechanizm cup_matches.
    cup_matches = _get_cup_matches(tournament)

    stage = Stage.objects.create(
        tournament=tournament,
        stage_type=Stage.StageType.KNOCKOUT,
        order=1,
        status=Stage.Status.OPEN,
    )

    bracket_size = _next_power_of_two(len(teams))
    byes_count = bracket_size - len(teams)

    bye_team: Optional[Team] = None
    if byes_count > 0:
        bye_team = _get_or_create_bye_team(tournament)

    pairs = _build_first_round_pairs(
        teams=teams,
        byes_count=byes_count,
        bye_team=bye_team,
    )

    matches = _build_matches_for_pairs(
        tournament=tournament,
        stage=stage,
        pairs=pairs,
        matches_per_pair=cup_matches,
        bye_team=bye_team,
        round_number=1,
    )

    if len(teams) >= 2 and not matches:
        raise ValueError("Generator pucharowy nie utworzył żadnych meczów.")

    Match.objects.bulk_create(matches)

    tournament.status = Tournament.Status.CONFIGURED
    tournament.save(update_fields=["status"])

    return stage


@transaction.atomic
def generate_next_knockout_stage(stage: Stage) -> Stage:
    """
    Generuje KOLEJNY etap fazy pucharowej na podstawie zwycięzców poprzedniego etapu.

    - Zamykamy bieżący etap.
    - Jeśli pozostaje jeden zwycięzca -> kończymy turniej.
    - W przeciwnym razie tworzymy nowy etap i generujemy mecze (1 lub 2 na parę).
    """
    if stage.stage_type != Stage.StageType.KNOCKOUT:
        raise ValueError("Ten generator obsługuje wyłącznie etap typu KNOCKOUT.")

    if stage.status != Stage.Status.OPEN:
        raise ValueError("Etap został już zamknięty.")

    tournament = stage.tournament
    cup_matches = _get_cup_matches(tournament)

    matches = list(
        stage.matches.select_related("winner", "home_team", "away_team").all()
    )
    if not matches:
        raise ValueError("Brak meczów w etapie KO.")

    # 1) wszystkie mecze muszą być zakończone
    if any(m.status != Match.Status.FINISHED for m in matches):
        raise ValueError("Nie wszystkie mecze etapu są zakończone.")

    # 2) zwycięzcy z par (cup_matches=2 liczy agregat)
    advancers = _collect_pair_winners(matches, cup_matches=cup_matches)

    # 3) deterministycznie (i bez duplikatów)
    advancers = sorted({t.id: t for t in advancers}.values(), key=lambda t: t.id)

    # 4) zamykamy bieżący etap
    stage.status = Stage.Status.CLOSED
    stage.save(update_fields=["status"])

    # 5) jeden zwycięzca → KONIEC TURNIEJU
    if len(advancers) == 1:
        tournament.status = Tournament.Status.FINISHED
        tournament.save(update_fields=["status"])
        return stage

    # 6) w kolejnych etapach liczba drużyn MUSI być parzysta
    if len(advancers) % 2 != 0:
        raise ValueError(
            "Nieprawidłowa liczba awansujących drużyn. "
            "Sprawdź wyniki w bieżącym etapie KO."
        )

    # 7) tworzymy nowy etap
    next_stage = Stage.objects.create(
        tournament=tournament,
        stage_type=Stage.StageType.KNOCKOUT,
        order=stage.order + 1,
        status=Stage.Status.OPEN,
    )

    # 8) parowanie awansujących
    pairs: List[Tuple[Team, Team]] = []
    for i in range(0, len(advancers), 2):
        home = advancers[i]
        away = advancers[i + 1]
        if home.id == away.id:
            raise ValueError("Błąd logiki KO: drużyna nie może grać sama ze sobą.")
        pairs.append((home, away))

    # 9) NAJWAŻNIEJSZA POPRAWKA:
    #    generujemy tyle meczów na parę, ile wynika z cup_matches (1 lub 2),
    #    również w finale i w każdej następnej rundzie.
    created = _build_matches_for_pairs(
        tournament=tournament,
        stage=next_stage,
        pairs=pairs,
        matches_per_pair=cup_matches,
        bye_team=None,
        round_number=1,
    )
    Match.objects.bulk_create(created)

    return next_stage


# ============================================================
# WALIDACJE / KONFIG
# ============================================================

def _get_cup_matches(tournament: Tournament) -> int:
    """
    Liczba meczów na parę w KO:
    - 1 (standard KO)
    - 2 (dwumecz)
    """
    cfg = tournament.format_config or {}
    try:
        cup_matches = int(cfg.get("cup_matches", 1))
    except (TypeError, ValueError):
        cup_matches = 1
    return cup_matches if cup_matches in (1, 2) else 1


def _validate_tournament(tournament: Tournament) -> None:
    if tournament.status != Tournament.Status.DRAFT:
        raise ValueError(
            "Faza pucharowa może być generowana tylko dla turnieju w statusie DRAFT."
        )
    if tournament.tournament_format != Tournament.TournamentFormat.CUP:
        raise ValueError("Generator pucharowy obsługuje wyłącznie format CUP.")


def _get_active_teams(tournament: Tournament) -> List[Team]:
    teams = list(tournament.teams.filter(is_active=True).order_by("id"))
    if len(teams) < 2:
        raise ValueError(
            "Do wygenerowania fazy pucharowej wymaganych jest co najmniej dwóch uczestników."
        )
    return teams


def _get_or_create_bye_team(tournament: Tournament) -> Team:
    """
    Techniczna drużyna do zapisu walkowerów (BYE) jako rekord Match.

    Wymagania:
    - is_active=False,
    - nazwa stała (BYE_TEAM_NAME).
    """
    team, _created = Team.objects.get_or_create(
        tournament=tournament,
        name=BYE_TEAM_NAME,
        defaults={"is_active": False},
    )
    if team.is_active:
        team.is_active = False
        team.save(update_fields=["is_active"])
    return team


# ============================================================
# LOGIKA DRABINKI – RUNDA 1
# ============================================================

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
        return [(teams[i], teams[i + 1]) for i in range(0, len(teams), 2)]

    if bye_team is None:
        raise ValueError("byes_count > 0 wymaga istnienia drużyny BYE.")

    if byes_count >= len(teams):
        raise ValueError("Nieprawidłowa liczba BYE względem liczby drużyn.")

    bye_teams = teams[:byes_count]
    play_teams = teams[byes_count:]

    if len(play_teams) % 2 != 0:
        raise ValueError(
            "Błąd seeding KO: liczba drużyn grających w 1 rundzie musi być parzysta."
        )

    pairs: List[Tuple[Team, Team]] = []
    pairs.extend([(t, bye_team) for t in bye_teams])
    pairs.extend([(play_teams[i], play_teams[i + 1]) for i in range(0, len(play_teams), 2)])
    return pairs


def _build_matches_for_pairs(
    tournament: Tournament,
    stage: Stage,
    pairs: Iterable[Tuple[Team, Team]],
    matches_per_pair: int,
    bye_team: Optional[Team],
    round_number: int,
) -> List[Match]:
    """
    Tworzy rekordy Match dla par.

    - Dla (team, __SYSTEM_BYE__) tworzy 1 mecz walkowerowy FINISHED z winner=team.
      (nie mnożymy walkowerów przez matches_per_pair)
    - Dla (team, team) tworzy matches_per_pair meczów (np. dwumecz), z rewanżem (zamiana home/away).
    """
    matches: List[Match] = []
    bye_id = bye_team.id if bye_team else None

    for home, away in pairs:
        # WALKOWER (BYE) -> 1 rekord, od razu zakończony
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

        if matches_per_pair not in (1, 2):
            matches_per_pair = 1

        for leg in range(matches_per_pair):
            h, a = (home, away) if leg == 0 else (away, home)
            matches.append(
                Match(
                    tournament=tournament,
                    stage=stage,
                    home_team=h,
                    away_team=a,
                    round_number=round_number,
                    status=Match.Status.SCHEDULED,
                )
            )

    return matches


# ============================================================
# KOLEJNE RUNY – ZWYCIĘZCY (W TYM WALKOWERY)
# ============================================================

def _pair_key(m: Match) -> Tuple[int, int]:
    a = m.home_team_id
    b = m.away_team_id
    return (a, b) if a < b else (b, a)


def _team_from_group(group: List[Match], team_id: int) -> Team:
    for m in group:
        if m.home_team_id == team_id:
            return m.home_team
        if m.away_team_id == team_id:
            return m.away_team
        if m.winner_id == team_id and m.winner is not None:
            return m.winner
    # awaryjnie dociągamy z DB (rzadko)
    return Team.objects.get(pk=team_id)


def _collect_pair_winners(matches: List[Match], *, cup_matches: int) -> List[Team]:
    """
    Zwraca zwycięzców dla każdej pary drużyn w danym etapie KO.

    cup_matches=1:
      - wymagany winner w meczu
      - brak remisów na poziomie meczu (winner musi istnieć)

    cup_matches=2 (dwumecz):
      - winner w pojedynczym meczu NIE jest wymagany,
      - liczymy zwycięzcę z AGREGATU bramek (suma z dwóch meczów),
      - jeśli agregat remisowy -> błąd (trzeba doprecyzować zasady: dogrywka/karny/wybór zwycięzcy).
    """
    if cup_matches not in (1, 2):
        cup_matches = 1

    grouped: DefaultDict[Tuple[int, int], List[Match]] = defaultdict(list)
    for m in matches:
        grouped[_pair_key(m)].append(m)

    winners: List[Team] = []

    for _, group in grouped.items():
        # wszystkie mecze w parze muszą być FINISHED
        if any(m.status != Match.Status.FINISHED for m in group):
            raise ValueError("Nie wszystkie mecze pary są zakończone.")

        # BYE/walkower może być tylko 1 mecz w parze
        if len(group) == 1:
            if not group[0].winner_id:
                raise ValueError("Brak zwycięzcy walkoweru (BYE) w KO.")
            winners.append(group[0].winner)  # type: ignore[arg-type]
            continue

        if cup_matches == 1:
            # historycznie możesz mieć 1 mecz na parę; jeśli pojawią się 2, muszą być spójne
            winner_ids = {m.winner_id for m in group}
            if None in winner_ids:
                raise ValueError("Brak zwycięzcy meczu w fazie pucharowej (KO).")
            if len(winner_ids) != 1:
                raise ValueError("Niespójny zwycięzca w obrębie pary (cup_matches=1).")
            winners.append(group[0].winner)  # type: ignore[arg-type]
            continue

        # cup_matches == 2
        if len(group) != 2:
            raise ValueError("Dwumecz wymaga dokładnie 2 meczów w parze.")

        # 1) jeżeli winner już ustawiony i spójny na obu meczach → bierzemy go
        winner_ids_nonnull = {m.winner_id for m in group if m.winner_id is not None}
        if len(winner_ids_nonnull) == 1 and len(winner_ids_nonnull) == len(group):
            winners.append(group[0].winner)  # type: ignore[arg-type]
            continue

        # 2) liczymy agregat bramek
        totals: dict[int, int] = {}
        team_ids: set[int] = set()

        for m in group:
            team_ids.add(m.home_team_id)
            team_ids.add(m.away_team_id)

            if m.home_score is None or m.away_score is None:
                raise ValueError("Dwumecz: brak pełnego wyniku w jednym z meczów pary.")

            totals[m.home_team_id] = totals.get(m.home_team_id, 0) + int(m.home_score)
            totals[m.away_team_id] = totals.get(m.away_team_id, 0) + int(m.away_score)

        if len(team_ids) != 2:
            raise ValueError("Błąd danych KO: para nie ma dokładnie 2 drużyn.")

        t1, t2 = list(team_ids)
        g1, g2 = totals.get(t1, 0), totals.get(t2, 0)

        if g1 == g2:
            raise ValueError(
                "Dwumecz nie ma rozstrzygnięcia (remis w agregacie). "
                "Wymagane jest dodatkowe rozstrzygnięcie (np. dogrywka/karny/wybór zwycięzcy)."
            )

        winner_id = t1 if g1 > g2 else t2

        # 3) zapisujemy spójny winner na obu meczach pary
        Match.objects.filter(pk__in=[m.pk for m in group]).update(winner_id=winner_id)

        winners.append(_team_from_group(group, winner_id))

    return winners
