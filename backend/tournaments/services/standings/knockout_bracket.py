from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple

from tournaments.models import Match, Stage, Tournament
from tournaments.services.match_outcome import team_goals_in_match, penalty_winner_id


def get_knockout_bracket(tournament: Tournament) -> Dict[str, Any]:
    """
    Zwraca strukturę drabinki KO.
    Grupuje dwumecze (mecze między tymi samymi drużynami w tej samej rundzie) w jeden obiekt.
    Obsługa:
    - dwumecz + agregat (reg+dogrywka, bez karnych)
    - karne jako tiebreak (w rewanżu)
    - 3. miejsce (osobno)
    - tenis: zwraca też gemy/tie-break (tennis_sets)
    """
    discipline = (getattr(tournament, "discipline", "") or "").lower()

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

    # 1) Rozdzielamy główną drabinkę od 3. miejsca
    main_bracket_matches: list[Match] = []
    third_place_matches: list[Match] = []

    def is_third_place(stage_type) -> bool:
        return stage_type == Stage.StageType.THIRD_PLACE

    for m in matches:
        if is_third_place(m.stage.stage_type):
            third_place_matches.append(m)
        else:
            main_bracket_matches.append(m)

    tp_item = None
    if third_place_matches:
        tp_item = _create_duel_item(third_place_matches, discipline=discipline)

    if not main_bracket_matches:
        return {"rounds": [], "third_place": tp_item}

    # 2) Grupowanie meczów w dule (1 lub 2 mecze) w obrębie rundy
    grouped_duels = defaultdict(list)

    for m in main_bracket_matches:
        r_num = m.round_number or 1

        if m.home_team_id and m.away_team_id:
            teams_key = frozenset([m.home_team_id, m.away_team_id])
        else:
            teams_key = m.id

        full_key = (m.stage.order, r_num, teams_key)
        grouped_duels[full_key].append(m)

    # 3) Przypisanie do wirtualnych rund
    unique_rounds = set()
    for (st_order, r_num, _), _ in grouped_duels.items():
        unique_rounds.add((st_order, r_num))

    sorted_rounds = sorted(list(unique_rounds))
    key_to_virtual_round = {key: i + 1 for i, key in enumerate(sorted_rounds)}

    rounds_map = defaultdict(list)
    sorted_duels_items = sorted(grouped_duels.items(), key=lambda x: x[1][0].id)

    for (st_order, r_num, _), duel_matches in sorted_duels_items:
        v_round = key_to_virtual_round[(st_order, r_num)]
        duel_item = _create_duel_item(duel_matches, discipline=discipline)
        if duel_item:
            rounds_map[v_round].append(duel_item)

    # 4) Budowanie wyniku
    bracket_rounds = []
    for v_round in sorted(rounds_map.keys()):
        duels = rounds_map[v_round]
        label = _label_from_duels_count(len(duels), v_round=v_round)
        bracket_rounds.append(
            {"round_number": v_round, "label": label, "items": duels}
        )

    return {"rounds": bracket_rounds, "third_place": tp_item}


def _label_from_duels_count(duels_count: int, *, v_round: int) -> str:
    teams_in_round = duels_count * 2

    if teams_in_round == 2:
        return "Finał"
    if teams_in_round == 4:
        return "Półfinał"
    if teams_in_round == 8:
        return "Ćwierćfinał"
    if teams_in_round >= 16 and teams_in_round % 2 == 0:
        return f"1/{teams_in_round // 2} Finału"

    return f"Runda {v_round}"


def _format_tennis_sets(tennis_sets: Any) -> Optional[str]:
    """
    Przykład: "7:6(7:5), 6:0, 6:0"
    TB pokazujemy tylko gdy set zakończony 7:6 i mamy punkty TB.
    """
    if not isinstance(tennis_sets, list) or not tennis_sets:
        return None

    parts: list[str] = []
    for s in tennis_sets:
        if not isinstance(s, dict):
            continue
        hg = s.get("home_games")
        ag = s.get("away_games")
        if hg is None or ag is None:
            continue

        piece = f"{hg}:{ag}"

        ht = s.get("home_tiebreak")
        at = s.get("away_tiebreak")
        if ht is not None and at is not None and (
            (hg == 7 and ag == 6) or (hg == 6 and ag == 7)
        ):
            piece += f"({ht}:{at})"

        parts.append(piece)

    return ", ".join(parts) if parts else None


