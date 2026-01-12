from __future__ import annotations

from dataclasses import dataclass


@dataclass
class StandingRow:
    team_id: int
    team_name: str

    played: int = 0
    wins: int = 0
    draws: int = 0
    losses: int = 0

    away_wins: int = 0  # używane w football/PZPN

    penalty_wins: int = 0   # handball
    penalty_losses: int = 0 # handball

    # goals_*:
    # - football/handball/basketball: bramki/punkty
    # - tennis: sety (wynik końcowy w setach)
    goals_for: int = 0
    goals_against: int = 0
    goal_difference: int = 0

    # tennis-only tie-break (gemy z tennis_sets)
    games_for: int = 0
    games_against: int = 0
    games_difference: int = 0

    points: int = 0
