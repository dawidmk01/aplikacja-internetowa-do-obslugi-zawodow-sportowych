import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apiFetch } from "../api";

// ============================================================
// Typ domenowy
// ============================================================

type Match = {
  id: number;
  round_number: number | null;
  home_team_name: string;
  away_team_name: string;
  home_score: number | null;
  away_score: number | null;
};

// ============================================================
// Komponent
// ============================================================

export default function TournamentMatches() {
  const { id } = useParams<{ id: string }>();
  const [matches, setMatches] = useState<Match[]>([]);
  const [error, setError] = useState<string | null>(null);

  // ----------------------------------------------------------
  // Pobranie meczów
  // ----------------------------------------------------------

  useEffect(() => {
    if (!id) return;

    apiFetch(`/api/tournaments/${id}/matches/`)
      .then((res) => {
        if (!res.ok) {
          throw new Error("Nie udało się pobrać meczów.");
        }
        return res.json();
      })
      .then((data: Match[]) => {
        setMatches(data);
      })
      .catch((err) => setError(err.message));
  }, [id]);

  // ----------------------------------------------------------
  // Normalizacja: tylko mecze z kolejką
  // ----------------------------------------------------------

  const matchesWithRound = matches.filter(
    (m) => typeof m.round_number === "number"
  );

  const matchesByRound = matchesWithRound.reduce<Record<number, Match[]>>(
    (acc, match) => {
      const round = match.round_number as number;
      if (!acc[round]) {
        acc[round] = [];
      }
      acc[round].push(match);
      return acc;
    },
    {}
  );

  const rounds = Object.keys(matchesByRound)
    .map(Number)
    .sort((a, b) => a - b);

  // ----------------------------------------------------------
  // Render
  // ----------------------------------------------------------

  if (error) {
    return <p style={{ color: "crimson" }}>{error}</p>;
  }

  if (!matches.length) {
    return <p>Brak wygenerowanych meczów.</p>;
  }

  return (
    <div style={{ padding: "2rem", maxWidth: 800 }}>
      <h1>Mecze turnieju</h1>

      {rounds.map((round) => (
        <section key={round} style={{ marginBottom: "2rem" }}>
          <h2>Kolejka {round}</h2>

          {matchesByRound[round].map((match) => (
            <div
              key={match.id}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto 1fr",
                alignItems: "center",
                padding: "0.5rem 0",
                borderBottom: "1px solid #333",
              }}
            >
              <strong style={{ textAlign: "right" }}>
                {match.home_team_name}
              </strong>

              <span style={{ padding: "0 1rem", opacity: 0.85 }}>
                {match.home_score ?? "-"} : {match.away_score ?? "-"}
              </span>

              <strong style={{ textAlign: "left" }}>
                {match.away_team_name}
              </strong>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