def _swap_tennis_sets(tennis_sets: Any) -> Any:
    """
    Gdy rewanż ma odwróconych gospodarzy, musimy odwrócić też home/away w tennis_sets.
    """
    if not isinstance(tennis_sets, list):
        return tennis_sets
    swapped = []
    for s in tennis_sets:
        if not isinstance(s, dict):
            swapped.append(s)
            continue
        swapped.append(
            {
                "home_games": s.get("away_games"),
                "away_games": s.get("home_games"),
                "home_tiebreak": s.get("away_tiebreak"),
                "away_tiebreak": s.get("home_tiebreak"),
            }
        )
    return swapped


def _leg_payload(m: Match, *, discipline: str) -> Dict[str, Any]:
    """
    Zwraca dane 1 meczu (leg) w układzie home/away tego meczu.
    """
    data: Dict[str, Any] = {
        "score_home": m.home_score,
        "score_away": m.away_score,
        "went_to_extra_time": bool(getattr(m, "went_to_extra_time", False)),
        "et_home": getattr(m, "home_extra_time_score", None),
        "et_away": getattr(m, "away_extra_time_score", None),
        "decided_by_penalties": bool(getattr(m, "decided_by_penalties", False)),
        "pen_home": getattr(m, "home_penalty_score", None),
        "pen_away": getattr(m, "away_penalty_score", None),
    }

    if discipline == "tennis":
        ts = getattr(m, "tennis_sets", None)
        data["tennis_sets"] = ts
        data["tennis_sets_display"] = _format_tennis_sets(ts)

    return data


def _swap_leg_payload_for_ui(leg: Dict[str, Any]) -> Dict[str, Any]:
    """
    Odwraca home/away w payloadzie lega (dla UI, gdy rewanż ma odwrócone drużyny).
    """
    swapped = dict(leg)
    swapped["score_home"], swapped["score_away"] = leg.get("score_away"), leg.get("score_home")
    swapped["et_home"], swapped["et_away"] = leg.get("et_away"), leg.get("et_home")
    swapped["pen_home"], swapped["pen_away"] = leg.get("pen_away"), leg.get("pen_home")

    if "tennis_sets" in leg:
        swapped["tennis_sets"] = _swap_tennis_sets(leg.get("tennis_sets"))
        swapped["tennis_sets_display"] = _format_tennis_sets(swapped.get("tennis_sets"))

    return swapped


