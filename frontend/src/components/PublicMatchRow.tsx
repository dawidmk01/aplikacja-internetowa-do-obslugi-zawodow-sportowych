// frontend/src/components/PublicMatchRow.tsx
// Komponent renderuje publiczny wiersz meczu z rozwijanym podglądem szczegółów, wydarzeń i komentarza.

import type { KeyboardEvent, ReactNode } from "react";
import { useMemo } from "react";

import { cn } from "../lib/cn";

import type {
  CommentaryEntryPublicDTO,
  IncidentPublicDTO,
  MatchPublicDTO,
} from "./PublicMatchesPanel";

type ResultMode = "SCORE" | "CUSTOM";
type CustomResultValueKind = "NUMBER" | "TIME";

type MatchCustomResultDTO = {
  id: number;
  team_id: number;
  team_name: string;
  value_kind: CustomResultValueKind;
  numeric_value?: string | null;
  time_ms?: number | null;
  display_value: string;
  rank?: number | null;
  is_active: boolean;
  sort_value?: string | number | null;
};

function toMinute(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d+$/.test(trimmed)) return Number(trimmed);
  }
  return null;
}

function readExtraNumber(source: unknown, key: string): number | null {
  if (!source || typeof source !== "object") return null;
  const raw = (source as Record<string, unknown>)[key];
  return toMinute(raw);
}

function incidentMinute(incident: IncidentPublicDTO): number | null {
  if (typeof incident.minute === "number" && Number.isFinite(incident.minute)) return incident.minute;
  return readExtraNumber(incident, "minute_raw");
}

function commentaryMinute(entry: CommentaryEntryPublicDTO): number | null {
  if (typeof entry.minute === "number" && Number.isFinite(entry.minute)) return entry.minute;
  return readExtraNumber(entry, "minute_raw");
}

function kindPl(kind: string, fallback?: string): string {
  const normalized = (kind || "").toUpperCase();

  if (normalized === "GOAL") return "Gol";
  if (normalized === "OWN_GOAL") return "Gol samobójczy";
  if (normalized === "YELLOW_CARD") return "Żółta kartka";
  if (normalized === "RED_CARD") return "Czerwona kartka";
  if (normalized === "PENALTY_GOAL") return "Gol z karnego";
  if (normalized === "PENALTY_MISSED") return "Niewykorzystany karny";
  if (normalized === "SUBSTITUTION") return "Zmiana";
  if (normalized === "POINT") return "Punkt";
  if (normalized === "SET_POINT") return "Punkt (set)";

  return fallback || kind || "Incydent";
}

function formatIncidentLine(incident: IncidentPublicDTO): string {
  const minute = incidentMinute(incident);
  const minuteText = typeof minute === "number" ? `${minute}'` : "";

  const label = kindPl(incident.kind, incident.kind_display);
  const player = (incident.player_name || "").trim();
  const playerIn = (incident.player_in_name || "").trim();
  const playerOut = (incident.player_out_name || "").trim();

  if (playerIn && playerOut) return `${minuteText} ${label} - ${playerIn} za ${playerOut}`.trim();
  if (player) return `${minuteText} ${label} - ${player}`.trim();

  return `${minuteText} ${label}`.trim();
}

function formatCommentaryLine(entry: CommentaryEntryPublicDTO): string {
  const minute = commentaryMinute(entry);
  const minuteText = typeof minute === "number" ? `${minute}'` : "";
  const text = (entry.text || "").trim();

  if (!text) return minuteText;
  return `${minuteText} ${text}`.trim();
}

function statusPl(status?: MatchPublicDTO["status"]): string {
  switch (status) {
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

function stageTypeLabel(stageType: MatchPublicDTO["stage_type"]): string {
  if (stageType === "GROUP") return "Etap grupowy";
  if (stageType === "LEAGUE") return "Liga";
  if (stageType === "KNOCKOUT") return "Faza pucharowa";
  if (stageType === "THIRD_PLACE") return "Mecz o 3 miejsce";
  return "Etap";
}

function formatDateShort(iso: string | null): string | null {
  const value = (iso ?? "").trim();
  if (!value) return null;

  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(value);
  if (!match) return value;
  return `${match[3]}.${match[2]}.${match[1]}`;
}

function formatTimeShort(value: string | null): string | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 5);
}

