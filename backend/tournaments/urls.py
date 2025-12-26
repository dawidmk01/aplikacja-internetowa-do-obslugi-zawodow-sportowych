from django.urls import path
from .views import (
    TournamentListView,
    TournamentDetailView,
    MyTournamentListView,
    TournamentAssistantListView,
    AddAssistantView,
    RemoveAssistantView,
)

urlpatterns = [
    path("tournaments/", TournamentListView.as_view(), name="tournament-list"),
    path("tournaments/my/", MyTournamentListView.as_view(), name="my-tournaments"),
    path(
        "tournaments/<int:pk>/",
        TournamentDetailView.as_view(),
        name="tournament-detail",
    ),
    path(
        "tournaments/<int:pk>/assistants/",
        AddAssistantView.as_view(),
        name="tournament-add-assistant",
    ),
    path(
        "tournaments/<int:pk>/assistants/list/",
        TournamentAssistantListView.as_view(),
        name="tournament-assistants-list",
    ),
    path(
        "tournaments/<int:pk>/assistants/<int:user_id>/",
        RemoveAssistantView.as_view(),
        name="tournament-remove-assistant",
    ),
]
