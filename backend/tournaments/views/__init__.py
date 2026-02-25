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
    TournamentTeamPlayersView,
    TournamentMyTeamPlayersView,
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
    ContinueMatchView,
    SetScheduledMatchView,
)

from .stages import (
    AdvanceFromGroupsView,
)

from .standings import (
    TournamentStandingsView,
)

from .incidents import (
    MatchIncidentListCreateView,
    MatchIncidentDeleteView,
    MatchIncidentRecomputeScoreView,
)

from .match_clock import (
    MatchClockGetView,
    MatchClockStartView,
    MatchClockPauseView,
    MatchClockResumeView,
    MatchClockStopView,
    MatchClockSetPeriodView,
    MatchClockSetAddedSecondsView,
)

from .commentary import (
    MatchCommentaryListCreateView,
    MatchCommentaryDetailView,
    TournamentCommentaryPhraseListCreateView,
    TournamentCommentaryPhraseDetailView,
)

__all__ = [
    "TournamentListView",
    "TournamentDetailView",
    "TournamentMetaUpdateView",
    "MyTournamentListView",
    "ArchiveTournamentView",
    "UnarchiveTournamentView",
    "ChangeDisciplineView",
    "ChangeSetupView",
    "TournamentAssistantListView",
    "AddAssistantView",
    "RemoveAssistantView",
    "AssistantPermissionsView",
    "TournamentRegistrationVerifyView",
    "TournamentRegistrationJoinView",
    "TournamentRegistrationMeView",
    "TournamentRegistrationMyMatchesView",
    "TournamentTeamSetupView",
    "TournamentTeamListView",
    "TournamentTeamUpdateView",
    "TournamentTeamPlayersView",
    "TournamentMyTeamPlayersView",
    "TournamentTeamNameChangeRequestListView",
    "TournamentTeamNameChangeRequestCreateView",
    "TournamentTeamNameChangeRequestApproveView",
    "TournamentTeamNameChangeRequestRejectView",
    "TournamentMatchListView",
    "TournamentPublicMatchListView",
    "MatchScheduleUpdateView",
    "MatchResultUpdateView",
    "FinishMatchView",
    "ContinueMatchView",
    "SetScheduledMatchView",
    "AdvanceFromGroupsView",
    "TournamentStandingsView",
    "MatchIncidentListCreateView",
    "MatchIncidentDeleteView",
    "MatchIncidentRecomputeScoreView",
    "MatchClockGetView",
    "MatchClockStartView",
    "MatchClockPauseView",
    "MatchClockResumeView",
    "MatchClockStopView",
    "MatchClockSetPeriodView",
    "MatchClockSetAddedSecondsView",
    "MatchCommentaryListCreateView",
    "MatchCommentaryDetailView",
    "TournamentCommentaryPhraseListCreateView",
    "TournamentCommentaryPhraseDetailView",
]