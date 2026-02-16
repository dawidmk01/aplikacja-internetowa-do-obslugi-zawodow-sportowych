// frontend/src/components/PublicMatchesPanel.tsx
import { useMemo } from "react";
import {
  buildStagesForView,
  displayGroupName,
  groupMatchesByGroup,
  groupMatchesByRound,
  stageHeaderTitle,
} from "../flow/stagePresentation";

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
  minute_raw?: number | null;
  player_id?: number | null;
  player_name?: string | null;
  meta?: Record<string, any>;
  created_at?: string | null;
};

function incidentMinute(i: IncidentPublicDTO): number | null {
  const mr = (i as any).minute_raw;
  if (typeof mr === "number" && Number.isFinite(mr)) return mr;
  if (typeof i.minute === "number" && Number.isFinite(i.minute)) return i.minute;
  return null;
}

function kindPl(kind: string, fallback?: string): string {
  const k = (kind || "").toUpperCase();
  if (k === "GOAL") return "Gol";
  if (k === "OWN_GOAL") return "Gol samobójczy";
  if (k === "YELLOW_CARD") return "Żółta kartka";
  if (k === "RED_CARD") return "Czerwona kartka";
  if (k === "PENALTY_GOAL") return "Gol z karnego";
  if (k === "PENALTY_MISSED") return "Niewykorzystany karny";
  if (k === "POINT") return "Punkt";
  if (k === "SET_POINT") return "Punkt (set)";
  return fallback || kind || "Incydent";
}

