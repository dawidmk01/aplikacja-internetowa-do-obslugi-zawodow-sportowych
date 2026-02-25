// src/pages/TournamentTeams.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { ChevronDown, ChevronUp } from "lucide-react";

import { apiFetch } from "../api";

import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Input } from "../ui/Input";
import { Select, type SelectOption } from "../ui/Select";
import { toast } from "../ui/Toast";

import { useAutosave } from "../hooks/useAutosave";
import { AutosaveIndicator } from "../components/AutosaveIndicator";
import ConfirmActionModal from "../components/ConfirmActionModal";

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

function clonePlayers(rows: PlayerRow[]): PlayerRow[] {
  return rows.map((r) => ({ id: r.id, display_name: r.display_name, jersey_number: r.jersey_number ?? null }));
}


type ConfirmDialogState = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: "primary" | "danger";
  resolve: (result: boolean) => void;
};

type ConfirmDialogRequest = Omit<ConfirmDialogState, "resolve">;

export default function TournamentTeams() {
  const { id } = useParams<{ id: string }>();

  const [tournament, setTournament] = useState<TournamentDTO | null>(null);
  const tournamentRef = useRef<TournamentDTO | null>(null);

  const [teams, setTeams] = useState<Team[]>([]);

  const teamOptions = useMemo<SelectOption<number>[]>(
    () => teams.map((t) => ({ value: t.id, label: t.name })),
    [teams]
  );

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
  const [players, setPlayers] = useState<PlayerRow[]>([{ display_name: "", jersey_number: null }]);
  const [playersDirty, setPlayersDirty] = useState(false);

  // participant shortcut
  const [participantMode, setParticipantMode] = useState(false);

  const inFlightRef = useRef(false);


  // ===== potwierdzenia (modal zamiast window.confirm) =====
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);

  const requestConfirm = (req: ConfirmDialogRequest) =>
    new Promise<boolean>((resolve) => setConfirmDialog({ ...req, resolve }));

  const resolveConfirm = (result: boolean) => {
    const resolver = confirmDialog?.resolve;
    setConfirmDialog(null);
    resolver?.(result);
  };

  // ===== podgląd składu w kartach drużyn =====
  const [expandedTeams, setExpandedTeams] = useState<Record<number, boolean>>({});
  const [teamPlayersPreview, setTeamPlayersPreview] = useState<Record<number, TeamPlayersResponse | null>>({});
  const [teamPlayersPreviewLoading, setTeamPlayersPreviewLoading] = useState<Record<number, boolean>>({});

  const canEditRosterAsManagerRef = useRef<boolean>(false);

  // ===== undo (Cofnij) per drużyna =====
  const undoStacksRef = useRef<Record<number, PlayerRow[][]>>({});

  const getActiveTeamId = (): number => {
    return selectedTeamId ?? 0;
  };

  const pushUndoSnapshot = (teamId: number, snapshot: PlayerRow[]) => {
    if (!teamId) return;
    const stacks = undoStacksRef.current;
    const stack = stacks[teamId] ?? [];
    stack.push(clonePlayers(snapshot));
    if (stack.length > 30) stack.shift();
    stacks[teamId] = stack;
  };

  const popUndoSnapshot = (teamId: number): PlayerRow[] | null => {
    const stack = undoStacksRef.current[teamId] ?? [];
    const snap = stack.pop() ?? null;
    undoStacksRef.current[teamId] = stack;
    return snap;
  };

  const clearUndoStack = (teamId: number) => {
    if (!teamId) return;
    undoStacksRef.current[teamId] = [];
  };

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

  // ===== autosave: nazwy drużyn =====
  const teamNameAutosave = useAutosave<{ name: string }>({
    onSave: async (teamId, data) => {
      const name = normName(data.name);
      if (!name) throw new Error("Nazwa nie może być pusta.");

      const res = await apiFetch(`/api/tournaments/${id}/teams/${teamId}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        toastOnError: false,
        body: JSON.stringify({ name }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.detail || "Nie udało się zapisać nazwy.");
      }

      setTeams((prev) => prev.map((t) => (t.id === teamId ? { ...t, name } : t)));
    },
  });

  // ===== autosave: skład (na całej stronie) =====
  const rosterAutosave = useAutosave<{ teamId: number; players: PlayerRow[] }>({
    onSave: async (_key, payload) => {
      const teamId = payload.teamId;

      const { role, perms } = getRoleAndPerms(tournamentRef.current);
      if (role === "ASSISTANT" && !Boolean(perms?.roster_edit)) {
        throw new Error("Brak uprawnień do edycji składów (roster_edit = false).");
      }

      const endpoint = canEditRosterAsManagerRef.current
        ? `/api/tournaments/${id}/teams/${teamId}/players/`
        : `/api/tournaments/${id}/my-team/players/`;

      const payloadPlayers = (payload.players || [])
        .map((r) => ({
          id: r.id,
          display_name: normName(r.display_name),
          jersey_number: r.jersey_number ?? null,
        }))
        .filter((r) => r.display_name.length > 0);

      const res = await apiFetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        toastOnError: false,
        body: JSON.stringify({ players: payloadPlayers }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail || "Nie udało się zapisać składu.");
      }

      const data: TeamPlayersResponse = await res.json();

      setTeams((prev) => prev.map((t) => (t.id === teamId ? { ...t, players_count: data.count } : t)));

      setTeamPlayersPreview((prev) => ({
        ...prev,
        [teamId]: data,
      }));

      const nextRows =
        (data?.results || []).map((p) => ({
          id: p.id,
          display_name: p.display_name ?? "",
          jersey_number: p.jersey_number ?? null,
        })) || [{ display_name: "", jersey_number: null }];

      setPlayers(nextRows);
      setPlayersDirty(false);
    },
  });

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
      toast.error("Brak uprawnień do obsługi kolejki zmian nazw.");
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
    } catch (e: any) {
      toast.error(e?.message || "Błąd akceptacji prośby.");
    } finally {
      setQueueBusy(false);
    }
  };

  const rejectRequest = async (requestId: number) => {
    if (!id) return;

    if (!canViewOrApproveQueue()) {
      toast.error("Brak uprawnień do obsługi kolejki zmian nazw.");
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
    } catch (e: any) {
      toast.error(e?.message || "Błąd odrzucenia prośby.");
    } finally {
      setQueueBusy(false);
    }
  };

  // ===== role/perms =====
  const myRole: MyRole = tournament?.my_role ?? null;
  const myPerms: MyPermissions | null = (tournament?.my_permissions as MyPermissions | undefined) ?? null;

  const isOrganizer = myRole === "ORGANIZER";
  const isAssistant = myRole === "ASSISTANT";

  const canEditTeams = isOrganizer || (isAssistant && Boolean(myPerms?.teams_edit));
  const canEditRosterAsManager = isOrganizer || (isAssistant && Boolean(myPerms?.roster_edit));
  const canManageQueue = isOrganizer || (isAssistant && Boolean(myPerms?.name_change_approve));

  useEffect(() => {
    canEditRosterAsManagerRef.current = Boolean(canEditRosterAsManager);
  }, [canEditRosterAsManager]);

  const matchesStarted = Boolean(tournament?.matches_started);
  const canChangeTeamsCount = isOrganizer || (isAssistant && Boolean(myPerms?.tournament_edit) && !matchesStarted);

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
      toast.error("Brak uprawnień do edycji składów (roster_edit = false).");
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

      const nextRows = mapApiPlayersToRows(data);

      setPlayers(nextRows);
      setPlayersDirty(false);

      const effectiveTeamId = data.team_id ?? teamId ?? 0;
      clearUndoStack(effectiveTeamId);

      if (mode === "PARTICIPANT") {
        setParticipantMode(true);
        setSelectedTeamId(data.team_id ?? null);
      } else {
        setParticipantMode(false);
        setSelectedTeamId(effectiveTeamId || null);
      }

      rosterAutosave.clearDraft("roster");
    } catch (e: any) {
      setPlayers([{ display_name: "", jersey_number: null }]);
      setPlayersDirty(false);
      toast.error(e?.message || "Błąd pobierania składu.");
    } finally {
      setPlayersLoading(false);
    }
  };

  // ===== init =====
  useEffect(() => {
    if (!id) return;

    let mounted = true;

    const init = async () => {
      try {
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
        toast.error(e?.message || "Błąd ładowania danych.");
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


  const confirmChangeCount = async (): Promise<boolean> => {
    if (!canChangeTeamsCount) {
      if (isAssistant) {
        if (!myPerms?.tournament_edit) toast.error("Brak uprawnień: asystent nie ma tournament_edit.");
        else if (matchesStarted) toast.error("Asystent nie może zmieniać liczby uczestników po starcie.");
      } else {
        toast.error("Brak uprawnień.");
      }
      return false;
    }

    if (tournament?.status === "DRAFT" && !matchesStarted) return true;

    if (isOrganizer && matchesStarted) {
      const message = [
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
      ].join("\n");

      return await requestConfirm({
        title: "Potwierdź reset rozgrywek",
        message,
        confirmLabel: "Kontynuuj",
        cancelLabel: "Anuluj",
        confirmVariant: "danger",
      });
    }

    return await requestConfirm({
      title: "Potwierdź zmianę liczby uczestników",
      message: "Zmiana liczby uczestników spowoduje reset rozgrywek (etapy i mecze).\nKontynuować?",
      confirmLabel: "Kontynuuj",
      cancelLabel: "Anuluj",
      confirmVariant: "danger",
    });
  };
  const changeTeamsCount = async (delta: number) => {
    if (!tournament || busy || inFlightRef.current) return;
    if (!canChangeTeamsCount) return;

    const next = currentCount + delta;
    if (next < 2) return;

    if (!(await confirmChangeCount())) return;

    try {
      inFlightRef.current = true;
      setBusy(true);

      const resp = await setupTeams(next);

      if (canManageQueue) await loadPendingQueue();

      const { role, perms } = getRoleAndPerms(resp.tournament);
      const allowManagerRoster = role === "ORGANIZER" || (role === "ASSISTANT" && Boolean(perms?.roster_edit));

      if (hasRosterFeature(resp.tournament) && allowManagerRoster) {
        const ids = new Set(resp.teams.map((t) => t.id));
        const nextSelected = selectedTeamId && ids.has(selectedTeamId) ? selectedTeamId : resp.teams?.[0]?.id ?? null;
        setSelectedTeamId(nextSelected);
        if (nextSelected) await loadTeamPlayers(nextSelected);
      }
    } catch (e: any) {
      toast.error(e?.message || "Nie udało się zmienić liczby uczestników.");
    } finally {
      setBusy(false);
      inFlightRef.current = false;
    }
  };

  function participantsRosterBlocked(): boolean {
    const t = tournamentRef.current;
    const { role, perms } = getRoleAndPerms(t);
    return role === "ASSISTANT" && !Boolean(perms?.roster_edit);
  }

  // ===== autosave: helper dla edytora składu =====
  const scheduleRosterAutosave = (nextPlayers: PlayerRow[]) => {
    if (!hasRosterFeature(tournamentRef.current)) return;
    if (participantsRosterBlocked()) return;

    const teamId = getActiveTeamId();
    if (!teamId) return;

    rosterAutosave.update("roster", { teamId, players: nextPlayers });
  };

  const addPlayerRow = () => {
    setPlayersDirty(true);
    setPlayers((prev) => {
      const teamId = getActiveTeamId();
      if (teamId) pushUndoSnapshot(teamId, prev);

      const next = [...prev, { display_name: "", jersey_number: null }];
      scheduleRosterAutosave(next);
      return next;
    });
  };

  const removePlayerRow = (idx: number) => {
    setPlayersDirty(true);
    setPlayers((prev) => {
      const teamId = getActiveTeamId();
      if (teamId) pushUndoSnapshot(teamId, prev);

      const next = prev.filter((_, i) => i !== idx);
      const safe = next.length === 0 ? [{ display_name: "", jersey_number: null }] : next;
      scheduleRosterAutosave(safe);
      return safe;
    });
  };

  const updatePlayerField = (idx: number, patch: Partial<PlayerRow>) => {
    setPlayersDirty(true);
    setPlayers((prev) => {
      const teamId = getActiveTeamId();
      if (teamId) pushUndoSnapshot(teamId, prev);

      const next = prev.map((p, i) => (i === idx ? { ...p, ...patch } : p));
      scheduleRosterAutosave(next);
      return next;
    });
  };

  const undoLastRosterChange = () => {
    const teamId = getActiveTeamId();
    if (!teamId) return;

    const snap = popUndoSnapshot(teamId);
    if (!snap) return;

    setPlayersDirty(true);
    setPlayers(snap);
    scheduleRosterAutosave(snap);
  };

  // ===== podgląd składu w karcie (lazy) =====
  const loadTeamPreview = async (teamId: number) => {
    if (!id) return;

    setTeamPlayersPreviewLoading((p) => ({ ...p, [teamId]: true }));
    try {
      const res = await apiFetch(`/api/tournaments/${id}/teams/${teamId}/players/`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail || "Nie udało się pobrać składu.");
      }
      const data: TeamPlayersResponse = await res.json();
      setTeamPlayersPreview((p) => ({ ...p, [teamId]: data }));
      setTeams((prev) => prev.map((t) => (t.id === teamId ? { ...t, players_count: data.count } : t)));
    } catch (e: any) {
      toast.error(e?.message || "Błąd pobierania składu.");
      setTeamPlayersPreview((p) => ({ ...p, [teamId]: null }));
    } finally {
      setTeamPlayersPreviewLoading((p) => ({ ...p, [teamId]: false }));
    }
  };

  const toggleTeamExpand = async (teamId: number) => {
    const next = !Boolean(expandedTeams[teamId]);
    setExpandedTeams((p) => ({ ...p, [teamId]: next }));

    if (next && !teamPlayersPreview[teamId] && !teamPlayersPreviewLoading[teamId]) {
      await loadTeamPreview(teamId);
    }
  };

  const collapseBtnBase =
    "inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-200 hover:bg-white/[0.07] transition disabled:opacity-60 disabled:hover:bg-white/[0.04]";

  if (loading) return <div className="px-4 py-8 text-slate-200/80">Ładowanie...</div>;
  if (!tournament) return <div className="px-4 py-8 text-rose-300">Brak danych turnieju.</div>;

  const titleLabel = tournament?.competition_type === "INDIVIDUAL" ? "Zawodnicy" : "Drużyny";
  const canUndoNow = !playersLoading && (undoStacksRef.current[getActiveTeamId()]?.length ?? 0) > 0;

  return (
    <div className="w-full py-6">
      {/* HEADER */}
      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">Uczestnicy</h1>
            <div className="mt-1 text-sm text-slate-300">Zarządzanie uczestnikami - liczba, nazwy i składy.</div>
          </div>
        </div>
      </div>

      {/* INFO/WARN */}
      <div className="space-y-3">
        {isAssistant && !myPerms && (
          <Card className="p-4">
            <div className="text-sm text-amber-200/90">
              Uwaga: backend nie zwrócił <code className="text-amber-100">my_permissions</code>. UI traktuje uprawnienia
              asystenta jako wyłączone.
            </div>
          </Card>
        )}

        {isAssistant && matchesStarted && (
          <Card className="p-4">
            <div className="text-sm text-rose-200/90">
              Turniej już się rozpoczął - zmiana liczby uczestników jest zablokowana dla asystenta.
            </div>
          </Card>
        )}

        {isOrganizer && matchesStarted && (
          <Card className="p-4">
            <div className="text-sm text-amber-200/90">
              Turniej jest rozpoczęty. Zmiana liczby uczestników spowoduje pełny reset (mecze, wyniki, harmonogram).
            </div>
          </Card>
        )}

        {!matchesStarted && tournament.status !== "DRAFT" && (
          <Card className="p-4">
            <div className="text-sm text-slate-200/80">
              Zmiana nazw jest bezpieczna. Zmiana liczby uczestników (+/-) spowoduje reset rozgrywek.
            </div>
          </Card>
        )}
      </div>

      {/* TOP: COUNT + QUEUE */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[360px_1fr]">
        <Card className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-100">Liczba uczestników</div>
              <div className="mt-1 text-xs text-slate-300">Zmiana może wymagać resetu (zależnie od statusu).</div>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="secondary" disabled={busy || !canChangeTeamsCount} onClick={() => changeTeamsCount(-1)}>
                -
              </Button>
              <div className="min-w-[2.5rem] text-center text-lg font-semibold text-slate-100">{currentCount}</div>
              <Button variant="secondary" disabled={busy || !canChangeTeamsCount} onClick={() => changeTeamsCount(1)}>
                +
              </Button>
            </div>
          </div>

          {isAssistant && !canChangeTeamsCount && (
            <div className="mt-3 text-xs text-slate-300">
              Wymaga <code className="text-slate-100">tournament_edit</code> i braku startu.
            </div>
          )}
        </Card>

        {canManageQueue ? (
          <Card className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-100">Kolejka próśb o zmianę nazwy</div>
                <div className="mt-1 text-xs text-slate-300">
                  Oczekuje: <span className="text-slate-100">{pendingRequests.length}</span>
                  {queueLoading ? <span className="ml-2 text-slate-400">Ładowanie...</span> : null}
                </div>
              </div>
            </div>

            <div className="mt-3 grid gap-2">
              {pendingRequests.length === 0 && !queueLoading ? (
                <div className="text-sm text-slate-300 italic">Brak oczekujących próśb.</div>
              ) : (
                pendingRequests.map((r) => (
                  <div key={r.id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-100">Team #{r.team_id}</div>
                        <div className="mt-1 text-xs text-slate-300 break-words">
                          <div>
                            <span className="text-slate-400">Było:</span> {r.old_name}
                          </div>
                          <div>
                            <span className="text-slate-400">Chce:</span> {r.requested_name}
                          </div>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <Button variant="secondary" disabled={queueBusy} onClick={() => approveRequest(r.id)}>
                          Akceptuj
                        </Button>
                        <Button variant="danger" disabled={queueBusy} onClick={() => rejectRequest(r.id)}>
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
            <div className="text-sm text-slate-300">Kolejka zmian nazw jest niedostępna (brak uprawnień).</div>
          </Card>
        )}
      </div>

      {/* ROSTER */}
      {hasRosterFeature(tournament) && (
        <Card className="mt-4 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="text-sm font-semibold text-slate-100">Składy (zawodnicy)</div>
                <AutosaveIndicator status={rosterAutosave.statuses["roster"] ?? "idle"} error={rosterAutosave.errors["roster"]} />
              </div>

              {participantMode ? <div className="mt-1 text-xs text-slate-300">Tryb uczestnika</div> : null}
            </div>

            <button type="button" onClick={() => setRosterOpen((v) => !v)} className={collapseBtnBase}>
              {rosterOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              {rosterOpen ? "Zwiń" : "Rozwiń"}
            </button>
          </div>

          {rosterOpen && (
            <div className="mt-4">
              {isAssistant && !canEditRosterAsManager ? (
                <div className="text-sm text-slate-300">
                  Brak uprawnień do składów (wymagane: <code className="text-slate-100">roster_edit</code>).
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  {canEditRosterAsManager ? (
                    <>
                      <div className="text-sm text-slate-300">Drużyna:</div>
                      <Select<number>
                        value={selectedTeamId ?? (teamOptions[0]?.value ?? 0)}
                        onChange={(nextId) => {
                          if (!nextId) return;

                          setSelectedTeamId(nextId);
                          clearUndoStack(nextId);
                          void loadTeamPlayers(nextId);
                        }}
                        options={teamOptions}
                        disabled={playersLoading || teamOptions.length === 0}
                        ariaLabel="Wybierz drużynę"
                        className=""
                        buttonClassName="rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/10"
                        menuClassName="rounded-2xl"
                        size="md"
                        align="start"
                      />

                      <Button variant="ghost" disabled={!canUndoNow} onClick={undoLastRosterChange}>
                        Cofnij
                      </Button>

                      <div className="ml-auto text-xs text-slate-400">
                        {playersLoading ? "Ładowanie..." : playersDirty ? "Niezapisane zmiany" : " "}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-sm text-slate-300">Twoja drużyna</div>

                      <Button variant="ghost" disabled={!canUndoNow} onClick={undoLastRosterChange}>
                        Cofnij
                      </Button>

                      <div className="ml-auto text-xs text-slate-400">
                        {playersLoading ? "Ładowanie..." : playersDirty ? "Niezapisane zmiany" : " "}
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
                      className="grid items-center gap-2 rounded-2xl border border-white/10 bg-transparent p-3 md:grid-cols-[1fr_240px_44px]"
                    >
                      <Input
                        value={p.display_name}
                        disabled={playersLoading}
                        placeholder={`Zawodnik ${idx + 1} - imię i nazwisko`}
                        onChange={(e) => updatePlayerField(idx, { display_name: e.target.value })}
                      />

                      <Input
                        value={p.jersey_number ?? ""}
                        disabled={playersLoading}
                        placeholder="Nr (numer z koszulki)"
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

                      <Button variant="danger" disabled={playersLoading} onClick={() => removePlayerRow(idx)} title="Usuń wiersz">
                        -
                      </Button>
                    </div>
                  ))}

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button variant="secondary" disabled={playersLoading} onClick={addPlayerRow}>
                      + Dodaj zawodnika
                    </Button>

                    <div className="text-xs text-slate-400">
                      {participantMode
                        ? "Uwaga: zapis może być zablokowany, jeśli organizator wyłączył edycję składu przez właściciela drużyny."
                        : "Skład zapisuje się automatycznie dla wybranej drużyny."}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {/* TEAMS LIST */}
      <div className="mt-4">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-100">{titleLabel}</div>
            <div className="mt-1 text-xs text-slate-300">Szybka edycja nazw i podgląd składu w kartach.</div>
            {!canEditTeams && (isOrganizer || isAssistant) && (
              <div className="mt-1 text-xs text-slate-400">
                Edycja nazw zablokowana (wymagane: <code className="text-slate-100">teams_edit</code>).
              </div>
            )}
          </div>
        </div>

        {teams.length === 0 && !busy ? (
          <div className="text-sm text-slate-300 italic">Brak aktywnych uczestników - ustaw liczbę miejsc (+), aby utworzyć listę.</div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {teams.map((team) => {
              const expanded = Boolean(expandedTeams[team.id]);
              const preview = teamPlayersPreview[team.id] ?? null;
              const previewLoading = Boolean(teamPlayersPreviewLoading[team.id]);

              const draft = teamNameAutosave.drafts[team.id]?.name ?? team.name;
              const saveStatus = teamNameAutosave.statuses[team.id] ?? "idle";
              const error = teamNameAutosave.errors[team.id];

              const playersCount =
                typeof team.players_count === "number"
                  ? team.players_count
                  : typeof preview?.count === "number"
                    ? preview.count
                    : 0;

              return (
                <Card key={team.id} className="p-3">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <Input
                        value={draft}
                        disabled={busy || !canEditTeams}
                        onChange={(e) => {
                          const v = e.target.value;
                          setTeams((prev) => prev.map((t) => (t.id === team.id ? { ...t, name: v } : t)));
                          teamNameAutosave.update(team.id, { name: v });
                        }}
                        onBlur={() => {
                          if (!canEditTeams) return;
                          const v = normName((teamNameAutosave.drafts[team.id]?.name ?? team.name) || "");
                          teamNameAutosave.forceSave(team.id, { name: v }).catch((err: any) => {
                            toast.error(err?.message || "Nie udało się zapisać nazwy.");
                          });
                        }}
                      />
                    </div>

                    {hasRosterFeature(tournament) ? (
                      <div className="shrink-0 whitespace-nowrap text-xs text-slate-400">Skład: {playersCount}</div>
                    ) : null}

                    <div className="shrink-0">
                      <AutosaveIndicator status={saveStatus} error={error} />
                    </div>

                    {hasRosterFeature(tournament) ? (
                      <button
                        type="button"
                        onClick={() => toggleTeamExpand(team.id).catch(() => void 0)}
                        className={collapseBtnBase}
                        disabled={previewLoading}
                      >
                        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        {expanded ? "Zwiń" : "Rozwiń"}
                      </button>
                    ) : null}
                  </div>

                  {hasRosterFeature(tournament) && expanded ? (
                    <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                      {previewLoading ? (
                        <div className="text-sm text-slate-300">Ładowanie...</div>
                      ) : preview && Array.isArray(preview.results) && preview.results.length > 0 ? (
                        <div className="divide-y divide-white/10">
                          {preview.results.map((p) => (
                            <div key={p.id} className="grid grid-cols-4 items-center gap-3 py-1.5 text-sm">
                              <div className="col-span-3 min-w-0 truncate text-white">{p.display_name}</div>
                              <div className="col-span-1 text-right text-white">
                                {typeof p.jersey_number === "number" ? String(p.jersey_number) : ""}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-sm text-slate-300 italic">Brak zawodników w składzie.</div>
                      )}
                    </div>
                  ) : null}
                </Card>
              );
            })}
          </div>
        )}
      </div>



<ConfirmActionModal
  open={!!confirmDialog}
  title={confirmDialog?.title ?? ""}
  message={confirmDialog?.message ?? ""}
  confirmLabel={confirmDialog?.confirmLabel}
  cancelLabel={confirmDialog?.cancelLabel}
  confirmVariant={confirmDialog?.confirmVariant}
  onCancel={() => resolveConfirm(false)}
  onConfirm={() => resolveConfirm(true)}
/>

    </div>
  );
}
