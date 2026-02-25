from django.urls import re_path

from .consumers import TournamentConsumer
from .consumers_me import MeConsumer

websocket_urlpatterns = [
    re_path(r"^ws/me/$", MeConsumer.as_asgi()),
    re_path(r"^ws/tournaments/(?P<tournament_id>\d+)/$", TournamentConsumer.as_asgi()),
]
