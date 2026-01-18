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

type NameChangeRequestItem = {
  id: number;
  team_id: number;
  old_name: string;
  requested_name: string;
  requested_by_id: number;
  created_at: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
};

type NameChangeRequestListResponse = {
  count: number;
  results: NameChangeRequestItem[];
};

export default function TournamentTeams() {
  const { id } = useParams<{ id: string }>();

  const [tournament, setTournament] = useState<TournamentDTO | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // kolejka
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueBusy, setQueueBusy] = useState(false);
  const [pendingRequests, setPendingRequests] = useState<NameChangeRequestItem[]>([]);

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

  const loadPendingQueue = async () => {
    if (!id) return;

    setQueueLoading(true);
    try {
      const res = await apiFetch(`/api/tournaments/${id}/teams/name-change-requests/`);
      if (!res.ok) {
        // brak dostępu lub endpoint nieaktywny
        setPendingRequests([]);
        return;
      }
      const data: NameChangeRequestListResponse = await res.json();
      setPendingRequests(Array.isArray(data?.results) ? data.results : []);
    } catch {
      setPendingRequests([]);
    } finally {
      setQueueLoading(false);
    }
  };

  const approveRequest = async (requestId: number) => {
    if (!id) return;

    setQueueBusy(true);
    setMessage(null);
    try {
      const res = await apiFetch(
        `/api/tournaments/${id}/teams/name-change-requests/${requestId}/approve/`,
        { method: "POST" }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail || "Nie udało się zaakceptować prośby.");
      }

      await loadPendingQueue();
      await loadTeams().catch(() => null);
      setMessage("Prośba zaakceptowana.");
    } catch (e: any) {
      setMessage(e?.message || "Błąd akceptacji prośby.");
    } finally {
      setQueueBusy(false);
    }
  };

  const rejectRequest = async (requestId: number) => {
    if (!id) return;

    setQueueBusy(true);
    setMessage(null);
    try {
      const res = await apiFetch(
        `/api/tournaments/${id}/teams/name-change-requests/${requestId}/reject/`,
        { method: "POST" }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail || "Nie udało się odrzucić prośby.");
      }

      await loadPendingQueue();
      setMessage("Prośba odrzucona.");
    } catch (e: any) {
      setMessage(e?.message || "Błąd odrzucenia prośby.");
    } finally {
      setQueueBusy(false);
    }
  };

  useEffect(() => {
    if (!id) return;

    let mounted = true;

    const init = async () => {
      try {
        setMessage(null);
        setLoading(true);

        const t = await loadTournament();
        await loadTeams();

        // kolejka tylko dla organizer/asystent (backend i tak zwróci 403 jeśli brak uprawnień)
        if (mounted && (t.my_role === "ORGANIZER" || t.my_role === "ASSISTANT")) {
          await loadPendingQueue();
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
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const currentCount = useMemo(() => Math.max(2, teams.length), [teams.length]);

  if (loading) return <p>Ładowanie…</p>;
  if (!tournament) return null;

  const myRole: MyRole = tournament.my_role ?? null;
  const isOrganizer = myRole === "ORGANIZER";
  const isAssistant = myRole === "ASSISTANT";
  const canManageQueue = isOrganizer || isAssistant;

  const matchesStarted = Boolean(tournament.matches_started);
  const lockCountForAssistant = isAssistant && matchesStarted;

  const formatLabel =
    tournament.tournament_format === "LEAGUE"
      ? "Liga"
      : tournament.tournament_format === "CUP"
        ? "Puchar"
        : "Grupy + puchar";

  const confirmChangeCount = (): boolean => {
    if (lockCountForAssistant) {
      setMessage("Asystent nie może zmieniać liczby uczestników po rozpoczęciu turnieju.");
      return false;
    }

    if (tournament.status === "DRAFT" && !matchesStarted) return true;

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

      // po zmianie listy teamów warto odświeżyć kolejkę (sloty mogły się zmienić)
      if (canManageQueue) await loadPendingQueue();
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

      {/* =========================
          KOLEJKA PROŚB (PENDING)
         ========================= */}
      {canManageQueue && (
        <>
          <section style={{ margin: "1rem 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <h2 style={{ margin: 0 }}>Kolejka próśb o zmianę nazwy</h2>

              <button
                type="button"
                onClick={() => loadPendingQueue()}
                disabled={queueLoading || queueBusy}
                style={{
                  opacity: queueLoading || queueBusy ? 0.7 : 1,
                  cursor: queueLoading || queueBusy ? "wait" : "pointer",
                }}
              >
                Odśwież
              </button>

              <span style={{ opacity: 0.8 }}>
                {queueLoading ? "Ładowanie…" : `Oczekuje: ${pendingRequests.length}`}
              </span>
            </div>

            {pendingRequests.length === 0 && !queueLoading ? (
              <p style={{ opacity: 0.7, fontStyle: "italic" }}>Brak oczekujących próśb.</p>
            ) : (
              <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                {pendingRequests.map((r) => (
                  <div
                    key={r.id}
                    style={{
                      border: "1px solid #444",
                      borderRadius: 10,
                      padding: "0.75rem",
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      alignItems: "center",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>
                        Team #{r.team_id}
                      </div>
                      <div style={{ opacity: 0.9, wordBreak: "break-word" }}>
                        <span style={{ opacity: 0.7 }}>Było:</span> {r.old_name}
                        <br />
                        <span style={{ opacity: 0.7 }}>Chce:</span> {r.requested_name}
                      </div>
                      <div style={{ opacity: 0.6, fontSize: 12, marginTop: 6 }}>
                        request_id: {r.id} • user_id: {r.requested_by_id}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                      <button
                        type="button"
                        disabled={queueBusy}
                        onClick={() => approveRequest(r.id)}
                        style={{
                          padding: "0.35rem 0.6rem",
                          borderRadius: 8,
                          border: "1px solid #2f7a2f",
                          opacity: queueBusy ? 0.7 : 1,
                          cursor: queueBusy ? "wait" : "pointer",
                        }}
                      >
                        Akceptuj
                      </button>
                      <button
                        type="button"
                        disabled={queueBusy}
                        onClick={() => rejectRequest(r.id)}
                        style={{
                          padding: "0.35rem 0.6rem",
                          borderRadius: 8,
                          border: "1px solid #7a2f2f",
                          opacity: queueBusy ? 0.7 : 1,
                          cursor: queueBusy ? "wait" : "pointer",
                        }}
                      >
                        Odrzuć
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <hr />
        </>
      )}

      {/* =========================
          EDYCJA NAZW (PANEL)
         ========================= */}
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
                  // po manualnej zmianie nazwy odśwież kolejkę (czasem ta sama prośba przestaje mieć sens)
                  if (canManageQueue) await loadPendingQueue();
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
