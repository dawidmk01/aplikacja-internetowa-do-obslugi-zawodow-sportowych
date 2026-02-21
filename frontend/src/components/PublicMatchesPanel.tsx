// frontend/src/components/PublicMatchesPanel.tsx
import type { ReactNode } from "react";
import { useMemo } from "react";

import {
  buildStagesForView,
  displayGroupName,
  groupMatchesByGroup,
  groupMatchesByRound,
  stageHeaderTitle,
} from "../flow/stagePresentation";

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

  scheduled_date: string | null; // "YYYY-MM-DD"
  scheduled_time: string | null; // "HH:mm" lub "HH:mm:ss"
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

  meta?: Record<string, any>;
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

/**
 * Stabilne sortowanie:
 * - jeśli brak daty -> Infinity (na koniec)
 * - czas domyślny 00:00
 * - akceptuje "HH:mm" i "HH:mm:ss"
 */
function toSortTs(m: MatchPublicDTO): number {
  const d = (m.scheduled_date ?? "").trim();
  if (!d) return Number.POSITIVE_INFINITY;

  const tRaw = (m.scheduled_time ?? "").trim();
  const t = tRaw ? (tRaw.length === 5 ? `${tRaw}:00` : tRaw) : "00:00:00";

  const iso = `${d}T${t}`;
  const ts = Date.parse(iso);
  return Number.isFinite(ts) ? ts : Number.POSITIVE_INFINITY;
}

const UPCOMING_LIMIT = 6;

function hasScheduledDate(m: MatchPublicDTO): boolean {
  return Boolean((m.scheduled_date ?? "").trim());
}

function pickUpcomingMatches(list: MatchPublicDTO[], limit = UPCOMING_LIMIT): MatchPublicDTO[] {
  const scheduled = list.filter((m) => m.status === "SCHEDULED");
  if (scheduled.length === 0) return [];

  const dated = scheduled.filter(hasScheduledDate);
  if (dated.length > 0) {
    const sorted = dated.slice().sort((a, b) => toSortTs(a) - toSortTs(b));
    const now = Date.now();
    const future = sorted.filter((m) => toSortTs(m) >= now);
    const base = future.length > 0 ? future : sorted;
    return base.slice(0, limit);
  }

  const stageOrders = Array.from(new Set(scheduled.map((m) => m.stage_order))).sort((a, b) => a - b);

  let stagePick: MatchPublicDTO[] = [];
  for (const so of stageOrders) {
    const inStage = scheduled.filter((m) => m.stage_order === so);
    if (inStage.length > 0) {
      stagePick = inStage;
      break;
    }
  }
  if (stagePick.length === 0) return [];

  const roundKey = (m: MatchPublicDTO) => (m.round_number == null ? Number.POSITIVE_INFINITY : m.round_number);
  const minRound = Math.min(...stagePick.map(roundKey));
  const inRound = minRound === Number.POSITIVE_INFINITY ? stagePick : stagePick.filter((m) => roundKey(m) === minRound);

  return inRound
    .slice()
    .sort((a, b) => {
      const ga = (a.group_name ?? "").localeCompare(b.group_name ?? "");
      if (ga !== 0) return ga;
      return a.id - b.id;
    })
    .slice(0, limit);
}

export function getUpcomingMatchesPreview(matches: MatchPublicDTO[], limit = UPCOMING_LIMIT): MatchPublicDTO[] {
  return pickUpcomingMatches(matches, limit);
}

