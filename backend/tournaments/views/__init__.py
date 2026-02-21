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
    ContinueMatchView,
    SetScheduledMatchView,
)

from .stages import (
    AdvanceFromGroupsView,
)

from .standings import (
    TournamentStandingsView,
)

# =========================
# NEW: incidents + match clock
# =========================
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

# =========================
# NEW: match commentary + phrase dictionary
# =========================
from .commentary import (
    MatchCommentaryListCreateView,
    MatchCommentaryDetailView,
    TournamentCommentaryPhraseListCreateView,
    TournamentCommentaryPhraseDetailView,
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
    "ContinueMatchView",
    "SetScheduledMatchView",

    # stages
    "AdvanceFromGroupsView",

    # standings
    "TournamentStandingsView",

    # NEW: incidents
    "MatchIncidentListCreateView",
    "MatchIncidentDeleteView",
    "MatchIncidentRecomputeScoreView",

    # NEW: clock
    "MatchClockGetView",
    "MatchClockStartView",
    "MatchClockPauseView",
    "MatchClockResumeView",
    "MatchClockStopView",
    "MatchClockSetPeriodView",
    "MatchClockSetAddedSecondsView",

    # NEW: commentary
    "MatchCommentaryListCreateView",
    "MatchCommentaryDetailView",

    # NEW: phrase dictionary
    "TournamentCommentaryPhraseListCreateView",
    "TournamentCommentaryPhraseDetailView",
]
