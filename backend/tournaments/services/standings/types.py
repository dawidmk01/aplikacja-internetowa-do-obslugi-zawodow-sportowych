# backend/tournaments/services/standings/types.py
# Plik definiuje strukturę wiersza klasyfikacji zwracaną przez mechanizmy tabel i rankingów.

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

    # Pole jest używane przez reguły piłkarskie PZPN.
    away_wins: int = 0

    # Pola są używane w klasyfikacji piłki ręcznej i customowego rozstrzygnięcia rzutami.
    penalty_wins: int = 0
    penalty_losses: int = 0

    # goals_*:
    # - football/handball/basketball: bramki/punkty
    # - tennis: sety
    # - custom HEAD_TO_HEAD punktowy: wynik bazowy meczu
    goals_for: int = 0
    goals_against: int = 0
    goal_difference: int = 0

    # Pola są używane wyłącznie w klasyfikacji tenisa.
    games_for: int = 0
    games_against: int = 0
    games_difference: int = 0

    points: int = 0

    # Pole przechowuje końcową pozycję po sortowaniu klasyfikacji.
    rank: int | None = None

    # Flaga rozróżnia ranking custom od klasycznej tabeli meczowej.
    is_custom_result: bool = False

    # Pole doprecyzowuje wariant rankingu custom zwracany do UI.
    custom_mode: str | None = None

    # Pole wskazuje, czy wynik custom jest czasem, liczbą czy miejscem.
    custom_value_kind: str | None = None

    # Pole przechowuje wartość liczbową dla rankingu NUMBER.
    custom_result_numeric: str | None = None

    # Pole przechowuje czas techniczny w milisekundach dla rankingu TIME.
    custom_result_time_ms: int | None = None

    # Pole przechowuje miejsce dla rankingu PLACE.
    custom_result_place: int | None = None

    # Pole przechowuje gotową wartość prezentacyjną zwracaną do UI.
    custom_result_display: str | None = None

    # Pole służy wyłącznie do wewnętrznego sortowania rankingu custom.
    custom_sort_value: str | int | None = None
