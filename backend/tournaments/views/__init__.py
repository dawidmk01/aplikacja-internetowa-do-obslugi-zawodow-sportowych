from .tournaments import (
    TournamentListView,
    TournamentDetailView,
    MyTournamentListView,
    ArchiveTournamentView,
    UnarchiveTournamentView,
    GenerateTournamentView,
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
    MatchScheduleUpdateView,
    MatchResultUpdateView,
    FinishMatchView,
)

from .stages import (
    ConfirmStageView,
)

__all__ = [
    # tournaments
    "TournamentListView",
    "TournamentDetailView",
    "MyTournamentListView",
    "ArchiveTournamentView",
    "UnarchiveTournamentView",
    "GenerateTournamentView",
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
    "MatchScheduleUpdateView",
    "MatchResultUpdateView",
    "FinishMatchView",
    # stages
    "ConfirmStageView",
]
