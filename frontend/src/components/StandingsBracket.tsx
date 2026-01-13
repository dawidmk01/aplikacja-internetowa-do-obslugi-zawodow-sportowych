import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";
import { displayGroupName, isByeMatch } from "../flow/stagePresentation";

/* =========================
   HELPERY AUTH
   ========================= */

function hasAccessToken(): boolean {
  try {
    const keys = ["access", "accessToken", "access_token", "jwt_access", "token"];
    for (const k of keys) {
      const v = localStorage.getItem(k);
      if (v && v.trim()) return true;
    }
    // heurystyka: cokolwiek z "access" i nie "refresh"
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      const lk = k.toLowerCase();
      if (lk.includes("access") && !lk.includes("refresh")) {
        const v = localStorage.getItem(k);
        if (v && v.trim()) return true;
      }
    }
  } catch {}
  return false;
}

/* =========================
   TYPY
   ========================= */

export type Tournament = {
  id: number;
  name: string;
  discipline?: string; // np. "tennis"
  tournament_format: "LEAGUE" | "CUP" | "MIXED";
  format_config?: Record<string, any>; // np. { tennis_points_mode: "PLT" | "NONE" }
};

export type MatchDto = {
  id: number;
  stage_type: "LEAGUE" | "GROUP" | "KNOCKOUT" | "THIRD_PLACE";
  stage_id: number;
  stage_order: number;
  round_number: number | null;

  group_name?: string | null;

  home_team_id: number;
  away_team_id: number;
  home_team_name: string;
  away_team_name: string;

  home_score: number | null;
  away_score: number | null;

  winner_id: number | null;
  status: "SCHEDULED" | "IN_PROGRESS" | "FINISHED";
};

export type StandingRow = {
  team_id: number;
  team_name: string;

  played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;

  goals_for: number;
  goals_against: number;
  goal_difference: number;

  games_for?: number;
  games_against?: number;
  games_difference?: number;

  sets_for?: number;
  sets_against?: number;
  sets_diff?: number;
  games_diff?: number;
};

type FormResult = "W" | "D" | "L";

export type BracketDuelItem = {
  id: number;
  status: "SCHEDULED" | "IN_PROGRESS" | "FINISHED";

  home_team_id: number;
  away_team_id: number;
  home_team_name: string;
  away_team_name: string;

  winner_id: number | null;

  is_two_legged: boolean;

  score_leg1_home: number | null;
  score_leg1_away: number | null;
  score_leg2_home?: number | null;
  score_leg2_away?: number | null;

  aggregate_home?: number | null;
  aggregate_away?: number | null;

  penalties_leg1_home?: number | null;
  penalties_leg1_away?: number | null;
  penalties_leg2_home?: number | null;
  penalties_leg2_away?: number | null;

  tennis_sets_leg1?: any | null;
  tennis_sets_leg2?: any | null;
};

export type BracketRound = {
  round_number: number;
  label: string;
  items: BracketDuelItem[];
};

export type BracketData = {
  rounds: BracketRound[];
  third_place: BracketDuelItem | null;
};

export type GroupStanding = {
  group_id: number;
  group_name: string;
  table: StandingRow[];
};

export type StandingsMeta = {
  discipline?: string;
  table_schema?: string; // "TENNIS" | "DEFAULT" ...
  tennis_points_mode?: string; // "PLT" | "NONE"
};

export type StandingsResponse = {
  meta?: StandingsMeta;
  table?: StandingRow[];
  groups?: GroupStanding[];
  bracket?: BracketData;
};

/* =========================
   PROPS
   ========================= */

type StandingsBracketProps = {
  tournamentId: number;
  accessCode?: string;
  /** Na publicznej stronie zwykle masz już tytuł turnieju wyżej */
  showHeader?: boolean;
};

/* =========================
   KOMPONENT (fetch + render)
   ========================= */