function ListBox({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-white/10 bg-black/10">{children}</div>;
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
  onMatchClick?: (m: MatchPublicDTO, sectionId: string) => void;
}) {
  const liveMatches = useMemo(() => matches.filter((m) => m.status === "IN_PROGRESS"), [matches]);

  const upcomingMatches = useMemo(() => pickUpcomingMatches(matches, UPCOMING_LIMIT), [matches]);

  const recentResults = useMemo(() => {
    return matches
      .filter((m) => m.status === "FINISHED")
      .slice()
      .sort((a, b) => {
        const ta = toSortTs(a);
        const tb = toSortTs(b);

        if (ta !== Number.POSITIVE_INFINITY && tb !== Number.POSITIVE_INFINITY) return tb - ta;
        if (ta !== Number.POSITIVE_INFINITY && tb === Number.POSITIVE_INFINITY) return -1;
        if (ta === Number.POSITIVE_INFINITY && tb !== Number.POSITIVE_INFINITY) return 1;

        return b.id - a.id;
      })
      .slice(0, 8);
  }, [matches]);

  const stages = useMemo(() => buildStagesForView(matches, { showBye: false }), [matches]);

  const renderRows = (sectionId: string, list: MatchPublicDTO[]) => (
    <ListBox>
      {list.map((m, idx) => (
        <PublicMatchRow
          key={m.id}
          sectionId={sectionId}
          match={m}
          index={idx}
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
    </ListBox>
  );

  return (
    <div className="space-y-6">
      {/* NA ŻYWO */}
      <section id="public-matches-live" className="rounded-2xl border border-white/10 bg-white/5 p-5 sm:p-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-100">Na żywo</h2>
          <div className="text-xs text-slate-400">{liveMatches.length ? `${liveMatches.length} mecz(e)` : ""}</div>
        </div>

        {liveMatches.length === 0 ? (
          <div className="text-sm text-slate-300">Aktualnie nie ma meczów w trakcie.</div>
        ) : (
          renderRows("live", liveMatches)
        )}
      </section>

      {/* NAJBLIŻSZE */}
      <section id="public-matches-upcoming" className="rounded-2xl border border-white/10 bg-white/5 p-5 sm:p-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-100">Najbliższe mecze</h2>
          <div className="text-xs text-slate-400">{upcomingMatches.length ? `${upcomingMatches.length} mecz(e)` : ""}</div>
        </div>

        {upcomingMatches.length === 0 ? (
          <div className="text-sm text-slate-300">Brak zaplanowanych meczów.</div>
        ) : (
          renderRows("upcoming", upcomingMatches)
        )}
      </section>

      {/* OSTATNIE WYNIKI */}
      <section id="public-matches-recent" className="rounded-2xl border border-white/10 bg-white/5 p-5 sm:p-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-100">Ostatnie wyniki</h2>
          <div className="text-xs text-slate-400">{recentResults.length ? `${recentResults.length} mecz(e)` : ""}</div>
        </div>

        {recentResults.length === 0 ? (
          <div className="text-sm text-slate-300">Brak zakończonych meczów.</div>
        ) : (
          renderRows("recent", recentResults)
        )}
      </section>

      {/* PEŁNY TERMINARZ */}
      <section id="public-matches-schedule" className="rounded-2xl border border-white/10 bg-white/5 p-5 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-100">Pełny terminarz</h2>
          <div className="text-xs text-slate-400">{stages.length ? `${stages.length} etap(y)` : ""}</div>
        </div>

        {stages.length === 0 ? (
          <div className="text-sm text-slate-300">Brak meczów do wyświetlenia.</div>
        ) : (
          <div className="space-y-5">
            {stages.map((s) => {
              const stageMatches = s.matches;

              if (s.view_type === "GROUP") {
                const groups = groupMatchesByGroup(stageMatches);
                const groupNames = Object.keys(groups).sort((a, b) => a.localeCompare(b));

                return (
                  <section
                    key={`stage-${s.stage_id}`}
                    className="rounded-2xl border border-white/10 bg-black/10 p-4 sm:p-5"
                  >
                    <div className="mb-3 text-sm font-semibold text-slate-100">{stageHeaderTitle(s)}</div>

                    <div className="space-y-4">
                      {groupNames.map((gName) => {
                        const gMatches = groups[gName] ?? [];
                        const title = displayGroupName(gName);

                        return (
                          <div key={gName}>
                            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                              {title}
                            </div>
                            {renderRows("schedule", gMatches)}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              }

              if (s.view_type === "ROUND") {
                const byRound = groupMatchesByRound(stageMatches);
                const rounds = Object.keys(byRound)
                  .map((x) => Number(x))
                  .filter((n) => Number.isFinite(n))
                  .sort((a, b) => a - b);

                return (
                  <section
                    key={`stage-${s.stage_id}`}
                    className="rounded-2xl border border-white/10 bg-black/10 p-4 sm:p-5"
                  >
                    <div className="mb-3 text-sm font-semibold text-slate-100">{stageHeaderTitle(s)}</div>

                    <div className="space-y-4">
                      {rounds.map((round) => {
                        const roundMatches = byRound[String(round)] ?? [];
                        return (
                          <div key={String(round)}>
                            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                              Kolejka {round}
                            </div>
                            {renderRows("schedule", roundMatches)}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              }

              return (
                <section
                  key={`stage-${s.stage_id}`}
                  className="rounded-2xl border border-white/10 bg-black/10 p-4 sm:p-5"
                >
                  <div className="mb-3 text-sm font-semibold text-slate-100">
                    {stageHeaderTitle(s)}
                  </div>

                  {renderRows("schedule", stageMatches)}
                </section>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

// Co zmieniono:
// 1) Wyciągnięto renderowanie pojedynczej karty meczu do komponentu PublicMatchRow.
// 2) Uproszczono PublicMatchesPanel do odpowiedzialności: grupowanie i sekcje (live/upcoming/recent/schedule).
// 3) Zachowano API komponentu i dotychczasową logikę selekcji oraz prezentacji incydentów. Zachowano API komponentu i dotychczasową logikę selekcji oraz prezentacji incydentów.