// frontend/src/components/matchLive/MatchLivePanel.tsx
import { useMemo, useState } from "react";

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
  tournamentId: string; // z useParams
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

  const requestClockReload = () => setClockReloadToken((x) => x + 1);
  const requestIncidentsReload = () => setIncidentsReloadToken((x) => x + 1);

  const commentaryMinute = useMemo(() => {
    // Bezpiecznie: różne wersje ClockMeta mogły mieć inne nazwy pola.
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
    <div className={cn("grid gap-3")}>
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

      <div className="grid gap-3 lg:grid-cols-2">
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

        <CommentaryPanel
          tournamentId={numericTournamentId}
          matchId={match.id}
          canEdit={canEdit}
          minute={commentaryMinute}
          homeTeamName={match.homeTeamName}
          awayTeamName={match.awayTeamName}
        />
      </div>
    </div>
  );
}

/*
Co zmieniono:
1) Przekazano tournamentId do IncidentsPanel - bez tego roster (zawodnicy) nie był pobierany.
2) Utrzymano tokeny reload (zegar/incydenty) bez zmian w przepływie.
3) Zachowano layout: ClockPanel u góry, niżej 2 kolumny (Incidents + Commentary).
*/