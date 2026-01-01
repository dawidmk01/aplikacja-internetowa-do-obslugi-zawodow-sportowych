import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiFetch } from "../api";

/* =========================
   Typy
   ========================= */

type Team = {
  id: number;
  name: string;
};

type TournamentFormat = "LEAGUE" | "CUP" | "MIXED";

type TournamentDTO = {
  id: number;
  name: string;
  tournament_format: TournamentFormat;
  participants_count: number;
  status: "DRAFT" | "CONFIGURED" | "RUNNING" | "FINISHED";
};

/* =========================
   Komponent
   ========================= */

export default function TournamentTeams() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [tournament, setTournament] = useState<TournamentDTO | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /* =========================
     API
     ========================= */

  const loadTournament = async (): Promise<TournamentDTO> => {
    const res = await apiFetch(`/api/tournaments/${id}/`);
    if (!res.ok) throw new Error("Nie udało się pobrać turnieju.");
    const data = await res.json();
    setTournament(data);
    return data;
  };

  const loadTeams = async (): Promise<Team[]> => {
    const res = await apiFetch(`/api/tournaments/${id}/teams/`);
    if (!res.ok) throw new Error("Nie udało się pobrać drużyn.");
    const data = await res.json();
    setTeams(data);
    return data;
  };

  const setupTeams = async (count: number) => {
    const res = await apiFetch(`/api/tournaments/${id}/teams/setup/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participants_count: count }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.detail || "Nie udało się przebudować drużyn.");
    }
  };

  /* =========================
     INIT (JEDNORAZOWY)
     ========================= */

  useEffect(() => {
    if (!id) return;

    let mounted = true;

    const init = async () => {
      try {
        setMessage(null);

        const t = await loadTournament();
        const currentTeams = await loadTeams();

        // TWORZYMY DRUŻYNY TYLKO RAZ:
        // - turniej w DRAFT
        // - brak drużyn
        if (mounted && t.status === "DRAFT" && currentTeams.length === 0) {
          setBusy(true);
          await setupTeams(t.participants_count);
          await loadTeams();
        }
      } catch (e: any) {
        if (mounted) setMessage(e.message);
      } finally {
        if (mounted) {
          setBusy(false);
          setLoading(false);
        }
      }
    };

    init();
    return () => {
      mounted = false;
    };
  }, [id]);

  /* =========================
     ZMIANA LICZBY DRUŻYN (+ / −)
     ========================= */

  const changeTeamsCount = async (delta: number) => {
    if (!tournament || busy) return;

    const next = tournament.participants_count + delta;
    if (next < 2) return;

    if (tournament.status !== "DRAFT") {
      const ok = window.confirm(
        "Zmiana liczby drużyn spowoduje RESET turnieju:\n" +
        "- usunięcie meczów\n" +
        "- usunięcie etapów\n" +
        "- cofnięcie do statusu DRAFT\n\nKontynuować?"
      );
      if (!ok) return;
    }

    try {
      setBusy(true);
      setMessage(null);

      await setupTeams(next);
      const t = await loadTournament();
      await loadTeams();

      setMessage(
        t.status === "DRAFT"
          ? "Zmieniono liczbę drużyn."
          : "Zmieniono liczbę drużyn i zresetowano turniej."
      );
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  };

  /* =========================
     ZMIANA NAZWY DRUŻYNY
     ========================= */

  const updateTeamName = async (teamId: number, name: string) => {
    const res = await apiFetch(`/api/tournaments/${id}/teams/${teamId}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.detail || "Nie udało się zapisać nazwy drużyny.");
    }
  };

  /* =========================
     RENDER
     ========================= */

  if (loading) return <p>Ładowanie…</p>;
  if (!tournament) return null;

  const formatLabel =
    tournament.tournament_format === "LEAGUE"
      ? "Liga"
      : tournament.tournament_format === "CUP"
      ? "Puchar"
      : "Grupy + puchar";

  return (
    <div style={{ padding: "2rem", maxWidth: 900 }}>
      <h1>Uczestnicy turnieju</h1>

      <section style={{ opacity: 0.85, marginBottom: "0.75rem" }}>
        <div><strong>Turniej:</strong> {tournament.name}</div>
        <div><strong>Format:</strong> {formatLabel}</div>
        <div><strong>Status:</strong> {tournament.status}</div>
      </section>

      {tournament.status !== "DRAFT" && (
        <div
          style={{
            border: "1px solid #444",
            padding: "0.75rem",
            marginBottom: "1rem",
            borderRadius: 8,
          }}
        >
          Zmiana nazw drużyn jest bezpieczna.
          Zmiana liczby drużyn (+/−) zresetuje turniej.
        </div>
      )}

      {/* LICZBA DRUŻYN */}
      <section style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
        <strong>Liczba drużyn</strong>
        <button onClick={() => changeTeamsCount(-1)} disabled={busy}>−</button>
        <span>{tournament.participants_count}</span>
        <button onClick={() => changeTeamsCount(1)} disabled={busy}>+</button>
      </section>

      <hr />

      <h2>Drużyny</h2>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
          gap: "0.5rem",
        }}
      >
        {teams.map((team) => (
          <input
            key={team.id}
            value={team.name}
            onChange={(e) =>
              setTeams((prev) =>
                prev.map((t) =>
                  t.id === team.id ? { ...t, name: e.target.value } : t
                )
              )
            }
            onBlur={async (e) => {
              try {
                await updateTeamName(team.id, e.target.value);
              } catch (err: any) {
                setMessage(err.message);
                await loadTeams().catch(() => null);
              }
            }}
          />
        ))}
      </div>

      <div style={{ marginTop: "2rem", display: "flex", gap: "1rem" }}>
        <button onClick={() => navigate(-1)}>← Wróć</button>
        <button onClick={() => navigate(`/tournaments/${id}/matches`)}>
          {tournament.status === "DRAFT"
            ? "Generuj / podgląd rozgrywek →"
            : "Przejdź do rozgrywek →"}
        </button>
      </div>

      {message && <p style={{ marginTop: "1rem" }}>{message}</p>}
    </div>
  );
}
