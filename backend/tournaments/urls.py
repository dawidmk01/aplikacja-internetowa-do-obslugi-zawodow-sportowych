from django.urls import path

from .views.tournaments import (
    TournamentListView,
    TournamentDetailView,
    MyTournamentListView,
    ArchiveTournamentView,
    UnarchiveTournamentView,
    ChangeDisciplineView,
    ChangeSetupView,
)
from .views.assistants import (
    TournamentAssistantListView,
    AddAssistantView,
    RemoveAssistantView,
)
from .views.teams import (
    TournamentTeamSetupView,
    TournamentTeamListView,
    TournamentTeamUpdateView,
)
from .views.matches import (
    TournamentMatchListView,
    MatchScheduleUpdateView,
    MatchResultUpdateView,
    FinishMatchView,
)
from .views.stages import AdvanceFromGroupsView
from tournaments.views.standings import TournamentStandingsView


urlpatterns = [
    # TURNIEJE
    path("tournaments/", TournamentListView.as_view(), name="tournament-list"),
    path("tournaments/my/", MyTournamentListView.as_view(), name="my-tournaments"),
    path("tournaments/<int:pk>/", TournamentDetailView.as_view(), name="tournament-detail"),

    # ZMIANA DYSCYPLINY
    path(
        "tournaments/<int:pk>/change-discipline/",
        ChangeDisciplineView.as_view(),
        name="tournament-change-discipline",
    ),

    # ZMIANA SETUP (format/config)
    path(
        "tournaments/<int:pk>/change-setup/",
        ChangeSetupView.as_view(),
        name="tournament-change-setup",
    ),

    # ARCHIWIZACJA
    path("tournaments/<int:pk>/archive/", ArchiveTournamentView.as_view(), name="tournament-archive"),
    path("tournaments/<int:pk>/unarchive/", UnarchiveTournamentView.as_view(), name="tournament-unarchive"),

    # WSPÓŁORGANIZATORZY
    path("tournaments/<int:pk>/assistants/", AddAssistantView.as_view(), name="tournament-add-assistant"),
    path("tournaments/<int:pk>/assistants/list/", TournamentAssistantListView.as_view(), name="tournament-assistants-list"),
    path("tournaments/<int:pk>/assistants/<int:user_id>/", RemoveAssistantView.as_view(), name="tournament-remove-assistant"),

    # UCZESTNICY
    path("tournaments/<int:pk>/teams/setup/", TournamentTeamSetupView.as_view(), name="tournament-participants-setup"),
    path("tournaments/<int:pk>/teams/", TournamentTeamListView.as_view(), name="tournament-participants-list"),
    path("tournaments/<int:pk>/teams/<int:team_id>/", TournamentTeamUpdateView.as_view(), name="tournament-participant-update"),

    # GRUPY → KO
    path(
        "tournaments/<int:pk>/advance-from-groups/",
        AdvanceFromGroupsView.as_view(),
        name="tournament-advance-from-groups",
    ),

    # MECZE
    path("tournaments/<int:pk>/matches/", TournamentMatchListView.as_view(), name="tournament-matches"),
    path("matches/<int:pk>/", MatchScheduleUpdateView.as_view(), name="match-schedule-update"),
    path("matches/<int:pk>/result/", MatchResultUpdateView.as_view(), name="match-result-update"),
    path("matches/<int:pk>/finish/", FinishMatchView.as_view(), name="match-finish"),

    # STANDINGS
    path("tournaments/<int:pk>/standings/", TournamentStandingsView.as_view(), name="tournament-standings"),
]
