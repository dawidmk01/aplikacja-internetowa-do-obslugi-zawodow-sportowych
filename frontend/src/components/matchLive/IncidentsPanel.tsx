import { useCallback, useEffect, useMemo, useState } from "react";

import { apiFetch } from "../../api";
import { cn } from "../../lib/cn";

import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";
import { InlineAlert } from "../../ui/InlineAlert";
import { Input } from "../../ui/Input";
import { Select, type SelectOption } from "../../ui/Select";

import type { ClockMeta } from "./ClockPanel";
import {
  BreakMode,
  type IncidentDTO,
  incidentKindOptions,
  isBasketball,
  isTennis,
  safeInt,
  tennisPointLabel,
  tennisPointLabelOther,
} from "./matchLive.utils";

type TeamPlayerDTO = {
  id: number;
  team_id: number;
  display_name: string;
  jersey_number: number | null;
};

type IncidentDraft = {
  kind: string;
  side: "" | "HOME" | "AWAY";

  minute: string;

  player_id: string;
  player_in_id: string;
  player_out_id: string;

  points: 1 | 2 | 3;

  tennis_set_no: number;
  tennis_game_no: number;

  note: string;
};

type Props = {
  tournamentId?: number;

  matchId: number;
  discipline: string;
  canEdit: boolean;
  goalScope?: "REGULAR" | "EXTRA_TIME";

  homeTeamId?: number;
  awayTeamId?: number;
  homeTeamName: string;
  awayTeamName: string;

  clockMeta: ClockMeta | null;
  reloadToken?: number;

  onRequestConfirmIncidentDelete?: (req: any, proceed: () => void) => void;
  onAfterRecompute?: () => Promise<void> | void;
  onRequestClockReload?: () => void;
};

const WRESTLING_KIND_OPTIONS: SelectOption<string>[] = [
  { value: "WRESTLING_POINT_1", label: "Punkt techniczny 1" },
  { value: "WRESTLING_POINT_2", label: "Punkty techniczne 2" },
  { value: "WRESTLING_POINT_4", label: "Punkty techniczne 4" },
  { value: "WRESTLING_POINT_5", label: "Punkty techniczne 5" },
  { value: "WRESTLING_PASSIVITY", label: "Pasywność" },
  { value: "WRESTLING_CAUTION", label: "Ostrzeżenie" },
  { value: "WRESTLING_FALL", label: "Tusz" },
  { value: "WRESTLING_INJURY", label: "Kontuzja" },
  { value: "WRESTLING_FORFEIT", label: "Walkower" },
  { value: "WRESTLING_DISQUALIFICATION", label: "Dyskwalifikacja" },
  { value: "TIMEOUT", label: "Przerwa techniczna" },
];

const WRESTLING_PLAYER_KINDS = new Set<string>([
  "WRESTLING_POINT_1",
  "WRESTLING_POINT_2",
  "WRESTLING_POINT_4",
  "WRESTLING_POINT_5",
  "WRESTLING_PASSIVITY",
  "WRESTLING_CAUTION",
  "WRESTLING_FALL",
  "WRESTLING_INJURY",
  "WRESTLING_FORFEIT",
  "WRESTLING_DISQUALIFICATION",
]);

function isWrestling(discipline: string) {
  return String(discipline || "").toLowerCase() === "wrestling";
}

function buildIncidentKinds(discipline: string): SelectOption<string>[] {
  const base = incidentKindOptions(discipline);
  if (!isWrestling(discipline)) return base;
  if (Array.isArray(base) && base.length > 0) return base;
  return WRESTLING_KIND_OPTIONS;
}

function supportsSubKind(kind: string) {
  return kind === "SUBSTITUTION";
}

function supportsPlayerKind(kind: string, discipline: string) {
  if (isWrestling(discipline)) return false;
  return kind !== "SUBSTITUTION" && kind !== "TENNIS_POINT" && kind !== "TIMEOUT";
}

function playerLabel(p: TeamPlayerDTO) {
  const nr = p.jersey_number != null ? `${p.jersey_number}. ` : "";
  return `${nr}${p.display_name}`;
}

