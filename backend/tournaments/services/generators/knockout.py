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
    Generuje KOLEJNY etap fazy pucharowej na podstawie zwycięzców
    poprzedniego etapu (w tym walkowerów vs __SYSTEM_BYE__).

    Zamyka bieżący etap. Jeśli pozostaje jeden zwycięzca -> kończy turniej.
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

    # 2) zwycięzcy z par (uwzględnia walkowery + cup_matches=2 przez agregat)
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
    created: List[Match] = []
    for i in range(0, len(advancers), 2):
        home = advancers[i]
        away = advancers[i + 1]

        if home.id == away.id:
            raise ValueError("Błąd logiki KO: drużyna nie może grać sama ze sobą.")

        created.append(
            Match(
                tournament=tournament,
                stage=next_stage,
                home_team=home,
                away_team=away,
                round_number=1,
                status=Match.Status.SCHEDULED,
            )
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
    - is_active=False (nie może się pojawić w UI jako uczestnik),
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
    """Zwraca najmniejszą potęgę 2 ≥ n."""
    return 2 ** math.ceil(math.log2(n))


def _build_first_round_pairs(
    teams: List[Team],
    byes_count: int,
    bye_team: Optional[Team],
) -> List[Tuple[Team, Team]]:
    """
    Buduje listę par dla pierwszej rundy tak, aby:
    - powstała pełna runda drabinki: bracket_size/2 par,
    - dokładnie 'byes_count' par było typu (team, __SYSTEM_BYE__),
    - pozostałe pary były typu (team, team).
    """
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
) -> List[Match]:
    """
    Tworzy rekordy Match dla par.

    - Dla (team, __SYSTEM_BYE__) tworzy 1 mecz walkowerowy FINISHED z winner=team.
      (nie mnożymy walkowerów przez matches_per_pair – to tylko techniczny zapis BYE)
    - Dla (team, team) tworzy matches_per_pair meczów (np. dwumecz).
    """
    matches: List[Match] = []
    round_number = 1

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
    """Klucz pary niezależny od gospodarza (dla cup_matches=2)."""
    a = m.home_team_id
    b = m.away_team_id
    return (a, b) if a < b else (b, a)


def _collect_pair_winners(matches: List[Match], *, cup_matches: int) -> List[Team]:
    """
    Zwraca zwycięzców dla każdej pary drużyn w danym etapie KO.

    cup_matches=1:
      - wymagany winner w każdym meczu pary
      - brak remisów na poziomie pary (winner musi istnieć)

    cup_matches=2 (dwumecz):
      - NIE wymagamy winner w pojedynczym meczu
      - wyliczamy zwycięzcę z AGREGATU bramek (suma z dwóch meczów)
      - jeśli agregat remisowy -> błąd (brak mechanizmu dogrywki/karnych)
      - jeśli wyliczymy zwycięzcę -> zapisujemy winner_id na obu meczach pary (spójność danych)
    """
    if cup_matches not in (1, 2):
        cup_matches = 1

    grouped: DefaultDict[Tuple[int, int], List[Match]] = defaultdict(list)
    for m in matches:
        grouped[_pair_key(m)].append(m)

    winners: List[Team] = []

    for _, group in grouped.items():
        if any(m.status != Match.Status.FINISHED for m in group):
            raise ValueError("Nie wszystkie mecze pary są zakończone.")

        # BYE/walkower może być tylko 1 mecz w parze
        if len(group) == 1:
            if not group[0].winner_id:
                raise ValueError("Brak zwycięzcy walkoweru (BYE) w KO.")
            winners.append(group[0].winner)  # type: ignore[arg-type]
            continue

        if cup_matches == 1:
            winner_ids = {m.winner_id for m in group}
            if None in winner_ids:
                raise ValueError("Brak zwycięzcy meczu w fazie pucharowej (KO).")
            if len(winner_ids) != 1:
                raise ValueError("Niespójny zwycięzca w obrębie pary (cup_matches=1).")
            winners.append(group[0].winner)  # type: ignore[arg-type]
            continue

        # cup_matches == 2
        # 1) jeżeli winner już jest ustawiony i spójny na obu meczach → bierzemy go
        winner_ids_nonnull = {m.winner_id for m in group if m.winner_id is not None}
        if len(winner_ids_nonnull) == 1 and len(winner_ids_nonnull) == len(group):
            winners.append(group[0].winner)  # type: ignore[arg-type]
            continue

        # 2) liczymy agregat bramek po ID drużyn
        totals: dict[int, int] = {}
        team_ids: set[int] = set()

        for m in group:
            team_ids.add(m.home_team_id)
            team_ids.add(m.away_team_id)

            totals[m.home_team_id] = totals.get(m.home_team_id, 0) + int(m.home_score or 0)
            totals[m.away_team_id] = totals.get(m.away_team_id, 0) + int(m.away_score or 0)

        if len(team_ids) != 2:
            raise ValueError("Błąd danych KO: para nie ma dokładnie 2 drużyn.")

        t1, t2 = list(team_ids)
        g1, g2 = totals.get(t1, 0), totals.get(t2, 0)

        if g1 == g2:
            raise ValueError(
                "Dwumecz nie ma rozstrzygnięcia (remis w agregacie). "
                "Wymagane jest dodatkowe rozstrzygnięcie (np. dogrywka/karny) w modelu."
            )

        winner_id = t1 if g1 > g2 else t2

        # mapujemy winner_id -> obiekt Team (mamy select_related home/away)
        sample = group[0]
        if sample.home_team_id == winner_id:
            winner_team = sample.home_team
        elif sample.away_team_id == winner_id:
            winner_team = sample.away_team
        else:
            # awaryjnie: szukamy w grupie
            winner_team = None
            for m in group:
                if m.home_team_id == winner_id:
                    winner_team = m.home_team
                    break
                if m.away_team_id == winner_id:
                    winner_team = m.away_team
                    break
            if winner_team is None:
                raise ValueError("Nie udało się zmapować zwycięzcy dwumeczu do drużyny.")

        # 3) zapisujemy spójny winner na obu meczach pary
        Match.objects.filter(pk__in=[m.pk for m in group]).update(winner_id=winner_id)

        winners.append(winner_team)

    return winners
