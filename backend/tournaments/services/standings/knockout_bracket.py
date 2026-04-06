# backend/tournaments/services/standings/knockout_bracket.py
# Plik buduje strukturę drabinki pucharowej zwracaną do warstwy prezentacji dla aktywnej dywizji.

from __future__ import annotations

from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple

from tournaments.models import Division, Match, Stage, Tournament
from tournaments.services.match_outcome import penalty_winner_id, team_goals_in_match


def _resolve_division(tournament: Tournament, division: Division | None = None) -> Division | None:
    if division is None:
        getter = getattr(tournament, "get_default_division", None)
        if callable(getter):
            return getter()
        return None

    if division.tournament_id != tournament.id:
        raise ValueError("Wskazana dywizja nie należy do tego turnieju.")

    return division


def get_knockout_bracket(
    tournament: Tournament,
    division: Division | None = None,
) -> Dict[str, Any]:
    division = _resolve_division(tournament, division)
    discipline = (getattr(tournament, "discipline", "") or "").lower()

    matches_qs = Match.objects.filter(
        stage__tournament=tournament,
        stage__stage_type__in=[Stage.StageType.KNOCKOUT, Stage.StageType.THIRD_PLACE],
    )
    if division is not None:
        matches_qs = matches_qs.filter(stage__division=division)

    matches = (
        matches_qs
        .select_related("home_team", "away_team", "stage", "stage__division")
        .order_by("stage__order", "round_number", "id")
    )

    if not matches:
        return {"rounds": [], "third_place": None}

    main_bracket_matches: list[Match] = []
    third_place_matches: list[Match] = []

    def is_third_place(stage_type) -> bool:
        return stage_type == Stage.StageType.THIRD_PLACE

    # Osobne potraktowanie meczu o 3. miejsce upraszcza dalsze grupowanie.
    for match in matches:
        if is_third_place(match.stage.stage_type):
            third_place_matches.append(match)
        else:
            main_bracket_matches.append(match)

    third_place_item = None
    if third_place_matches:
        third_place_item = _create_duel_item(third_place_matches, discipline=discipline)

    if not main_bracket_matches:
        return {"rounds": [], "third_place": third_place_item}

    grouped_duels = defaultdict(list)

    # Grupowanie scala pojedyncze mecze i dwumecze w logiczne pary rundy.
    for match in main_bracket_matches:
        round_number = match.round_number or 1

        if match.home_team_id and match.away_team_id:
            teams_key = frozenset([match.home_team_id, match.away_team_id])
        else:
            teams_key = match.id

        full_key = (match.stage.order, round_number, teams_key)
        grouped_duels[full_key].append(match)

    unique_rounds = set()
    for (stage_order, round_number, _), _matches in grouped_duels.items():
        unique_rounds.add((stage_order, round_number))

    sorted_rounds = sorted(list(unique_rounds))
    key_to_virtual_round = {key: index + 1 for index, key in enumerate(sorted_rounds)}

    rounds_map = defaultdict(list)
    sorted_duels_items = sorted(grouped_duels.items(), key=lambda item: item[1][0].id)

    for (stage_order, round_number, _), duel_matches in sorted_duels_items:
        virtual_round = key_to_virtual_round[(stage_order, round_number)]
        duel_item = _create_duel_item(duel_matches, discipline=discipline)
        if duel_item:
            rounds_map[virtual_round].append(duel_item)

    bracket_rounds = []
    for virtual_round in sorted(rounds_map.keys()):
        duels = rounds_map[virtual_round]
        label = _label_from_duels_count(len(duels), v_round=virtual_round)
        bracket_rounds.append(
            {"round_number": virtual_round, "label": label, "items": duels}
        )

    return {"rounds": bracket_rounds, "third_place": third_place_item}


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
    if not isinstance(tennis_sets, list) or not tennis_sets:
        return None

    parts: list[str] = []
    for set_item in tennis_sets:
        if not isinstance(set_item, dict):
            continue

        home_games = set_item.get("home_games")
        away_games = set_item.get("away_games")
        if home_games is None or away_games is None:
            continue

        piece = f"{home_games}:{away_games}"

        home_tiebreak = set_item.get("home_tiebreak")
        away_tiebreak = set_item.get("away_tiebreak")
        if home_tiebreak is not None and away_tiebreak is not None and (
            (home_games == 7 and away_games == 6) or (home_games == 6 and away_games == 7)
        ):
            piece += f"({home_tiebreak}:{away_tiebreak})"

        parts.append(piece)

    return ", ".join(parts) if parts else None


