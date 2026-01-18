// frontend/src/pages/TournamentTeams.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { apiFetch } from "../api";

type Team = { id: number; name: string; players_count?: number };

type TournamentFormat = "LEAGUE" | "CUP" | "MIXED";
type TournamentStatus = "DRAFT" | "CONFIGURED" | "RUNNING" | "FINISHED";
type MyRole = "ORGANIZER" | "ASSISTANT" | null;

type MyPermissions = {
  teams_edit: boolean;
  schedule_edit: boolean;
  results_edit: boolean;
  bracket_edit: boolean;
  tournament_edit: boolean;

  roster_edit: boolean;
  name_change_approve: boolean;

  // organizer-only informacyjnie (mogą przyjść z backendu)
  publish?: boolean;
  archive?: boolean;
  manage_assistants?: boolean;
  join_settings?: boolean;
};

type TournamentDTO = {
  id: number;
  name: string;
  tournament_format: TournamentFormat;
  format_config?: Record<string, any>;
  status: TournamentStatus;
  competition_type?: "INDIVIDUAL" | "TEAM";
  my_role?: MyRole;
  my_permissions?: MyPermissions;
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

type PlayerRow = {
  id?: number;
  display_name: string;
  jersey_number?: number | null;
};

type TeamPlayersResponse = {
  team_id: number;
  count: number;
  results: Array<{
    id: number;
    team_id: number;
    display_name: string;
    jersey_number: number | null;
    is_active: boolean;
    created_at: string;
    updated_at: string;
  }>;
};

function normName(s: string): string {
  return (s || "").trim().replace(/\s+/g, " ");
}

function hasRosterFeature(tournament: TournamentDTO | null): boolean {
  return (tournament?.competition_type ?? "TEAM") === "TEAM";
}

function getRoleAndPerms(t: TournamentDTO | null): { role: MyRole; perms: MyPermissions | null } {
  const role: MyRole = t?.my_role ?? null;
  const perms = (t?.my_permissions as MyPermissions | undefined) ?? null;
  return { role, perms };
}

export default function TournamentTeams() {
  const { id } = useParams<{ id: string }>();

  const [tournament, setTournament] = useState<TournamentDTO | null>(null);
  const tournamentRef = useRef<TournamentDTO | null>(null);

  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // kolejka
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueBusy, setQueueBusy] = useState(false);
  const [pendingRequests, setPendingRequests] = useState<NameChangeRequestItem[]>([]);

  // roster UI
  const [rosterOpen, setRosterOpen] = useState(true);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [playersLoading, setPlayersLoading] = useState(false);
  const [playersBusy, setPlayersBusy] = useState(false);
  const [playersMessage, setPlayersMessage] = useState<string | null>(null);
  const [players, setPlayers] = useState<PlayerRow[]>([{ display_name: "", jersey_number: null }]);
  const [playersDirty, setPlayersDirty] = useState(false);

  // participant shortcut
  const [participantMode, setParticipantMode] = useState(false); // używamy /my-team/players/

  const inFlightRef = useRef(false);

  const loadTournament = async (): Promise<TournamentDTO> => {
    const res = await apiFetch(`/api/tournaments/${id}/`);
    if (!res.ok) throw new Error("Nie udało się pobrać turnieju.");
    const data: TournamentDTO = await res.json();
    setTournament(data);
    tournamentRef.current = data;
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
    tournamentRef.current = data.tournament;
    setTeams(data.teams);
    return data;
  };

  // ===== kolejka (name-change requests) =====

  const canViewOrApproveQueue = (): boolean => {
    const t = tournamentRef.current;
    const { role, perms } = getRoleAndPerms(t);
    if (role === "ORGANIZER") return true;
    if (role === "ASSISTANT") return Boolean(perms?.name_change_approve);
    return false;
  };

  const loadPendingQueue = async () => {
    if (!id) return;

    if (!canViewOrApproveQueue()) {
      setPendingRequests([]);
      return;
    }

    setQueueLoading(true);
    try {
      const res = await apiFetch(`/api/tournaments/${id}/teams/name-change-requests/`);
      if (!res.ok) {
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

    if (!canViewOrApproveQueue()) {
      setMessage("Brak uprawnień do obsługi kolejki zmian nazw.");
      return;
    }

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

    if (!canViewOrApproveQueue()) {
      setMessage("Brak uprawnień do obsługi kolejki zmian nazw.");
      return;
    }

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

  // ===== role/perms (render + blokady) =====

  const myRole: MyRole = tournament?.my_role ?? null;
  const myPerms: MyPermissions | null = (tournament?.my_permissions as MyPermissions | undefined) ?? null;

  const isOrganizer = myRole === "ORGANIZER";
  const isAssistant = myRole === "ASSISTANT";
  const isParticipant = !isOrganizer && !isAssistant;

  // PUSTY SYSTEM: brak fallbacków. Roster i kolejka mają OSOBNE flagi.
  const canEditTeams = isOrganizer || (isAssistant && Boolean(myPerms?.teams_edit));
  const canEditRosterAsManager = isOrganizer || (isAssistant && Boolean(myPerms?.roster_edit));
  const canManageQueue = isOrganizer || (isAssistant && Boolean(myPerms?.name_change_approve));

  // zmiana count to realnie "ustawienia turnieju" – wymagamy tournament_edit
  const matchesStarted = Boolean(tournament?.matches_started);
  const canChangeTeamsCount = isOrganizer || (isAssistant && Boolean(myPerms?.tournament_edit) && !matchesStarted);

  const formatLabel =
    tournament?.tournament_format === "LEAGUE"
      ? "Liga"
      : tournament?.tournament_format === "CUP"
        ? "Puchar"
        : "Grupy + puchar";

  // ===== roster API helpers =====

  const ensureRosterStateForEmpty = (rows: PlayerRow[]): PlayerRow[] => {
    const cleaned = rows.filter((r) => normName(r.display_name).length > 0);
    if (cleaned.length === 0) return [{ display_name: "", jersey_number: null }];
    return cleaned;
  };

  const mapApiPlayersToRows = (data: TeamPlayersResponse): PlayerRow[] => {
    const rows: PlayerRow[] = (data?.results || []).map((p) => ({
      id: p.id,
      display_name: p.display_name ?? "",
      jersey_number: p.jersey_number ?? null,
    }));
    return ensureRosterStateForEmpty(rows);
  };

  const getRosterEndpoint = (teamId: number): { endpoint: string; mode: "MANAGER" | "PARTICIPANT" } => {
    const t = tournamentRef.current;
    const { role, perms } = getRoleAndPerms(t);

    const canManager =
      role === "ORGANIZER" || (role === "ASSISTANT" && Boolean(perms?.roster_edit));

    if (canManager) {
      return { endpoint: `/api/tournaments/${id}/teams/${teamId}/players/`, mode: "MANAGER" };
    }
    return { endpoint: `/api/tournaments/${id}/my-team/players/`, mode: "PARTICIPANT" };
  };

  const loadTeamPlayers = async (teamId: number) => {
    if (!id) return;

    // twarda blokada dla asystenta bez roster_edit (żadnych fallbacków)
    const t = tournamentRef.current;
    const { role, perms } = getRoleAndPerms(t);
    if (role === "ASSISTANT" && !Boolean(perms?.roster_edit)) {
      setPlayersMessage("Brak uprawnień do edycji składów (roster_edit = false).");
      return;
    }

    setPlayersLoading(true);
    setPlayersMessage(null);
    try {
      const { endpoint, mode } = getRosterEndpoint(teamId);

      const res = await apiFetch(endpoint);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail || "Nie udało się pobrać składu.");
      }
      const data: TeamPlayersResponse = await res.json();

      setPlayers(mapApiPlayersToRows(data));
      setPlayersDirty(false);
      setPlayersMessage(null);

      if (mode === "PARTICIPANT") {
        setParticipantMode(true);
        setSelectedTeamId(data.team_id ?? null);
      } else {
        setParticipantMode(false);
      }
    } catch (e: any) {
      setPlayers([{ display_name: "", jersey_number: null }]);
      setPlayersDirty(false);
      setPlayersMessage(e?.message || "Błąd pobierania składu.");
    } finally {
      setPlayersLoading(false);
    }
  };

  const saveTeamPlayers = async (teamId: number) => {
    if (!id) return;

    // twarda blokada dla asystenta bez roster_edit (żadnych fallbacków)
    const t = tournamentRef.current;
    const { role, perms } = getRoleAndPerms(t);
    if (role === "ASSISTANT" && !Boolean(perms?.roster_edit)) {
      setPlayersMessage("Brak uprawnień do edycji składów (roster_edit = false).");
      return;
    }

    setPlayersBusy(true);
    setPlayersMessage(null);
    try {
      const { endpoint } = getRosterEndpoint(teamId);

      const payloadPlayers = players
        .map((r) => ({
          id: r.id,
          display_name: normName(r.display_name),
          jersey_number: r.jersey_number ?? null,
        }))
        .filter((r) => r.display_name.length > 0);

      const res = await apiFetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ players: payloadPlayers }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail || "Nie udało się zapisać składu.");
      }

      const data: TeamPlayersResponse = await res.json();
      setPlayers(mapApiPlayersToRows(data));
      setPlayersDirty(false);
      setPlayersMessage("Skład zapisany.");

      await loadTeams().catch(() => null);
    } catch (e: any) {
      setPlayersMessage(e?.message || "Błąd zapisu składu.");
    } finally {
      setPlayersBusy(false);
    }
  };

  const revertTeamPlayers = async () => {
    if (!selectedTeamId) return;
    await loadTeamPlayers(selectedTeamId);
  };

  // ===== init =====

  useEffect(() => {
    if (!id) return;

    let mounted = true;

    const init = async () => {
      try {
        setMessage(null);
        setLoading(true);

        const t = await loadTournament();
        const list = await loadTeams();

        const { role, perms } = getRoleAndPerms(t);

        // kolejka tylko gdy organizer lub (assistant + name_change_approve)
        const allowQueue = role === "ORGANIZER" || (role === "ASSISTANT" && Boolean(perms?.name_change_approve));
        if (mounted && allowQueue) {
          await loadPendingQueue();
        } else {
          setPendingRequests([]);
        }

        // roster:
        // - manager view: organizer lub (assistant + roster_edit) -> domyślnie 1. drużyna
        // - participant view: /my-team/players/
        if (mounted && hasRosterFeature(t)) {
          const allowManagerRoster = role === "ORGANIZER" || (role === "ASSISTANT" && Boolean(perms?.roster_edit));

          if (allowManagerRoster) {
            const first = list?.[0]?.id ?? null;
            setSelectedTeamId(first);
            setParticipantMode(false);
            if (first) await loadTeamPlayers(first);
          } else {
            setSelectedTeamId(null);
            setParticipantMode(true);
            await loadTeamPlayers(0).catch(() => null);
          }
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

  // ===== teams count =====

  const currentCount = useMemo(() => Math.max(2, teams.length), [teams.length]);

  const confirmChangeCount = (): boolean => {
    if (!canChangeTeamsCount) {
      if (isAssistant) {
        if (!myPerms?.tournament_edit) {
          setMessage("Brak uprawnień: asystent nie ma tournament_edit.");
          return false;
        }
        if (matchesStarted) {
          setMessage("Asystent nie może zmieniać liczby uczestników po rozpoczęciu turnieju.");
          return false;
        }
      }
      if (isParticipant) {
        setMessage("Brak uprawnień.");
        return false;
      }
      return false;
    }

    if (tournament?.status === "DRAFT" && !matchesStarted) return true;

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
    if (!canChangeTeamsCount) return;

    const next = currentCount + delta;
    if (next < 2) return;

    if (!confirmChangeCount()) return;

    try {
      inFlightRef.current = true;
      setBusy(true);
      setMessage(null);

      const resp = await setupTeams(next);
      setMessage(resp.detail || "Zmieniono liczbę uczestników.");

      if (canManageQueue) await loadPendingQueue();

      // roster: jeśli manager i selectedTeamId już nie istnieje (np. zmniejszenie),
      // przestaw na pierwszą aktywną drużynę
      const { role, perms } = getRoleAndPerms(resp.tournament);
      const allowManagerRoster =
        role === "ORGANIZER" || (role === "ASSISTANT" && Boolean(perms?.roster_edit));

      if (hasRosterFeature(resp.tournament) && allowManagerRoster) {
        const ids = new Set(resp.teams.map((t) => t.id));
        const nextSelected =
          selectedTeamId && ids.has(selectedTeamId) ? selectedTeamId : resp.teams?.[0]?.id ?? null;
        setSelectedTeamId(nextSelected);
        if (nextSelected) await loadTeamPlayers(nextSelected);
      }
    } catch (e: any) {
      setMessage(e.message || "Nie udało się zmienić liczby uczestników.");
    } finally {
      setBusy(false);
      inFlightRef.current = false;
    }
  };

  // ===== team name edit =====

  const updateTeamName = async (teamId: number, name: string) => {
    if (!canEditTeams) {
      throw new Error("Brak uprawnień do edycji nazw (teams_edit = false).");
    }

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

  // ===== UI helpers =====

  const busyButtonStyle: React.CSSProperties = {
    opacity: busy ? 0.6 : 1,
    cursor: busy ? "wait" : "pointer",
  };

  const rosterButtonStyle: React.CSSProperties = {
    opacity: playersBusy || playersLoading ? 0.7 : 1,
    cursor: playersBusy || playersLoading ? "wait" : "pointer",
  };

  const addPlayerRow = () => {
    setPlayersDirty(true);
    setPlayers((prev) => [...prev, { display_name: "", jersey_number: null }]);
  };

  const removePlayerRow = (idx: number) => {
    setPlayersDirty(true);
    setPlayers((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      return next.length === 0 ? [{ display_name: "", jersey_number: null }] : next;
    });
  };

  const updatePlayerField = (idx: number, patch: Partial<PlayerRow>) => {
    setPlayersDirty(true);
    setPlayers((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  };

  // ===== render =====

  if (loading) return <p>Ładowanie…</p>;
  if (!tournament) return null;

  return (
    <div style={{ padding: "2rem", maxWidth: 980, minHeight: "100vh" }}>
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

      {isAssistant && !myPerms && (
        <div
          style={{
            border: "1px solid #7a6a2a",
            padding: "0.75rem",
            marginBottom: "1rem",
            borderRadius: 8,
          }}
        >
          Uwaga: backend nie zwrócił <code>my_permissions</code>. Dla bezpieczeństwa UI traktuje uprawnienia asystenta jako
          wyłączone.
        </div>
      )}

      {isAssistant && matchesStarted && (
        <div
          style={{
            border: "1px solid #6a3b3b",
            padding: "0.75rem",
            marginBottom: "1rem",
            borderRadius: 8,
          }}
        >
          Turniej już się rozpoczął — zmiana liczby uczestników jest zablokowana dla asystenta.
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
          disabled={busy || !canChangeTeamsCount}
          style={busyButtonStyle}
        >
          −
        </button>
        <span>{currentCount}</span>
        <button
          type="button"
          onClick={() => changeTeamsCount(1)}
          disabled={busy || !canChangeTeamsCount}
          style={busyButtonStyle}
        >
          +
        </button>

        {isAssistant && !canChangeTeamsCount && (
          <span style={{ opacity: 0.8 }}>
            (wymaga <code>tournament_edit</code> i braku startu)
          </span>
        )}
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
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>Team #{r.team_id}</div>
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
          ROSTER (PLAYERS) — DLA DRUŻYN
         ========================= */}
      {hasRosterFeature(tournament) && (
        <>
          <section style={{ margin: "1rem 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "space-between" }}>
              <h2 style={{ margin: 0 }}>Składy (zawodnicy)</h2>
              <button
                type="button"
                onClick={() => setRosterOpen((v) => !v)}
                style={{ padding: "0.35rem 0.6rem", borderRadius: 8, border: "1px solid #444" }}
              >
                {rosterOpen ? "Zwiń" : "Rozwiń"}
              </button>
            </div>

            {rosterOpen && (
              <div
                style={{
                  marginTop: 10,
                  border: "1px solid #333",
                  borderRadius: 12,
                  padding: "0.9rem",
                }}
              >
                {/* Asystent bez roster_edit: informacja i brak panelu */}
                {isAssistant && !canEditRosterAsManager ? (
                  <div style={{ opacity: 0.85 }}>
                    Brak uprawnień do składów (wymagane: <code>roster_edit</code>).
                  </div>
                ) : canEditRosterAsManager ? (
                  <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <strong>Wybierz drużynę:</strong>
                      <select
                        value={selectedTeamId ?? ""}
                        onChange={async (e) => {
                          const nextId = Number(e.target.value || 0);
                          if (!nextId) return;
                          if (playersDirty) {
                            const ok = window.confirm(
                              "Masz niezapisane zmiany w składzie. Przełączyć drużynę i porzucić zmiany?"
                            );
                            if (!ok) return;
                          }
                          setSelectedTeamId(nextId);
                          await loadTeamPlayers(nextId);
                        }}
                        disabled={playersBusy || playersLoading}
                      >
                        {teams.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <button
                      type="button"
                      onClick={() => selectedTeamId && loadTeamPlayers(selectedTeamId)}
                      disabled={!selectedTeamId || playersBusy || playersLoading}
                      style={rosterButtonStyle}
                    >
                      Odśwież skład
                    </button>

                    <button
                      type="button"
                      onClick={() => selectedTeamId && saveTeamPlayers(selectedTeamId)}
                      disabled={!selectedTeamId || playersBusy || playersLoading || !playersDirty}
                      style={rosterButtonStyle}
                    >
                      Zapisz
                    </button>

                    <button
                      type="button"
                      onClick={() => revertTeamPlayers()}
                      disabled={!selectedTeamId || playersBusy || playersLoading || !playersDirty}
                      style={rosterButtonStyle}
                    >
                      Cofnij
                    </button>

                    <span style={{ opacity: 0.8 }}>
                      {playersLoading ? "Ładowanie…" : playersDirty ? "Niezapisane zmiany" : " "}
                    </span>
                  </div>
                ) : (
                  // participant
                  <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                    <strong>Twoja drużyna</strong>
                    <button
                      type="button"
                      onClick={() => loadTeamPlayers(selectedTeamId ?? 0)}
                      disabled={playersBusy || playersLoading}
                      style={rosterButtonStyle}
                    >
                      Odśwież skład
                    </button>
                    <button
                      type="button"
                      onClick={() => (selectedTeamId ? saveTeamPlayers(selectedTeamId) : null)}
                      disabled={playersBusy || playersLoading || !selectedTeamId || !playersDirty}
                      style={rosterButtonStyle}
                    >
                      Zapisz
                    </button>
                    <button
                      type="button"
                      onClick={() => revertTeamPlayers()}
                      disabled={playersBusy || playersLoading || !selectedTeamId || !playersDirty}
                      style={rosterButtonStyle}
                    >
                      Cofnij
                    </button>
                    <span style={{ opacity: 0.8 }}>
                      {playersLoading ? "Ładowanie…" : playersDirty ? "Niezapisane zmiany" : " "}
                    </span>
                  </div>
                )}

                {/* Panel edycji roster - pokazujemy gdy organizer/asystent(roster_edit) lub participant */}
                {(!isAssistant || canEditRosterAsManager) && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ display: "grid", gap: 8 }}>
                      {players.map((p, idx) => (
                        <div
                          key={p.id ?? `new-${idx}`}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "120px 1fr 160px 46px",
                            gap: 8,
                            alignItems: "center",
                          }}
                        >
                          <div style={{ opacity: 0.8 }}>Zawodnik {idx + 1}</div>

                          <input
                            value={p.display_name}
                            disabled={playersBusy || playersLoading}
                            placeholder="Imię i nazwisko"
                            onChange={(e) => updatePlayerField(idx, { display_name: e.target.value })}
                            style={{ padding: "0.45rem 0.6rem", borderRadius: 8, border: "1px solid #444" }}
                          />

                          <input
                            value={p.jersey_number ?? ""}
                            disabled={playersBusy || playersLoading}
                            placeholder="Nr koszulki (opcjonalnie)"
                            onChange={(e) => {
                              const raw = e.target.value;
                              if (raw === "") {
                                updatePlayerField(idx, { jersey_number: null });
                                return;
                              }
                              const n = Number(raw);
                              if (Number.isNaN(n)) return;
                              updatePlayerField(idx, { jersey_number: n });
                            }}
                            style={{ padding: "0.45rem 0.6rem", borderRadius: 8, border: "1px solid #444" }}
                          />

                          <button
                            type="button"
                            disabled={playersBusy || playersLoading}
                            onClick={() => removePlayerRow(idx)}
                            title="Usuń wiersz"
                            style={{
                              padding: "0.45rem 0.6rem",
                              borderRadius: 8,
                              border: "1px solid #7a2f2f",
                              opacity: playersBusy || playersLoading ? 0.7 : 1,
                              cursor: playersBusy || playersLoading ? "wait" : "pointer",
                            }}
                          >
                            −
                          </button>
                        </div>
                      ))}
                    </div>

                    <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "center" }}>
                      <button
                        type="button"
                        onClick={addPlayerRow}
                        disabled={playersBusy || playersLoading}
                        style={{
                          padding: "0.45rem 0.75rem",
                          borderRadius: 8,
                          border: "1px solid #2f7a2f",
                          opacity: playersBusy || playersLoading ? 0.7 : 1,
                          cursor: playersBusy || playersLoading ? "wait" : "pointer",
                        }}
                      >
                        + Dodaj zawodnika
                      </button>

                      <span style={{ opacity: 0.75 }}>
                        {participantMode
                          ? "Uwaga: zapis może być zablokowany, jeśli organizator wyłączył edycję składu przez właściciela drużyny."
                          : "Skład zapisujesz osobno dla każdej drużyny."}
                      </span>
                    </div>

                    {playersMessage && <div style={{ marginTop: 10, opacity: 0.9 }}>{playersMessage}</div>}
                  </div>
                )}
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

      {!canEditTeams && (isOrganizer || isAssistant) && (
        <div style={{ opacity: 0.8, marginBottom: 10 }}>
          Edycja nazw jest zablokowana (wymagane: <code>teams_edit</code>).
        </div>
      )}

      {teams.length === 0 && !busy ? (
        <p style={{ opacity: 0.6, fontStyle: "italic" }}>
          Brak aktywnych uczestników — ustaw liczbę miejsc (+) aby utworzyć listę.
        </p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: "0.5rem",
          }}
        >
          {teams.map((team) => (
            <div key={team.id} style={{ display: "grid", gap: 6 }}>
              <input
                value={team.name}
                disabled={busy || !canEditTeams}
                onChange={(e) =>
                  setTeams((prev) =>
                    prev.map((t) => (t.id === team.id ? { ...t, name: e.target.value } : t))
                  )
                }
                onBlur={async (e) => {
                  if (!canEditTeams) return;

                  try {
                    await updateTeamName(team.id, e.target.value);

                    // po manualnej zmianie nazwy odśwież kolejkę (jeśli mamy uprawnienia)
                    if (canManageQueue) await loadPendingQueue();
                  } catch (err: any) {
                    setMessage(err.message);
                    await loadTeams().catch(() => null);
                  }
                }}
                style={{ padding: "0.5rem 0.65rem", borderRadius: 8, border: "1px solid #444" }}
              />

              {typeof team.players_count === "number" && hasRosterFeature(tournament) && (
                <div style={{ fontSize: 12, opacity: 0.75 }}>Skład: {team.players_count}</div>
              )}

              {canEditRosterAsManager && hasRosterFeature(tournament) && (
                <button
                  type="button"
                  disabled={playersBusy || playersLoading}
                  onClick={async () => {
                    if (playersDirty) {
                      const ok = window.confirm(
                        "Masz niezapisane zmiany w składzie. Przełączyć drużynę i porzucić zmiany?"
                      );
                      if (!ok) return;
                    }
                    setSelectedTeamId(team.id);
                    setRosterOpen(true);
                    await loadTeamPlayers(team.id);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  style={{
                    padding: "0.35rem 0.6rem",
                    borderRadius: 8,
                    border: "1px solid #444",
                    opacity: playersBusy || playersLoading ? 0.7 : 1,
                    cursor: playersBusy || playersLoading ? "wait" : "pointer",
                  }}
                >
                  Edytuj skład
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {message && <p style={{ marginTop: "1rem" }}>{message}</p>}
    </div>
  );
}
