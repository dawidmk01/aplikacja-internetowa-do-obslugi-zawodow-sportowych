from django.urls import path

from .views.tournaments import (
    TournamentListView,
    TournamentDetailView,
    MyTournamentListView,
    ArchiveTournamentView,
    UnarchiveTournamentView,
    GenerateTournamentView,
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
from .views.stages import ConfirmStageView
from tournaments.views.standings import TournamentKnockoutBracketView
from tournaments.views.standings import TournamentLeagueTableView
from tournaments.views.standings import TournamentLeagueStandingsView


urlpatterns = [
    # TURNIEJE
    path("tournaments/", TournamentListView.as_view(), name="tournament-list"),
    path("tournaments/my/", MyTournamentListView.as_view(), name="my-tournaments"),
    path("tournaments/<int:pk>/", TournamentDetailView.as_view(), name="tournament-detail"),

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

    # GENEROWANIE
    path("tournaments/<int:pk>/generate/", GenerateTournamentView.as_view(), name="tournament-generate"),

    # MECZE (LISTA)
    path("tournaments/<int:pk>/matches/", TournamentMatchListView.as_view(), name="tournament-matches"),

    # MECZ – HARMONOGRAM
    path("matches/<int:pk>/", MatchScheduleUpdateView.as_view(), name="match-schedule-update"),

    # MECZ – WYNIK
    path("matches/<int:pk>/result/", MatchResultUpdateView.as_view(), name="match-result-update"),

    # MECZ – ZAKOŃCZENIE
    path("matches/<int:pk>/finish/", FinishMatchView.as_view(), name="match-finish"),

    # ETAP KO – LEGACY
    path("stages/<int:pk>/confirm/", ConfirmStageView.as_view(), name="stage-confirm"),
    path("tournaments/<int:tournament_id>/bracket/", TournamentKnockoutBracketView.as_view()),
# STANDINGS – LIGA
    path(
        "tournaments/<int:pk>/league-table/",
        TournamentLeagueTableView.as_view(),
        name="tournament-league-table",
    ),
# STANDINGS – LIGA / GRUPY
    path(
        "tournaments/<int:pk>/standings/",
        TournamentLeagueStandingsView.as_view(),
        name="tournament-standings",
    ),


]
