import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { apiFetch } from "../api";

type Team = { id: number; name: string };
type TournamentFormat = "LEAGUE" | "CUP" | "MIXED";
type TournamentStatus = "DRAFT" | "CONFIGURED" | "RUNNING" | "FINISHED";
type MyRole = "ORGANIZER" | "ASSISTANT" | null;

type TournamentDTO = {
  id: number;
  name: string;
  tournament_format: TournamentFormat;
  format_config?: Record<string, any>;
  status: TournamentStatus;
  competition_type?: "INDIVIDUAL" | "TEAM";
  my_role?: MyRole;
  matches_started?: boolean; // REALNY start (bez BYE)
  [key: string]: any;
};

type SetupTeamsResponse = {
  detail: string;
  reset_done: boolean;
  tournament: TournamentDTO;
  teams: Team[];
};

export default function TournamentTeams() {
  const { id } = useParams<{ id: string }>();

  const [tournament, setTournament] = useState<TournamentDTO | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const inFlightRef = useRef(false);

  const loadTournament = async (): Promise<TournamentDTO> => {
    const res = await apiFetch(`/api/tournaments/${id}/`);
    if (!res.ok) throw new Error("Nie udało się pobrać turnieju.");
    const data: TournamentDTO = await res.json();
    setTournament(data);
    return data;
  };

  const loadTeams = async (): Promise<Team[]> => {
    const res = await apiFetch(`/api/tournaments/${id}/teams/`);
    if (!res.ok) throw new Error("Nie udało się pobrać uczestników.");
    const data: Team[] = await res.json();
    setTeams(data);
    return data;
  };

  const setupTeams = async (count: number) => {
    const res = await apiFetch(`/api/tournaments/${id}/teams/setup/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teams_count: count }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.detail || "Nie udało się zaktualizować liczby uczestników.");
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

        await loadTournament();
        await loadTeams();
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
    return () => {
      mounted = false;
    };
  }, [id]);

  const currentCount = useMemo(() => Math.max(2, teams.length), [teams.length]);

  if (loading) return <p>Ładowanie…</p>;
  if (!tournament) return null;

  const myRole: MyRole = tournament.my_role ?? null;
  const isOrganizer = myRole === "ORGANIZER";
  const isAssistant = myRole === "ASSISTANT";
  const matchesStarted = Boolean(tournament.matches_started);

  const lockCountForAssistant = isAssistant && matchesStarted;

  const formatLabel =
    tournament.tournament_format === "LEAGUE"
      ? "Liga"
      : tournament.tournament_format === "CUP"
        ? "Puchar"
        : "Grupy + puchar";

  const confirmChangeCount = (): boolean => {
    // Asystent po starcie i tak nie dojdzie do tego miejsca (button disabled),
    // ale zostawiamy też ochronę UX.
    if (lockCountForAssistant) {
      setMessage("Asystent nie może zmieniać liczby uczestników po rozpoczęciu turnieju.");
      return false;
    }

    // DRAFT: to “najbezpieczniej”
    if (tournament.status === "DRAFT" && !matchesStarted) return true;

    // Organizator po starcie: mocna informacja o skutkach
    if (isOrganizer && matchesStarted) {
      return window.confirm(
        [
          "Turniej jest rozpoczęty.",
          "",
          "Zmiana liczby uczestników spowoduje PEŁNY RESET rozgrywek:",
          "- usunięcie wszystkich etapów i meczów (także rozegranych)",
          "- skasowanie wyników i postępu drabinki/tabel",
          "- skasowanie harmonogramu meczów",
          "",
          "Nazwy zawodników/drużyn pozostaną (część może zostać dezaktywowana przy zmniejszeniu liczby).",
          "",
          "Kontynuować?",
        ].join("\n")
      );
    }

    // Standardowe ostrzeżenie (CONFIGURED/RUNNING bez realnego startu itp.)
    return window.confirm(
      "Zmiana liczby uczestników spowoduje reset rozgrywek (etapy i mecze).\nKontynuować?"
    );
  };

  const changeTeamsCount = async (delta: number) => {
    if (!tournament || busy || inFlightRef.current) return;
    if (lockCountForAssistant) return;

    const next = currentCount + delta;
    if (next < 2) return;

    if (!confirmChangeCount()) return;

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

  const busyButtonStyle: React.CSSProperties = {
    opacity: busy ? 0.6 : 1,
    cursor: busy ? "wait" : "pointer",
  };

  return (
    <div style={{ padding: "2rem", maxWidth: 900, minHeight: "100vh" }}>
      <h1>Uczestnicy turnieju</h1>

      <section style={{ opacity: 0.85, marginBottom: "0.75rem" }}>
        <div>
          <strong>Turniej:</strong> {tournament.name}
        </div>
        <div>
          <strong>Format:</strong> {formatLabel}
        </div>
        <div>
          <strong>Status:</strong> {tournament.status}
        </div>
      </section>

      {/* Komunikaty zależne od roli */}
      {lockCountForAssistant && (
        <div
          style={{
            border: "1px solid #6a3b3b",
            padding: "0.75rem",
            marginBottom: "1rem",
            borderRadius: 8,
          }}
        >
          Turniej już się rozpoczął (są mecze w trakcie lub zakończone) — asystent nie może zmieniać liczby uczestników.
        </div>
      )}

      {isOrganizer && matchesStarted && (
        <div
          style={{
            border: "1px solid #7a6a2a",
            padding: "0.75rem",
            marginBottom: "1rem",
            borderRadius: 8,
          }}
        >
          Turniej jest rozpoczęty. Organizator może zmienić liczbę uczestników, ale spowoduje to pełny reset:
          usunięcie meczów, wyników i harmonogramu oraz ponowną generację rozgrywek.
        </div>
      )}

      {!matchesStarted && tournament.status !== "DRAFT" && (
        <div
          style={{
            border: "1px solid #444",
            padding: "0.75rem",
            marginBottom: "1rem",
            borderRadius: 8,
          }}
        >
          Zmiana nazw jest bezpieczna. Zmiana liczby uczestników (+/−) spowoduje reset rozgrywek.
        </div>
      )}

      <section style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
        <strong>Liczba uczestników</strong>
        <button
          type="button"
          onClick={() => changeTeamsCount(-1)}
          disabled={busy || lockCountForAssistant}
          style={busyButtonStyle}
        >
          −
        </button>
        <span>{currentCount}</span>
        <button
          type="button"
          onClick={() => changeTeamsCount(1)}
          disabled={busy || lockCountForAssistant}
          style={busyButtonStyle}
        >
          +
        </button>
      </section>

      <hr />

      <h2>{tournament?.competition_type === "INDIVIDUAL" ? "Zawodnicy" : "Drużyny"}</h2>

      {teams.length === 0 && !busy ? (
        <p style={{ opacity: 0.6, fontStyle: "italic" }}>
          Brak aktywnych uczestników — ustaw liczbę miejsc (+) aby utworzyć listę.
        </p>
      ) : (
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
      )}

      {message && <p style={{ marginTop: "1rem" }}>{message}</p>}
    </div>
  );
}
