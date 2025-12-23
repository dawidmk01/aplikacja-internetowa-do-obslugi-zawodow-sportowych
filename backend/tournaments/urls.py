from django.urls import path
from .views import TournamentListView

urlpatterns = [
    path("tournaments/", TournamentListView.as_view(), name="tournament-list"),
]
