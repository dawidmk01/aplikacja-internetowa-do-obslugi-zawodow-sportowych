// frontend/src/components/PublicMatchesPanel.tsx
// Komponent renderuje publiczną listę meczów z sekcjami live, najbliższych, wyników i pełnego terminarza.

import type { ReactNode } from "react";
import { useMemo } from "react";

import { buildStagesForView } from "../flow/stagePresentation";
import { cn } from "../lib/cn";

import { Card } from "../ui/Card";

import PublicMatchRow from "./PublicMatchRow";

export type MatchPublicDTO = {
  id: number;
  stage_id: number;
  stage_order: number;
  stage_type: "LEAGUE" | "KNOCKOUT" | "GROUP" | "THIRD_PLACE";
  group_name?: string | null;
  round_number: number | null;

  home_team_name: string;
  away_team_name: string;

  status?: "SCHEDULED" | "IN_PROGRESS" | "FINISHED";
  home_score?: number;
  away_score?: number;

  scheduled_date: string | null;
  scheduled_time: string | null;
  location: string | null;
};

export type IncidentPublicDTO = {
  id: number;
  match_id: number;
  team_id: number | null;
  kind: string;
  kind_display?: string;
  period?: string | null;
  time_source?: string | null;
  minute: number | null;
  minute_raw?: number | string | null;
  player_id?: number | null;
  player_name?: string | null;

  player_in_id?: number | null;
  player_in_name?: string | null;
  player_out_id?: number | null;
  player_out_name?: string | null;

  meta?: Record<string, unknown>;
  created_at?: string | null;
  created_by?: number | null;
};

export type CommentaryEntryPublicDTO = {
  id: number;
  match_id: number;
  period?: string | null;
  time_source?: string | null;
  minute: number | null;
  minute_raw?: number | string | null;
  text: string;
  created_at?: string | null;
  created_by?: number | null;
};

type StageView = {
  stageId: number;
  stageType: MatchPublicDTO["stage_type"];
  stageOrder: number;
  matches: MatchPublicDTO[];
  allMatches: MatchPublicDTO[];
};

const UPCOMING_LIMIT = 6;

function toSortTs(match: MatchPublicDTO): number {
  const date = (match.scheduled_date ?? "").trim();
  if (!date) return Number.POSITIVE_INFINITY;

  const rawTime = (match.scheduled_time ?? "").trim();
  const safeTime = rawTime ? (rawTime.length === 5 ? `${rawTime}:00` : rawTime) : "00:00:00";

  const timestamp = Date.parse(`${date}T${safeTime}`);
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
}

function hasScheduledDate(match: MatchPublicDTO): boolean {
  return Boolean((match.scheduled_date ?? "").trim());
}

function pickUpcomingMatches(list: MatchPublicDTO[], limit = UPCOMING_LIMIT): MatchPublicDTO[] {
  const scheduled = list.filter((match) => match.status === "SCHEDULED");
  if (scheduled.length === 0) return [];

  const dated = scheduled.filter(hasScheduledDate);
  if (dated.length > 0) {
    const sorted = dated.slice().sort((left, right) => toSortTs(left) - toSortTs(right));
    const now = Date.now();
    const future = sorted.filter((match) => toSortTs(match) >= now);
    const base = future.length > 0 ? future : sorted;
    return base.slice(0, limit);
  }

  const stageOrders = Array.from(new Set(scheduled.map((match) => match.stage_order))).sort((a, b) => a - b);

  let stagePick: MatchPublicDTO[] = [];
  for (const stageOrder of stageOrders) {
    const inStage = scheduled.filter((match) => match.stage_order === stageOrder);
    if (inStage.length > 0) {
      stagePick = inStage;
      break;
    }
  }

  if (stagePick.length === 0) return [];

  const roundKey = (match: MatchPublicDTO) =>
    match.round_number == null ? Number.POSITIVE_INFINITY : match.round_number;

  const minRound = Math.min(...stagePick.map(roundKey));
  const inRound =
    minRound === Number.POSITIVE_INFINITY ? stagePick : stagePick.filter((match) => roundKey(match) === minRound);

  return inRound
    .slice()
    .sort((left, right) => {
      const byGroup = (left.group_name ?? "").localeCompare(right.group_name ?? "", "pl");
      if (byGroup !== 0) return byGroup;
      return left.id - right.id;
    })
    .slice(0, limit);
}

export function getUpcomingMatchesPreview(matches: MatchPublicDTO[], limit = UPCOMING_LIMIT): MatchPublicDTO[] {
  return pickUpcomingMatches(matches, limit);
}

function pluralizeMatchesPL(value: number): string {
  const n = Math.abs(value);
  const mod10 = n % 10;
  const mod100 = n % 100;

  if (n === 1) return "mecz";
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return "mecze";
  return "meczów";
}

