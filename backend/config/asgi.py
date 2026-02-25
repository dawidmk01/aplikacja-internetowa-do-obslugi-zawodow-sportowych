# backend/config/asgi.py
# Plik składa aplikację ASGI oraz nakłada kontrolę pochodzenia i autoryzację WebSocket.

import os
from urllib.parse import parse_qs

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
from django.core.asgi import get_asgi_application

from channels.auth import AuthMiddlewareStack
from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.security.websocket import OriginValidator
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import AccessToken

django_asgi_app = get_asgi_application()


def _get_token_from_query_string(scope) -> str | None:
    raw_query_string = scope.get("query_string", b"")
    query_string = raw_query_string.decode("utf-8")
    return parse_qs(query_string).get("token", [None])[0]


def _get_token_from_subprotocols(scope) -> str | None:
    subprotocols = scope.get("subprotocols") or []
    for protocol in subprotocols:
        if not isinstance(protocol, str):
            continue
        if protocol.startswith("bearer."):
            return protocol.removeprefix("bearer.")
        if protocol.startswith("token."):
            return protocol.removeprefix("token.")
    return None


def _extract_access_token(scope) -> str | None:
    return _get_token_from_subprotocols(scope) or _get_token_from_query_string(scope)


class JwtQueryStringAuthMiddleware(BaseMiddleware):
    async def __call__(self, scope, receive, send):
        scope["user"] = AnonymousUser()

        token = _extract_access_token(scope)
        if token:
            scope["user"] = await self._get_user_from_token(token)

        return await super().__call__(scope, receive, send)

    @database_sync_to_async
    def _get_user_from_token(self, token: str):
        try:
            access = AccessToken(token)
            user_id = access.payload.get("user_id")
            if not user_id:
                return AnonymousUser()
        except (TokenError, KeyError, TypeError, ValueError):
            return AnonymousUser()

        User = get_user_model()
        try:
            return User.objects.get(pk=user_id)
        except User.DoesNotExist:
            return AnonymousUser()


def _load_websocket_urlpatterns():
    from tournaments.routing import websocket_urlpatterns

    return websocket_urlpatterns


def _get_allowed_ws_origins() -> list[str]:
    raw = os.getenv("DJANGO_WS_ALLOWED_ORIGINS")
    if raw:
        return [item.strip() for item in raw.split(",") if item.strip()]

    configured = getattr(settings, "CORS_ALLOWED_ORIGINS", [])
    if configured:
        return list(configured)

    return [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]


application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        "websocket": OriginValidator(
            AuthMiddlewareStack(
                JwtQueryStringAuthMiddleware(
                    URLRouter(_load_websocket_urlpatterns())
                )
            ),
            _get_allowed_ws_origins(),
        ),
    }
)
