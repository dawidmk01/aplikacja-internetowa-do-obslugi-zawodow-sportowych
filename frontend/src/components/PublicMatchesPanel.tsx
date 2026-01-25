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

        // Jeśli tylko jedna ma datę -> ta z datą ma być wyżej (nowsze logicznie)
        if (ta !== Number.POSITIVE_INFINITY && tb === Number.POSITIVE_INFINITY) return -1;
        if (ta === Number.POSITIVE_INFINITY && tb !== Number.POSITIVE_INFINITY) return 1;

        // Fallback: po id malejąco
        return b.id - a.id;
      })
      .slice(0, 8);
  }, [matches]);

  const stages = useMemo(() => buildStagesForView(matches, { showBye: false }), [matches]);

  const renderRow = (sectionId: string, m: MatchPublicDTO) => {
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
        style={{
          borderBottom: "1px solid #333",
          padding: "0.75rem 0",
          cursor: isClickable ? "pointer" : "default",
          outline: isSelected ? "2px solid #555" : "none",
          outlineOffset: isSelected ? 6 : 0,
          borderRadius: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            gap: "1rem",
            justifyContent: "space-between",
            flexWrap: "wrap",
            alignItems: "flex-start",
          }}
        >
          <div style={{ minWidth: 260 }}>
            <div style={{ fontWeight: 700 }}>
              {m.home_team_name} <span style={{ opacity: 0.6 }}>vs</span> {m.away_team_name}
            </div>

            {(when || where) && (
              <div style={{ opacity: 0.75, fontSize: "0.9rem", marginTop: 4 }}>
                {when ? <span>{when}</span> : null}
                {when && where ? <span style={{ margin: "0 0.5rem" }}>•</span> : null}
                {where ? <span>{where}</span> : null}
              </div>
            )}
          </div>

          <div style={{ textAlign: "right", minWidth: 160 }}>
            <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10 }}>
              {score ? <div style={{ fontWeight: 800 }}>{score}</div> : <div style={{ opacity: 0.55 }} />}
              {isSelected && isClickable ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onMatchClick?.(m, sectionId);
                  }}
                  aria-label="Zwiń szczegóły"
                  title="Zwiń"
                  style={{
                    border: "1px solid #444",
                    background: "transparent",
                    color: "inherit",
                    borderRadius: 8,
                    padding: "0.1rem 0.45rem",
                    lineHeight: 1,
                    cursor: "pointer",
                    opacity: 0.9,
                  }}
                >
                  —
                </button>
              ) : null}
            </div>
            <div style={{ opacity: 0.75, fontSize: "0.85rem", marginTop: 2 }}>{statusPl(m.status)}</div>
          </div>
        </div>

        {isSelected && isClickable ? (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed #333" }}>
            {incidentsError ? (
              <div style={{ opacity: 0.9, color: "#ff7b7b", marginBottom: 6 }}>{incidentsError}</div>
            ) : null}

            {incidentsBusy && incidents.length === 0 ? (
              <div style={{ opacity: 0.75 }}>Ładowanie incydentów…</div>
            ) : incidents.length === 0 ? (
              <div style={{ opacity: 0.75 }}>Brak incydentów.</div>
            ) : (
              <div style={{ display: "grid", gap: 6 }}>
                {incidents.map((i) => (
                  <div key={i.id} style={{ display: "flex", gap: 10 }}>
                    <div style={{ minWidth: 0, fontSize: "0.95rem" }}>{formatIncidentLine(i)}</div>
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
    <div>
      <section style={{ marginTop: "1.25rem", marginBottom: "1.5rem" }}>
        <h2 style={{ margin: "0 0 0.5rem 0" }}>Na żywo</h2>
        {liveMatches.length === 0 ? (
          <div style={{ opacity: 0.75 }}>Aktualnie nie ma meczów w trakcie.</div>
        ) : (
          <div style={{ border: "1px solid #333", borderRadius: 12, padding: "0.75rem 1rem" }}>
            {liveMatches.map((m) => renderRow("live", m))}
          </div>
        )}
      </section>

      <section style={{ marginTop: "1.25rem", marginBottom: "1.5rem" }}>
        <h2 style={{ margin: "0 0 0.5rem 0" }}>Najbliższe mecze</h2>
        {upcomingMatches.length === 0 ? (
          <div style={{ opacity: 0.75 }}>Brak zaplanowanych meczów.</div>
        ) : (
          <div style={{ border: "1px solid #333", borderRadius: 12, padding: "0.75rem 1rem" }}>
            {upcomingMatches.map((m) => renderRow("upcoming", m))}
          </div>
        )}
      </section>

      <section style={{ marginTop: "1.25rem", marginBottom: "1.5rem" }}>
        <h2 style={{ margin: "0 0 0.5rem 0" }}>Ostatnie wyniki</h2>
        {recentResults.length === 0 ? (
          <div style={{ opacity: 0.75 }}>Brak zakończonych meczów.</div>
        ) : (
          <div style={{ border: "1px solid #333", borderRadius: 12, padding: "0.75rem 1rem" }}>
            {recentResults.map((m) => renderRow("recent", m))}
          </div>
        )}
      </section>

      <section style={{ marginTop: "1.75rem" }}>
        <h2 style={{ margin: "0 0 0.75rem 0" }}>Pełny terminarz</h2>

        {stages.length === 0 ? (
          <div style={{ opacity: 0.75 }}>Brak meczów do wyświetlenia.</div>
        ) : (
          stages.map((s) => {
            const header = stageHeaderTitle(s.stageType, s.stageOrder, s.allMatches);

            return (
              <section key={s.stageId} style={{ marginTop: "1.25rem" }}>
                <h3 style={{ borderBottom: "2px solid #444", paddingBottom: "0.5rem", marginBottom: "0.75rem" }}>
                  {header}
                </h3>

                {s.stageType === "GROUP" ? (
                  groupMatchesByGroup(s.matches).map(([groupName, groupMatches], idx) => (
                    <div key={String(groupName ?? idx)} style={{ marginBottom: "1.25rem", paddingLeft: "1rem", borderLeft: "2px solid #333" }}>
                      <h4 style={{ opacity: 0.8, margin: "0.5rem 0" }}>{displayGroupName(groupName, idx)}</h4>

                      {groupMatchesByRound(groupMatches).map(([round, roundMatches]) => (
                        <div key={String(round)} style={{ marginBottom: "0.75rem" }}>
                          <div style={{ fontSize: "0.8rem", textTransform: "uppercase", opacity: 0.6, marginBottom: 6 }}>
                            Kolejka {round}
                          </div>
                          {roundMatches.map((m) => renderRow("schedule", m))}
                        </div>
                      ))}
                    </div>
                  ))
                ) : s.stageType === "LEAGUE" ? (
                  groupMatchesByRound(s.matches).map(([round, roundMatches]) => (
                    <div key={String(round)} style={{ marginBottom: "1rem" }}>
                      <div style={{ fontSize: "0.8rem", textTransform: "uppercase", opacity: 0.6, marginBottom: 6 }}>
                        Kolejka {round}
                      </div>
                      {roundMatches.map((m) => renderRow("schedule", m))}
                    </div>
                  ))
                ) : (
                  <div>{s.matches.map((m) => renderRow("schedule", m))}</div>
                )}
              </section>
            );
          })
        )}
      </section>
    </div>
  );
}
