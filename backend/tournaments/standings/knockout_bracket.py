# tournaments/standings/knockout_bracket.py
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List

from tournaments.models import Match, Stage, Tournament


def _round_label(team_count: int) -> str:
    if team_count == 2:
        return "Finał"
    if team_count == 4:
        return "Półfinał"
    if team_count == 8:
        return "Ćwierćfinał"
    if team_count == 16:
        return "1/8 finału"
    return f"KO ({team_count} drużyn)"


def get_knockout_bracket(tournament: Tournament) -> List[Dict[str, Any]]:
    """
    Zwraca strukturę drabinki dla turnieju:
    - etapy KNOCKOUT (kolejne rundy)
    - etap THIRD_PLACE (jeśli istnieje)
    """
    stages = list(
        tournament.stages.filter(
            stage_type__in=[Stage.StageType.KNOCKOUT, Stage.StageType.THIRD_PLACE]
        ).order_by("order", "id")
    )

    result: List[Dict[str, Any]] = []

    for st in stages:
        ms = list(
            st.matches.select_related("home_team", "away_team", "winner")
            .order_by("round_number", "id")
        )

        if st.stage_type == Stage.StageType.THIRD_PLACE:
            label = "Mecz o 3. miejsce"
        else:
            team_ids = set()
            for m in ms:
                team_ids.add(m.home_team_id)
                team_ids.add(m.away_team_id)
            label = _round_label(len(team_ids))

        result.append(
            {
                "stage_id": st.id,
                "stage_type": st.stage_type,
                "order": st.order,
                "label": label,
                "matches": [
                    {
                        "id": m.id,
                        "round_number": m.round_number,
                        "status": m.status,
                        "home_team_id": m.home_team_id,
                        "away_team_id": m.away_team_id,
                        "home_team_name": m.home_team.name,
                        "away_team_name": m.away_team.name,
                        "home_score": m.home_score,
                        "away_score": m.away_score,
                        "winner_id": m.winner_id,
                    }
                    for m in ms
                ],
            }
        )

    return result
