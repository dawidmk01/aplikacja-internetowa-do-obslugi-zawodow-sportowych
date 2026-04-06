# backend/tournaments/realtime.py
# Plik centralizuje emisję zdarzeń websocket do kanału turnieju i użytkownika.

from __future__ import annotations

from typing import Any

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from .ws import tournament_group_name, user_group_name


def _canonical_type(t: str) -> str:
    tt = (t or "").strip()
    if not tt:
        return "event"
    if "." in tt:
        return tt
    # Normalizacja utrzymuje zgodność między historycznym stylem snake_case i frontendem.
    if tt.endswith("_changed"):
        return tt[: -len("_changed")] + ".changed"
    if tt.endswith("_updated"):
        return tt[: -len("_updated")] + ".updated"
    return tt.replace("_", ".")


def _send_group(group: str, message_type: str, **kwargs: Any) -> None:
    channel_layer = get_channel_layer()
    if not channel_layer:
        return
    async_to_sync(channel_layer.group_send)(group, {"type": message_type, **kwargs})


def ws_emit_tournament(
    tournament_id: int,
    event: str | dict[str, Any],
    payload: dict[str, Any] | None = None,
) -> None:
    group = tournament_group_name(tournament_id)

    if isinstance(event, dict) and payload is None:
        msg: dict[str, Any] = event
    else:
        ev = _canonical_type(str(event))
        msg = {"v": 1, "type": ev, "tournamentId": int(tournament_id)}
        if payload:
            # Przepisanie match_id -> matchId utrzymuje spójny kontrakt z frontendem.
            if "matchId" not in payload and "match_id" in payload:
                payload = {**payload, "matchId": payload.get("match_id")}
            msg.update(payload)

    _send_group(group, "tournament.event", event=msg)


def ws_emit_user(
    user_id: int,
    payload: dict[str, Any] | str,
    extra: dict[str, Any] | None = None,
) -> None:
    group = user_group_name(user_id)

    if isinstance(payload, dict) and extra is None:
        msg: dict[str, Any] = payload
    else:
        ev = _canonical_type(str(payload))
        msg = {"v": 1, "type": ev, "userId": int(user_id)}
        if extra:
            msg.update(extra)

    _send_group(group, "broadcast", payload=msg)


def ws_emit_me(
    user_id: int,
    payload: dict[str, Any] | str,
    extra: dict[str, Any] | None = None,
) -> None:
    ws_emit_user(user_id, payload, extra)
