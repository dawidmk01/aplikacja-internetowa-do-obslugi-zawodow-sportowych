from django.urls import path

from .views import (
    # tournaments
    TournamentListView,
    TournamentDetailView,
    TournamentMetaUpdateView,
    MyTournamentListView,
    ArchiveTournamentView,
    UnarchiveTournamentView,
    ChangeDisciplineView,
    ChangeSetupView,

    # assistants
    TournamentAssistantListView,
    AddAssistantView,
    RemoveAssistantView,

    # teams
    TournamentTeamSetupView,
    TournamentTeamListView,
    TournamentTeamUpdateView,

    # matches
    TournamentMatchListView,
    MatchScheduleUpdateView,
    MatchResultUpdateView,
    FinishMatchView,

    # stages
    AdvanceFromGroupsView,
)

# standings + public matches
try:
    from .views import TournamentStandingsView  # type: ignore
except ImportError:
    from .views.standings import TournamentStandingsView  # type: ignore

try:
    from .views import TournamentPublicMatchListView  # type: ignore
except ImportError:
    from .views.public import TournamentPublicMatchListView  # type: ignore


urlpatterns = [
    # =========================
    # TURNIEJE
    # =========================
    path("tournaments/", TournamentListView.as_view(), name="tournament-list"),
    path("tournaments/my/", MyTournamentListView.as_view(), name="my-tournament-list"),
    path("tournaments/<int:pk>/", TournamentDetailView.as_view(), name="tournament-detail"),
    path("tournaments/<int:pk>/meta/", TournamentMetaUpdateView.as_view(), name="tournament-meta"),

    path("tournaments/<int:pk>/archive/", ArchiveTournamentView.as_view(), name="tournament-archive"),
    path("tournaments/<int:pk>/unarchive/", UnarchiveTournamentView.as_view(), name="tournament-unarchive"),
    path("tournaments/<int:pk>/change-discipline/", ChangeDisciplineView.as_view(), name="tournament-change-discipline"),
    path("tournaments/<int:pk>/change-setup/", ChangeSetupView.as_view(), name="tournament-change-setup"),

    # =========================
    # ASYSTENCI
    # =========================
    path("tournaments/<int:pk>/assistants/", TournamentAssistantListView.as_view(), name="tournament-assistants"),
    path("tournaments/<int:pk>/assistants/list/", TournamentAssistantListView.as_view(), name="tournament-assistants-list"),
    path("tournaments/<int:pk>/assistants/add/", AddAssistantView.as_view(), name="assistant-add"),
    path("tournaments/<int:pk>/assistants/remove/", RemoveAssistantView.as_view(), name="assistant-remove"),

    # =========================
    # DRUŻYNY
    # =========================
    path("tournaments/<int:pk>/teams/", TournamentTeamListView.as_view(), name="tournament-teams"),
    path("tournaments/<int:pk>/teams/setup/", TournamentTeamSetupView.as_view(), name="tournament-teams-setup"),
    path("tournaments/<int:pk>/teams/update/", TournamentTeamUpdateView.as_view(), name="tournament-teams-update"),

    # =========================
    # MECZE
    # =========================
    path("tournaments/<int:pk>/matches/", TournamentMatchListView.as_view(), name="tournament-matches"),
    path("tournaments/<int:pk>/public/matches/", TournamentPublicMatchListView.as_view(), name="tournament-public-matches"),

    path("matches/<int:pk>/", MatchScheduleUpdateView.as_view(), name="match-schedule-detail"),
    path("matches/<int:pk>/result/", MatchResultUpdateView.as_view(), name="match-result-update"),
    path("matches/<int:pk>/finish/", FinishMatchView.as_view(), name="match-finish"),

    # =========================
    # ETAPY – GRUPY → KO
    # =========================

    # 🔹 STARY endpoint – wymagany przez frontend (PRZYWRÓCONY)
    path(
        "tournaments/<int:pk>/advance-from-groups/",
        AdvanceFromGroupsView.as_view(),
        name="tournament-advance-from-groups",
    ),

    # 🔹 NOWY endpoint – alias (opcjonalny, może zostać)
    path(
        "tournaments/<int:pk>/stages/advance/",
        AdvanceFromGroupsView.as_view(),
        name="stage-advance",
    ),

    # =========================
    # STANDINGS
    # =========================
    path("tournaments/<int:pk>/standings/", TournamentStandingsView.as_view(), name="tournament-standings"),
]
