import type { KeyboardEvent } from "react";
import { useMemo } from "react";

import { cn } from "../lib/cn";

import type { CommentaryEntryPublicDTO, IncidentPublicDTO, MatchPublicDTO } from "./PublicMatchesPanel";

function toMinute(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return null;
    if (/^\d+$/.test(t)) return Number(t);
  }
  return null;
}

function incidentMinute(i: IncidentPublicDTO): number | null {
  if (typeof i.minute === "number" && Number.isFinite(i.minute)) return i.minute;
  return toMinute((i as any).minute_raw);
}

function commentaryMinute(c: CommentaryEntryPublicDTO): number | null {
  if (typeof c.minute === "number" && Number.isFinite(c.minute)) return c.minute;
  return toMinute((c as any).minute_raw);
}

function kindPl(kind: string, fallback?: string): string {
  const k = (kind || "").toUpperCase();
  if (k === "GOAL") return "Gol";
  if (k === "OWN_GOAL") return "Gol samobójczy";
  if (k === "YELLOW_CARD") return "Żółta kartka";
  if (k === "RED_CARD") return "Czerwona kartka";
  if (k === "PENALTY_GOAL") return "Gol z karnego";
  if (k === "PENALTY_MISSED") return "Niewykorzystany karny";
  if (k === "SUBSTITUTION") return "Zmiana";
  if (k === "POINT") return "Punkt";
  if (k === "SET_POINT") return "Punkt (set)";
  return fallback || kind || "Incydent";
}

function formatIncidentLine(i: IncidentPublicDTO): string {
  const min = incidentMinute(i);
  const minTxt = typeof min === "number" ? `${min}'` : "";

  const label = kindPl(i.kind, i.kind_display);

  const player = (i.player_name || "").trim();
  const inName = (i.player_in_name || "").trim();
  const outName = (i.player_out_name || "").trim();

  if (inName && outName) return `${minTxt} ${label} - ${inName} za ${outName}`.trim();
  if (player) return `${minTxt} ${label} - ${player}`.trim();
  return `${minTxt} ${label}`.trim();
}

function formatCommentaryLine(c: CommentaryEntryPublicDTO): string {
  const min = commentaryMinute(c);
  const minTxt = typeof min === "number" ? `${min}'` : "";
  const text = (c.text || "").trim();
  if (!text) return minTxt;
  return `${minTxt} ${text}`.trim();
}

function statusPl(s?: MatchPublicDTO["status"]): string {
  switch (s) {
    case "IN_PROGRESS":
      return "W trakcie";
    case "FINISHED":
      return "Zakończony";
    case "SCHEDULED":
      return "Zaplanowany";
    default:
      return "";
  }
}