export default function StandingsBracket({
  tournamentId,
  accessCode,
  showHeader = true,
}: StandingsBracketProps) {
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [matches, setMatches] = useState<MatchDto[]>([]);
  const [standings, setStandings] = useState<StandingsResponse | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const qs = useMemo(() => {
    const c = (accessCode ?? "").trim();
    return c ? `?code=${encodeURIComponent(c)}` : "";
  }, [accessCode]);

  const url = (p: string) => `${p}${qs}`;

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        // 1) Turniej (u Ciebie publiczny, 200 bez logowania)
        const tRes = await apiFetch(url(`/api/tournaments/${tournamentId}/`));
        if (!tRes.ok) throw new Error("Nie udało się pobrać danych turnieju.");
        const tData = await tRes.json();

        const t: Tournament = {
          id: tData.id,
          name: tData.name,
          discipline: tData.discipline ?? undefined,
          tournament_format: (tData.tournament_format ?? "LEAGUE") as Tournament["tournament_format"],
          format_config: tData.format_config ?? undefined,
        };
        setTournament(t);

        // 2) Standings — najpierw prywatny, potem publiczny fallback
        let sData: StandingsResponse | null = null;

        const sRes = await apiFetch(url(`/api/tournaments/${tournamentId}/standings/`));
        if (sRes.ok) {
          sData = await sRes.json();
        } else {
          // fallback publiczny
          const spRes = await apiFetch(url(`/api/tournaments/${tournamentId}/public/standings/`));
          if (spRes.ok) sData = await spRes.json();
          else sData = null;
        }
        setStandings(sData);

        // 3) Mecze — inteligentny wybór endpointu
        const authed = hasAccessToken();
        // jeśli dostaliśmy accessCode z TournamentPublic LUB brak tokena -> to jest widok publiczny
        const isPublicContext = !!accessCode || !authed;

        // Pomocnicza funkcja do mapowania publicznych danych na MatchDto
        const fetchAndMapPublicMatches = async () => {
          const mpRes = await apiFetch(url(`/api/tournaments/${tournamentId}/public/matches/`));
          if (!mpRes.ok) throw new Error("Nie udało się pobrać meczów publicznych.");
          const raw = await mpRes.json();
          const list = Array.isArray(raw) ? raw : Array.isArray(raw?.results) ? raw.results : [];

          // map public dto -> MatchDto (fallbacki)
          return list.map((m: any) => ({
            id: Number(m.id),
            stage_type: (m.stage_type ?? "LEAGUE") as MatchDto["stage_type"],
            stage_id: Number(m.stage_id ?? 0),
            stage_order: Number(m.stage_order ?? 0),
            round_number: m.round_number ?? null,
            group_name: m.group_name ?? null,
            home_team_id: Number(m.home_team_id ?? 0),
            away_team_id: Number(m.away_team_id ?? 0),
            home_team_name: String(m.home_team_name ?? ""),
            away_team_name: String(m.away_team_name ?? ""),
            home_score: m.home_score ?? null,
            away_score: m.away_score ?? null,
            winner_id: m.winner_id ?? null,
            status: (m.status ?? "SCHEDULED") as MatchDto["status"],
          }));
        };

        if (isPublicContext) {
          // 1) W kontekście publicznym: nie dotykamy /matches/ (żadnych 401 w konsoli)
          const publicMatches = await fetchAndMapPublicMatches();
          setMatches(publicMatches);
        } else {
          // 2) W kontekście zalogowanym: próbujemy /matches/ (manager)
          const mRes = await apiFetch(url(`/api/tournaments/${tournamentId}/matches/`));

          // jeśli token wygasł / brak uprawnień i poleci 401/403, robimy fallback na public
          if (mRes.status === 401 || mRes.status === 403) {
            const publicMatches = await fetchAndMapPublicMatches();
            setMatches(publicMatches);
          } else {
            if (!mRes.ok) throw new Error("Nie udało się pobrać meczów.");
            const raw = await mRes.json();
            const list = Array.isArray(raw) ? raw : Array.isArray(raw?.results) ? raw.results : [];
            setMatches(list);
          }
        }
      } catch (e: any) {
        setError(e?.message || "Wystąpił błąd");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [tournamentId, qs, accessCode]);

  if (loading) return <p style={{ padding: "1rem" }}>Ładowanie…</p>;
  if (error) return <p style={{ padding: "1rem", color: "crimson" }}>{error}</p>;
  if (!tournament) return null;

  return (
    <TournamentStandingsView
      tournament={tournament}
      matches={matches}
      standings={standings}
      showHeader={showHeader}
    />
  );
}

/* =========================
   HELPERY
   ========================= */

function normalizeGroupKey(name: string | null | undefined): string {
  const s = (name ?? "").trim().toLowerCase();
  if (!s) return "";
  return s.replace(/^grupa\s+/i, "").trim();
}

