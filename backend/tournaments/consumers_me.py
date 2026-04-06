# backend/tournaments/consumers_me.py
# Plik obsługuje kanał websocket użytkownika wykorzystywany do zdarzeń prywatnych /ws/me/.

from __future__ import annotations

from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import AccessToken

from .ws import user_group_name


def _get_token_from_scope(scope) -> str | None:
    raw = (scope.get("query_string") or b"").decode("utf-8")
    parsed = parse_qs(raw)
    token = (parsed.get("token") or [None])[0]
    return token


@database_sync_to_async
def _get_user_by_id(user_id: int):
    User = get_user_model()
    return User.objects.filter(id=user_id).first()


async def _resolve_user(scope):
    user = scope.get("user")
    if user is not None and getattr(user, "is_authenticated", False):
        return user

    token = _get_token_from_scope(scope)
    if not token:
        return None

    try:
        access = AccessToken(token)
    except Exception:
        return None

    user_id = access.get("user_id")
    if not user_id:
        return None

    return await _get_user_by_id(int(user_id))


class MeConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        user = await _resolve_user(self.scope)
        if not user:
            await self.close(code=4401)
            return

        self._group_name = user_group_name(int(user.id))
        await self.channel_layer.group_add(self._group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, code):
        group_name = getattr(self, "_group_name", None)
        if group_name:
            await self.channel_layer.group_discard(group_name, self.channel_name)

    async def broadcast(self, event):
        await self.send_json(event.get("payload") or {})