function statusBadgeClasses(status?: MatchPublicDTO["status"]): string {
  if (status === "IN_PROGRESS") return "border-emerald-400/30 bg-emerald-500/10 text-emerald-200";
  if (status === "FINISHED") return "border-slate-200/15 bg-white/5 text-slate-200";
  return "border-white/10 bg-white/5 text-slate-300";
}

function usesCustomResults(match: MatchPublicDTO): boolean {
  return (
    String((match as MatchPublicDTO & { result_mode?: ResultMode }).result_mode ?? "SCORE").toUpperCase() ===
      "CUSTOM" || Boolean((match as MatchPublicDTO & { uses_custom_results?: boolean }).uses_custom_results)
  );
}

function getCustomResults(match: MatchPublicDTO): MatchCustomResultDTO[] {
  const raw = (match as MatchPublicDTO & { custom_results?: MatchCustomResultDTO[] }).custom_results;
  return Array.isArray(raw) ? raw.filter(Boolean) : [];
}

function customResultSummary(result: MatchCustomResultDTO | null | undefined): string {
  if (!result) return "-";
  const display = String(result.display_value ?? "").trim();
  if (display) return display;
  if (result.numeric_value != null) return String(result.numeric_value);
  if (result.time_ms != null) return `${result.time_ms} ms`;
  return "-";
}

function bestCustomResult(match: MatchPublicDTO): MatchCustomResultDTO | null {
  const list = getCustomResults(match)
    .filter((item) => item.is_active !== false)
    .sort((a, b) => {
      const ar = typeof a.rank === "number" ? a.rank : Number.MAX_SAFE_INTEGER;
      const br = typeof b.rank === "number" ? b.rank : Number.MAX_SAFE_INTEGER;
      if (ar !== br) return ar - br;
      return a.id - b.id;
    });

  return list[0] ?? null;
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 break-words text-sm font-semibold text-slate-100">{value}</div>
    </div>
  );
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</div>
      {children}
    </div>
  );
}