function last5Form(teamId: number, matches: MatchDto[]): FormResult[] {
  return matches
    .filter(
      (m) =>
        m.status === "FINISHED" &&
        !isByeMatch(m) &&
        (m.home_team_id === teamId || m.away_team_id === teamId)
    )
    .sort((a, b) => {
      if (a.stage_order !== b.stage_order) return b.stage_order - a.stage_order;

      const ra = a.round_number ?? 0;
      const rb = b.round_number ?? 0;
      if (ra !== rb) return rb - ra;

      return b.id - a.id;
    })
    .slice(0, 5)
    .map((m) => {
      const isHome = m.home_team_id === teamId;
      const scored = isHome ? (m.home_score ?? 0) : (m.away_score ?? 0);
      const conceded = isHome ? (m.away_score ?? 0) : (m.home_score ?? 0);

      if (scored > conceded) return "W";
      if (scored < conceded) return "L";
      return "D";
    });
}

function formatTennisSets(tennisSets: any): string | null {
  if (!Array.isArray(tennisSets) || tennisSets.length === 0) return null;

  const parts: string[] = [];
  for (const s of tennisSets) {
    if (!s || typeof s !== "object") continue;

    const hg = Number(s.home_games);
    const ag = Number(s.away_games);
    if (!Number.isFinite(hg) || !Number.isFinite(ag)) continue;

    const ht = s.home_tiebreak;
    const at = s.away_tiebreak;

    if (Number.isFinite(Number(ht)) && Number.isFinite(Number(at))) {
      parts.push(`${hg}-${ag}(${Number(ht)}-${Number(at)})`);
    } else {
      parts.push(`${hg}-${ag}`);
    }
  }

  return parts.length ? parts.join(", ") : null;
}

function formatPenalties(ph: number | null | undefined, pa: number | null | undefined): string | null {
  if (ph == null || pa == null) return null;
  return `k. ${ph}:${pa}`;
}