def _swap_tennis_sets(tennis_sets: Any) -> Any:
    # Rewanż z odwróconym układem drużyn wymaga odwrócenia perspektywy setów.
    if not isinstance(tennis_sets, list):
        return tennis_sets

    swapped = []
    for set_item in tennis_sets:
        if not isinstance(set_item, dict):
            swapped.append(set_item)
            continue
        swapped.append(
            {
                "home_games": set_item.get("away_games"),
                "away_games": set_item.get("home_games"),
                "home_tiebreak": set_item.get("away_tiebreak"),
                "away_tiebreak": set_item.get("home_tiebreak"),
            }
        )
    return swapped


def _leg_payload(match: Match, *, discipline: str) -> Dict[str, Any]:
    # Payload lega przenosi komplet danych potrzebnych do widoku pojedynku.
    data: Dict[str, Any] = {
        "score_home": match.home_score,
        "score_away": match.away_score,
        "went_to_extra_time": bool(getattr(match, "went_to_extra_time", False)),
        "et_home": getattr(match, "home_extra_time_score", None),
        "et_away": getattr(match, "away_extra_time_score", None),
        "decided_by_penalties": bool(getattr(match, "decided_by_penalties", False)),
        "pen_home": getattr(match, "home_penalty_score", None),
        "pen_away": getattr(match, "away_penalty_score", None),
    }

    if discipline == "tennis":
        tennis_sets = getattr(match, "tennis_sets", None)
        data["tennis_sets"] = tennis_sets
        data["tennis_sets_display"] = _format_tennis_sets(tennis_sets)

    return data


def _swap_leg_payload_for_ui(leg: Dict[str, Any]) -> Dict[str, Any]:
    # Drugi mecz pary musi zostać pokazany w tej samej perspektywie co pierwszy.
    swapped = dict(leg)
    swapped["score_home"], swapped["score_away"] = leg.get("score_away"), leg.get("score_home")
    swapped["et_home"], swapped["et_away"] = leg.get("et_away"), leg.get("et_home")
    swapped["pen_home"], swapped["pen_away"] = leg.get("pen_away"), leg.get("pen_home")

    if "tennis_sets" in leg:
        swapped["tennis_sets"] = _swap_tennis_sets(leg.get("tennis_sets"))
        swapped["tennis_sets_display"] = _format_tennis_sets(swapped.get("tennis_sets"))

    return swapped