type Props = {
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
  onMatchClick?: (match: MatchPublicDTO, sectionId: string) => void;
};

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
}: Props) {
  const dateLabel = formatDateShort(match.scheduled_date);
  const timeLabel = formatTimeShort(match.scheduled_time);
  const locationLabel = (match.location ?? "").trim();

  const customMode = usesCustomResults(match);
  const customResults = getCustomResults(match);
  const leadingCustomResult = bestCustomResult(match);

  const hasScore = typeof match.home_score === "number" && typeof match.away_score === "number";
  const scoreLabel = customMode
    ? customResultSummary(leadingCustomResult)
    : hasScore
      ? `${match.home_score} : ${match.away_score}`
      : "-";

  const scoreCaption = customMode
    ? leadingCustomResult?.rank
      ? `Najlepszy wynik - miejsce ${leadingCustomResult.rank}`
      : "Najlepszy zapisany wynik"
    : "Wynik";

  const isClickable = Boolean(onMatchClick) && (match.status === "IN_PROGRESS" || match.status === "FINISHED");
  const isSelected =
    selectedMatchId != null &&
    selectedSection != null &&
    match.id === selectedMatchId &&
    selectedSection === sectionId;

  const detailsId = `public-match-${sectionId}-${match.id}-details`;
  const incidents = incidentsByMatch?.[match.id] ?? [];
  const commentary = commentaryByMatch?.[match.id] ?? [];

  const sortedIncidents = useMemo(() => {
    return incidents.slice().sort((left, right) => {
      const leftMinute = incidentMinute(left);
      const rightMinute = incidentMinute(right);
      if (leftMinute == null && rightMinute == null) return (left.id ?? 0) - (right.id ?? 0);
      if (leftMinute == null) return 1;
      if (rightMinute == null) return -1;
      if (leftMinute !== rightMinute) return leftMinute - rightMinute;
      return (left.id ?? 0) - (right.id ?? 0);
    });
  }, [incidents]);

  const sortedCommentary = useMemo(() => {
    return commentary.slice().sort((left, right) => {
      const leftMinute = commentaryMinute(left);
      const rightMinute = commentaryMinute(right);
      if (leftMinute == null && rightMinute == null) return (left.id ?? 0) - (right.id ?? 0);
      if (leftMinute == null) return 1;
      if (rightMinute == null) return -1;
      if (leftMinute !== rightMinute) return leftMinute - rightMinute;
      return (left.id ?? 0) - (right.id ?? 0);
    });
  }, [commentary]);

  const detailItems = [
    { label: "Status", value: statusPl(match.status) || "-" },
    { label: "Etap", value: `${stageTypeLabel(match.stage_type)}${match.stage_order ? ` - ${match.stage_order}` : ""}` },
    { label: "Grupa", value: (match.group_name || "-").trim() || "-" },
    { label: "Kolejka", value: match.round_number != null ? String(match.round_number) : "-" },
    { label: "Data", value: dateLabel ?? "-" },
    { label: "Godzina", value: timeLabel ?? "-" },
    { label: "Miejsce", value: locationLabel || "-" },
    { label: customMode ? "Typ wyniku" : "Wynik", value: customMode ? "Rezultat niestandardowy" : scoreLabel },
  ];

  const handleClick = () => {
    if (!isClickable) return;
    onMatchClick?.(match, sectionId);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!isClickable) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onMatchClick?.(match, sectionId);
    }
  };

  const headerContent = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <div className="break-words text-sm font-semibold text-slate-100 sm:text-base">
            {match.home_team_name} <span className="font-normal text-slate-400">vs</span> {match.away_team_name}
          </div>
          {isClickable ? (
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] text-slate-300">
              {isSelected ? "Zwiń szczegóły" : "Pokaż szczegóły"}
            </span>
          ) : null}
        </div>

        {dateLabel || timeLabel || locationLabel ? (
          <div className="mt-1 text-sm text-slate-300">
            {dateLabel ? <span>{dateLabel}</span> : null}
            {dateLabel && timeLabel ? <span className="mx-2 text-slate-500">•</span> : null}
            {timeLabel ? <span>{timeLabel}</span> : null}
            {dateLabel || timeLabel ? (locationLabel ? <span className="mx-2 text-slate-500">•</span> : null) : null}
            {locationLabel ? <span className="break-words">{locationLabel}</span> : null}
          </div>
        ) : null}
      </div>

      <div className="shrink-0 text-right">
        <div className="flex items-center justify-end gap-2">
          <div className="text-right">
            <div className="text-sm font-semibold text-slate-100 sm:text-base">{scoreLabel}</div>
            <div className="mt-0.5 text-[11px] text-slate-400">{scoreCaption}</div>
          </div>

          <span className={cn("rounded-full border px-2 py-1 text-xs", statusBadgeClasses(match.status))}>
            {statusPl(match.status)}
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <div
      role="listitem"
      className={cn(
        "px-4 py-3",
        index > 0 ? "border-t border-white/10" : "",
        isSelected ? "bg-white/[0.04]" : ""
      )}
    >
      {isClickable ? (
        <button
          type="button"
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          aria-expanded={isSelected}
          aria-controls={detailsId}
          className={cn(
            "w-full rounded-xl p-0 text-left",
            "cursor-pointer hover:bg-white/[0.03]",
            "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/15"
          )}
        >
          {headerContent}
        </button>
      ) : (
        <div className="w-full text-left">{headerContent}</div>
      )}

      {isSelected && isClickable ? (
        <div id={detailsId} className="mt-4 border-t border-white/10 pt-4">
          <div className={cn("grid gap-4", customMode ? "xl:grid-cols-[0.92fr_1.04fr_1.04fr]" : "xl:grid-cols-[0.92fr_1.04fr_1.04fr]") }>
            <DetailSection title="Szczegóły meczu">
              <div className="grid gap-2 sm:grid-cols-2">
                {detailItems.map((item) => (
                  <DetailItem key={item.label} label={item.label} value={item.value} />
                ))}
              </div>
            </DetailSection>

            <DetailSection title={customMode ? "Rezultaty i wydarzenia" : "Wydarzenia"}>
              {customMode ? (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    {customResults.filter((item) => item.is_active !== false).length === 0 ? (
                      <div className="text-sm text-slate-300">Brak zapisanych rezultatów.</div>
                    ) : (
                      customResults
                        .filter((item) => item.is_active !== false)
                        .sort((a, b) => {
                          const ar = typeof a.rank === "number" ? a.rank : Number.MAX_SAFE_INTEGER;
                          const br = typeof b.rank === "number" ? b.rank : Number.MAX_SAFE_INTEGER;
                          if (ar !== br) return ar - br;
                          return a.id - b.id;
                        })
                        .map((result) => (
                          <div
                            key={result.id}
                            className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2"
                          >
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-slate-100">{result.team_name}</div>
                              <div className="mt-0.5 text-xs text-slate-400">
                                {String(result.value_kind ?? "").toUpperCase() === "TIME" ? "Czas" : "Wynik"}
                              </div>
                            </div>
                            <div className="shrink-0 text-right">
                              <div className="text-sm font-semibold text-slate-100">{customResultSummary(result)}</div>
                              <div className="mt-0.5 text-xs text-slate-400">
                                {typeof result.rank === "number" ? `Miejsce ${result.rank}` : "Bez pozycji"}
                              </div>
                            </div>
                          </div>
                        ))
                    )}
                  </div>

                  <div className="border-t border-white/10 pt-3">
                    {incidentsError ? <div className="mb-2 text-sm text-rose-300">{incidentsError}</div> : null}
                    {incidentsBusy && sortedIncidents.length === 0 ? (
                      <div className="text-sm text-slate-300">Ładowanie wydarzeń...</div>
                    ) : sortedIncidents.length === 0 ? (
                      <div className="text-sm text-slate-300">Brak wydarzeń.</div>
                    ) : (
                      <div className="space-y-1.5">
                        {sortedIncidents.map((incident) => (
                          <div key={incident.id} className="text-sm text-slate-200">
                            {formatIncidentLine(incident)}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div>
                  {incidentsError ? <div className="mb-2 text-sm text-rose-300">{incidentsError}</div> : null}
                  {incidentsBusy && sortedIncidents.length === 0 ? (
                    <div className="text-sm text-slate-300">Ładowanie wydarzeń...</div>
                  ) : sortedIncidents.length === 0 ? (
                    <div className="text-sm text-slate-300">Brak wydarzeń.</div>
                  ) : (
                    <div className="space-y-1.5">
                      {sortedIncidents.map((incident) => (
                        <div key={incident.id} className="text-sm text-slate-200">
                          {formatIncidentLine(incident)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </DetailSection>

            <DetailSection title="Komentarz / relacja">
              {commentaryError ? <div className="mb-2 text-sm text-rose-300">{commentaryError}</div> : null}
              {commentaryBusy && sortedCommentary.length === 0 ? (
                <div className="text-sm text-slate-300">Ładowanie komentarza...</div>
              ) : sortedCommentary.length === 0 ? (
                <div className="text-sm text-slate-300">Brak komentarzy.</div>
              ) : (
                <div className="space-y-1.5">
                  {sortedCommentary.map((entry) => (
                    <div key={entry.id} className="whitespace-pre-wrap text-sm text-slate-200">
                      {formatCommentaryLine(entry)}
                    </div>
                  ))}
                </div>
              )}
            </DetailSection>
          </div>
        </div>
      ) : null}
    </div>
  );
}
