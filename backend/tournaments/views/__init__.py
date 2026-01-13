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
)

from .teams import (
    TournamentTeamSetupView,
    TournamentTeamListView,
    TournamentTeamUpdateView,
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

    # teams
    "TournamentTeamSetupView",
    "TournamentTeamListView",
    "TournamentTeamUpdateView",

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
