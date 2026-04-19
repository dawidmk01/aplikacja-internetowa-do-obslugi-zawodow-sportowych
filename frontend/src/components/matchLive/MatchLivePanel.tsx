// frontend/src/components/matchLive/MatchLivePanel.tsx
// Komponent spina panel live meczu i przekazuje wspólny kontekst zegara do incydentów oraz komentarza.

import { useCallback, useMemo, useState } from "react";

import { cn } from "../../lib/cn";

import type { MatchStatus } from "./matchLive.utils";

import { ClockPanel, type ClockMeta } from "./ClockPanel";
import { CommentaryPanel } from "./CommentaryPanel";
import { IncidentsPanel } from "./IncidentsPanel";

type LiveMatchSummary = {
  id: number;
  status: MatchStatus;
  homeTeamId?: number;
  awayTeamId?: number;
  homeTeamName: string;
  awayTeamName: string;
};

type Props = {
  tournamentId: string;
  discipline: string;
  goalScope: "REGULAR" | "EXTRA_TIME";
  canEdit: boolean;

  scoreContext?: {
    home: number;
    away: number;
    stageType?: string;
    wentToExtraTime?: boolean;
  };

  match: LiveMatchSummary;

  onRequestConfirmIncidentDelete?: (req: any, proceed: () => void) => void;
  onEnterExtraTime?: () => void;
  onAfterRecompute?: () => Promise<void> | void;
};

export default function MatchLivePanel({
  tournamentId,
  discipline,
  goalScope,
  canEdit,
  scoreContext,
  match,
  onRequestConfirmIncidentDelete,
  onEnterExtraTime,
  onAfterRecompute,
}: Props) {
  const numericTournamentId = useMemo(() => {
    const n = Number(tournamentId);
    return Number.isFinite(n) ? n : 0;
  }, [tournamentId]);

  const [clockMeta, setClockMeta] = useState<ClockMeta | null>(null);
  const [clockReloadToken, setClockReloadToken] = useState(0);
  const [incidentsReloadToken, setIncidentsReloadToken] = useState(0);

  const requestClockReload = useCallback(() => setClockReloadToken((x) => x + 1), []);
  const requestIncidentsReload = useCallback(() => setIncidentsReloadToken((x) => x + 1), []);

  const commentaryMinute = useMemo(() => {
    const m: any = clockMeta as any;
    const raw =
      m?.commentaryMinute ??
      m?.minute_total ??
      m?.minuteTotal ??
      m?.minute ??
      m?.matchMinute ??
      m?.totalMinute ??
      0;

    const n = Number(raw);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }, [clockMeta]);

  return (
    <div className={cn("grid w-full min-w-0 gap-3")}>
      <ClockPanel
        matchId={match.id}
        matchStatus={match.status}
        discipline={discipline}
        canEdit={canEdit}
        scoreContext={scoreContext}
        reloadToken={clockReloadToken}
        onMetaChange={setClockMeta}
        onEnterExtraTime={onEnterExtraTime}
        onAfterRecompute={onAfterRecompute}
        onRequestIncidentsReload={requestIncidentsReload}
      />

      <div className="grid min-w-0 items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <IncidentsPanel
            tournamentId={numericTournamentId}
            matchId={match.id}
            discipline={discipline}
            canEdit={canEdit}
            goalScope={goalScope}
            homeTeamId={match.homeTeamId}
            awayTeamId={match.awayTeamId}
            homeTeamName={match.homeTeamName}
            awayTeamName={match.awayTeamName}
            clockMeta={clockMeta}
            reloadToken={incidentsReloadToken}
            onRequestConfirmIncidentDelete={onRequestConfirmIncidentDelete}
            onAfterRecompute={onAfterRecompute}
            onRequestClockReload={requestClockReload}
          />
        </div>

        <div className="min-w-0">
          <CommentaryPanel
            tournamentId={numericTournamentId}
            matchId={match.id}
            canEdit={canEdit}
            minute={commentaryMinute}
            discipline={discipline}
            homeTeamName={match.homeTeamName}
            awayTeamName={match.awayTeamName}
          />
        </div>
      </div>
    </div>
  );
}
