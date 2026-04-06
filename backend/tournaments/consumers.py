# backend/tournaments/consumers.py
# Plik obsługuje kanał websocket turnieju wykorzystywany do zdarzeń realtime /ws/tournaments/<id>/.

from __future__ import annotations

from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import AccessToken

from .models import Tournament
from .ws import tournament_group_name


class TournamentConsumer(AsyncJsonWebsocketConsumer):
    tournament_id: int
    group_name: str

    async def connect(self):
        tournament_id_raw = self.scope.get("url_route", {}).get("kwargs", {}).get("tournament_id")
        try:
            self.tournament_id = int(tournament_id_raw)
        except (TypeError, ValueError):
            await self.close(code=4400)
            return

        user = self.scope.get("user")
        if user is None:
            await self.close(code=4401)
            return

        # Fallback utrzymuje autoryzację także dla klienta z tokenem w querystring.
        if not user.is_authenticated:
            token = self._get_token_from_qs()
            if token:
                user_from_token = await self._get_user_from_token(token)
                if user_from_token is not None:
                    user = user_from_token
                    self.scope["user"] = user_from_token

        # Kanał publiczny pozostaje dostępny wyłącznie dla opublikowanego turnieju.
        if not user.is_authenticated:
            if not await self._is_tournament_published(self.tournament_id):
                await self.close(code=4403)
                return

        self.group_name = tournament_group_name(self.tournament_id)
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive_json(self, content, **kwargs):
        # Kanał jest jednokierunkowy i nie przyjmuje komend od klienta.
        return

    async def tournament_event(self, event):
        ev = event.get("event")
        if isinstance(ev, dict):
            await self.send_json(ev)
            return

        # Wrapper zachowuje zgodność ze starszym formatem event/payload.
        payload = event.get("payload") or {}
        await self.send_json({"v": 1, "type": str(ev or "unknown"), "payload": payload})

    def _get_token_from_qs(self) -> str | None:
        raw = self.scope.get("query_string")
        if not raw:
            return None
        try:
            params = parse_qs(raw.decode("utf-8"))
        except Exception:
            return None
        token = params.get("token", [None])[0]
        return token or None

    @database_sync_to_async
    def _get_user_from_token(self, token: str):
        try:
            decoded = AccessToken(token)
            user_id = decoded.get("user_id")
            if not user_id:
                return None
            User = get_user_model()
            return User.objects.filter(id=user_id, is_active=True).first()
        except Exception:
            return None

    @database_sync_to_async
    def _is_tournament_published(self, tournament_id: int) -> bool:
        return Tournament.objects.filter(id=tournament_id, is_published=True).exists()
