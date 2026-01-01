import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiFetch } from "../api";

// ============================================================
// Typ domenowy
// ============================================================

type Match = {
  id: number;
  round_number: number | null;
  stage_type: "LEAGUE" | "KNOCKOUT";
  home_team_name: string;
  away_team_name: string;
  home_score: number | null;
  away_score: number | null;
};

// ============================================================
// Nazewnictwo rund pucharowych
// ============================================================

function getKnockoutRoundLabel(matchesInRound: number): string {
  const teams = matchesInRound * 2;

  if (teams === 2) return "Finał";
  if (teams === 4) return "Półfinał";
  if (teams === 8) return "Ćwierćfinał";

  return `1/${teams} finału`;
}

// ============================================================
// Komponent
// ============================================================

export default function TournamentMatches() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ----------------------------------------------------------
  // Pobranie meczów
  // ----------------------------------------------------------

  const loadMatches = async () => {
    if (!id) return;

    const res = await apiFetch(`/api/tournaments/${id}/matches/`);
    if (!res.ok) {
      throw new Error("Nie udało się pobrać meczów.");
    }

    const data: Match[] = await res.json();
    setMatches(data);
  };

  useEffect(() => {
    setLoading(true);
    loadMatches()
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ----------------------------------------------------------
  // Generowanie rozgrywek
  // ----------------------------------------------------------

  const generateMatches = async () => {
    if (!id || busy) return;

    try {
      setBusy(true);
      setError(null);

      const res = await apiFetch(`/api/tournaments/${id}/generate/`, {
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail || "Nie udało się wygenerować rozgrywek.");
      }

      await loadMatches();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  // ----------------------------------------------------------
  // Grupowanie meczów po numerze rundy
  // ----------------------------------------------------------

  const matchesByRound = matches.reduce<Record<number, Match[]>>(
    (acc, match) => {
      if (typeof match.round_number !== "number") return acc;

      if (!acc[match.round_number]) {
        acc[match.round_number] = [];
      }

      acc[match.round_number].push(match);
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

  if (loading) {
    return <p>Ładowanie…</p>;
  }

  if (error) {
    return <p style={{ color: "crimson" }}>{error}</p>;
  }

  if (!matches.length) {
    return (
      <div style={{ padding: "2rem" }}>
        <h1>Mecze turnieju</h1>

        <p>Brak wygenerowanych meczów.</p>

        <div style={{ marginTop: "1.5rem", display: "flex", gap: "1rem" }}>
          <button onClick={() => navigate(-1)}>← Wróć</button>

          <button onClick={generateMatches} disabled={busy}>
            {busy ? "Generowanie…" : "Generuj rozgrywki"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "2rem", maxWidth: 800 }}>
      <h1>Mecze turnieju</h1>

      <button onClick={() => navigate(-1)}>← Wróć</button>

      {rounds.map((round) => {
        const roundMatches = matchesByRound[round];
        const stageType = roundMatches[0].stage_type;

        const title =
          stageType === "KNOCKOUT"
            ? getKnockoutRoundLabel(roundMatches.length)
            : `Kolejka ${round}`;

        return (
          <section key={round} style={{ marginBottom: "2rem" }}>
            <h2>{title}</h2>

            {roundMatches.map((match) => (
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
        );
      })}
    </div>
  );
}
