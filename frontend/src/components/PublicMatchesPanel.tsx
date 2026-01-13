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

export default function PublicMatchesPanel({ matches }: { matches: MatchPublicDTO[] }) {
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

  const renderRow = (m: MatchPublicDTO) => {
    const when = whenText(m);
    const where = (m.location ?? "").trim();

    const hasScore = typeof m.home_score === "number" && typeof m.away_score === "number";
    const score = hasScore ? `${m.home_score} : ${m.away_score}` : "";

    return (
      <div
        key={m.id}
        style={{
          borderBottom: "1px solid #333",
          padding: "0.75rem 0",
          display: "flex",
          gap: "1rem",
          justifyContent: "space-between",
          flexWrap: "wrap",
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

        <div style={{ textAlign: "right", minWidth: 140 }}>
          {score ? <div style={{ fontWeight: 800 }}>{score}</div> : <div style={{ opacity: 0.55 }} />}
          <div style={{ opacity: 0.75, fontSize: "0.85rem" }}>{statusPl(m.status)}</div>
        </div>
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
            {liveMatches.map(renderRow)}
          </div>
        )}
      </section>

      <section style={{ marginTop: "1.25rem", marginBottom: "1.5rem" }}>
        <h2 style={{ margin: "0 0 0.5rem 0" }}>Najbliższe mecze</h2>
        {upcomingMatches.length === 0 ? (
          <div style={{ opacity: 0.75 }}>Brak zaplanowanych meczów.</div>
        ) : (
          <div style={{ border: "1px solid #333", borderRadius: 12, padding: "0.75rem 1rem" }}>
            {upcomingMatches.map(renderRow)}
          </div>
        )}
      </section>

      <section style={{ marginTop: "1.25rem", marginBottom: "1.5rem" }}>
        <h2 style={{ margin: "0 0 0.5rem 0" }}>Ostatnie wyniki</h2>
        {recentResults.length === 0 ? (
          <div style={{ opacity: 0.75 }}>Brak zakończonych meczów.</div>
        ) : (
          <div style={{ border: "1px solid #333", borderRadius: 12, padding: "0.75rem 1rem" }}>
            {recentResults.map(renderRow)}
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
                          {roundMatches.map(renderRow)}
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
                      {roundMatches.map(renderRow)}
                    </div>
                  ))
                ) : (
                  <div>{s.matches.map(renderRow)}</div>
                )}
              </section>
            );
          })
        )}
      </section>
    </div>
  );
}