function formatDateShort(iso: string | null): string | null {
  const d = (iso ?? "").trim();
  if (!d) return null;
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(d);
  if (!m) return d;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

function formatTimeShort(t: string | null): string | null {
  const s = (t ?? "").trim();
  if (!s) return null;
  return s.slice(0, 5);
}

function statusBadgeClasses(s?: MatchPublicDTO["status"]): string {
  if (s === "IN_PROGRESS") return "border-emerald-400/30 bg-emerald-500/10 text-emerald-200";
  if (s === "FINISHED") return "border-slate-200/15 bg-white/5 text-slate-200";
  return "border-white/10 bg-white/5 text-slate-300";
}

export default function PublicMatchRow({
  sectionId,
  match,
  index,
  selectedMatchId,
  selectedSection,
  incidentsByMatch,
  incidentsBusy,
  incidentsError,
  commentaryByMatch,
  commentaryBusy,
  commentaryError,
  onMatchClick,
}: {
  sectionId: string;
  match: MatchPublicDTO;
  index: number;
  selectedMatchId?: number | null;
  selectedSection?: string | null;
  incidentsByMatch?: Record<number, IncidentPublicDTO[]>;
  incidentsBusy?: boolean;
  incidentsError?: string | null;
  commentaryByMatch?: Record<number, CommentaryEntryPublicDTO[]>;
  commentaryBusy?: boolean;
  commentaryError?: string | null;
  onMatchClick?: (m: MatchPublicDTO, sectionId: string) => void;
}) {
  const dateLabel = formatDateShort(match.scheduled_date);
  const timeLabel = formatTimeShort(match.scheduled_time);
  const where = (match.location ?? "").trim();

  const hasScore = typeof match.home_score === "number" && typeof match.away_score === "number";
  const score = hasScore ? `${match.home_score} : ${match.away_score}` : "-";

  const isClickable = Boolean(onMatchClick) && (match.status === "IN_PROGRESS" || match.status === "FINISHED");
  const isSelected =
    selectedMatchId != null &&
    selectedSection != null &&
    match.id === selectedMatchId &&
    selectedSection === sectionId;

  const detailsId = `public-match-${sectionId}-${match.id}-details`;

  const incidents = (incidentsByMatch?.[match.id] ?? []) as IncidentPublicDTO[];
  const commentary = (commentaryByMatch?.[match.id] ?? []) as CommentaryEntryPublicDTO[];

  const sortedIncidents = useMemo(() => {
    return incidents
      .slice()
      .sort((a, b) => {
        const am = incidentMinute(a);
        const bm = incidentMinute(b);
        if (am == null && bm == null) return (a.id ?? 0) - (b.id ?? 0);
        if (am == null) return 1;
        if (bm == null) return -1;
        if (am !== bm) return am - bm;
        return (a.id ?? 0) - (b.id ?? 0);
      });
  }, [incidents]);

  const sortedCommentary = useMemo(() => {
    return commentary
      .slice()
      .sort((a, b) => {
        const am = commentaryMinute(a);
        const bm = commentaryMinute(b);
        if (am == null && bm == null) return (a.id ?? 0) - (b.id ?? 0);
        if (am == null) return 1;
        if (bm == null) return -1;
        if (am !== bm) return am - bm;
        return (a.id ?? 0) - (b.id ?? 0);
      });
  }, [commentary]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!isClickable) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onMatchClick?.(match, sectionId);
    }
  };

  const RowHeader = isClickable ? "button" : "div";

  return (
    <div
      role="listitem"
      className={cn(
        "px-4 py-3",
        index > 0 ? "border-t border-white/10" : "",
        isSelected ? "bg-white/[0.04]" : ""
      )}
    >
      <RowHeader
        {...(isClickable
          ? {
              type: "button" as const,
              onClick: () => onMatchClick?.(match, sectionId),
              onKeyDown,
              "aria-expanded": isSelected,
              "aria-controls": detailsId,
            }
          : {})}
        className={cn(
          "w-full text-left",
          isClickable
            ? cn(
                "cursor-pointer rounded-xl p-0",
                "hover:bg-white/[0.03]",
                "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/15"
              )
            : ""
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-slate-100">
              <span className="break-words">
                {match.home_team_name} <span className="font-normal text-slate-400">vs</span> {match.away_team_name}
              </span>
            </div>

            {(dateLabel || timeLabel || where) ? (
              <div className="mt-1 text-sm text-slate-300">
                {dateLabel ? <span>{dateLabel}</span> : null}
                {dateLabel && timeLabel ? <span className="mx-2 text-slate-500">•</span> : null}
                {timeLabel ? <span>{timeLabel}</span> : null}
                {(dateLabel || timeLabel) && where ? <span className="mx-2 text-slate-500">•</span> : null}
                {where ? <span className="break-words">{where}</span> : null}
              </div>
            ) : null}
          </div>

          <div className="shrink-0 text-right">
            <div className="flex items-center justify-end gap-2">
              <div className="text-sm font-semibold text-slate-100">{score}</div>

              <span className={cn("rounded-full border px-2 py-1 text-xs", statusBadgeClasses(match.status))}>
                {statusPl(match.status)}
              </span>
            </div>
          </div>
        </div>
      </RowHeader>

      {isSelected && isClickable ? (
        <div id={detailsId} className="mt-3 border-t border-white/10 pt-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Incydenty</div>
              {incidentsError ? <div className="mb-2 text-sm text-rose-300">{incidentsError}</div> : null}

              {incidentsBusy && sortedIncidents.length === 0 ? (
                <div className="text-sm text-slate-300">Ładowanie incydentów...</div>
              ) : sortedIncidents.length === 0 ? (
                <div className="text-sm text-slate-300">Brak incydentów.</div>
              ) : (
                <div className="space-y-1">
                  {sortedIncidents.map((i) => (
                    <div key={i.id} className="text-sm text-slate-200">
                      {formatIncidentLine(i)}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Relacja live</div>
              {commentaryError ? <div className="mb-2 text-sm text-rose-300">{commentaryError}</div> : null}

              {commentaryBusy && sortedCommentary.length === 0 ? (
                <div className="text-sm text-slate-300">Ładowanie relacji...</div>
              ) : sortedCommentary.length === 0 ? (
                <div className="text-sm text-slate-300">Brak komentarzy.</div>
              ) : (
                <div className="space-y-1">
                  {sortedCommentary.map((c) => (
                    <div key={c.id} className="whitespace-pre-wrap text-sm text-slate-200">
                      {formatCommentaryLine(c)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}