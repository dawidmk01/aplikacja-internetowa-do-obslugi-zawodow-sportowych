// frontend/src/components/matchLive/MatchLivePanel.tsx
// Komponent agreguje panele obsługi meczu LIVE i udostępnia organizatorowi wspólny widok sterowania spotkaniem.

import { useCallback, useMemo, useState, type ReactNode } from "react";
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

type ScorePreview = {
  home: number;
  away: number;
  homeExtraTime?: number;
  awayExtraTime?: number;
};

type IncidentDeleteRequest = {
  matchId: number;
  incidentId: number;
  incidentType?: string;
  teamLabel?: string;
  minute?: number | null;
  playerLabel?: string | null;
  scoreAfterDelete?: ScorePreview | null;
};

type Props = {
  tournamentId: string;
  discipline: string;
  goalScope: "REGULAR" | "EXTRA_TIME";
  canEdit: boolean;
  layoutMode?: "default" | "fullscreen";
  auxiliaryPanel?: ReactNode;
  scoreContext?: {
    home: number;
    away: number;
    stageType?: string;
    wentToExtraTime?: boolean;
    homeExtraTime?: number;
    awayExtraTime?: number;
  };
  match: LiveMatchSummary;
  onRequestConfirmIncidentDelete?: (req: IncidentDeleteRequest, proceed: () => void) => void;
  onEnterExtraTime?: () => void;
  onAfterRecompute?: () => Promise<void> | void;
  externalIncidentsReloadToken?: number;
};

export default function MatchLivePanel({
  tournamentId,
  discipline,
  goalScope,
  canEdit,
  layoutMode = "default",
  auxiliaryPanel,
  scoreContext,
  match,
  onRequestConfirmIncidentDelete,
  onEnterExtraTime,
  onAfterRecompute,
  externalIncidentsReloadToken,
}: Props) {
  const numericTournamentId = useMemo(() => {
    const n = Number(tournamentId);
    return Number.isFinite(n) ? n : 0;
  }, [tournamentId]);

  const [clockMeta, setClockMeta] = useState<ClockMeta | null>(null);
  const [clockReloadToken, setClockReloadToken] = useState(0);
  const [incidentsReloadToken, setIncidentsReloadToken] = useState(0);
  const [fullscreenControlView, setFullscreenControlView] = useState<"CLOCK" | "MATCH">("CLOCK");

  const requestClockReload = useCallback(() => setClockReloadToken((x) => x + 1), []);
  const requestIncidentsReload = useCallback(() => setIncidentsReloadToken((x) => x + 1), []);
  const combinedIncidentsReloadToken = incidentsReloadToken + Number(externalIncidentsReloadToken ?? 0);

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

  const isFullscreen = layoutMode === "fullscreen";
  const hasAuxiliaryPanel = isFullscreen && Boolean(auxiliaryPanel);

  if (isFullscreen) {
    return (
      <div className="grid h-full min-h-0 w-full min-w-0 gap-3 p-3 xl:grid-cols-[minmax(330px,0.76fr)_minmax(500px,1.02fr)_minmax(560px,1.18fr)]">
        <div className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 shadow-2xl shadow-black/20">
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              Tryb obsługi meczu
            </div>
            <div className="mt-1 truncate text-lg font-extrabold text-white">
              {match.homeTeamName} <span className="text-white/55">vs</span> {match.awayTeamName}
            </div>

            {hasAuxiliaryPanel ? (
              <div className="mt-3 flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-1">
                <button
                  type="button"
                  onClick={() => setFullscreenControlView("CLOCK")}
                  className={cn(
                    "min-w-0 flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition",
                    fullscreenControlView === "CLOCK"
                      ? "bg-white text-slate-950 shadow-lg shadow-black/20"
                      : "text-slate-300 hover:bg-white/[0.06] hover:text-white"
                  )}
                >
                  Zegar
                </button>
                <button
                  type="button"
                  onClick={() => setFullscreenControlView("MATCH")}
                  className={cn(
                    "min-w-0 flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition",
                    fullscreenControlView === "MATCH"
                      ? "bg-white text-slate-950 shadow-lg shadow-black/20"
                      : "text-slate-300 hover:bg-white/[0.06] hover:text-white"
                  )}
                >
                  Mecz
                </button>
              </div>
            ) : null}
          </div>

          <div className="min-h-0 min-w-0">
            {fullscreenControlView === "MATCH" && hasAuxiliaryPanel ? (
              auxiliaryPanel
            ) : (
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
                layoutMode="fullscreen"
              />
            )}
          </div>
        </div>

        <div className="min-h-0 min-w-0 overflow-hidden">
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
            reloadToken={combinedIncidentsReloadToken}
            onRequestConfirmIncidentDelete={onRequestConfirmIncidentDelete}
            onAfterRecompute={onAfterRecompute}
            onRequestClockReload={requestClockReload}
            layoutMode="fullscreen"
          />
        </div>

        <div className="min-h-0 min-w-0">
          <CommentaryPanel
            tournamentId={numericTournamentId}
            matchId={match.id}
            canEdit={canEdit}
            minute={commentaryMinute}
            discipline={discipline}
            homeTeamName={match.homeTeamName}
            awayTeamName={match.awayTeamName}
            layoutMode="fullscreen"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="grid w-full min-w-0 gap-3">
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
            reloadToken={combinedIncidentsReloadToken}
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