function stageTypeLabel(stageType: MatchPublicDTO["stage_type"]): string {
  if (stageType === "GROUP") return "Etap grupowy";
  if (stageType === "LEAGUE") return "Liga";
  if (stageType === "KNOCKOUT") return "Faza pucharowa";
  if (stageType === "THIRD_PLACE") return "Mecz o 3 miejsce";
  return "Etap";
}

function stageHeaderTitleLocal(stage: StageView): string {
  if (stage.stageType === "THIRD_PLACE") return stageTypeLabel(stage.stageType);
  return `${stageTypeLabel(stage.stageType)} - etap ${stage.stageOrder}`;
}

function displayGroupNameLocal(name: string, index: number): string {
  const trimmed = (name || "").trim();
  if (!trimmed) return `Grupa ${index + 1}`;

  const normalized = trimmed.toLowerCase();
  if (normalized.startsWith("grupa ")) return trimmed;
  if (normalized.startsWith("group ")) return `Grupa ${trimmed.slice(6).trim()}`;

  return `Grupa ${trimmed}`;
}

function groupMatchesByGroupLocal(list: MatchPublicDTO[]): Record<string, MatchPublicDTO[]> {
  const grouped: Record<string, MatchPublicDTO[]> = {};

  for (const match of list) {
    const key = (match.group_name ?? "").trim() || "__UNGROUPED__";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(match);
  }

  for (const key of Object.keys(grouped)) {
    grouped[key].sort((left, right) => {
      const byRound = (left.round_number ?? Number.MAX_SAFE_INTEGER) - (right.round_number ?? Number.MAX_SAFE_INTEGER);
      if (byRound !== 0) return byRound;

      const byTime = toSortTs(left) - toSortTs(right);
      if (byTime !== 0) return byTime;

      return left.id - right.id;
    });
  }

  return grouped;
}

function groupMatchesByRoundLocal(list: MatchPublicDTO[]): Record<number, MatchPublicDTO[]> {
  const grouped: Record<number, MatchPublicDTO[]> = {};

  for (const match of list) {
    const key = match.round_number ?? 0;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(match);
  }

  for (const key of Object.keys(grouped)) {
    const round = Number(key);
    grouped[round].sort((left, right) => {
      const byTime = toSortTs(left) - toSortTs(right);
      if (byTime !== 0) return byTime;

      const byGroup = (left.group_name ?? "").localeCompare(right.group_name ?? "", "pl");
      if (byGroup !== 0) return byGroup;

      return left.id - right.id;
    });
  }

  return grouped;
}

function SectionCard({
  id,
  title,
  count,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  children: ReactNode;
}) {
  const titleId = `${id}-title`;
  const hasCount = typeof count === "number" && count > 0;

  return (
    <section id={id} aria-labelledby={titleId}>
      <Card className="p-5 sm:p-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id={titleId} className="text-lg font-semibold text-slate-100">
            {title}
          </h2>

          <div className="text-xs text-slate-400">{hasCount ? `${count} ${pluralizeMatchesPL(count)}` : ""}</div>
        </div>

        {children}
      </Card>
    </section>
  );
}

function RowsCard({ children }: { children: ReactNode }) {
  return <Card className="overflow-hidden p-0">{children}</Card>;
}

