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

from .registrations import (
    TournamentRegistrationVerifyView,
    TournamentRegistrationJoinView,
    TournamentRegistrationMeView,
    TournamentRegistrationMyMatchesView,
    # Aliasy/Nowe widoki rejestracji
    TournamentSelfRegisterView,
    TournamentSelfRegisterMeView,
    TournamentSelfRegisterMyMatchesView,
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

    # registrations
    "TournamentRegistrationVerifyView",
    "TournamentRegistrationJoinView",
    "TournamentRegistrationMeView",
    "TournamentRegistrationMyMatchesView",
    "TournamentSelfRegisterView",
    "TournamentSelfRegisterMeView",
    "TournamentSelfRegisterMyMatchesView",

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