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
- BYE nie jest zapisywane jako Match (bo model Match wymaga dwóch różnych drużyn
  i ma constraint home_team != away_team). BYE jest wyliczane na podstawie tego,
  które drużyny NIE występują w meczach etapu (dotyczy wyłącznie pierwszego etapu KO).
"""

from __future__ import annotations

import math
from collections import defaultdict
from typing import DefaultDict, Iterable, List, Tuple

from django.db import transaction

from tournaments.models import Match, Stage, Team, Tournament


# ============================================================
# API PUBLICZNE
# ============================================================

@transaction.atomic
def generate_knockout_stage(tournament: Tournament) -> Stage:
    """
    Generuje PIERWSZY etap fazy pucharowej (KO).

    - Rozdziela BYE tak, aby nie powstawały pary (None, None).
    - Nie tworzy rekordów Match dla BYE (awans bez gry).
    """
    _validate_tournament(tournament)

    teams = _get_active_teams(tournament)
    cfg = tournament.format_config or {}

    cup_matches = int(cfg.get("cup_matches", 1))
    if cup_matches not in (1, 2):
        raise ValueError("cup_matches musi wynosić 1 albo 2.")

    stage = Stage.objects.create(
        tournament=tournament,
        stage_type=Stage.StageType.KNOCKOUT,
        order=1,
        status=Stage.Status.OPEN,
    )

    bracket_size = _next_power_of_two(len(teams))
    byes_count = bracket_size - len(teams)

    pairs = _build_first_round_pairs(teams=teams, byes_count=byes_count)

    matches = _build_matches_for_pairs(
        tournament=tournament,
        stage=stage,
        pairs=pairs,
        matches_per_pair=cup_matches,
    )

    # Jeżeli jest mało drużyn, teoretycznie może być 0 meczów (np. 2 drużyny? -> 1 mecz, ok).
    # Dopuszczamy sytuację, że przy bardzo dużej liczbie BYE meczów będzie niewiele,
    # ale nie chcemy sytuacji "brak jakichkolwiek par drużyna-drużyna" przy >=2 drużynach.
    if len(teams) >= 2 and not matches:
        raise ValueError("Generator pucharowy nie utworzył żadnych meczów.")

    if matches:
        Match.objects.bulk_create(matches)

    tournament.status = Tournament.Status.CONFIGURED
    tournament.save(update_fields=["status"])

    return stage


@transaction.atomic
def generate_next_knockout_stage(stage: Stage) -> Stage:
    """
    Generuje KOLEJNY etap fazy pucharowej na podstawie:
    - zwycięzców par (mecze) z poprzedniego etapu,
    - drużyn z BYE (dotyczy WYŁĄCZNIE pierwszego etapu KO).

    Zamyka bieżący etap. Jeśli pozostaje jeden zwycięzca -> kończy turniej.
    """
    if stage.stage_type != Stage.StageType.KNOCKOUT:
        raise ValueError("Ten endpoint obsługuje wyłącznie etap typu KNOCKOUT.")

    if stage.status != Stage.Status.OPEN:
        raise ValueError("Etap został już zamknięty.")

    matches = list(
        stage.matches.select_related("winner", "home_team", "away_team").all()
    )

    # 1) wszystkie mecze muszą być zakończone
    if any(m.status != Match.Status.FINISHED for m in matches):
        raise ValueError("Nie wszystkie mecze etapu są zakończone.")

    # 2) zwycięzcy z par (uwzględnia też cup_matches=2 – walidacja spójności)
    pair_winners = _collect_pair_winners(matches)

    # 3) BYE (tylko pierwszy etap KO) – drużyny, które nie zagrały w tym etapie
    bye_teams = _collect_bye_teams_for_stage(stage, matches)

    advancers: List[Team] = []
    advancers.extend(pair_winners)
    advancers.extend(bye_teams)

    # deterministycznie
    advancers = sorted({t.id: t for t in advancers}.values(), key=lambda t: t.id)

    # 4) zamykamy bieżący etap
    stage.status = Stage.Status.CLOSED
    stage.save(update_fields=["status"])

    # 5) jeden zwycięzca → KONIEC TURNIEJU
    if len(advancers) == 1:
        tournament = stage.tournament
        tournament.status = Tournament.Status.FINISHED
        tournament.save(update_fields=["status"])
        return stage

    # 6) w kolejnych etapach liczba drużyn MUSI być parzysta
    # (dla pierwszego etapu KO może wyjść parzysta dzięki BYE; jeśli nie – to błąd danych)
    if len(advancers) % 2 != 0:
        raise ValueError(
            "Nieprawidłowa liczba awansujących drużyn. "
            "Sprawdź wyniki oraz poprawność BYE w pierwszym etapie KO."
        )

    # 7) tworzymy nowy etap
    next_stage = Stage.objects.create(
        tournament=stage.tournament,
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
                tournament=stage.tournament,
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
# WALIDACJE
# ============================================================

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


# ============================================================
# LOGIKA DRABINKI – RUNDA 1
# ============================================================

def _next_power_of_two(n: int) -> int:
    """Zwraca najmniejszą potęgę 2 ≥ n."""
    return 2 ** math.ceil(math.log2(n))


def _build_first_round_pairs(
    teams: List[Team],
    byes_count: int,
) -> List[Tuple[Team, Team | None]]:
    """
    Buduje listę par dla pierwszej rundy tak, aby:
    - dokładnie 'byes_count' drużyn dostało BYE (para: (team, None)),
    - pozostałe drużyny zostały sparowane po 2 (para: (team, team)).

    Dzięki temu NIE powstają pary (None, None).
    """
    if byes_count < 0:
        raise ValueError("byes_count nie może być ujemne.")

    if byes_count == 0:
        if len(teams) % 2 != 0:
            raise ValueError("Dla braku BYE liczba drużyn musi być parzysta.")
        return [(teams[i], teams[i + 1]) for i in range(0, len(teams), 2)]

    # byes_count zawsze < len(teams) dla len(teams) >= 2 (dla potęgi 2)
    if byes_count >= len(teams):
        raise ValueError("Nieprawidłowa liczba BYE względem liczby drużyn.")

    bye_teams = teams[:byes_count]
    play_teams = teams[byes_count:]

    if len(play_teams) % 2 != 0:
        raise ValueError(
            "Błąd seeding KO: liczba drużyn grających w 1 rundzie musi być parzysta."
        )

    pairs: List[Tuple[Team, Team | None]] = []
    pairs.extend([(t, None) for t in bye_teams])
    pairs.extend([(play_teams[i], play_teams[i + 1]) for i in range(0, len(play_teams), 2)])
    return pairs


def _build_matches_for_pairs(
    tournament: Tournament,
    stage: Stage,
    pairs: Iterable[Tuple[Team, Team | None]],
    matches_per_pair: int,
) -> List[Match]:
    """
    Tworzy rekordy Match dla par (team, team).
    Dla (team, None) -> BYE, brak meczu.
    """
    matches: List[Match] = []
    round_number = 1

    for home, away in pairs:
        # BYE -> brak meczu
        if away is None:
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
# KOLEJNE RUNY – ZWYCIĘZCY + BYE
# ============================================================

def _pair_key(m: Match) -> Tuple[int, int]:
    """Klucz pary niezależny od gospodarza (dla cup_matches=2)."""
    a = m.home_team_id
    b = m.away_team_id
    return (a, b) if a < b else (b, a)


def _collect_pair_winners(matches: List[Match]) -> List[Team]:
    """
    Zwraca zwycięzców dla każdej pary drużyn w danym etapie KO.

    Jeśli w etapie występują dwa mecze na parę (cup_matches=2),
    to oczekujemy spójnego winner (w przeciwnym razie ten generator
    nie umie wyliczyć zwycięzcy po sumie bramek / dogrywce / karnych).
    """
    grouped: DefaultDict[Tuple[int, int], List[Match]] = defaultdict(list)
    for m in matches:
        grouped[_pair_key(m)].append(m)

    winners: List[Team] = []
    for _, group in grouped.items():
        # walidacje już częściowo były wyżej, ale tu trzymamy spójność per para
        if any(m.status != Match.Status.FINISHED for m in group):
            raise ValueError("Nie wszystkie mecze pary są zakończone.")

        winner_ids = {m.winner_id for m in group}
        if None in winner_ids:
            raise ValueError("Brak zwycięzcy meczu w fazie pucharowej (KO).")

        if len(winner_ids) != 1:
            raise ValueError(
                "Niespójni zwycięzcy w dwumeczu (cup_matches=2). "
                "Ta wersja generatora wymaga jednego, spójnego zwycięzcy dla pary."
            )

        # group[0].winner jest załadowany przez select_related
        winners.append(group[0].winner)  # type: ignore[arg-type]

    return winners


def _is_first_knockout_stage(stage: Stage) -> bool:
    """
    Pierwszy etap KO w turnieju = nie istnieje wcześniejszy etap KO (o mniejszym order).
    To działa także dla formatu MIXED (grupy -> KO), gdzie order może być > 1.
    """
    return not Stage.objects.filter(
        tournament=stage.tournament,
        stage_type=Stage.StageType.KNOCKOUT,
        order__lt=stage.order,
    ).exists()


def _collect_bye_teams_for_stage(stage: Stage, matches: List[Match]) -> List[Team]:
    """
    Zwraca drużyny z BYE dla danego etapu.
    Zgodnie z zasadami domenowymi BYE jest dozwolone tylko w PIERWSZYM etapie KO.

    Implementacja:
    - BYE = drużyna, która nie występuje jako home/away w żadnym meczu danego etapu.
    """
    if not _is_first_knockout_stage(stage):
        return []

    # Dla formatu CUP uczestnikami KO są wszystkie aktywne drużyny.
    # (Jeżeli kiedyś KO będzie generowane po kwalifikacji z grup,
    # trzeba będzie przechowywać listę uczestników etapu KO osobno.)
    active = list(stage.tournament.teams.filter(is_active=True).order_by("id"))

    involved_ids = set()
    for m in matches:
        involved_ids.add(m.home_team_id)
        involved_ids.add(m.away_team_id)

    bye_teams = [t for t in active if t.id not in involved_ids]

    # dodatkowa walidacja spójności danych (pomaga diagnozować błędy)
    expected_bracket = _next_power_of_two(len(active))
    expected_byes = expected_bracket - len(active)
    if expected_byes != len(bye_teams):
        raise ValueError(
            "Niespójna liczba BYE w pierwszym etapie KO. "
            f"Oczekiwano {expected_byes}, wykryto {len(bye_teams)}. "
            "Sprawdź dane etapu oraz generator pierwszej rundy."
        )

    return bye_teams