function safeNum(v: any, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function getTennisPointsMode(tournament: Tournament | null, standings: StandingsResponse | null): "PLT" | "NONE" {
  const tMode = (tournament?.format_config?.tennis_points_mode ?? "").toString().toUpperCase();
  if (tMode === "PLT") return "PLT";
  if (tMode === "NONE") return "NONE";

  const sMode = (standings?.meta?.tennis_points_mode ?? "").toString().toUpperCase();
  if (sMode === "PLT") return "PLT";
  if (sMode === "NONE") return "NONE";

  return "NONE";
}

/* =========================
   WIDOK: tabela + drabinka
   ========================= */

function TournamentStandingsView({
  tournament,
  matches,
  standings,
  showHeader,
}: {
  tournament: Tournament;
  matches: MatchDto[];
  standings: StandingsResponse | null;
  showHeader: boolean;
}) {
  const [tab, setTab] = useState<"TABLE" | "BRACKET">("TABLE");
  const [layoutMode, setLayoutMode] = useState<"STANDARD" | "CENTERED">("STANDARD");

  useEffect(() => {
    if (tournament?.tournament_format === "CUP") setTab("BRACKET");
  }, [tournament?.tournament_format]);

  const derived = useMemo(() => {
    const tournamentDiscipline = (tournament.discipline ?? "").toLowerCase();
    const metaSchema = (standings?.meta?.table_schema ?? "").toUpperCase();
    const metaDiscipline = (standings?.meta?.discipline ?? "").toLowerCase();

    const discipline = (metaDiscipline || tournamentDiscipline || "").toLowerCase();
    const isTennis = metaSchema === "TENNIS" || discipline === "tennis";

    const tennisPointsMode = getTennisPointsMode(tournament, standings);
    const showTennisPoints = isTennis && tennisPointsMode === "PLT";

    const isCup = tournament.tournament_format === "CUP";
    const isMixed = tournament.tournament_format === "MIXED";

    const hasLeagueTable = (standings?.table?.length ?? 0) > 0;
    const hasGroups = (standings?.groups?.length ?? 0) > 0;
    const hasTableData = hasLeagueTable || hasGroups;
    const hasBracketData = (standings?.bracket?.rounds?.length ?? 0) > 0;

    return {
      discipline,
      isTennis,
      showTennisPoints,
      isCup,
      isMixed,
      hasLeagueTable,
      hasGroups,
      hasTableData,
      hasBracketData,
    };
  }, [tournament, standings]);

  const {
    discipline,
    isTennis,
    showTennisPoints,
    isCup,
    isMixed,
    hasLeagueTable,
    hasGroups,
    hasTableData,
    hasBracketData,
  } = derived;

  return (
    <div style={{ padding: showHeader ? "2rem" : "0", maxWidth: 1400 }}>
      {showHeader && <h1 style={{ marginBottom: "0.5rem" }}>Wyniki: {tournament.name}</h1>}

      {(isMixed || (hasTableData && hasBracketData)) && (
        <div style={{ display: "flex", gap: "10px", marginBottom: "1.5rem" }}>
          <button
            onClick={() => setTab("TABLE")}
            disabled={tab === "TABLE"}
            style={{
              padding: "8px 16px",
              cursor: tab === "TABLE" ? "default" : "pointer",
              fontWeight: tab === "TABLE" ? "bold" : "normal",
              borderBottom: tab === "TABLE" ? "2px solid #3498db" : "2px solid transparent",
              background: "transparent",
              color: "#ccc",
            }}
          >
            Tabela
          </button>

          <button
            onClick={() => setTab("BRACKET")}
            disabled={tab === "BRACKET"}
            style={{
              padding: "8px 16px",
              cursor: tab === "BRACKET" ? "default" : "pointer",
              fontWeight: tab === "BRACKET" ? "bold" : "normal",
              borderBottom: tab === "BRACKET" ? "2px solid #3498db" : "2px solid transparent",
              background: "transparent",
              color: "#ccc",
            }}
          >
            Drabinka
          </button>
        </div>
      )}

      {tab === "TABLE" && (
        <>
          {hasGroups ? (
            <div>
              {standings!.groups!.map((g, idx) => {
                const groupTitle =
                  (g.group_name || "").toLowerCase().startsWith("grupa")
                    ? g.group_name
                    : displayGroupName(g.group_name, idx);

                const groupKey = normalizeGroupKey(g.group_name);
                const groupMatches = matches.filter(
                  (m) => m.stage_type === "GROUP" && normalizeGroupKey(m.group_name) === groupKey
                );

                return (
                  <div key={g.group_id} style={{ marginBottom: "2.5rem" }}>
                    <h3
                      style={{
                        marginBottom: "0.75rem",
                        color: "#3498db",
                        borderLeft: "4px solid #3498db",
                        paddingLeft: "10px",
                      }}
                    >
                      {groupTitle}
                    </h3>

                    <Table
                      rows={g.table}
                      matchesForForm={groupMatches}
                      isTennis={isTennis}
                      showTennisPoints={showTennisPoints}
                    />
                  </div>
                );
              })}
            </div>
          ) : hasLeagueTable ? (
            <Table
              rows={standings!.table!}
              matchesForForm={matches.filter((m) => m.stage_type === "LEAGUE")}
              isTennis={isTennis}
              showTennisPoints={showTennisPoints}
            />
          ) : (
            !isCup && <p>Brak danych tabeli.</p>
          )}
        </>
      )}

      {tab === "BRACKET" && (
        <>
          {hasBracketData ? (
            <div>
              <div style={{ marginBottom: "20px", display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <button
                  onClick={() => setLayoutMode("STANDARD")}
                  style={{
                    padding: "6px 12px",
                    backgroundColor: layoutMode === "STANDARD" ? "#3498db" : "#444",
                    color: "#fff",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "0.8rem",
                  }}
                >
                  Standard (Drzewko)
                </button>

                <button
                  onClick={() => setLayoutMode("CENTERED")}
                  style={{
                    padding: "6px 12px",
                    backgroundColor: layoutMode === "CENTERED" ? "#3498db" : "#444",
                    color: "#fff",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "0.8rem",
                  }}
                >
                  Finał w środku
                </button>
              </div>

              {layoutMode === "STANDARD" ? (
                <StandardBracketView data={standings!.bracket!} discipline={discipline} />
              ) : (
                <CenteredBracketView data={standings!.bracket!} discipline={discipline} />
              )}
            </div>
          ) : (
            <p>Brak danych drabinki lub faza pucharowa jeszcze się nie rozpoczęła.</p>
          )}
        </>
      )}
    </div>
  );
}

/* =========================
   TABELA
   ========================= */

function Table({
  rows,
  matchesForForm,
  isTennis,
  showTennisPoints,
}: {
  rows: StandingRow[];
  matchesForForm: MatchDto[];
  isTennis: boolean;
  showTennisPoints: boolean;
}) {
  const minWidth = isTennis ? (showTennisPoints ? "950px" : "900px") : "600px";

  const formDot = (f: FormResult) => {
    const bg =
      f === "W" ? "#2ecc71" :
      f === "D" ? "#95a5a6" :
      "#e74c3c";
    return { backgroundColor: bg };
  };

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth, color: "#ddd" }}>
        <thead>
          {isTennis ? (
            <tr style={{ borderBottom: "2px solid #444", textAlign: "left" }}>
              <th style={{ padding: "10px" }}>#</th>
              <th style={{ padding: "10px" }}>Zawodnik</th>
              <th>M</th>
              <th>Z</th>
              <th>P</th>
              <th>Sety +</th>
              <th>Sety -</th>
              <th>RS</th>
              <th>Gemy +</th>
              <th>Gemy -</th>
              <th>RG</th>
              {showTennisPoints && <th>Pkt (PLT)</th>}
              <th>Forma</th>
            </tr>
          ) : (
            <tr style={{ borderBottom: "2px solid #444", textAlign: "left" }}>
              <th style={{ padding: "10px" }}>#</th>
              <th style={{ padding: "10px" }}>Drużyna</th>
              <th>M</th>
              <th>Z</th>
              <th>R</th>
              <th>P</th>
              <th>B+</th>
              <th>B-</th>
              <th>RB</th>
              <th>Pkt</th>
              <th>Forma</th>
            </tr>
          )}
        </thead>

        <tbody>
          {rows.map((r, i) => {
            const form = last5Form(r.team_id, matchesForForm);

            if (isTennis) {
              const setsFor = safeNum(r.sets_for, safeNum(r.goals_for, 0));
              const setsAgainst = safeNum(r.sets_against, safeNum(r.goals_against, 0));
              const setsDiff = safeNum(r.sets_diff, safeNum(r.goal_difference, setsFor - setsAgainst));

              const gamesFor = safeNum(r.games_for, 0);
              const gamesAgainst = safeNum(r.games_against, 0);
              const gamesDiff = safeNum(r.games_diff, safeNum(r.games_difference, gamesFor - gamesAgainst));

              return (
                <tr key={r.team_id} style={{ borderBottom: "1px solid #333" }}>
                  <td style={{ padding: "10px" }}>{i + 1}</td>
                  <td style={{ padding: "10px", fontWeight: "bold" }}>{r.team_name}</td>
                  <td>{r.played}</td>
                  <td>{r.wins}</td>
                  <td>{r.losses}</td>
                  <td>{setsFor}</td>
                  <td>{setsAgainst}</td>
                  <td>{setsDiff}</td>
                  <td>{gamesFor}</td>
                  <td>{gamesAgainst}</td>
                  <td>{gamesDiff}</td>

                  {showTennisPoints && (
                    <td>
                      <strong style={{ color: "#3498db" }}>{r.points}</strong>
                    </td>
                  )}

                  <td>
                    <div style={{ display: "flex", gap: "3px" }}>
                      {form.map((f, idx) => (
                        <span
                          key={idx}
                          style={{
                            width: 16,
                            height: 16,
                            borderRadius: "50%",
                            fontSize: 9,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontWeight: "bold",
                            color: "#fff",
                            ...formDot(f),
                          }}
                        >
                          {f}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            }

            return (
              <tr key={r.team_id} style={{ borderBottom: "1px solid #333" }}>
                <td style={{ padding: "10px" }}>{i + 1}</td>
                <td style={{ padding: "10px", fontWeight: "bold" }}>{r.team_name}</td>
                <td>{r.played}</td>
                <td>{r.wins}</td>
                <td>{r.draws}</td>
                <td>{r.losses}</td>
                <td>{r.goals_for}</td>
                <td>{r.goals_against}</td>
                <td>{r.goal_difference}</td>
                <td>
                  <strong style={{ color: "#3498db" }}>{r.points}</strong>
                </td>
                <td>
                  <div style={{ display: "flex", gap: "3px" }}>
                    {form.map((f, idx) => (
                      <span
                        key={idx}
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: "50%",
                          fontSize: 9,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontWeight: "bold",
                          color: "#fff",
                          ...formDot(f),
                        }}
                      >
                        {f}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* =========================
   DRABINKA (Widoki)
   ========================= */

function StandardBracketView({ data, discipline }: { data: BracketData; discipline: string }) {
  const { rounds, third_place } = data;

  return (
    <div style={{ overflowX: "auto", paddingBottom: "20px" }}>
      <div style={{ display: "flex", flexDirection: "row", gap: "40px" }}>
        {rounds.map((round) => (
          <RoundColumn
            key={round.round_number}
            label={round.label}
            items={round.items}
            discipline={discipline}
          />
        ))}

        {third_place && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              minWidth: "240px",
              borderLeft: "2px dashed #555",
              paddingLeft: "30px",
              justifyContent: "center",
            }}
          >
            <h3
              style={{
                textAlign: "center",
                color: "#e67e22",
                marginBottom: "20px",
                fontSize: "0.9rem",
                textTransform: "uppercase",
              }}
            >
              Mecz o 3. miejsce
            </h3>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              <BracketMatchCard item={third_place} isThirdPlace discipline={discipline} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CenteredBracketView({ data, discipline }: { data: BracketData; discipline: string }) {
  const { rounds, third_place } = data;
  if (rounds.length === 0) return null;

  const finalRound = rounds[rounds.length - 1];
  const preFinalRounds = rounds.slice(0, rounds.length - 1);

  return (
    <div style={{ overflowX: "auto", paddingBottom: "20px", display: "flex", justifyContent: "center" }}>
      <div style={{ display: "flex", alignItems: "stretch" }}>
        <div style={{ display: "flex", gap: "20px" }}>
          {preFinalRounds.map((round) => {
            const half = Math.ceil(round.items.length / 2);
            const leftItems = round.items.slice(0, half);

            return (
              <RoundColumn
                key={`L-${round.round_number}`}
                label={round.label}
                items={leftItems}
                discipline={discipline}
              />
            );
          })}
        </div>

        <div style={{ margin: "0 40px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%" }}>
            <div style={{ fontSize: "2rem", marginBottom: "10px" }}>🏆</div>

            <RoundColumn
              label={finalRound.label}
              items={finalRound.items}
              highlight
              discipline={discipline}
            />

            {third_place && (
              <div style={{ marginTop: "50px", opacity: 0.9, transform: "scale(0.95)" }}>
                <h4 style={{ textAlign: "center", margin: "0 0 10px 0", fontSize: "0.75rem", color: "#e67e22", textTransform: "uppercase" }}>
                  Mecz o 3. miejsce
                </h4>
                <BracketMatchCard item={third_place} isThirdPlace discipline={discipline} />
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: "20px", flexDirection: "row-reverse" }}>
          {preFinalRounds.map((round) => {
            const half = Math.ceil(round.items.length / 2);
            const rightItems = round.items.slice(half);
            if (rightItems.length === 0) return null;

            return (
              <RoundColumn
                key={`R-${round.round_number}`}
                label={round.label}
                items={rightItems}
                discipline={discipline}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function RoundColumn({
  label,
  items,
  highlight = false,
  discipline,
}: {
  label: string;
  items: BracketDuelItem[];
  highlight?: boolean;
  discipline: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: "240px" }}>
      <h3
        style={{
          textAlign: "center",
          marginBottom: "20px",
          fontSize: "0.85rem",
          color: highlight ? "#f1c40f" : "#aaa",
          textTransform: "uppercase",
          letterSpacing: "1px",
          borderBottom: highlight ? "2px solid #f1c40f" : "1px solid #444",
          paddingBottom: "5px",
        }}
      >
        {label}
      </h3>

      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-around", flexGrow: 1, gap: "20px" }}>
        {items.map((item) => (
          <BracketMatchCard key={item.id} item={item} discipline={discipline} />
        ))}
      </div>
    </div>
  );
}

function BracketMatchCard({
  item,
  isThirdPlace,
  discipline,
}: {
  item: BracketDuelItem;
  isThirdPlace?: boolean;
  discipline: string;
}) {
  const isTennis = (discipline ?? "").toLowerCase() === "tennis";

  const homeWin = item.winner_id !== null && item.winner_id === item.home_team_id;
  const awayWin = item.winner_id !== null && item.winner_id === item.away_team_id;

  const aggHome = item.is_two_legged
    ? (item.aggregate_home ?? ((item.score_leg1_home ?? 0) + (item.score_leg2_home ?? 0)))
    : null;

  const aggAway = item.is_two_legged
    ? (item.aggregate_away ?? ((item.score_leg1_away ?? 0) + (item.score_leg2_away ?? 0)))
    : null;

  const canShowDetails = item.status !== "SCHEDULED";

  const tennisLeg1 = isTennis && canShowDetails ? formatTennisSets(item.tennis_sets_leg1) : null;
  const tennisLeg2 = isTennis && canShowDetails ? formatTennisSets(item.tennis_sets_leg2) : null;

  const pensLeg2 = !isTennis ? formatPenalties(item.penalties_leg2_home ?? null, item.penalties_leg2_away ?? null) : null;
  const pensLeg1 = !isTennis ? formatPenalties(item.penalties_leg1_home ?? null, item.penalties_leg1_away ?? null) : null;
  const pensText = pensLeg2 || pensLeg1;

  return (
    <div
      style={{
        border: "1px solid #ccc",
        borderRadius: "6px",
        padding: "10px",
        backgroundColor: "#fff",
        color: "#000",
        boxShadow: "0 4px 6px rgba(0,0,0,0.3)",
        fontSize: "0.85rem",
        position: "relative",
        minWidth: "220px",
        borderLeft: isThirdPlace ? "4px solid #e67e22" : "4px solid #3498db",
      }}
    >
      {item.is_two_legged && (
        <div style={{ fontSize: "0.6rem", color: "#888", marginBottom: "6px", textAlign: "center", textTransform: "uppercase", letterSpacing: "0.5px" }}>
          Dwumecz
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px", alignItems: "center" }}>
        <span style={{ fontWeight: homeWin ? "bold" : "normal", color: "#000", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", maxWidth: "110px" }}>
          {item.home_team_name || "TBD"}
        </span>

        <div style={{ display: "flex", gap: "3px" }}>
          <ScoreBox score={item.score_leg1_home} isAgg={false} />
          {item.is_two_legged && <ScoreBox score={item.score_leg2_home} isAgg={false} />}
          {item.is_two_legged && <ScoreBox score={aggHome} isAgg={true} highlight={homeWin} />}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: awayWin ? "bold" : "normal", color: "#000", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", maxWidth: "110px" }}>
          {item.away_team_name || "TBD"}
        </span>

        <div style={{ display: "flex", gap: "3px" }}>
          <ScoreBox score={item.score_leg1_away} isAgg={false} />
          {item.is_two_legged && <ScoreBox score={item.score_leg2_away} isAgg={false} />}
          {item.is_two_legged && <ScoreBox score={aggAway} isAgg={true} highlight={awayWin} />}
        </div>
      </div>

      {(tennisLeg1 || tennisLeg2 || pensText) && (
        <div style={{ marginTop: "8px", fontSize: "0.72rem", color: "#444", lineHeight: 1.25 }}>
          {tennisLeg1 && !item.is_two_legged && (
            <div>
              <strong>Sety (gemy):</strong> {tennisLeg1}
            </div>
          )}

          {item.is_two_legged && (tennisLeg1 || tennisLeg2) && (
            <div>
              <strong>Sety (gemy):</strong> {tennisLeg1 ? tennisLeg1 : "-"} {" | "} {tennisLeg2 ? tennisLeg2 : "-"}
            </div>
          )}

          {pensText && (
            <div>
              <strong>Karne:</strong> {pensText}
            </div>
          )}
        </div>
      )}

      {item.status === "FINISHED" && (
        <div style={{ fontSize: "0.65rem", color: "#666", marginTop: "6px", textAlign: "right", fontStyle: "italic" }}>
          Zakończony
        </div>
      )}
    </div>
  );
}

function ScoreBox({
  score,
  isAgg,
  highlight,
}: {
  score: number | null | undefined;
  isAgg: boolean;
  highlight?: boolean;
}) {
  const bgColor = isAgg ? (highlight ? "#3498db" : "#bdc3c7") : "#f0f0f0";
  const textColor = isAgg && highlight ? "#fff" : "#000";
  const fontWeight = isAgg ? "bold" : "normal";

  return (
    <span
      style={{
        fontWeight,
        backgroundColor: bgColor,
        color: textColor,
        padding: "2px 0",
        borderRadius: "3px",
        width: "22px",
        display: "inline-block",
        textAlign: "center",
        fontSize: "0.8rem",
        border: isAgg ? "none" : "1px solid #ddd",
      }}
    >
      {score ?? "-"}
    </span>
  );
}