def _create_duel_item(matches: List[Match], *, discipline: str) -> Optional[Dict[str, Any]]:
    if not matches:
        return None

    matches.sort(key=lambda match: match.id)

    first_match = matches[0]
    second_match = matches[1] if len(matches) > 1 else None

    winner_id = first_match.winner_id if not second_match else _resolve_aggregate_winner(matches)

    base_data: Dict[str, Any] = {
        "id": first_match.id,
        "status": second_match.status if second_match else first_match.status,
        "division_id": getattr(first_match.stage, "division_id", None),
        "home_team_id": first_match.home_team_id,
        "away_team_id": first_match.away_team_id,
        "home_team_name": first_match.home_team.name if first_match.home_team else "TBD",
        "away_team_name": first_match.away_team.name if first_match.away_team else "TBD",
        "winner_id": winner_id,
        "is_two_legged": True if second_match else False,
    }

    leg1 = _leg_payload(first_match, discipline=discipline)
    base_data["leg1"] = leg1
    base_data["score_leg1_home"] = leg1.get("score_home")
    base_data["score_leg1_away"] = leg1.get("score_away")
    base_data["et_leg1_home"] = leg1.get("et_home") if leg1.get("went_to_extra_time") else None
    base_data["et_leg1_away"] = leg1.get("et_away") if leg1.get("went_to_extra_time") else None
    base_data["pen_leg1_home"] = leg1.get("pen_home") if leg1.get("decided_by_penalties") else None
    base_data["pen_leg1_away"] = leg1.get("pen_away") if leg1.get("decided_by_penalties") else None

    if discipline == "tennis":
        base_data["tennis_sets_leg1"] = leg1.get("tennis_sets")
        base_data["tennis_sets_leg1_display"] = leg1.get("tennis_sets_display")

    if second_match:
        leg2 = _leg_payload(second_match, discipline=discipline)

        if second_match.home_team_id == first_match.away_team_id:
            leg2_ui = _swap_leg_payload_for_ui(leg2)
        else:
            leg2_ui = leg2

        base_data["leg2"] = leg2_ui
        base_data["score_leg2_home"] = leg2_ui.get("score_home")
        base_data["score_leg2_away"] = leg2_ui.get("score_away")
        base_data["et_leg2_home"] = leg2_ui.get("et_home") if leg2_ui.get("went_to_extra_time") else None
        base_data["et_leg2_away"] = leg2_ui.get("et_away") if leg2_ui.get("went_to_extra_time") else None
        base_data["pen_leg2_home"] = leg2_ui.get("pen_home") if leg2_ui.get("decided_by_penalties") else None
        base_data["pen_leg2_away"] = leg2_ui.get("pen_away") if leg2_ui.get("decided_by_penalties") else None

        if discipline == "tennis":
            base_data["tennis_sets_leg2"] = leg2_ui.get("tennis_sets")
            base_data["tennis_sets_leg2_display"] = leg2_ui.get("tennis_sets_display")

        # Agregat liczony jest w perspektywie drużyn z pierwszego meczu.
        try:
            home_team_id = first_match.home_team_id
            away_team_id = first_match.away_team_id
            if home_team_id and away_team_id:
                aggregate_home = sum(team_goals_in_match(match, home_team_id) for match in matches)
                aggregate_away = sum(team_goals_in_match(match, away_team_id) for match in matches)
                base_data["aggregate_home"] = aggregate_home
                base_data["aggregate_away"] = aggregate_away
        except Exception:
            pass

    return base_data


def _resolve_aggregate_winner(matches: List[Match]) -> Optional[int]:
    if not matches:
        return None

    if len(matches) == 1:
        return matches[0].winner_id

    if len(matches) != 2:
        return None

    if any(match.status != Match.Status.FINISHED for match in matches):
        return None

    # Spójny winner_id na obu meczach ma pierwszeństwo przed liczeniem agregatu.
    if all(match.winner_id is not None for match in matches):
        winner_ids = {match.winner_id for match in matches}
        if len(winner_ids) == 1:
            return next(iter(winner_ids))

    team_ids = {matches[0].home_team_id, matches[0].away_team_id}
    if None in team_ids or len(team_ids) != 2:
        return None
    first_team_id, second_team_id = list(team_ids)

    first_team_goals = sum(team_goals_in_match(match, first_team_id) for match in matches)
    second_team_goals = sum(team_goals_in_match(match, second_team_id) for match in matches)

    if first_team_goals != second_team_goals:
        return first_team_id if first_team_goals > second_team_goals else second_team_id

    # Przy remisie agregatu decydują karne zapisane na rewanżu.
    second_leg = max(matches, key=lambda match: match.id)
    penalty_winner = penalty_winner_id(second_leg)
    if penalty_winner is not None:
        return penalty_winner

    return None
