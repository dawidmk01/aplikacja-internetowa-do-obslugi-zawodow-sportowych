"""
ASGI config for config project.

It exposes the ASGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/5.0/howto/deployment/asgi/
"""

import os
from urllib.parse import parse_qs

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

from django.contrib.auth import get_user_model
from django.contrib.auth.models import AnonymousUser
from django.core.asgi import get_asgi_application

from channels.auth import AuthMiddlewareStack
from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.security.websocket import OriginValidator

from rest_framework_simplejwt.tokens import AccessToken


django_asgi_app = get_asgi_application()


class JwtQueryStringAuthMiddleware(BaseMiddleware):
    async def __call__(self, scope, receive, send):
        scope["user"] = AnonymousUser()

        query_string = scope.get("query_string", b"").decode("utf-8")
        token = parse_qs(query_string).get("token", [None])[0]

        if token:
            scope["user"] = await self._get_user_from_token(token)

        return await super().__call__(scope, receive, send)

    @database_sync_to_async
    def _get_user_from_token(self, token: str):
        try:
            access = AccessToken(token)
            user_id = access.get("user_id")
            if not user_id:
                return AnonymousUser()

            User = get_user_model()
            return User.objects.get(id=user_id)
        except Exception:
            return AnonymousUser()


def _load_websocket_urlpatterns():
    from tournaments.routing import websocket_urlpatterns

    return websocket_urlpatterns


def _get_allowed_ws_origins():
    raw = os.getenv("DJANGO_WS_ALLOWED_ORIGINS")
    if raw:
        return [x.strip() for x in raw.split(",") if x.strip()]

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