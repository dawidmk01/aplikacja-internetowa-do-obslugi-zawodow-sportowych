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
    AssistantPermissionsView,

    # teams
    TournamentTeamSetupView,
    TournamentTeamListView,
    TournamentTeamUpdateView,

    # team name change requests (QUEUE)
    TournamentTeamNameChangeRequestListView,
    TournamentTeamNameChangeRequestCreateView,
    TournamentTeamNameChangeRequestApproveView,
    TournamentTeamNameChangeRequestRejectView,

    # matches
    TournamentMatchListView,
    TournamentPublicMatchListView,
    MatchScheduleUpdateView,
    MatchResultUpdateView,
    FinishMatchView,

    # standings
    TournamentStandingsView,

    # registrations (join toggle + code)
    TournamentRegistrationVerifyView,
    TournamentRegistrationJoinView,
    TournamentRegistrationMeView,
    TournamentRegistrationMyMatchesView,
)

urlpatterns = [
    # --- TOURNAMENTS ---
    path("tournaments/", TournamentListView.as_view()),
    path("tournaments/my/", MyTournamentListView.as_view()),
    path("tournaments/<int:pk>/", TournamentDetailView.as_view()),
    path("tournaments/<int:pk>/meta/", TournamentMetaUpdateView.as_view()),
    path("tournaments/<int:pk>/archive/", ArchiveTournamentView.as_view()),
    path("tournaments/<int:pk>/unarchive/", UnarchiveTournamentView.as_view()),

    # kanoniczne
    path("tournaments/<int:pk>/discipline/", ChangeDisciplineView.as_view()),
    path("tournaments/<int:pk>/setup/", ChangeSetupView.as_view()),

    # aliasy (wsteczna kompatybilność z frontendem)
    path("tournaments/<int:pk>/change-discipline/", ChangeDisciplineView.as_view()),
    path("tournaments/<int:pk>/change-setup/", ChangeSetupView.as_view()),

    # --- ASSISTANTS ---
    path("tournaments/<int:pk>/assistants/", TournamentAssistantListView.as_view()),
    path("tournaments/<int:pk>/assistants/add/", AddAssistantView.as_view()),
    path("tournaments/<int:pk>/assistants/<int:user_id>/remove/", RemoveAssistantView.as_view()),
    path("tournaments/<int:pk>/assistants/<int:user_id>/permissions/", AssistantPermissionsView.as_view()),

    # --- TEAMS ---
    path("tournaments/<int:pk>/teams/setup/", TournamentTeamSetupView.as_view()),
    path("tournaments/<int:pk>/teams/", TournamentTeamListView.as_view()),
    path("tournaments/<int:pk>/teams/<int:team_id>/", TournamentTeamUpdateView.as_view()),

    # --- TEAM NAME CHANGE REQUESTS (QUEUE) ---
    # organizer/asystent: lista + count
    path(
        "tournaments/<int:pk>/teams/name-change-requests/",
        TournamentTeamNameChangeRequestListView.as_view(),
    ),
    # participant: create request for given team
    path(
        "tournaments/<int:pk>/teams/<int:team_id>/name-change-requests/",
        TournamentTeamNameChangeRequestCreateView.as_view(),
    ),
    # organizer/asystent: approve / reject
    path(
        "tournaments/<int:pk>/teams/name-change-requests/<int:request_id>/approve/",
        TournamentTeamNameChangeRequestApproveView.as_view(),
    ),
    path(
        "tournaments/<int:pk>/teams/name-change-requests/<int:request_id>/reject/",
        TournamentTeamNameChangeRequestRejectView.as_view(),
    ),

    # --- MATCHES ---
    path("tournaments/<int:pk>/matches/", TournamentMatchListView.as_view()),
    path("tournaments/<int:pk>/public/matches/", TournamentPublicMatchListView.as_view()),
    path("matches/<int:pk>/", MatchScheduleUpdateView.as_view()),
    path("matches/<int:pk>/result/", MatchResultUpdateView.as_view()),
    path("matches/<int:pk>/finish/", FinishMatchView.as_view()),

    # --- STANDINGS ---
    path("tournaments/<int:pk>/standings/", TournamentStandingsView.as_view()),
    path("tournaments/<int:pk>/public/standings/", TournamentStandingsView.as_view()),

    # --- REGISTRATIONS (join toggle + code) ---
    path("tournaments/<int:pk>/registrations/verify/", TournamentRegistrationVerifyView.as_view()),
    path("tournaments/<int:pk>/registrations/join/", TournamentRegistrationJoinView.as_view()),
    path("tournaments/<int:pk>/registrations/me/", TournamentRegistrationMeView.as_view()),
    path("tournaments/<int:pk>/registrations/my/matches/", TournamentRegistrationMyMatchesView.as_view()),
]
