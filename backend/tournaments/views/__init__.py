# backend/tournaments/views/__init__.py

from .tournaments import (
    TournamentListView,
    TournamentDetailView,
    TournamentMetaUpdateView,
    MyTournamentListView,
    ArchiveTournamentView,
    UnarchiveTournamentView,
    ChangeDisciplineView,
    ChangeSetupView,
)

from .assistants import (
    TournamentAssistantListView,
    AddAssistantView,
    RemoveAssistantView,
    AssistantPermissionsView,
)

from .registrations import (
    TournamentRegistrationVerifyView,
    TournamentRegistrationJoinView,
    TournamentRegistrationMeView,
    TournamentRegistrationMyMatchesView,
)

from .teams import (
    TournamentTeamSetupView,
    TournamentTeamListView,
    TournamentTeamUpdateView,

    # roster (players)
    TournamentTeamPlayersView,
    TournamentMyTeamPlayersView,

    # team name change requests (QUEUE)
    TournamentTeamNameChangeRequestListView,
    TournamentTeamNameChangeRequestCreateView,
    TournamentTeamNameChangeRequestApproveView,
    TournamentTeamNameChangeRequestRejectView,
)

from .matches import (
    TournamentMatchListView,
    TournamentPublicMatchListView,
    MatchScheduleUpdateView,
    MatchResultUpdateView,
    FinishMatchView,
)

from .stages import (
    AdvanceFromGroupsView,
)

from .standings import (
    TournamentStandingsView,
)

__all__ = [
    # tournaments
    "TournamentListView",
    "TournamentDetailView",
    "TournamentMetaUpdateView",
    "MyTournamentListView",
    "ArchiveTournamentView",
    "UnarchiveTournamentView",
    "ChangeDisciplineView",
    "ChangeSetupView",

    # assistants
    "TournamentAssistantListView",
    "AddAssistantView",
    "RemoveAssistantView",
    "AssistantPermissionsView",

    # registrations
    "TournamentRegistrationVerifyView",
    "TournamentRegistrationJoinView",
    "TournamentRegistrationMeView",
    "TournamentRegistrationMyMatchesView",

    # teams
    "TournamentTeamSetupView",
    "TournamentTeamListView",
    "TournamentTeamUpdateView",

    # roster (players)
    "TournamentTeamPlayersView",
    "TournamentMyTeamPlayersView",

    # team name change requests
    "TournamentTeamNameChangeRequestListView",
    "TournamentTeamNameChangeRequestCreateView",
    "TournamentTeamNameChangeRequestApproveView",
    "TournamentTeamNameChangeRequestRejectView",

    # matches
    "TournamentMatchListView",
    "TournamentPublicMatchListView",
    "MatchScheduleUpdateView",
    "MatchResultUpdateView",
    "FinishMatchView",

    # stages
    "AdvanceFromGroupsView",

    # standings
    "TournamentStandingsView",
]
