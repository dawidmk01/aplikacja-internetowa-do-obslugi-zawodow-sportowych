# backend/tournaments/ws.py
# Plik definiuje nazwy grup Channels używane przez komunikację websocket.

from __future__ import annotations


def tournament_group_name(tournament_id: int) -> str:
    # Format bez ":" utrzymuje zgodność z ograniczeniami nazw grup Channels.
    return f"tournament.{int(tournament_id)}"


def user_group_name(user_id: int) -> str:
    return f"user.{int(user_id)}"


def me_group_name(user_id: int) -> str:
    return user_group_name(user_id)
