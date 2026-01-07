import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apiGet, apiFetch } from "../api";
import { displayGroupName, isByeMatch } from "../flow/stagePresentation";

/* =========================
   TYPY
   ========================= */

type Tournament = {
  id: number;
  name: string;
  tournament_format: "LEAGUE" | "CUP" | "MIXED";
};

type MatchDto = {
  id: number;
  stage_type: "LEAGUE" | "GROUP" | "KNOCKOUT" | "THIRD_PLACE";
  stage_id: number;
  stage_order: number;
  round_number: number | null;

  home_team_id: number;
  away_team_id: number;
  home_team_name: string;
  away_team_name: string;

  home_score: number | null;
  away_score: number | null;

  winner_id: number | null;
  status: "SCHEDULED" | "IN_PROGRESS" | "FINISHED";
};

type StandingRow = {
  team_id: number;
  team_name: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  points: number;
};

type FormResult = "W" | "D" | "L";

type BracketDuelItem = {
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
};

type BracketRound = {
  round_number: number;
  label: string;
  items: BracketDuelItem[];
};

type BracketData = {
  rounds: BracketRound[];
  third_place: BracketDuelItem | null;
};

type GroupStanding = {
  group_id: number;
  group_name: string;
  table: StandingRow[];
};

type StandingsResponse = {
  table?: StandingRow[];
  groups?: GroupStanding[];
  bracket?: BracketData;
};

/* =========================
   HELPERY
   ========================= */

function last5Form(teamId: number, matches: MatchDto[]): FormResult[] {
  return matches
    .filter(
      (m) =>
        m.status === "FINISHED" &&
        !isByeMatch(m) &&
        !["KNOCKOUT", "THIRD_PLACE"].includes(m.stage_type) &&
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

/* =========================
   KOMPONENT GŁÓWNY
   ========================= */

export default function TournamentStandings() {
  const { id } = useParams<{ id: string }>();

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [matches, setMatches] = useState<MatchDto[]>([]);
  const [standings, setStandings] = useState<StandingsResponse | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<"TABLE" | "BRACKET">("TABLE");
  const [layoutMode, setLayoutMode] = useState<"STANDARD" | "CENTERED">("STANDARD");

  useEffect(() => {
    if (!id) return;

    const load = async () => {
      setLoading(true);
      try {
        const t = await apiGet<Tournament>(`/api/tournaments/${id}/`);
        setTournament(t);

        if (t.tournament_format === "CUP") setTab("BRACKET");

        const s = await apiFetch(`/api/tournaments/${id}/standings/`);
        if (s.ok) setStandings(await s.json());

        const m = await apiFetch(`/api/tournaments/${id}/matches/`);
        if (m.ok) {
          const raw = await m.json();
          const list = Array.isArray(raw) ? raw : Array.isArray(raw?.results) ? raw.results : [];
          setMatches(list);
        }
      } catch (e: any) {
        setError(e.message || "Wystąpił błąd");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [id]);

  if (loading) return <p style={{ padding: "2rem" }}>Ładowanie…</p>;
  if (error) return <p style={{ padding: "2rem", color: "crimson" }}>{error}</p>;
  if (!tournament) return null;

  const isCup = tournament.tournament_format === "CUP";
  const isMixed = tournament.tournament_format === "MIXED";

  const hasLeagueTable = (standings?.table?.length ?? 0) > 0;
  const hasGroups = (standings?.groups?.length ?? 0) > 0;
  const hasTableData = hasLeagueTable || hasGroups;
  const hasBracketData = (standings?.bracket?.rounds?.length ?? 0) > 0;

  return (
    <div style={{ padding: "2rem", maxWidth: 1400 }}>
      <h1 style={{ marginBottom: "0.5rem" }}>Wyniki: {tournament.name}</h1>

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
        hasGroups ? (
          <div>
            {standings!.groups!.map((g, idx) => {
              const groupTitle =
                (g.group_name || "").toLowerCase().startsWith("grupa")
                  ? g.group_name
                  : displayGroupName(g.group_name, idx);

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
                  <Table rows={g.table} matches={matches} />
                </div>
              );
            })}
          </div>
        ) : hasLeagueTable ? (
          <Table rows={standings!.table!} matches={matches} />
        ) : (
          !isCup && <p>Brak danych tabeli.</p>
        )
      )}

      {tab === "BRACKET" && (
        hasBracketData ? (
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
              <StandardBracketView data={standings!.bracket!} />
            ) : (
              <CenteredBracketView data={standings!.bracket!} />
            )}
          </div>
        ) : (
          <p>Brak danych drabinki lub faza pucharowa jeszcze się nie rozpoczęła.</p>
        )
      )}
    </div>
  );
}

