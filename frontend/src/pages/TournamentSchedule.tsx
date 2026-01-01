import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiFetch } from "../api";

/* =========================
   Typy
   ========================= */

type TournamentSchedule = {
  id: number;
  start_date: string | null;
  end_date: string | null;
  location: string | null;
};

type MatchSchedule = {
  id: number;
  home_team_name: string;
  away_team_name: string;
  scheduled_date: string | null;
  scheduled_time: string | null;
  location: string | null;
};

/* =========================
   Komponent
   ========================= */

export default function TournamentSchedule() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [tournament, setTournament] = useState<TournamentSchedule | null>(null);
  const [matches, setMatches] = useState<MatchSchedule[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  /* =========================
     API
     ========================= */

  const loadData = async () => {
    const [tRes, mRes] = await Promise.all([
      apiFetch(`/api/tournaments/${id}/`),
      apiFetch(`/api/tournaments/${id}/matches/`),
    ]);

    setTournament(await tRes.json());
    setMatches(await mRes.json());
  };

  useEffect(() => {
    if (id) loadData();
  }, [id]);

  const saveTournament = async () => {
    await apiFetch(`/api/tournaments/${id}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tournament),
    });

    setMessage("Dane turnieju zapisane.");
  };

  const saveMatch = async (match: MatchSchedule) => {
    await apiFetch(`/api/matches/${match.id}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(match),
    });
  };

  /* =========================
     Render
     ========================= */

  if (!tournament) return <p>Ładowanie…</p>;

  return (
    <div style={{ padding: "2rem", maxWidth: 900 }}>
      <h1>Harmonogram i lokalizacja</h1>

      <p style={{ opacity: 0.8 }}>
        Wszystkie pola są opcjonalne. Możesz uzupełnić dane ogólne turnieju
        lub ustawić szczegóły tylko dla wybranych meczów.
      </p>

      {/* =========================
         TURNIEJ
         ========================= */}

      <h2>Turniej</h2>

      <div style={{ display: "grid", gap: "0.5rem", maxWidth: 400 }}>
        <label>Data rozpoczęcia</label>
        <input
          type="date"
          value={tournament.start_date ?? ""}
          onChange={(e) =>
            setTournament({ ...tournament, start_date: e.target.value || null })
          }
        />

        <label>Data zakończenia</label>
        <input
          type="date"
          value={tournament.end_date ?? ""}
          onChange={(e) =>
            setTournament({ ...tournament, end_date: e.target.value || null })
          }
        />

        <label>Lokalizacja</label>
        <input
          type="text"
          value={tournament.location ?? ""}
          onChange={(e) =>
            setTournament({ ...tournament, location: e.target.value || null })
          }
        />

        <button onClick={saveTournament}>Zapisz dane turnieju</button>
      </div>

      <hr />

      {/* =========================
         MECZE
         ========================= */}

      <h2>Mecze</h2>

      {matches.map((m) => (
        <div
          key={m.id}
          style={{
            borderBottom: "1px solid #333",
            padding: "0.75rem 0",
          }}
        >
          <strong>
            {m.home_team_name} vs {m.away_team_name}
          </strong>

          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
            <input
              type="date"
              value={m.scheduled_date ?? ""}
              onChange={(e) =>
                setMatches((prev) =>
                  prev.map((x) =>
                    x.id === m.id
                      ? { ...x, scheduled_date: e.target.value || null }
                      : x
                  )
                )
              }
            />

            <input
              type="time"
              value={m.scheduled_time ?? ""}
              onChange={(e) =>
                setMatches((prev) =>
                  prev.map((x) =>
                    x.id === m.id
                      ? { ...x, scheduled_time: e.target.value || null }
                      : x
                  )
                )
              }
            />

            <input
              type="text"
              placeholder="Lokalizacja"
              value={m.location ?? ""}
              onChange={(e) =>
                setMatches((prev) =>
                  prev.map((x) =>
                    x.id === m.id
                      ? { ...x, location: e.target.value || null }
                      : x
                  )
                )
              }
            />

            <button onClick={() => saveMatch(m)}>Zapisz</button>
          </div>
        </div>
      ))}

      <div style={{ marginTop: "2rem", display: "flex", gap: "1rem" }}>
        <button onClick={() => navigate(-1)}>← Wróć</button>

        <button
          onClick={() => navigate(`/tournaments/${id}/results`)}
          style={{
            background: "#1e90ff",
            color: "#fff",
            padding: "0.5rem 1rem",
            borderRadius: 6,
            border: "none",
          }}
        >
          Przejdź do wprowadzania wyników →
        </button>
      </div>


      {message && <p>{message}</p>}
    </div>
  );
}