function computeClockMinute(clockMeta: ClockMeta | null): number | null {
  if (!clockMeta) return null;

  const inIntermission = clockMeta.breakMode === BreakMode.INTERMISSION;
  const absNow = Number((clockMeta as any).matchDisplaySeconds ?? 0);
  const base = Number((clockMeta as any).baseOffsetSeconds ?? 0);
  const limit = (clockMeta as any).timeLimitSeconds;

  const absEnd = typeof limit === "number" ? Math.max(0, base + Number(limit || 0)) : absNow;
  const chosen = inIntermission ? absEnd : absNow;

  return Math.max(0, Math.floor(Number(chosen) / 60));
}

function mapPlayersToOptions(players: TeamPlayerDTO[]): SelectOption<string>[] {
  return players.map((p) => ({ value: String(p.id), label: playerLabel(p) }));
}

/** IncidentsPanel obsługuje incydenty meczu oraz pobranie składów do wyboru zawodników w ramach edycji live. */
export function IncidentsPanel({
  tournamentId,
  matchId,
  discipline,
  canEdit,
  goalScope = "REGULAR",
  homeTeamId,
  awayTeamId,
  homeTeamName,
  awayTeamName,
  clockMeta,
  reloadToken,
  onRequestConfirmIncidentDelete,
  onAfterRecompute,
  onRequestClockReload,
}: Props) {
  const [incidents, setIncidents] = useState<IncidentDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showAllIncidents, setShowAllIncidents] = useState(false);

  const [editIncidentId, setEditIncidentId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<{
    minute: string;
    player_id: string;
    player_in_id: string;
    player_out_id: string;
    points: 1 | 2 | 3;
  } | null>(null);
  const [updating, setUpdating] = useState<Record<number, boolean>>({});

  const kinds = useMemo(() => buildIncidentKinds(discipline), [discipline]);

  const [minuteTouched, setMinuteTouched] = useState(false);

  const [draft, setDraft] = useState<IncidentDraft>(() => ({
    kind: "",
    side: "",
    minute: "",
    player_id: "",
    player_in_id: "",
    player_out_id: "",
    points: 2,
    tennis_set_no: 1,
    tennis_game_no: 1,
    note: "",
  }));

  const [homePlayers, setHomePlayers] = useState<TeamPlayerDTO[]>([]);
  const [awayPlayers, setAwayPlayers] = useState<TeamPlayerDTO[]>([]);
  const [playersLoading, setPlayersLoading] = useState(false);
  const [playersError, setPlayersError] = useState<string | null>(null);
  const [showRoster, setShowRoster] = useState(false);

  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

  const teamIdForSide = useCallback(
    (side: "" | "HOME" | "AWAY") => (side === "HOME" ? homeTeamId : side === "AWAY" ? awayTeamId : undefined),
    [awayTeamId, homeTeamId]
  );

  const teamNameForSide = useCallback(
    (side: "" | "HOME" | "AWAY") => (side === "HOME" ? homeTeamName : side === "AWAY" ? awayTeamName : "-"),
    [awayTeamName, homeTeamName]
  );

  const clockMinute = useMemo(() => computeClockMinute(clockMeta), [clockMeta]);

  useEffect(() => {
    setShowAllIncidents(false);
    setShowRoster(false);
    setMinuteTouched(false);
    setPendingDeleteId(null);
    setEditIncidentId(null);
    setEditDraft(null);

    setDraft({
      kind: "",
      side: "",
      minute: "",
      player_id: "",
      player_in_id: "",
      player_out_id: "",
      points: 2,
      tennis_set_no: 1,
      tennis_game_no: 1,
      note: "",
    });
  }, [matchId]);

  useEffect(() => {
    if (minuteTouched) return;
    if (clockMinute == null) return;
    setDraft((d) => ({ ...d, minute: String(clockMinute) }));
  }, [clockMinute, minuteTouched]);

  const loadIncidents = useCallback(async () => {
    setError(null);
    setLoading(true);

    try {
      const res = await apiFetch(`/api/matches/${matchId}/incidents/`, { method: "GET", toastOnError: false } as any);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || `Błąd pobierania incydentów (${res.status})`);

      const list = Array.isArray(data)
        ? data
        : Array.isArray(data?.incidents)
          ? data.incidents
          : Array.isArray(data?.results)
            ? data.results
            : [];

      setIncidents(list);
    } catch (e: any) {
      setError(e?.message || "Błąd pobierania incydentów.");
      setIncidents([]);
    } finally {
      setLoading(false);
    }
  }, [matchId]);

  const loadPlayers = useCallback(async () => {
    setPlayersError(null);

    if (isWrestling(discipline)) {
      setHomePlayers([]);
      setAwayPlayers([]);
      setPlayersLoading(false);
      return;
    }

    const tId = Number(tournamentId || 0);
    const hId = Number(homeTeamId || 0);
    const aId = Number(awayTeamId || 0);

    if (!tId || (!hId && !aId)) {
      setHomePlayers([]);
      setAwayPlayers([]);
      return;
    }

    setPlayersLoading(true);

    try {
      const loadOne = async (teamId: number) => {
        if (!teamId) return [];

        const res = await apiFetch(`/api/tournaments/${tId}/teams/${teamId}/players/`, { method: "GET", toastOnError: false } as any);
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.detail || `Błąd pobierania składu (${res.status})`);

        const list = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];
        return list
          .filter((p: any) => p && typeof p.id === "number")
          .map(
            (p: any) =>
              ({
                id: Number(p.id),
                team_id: Number(p.team_id),
                display_name: String(p.display_name || ""),
                jersey_number: p.jersey_number == null ? null : Number(p.jersey_number),
              }) satisfies TeamPlayerDTO
          )
          .filter((p: TeamPlayerDTO) => p.display_name.trim().length > 0);
      };

      const [hp, ap] = await Promise.all([loadOne(hId), loadOne(aId)]);
      setHomePlayers(hp);
      setAwayPlayers(ap);
    } catch (e: any) {
      setPlayersError(e?.message || "Nie udało się pobrać składów.");
      setHomePlayers([]);
      setAwayPlayers([]);
    } finally {
      setPlayersLoading(false);
    }
  }, [awayTeamId, discipline, homeTeamId, tournamentId]);

  useEffect(() => {
    loadIncidents();
  }, [loadIncidents, reloadToken]);

  useEffect(() => {
    loadPlayers();
  }, [loadPlayers, matchId]);

  const selectedTeamPlayers = useMemo(() => {
    if (draft.side === "HOME") return homePlayers;
    if (draft.side === "AWAY") return awayPlayers;
    return [];
  }, [draft.side, homePlayers, awayPlayers]);

  const canUseRoster = selectedTeamPlayers.length > 0;

  const showNoteInput =
    draft.kind !== "" &&
    draft.kind !== "GOAL" &&
    draft.kind !== "TENNIS_POINT" &&
    !WRESTLING_PLAYER_KINDS.has(draft.kind);

  const showSubInputs = draft.kind === "SUBSTITUTION";
  const showPlayerInput =
    draft.kind !== "" &&
    !showSubInputs &&
    !isTennis(discipline) &&
    supportsPlayerKind(draft.kind, discipline);

  const pointsOptions = useMemo<SelectOption<1 | 2 | 3>[]>(
    () => [
      { value: 1, label: "1" },
      { value: 2, label: "2" },
      { value: 3, label: "3" },
    ],
    []
  );

  const playerOptions = useMemo(() => mapPlayersToOptions(selectedTeamPlayers), [selectedTeamPlayers]);

  const tennisPointsView = useMemo(() => {
    if (!isTennis(discipline)) return null;
    if (!homeTeamId || !awayTeamId) return null;
    if (draft.kind !== "TENNIS_POINT") return null;

    const setNo = Math.max(1, Number(draft.tennis_set_no || 1));
    const gameNo = Math.max(1, Number(draft.tennis_game_no || 1));

    const pts = incidents.filter((i) => {
      if (i.kind !== "TENNIS_POINT") return false;
      const s = Number(i.meta?.set_no ?? 1);
      const g = Number(i.meta?.game_no ?? 1);
      return s === setNo && g === gameNo;
    });

    let h = 0;
    let a = 0;
    for (const p of pts) {
      if (p.team_id === homeTeamId) h += 1;
      if (p.team_id === awayTeamId) a += 1;
    }

    return {
      setNo,
      gameNo,
      homePts: h,
      awayPts: a,
      homeLabel: tennisPointLabel(h, a),
      awayLabel: tennisPointLabelOther(h, a),
    };
  }, [discipline, incidents, draft.kind, draft.tennis_set_no, draft.tennis_game_no, homeTeamId, awayTeamId]);

  const submitIncident = useCallback(async () => {
    setError(null);

    if (!draft.kind) return setError("Wybierz typ incydentu.");
    if (!draft.side) return setError("Wybierz drużynę.");

    const team_id = teamIdForSide(draft.side);
    if (!team_id) return setError("Brak team_id dla tej strony (home/away).");

    const minuteInt = safeInt(draft.minute);
    if (minuteInt == null) return setError("Podaj minutę.");

    const payload: any = {
      kind: draft.kind,
      team_id,
      time_source: "MANUAL",
      minute: minuteInt,
      minute_raw: null,
    };

    if (draft.kind === "SUBSTITUTION") {
      if (!draft.player_in_id.trim() || !draft.player_out_id.trim()) {
        return setError("Dla zmiany wybierz zawodnika schodzącego i wchodzącego.");
      }
      payload.player_in_id = Number(draft.player_in_id);
      payload.player_out_id = Number(draft.player_out_id);
    } else if (draft.player_id.trim()) {
      payload.player_id = Number(draft.player_id);
    }

    const meta: Record<string, any> = {};

    const inExtra = clockMeta?.clock?.clock_period === "ET1" || clockMeta?.clock?.clock_period === "ET2";
    const effectiveGoalScope = goalScope ?? (inExtra ? "EXTRA_TIME" : "REGULAR");

    if (!isTennis(discipline) && draft.kind === "GOAL" && effectiveGoalScope === "EXTRA_TIME") {
      meta.scope = "EXTRA_TIME";
    }

    if (isBasketball(discipline) && draft.kind === "GOAL") {
      meta.points = draft.points;
    }

    if (isTennis(discipline) && draft.kind === "TENNIS_POINT") {
      meta.set_no = Math.max(1, Number(draft.tennis_set_no || 1));
      meta.game_no = Math.max(1, Number(draft.tennis_game_no || 1));
    }

    const note = (draft.note || "").trim();
    if (note && draft.kind !== "GOAL" && draft.kind !== "TENNIS_POINT") meta.note = note;

    payload.meta = meta;

    setLoading(true);

    try {
      const res = await apiFetch(`/api/matches/${matchId}/incidents/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        toastOnError: false,
      } as any);

      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || "Nie udało się dodać incydentu.");

      await loadIncidents();
      await onAfterRecompute?.();

      if (draft.kind === "TIMEOUT") onRequestClockReload?.();

      setPendingDeleteId(null);
      setMinuteTouched(false);
      setDraft((d) => ({
        ...d,
        kind: "",
        side: "",
        player_id: "",
        player_in_id: "",
        player_out_id: "",
        note: "",
        minute: clockMinute != null ? String(clockMinute) : "",
      }));
    } catch (e: any) {
      setError(e?.message ?? "Błąd dodawania incydentu.");
    } finally {
      setLoading(false);
    }
  }, [
    clockMeta?.clock?.clock_period,
    clockMinute,
    discipline,
    draft,
    goalScope,
    loadIncidents,
    matchId,
    onAfterRecompute,
    onRequestClockReload,
    teamIdForSide,
  ]);

  const deleteIncident = useCallback(
    async (incidentId: number) => {
      setError(null);
      setLoading(true);

      try {
        const res = await apiFetch(`/api/incidents/${incidentId}/`, { method: "DELETE", toastOnError: false } as any);
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.detail || "Nie udało się usunąć incydentu.");
        }

        await loadIncidents();
        await onAfterRecompute?.();
      } catch (e: any) {
        setError(e?.message ?? "Błąd usuwania incydentu.");
      } finally {
        setLoading(false);
        setPendingDeleteId(null);
      }
    },
    [loadIncidents, onAfterRecompute]
  );

  const requestDeleteIncident = useCallback(
    (i: IncidentDTO) => {
      const proceed = () => deleteIncident(i.id);

      if (onRequestConfirmIncidentDelete) {
        const teamLabel = i.team_id === homeTeamId ? homeTeamName : i.team_id === awayTeamId ? awayTeamName : undefined;
        onRequestConfirmIncidentDelete(
          {
            matchId,
            incidentId: i.id,
            incidentType: i.kind,
            teamLabel,
            minute: i.minute,
            playerLabel: i.player_name,
          },
          proceed
        );
        return;
      }

      setPendingDeleteId(i.id);
    },
    [awayTeamId, deleteIncident, homeTeamId, homeTeamName, awayTeamName, matchId, onRequestConfirmIncidentDelete]
  );

  const beginEdit = useCallback((i: IncidentDTO) => {
    setPendingDeleteId(null);
    setEditIncidentId(i.id);
    const rawPoints = Number(i.meta?.points ?? 2);
    const points: 1 | 2 | 3 = rawPoints === 1 || rawPoints === 3 ? rawPoints : 2;

    setEditDraft({
      minute: i.minute != null ? String(i.minute) : "",
      player_id: i.player_id != null ? String(i.player_id) : "",
      player_out_id: i.player_out_id != null ? String(i.player_out_id) : "",
      player_in_id: i.player_in_id != null ? String(i.player_in_id) : "",
      points,
    });
  }, []);

  const cancelEdit = useCallback(() => {
    setEditIncidentId(null);
    setEditDraft(null);
  }, []);

  const updateIncident = useCallback(
    async (incidentId: number, patch: Record<string, any>) => {
      setError(null);
      setUpdating((prev) => ({ ...prev, [incidentId]: true }));

      try {
        const res = await apiFetch(`/api/incidents/${incidentId}/`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
          toastOnError: false,
        } as any);

        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.detail || data?.code || "Nie udało się zaktualizować incydentu.");

        setIncidents((prev) => prev.map((x) => (x.id === incidentId ? data : x)));
        await loadIncidents();
        onRequestClockReload?.();
      } catch (e: any) {
        setError(e?.message || "Nie udało się zaktualizować incydentu.");
      } finally {
        setUpdating((prev) => {
          const n = { ...prev };
          delete n[incidentId];
          return n;
        });
      }
    },
    [loadIncidents, onRequestClockReload]
  );

  const saveEdit = useCallback(
    async (i: IncidentDTO) => {
      if (!editDraft) return;

      const minuteRaw = editDraft.minute.trim();
      const minute = minuteRaw === "" ? null : Math.max(1, Number(minuteRaw));
      const patch: Record<string, any> = { minute };

      if (supportsSubKind(i.kind)) {
        patch.player_out_id = editDraft.player_out_id.trim() ? Number(editDraft.player_out_id) : null;
        patch.player_in_id = editDraft.player_in_id.trim() ? Number(editDraft.player_in_id) : null;
      } else if (supportsPlayerKind(i.kind, discipline)) {
        patch.player_id = editDraft.player_id.trim() ? Number(editDraft.player_id) : null;
      }

      if (isBasketball(discipline) && i.kind === "GOAL") {
        patch.points = editDraft.points;
      }

      await updateIncident(i.id, patch);
      cancelEdit();
    },
    [cancelEdit, editDraft, updateIncident]
  );

  const sortedIncidents = useMemo(() => {
    return incidents.slice().sort((a, b) => (b.minute ?? 0) - (a.minute ?? 0) || b.id - a.id);
  }, [incidents]);

  const visibleIncidents = useMemo(() => {
    if (showAllIncidents) return sortedIncidents;
    return sortedIncidents.slice(0, 3);
  }, [sortedIncidents, showAllIncidents]);

  const rosterStatusLabel = useMemo(() => {
    if (isWrestling(discipline)) return "Składy: nie dotyczy";
    if (playersLoading) return "Ładowanie składów...";
    if (playersError) return "Składy: błąd";
    if (homePlayers.length || awayPlayers.length) return "Składy: OK";
    return "Składy: brak";
  }, [awayPlayers.length, discipline, homePlayers.length, playersError, playersLoading]);

  const showListToggle = sortedIncidents.length > 3;
  const disableActions = !canEdit || loading;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-base font-extrabold text-white">Incydenty</div>

        {showListToggle ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setShowAllIncidents((v) => !v)}
            className="px-3 py-2"
          >
            {showAllIncidents ? "Zwiń" : `Pokaż wszystkie (${sortedIncidents.length})`}
          </Button>
        ) : null}
      </div>

      <div className="mt-3 grid gap-3">
        <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-slate-200">Typ</div>
              {!draft.kind ? <div className="text-xs text-slate-400">Nie wybrano</div> : null}
            </div>

            <div className="flex flex-wrap gap-2">
              {kinds.map((k) => {
                const active = draft.kind === k.value;
                return (
                  <Button
                    key={k.value}
                    type="button"
                    variant="secondary"
                    className={cn(
                      "rounded-full px-3 py-1 text-xs",
                      active && "border-emerald-400/20 bg-emerald-500/15"
                    )}
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        kind: k.value,
                        player_id: "",
                        player_in_id: "",
                        player_out_id: "",
                        note: "",
                      }))
                    }
                    disabled={disableActions}
                  >
                    {k.label}
                  </Button>
                );
              })}
            </div>

            {isWrestling(discipline) ? (
              <div className="text-xs text-slate-400">
                Dla zapasów punkty techniczne są dodawane jako osobne typy incydentów 1, 2, 4 i 5.
              </div>
            ) : null}
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-slate-200">Drużyna</div>
              {!draft.side ? <div className="text-xs text-slate-400">Nie wybrano</div> : null}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                className={cn("rounded-full px-3 py-1 text-xs", draft.side === "HOME" && "border-emerald-400/20 bg-emerald-500/15")}
                onClick={() => setDraft((d) => ({ ...d, side: "HOME" }))}
                disabled={disableActions}
              >
                {homeTeamName || "Gospodarze"}
              </Button>

              <Button
                type="button"
                variant="secondary"
                className={cn("rounded-full px-3 py-1 text-xs", draft.side === "AWAY" && "border-emerald-400/20 bg-emerald-500/15")}
                onClick={() => setDraft((d) => ({ ...d, side: "AWAY" }))}
                disabled={disableActions}
              >
                {awayTeamName || "Goście"}
              </Button>
            </div>

            <div className="text-xs text-slate-400">Wybrano: {teamNameForSide(draft.side)}</div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-sm text-slate-200">
              Minuta
              <Input
                value={draft.minute}
                onChange={(e) => {
                  setMinuteTouched(true);
                  setDraft((d) => ({ ...d, minute: e.target.value }));
                }}
                placeholder={clockMinute != null ? String(clockMinute) : "np. 31"}
                inputMode="numeric"
                disabled={disableActions}
              />
            </label>

            {isBasketball(discipline) && draft.kind === "GOAL" ? (
              <div className="grid gap-1 text-sm text-slate-200">
                Punkty
                <Select<1 | 2 | 3>
                  value={draft.points}
                  onChange={(v) => setDraft((d) => ({ ...d, points: v }))}
                  options={pointsOptions}
                  disabled={disableActions}
                  ariaLabel="Punkty"
                />
              </div>
            ) : (
              <div className="grid gap-1 text-sm text-slate-200">
                Zegar
                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white">
                  {clockMinute != null ? `${clockMinute}'` : "-"}
                </div>
              </div>
            )}
          </div>

          {isTennis(discipline) && draft.kind === "TENNIS_POINT" ? (
            <div className="grid gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="grid gap-1 text-sm text-slate-200">
                  Set
                  <Input
                    type="number"
                    min={1}
                    value={draft.tennis_set_no}
                    onChange={(e) => setDraft((d) => ({ ...d, tennis_set_no: Math.max(1, Number(e.target.value || 1)) }))}
                    inputMode="numeric"
                    disabled={disableActions}
                  />
                </label>

                <label className="grid gap-1 text-sm text-slate-200">
                  Gem
                  <Input
                    type="number"
                    min={1}
                    value={draft.tennis_game_no}
                    onChange={(e) => setDraft((d) => ({ ...d, tennis_game_no: Math.max(1, Number(e.target.value || 1)) }))}
                    inputMode="numeric"
                    disabled={disableActions}
                  />
                </label>
              </div>

              {tennisPointsView ? (
                <div className="text-sm text-slate-200">
                  Punktacja (set {tennisPointsView.setNo}, gem {tennisPointsView.gameNo}):
                  <span className="ml-2 font-bold text-white">{homeTeamName}</span> {tennisPointsView.homeLabel}
                  <span className="mx-2 text-slate-500">:</span>
                  {tennisPointsView.awayLabel} <span className="font-bold text-white">{awayTeamName}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          {playersError ? <InlineAlert variant="error">{playersError}</InlineAlert> : null}

          {showPlayerInput ? (
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold text-slate-200">Zawodnik (opcjonalnie)</div>

                <Button
                  type="button"
                  variant="ghost"
                  className="px-3 py-1.5 text-xs"
                  onClick={() => setShowRoster((v) => !v)}
                  disabled={!draft.side || playersLoading || !canUseRoster}
                >
                  {showRoster ? "Zwiń" : "Rozwiń"}
                </Button>
              </div>

              <Select<string>
                value={draft.player_id ? draft.player_id : null}
                onChange={(v) => setDraft((d) => ({ ...d, player_id: v }))}
                options={playerOptions}
                placeholder="Brak"
                disabled={disableActions || !draft.side || playersLoading || !canUseRoster}
                ariaLabel="Zawodnik"
              />

              {showRoster && canUseRoster ? (
                <div className="grid max-h-[240px] gap-2 overflow-auto rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  {selectedTeamPlayers.map((p) => (
                    <Button
                      key={p.id}
                      type="button"
                      variant="secondary"
                      className="justify-between"
                      onClick={() => setDraft((d) => ({ ...d, player_id: String(p.id) }))}
                      disabled={disableActions}
                    >
                      <span className="min-w-0 truncate">{p.display_name}</span>
                      {p.jersey_number != null ? <span className="text-xs text-slate-300">#{p.jersey_number}</span> : null}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {showSubInputs ? (
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold text-slate-200">Zmiana (schodzi i wchodzi)</div>

                <Button
                  type="button"
                  variant="ghost"
                  className="px-3 py-1.5 text-xs"
                  onClick={() => setShowRoster((v) => !v)}
                  disabled={!draft.side || playersLoading || !canUseRoster}
                >
                  {showRoster ? "Zwiń" : "Rozwiń"}
                </Button>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="grid gap-1 text-sm text-slate-200">
                  Schodzi
                  <Select<string>
                    value={draft.player_out_id ? draft.player_out_id : null}
                    onChange={(v) => setDraft((d) => ({ ...d, player_out_id: v }))}
                    options={playerOptions}
                    placeholder="Wybierz"
                    disabled={disableActions || !draft.side || playersLoading || !canUseRoster}
                    ariaLabel="Schodzi"
                  />
                </div>

                <div className="grid gap-1 text-sm text-slate-200">
                  Wchodzi
                  <Select<string>
                    value={draft.player_in_id ? draft.player_in_id : null}
                    onChange={(v) => setDraft((d) => ({ ...d, player_in_id: v }))}
                    options={playerOptions}
                    placeholder="Wybierz"
                    disabled={disableActions || !draft.side || playersLoading || !canUseRoster}
                    ariaLabel="Wchodzi"
                  />
                </div>
              </div>

              {showRoster && canUseRoster ? (
                <div className="grid max-h-[240px] gap-2 overflow-auto rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  {selectedTeamPlayers.map((p) => (
                    <div key={p.id} className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        className="flex-1 justify-start"
                        onClick={() => setDraft((d) => ({ ...d, player_out_id: String(p.id) }))}
                        disabled={disableActions}
                      >
                        Schodzi: {playerLabel(p)}
                      </Button>

                      <Button
                        type="button"
                        variant="secondary"
                        className="flex-1 justify-start"
                        onClick={() => setDraft((d) => ({ ...d, player_in_id: String(p.id) }))}
                        disabled={disableActions}
                      >
                        Wchodzi: {playerLabel(p)}
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}

              {!canUseRoster ? (
                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
                  Brak składu dla tej drużyny.
                </div>
              ) : null}
            </div>
          ) : null}

          {showNoteInput ? (
            <label className="grid gap-1 text-sm text-slate-200">
              Notatka (opcjonalnie)
              <Input
                value={draft.note}
                onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
                placeholder="np. kontuzja"
                disabled={disableActions}
              />
            </label>
          ) : null}

          {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-slate-400">{rosterStatusLabel}</div>

            <Button type="button" variant="primary" onClick={submitIncident} disabled={disableActions}>
              Dodaj incydent
            </Button>
          </div>
        </div>

        <div className="grid gap-2">
          {loading && incidents.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-slate-300">
              Ładowanie incydentów...
            </div>
          ) : incidents.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-slate-300">
              Brak incydentów.
            </div>
          ) : (
            visibleIncidents.map((i) => {
              const teamLabel = i.team_id === homeTeamId ? homeTeamName : i.team_id === awayTeamId ? awayTeamName : "-";
              const isEditing = editIncidentId === i.id;
              const busy = !!updating[i.id];
              const isPendingDelete = pendingDeleteId === i.id;

              return (
                <div key={i.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 text-sm text-slate-200">
                      <span className="font-bold text-white">{i.minute != null ? `${i.minute}'` : "-"}</span>
                      <span className="mx-2 text-slate-500">|</span>
                      <span className="font-semibold text-white">{i.kind_display || i.kind}</span>
                      <span className="mx-2 text-slate-500">|</span>
                      <span className="text-slate-200">{teamLabel}</span>
                      {i.player_name ? <span className="ml-2 text-slate-300">({i.player_name})</span> : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {isEditing ? (
                        <>
                          <Button type="button" variant="primary" onClick={() => saveEdit(i)} disabled={busy}>
                            Zapisz
                          </Button>
                          <Button type="button" variant="secondary" onClick={cancelEdit} disabled={busy}>
                            Anuluj
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button type="button" variant="secondary" onClick={() => beginEdit(i)} disabled={!canEdit || loading}>
                            Edytuj
                          </Button>
                          <Button
                            type="button"
                            variant="danger"
                            onClick={() => requestDeleteIncident(i)}
                            disabled={!canEdit || loading}
                          >
                            Usuń
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {isPendingDelete ? (
                    <div className="mt-3">
                      <InlineAlert variant="error" title="Potwierdzenie">
                        Usunięcie incydentu jest nieodwracalne. Czy na pewno kontynuować?
                      </InlineAlert>

                      <div className="mt-2 flex flex-wrap justify-end gap-2">
                        <Button type="button" variant="secondary" onClick={() => setPendingDeleteId(null)} disabled={loading}>
                          Anuluj
                        </Button>
                        <Button type="button" variant="danger" onClick={() => deleteIncident(i.id)} disabled={loading}>
                          Usuń incydent
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  {isEditing && editDraft ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <label className="grid gap-1 text-sm text-slate-200">
                        Minuta
                        <Input
                          value={editDraft.minute}
                          onChange={(e) => setEditDraft((d) => (d ? { ...d, minute: e.target.value } : d))}
                          inputMode="numeric"
                          disabled={busy}
                        />
                      </label>

                      {isBasketball(discipline) && i.kind === "GOAL" ? (
                        <div className="grid gap-2 sm:grid-cols-2">
                          <label className="grid gap-1 text-sm text-slate-200">
                            Punkty
                            <Select<1 | 2 | 3>
                              value={editDraft.points}
                              onChange={(v) => setEditDraft((d) => (d ? { ...d, points: v } : d))}
                              options={pointsOptions}
                              disabled={busy}
                              ariaLabel="Punkty"
                            />
                          </label>
                          <div />
                        </div>
                      ) : supportsSubKind(i.kind) ? (
                        <div className="grid gap-2 sm:grid-cols-2">
                          <label className="grid gap-1 text-sm text-slate-200">
                            ID schodzącego
                            <Input
                              value={editDraft.player_out_id}
                              onChange={(e) => setEditDraft((d) => (d ? { ...d, player_out_id: e.target.value } : d))}
                              inputMode="numeric"
                              disabled={busy}
                            />
                          </label>

                          <label className="grid gap-1 text-sm text-slate-200">
                            ID wchodzącego
                            <Input
                              value={editDraft.player_in_id}
                              onChange={(e) => setEditDraft((d) => (d ? { ...d, player_in_id: e.target.value } : d))}
                              inputMode="numeric"
                              disabled={busy}
                            />
                          </label>
                        </div>
                      ) : supportsPlayerKind(i.kind) ? (
                        <label className="grid gap-1 text-sm text-slate-200">
                          ID zawodnika
                          <Input
                            value={editDraft.player_id}
                            onChange={(e) => setEditDraft((d) => (d ? { ...d, player_id: e.target.value } : d))}
                            inputMode="numeric"
                            disabled={busy}
                          />
                        </label>
                      ) : (
                        <div />
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>
    </Card>
  );
}