export default function PublicMatchesPanel({
  matches,
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
  matches: MatchPublicDTO[];
  selectedMatchId?: number | null;
  selectedSection?: string | null;
  incidentsByMatch?: Record<number, IncidentPublicDTO[]>;
  incidentsBusy?: boolean;
  incidentsError?: string | null;
  commentaryByMatch?: Record<number, CommentaryEntryPublicDTO[]>;
  commentaryBusy?: boolean;
  commentaryError?: string | null;
  onMatchClick?: (match: MatchPublicDTO, sectionId: string) => void;
}) {
  const safeMatches = Array.isArray(matches) ? matches : [];

  const liveMatches = useMemo(() => safeMatches.filter((match) => match.status === "IN_PROGRESS"), [safeMatches]);

  const upcomingMatches = useMemo(() => pickUpcomingMatches(safeMatches, UPCOMING_LIMIT), [safeMatches]);

  const recentResults = useMemo(() => {
    return safeMatches
      .filter((match) => match.status === "FINISHED")
      .slice()
      .sort((left, right) => {
        const leftTs = toSortTs(left);
        const rightTs = toSortTs(right);

        if (leftTs !== Number.POSITIVE_INFINITY && rightTs !== Number.POSITIVE_INFINITY) return rightTs - leftTs;
        if (leftTs !== Number.POSITIVE_INFINITY && rightTs === Number.POSITIVE_INFINITY) return -1;
        if (leftTs === Number.POSITIVE_INFINITY && rightTs !== Number.POSITIVE_INFINITY) return 1;

        return right.id - left.id;
      })
      .slice(0, 8);
  }, [safeMatches]);

  // Helper z flow buduje stabilne sekcje etapów dla widoku publicznego.
  const stages = useMemo(
    () => buildStagesForView(safeMatches, { showBye: false }) as StageView[],
    [safeMatches]
  );

  const renderRows = (sectionId: string, list: MatchPublicDTO[]) => (
    <RowsCard>
      <div role="list" className={cn("bg-black/10", list.length === 0 ? "p-4" : "")}>
        {list.map((match, index) => (
          <PublicMatchRow
            key={match.id}
            sectionId={sectionId}
            match={match}
            index={index}
            selectedMatchId={selectedMatchId}
            selectedSection={selectedSection}
            incidentsByMatch={incidentsByMatch}
            incidentsBusy={incidentsBusy}
            incidentsError={incidentsError}
            commentaryByMatch={commentaryByMatch}
            commentaryBusy={commentaryBusy}
            commentaryError={commentaryError}
            onMatchClick={onMatchClick}
          />
        ))}
      </div>
    </RowsCard>
  );

  return (
    <div className="space-y-6">
      <SectionCard id="public-matches-live" title="Na żywo" count={liveMatches.length}>
        {liveMatches.length === 0 ? (
          <div className="text-sm text-slate-300">Aktualnie nie ma meczów w trakcie.</div>
        ) : (
          renderRows("live", liveMatches)
        )}
      </SectionCard>

      <SectionCard id="public-matches-upcoming" title="Najbliższe mecze" count={upcomingMatches.length}>
        {upcomingMatches.length === 0 ? (
          <div className="text-sm text-slate-300">Brak zaplanowanych meczów.</div>
        ) : (
          renderRows("upcoming", upcomingMatches)
        )}
      </SectionCard>

      <SectionCard id="public-matches-recent" title="Ostatnie wyniki" count={recentResults.length}>
        {recentResults.length === 0 ? (
          <div className="text-sm text-slate-300">Brak zakończonych meczów.</div>
        ) : (
          renderRows("recent", recentResults)
        )}
      </SectionCard>

      <SectionCard id="public-matches-schedule" title="Pełny terminarz" count={stages.length}>
        {stages.length === 0 ? (
          <div className="text-sm text-slate-300">Brak meczów do wyświetlenia.</div>
        ) : (
          <div className="space-y-5">
            {stages.map((stage) => {
              const stageMatches = stage.matches;
              const groupedByGroup = groupMatchesByGroupLocal(stageMatches);
              const groupNames = Object.keys(groupedByGroup)
                .filter((name) => name !== "__UNGROUPED__")
                .sort((a, b) => a.localeCompare(b, "pl"));

              const roundMap = groupMatchesByRoundLocal(stageMatches);
              const rounds = Object.keys(roundMap)
                .map((value) => Number(value))
                .filter((value) => Number.isFinite(value) && value > 0)
                .sort((a, b) => a - b);

              const hasNamedGroups = groupNames.length > 0;
              const hasRounds = rounds.length > 0;

              if (hasNamedGroups) {
                return (
                  <section
                    key={`stage-${stage.stageId}`}
                    className="rounded-2xl border border-white/10 bg-black/10 p-4 sm:p-5"
                  >
                    <div className="mb-3 text-sm font-semibold text-slate-100">{stageHeaderTitleLocal(stage)}</div>

                    <div className="space-y-4">
                      {groupNames.map((groupName, index) => {
                        const groupMatches = groupedByGroup[groupName] ?? [];
                        const title = displayGroupNameLocal(groupName, index);

                        return (
                          <div key={groupName}>
                            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                              {title}
                            </div>
                            {renderRows("schedule", groupMatches)}
                          </div>
                        );
                      })}

                      {groupedByGroup.__UNGROUPED__ && groupedByGroup.__UNGROUPED__.length > 0 ? (
                        <div>
                          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                            Pozostałe mecze
                          </div>
                          {renderRows("schedule", groupedByGroup.__UNGROUPED__)}
                        </div>
                      ) : null}
                    </div>
                  </section>
                );
              }

              if (hasRounds) {
                return (
                  <section
                    key={`stage-${stage.stageId}`}
                    className="rounded-2xl border border-white/10 bg-black/10 p-4 sm:p-5"
                  >
                    <div className="mb-3 text-sm font-semibold text-slate-100">{stageHeaderTitleLocal(stage)}</div>

                    <div className="space-y-4">
                      {rounds.map((round) => {
                        const roundMatches = roundMap[round] ?? [];

                        return (
                          <div key={String(round)}>
                            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                              Kolejka {round}
                            </div>
                            {renderRows("schedule", roundMatches)}
                          </div>
                        );
                      })}

                      {roundMap[0] && roundMap[0].length > 0 ? (
                        <div>
                          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                            Bez kolejki
                          </div>
                          {renderRows("schedule", roundMap[0])}
                        </div>
                      ) : null}
                    </div>
                  </section>
                );
              }

              return (
                <section
                  key={`stage-${stage.stageId}`}
                  className="rounded-2xl border border-white/10 bg-black/10 p-4 sm:p-5"
                >
                  <div className="mb-3 text-sm font-semibold text-slate-100">{stageHeaderTitleLocal(stage)}</div>
                  {renderRows("schedule", stageMatches)}
                </section>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
}