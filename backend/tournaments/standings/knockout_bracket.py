from collections import defaultdict
from typing import Any, Dict, List
from tournaments.models import Match, Stage, Tournament


def get_knockout_bracket(tournament: Tournament) -> Dict[str, Any]:
    """
    Zwraca strukturę drabinki KO.
    Grupuje dwumecze (mecze między tymi samymi drużynami w tej samej rundzie) w jeden obiekt.
    Poprawiona obsługa dwumeczu o 3. miejsce.
    """
    matches = (
        Match.objects
        .filter(
            stage__tournament=tournament,
            stage__stage_type__in=[Stage.StageType.KNOCKOUT, Stage.StageType.THIRD_PLACE],
        )
        .select_related("home_team", "away_team", "stage")
        .order_by("stage__order", "round_number", "id")
    )

    if not matches:
        return {"rounds": [], "third_place": None}

    # 1. Rozdzielamy główną drabinkę od 3. miejsca
    main_bracket_matches = []

    # ZMIANA: Zamiast jednej zmiennej, używamy listy, aby obsłużyć dwumecz
    third_place_matches = []

    def is_third_place(stage_type):
        return str(stage_type) == "THIRD_PLACE"

    for m in matches:
        if is_third_place(m.stage.stage_type):
            third_place_matches.append(m)  # ZMIANA: append zamiast przypisania
        else:
            main_bracket_matches.append(m)

    # Serializujemy 3. miejsce
    # Teraz przekazujemy całą listę meczów (może być 1 lub 2) do funkcji tworzącej pojedynek
    tp_item = None
    if third_place_matches:
        tp_item = _create_duel_item(third_place_matches)

    # Jeśli nie ma głównej drabinki, zwracamy tylko 3 miejsce (rzadki case)
    if not main_bracket_matches:
        return {"rounds": [], "third_place": tp_item}

    # 2. LOGIKA GRUPOWANIA W PARY (DUELS) DLA GŁÓWNEJ DRABINKI
    grouped_duels = defaultdict(list)

    for m in main_bracket_matches:
        r_num = m.round_number or 1

        if m.home_team_id and m.away_team_id:
            teams_key = frozenset([m.home_team_id, m.away_team_id])
        else:
            teams_key = m.id

        full_key = (m.stage.order, r_num, teams_key)
        grouped_duels[full_key].append(m)

    # 3. Przypisanie do Wirtualnych Rund
    unique_rounds = set()
    for (st_order, r_num, _), _ in grouped_duels.items():
        unique_rounds.add((st_order, r_num))

    sorted_rounds = sorted(list(unique_rounds))
    key_to_virtual_round = {key: i + 1 for i, key in enumerate(sorted_rounds)}
    max_virtual_round = len(sorted_rounds)

    rounds_map = defaultdict(list)

    sorted_duels_items = sorted(grouped_duels.items(), key=lambda x: x[1][0].id)

    for (st_order, r_num, _), duel_matches in sorted_duels_items:
        v_round = key_to_virtual_round[(st_order, r_num)]
        duel_item = _create_duel_item(duel_matches)
        rounds_map[v_round].append(duel_item)

    # 4. Budowanie wyniku
    bracket_rounds = []

    for v_round in sorted(rounds_map.keys()):
        duels = rounds_map[v_round]

        diff = max_virtual_round - v_round
        if diff == 0:
            label = "Finał"
        elif diff == 1:
            label = "Półfinał"
        elif diff == 2:
            label = "Ćwierćfinał"
        elif diff == 3:
            label = "1/8 Finału"
        else:
            label = f"Runda {v_round}"

        bracket_rounds.append({
            "round_number": v_round,
            "label": label,
            "items": duels
        })

    return {
        "rounds": bracket_rounds,
        "third_place": tp_item
    }


def _create_duel_item(matches: List[Match]) -> Dict[str, Any]:
    """Tworzy obiekt pojedynku zawierający 1 lub 2 mecze."""
    if not matches:
        return None

    # Sortujemy po ID
    matches.sort(key=lambda x: x.id)

    m1 = matches[0]
    m2 = matches[1] if len(matches) > 1 else None

    base_data = {
        "id": m1.id,
        "status": m2.status if m2 else m1.status,
        "home_team_id": m1.home_team_id,
        "away_team_id": m1.away_team_id,
        "home_team_name": m1.home_team.name if m1.home_team else "TBD",
        "away_team_name": m1.away_team.name if m1.away_team else "TBD",
        "winner_id": m1.winner_id if not m2 else _resolve_aggregate_winner(matches),

        "score_leg1_home": m1.home_score,
        "score_leg1_away": m1.away_score,

        "is_two_legged": True if m2 else False
    }

    if m2:
        # Obsługa odwrócenia gospodarzy w rewanżu
        if m2.home_team_id == m1.away_team_id:
            base_data["score_leg2_home"] = m2.away_score
            base_data["score_leg2_away"] = m2.home_score
        else:
            base_data["score_leg2_home"] = m2.home_score
            base_data["score_leg2_away"] = m2.away_score

    return base_data


def _resolve_aggregate_winner(matches):
    if matches[-1].status == "FINISHED":
        return matches[-1].winner_id
    return None