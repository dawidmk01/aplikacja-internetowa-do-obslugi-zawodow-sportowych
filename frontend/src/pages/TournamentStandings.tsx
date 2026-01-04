import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { apiGet, apiFetch } from "../api";

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

  home_score: number;
  away_score: number;

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

/* =========================
   HELPERY
   ========================= */

/**
 * Ostatnie 5 spotkań drużyny
 * – tylko LEAGUE / GROUP
 * – tylko FINISHED
 * – sort: etap → runda → id
 */
function last5Form(teamId: number, matches: MatchDto[]): FormResult[] {
  return matches
    .filter(
      (m) =>
        m.status === "FINISHED" &&
        !["KNOCKOUT", "THIRD_PLACE"].includes(m.stage_type) &&
        (m.home_team_id === teamId || m.away_team_id === teamId)
    )
    .sort((a, b) => {
      if (a.stage_order !== b.stage_order)
        return b.stage_order - a.stage_order;

      const ra = a.round_number ?? 0;
      const rb = b.round_number ?? 0;
      if (ra !== rb) return rb - ra;

      return b.id - a.id;
    })
    .slice(0, 5)
    .map((m) => {
      const isHome = m.home_team_id === teamId;
      const scored = isHome ? m.home_score : m.away_score;
      const conceded = isHome ? m.away_score : m.home_score;

      if (scored > conceded) return "W";
      if (scored < conceded) return "L";
      return "D";
    });
}


/* =========================
   KOMPONENT
   ========================= */

export default function TournamentStandings() {
  const { id } = useParams<{ id: string }>();

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [matches, setMatches] = useState<MatchDto[]>([]);
  const [standings, setStandings] = useState<any>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<"TABLE" | "BRACKET">("TABLE");

  useEffect(() => {
    if (!id) return;

    const load = async () => {
      setLoading(true);
      try {
        const t = await apiGet<Tournament>(`/api/tournaments/${id}/`);
        setTournament(t);

        const s = await apiFetch(`/api/tournaments/${id}/standings/`);
        if (s.ok) setStandings(await s.json());

        const m = await apiFetch(`/api/tournaments/${id}/matches/`);
        if (!m.ok) throw new Error("Nie udało się pobrać meczów.");

        const raw = await m.json();
        const list = Array.isArray(raw)
          ? raw
          : Array.isArray(raw.results)
          ? raw.results
          : [];

        setMatches(list);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [id]);

  if (loading) return <p style={{ padding: "2rem" }}>Ładowanie…</p>;
  if (error)
    return <p style={{ padding: "2rem", color: "crimson" }}>{error}</p>;
  if (!tournament) return null;

  const isLeague = tournament.tournament_format === "LEAGUE";
  const isMixed = tournament.tournament_format === "MIXED";

  return (
    <div style={{ padding: "2rem", maxWidth: 1100 }}>
      <h1 style={{ marginBottom: "0.5rem" }}>
        {isLeague ? "Tabela ligowa" : "Tabela / drabinka"}
      </h1>

      <p style={{ opacity: 0.85 }}>
        Turniej: <strong>{tournament.name}</strong>
      </p>

      {!isLeague && (
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
          <button onClick={() => setTab("TABLE")}>Tabela</button>
          <button onClick={() => setTab("BRACKET")}>Drabinka</button>
        </div>
      )}

      {(isLeague || (isMixed && tab === "TABLE")) && standings?.table && (
        <Table rows={standings.table} matches={matches} />
      )}

      <Link to={`/tournaments/${id}/results`}>Wróć do wyników</Link>
    </div>
  );
}

/* =========================
   TABELA
   ========================= */

function Table({
  rows,
  matches,
}: {
  rows: StandingRow[];
  matches: MatchDto[];
}) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          <th>#</th>
          <th>Drużyna</th>
          <th>M</th>
          <th>Z</th>
          <th>R</th>
          <th>P</th>
          <th>B+</th>
          <th>B-</th>
          <th>RB</th>
          <th>Pkt</th>
          <th>Ostatnie 5</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const form = last5Form(r.team_id, matches);
          return (
            <tr key={r.team_id}>
              <td>{i + 1}</td>
              <td>{r.team_name}</td>
              <td>{r.played}</td>
              <td>{r.wins}</td>
              <td>{r.draws}</td>
              <td>{r.losses}</td>
              <td>{r.goals_for}</td>
              <td>{r.goals_against}</td>
              <td>{r.goal_difference}</td>
              <td>
                <strong>{r.points}</strong>
              </td>
              <td>
                {form.map((f, idx) => (
                  <span
                    key={idx}
                    style={{
                      display: "inline-flex",
                      justifyContent: "center",
                      alignItems: "center",
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      marginRight: 4,
                      fontSize: 10,
                      color: "#fff",
                      background:
                        f === "W" ? "#2ecc71" : f === "D" ? "#95a5a6" : "#e74c3c",
                    }}
                    title={
                      f === "W" ? "Wygrana" : f === "D" ? "Remis" : "Porażka"
                    }
                  >
                    {f}
                  </span>
                ))}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
