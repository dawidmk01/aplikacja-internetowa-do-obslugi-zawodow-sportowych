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

    # Pole obsługuje kryterium zwycięstw wyjazdowych w regułach piłkarskich.
    away_wins: int = 0

    # Pola obsługują rozstrzygnięcia po karnych w regułach ręcznej i części trybów custom.
    penalty_wins: int = 0
    penalty_losses: int = 0

    # Pola przechowują główny bilans wyniku meczu lub seta zależnie od dyscypliny.
    goals_for: int = 0
    goals_against: int = 0
    goal_difference: int = 0

    # Pola służą wyłącznie do dodatkowych kryteriów tenisowych opartych o gemy.
    games_for: int = 0
    games_against: int = 0
    games_difference: int = 0

    points: int = 0

    # Pole przechowuje końcową pozycję po zakończeniu procesu sortowania.
    rank: int | None = None

    # Flaga rozróżnia klasyczną tabelę meczową od rankingu custom.
    is_custom_result: bool = False

    # Pole doprecyzowuje wariant rankingu custom zwracany do UI.
    custom_mode: str | None = None

    # Pole wskazuje typ wyniku custom zwracanego do UI.
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