function formatIncidentLine(i: IncidentPublicDTO): string {
  const min = incidentMinute(i);
  const minTxt = typeof min === "number" ? `${min}'` : "";
  const label = kindPl(i.kind, i.kind_display);
  const player = (i.player_name || "").trim();
  if (player) return `${minTxt} ${label} — ${player}`.trim();
  return `${minTxt} ${label}`.trim();
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

function whenText(m: MatchPublicDTO): string | null {
  const d = (m.scheduled_date ?? "").trim();
  const t = (m.scheduled_time ?? "").trim();
  const s = [d, t].filter(Boolean).join(" ");
  return s || null;
}

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

function statusBadgeClasses(s?: MatchPublicDTO["status"]): string {
  if (s === "IN_PROGRESS") return "border-emerald-400/30 bg-emerald-500/10 text-emerald-200";
  if (s === "FINISHED") return "border-slate-200/15 bg-white/5 text-slate-200";
  return "border-white/10 bg-white/5 text-slate-300";
}

function ListBox({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-white/10 bg-black/10">{children}</div>;
}

export default function PublicMatchesPanel({
  matches,
  selectedMatchId,
  selectedSection,
  incidentsByMatch,
  incidentsBusy,
  incidentsError,
  onMatchClick,
}: {
  matches: MatchPublicDTO[];
  selectedMatchId?: number | null;
  selectedSection?: string | null;
  incidentsByMatch?: Record<number, IncidentPublicDTO[]>;
  incidentsBusy?: boolean;
  incidentsError?: string | null;
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

        // Jeśli obie daty są poprawne -> sortuj po dacie malejąco (najnowsze pierwsze)
        if (ta !== Number.POSITIVE_INFINITY && tb !== Number.POSITIVE_INFINITY) return tb - ta;

        // Jeśli tylko jedna ma datę -> ta z datą ma być wyżej
        if (ta !== Number.POSITIVE_INFINITY && tb === Number.POSITIVE_INFINITY) return -1;
        if (ta === Number.POSITIVE_INFINITY && tb !== Number.POSITIVE_INFINITY) return 1;

        // Fallback: po id malejąco
        return b.id - a.id;
      })
      .slice(0, 8);
  }, [matches]);

  const stages = useMemo(() => buildStagesForView(matches, { showBye: false }), [matches]);

  const renderRow = (sectionId: string, m: MatchPublicDTO, idx: number) => {
    const when = whenText(m);
    const where = (m.location ?? "").trim();

    const hasScore = typeof m.home_score === "number" && typeof m.away_score === "number";
    const score = hasScore ? `${m.home_score} : ${m.away_score}` : "";

    const isClickable = Boolean(onMatchClick) && (m.status === "IN_PROGRESS" || m.status === "FINISHED");
    const isSelected =
      selectedMatchId != null &&
      selectedSection != null &&
      m.id === selectedMatchId &&
      selectedSection === sectionId;

    const incidents = (incidentsByMatch?.[m.id] ?? []) as IncidentPublicDTO[];

    return (
      <div
        key={m.id}
        role={isClickable ? "button" : undefined}
        tabIndex={isClickable ? 0 : undefined}
        onClick={isClickable ? () => onMatchClick?.(m, sectionId) : undefined}
        onKeyDown={
          isClickable
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onMatchClick?.(m, sectionId);
                }
              }
            : undefined
        }
        className={[
          "px-4 py-3",
          idx > 0 ? "border-t border-white/10" : "",
          isClickable ? "cursor-pointer hover:bg-white/[0.04] focus:outline-none focus:ring-2 focus:ring-white/20" : "",
          isSelected ? "bg-white/[0.04]" : "",
        ].join(" ")}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-[240px]">
            <div className="text-sm font-semibold text-slate-100">
              {m.home_team_name} <span className="font-normal text-slate-400">vs</span> {m.away_team_name}
            </div>

            {(when || where) && (
              <div className="mt-1 text-sm text-slate-300">
                {when ? <span>{when}</span> : null}
                {when && where ? <span className="mx-2 text-slate-500">•</span> : null}
                {where ? <span>{where}</span> : null}
              </div>
            )}
          </div>

          <div className="min-w-[170px] text-right">
            <div className="flex items-center justify-end gap-2">
              {score ? (
                <div className="text-sm font-semibold text-slate-100">{score}</div>
              ) : (
                <div className="h-5 w-10 opacity-40" />
              )}

              <span className={`rounded-full border px-2 py-1 text-xs ${statusBadgeClasses(m.status)}`}>
                {statusPl(m.status)}
              </span>

              {isSelected && isClickable ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onMatchClick?.(m, sectionId);
                  }}
                  aria-label="Zwiń szczegóły"
                  title="Zwiń"
                  className="ml-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-100 hover:bg-white/10"
                >
                  —
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {isSelected && isClickable ? (
          <div className="mt-3 border-t border-white/10 pt-3">
            {incidentsError ? (
              <div className="mb-2 text-sm text-rose-300">{incidentsError}</div>
            ) : null}

            {incidentsBusy && incidents.length === 0 ? (
              <div className="text-sm text-slate-300">Ładowanie incydentów…</div>
            ) : incidents.length === 0 ? (
              <div className="text-sm text-slate-300">Brak incydentów.</div>
            ) : (
              <div className="space-y-1">
                {incidents.map((i) => (
                  <div key={i.id} className="text-sm text-slate-200">
                    {formatIncidentLine(i)}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* NA ŻYWO */}
      <section className="rounded-2xl border border-white/10 bg-white/5 p-5 sm:p-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-100">Na żywo</h2>
          <div className="text-xs text-slate-400">{liveMatches.length ? `${liveMatches.length} mecz(e)` : ""}</div>
        </div>

        {liveMatches.length === 0 ? (
          <div className="text-sm text-slate-300">Aktualnie nie ma meczów w trakcie.</div>
        ) : (
          <ListBox>{liveMatches.map((m, idx) => renderRow("live", m, idx))}</ListBox>
        )}
      </section>

      {/* NAJBLIŻSZE */}
      <section className="rounded-2xl border border-white/10 bg-white/5 p-5 sm:p-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-100">Najbliższe mecze</h2>
          <div className="text-xs text-slate-400">{upcomingMatches.length ? `${upcomingMatches.length} mecz(e)` : ""}</div>
        </div>

        {upcomingMatches.length === 0 ? (
          <div className="text-sm text-slate-300">Brak zaplanowanych meczów.</div>
        ) : (
          <ListBox>{upcomingMatches.map((m, idx) => renderRow("upcoming", m, idx))}</ListBox>
        )}
      </section>

      {/* OSTATNIE WYNIKI */}
      <section className="rounded-2xl border border-white/10 bg-white/5 p-5 sm:p-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-100">Ostatnie wyniki</h2>
          <div className="text-xs text-slate-400">{recentResults.length ? `${recentResults.length} mecz(e)` : ""}</div>
        </div>

        {recentResults.length === 0 ? (
          <div className="text-sm text-slate-300">Brak zakończonych meczów.</div>
        ) : (
          <ListBox>{recentResults.map((m, idx) => renderRow("recent", m, idx))}</ListBox>
        )}
      </section>

      {/* PEŁNY TERMINARZ */}
      <section className="rounded-2xl border border-white/10 bg-white/5 p-5 sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-100">Pełny terminarz</h2>
          <div className="text-xs text-slate-400">{stages.length ? `${stages.length} etap(y)` : ""}</div>
        </div>

        {stages.length === 0 ? (
          <div className="text-sm text-slate-300">Brak meczów do wyświetlenia.</div>
        ) : (
          <div className="space-y-5">
            {stages.map((s) => {
              const header = stageHeaderTitle(s.stageType, s.stageOrder, s.allMatches);

              return (
                <section key={s.stageId} className="rounded-xl border border-white/10 bg-black/10 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-sm font-semibold text-slate-100">{header}</h3>
                    <div className="text-xs text-slate-400">
                      {s.stageType === "GROUP" ? "Faza grupowa" : s.stageType === "LEAGUE" ? "Liga" : "Puchar"}
                    </div>
                  </div>

                  {s.stageType === "GROUP" ? (
                    <div className="space-y-4">
                      {groupMatchesByGroup(s.matches).map(([groupName, groupMatches], gidx) => (
                        <div key={String(groupName ?? gidx)} className="rounded-xl border border-white/10 bg-black/10 p-4">
                          <div className="mb-3 text-sm font-semibold text-slate-200">
                            {displayGroupName(groupName, gidx)}
                          </div>

                          <div className="space-y-4">
                            {groupMatchesByRound(groupMatches).map(([round, roundMatches]) => (
                              <div key={String(round)}>
                                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                                  Kolejka {round}
                                </div>
                                <ListBox>
                                  {roundMatches.map((m, idx) => renderRow("schedule", m, idx))}
                                </ListBox>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : s.stageType === "LEAGUE" ? (
                    <div className="space-y-4">
                      {groupMatchesByRound(s.matches).map(([round, roundMatches]) => (
                        <div key={String(round)}>
                          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                            Kolejka {round}
                          </div>
                          <ListBox>{roundMatches.map((m, idx) => renderRow("schedule", m, idx))}</ListBox>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <ListBox>{s.matches.map((m, idx) => renderRow("schedule", m, idx))}</ListBox>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
