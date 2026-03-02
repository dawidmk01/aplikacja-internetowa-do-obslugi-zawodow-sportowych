# backend/tournaments/views/__init__.py
# Plik eksportuje publiczny zestaw widoków używanych przez routing aplikacji turniejów.

from .assistants import (
    AddAssistantView,
    AssistantPermissionsView,
    RemoveAssistantView,
    TournamentAssistantListView,
)
from .commentary import (
    MatchCommentaryDetailView,
    MatchCommentaryListCreateView,
    TournamentCommentaryPhraseDetailView,
    TournamentCommentaryPhraseListCreateView,
)
from .incidents import (
    MatchIncidentDeleteView,
    MatchIncidentListCreateView,
    MatchIncidentRecomputeScoreView,
)
from .match_clock import (
    MatchClockGetView,
    MatchClockPauseView,
    MatchClockResetPeriodView,
    MatchClockResumeView,
    MatchClockSetAddedSecondsView,
    MatchClockSetPeriodView,
    MatchClockStartView,
    MatchClockStopView,
)
from .matches import (
    ContinueMatchView,
    FinishMatchView,
    MatchResultUpdateView,
    MatchScheduleUpdateView,
    SetScheduledMatchView,
    TournamentMatchListView,
    TournamentPublicMatchListView,
)
from .registrations import (
    TournamentRegistrationJoinView,
    TournamentRegistrationMeView,
    TournamentRegistrationMyMatchesView,
    TournamentRegistrationVerifyView,
)
from .stages import (
    AdvanceFromGroupsView,
)
from .standings import (
    TournamentStandingsView,
)
from .teams import (
    TournamentMyTeamPlayersView,
    TournamentTeamListView,
    TournamentTeamNameChangeRequestApproveView,
    TournamentTeamNameChangeRequestCreateView,
    TournamentTeamNameChangeRequestListView,
    TournamentTeamNameChangeRequestRejectView,
    TournamentTeamPlayersView,
    TournamentTeamSetupView,
    TournamentTeamUpdateView,
)
from .tournaments import (
    ArchiveTournamentView,
    ChangeDisciplineView,
    ChangeSetupView,
    MyTournamentListView,
    TournamentDetailView,
    TournamentListView,
    TournamentMetaUpdateView,
    UnarchiveTournamentView,
)