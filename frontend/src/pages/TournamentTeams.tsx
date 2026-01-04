import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiFetch } from "../api";

type Team = { id: number; name: string };
type TournamentFormat = "LEAGUE" | "CUP" | "MIXED";

type TournamentDTO = {
  id: number;
  name: string;
  tournament_format: TournamentFormat;
  participants_count: number;
  format_config: Record<string, any>;
  status: "DRAFT" | "CONFIGURED" | "RUNNING" | "FINISHED";
};

type SetupTeamsResponse = {
  detail: string;
  reset_done: boolean;
  tournament: TournamentDTO;
  teams: Team[];
};

export default function TournamentTeams() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [tournament, setTournament] = useState<TournamentDTO | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const inFlightRef = useRef(false);

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
      throw new Error(data?.detail || "Nie udało się zaktualizować liczby drużyn.");
    }

    const data: SetupTeamsResponse = await res.json();
    setTournament(data.tournament);
    setTeams(data.teams);
    return data;
  };

  useEffect(() => {
    if (!id) return;
    let mounted = true;

    const init = async () => {
      try {
        setMessage(null);
        setLoading(true);
        const t = await loadTournament();
        const currentTeams = await loadTeams();

        if (mounted && t.status === "DRAFT" && currentTeams.length === 0) {
          setBusy(true);
          await setupTeams(t.participants_count);
          setMessage("Utworzono listę uczestników.");
        }
      } catch (e: any) {
        if (mounted) setMessage(e.message || "Błąd ładowania danych.");
      } finally {
        if (mounted) {
          setBusy(false);
          setLoading(false);
          inFlightRef.current = false;
        }
      }
    };
    init();
    return () => { mounted = false; };
  }, [id]);

  const needsResync = useMemo(() => {
    if (!tournament) return false;
    return teams.length !== tournament.participants_count;
  }, [tournament, teams.length]);

  const rollbackCount = useMemo(() => Math.max(2, teams.length), [teams.length]);

  const confirmIfResetMayHappen = (): boolean => {
    if (!tournament) return false;
    if (tournament.status === "DRAFT") return true;
    return window.confirm(
      "Zmiana liczby uczestników może wymagać cofnięcia rozgrywek.\nKontynuować?"
    );
  };

  const applyConfigCount = async () => {
    if (!tournament || busy || inFlightRef.current) return;
    if (!confirmIfResetMayHappen()) return;

    try {
      inFlightRef.current = true;
      setBusy(true);
      setMessage(null);
      const resp = await setupTeams(tournament.participants_count);
      setMessage(resp.detail || "Dopasowano listę do konfiguracji.");
    } catch (e: any) {
      setMessage(e.message || "Nie udało się dopasować listy.");
    } finally {
      setBusy(false);
      inFlightRef.current = false;
    }
  };

  const cancelConfigChange = async () => {
    if (!tournament || busy || inFlightRef.current) return;
    if (!confirmIfResetMayHappen()) return;

    try {
      inFlightRef.current = true;
      setBusy(true);
      setMessage(null);
      const resp = await setupTeams(rollbackCount);
      setMessage(resp.detail || "Anulowano zmianę.");
    } catch (e: any) {
      setMessage(e.message || "Nie udało się anulować.");
    } finally {
      setBusy(false);
      inFlightRef.current = false;
    }
  };

  const changeTeamsCount = async (delta: number) => {
    if (!tournament || busy || needsResync || inFlightRef.current) return;
    const next = tournament.participants_count + delta;
    if (next < 2) return;
    if (!confirmIfResetMayHappen()) return;

    try {
      inFlightRef.current = true;
      setBusy(true);
      setMessage(null);
      const resp = await setupTeams(next);
      setMessage(resp.detail || "Zmieniono liczbę uczestników.");
    } catch (e: any) {
      setMessage(e.message || "Nie udało się zmienić liczby uczestników.");
    } finally {
      setBusy(false);
      inFlightRef.current = false;
    }
  };

  const updateTeamName = async (teamId: number, name: string) => {
    const res = await apiFetch(`/api/tournaments/${id}/teams/${teamId}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.detail || "Nie udało się zapisać nazwy.");
    }
  };

  if (loading) return <p>Ładowanie…</p>;
  if (!tournament) return null;

  const formatLabel =
    tournament.tournament_format === "LEAGUE" ? "Liga" :
    tournament.tournament_format === "CUP" ? "Puchar" : "Grupy + puchar";

  const busyButtonStyle = {
    opacity: busy ? 0.6 : 1,
    cursor: busy ? "wait" : "pointer",
  };

  return (
    // USUNIĘTO overflowY: "scroll". Zostawiono minHeight, żeby stopka nie skakała.
    <div style={{ padding: "2rem", maxWidth: 900, minHeight: "100vh" }}>
      <h1>Uczestnicy turnieju</h1>

      <section style={{ opacity: 0.85, marginBottom: "0.75rem" }}>
        <div><strong>Turniej:</strong> {tournament.name}</div>
        <div><strong>Format:</strong> {formatLabel}</div>
        <div><strong>Status:</strong> {tournament.status}</div>
      </section>

      {/* Ukrywamy komunikat podczas pracy (busy), żeby nie mrugał */}
      {needsResync && !busy && (
        <div style={{
            border: "1px solid #666", padding: "0.75rem", marginBottom: "1rem", borderRadius: 8
        }}>
          Wykryto zmianę liczby miejsc w konfiguracji turnieju.
          <div style={{ marginTop: 6 }}>
            <strong>W konfiguracji:</strong> {tournament.participants_count}{" "}
            <strong> | Aktualnie pól:</strong> {teams.length}
          </div>
          <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" onClick={applyConfigCount} disabled={busy}>
              {busy ? "Przetwarzanie…" : "Dopasuj listę"}
            </button>
            <button type="button" disabled={busy} onClick={cancelConfigChange}>
              Anuluj zmianę
            </button>
          </div>
        </div>
      )}

      {tournament.status !== "DRAFT" && (
        <div style={{
            border: "1px solid #444", padding: "0.75rem", marginBottom: "1rem", borderRadius: 8
        }}>
          Zmiana nazw jest bezpieczna. Zmiana liczby miejsc (+/−) może wymagać cofnięcia rozgrywek.
        </div>
      )}

      <section style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
        <strong>Liczba miejsc</strong>
        <button
          type="button"
          onClick={() => changeTeamsCount(-1)}
          disabled={needsResync}
          style={busyButtonStyle}
        >
          −
        </button>
        <span>{tournament.participants_count}</span>
        <button
          type="button"
          onClick={() => changeTeamsCount(1)}
          disabled={needsResync}
          style={busyButtonStyle}
        >
          +
        </button>
      </section>

      <hr />

      <h2>Drużyny</h2>

      <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
          gap: "0.5rem",
        }}>
        {teams.map((team) => (
          <input
            key={team.id}
            value={team.name}
            disabled={busy}
            onChange={(e) =>
              setTeams((prev) =>
                prev.map((t) => (t.id === team.id ? { ...t, name: e.target.value } : t))
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
        <button type="button" onClick={() => navigate(-1)} disabled={busy}>
          ← Wróć
        </button>
        <button
          type="button"
          disabled={busy || (needsResync && !busy)}
          onClick={() => navigate(`/tournaments/${id}/matches`)}
        >
          {tournament.status === "DRAFT" ? "Generuj rozgrywki →" : "Przejdź do rozgrywek →"}
        </button>
      </div>

      {message && <p style={{ marginTop: "1rem" }}>{message}</p>}
    </div>
  );
}