/* =========================
   KOMPONENTY: TABELA
   ========================= */

function Table({ rows, matches }: { rows: StandingRow[]; matches: MatchDto[] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          minWidth: "600px",
          color: "#ddd",
        }}
      >
        <thead>
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
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const form = last5Form(r.team_id, matches);
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
                          backgroundColor: f === "W" ? "#2ecc71" : f === "D" ? "#95a5a6" : "#e74c3c",
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
   KOMPONENTY: DRABINKA (Widoki)
   ========================= */

function StandardBracketView({ data }: { data: BracketData }) {
  const { rounds, third_place } = data;

  return (
    <div style={{ overflowX: "auto", paddingBottom: "20px" }}>
      <div style={{ display: "flex", flexDirection: "row", gap: "40px" }}>
        {rounds.map((round) => (
          <RoundColumn key={round.round_number} label={round.label} items={round.items} />
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
              <BracketMatchCard item={third_place} isThirdPlace />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CenteredBracketView({ data }: { data: BracketData }) {
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
            return <RoundColumn key={`L-${round.round_number}`} label={round.label} items={leftItems} />;
          })}
        </div>

        <div style={{ margin: "0 40px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%" }}>
            <div style={{ fontSize: "2rem", marginBottom: "10px" }}>🏆</div>

            <RoundColumn label={finalRound.label} items={finalRound.items} highlight />

            {third_place && (
              <div style={{ marginTop: "50px", opacity: 0.9, transform: "scale(0.95)" }}>
                <h4
                  style={{
                    textAlign: "center",
                    margin: "0 0 10px 0",
                    fontSize: "0.75rem",
                    color: "#e67e22",
                    textTransform: "uppercase",
                  }}
                >
                  Mecz o 3. miejsce
                </h4>
                <BracketMatchCard item={third_place} isThirdPlace />
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: "20px", flexDirection: "row-reverse" }}>
          {preFinalRounds.map((round) => {
            const half = Math.ceil(round.items.length / 2);
            const rightItems = round.items.slice(half);
            if (rightItems.length === 0) return null;
            return <RoundColumn key={`R-${round.round_number}`} label={round.label} items={rightItems} />;
          })}
        </div>
      </div>
    </div>
  );
}

/* =========================
   KOMPONENTY POMOCNICZE DRABINKI
   ========================= */

function RoundColumn({ label, items, highlight = false }: { label: string; items: BracketDuelItem[]; highlight?: boolean }) {
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
          <BracketMatchCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

function BracketMatchCard({ item, isThirdPlace }: { item: BracketDuelItem; isThirdPlace?: boolean }) {
  const homeWin = item.winner_id !== null && item.winner_id === item.home_team_id;
  const awayWin = item.winner_id !== null && item.winner_id === item.away_team_id;

  const aggHome = item.is_two_legged ? (item.score_leg1_home ?? 0) + (item.score_leg2_home ?? 0) : null;
  const aggAway = item.is_two_legged ? (item.score_leg1_away ?? 0) + (item.score_leg2_away ?? 0) : null;

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

      {item.status === "FINISHED" && (
        <div style={{ fontSize: "0.65rem", color: "#666", marginTop: "6px", textAlign: "right", fontStyle: "italic" }}>Zakończony</div>
      )}
    </div>
  );
}

function ScoreBox({ score, isAgg, highlight }: { score: number | null | undefined; isAgg: boolean; highlight?: boolean }) {
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