def _create_duel_item(matches: List[Match], *, discipline: str) -> Optional[Dict[str, Any]]:
    """Tworzy obiekt pojedynku zawierający 1 lub 2 mecze."""
    if not matches:
        return None

    matches.sort(key=lambda x: x.id)

    m1 = matches[0]
    m2 = matches[1] if len(matches) > 1 else None

    winner_id = m1.winner_id if not m2 else _resolve_aggregate_winner(matches)

    base_data: Dict[str, Any] = {
        "id": m1.id,
        "status": m2.status if m2 else m1.status,
        "home_team_id": m1.home_team_id,
        "away_team_id": m1.away_team_id,
        "home_team_name": m1.home_team.name if m1.home_team else "TBD",
        "away_team_name": m1.away_team.name if m1.away_team else "TBD",
        "winner_id": winner_id,
        "is_two_legged": True if m2 else False,
    }

    # LEG1 (zawsze w układzie m1)
    leg1 = _leg_payload(m1, discipline=discipline)
    base_data["leg1"] = leg1

    # Backward compatible (Twoje dotychczasowe pola)
    base_data["score_leg1_home"] = leg1.get("score_home")
    base_data["score_leg1_away"] = leg1.get("score_away")

    # Dodatki leg1
    base_data["et_leg1_home"] = leg1.get("et_home") if leg1.get("went_to_extra_time") else None
    base_data["et_leg1_away"] = leg1.get("et_away") if leg1.get("went_to_extra_time") else None
    base_data["pen_leg1_home"] = leg1.get("pen_home") if leg1.get("decided_by_penalties") else None
    base_data["pen_leg1_away"] = leg1.get("pen_away") if leg1.get("decided_by_penalties") else None
    if discipline == "tennis":
        base_data["tennis_sets_leg1"] = leg1.get("tennis_sets")
        base_data["tennis_sets_leg1_display"] = leg1.get("tennis_sets_display")

    if m2:
        leg2 = _leg_payload(m2, discipline=discipline)

        # Wynik leg2 w ujęciu drużyn z leg1 (dla UI)
        if m2.home_team_id == m1.away_team_id:
            # rewanż ma odwróconych gospodarzy -> swap
            leg2_ui = _swap_leg_payload_for_ui(leg2)
        else:
            leg2_ui = leg2

        base_data["leg2"] = leg2_ui

        # Backward compatible (Twoje dotychczasowe pola)
        base_data["score_leg2_home"] = leg2_ui.get("score_home")
        base_data["score_leg2_away"] = leg2_ui.get("score_away")

        # Dodatki leg2
        base_data["et_leg2_home"] = leg2_ui.get("et_home") if leg2_ui.get("went_to_extra_time") else None
        base_data["et_leg2_away"] = leg2_ui.get("et_away") if leg2_ui.get("went_to_extra_time") else None
        base_data["pen_leg2_home"] = leg2_ui.get("pen_home") if leg2_ui.get("decided_by_penalties") else None
        base_data["pen_leg2_away"] = leg2_ui.get("pen_away") if leg2_ui.get("decided_by_penalties") else None
        if discipline == "tennis":
            base_data["tennis_sets_leg2"] = leg2_ui.get("tennis_sets")
            base_data["tennis_sets_leg2_display"] = leg2_ui.get("tennis_sets_display")

        # agregat (reg+dogrywka) w układzie leg1 home/away
        try:
            t_home = m1.home_team_id
            t_away = m1.away_team_id
            if t_home and t_away:
                agg_home = sum(team_goals_in_match(m, t_home) for m in matches)
                agg_away = sum(team_goals_in_match(m, t_away) for m in matches)
                base_data["aggregate_home"] = agg_home
                base_data["aggregate_away"] = agg_away
        except Exception:
            pass

    return base_data


def _resolve_aggregate_winner(matches: List[Match]) -> Optional[int]:
    """
    Dla dwumeczu:
    - Jeśli oba mecze FINISHED:
        1) jeżeli winner_id na obu i spójny -> zwróć go
        2) inaczej policz agregat (reg+dogrywka), karne nie wchodzą
        3) przy remisie agregatu -> karne w rewanżu (mecz o większym ID)
    - W przeciwnym razie -> None
    """
    if not matches:
        return None

    if len(matches) == 1:
        return matches[0].winner_id

    if len(matches) != 2:
        # systemowo wspieramy max 2 legi na parę
        return None

    if any(m.status != Match.Status.FINISHED for m in matches):
        return None

    if all(m.winner_id is not None for m in matches):
        wid = {m.winner_id for m in matches}
        if len(wid) == 1:
            return next(iter(wid))

    team_ids = {matches[0].home_team_id, matches[0].away_team_id}
    if None in team_ids or len(team_ids) != 2:
        return None
    t1, t2 = list(team_ids)

    g1 = sum(team_goals_in_match(m, t1) for m in matches)
    g2 = sum(team_goals_in_match(m, t2) for m in matches)

    if g1 != g2:
        return t1 if g1 > g2 else t2

    second_leg = max(matches, key=lambda m: m.id)
    pw = penalty_winner_id(second_leg)
    if pw is not None:
        return pw

    return None
