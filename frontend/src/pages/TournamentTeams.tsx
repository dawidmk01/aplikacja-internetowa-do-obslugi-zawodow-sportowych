// frontend/src/pages/TournamentTeams.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { apiFetch } from "../api";

import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";

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
  matches_started?: boolean;
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

type ToastKind = "success" | "error" | "info";
function useToast() {
  const [toast, setToast] = useState<{ kind: ToastKind; text: string } | null>(null);
  const tRef = useRef<number | null>(null);

  const show = (kind: ToastKind, text: string) => {
    setToast({ kind, text });
    if (tRef.current) window.clearTimeout(tRef.current);
    tRef.current = window.setTimeout(() => setToast(null), 2200);
  };

  const clear = () => {
    if (tRef.current) window.clearTimeout(tRef.current);
    setToast(null);
  };

  return { toast, show, clear };
}

export default function TournamentTeams() {
  const { id } = useParams<{ id: string }>();

  const { toast, show: showToast, clear: clearToast } = useToast();

  const [tournament, setTournament] = useState<TournamentDTO | null>(null);
  const tournamentRef = useRef<TournamentDTO | null>(null);

  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // kolejka
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueBusy, setQueueBusy] = useState(false);
  const [pendingRequests, setPendingRequests] = useState<NameChangeRequestItem[]>([]);

  // roster UI
  const [rosterOpen, setRosterOpen] = useState(true);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [playersLoading, setPlayersLoading] = useState(false);
  const [playersBusy, setPlayersBusy] = useState(false);
  const [players, setPlayers] = useState<PlayerRow[]>([{ display_name: "", jersey_number: null }]);
  const [playersDirty, setPlayersDirty] = useState(false);

  // participant shortcut
  const [participantMode, setParticipantMode] = useState(false);

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
      showToast("error", "Brak uprawnień do obsługi kolejki zmian nazw.");
      return;
    }

    setQueueBusy(true);
    try {
      const res = await apiFetch(`/api/tournaments/${id}/teams/name-change-requests/${requestId}/approve/`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail || "Nie udało się zaakceptować prośby.");
      }

      await loadPendingQueue();
      await loadTeams().catch(() => null);
      showToast("success", "Prośba zaakceptowana.");
    } catch (e: any) {
      showToast("error", e?.message || "Błąd akceptacji prośby.");
    } finally {
      setQueueBusy(false);
    }
  };

  const rejectRequest = async (requestId: number) => {
    if (!id) return;

    if (!canViewOrApproveQueue()) {
      showToast("error", "Brak uprawnień do obsługi kolejki zmian nazw.");
      return;
    }

    setQueueBusy(true);
    try {
      const res = await apiFetch(`/api/tournaments/${id}/teams/name-change-requests/${requestId}/reject/`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail || "Nie udało się odrzucić prośby.");
      }

      await loadPendingQueue();
      showToast("success", "Prośba odrzucona.");
    } catch (e: any) {
      showToast("error", e?.message || "Błąd odrzucenia prośby.");
    } finally {
      setQueueBusy(false);
    }
  };

  // ===== role/perms =====
  const myRole: MyRole = tournament?.my_role ?? null;
  const myPerms: MyPermissions | null = (tournament?.my_permissions as MyPermissions | undefined) ?? null;

  const isOrganizer = myRole === "ORGANIZER";
  const isAssistant = myRole === "ASSISTANT";
  const isParticipant = !isOrganizer && !isAssistant;

  const canEditTeams = isOrganizer || (isAssistant && Boolean(myPerms?.teams_edit));
  const canEditRosterAsManager = isOrganizer || (isAssistant && Boolean(myPerms?.roster_edit));
  const canManageQueue = isOrganizer || (isAssistant && Boolean(myPerms?.name_change_approve));

  const matchesStarted = Boolean(tournament?.matches_started);
  const canChangeTeamsCount = isOrganizer || (isAssistant && Boolean(myPerms?.tournament_edit) && !matchesStarted);

  const formatLabel =
    tournament?.tournament_format === "LEAGUE"
      ? "Liga"
      : tournament?.tournament_format === "CUP"
        ? "Puchar"
        : "Grupy + puchar";

  // ===== roster helpers =====
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

    const canManager = role === "ORGANIZER" || (role === "ASSISTANT" && Boolean(perms?.roster_edit));
    if (canManager) {
      return { endpoint: `/api/tournaments/${id}/teams/${teamId}/players/`, mode: "MANAGER" };
    }
    return { endpoint: `/api/tournaments/${id}/my-team/players/`, mode: "PARTICIPANT" };
  };

  const loadTeamPlayers = async (teamId: number) => {
    if (!id) return;

    const t = tournamentRef.current;
    const { role, perms } = getRoleAndPerms(t);
    if (role === "ASSISTANT" && !Boolean(perms?.roster_edit)) {
      showToast("error", "Brak uprawnień do edycji składów (roster_edit = false).");
      return;
    }

    setPlayersLoading(true);
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

      if (mode === "PARTICIPANT") {
        setParticipantMode(true);
        setSelectedTeamId(data.team_id ?? null);
      } else {
        setParticipantMode(false);
      }
    } catch (e: any) {
      setPlayers([{ display_name: "", jersey_number: null }]);
      setPlayersDirty(false);
      showToast("error", e?.message || "Błąd pobierania składu.");
    } finally {
      setPlayersLoading(false);
    }
  };

  const saveTeamPlayers = async (teamId: number) => {
    if (!id) return;

    const t = tournamentRef.current;
    const { role, perms } = getRoleAndPerms(t);
    if (role === "ASSISTANT" && !Boolean(perms?.roster_edit)) {
      showToast("error", "Brak uprawnień do edycji składów (roster_edit = false).");
      return;
    }

    setPlayersBusy(true);
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

      await loadTeams().catch(() => null);
      showToast("success", "Skład zapisany.");
    } catch (e: any) {
      showToast("error", e?.message || "Błąd zapisu składu.");
    } finally {
      setPlayersBusy(false);
    }
  };

  const revertTeamPlayers = async () => {
    if (!selectedTeamId) return;
    await loadTeamPlayers(selectedTeamId);
    showToast("info", "Przywrócono dane z serwera.");
  };

  // ===== init =====
  useEffect(() => {
    if (!id) return;

    let mounted = true;

    const init = async () => {
      try {
        clearToast();
        setLoading(true);

        const t = await loadTournament();
        const list = await loadTeams();

        const { role, perms } = getRoleAndPerms(t);

        const allowQueue = role === "ORGANIZER" || (role === "ASSISTANT" && Boolean(perms?.name_change_approve));
        if (mounted && allowQueue) await loadPendingQueue();
        if (mounted && !allowQueue) setPendingRequests([]);

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
        if (mounted) showToast("error", e?.message || "Błąd ładowania danych.");
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
        if (!myPerms?.tournament_edit) showToast("error", "Brak uprawnień: asystent nie ma tournament_edit.");
        else if (matchesStarted) showToast("error", "Asystent nie może zmieniać liczby uczestników po starcie.");
      } else {
        showToast("error", "Brak uprawnień.");
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
          "Nazwy drużyn pozostaną (część może zostać dezaktywowana przy zmniejszeniu liczby).",
          "",
          "Kontynuować?",
        ].join("\n")
      );
    }

    return window.confirm("Zmiana liczby uczestników spowoduje reset rozgrywek (etapy i mecze).\nKontynuować?");
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

      const resp = await setupTeams(next);
      showToast("success", resp.detail || "Zmieniono liczbę uczestników.");

      if (canManageQueue) await loadPendingQueue();

      const { role, perms } = getRoleAndPerms(resp.tournament);
      const allowManagerRoster = role === "ORGANIZER" || (role === "ASSISTANT" && Boolean(perms?.roster_edit));

      if (hasRosterFeature(resp.tournament) && allowManagerRoster) {
        const ids = new Set(resp.teams.map((t) => t.id));
        const nextSelected =
          selectedTeamId && ids.has(selectedTeamId) ? selectedTeamId : resp.teams?.[0]?.id ?? null;
        setSelectedTeamId(nextSelected);
        if (nextSelected) await loadTeamPlayers(nextSelected);
      }
    } catch (e: any) {
      showToast("error", e?.message || "Nie udało się zmienić liczby uczestników.");
    } finally {
      setBusy(false);
      inFlightRef.current = false;
    }
  };

  // ===== team name edit =====
  const updateTeamName = async (teamId: number, name: string) => {
    if (!canEditTeams) throw new Error("Brak uprawnień do edycji nazw (teams_edit = false).");

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

  if (loading) return <div className="px-4 py-8 text-slate-200/80">Ładowanie…</div>;
  if (!tournament) return <div className="px-4 py-8 text-rose-300">Brak danych turnieju.</div>;

  const titleLabel = tournament?.competition_type === "INDIVIDUAL" ? "Zawodnicy" : "Drużyny";

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      {/* TOAST */}
      {toast && (
        <div
          className={[
            "fixed bottom-6 right-6 z-[60] w-[min(420px,calc(100vw-2rem))]",
            "rounded-2xl border border-white/10 bg-slate-950/90 backdrop-blur",
            "px-4 py-3 shadow-[0_20px_80px_rgba(0,0,0,0.55)]",
          ].join(" ")}
          role="status"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="text-sm text-slate-100">
              <span
                className={[
                  "mr-2 inline-block h-2 w-2 rounded-full align-middle",
                  toast.kind === "success"
                    ? "bg-emerald-400"
                    : toast.kind === "error"
                      ? "bg-rose-400"
                      : "bg-sky-400",
                ].join(" ")}
              />
              {toast.text}
            </div>
            <button
              type="button"
              onClick={clearToast}
              className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-100 hover:bg-white/10"
              aria-label="Zamknij"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* HEADER */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Uczestnicy</h1>
          <div className="mt-1 text-sm text-slate-200/70">
            Turniej: <span className="text-slate-100">{tournament.name}</span> • Format:{" "}
            <span className="text-slate-100">{formatLabel}</span> • Status:{" "}
            <span className="text-slate-100">{tournament.status}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={async () => {
              try {
                setBusy(true);
                await loadTournament();
                await loadTeams();
                if (canManageQueue) await loadPendingQueue();
                showToast("success", "Odświeżono dane.");
              } catch {
                showToast("error", "Nie udało się odświeżyć danych.");
              } finally {
                setBusy(false);
              }
            }}
          >
            Odśwież
          </Button>
        </div>
      </div>

      {/* WARNINGS */}
      {isAssistant && !myPerms && (
        <Card className="mb-4 p-4">
          <div className="text-sm text-amber-200/90">
            Uwaga: backend nie zwrócił <code className="text-amber-100">my_permissions</code>. UI traktuje uprawnienia
            asystenta jako wyłączone.
          </div>
        </Card>
      )}

      {isAssistant && matchesStarted && (
        <Card className="mb-4 p-4">
          <div className="text-sm text-rose-200/90">
            Turniej już się rozpoczął — zmiana liczby uczestników jest zablokowana dla asystenta.
          </div>
        </Card>
      )}

      {isOrganizer && matchesStarted && (
        <Card className="mb-4 p-4">
          <div className="text-sm text-amber-200/90">
            Turniej jest rozpoczęty. Zmiana liczby uczestników spowoduje pełny reset (mecze, wyniki, harmonogram).
          </div>
        </Card>
      )}

      {!matchesStarted && tournament.status !== "DRAFT" && (
        <Card className="mb-4 p-4">
          <div className="text-sm text-slate-200/80">
            Zmiana nazw jest bezpieczna. Zmiana liczby uczestników (+/−) spowoduje reset rozgrywek.
          </div>
        </Card>
      )}

      {/* TOP: COUNT + QUEUE */}
      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <Card className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-100">Liczba uczestników</div>
              <div className="mt-1 text-xs text-slate-200/60">
                Zmiana może wymagać resetu (zależnie od statusu).
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="secondary" disabled={busy || !canChangeTeamsCount} onClick={() => changeTeamsCount(-1)}>
                −
              </Button>
              <div className="min-w-[2.5rem] text-center text-lg font-semibold text-slate-100">{currentCount}</div>
              <Button variant="secondary" disabled={busy || !canChangeTeamsCount} onClick={() => changeTeamsCount(1)}>
                +
              </Button>
            </div>
          </div>

          {isAssistant && !canChangeTeamsCount && (
            <div className="mt-3 text-xs text-slate-200/60">
              Wymaga <code className="text-slate-100">tournament_edit</code> i braku startu.
            </div>
          )}
        </Card>

        {canManageQueue ? (
          <Card className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-100">Kolejka próśb o zmianę nazwy</div>
                <div className="mt-1 text-xs text-slate-200/60">
                  Oczekuje: <span className="text-slate-100">{pendingRequests.length}</span>
                </div>
              </div>

              <Button
                variant="secondary"
                disabled={queueLoading || queueBusy}
                onClick={() => loadPendingQueue().catch(() => void 0)}
              >
                {queueLoading ? "Ładowanie…" : "Odśwież"}
              </Button>
            </div>

            <div className="mt-3 grid gap-2">
              {pendingRequests.length === 0 && !queueLoading ? (
                <div className="text-sm text-slate-200/60 italic">Brak oczekujących próśb.</div>
              ) : (
                pendingRequests.map((r) => (
                  <div
                    key={r.id}
                    className="rounded-xl border border-white/10 bg-white/[0.04] p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-100">Team #{r.team_id}</div>
                        <div className="mt-1 text-xs text-slate-200/70 break-words">
                          <div>
                            <span className="text-slate-200/50">Było:</span> {r.old_name}
                          </div>
                          <div>
                            <span className="text-slate-200/50">Chce:</span> {r.requested_name}
                          </div>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          variant="secondary"
                          disabled={queueBusy}
                          onClick={() => approveRequest(r.id)}
                        >
                          Akceptuj
                        </Button>
                        <Button
                          variant="danger"
                          disabled={queueBusy}
                          onClick={() => rejectRequest(r.id)}
                        >
                          Odrzuć
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        ) : (
          <Card className="p-4">
            <div className="text-sm text-slate-200/70">
              Kolejka zmian nazw jest niedostępna (brak uprawnień).
            </div>
          </Card>
        )}
      </div>

      {/* ROSTER */}
      {hasRosterFeature(tournament) && (
        <Card className="mt-4 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-100">Składy (zawodnicy)</div>
              <div className="mt-1 text-xs text-slate-200/60">
                {participantMode ? "Tryb uczestnika" : "Tryb organizatora/asystenta"}
              </div>
            </div>
            <Button variant="secondary" onClick={() => setRosterOpen((v) => !v)}>
              {rosterOpen ? "Zwiń" : "Rozwiń"}
            </Button>
          </div>

          {rosterOpen && (
            <div className="mt-4">
              {isAssistant && !canEditRosterAsManager ? (
                <div className="text-sm text-slate-200/70">
                  Brak uprawnień do składów (wymagane: <code className="text-slate-100">roster_edit</code>).
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  {canEditRosterAsManager ? (
                    <>
                      <div className="text-sm text-slate-200/80">Drużyna:</div>
                      <select
                        className="rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/10"
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

                      <Button
                        variant="secondary"
                        disabled={!selectedTeamId || playersBusy || playersLoading}
                        onClick={() => selectedTeamId && loadTeamPlayers(selectedTeamId)}
                      >
                        Odśwież
                      </Button>

                      <Button
                        variant="primary"
                        disabled={!selectedTeamId || playersBusy || playersLoading || !playersDirty}
                        onClick={() => selectedTeamId && saveTeamPlayers(selectedTeamId)}
                      >
                        Zapisz
                      </Button>

                      <Button
                        variant="ghost"
                        disabled={!selectedTeamId || playersBusy || playersLoading || !playersDirty}
                        onClick={() => revertTeamPlayers()}
                      >
                        Cofnij
                      </Button>

                      <div className="ml-auto text-xs text-slate-200/60">
                        {playersLoading ? "Ładowanie…" : playersDirty ? "Niezapisane zmiany" : " "}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-sm text-slate-200/80">Twoja drużyna</div>
                      <Button
                        variant="secondary"
                        disabled={playersBusy || playersLoading}
                        onClick={() => loadTeamPlayers(selectedTeamId ?? 0)}
                      >
                        Odśwież
                      </Button>
                      <Button
                        variant="primary"
                        disabled={playersBusy || playersLoading || !selectedTeamId || !playersDirty}
                        onClick={() => (selectedTeamId ? saveTeamPlayers(selectedTeamId) : null)}
                      >
                        Zapisz
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={playersBusy || playersLoading || !selectedTeamId || !playersDirty}
                        onClick={() => revertTeamPlayers()}
                      >
                        Cofnij
                      </Button>

                      <div className="ml-auto text-xs text-slate-200/60">
                        {playersLoading ? "Ładowanie…" : playersDirty ? "Niezapisane zmiany" : " "}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* editor */}
              {(!isAssistant || canEditRosterAsManager) && (
                <div className="mt-4 grid gap-2">
                  {players.map((p, idx) => (
                    <div
                      key={p.id ?? `new-${idx}`}
                      className="grid items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] p-3 md:grid-cols-[1fr_220px_44px]"
                    >
                      <Input
                        value={p.display_name}
                        disabled={playersBusy || playersLoading}
                        placeholder={`Zawodnik ${idx + 1} — imię i nazwisko`}
                        onChange={(e) => updatePlayerField(idx, { display_name: e.target.value })}
                      />

                      <Input
                        value={p.jersey_number ?? ""}
                        disabled={playersBusy || playersLoading}
                        placeholder="Nr (opcjonalnie)"
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
                      />

                      <Button
                        variant="danger"
                        disabled={playersBusy || playersLoading}
                        onClick={() => removePlayerRow(idx)}
                        title="Usuń wiersz"
                      >
                        −
                      </Button>
                    </div>
                  ))}

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button variant="secondary" disabled={playersBusy || playersLoading} onClick={addPlayerRow}>
                      + Dodaj zawodnika
                    </Button>

                    <div className="text-xs text-slate-200/60">
                      {participantMode
                        ? "Uwaga: zapis może być zablokowany, jeśli organizator wyłączył edycję składu przez właściciela drużyny."
                        : "Skład zapisujesz osobno dla każdej drużyny."}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {/* TEAMS LIST */}
      <Card className="mt-4 p-4">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-100">{titleLabel}</div>
            {!canEditTeams && (isOrganizer || isAssistant) && (
              <div className="mt-1 text-xs text-slate-200/60">
                Edycja nazw zablokowana (wymagane: <code className="text-slate-100">teams_edit</code>).
              </div>
            )}
          </div>
        </div>

        {teams.length === 0 && !busy ? (
          <div className="text-sm text-slate-200/60 italic">
            Brak aktywnych uczestników — ustaw liczbę miejsc (+), aby utworzyć listę.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {teams.map((team) => (
              <div key={team.id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                <Input
                  value={team.name}
                  disabled={busy || !canEditTeams}
                  onChange={(e) =>
                    setTeams((prev) => prev.map((t) => (t.id === team.id ? { ...t, name: e.target.value } : t)))
                  }
                  onBlur={async (e) => {
                    if (!canEditTeams) return;
                    try {
                      await updateTeamName(team.id, e.target.value);
                      if (canManageQueue) await loadPendingQueue();
                      showToast("success", "Nazwa zapisana.");
                    } catch (err: any) {
                      showToast("error", err?.message || "Nie udało się zapisać nazwy.");
                      await loadTeams().catch(() => null);
                    }
                  }}
                />

                {typeof team.players_count === "number" && hasRosterFeature(tournament) && (
                  <div className="mt-2 text-xs text-slate-200/60">Skład: {team.players_count}</div>
                )}

                {canEditRosterAsManager && hasRosterFeature(tournament) && (
                  <div className="mt-3">
                    <Button
                      variant="secondary"
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
                    >
                      Edytuj skład
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
