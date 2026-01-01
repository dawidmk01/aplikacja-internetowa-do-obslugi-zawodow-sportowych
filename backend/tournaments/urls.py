from django.urls import path

from .views import (
    TournamentListView,
    TournamentDetailView,
    MyTournamentListView,
    TournamentAssistantListView,
    AddAssistantView,
    RemoveAssistantView,
    TournamentTeamSetupView,
    TournamentTeamListView,
    TournamentTeamUpdateView,
    GenerateTournamentView,
    TournamentMatchListView,
    ArchiveTournamentView,
    UnarchiveTournamentView,
    MatchScheduleUpdateView,
)

urlpatterns = [
    # ========================================================
    # TURNIEJE – LISTA I SZCZEGÓŁY
    # ========================================================

    path(
        "tournaments/",
        TournamentListView.as_view(),
        name="tournament-list",
    ),
    path(
        "tournaments/my/",
        MyTournamentListView.as_view(),
        name="my-tournaments",
    ),
    path(
        "tournaments/<int:pk>/",
        TournamentDetailView.as_view(),
        name="tournament-detail",
    ),

    # ========================================================
    # ARCHIWIZACJA
    # ========================================================

    path(
        "tournaments/<int:pk>/archive/",
        ArchiveTournamentView.as_view(),
        name="tournament-archive",
    ),
    path(
        "tournaments/<int:pk>/unarchive/",
        UnarchiveTournamentView.as_view(),
        name="tournament-unarchive",
    ),

    # ========================================================
    # WSPÓŁORGANIZATORZY
    # ========================================================

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

    # ========================================================
    # UCZESTNICY TURNIEJU
    # ========================================================

    path(
        "tournaments/<int:pk>/teams/setup/",
        TournamentTeamSetupView.as_view(),
        name="tournament-participants-setup",
    ),
    path(
        "tournaments/<int:pk>/teams/",
        TournamentTeamListView.as_view(),
        name="tournament-participants-list",
    ),
    path(
        "tournaments/<int:pk>/teams/<int:team_id>/",
        TournamentTeamUpdateView.as_view(),
        name="tournament-participant-update",
    ),

    # ========================================================
    # GENEROWANIE ROZGRYWEK
    # ========================================================

    path(
        "tournaments/<int:pk>/generate/",
        GenerateTournamentView.as_view(),
        name="tournament-generate",
    ),

    # ========================================================
    # MECZE TURNIEJU (LISTA)
    # ========================================================

    path(
        "tournaments/<int:pk>/matches/",
        TournamentMatchListView.as_view(),
        name="tournament-matches",
    ),

    # ========================================================
    # MECZE – HARMONOGRAM (PATCH)
    # ========================================================

    path(
        "matches/<int:pk>/",
        MatchScheduleUpdateView.as_view(),
        name="match-schedule-update",
    ),
]
