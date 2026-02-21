import { useEffect, useMemo, useState } from "react";

import { apiFetch } from "../../api";
import { cn } from "../../lib/cn";

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

import type { ClockMeta } from "./ClockPanel";

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

  // roster
  player_id: string;
  player_in_id: string;
  player_out_id: string;

  // basketball
  points: 1 | 2 | 3;

  // tennis
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

function supportsSubKind(kind: string) {
  return kind === "SUBSTITUTION";
}

function supportsPlayerKind(kind: string) {
  return kind !== "SUBSTITUTION" && kind !== "TENNIS_POINT";
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
  const [editDraft, setEditDraft] = useState<{ minute: string; player_id: string; player_in_id: string; player_out_id: string } | null>(null);
  const [updating, setUpdating] = useState<Record<number, boolean>>({});

  const kinds = useMemo(() => incidentKindOptions(discipline), [discipline]);

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

  const loadIncidents = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch(`/api/matches/${matchId}/incidents/`, { method: "GET" });
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
    } finally {
      setLoading(false);
    }
  };

  const loadPlayers = async () => {
    setPlayersError(null);

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
        const res = await apiFetch(`/api/tournaments/${tId}/teams/${teamId}/players/`, { method: "GET" });
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
  };

  useEffect(() => {
    loadIncidents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, reloadToken]);

  useEffect(() => {
    // skład nie musi się odświeżać co sekundę, tylko przy zmianie meczu/teams/tournament
    loadPlayers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId, homeTeamId, awayTeamId, matchId]);

  useEffect(() => {
    // reset widoku na nowy mecz
    setShowAllIncidents(false);
    setShowRoster(false);
    setMinuteTouched(false);

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

  const clockMinute = useMemo(() => computeClockMinute(clockMeta), [clockMeta]);

  useEffect(() => {
    if (minuteTouched) return;
    if (clockMinute == null) return;
    setDraft((d) => ({ ...d, minute: String(clockMinute) }));
  }, [clockMinute, minuteTouched]);

  const teamIdForSide = (side: "" | "HOME" | "AWAY") => (side === "HOME" ? homeTeamId : side === "AWAY" ? awayTeamId : undefined);
  const teamNameForSide = (side: "" | "HOME" | "AWAY") => (side === "HOME" ? homeTeamName : side === "AWAY" ? awayTeamName : "-");

  const showNoteInput = draft.kind !== "" && draft.kind !== "GOAL" && draft.kind !== "TENNIS_POINT";
  const showPlayerInput =
    draft.kind !== "" &&
    !isTennis(discipline) &&
    ["GOAL", "YELLOW_CARD", "RED_CARD", "FOUL", "HANDBALL_TWO_MINUTES"].includes(draft.kind);

  const showSubInputs = draft.kind === "SUBSTITUTION";

  const selectedTeamPlayers = useMemo(() => {
    if (draft.side === "HOME") return homePlayers;
    if (draft.side === "AWAY") return awayPlayers;
    return [];
  }, [draft.side, homePlayers, awayPlayers]);

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

  const submitIncident = async () => {
    setError(null);

    if (!draft.kind) {
      setError("Wybierz typ incydentu.");
      return;
    }

    if (!draft.side) {
      setError("Wybierz drużynę.");
      return;
    }

    const team_id = teamIdForSide(draft.side);
    if (!team_id) {
      setError("Brak team_id dla tej strony (home/away).");
      return;
    }

    const minuteInt = safeInt(draft.minute);
    if (minuteInt == null) {
      setError("Podaj minutę.");
      return;
    }

    const payload: any = {
      kind: draft.kind,
      team_id,
      time_source: "MANUAL",
      minute: minuteInt,
      minute_raw: null,
    };

    // zawodnicy
    if (draft.kind === "SUBSTITUTION") {
      if (!draft.player_in_id.trim() || !draft.player_out_id.trim()) {
        setError("Dla zmiany wybierz zawodnika schodzącego i wchodzącego.");
        return;
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
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || "Nie udało się dodać incydentu.");

      await loadIncidents();
      await onAfterRecompute?.();

      if (draft.kind === "TIMEOUT") {
        onRequestClockReload?.();
      }

      // neutralny reset po dodaniu
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
  };

  const deleteIncident = async (incidentId: number) => {
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch(`/api/incidents/${incidentId}/`, { method: "DELETE" });
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
    }
  };

  const requestDeleteIncident = (i: IncidentDTO) => {
    const proceed = () => deleteIncident(i.id);

    if (!onRequestConfirmIncidentDelete) {
      const ok = window.confirm("Czy na pewno chcesz usunąć ten incydent? Ta operacja jest nieodwracalna.");
      if (ok) proceed();
      return;
    }

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
  };

  const beginEdit = (i: IncidentDTO) => {
    setEditIncidentId(i.id);
    setEditDraft({
      minute: i.minute != null ? String(i.minute) : "",
      player_id: i.player_id != null ? String(i.player_id) : "",
      player_out_id: i.player_out_id != null ? String(i.player_out_id) : "",
      player_in_id: i.player_in_id != null ? String(i.player_in_id) : "",
    });
  };

  const cancelEdit = () => {
    setEditIncidentId(null);
    setEditDraft(null);
  };

  const updateIncident = async (incidentId: number, patch: Record<string, any>) => {
    setError(null);
    setUpdating((prev) => ({ ...prev, [incidentId]: true }));
    try {
      const res = await apiFetch(`/api/incidents/${incidentId}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });

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
  };

  const saveEdit = async (i: IncidentDTO) => {
    if (!editDraft) return;

    const minuteRaw = editDraft.minute.trim();
    const minute = minuteRaw === "" ? null : Math.max(1, Number(minuteRaw));
    const patch: Record<string, any> = { minute };

    if (supportsSubKind(i.kind)) {
      patch.player_out_id = editDraft.player_out_id.trim() ? Number(editDraft.player_out_id) : null;
      patch.player_in_id = editDraft.player_in_id.trim() ? Number(editDraft.player_in_id) : null;
    } else if (supportsPlayerKind(i.kind)) {
      patch.player_id = editDraft.player_id.trim() ? Number(editDraft.player_id) : null;
    }

    await updateIncident(i.id, patch);
    cancelEdit();
  };

  const sortedIncidents = useMemo(() => {
    return incidents.slice().sort((a, b) => (b.minute ?? 0) - (a.minute ?? 0) || b.id - a.id);
  }, [incidents]);

  const visibleIncidents = useMemo(() => {
    if (showAllIncidents) return sortedIncidents;
    return sortedIncidents.slice(0, 3);
  }, [sortedIncidents, showAllIncidents]);

  const canUseRoster = selectedTeamPlayers.length > 0;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-base font-extrabold text-white">Incydenty</div>

        {sortedIncidents.length > 3 && (
          <button
            type="button"
            className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-white"
            onClick={() => setShowAllIncidents((v) => !v)}
          >
            {showAllIncidents ? "Zwiń" : `Pokaż wszystkie (${sortedIncidents.length})`}
          </button>
        )}
      </div>

      <div className="mt-3 grid gap-3">
        <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-3">
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-slate-200">Typ</div>
              {!draft.kind && <div className="text-xs text-slate-400">Nie wybrano</div>}
            </div>

            <div className="flex flex-wrap gap-2">
              {kinds.map((k) => {
                const active = draft.kind === k.value;
                return (
                  <button
                    key={k.value}
                    type="button"
                    className={cn(
                      "rounded-full border border-white/10 px-3 py-1 text-xs font-semibold text-white",
                      active ? "bg-emerald-500/15" : "bg-white/[0.04] hover:bg-white/[0.06]",
                      (!canEdit || loading) && "opacity-60"
                    )}
                    onClick={() => setDraft((d) => ({ ...d, kind: k.value }))}
                    disabled={!canEdit || loading}
                  >
                    {k.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-slate-200">Drużyna</div>
              {!draft.side && <div className="text-xs text-slate-400">Nie wybrano</div>}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={cn(
                  "rounded-full border border-white/10 px-3 py-1 text-xs font-semibold text-white",
                  draft.side === "HOME" ? "bg-emerald-500/15" : "bg-white/[0.04] hover:bg-white/[0.06]",
                  (!canEdit || loading) && "opacity-60"
                )}
                onClick={() => setDraft((d) => ({ ...d, side: "HOME" }))}
                disabled={!canEdit || loading}
              >
                {homeTeamName || "Gospodarze"}
              </button>

              <button
                type="button"
                className={cn(
                  "rounded-full border border-white/10 px-3 py-1 text-xs font-semibold text-white",
                  draft.side === "AWAY" ? "bg-emerald-500/15" : "bg-white/[0.04] hover:bg-white/[0.06]",
                  (!canEdit || loading) && "opacity-60"
                )}
                onClick={() => setDraft((d) => ({ ...d, side: "AWAY" }))}
                disabled={!canEdit || loading}
              >
                {awayTeamName || "Goście"}
              </button>
            </div>

            <div className="text-xs text-slate-400">Wybrano: {teamNameForSide(draft.side)}</div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-sm text-slate-200">
              Minuta
              <input
                className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none"
                value={draft.minute}
                onChange={(e) => {
                  setMinuteTouched(true);
                  setDraft((d) => ({ ...d, minute: e.target.value }));
                }}
                placeholder={clockMinute != null ? String(clockMinute) : "np. 31"}
                inputMode="numeric"
                disabled={!canEdit || loading}
              />
            </label>

            {isBasketball(discipline) && draft.kind === "GOAL" ? (
              <label className="grid gap-1 text-sm text-slate-200">
                Punkty
                <select
                  className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none"
                  value={draft.points}
                  onChange={(e) => setDraft((d) => ({ ...d, points: Number(e.target.value) as 1 | 2 | 3 }))}
                  disabled={!canEdit || loading}
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                </select>
              </label>
            ) : (
              <div className="grid gap-1 text-sm text-slate-200">
                Zegar
                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white">
                  {clockMinute != null ? `${clockMinute}'` : "-"}
                </div>
              </div>
            )}
          </div>

          {isTennis(discipline) && draft.kind === "TENNIS_POINT" && (
            <div className="grid gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="grid gap-1 text-sm text-slate-200">
                  Set
                  <input
                    className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none"
                    value={draft.tennis_set_no}
                    onChange={(e) => setDraft((d) => ({ ...d, tennis_set_no: Math.max(1, Number(e.target.value || 1)) }))}
                    inputMode="numeric"
                    disabled={!canEdit || loading}
                  />
                </label>

                <label className="grid gap-1 text-sm text-slate-200">
                  Gem
                  <input
                    className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none"
                    value={draft.tennis_game_no}
                    onChange={(e) => setDraft((d) => ({ ...d, tennis_game_no: Math.max(1, Number(e.target.value || 1)) }))}
                    inputMode="numeric"
                    disabled={!canEdit || loading}
                  />
                </label>
              </div>

              {tennisPointsView && (
                <div className="text-sm text-slate-200">
                  Punktacja (set {tennisPointsView.setNo}, gem {tennisPointsView.gameNo}):
                  <span className="ml-2 font-bold text-white">{homeTeamName}</span> {tennisPointsView.homeLabel}
                  <span className="mx-2 text-slate-500">:</span>
                  {tennisPointsView.awayLabel} <span className="font-bold text-white">{awayTeamName}</span>
                </div>
              )}
            </div>
          )}

          {playersError && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{playersError}</div>
          )}

          {showPlayerInput && (
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-slate-200">Zawodnik (opcjonalnie)</div>

                <button
                  type="button"
                  className={cn(
                    "rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white",
                    (!draft.side || playersLoading || !canUseRoster) && "opacity-60"
                  )}
                  onClick={() => setShowRoster((v) => !v)}
                  disabled={!draft.side || playersLoading || !canUseRoster}
                >
                  {showRoster ? "Zwiń" : "Rozwiń"}
                </button>
              </div>

              <select
                className={cn("rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none", (!canEdit || loading) && "opacity-70")}
                value={draft.player_id}
                onChange={(e) => setDraft((d) => ({ ...d, player_id: e.target.value }))}
                disabled={!canEdit || loading || !draft.side || playersLoading || !canUseRoster}
              >
                <option value="">Brak</option>
                {selectedTeamPlayers.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {playerLabel(p)}
                  </option>
                ))}
              </select>

              {showRoster && canUseRoster && (
                <div className="grid max-h-[240px] gap-2 overflow-auto rounded-xl border border-white/10 bg-white/[0.02] p-3">
                  {selectedTeamPlayers.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={cn(
                        "flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white hover:bg-white/[0.06]",
                        (!canEdit || loading) && "opacity-60"
                      )}
                      onClick={() => setDraft((d) => ({ ...d, player_id: String(p.id) }))}
                      disabled={!canEdit || loading}
                    >
                      <span>{p.display_name}</span>
                      {p.jersey_number != null && <span className="text-xs text-slate-300">#{p.jersey_number}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {showSubInputs && (
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-slate-200">Zmiana (schodzi i wchodzi)</div>

                <button
                  type="button"
                  className={cn(
                    "rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white",
                    (!draft.side || playersLoading || !canUseRoster) && "opacity-60"
                  )}
                  onClick={() => setShowRoster((v) => !v)}
                  disabled={!draft.side || playersLoading || !canUseRoster}
                >
                  {showRoster ? "Zwiń" : "Rozwiń"}
                </button>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <label className="grid gap-1 text-sm text-slate-200">
                  Schodzi
                  <select
                    className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none"
                    value={draft.player_out_id}
                    onChange={(e) => setDraft((d) => ({ ...d, player_out_id: e.target.value }))}
                    disabled={!canEdit || loading || !draft.side || playersLoading || !canUseRoster}
                  >
                    <option value="">Wybierz</option>
                    {selectedTeamPlayers.map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {playerLabel(p)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-1 text-sm text-slate-200">
                  Wchodzi
                  <select
                    className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none"
                    value={draft.player_in_id}
                    onChange={(e) => setDraft((d) => ({ ...d, player_in_id: e.target.value }))}
                    disabled={!canEdit || loading || !draft.side || playersLoading || !canUseRoster}
                  >
                    <option value="">Wybierz</option>
                    {selectedTeamPlayers.map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {playerLabel(p)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {showRoster && canUseRoster && (
                <div className="grid max-h-[240px] gap-2 overflow-auto rounded-xl border border-white/10 bg-white/[0.02] p-3">
                  {selectedTeamPlayers.map((p) => (
                    <div key={p.id} className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className={cn(
                          "flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white hover:bg-white/[0.06]",
                          (!canEdit || loading) && "opacity-60"
                        )}
                        onClick={() => setDraft((d) => ({ ...d, player_out_id: String(p.id) }))}
                        disabled={!canEdit || loading}
                      >
                        Schodzi: {playerLabel(p)}
                      </button>

                      <button
                        type="button"
                        className={cn(
                          "flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-white hover:bg-white/[0.06]",
                          (!canEdit || loading) && "opacity-60"
                        )}
                        onClick={() => setDraft((d) => ({ ...d, player_in_id: String(p.id) }))}
                        disabled={!canEdit || loading}
                      >
                        Wchodzi: {playerLabel(p)}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {!canUseRoster && (
                <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-sm text-slate-300">
                  Brak składu dla tej drużyny.
                </div>
              )}
            </div>
          )}

          {showNoteInput && (
            <label className="grid gap-1 text-sm text-slate-200">
              Notatka (opcjonalnie)
              <input
                className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none"
                value={draft.note}
                onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
                placeholder="np. kontuzja"
                disabled={!canEdit || loading}
              />
            </label>
          )}

          {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-slate-400">
              {playersLoading ? "Ładowanie składów..." : playersError ? "Składy: błąd" : homePlayers.length || awayPlayers.length ? "Składy: OK" : "Składy: brak"}
            </div>

            <button
              type="button"
              className={cn(
                "rounded-xl border border-white/10 bg-emerald-500/15 px-3 py-2 text-sm font-semibold text-white",
                (!canEdit || loading) && "opacity-60"
              )}
              onClick={submitIncident}
              disabled={!canEdit || loading}
            >
              Dodaj incydent
            </button>
          </div>
        </div>

        <div className="grid gap-2">
          {loading && incidents.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-3 text-sm text-slate-300">Ładowanie incydentów...</div>
          ) : incidents.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-3 text-sm text-slate-300">Brak incydentów.</div>
          ) : (
            visibleIncidents.map((i) => {
              const teamLabel = i.team_id === homeTeamId ? homeTeamName : i.team_id === awayTeamId ? awayTeamName : "-";
              const isEditing = editIncidentId === i.id;
              const busy = !!updating[i.id];

              return (
                <div key={i.id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm text-slate-200">
                      <span className="font-bold text-white">{i.minute != null ? `${i.minute}'` : "-"}</span>
                      <span className="mx-2 text-slate-500">|</span>
                      <span className="font-semibold text-white">{i.kind_display || i.kind}</span>
                      <span className="mx-2 text-slate-500">|</span>
                      <span className="text-slate-200">{teamLabel}</span>
                      {i.player_name ? <span className="ml-2 text-slate-300">({i.player_name})</span> : null}
                    </div>

                    <div className="flex items-center gap-2">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            className={cn(
                              "rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm font-semibold text-white",
                              busy && "opacity-60"
                            )}
                            onClick={() => saveEdit(i)}
                            disabled={busy}
                          >
                            Zapisz
                          </button>
                          <button
                            type="button"
                            className={cn(
                              "rounded-xl border border-white/10 bg-white/[0.02] px-3 py-1.5 text-sm font-semibold text-white",
                              busy && "opacity-60"
                            )}
                            onClick={cancelEdit}
                            disabled={busy}
                          >
                            Anuluj
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            className={cn(
                              "rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm font-semibold text-white",
                              (!canEdit || loading) && "opacity-60"
                            )}
                            onClick={() => beginEdit(i)}
                            disabled={!canEdit || loading}
                          >
                            Edytuj
                          </button>
                          <button
                            type="button"
                            className={cn(
                              "rounded-xl border border-white/10 bg-red-500/10 px-3 py-1.5 text-sm font-semibold text-white",
                              (!canEdit || loading) && "opacity-60"
                            )}
                            onClick={() => requestDeleteIncident(i)}
                            disabled={!canEdit || loading}
                          >
                            Usuń
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {isEditing && editDraft && (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <label className="grid gap-1 text-sm text-slate-200">
                        Minuta
                        <input
                          className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none"
                          value={editDraft.minute}
                          onChange={(e) => setEditDraft((d) => (d ? { ...d, minute: e.target.value } : d))}
                          inputMode="numeric"
                        />
                      </label>

                      {supportsSubKind(i.kind) ? (
                        <div className="grid gap-2 sm:grid-cols-2">
                          <label className="grid gap-1 text-sm text-slate-200">
                            ID schodzącego
                            <input
                              className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none"
                              value={editDraft.player_out_id}
                              onChange={(e) => setEditDraft((d) => (d ? { ...d, player_out_id: e.target.value } : d))}
                              inputMode="numeric"
                            />
                          </label>
                          <label className="grid gap-1 text-sm text-slate-200">
                            ID wchodzącego
                            <input
                              className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none"
                              value={editDraft.player_in_id}
                              onChange={(e) => setEditDraft((d) => (d ? { ...d, player_in_id: e.target.value } : d))}
                              inputMode="numeric"
                            />
                          </label>
                        </div>
                      ) : supportsPlayerKind(i.kind) ? (
                        <label className="grid gap-1 text-sm text-slate-200">
                          ID zawodnika
                          <input
                            className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none"
                            value={editDraft.player_id}
                            onChange={(e) => setEditDraft((d) => (d ? { ...d, player_id: e.target.value } : d))}
                            inputMode="numeric"
                          />
                        </label>
                      ) : (
                        <div />
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

/*
Co zmieniono:
1) Typ incydentu i wybór drużyny przeniesiono z select na szybkie pola wyboru (przyciski).
2) Minuta to jedno pole edytowalne - domyślnie uzupełniane z zegara, bez przełączania "z zegara / ręcznie".
3) Dodano roster: select z zawodnikami + "Rozwiń" pokazujące pełną listę do kliknięcia (GET /tournaments/<id>/teams/<id>/players/).
4) Lista incydentów domyślnie pokazuje 3 ostatnie, z opcją "Pokaż wszystkie / Zwiń".
5) Usunięto przycisk "Odśwież" - odświeżanie odbywa się automatycznie po akcjach i po reloadToken.
*/