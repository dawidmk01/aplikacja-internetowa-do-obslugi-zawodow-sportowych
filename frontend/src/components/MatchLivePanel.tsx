import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";

/* =========================
   Types
   ========================= */

type ClockState = "NOT_STARTED" | "RUNNING" | "PAUSED" | "STOPPED";
type ClockPeriod = "NONE" | "FH" | "SH" | "ET1" | "ET2" | "H1" | "H2";

type MatchClockDTO = {
  match_id: number;
  clock_state: ClockState;
  clock_period: ClockPeriod;
  clock_started_at: string | null;
  clock_elapsed_seconds: number;
  clock_added_seconds: number;
  seconds_in_period: number;
  seconds_total: number;
  minute_total: number;
  server_time: string;
};

type IncidentTimeSource = "CLOCK" | "MANUAL";

type IncidentDTO = {
  id: number;
  match_id: number;
  team_id: number;
  kind: string;
  kind_display?: string;
  period: ClockPeriod;
  time_source: IncidentTimeSource;
  minute: number | null;
  minute_raw: string | null;

  player_id: number | null;
  player_name: string | null;

  player_in_id: number | null;
  player_in_name: string | null;

  player_out_id: number | null;
  player_out_name: string | null;

  meta: Record<string, any>;
  created_at: string | null;
};

type PlayerDTO = {
  id: number;
  display_name: string;
  jersey_number?: number | null;
  is_active?: boolean;
};

type Props = {
  tournamentId: string; // z useParams
  discipline: string;

  matchId: number;
  matchStatus: "SCHEDULED" | "IN_PROGRESS" | "RUNNING" | "FINISHED";

  homeTeamId?: number;
  awayTeamId?: number;
  homeTeamName: string;
  awayTeamName: string;

  // edycja live dozwolona gdy mecz NIE jest zakończony
  // lub gdy włączysz tryb edycji zakończonego meczu
  canEdit: boolean;

  // wywołaj po zmianie incydentów, jeżeli backend automatycznie zmienia wynik (np. GOAL)
  onAfterRecompute?: () => Promise<void> | void;
};

type IncidentDraft = {
  kind: string;
  side: "HOME" | "AWAY";
  time_source: IncidentTimeSource;

  minute: string;
  minute_raw: string;

  player_id: number | "";
  player_in_id: number | "";
  player_out_id: number | "";

  // basketball
  points: 1 | 2 | 3;

  // tennis “punkty w gemie”
  tennis_set_no: number;
  tennis_game_no: number;

  // opcjonalna notatka
  note: string;
};

function lower(s: string) {
  return (s ?? "").toLowerCase();
}

function isFootball(discipline: string) {
  return lower(discipline) === "football";
}
function isHandball(discipline: string) {
  return lower(discipline) === "handball";
}
function isBasketball(discipline: string) {
  return lower(discipline) === "basketball";
}
function isTennis(discipline: string) {
  return lower(discipline) === "tennis";
}

function periodOptions(discipline: string): { value: ClockPeriod; label: string }[] {
  if (isFootball(discipline)) {
    return [
      { value: "FH", label: "1 połowa" },
      { value: "SH", label: "2 połowa" },
      { value: "ET1", label: "Dogrywka 1" },
      { value: "ET2", label: "Dogrywka 2" },
    ];
  }
  if (isHandball(discipline)) {
    return [
      { value: "H1", label: "1 połowa" },
      { value: "H2", label: "2 połowa" },
    ];
  }
  return [];
}

function incidentKindOptions(discipline: string): { value: string; label: string }[] {
  if (isTennis(discipline)) {
    return [
      { value: "TENNIS_POINT", label: "Punkt (tenis)" },
      { value: "TENNIS_CODE_VIOLATION", label: "Naruszenie przepisów (tenis)" },
      { value: "TIMEOUT", label: "Przerwa / timeout" },
    ];
  }

  if (isBasketball(discipline)) {
    return [
      { value: "GOAL", label: "Punkt" }, // meta.points = 1/2/3
      { value: "FOUL", label: "Faul" },
      { value: "TIMEOUT", label: "Timeout" },
    ];
  }

  if (isHandball(discipline)) {
    return [
      { value: "GOAL", label: "Bramka" },
      { value: "HANDBALL_TWO_MINUTES", label: "Kara 2 min" },
      { value: "SUBSTITUTION", label: "Zmiana" },
      { value: "FOUL", label: "Faul" },
      { value: "TIMEOUT", label: "Przerwa / timeout" },
    ];
  }

  // default (football + reszta)
  return [
    { value: "GOAL", label: "Bramka" },
    { value: "YELLOW_CARD", label: "Żółta kartka" },
    { value: "RED_CARD", label: "Czerwona kartka" },
    { value: "SUBSTITUTION", label: "Zmiana" },
    { value: "FOUL", label: "Faul" },
    { value: "TIMEOUT", label: "Przerwa / timeout" },
  ];
}

function fmtClockState(s: ClockState) {
  if (s === "NOT_STARTED") return "Nie rozpoczęty";
  if (s === "RUNNING") return "W trakcie";
  if (s === "PAUSED") return "Wstrzymany";
  return "Zatrzymany";
}

function safeInt(v: string): number | null {
  const t = (v ?? "").trim();
  if (!t) return null;
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

/* =========================
   Tennis points display
   ========================= */

function tennisPointLabel(aPts: number, bPts: number): string {
  // 0/15/30/40/AD
  // jeśli ktoś wygrał gema: min 4 punkty i przewaga >=2 => "G"
  if (aPts >= 4 && aPts - bPts >= 2) return "G";
  if (bPts >= 4 && bPts - aPts >= 2) return "—";

  const map = ["0", "15", "30", "40"];
  if (aPts >= 3 && bPts >= 3) {
    if (aPts === bPts) return "40";
    if (aPts === bPts + 1) return "AD";
    // jeśli a przegrywa przewagą, pokażemy "40" a przewaga będzie po drugiej stronie
    return "40";
  }
  return map[Math.min(aPts, 3)] ?? "0";
}

function tennisPointLabelOther(aPts: number, bPts: number): string {
  if (bPts >= 4 && bPts - aPts >= 2) return "G";
  if (aPts >= 4 && aPts - bPts >= 2) return "—";

  const map = ["0", "15", "30", "40"];
  if (aPts >= 3 && bPts >= 3) {
    if (aPts === bPts) return "40";
    if (bPts === aPts + 1) return "AD";
    return "40";
  }
  return map[Math.min(bPts, 3)] ?? "0";
}

/* =========================
   Component
   ========================= */

export default function MatchLivePanel(props: Props) {
  const {
    tournamentId,
    discipline,
    matchId,
    matchStatus,
    homeTeamId,
    awayTeamId,
    homeTeamName,
    awayTeamName,
    canEdit,
    onAfterRecompute,
  } = props;

  // Zachowuj stan rozwinięcia panelu także po odświeżeniu strony.
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(`matchLivePanelOpen:${matchId}`) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(`matchLivePanelOpen:${matchId}`, open ? "1" : "0");
    } catch {
      // ignore
    }
  }, [open, matchId]);

  // clock
  const [clock, setClock] = useState<MatchClockDTO | null>(null);
  const [clockLoading, setClockLoading] = useState(false);
  const [clockError, setClockError] = useState<string | null>(null);

  // incidents
  const [incidents, setIncidents] = useState<IncidentDTO[]>([]);
  const [incLoading, setIncLoading] = useState(false);
  const [incError, setIncError] = useState<string | null>(null);

  // roster cache per team
  const [playersByTeam, setPlayersByTeam] = useState<Record<number, PlayerDTO[]>>({});
  const [playersLoading, setPlayersLoading] = useState<Record<number, boolean>>({});

  const defaultKind = useMemo(() => {
    const opts = incidentKindOptions(discipline);
    return opts[0]?.value ?? "GOAL";
  }, [discipline]);

  const [draft, setDraft] = useState<IncidentDraft>(() => ({
    kind: defaultKind,
    side: "HOME",
    time_source: "CLOCK",
    minute: "",
    minute_raw: "",
    player_id: "",
    player_in_id: "",
    player_out_id: "",
    points: 2,
    tennis_set_no: 1,
    tennis_game_no: 1,
    note: "",
  }));

  useEffect(() => {
    // gdy zmienia się dyscyplina albo match, ustaw domyślny kind
    setDraft((d) => ({
      ...d,
      kind: defaultKind,
      side: "HOME",
      time_source: "CLOCK",
      player_id: "",
      player_in_id: "",
      player_out_id: "",
      points: 2,
      tennis_set_no: 1,
      tennis_game_no: 1,
      note: "",
      minute: "",
      minute_raw: "",
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultKind, matchId]);

  const clockUrl = (suffix: string) => `/api/matches/${matchId}/clock/${suffix}`;

  const loadClock = async () => {
    setClockError(null);
    setClockLoading(true);
    try {
      const res = await apiFetch(`/api/matches/${matchId}/clock/`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || "Nie udało się pobrać zegara.");
      setClock(data);
    } catch (e: any) {
      setClockError(e?.message ?? "Błąd pobierania zegara.");
    } finally {
      setClockLoading(false);
    }
  };

  const postClock = async (suffix: string, body?: any) => {
    setClockError(null);
    setClockLoading(true);
    try {
      const res = await apiFetch(clockUrl(suffix), {
        method: body ? (suffix === "period/" || suffix === "added-seconds/" ? "PATCH" : "POST") : "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || "Operacja zegara nie powiodła się.");
      setClock(data);
    } catch (e: any) {
      setClockError(e?.message ?? "Błąd operacji zegara.");
    } finally {
      setClockLoading(false);
    }
  };

  const loadIncidents = async () => {
    setIncError(null);
    setIncLoading(true);
    try {
      const res = await apiFetch(`/api/matches/${matchId}/incidents/`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || "Nie udało się pobrać incydentów.");
      setIncidents(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setIncError(e?.message ?? "Błąd pobierania incydentów.");
    } finally {
      setIncLoading(false);
    }
  };

  const loadTeamPlayers = async (teamId: number) => {
    if (!tournamentId) return;
    if (!teamId) return;

    // cache
    if (playersByTeam[teamId]) return;

    setPlayersLoading((m) => ({ ...m, [teamId]: true }));
    try {
      const res = await apiFetch(`/api/tournaments/${tournamentId}/teams/${teamId}/players/`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || "Nie udało się pobrać składu.");
      const list: PlayerDTO[] = Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : [];
      setPlayersByTeam((p) => ({ ...p, [teamId]: list }));
    } catch {
      // brak twardego błędu w UI – roster jest opcjonalny
    } finally {
      setPlayersLoading((m) => ({ ...m, [teamId]: false }));
    }
  };

  // otwarcie panelu: pobierz zegar + incydenty + rostery (jeśli są teamId)
  useEffect(() => {
    if (!open) return;
    loadClock();
    loadIncidents();
    if (homeTeamId) loadTeamPlayers(homeTeamId);
    if (awayTeamId) loadTeamPlayers(awayTeamId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // polling zegara gdy RUNNING i panel otwarty
  useEffect(() => {
    if (!open) return;
    if (!clock || clock.clock_state !== "RUNNING") return;

    const t = setInterval(() => {
      loadClock().catch(() => null);
    }, 3000);

    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, clock?.clock_state]);

  const teamIdForSide = (side: "HOME" | "AWAY") => (side === "HOME" ? homeTeamId : awayTeamId);

  const teamNameForSide = (side: "HOME" | "AWAY") => (side === "HOME" ? homeTeamName : awayTeamName);

  const submitIncident = async () => {
    setIncError(null);

    const team_id = teamIdForSide(draft.side);
    if (!team_id) {
      setIncError("Brak team_id dla tej strony (home/away).");
      return;
    }

    // walidacja minimalna
    if (!draft.kind) {
      setIncError("Wybierz typ incydentu.");
      return;
    }

    const payload: any = {
      kind: draft.kind,
      team_id,
      time_source: draft.time_source,
    };

    if (draft.time_source === "MANUAL") {
      const minute = safeInt(draft.minute);
      payload.minute = minute;
      payload.minute_raw = (draft.minute_raw || "").trim() || null;
    }

    // player fields
    if (draft.kind === "SUBSTITUTION") {
      if (!draft.player_in_id || !draft.player_out_id) {
        setIncError("Dla zmiany wybierz zawodnika schodzącego i wchodzącego.");
        return;
      }
      payload.player_in_id = draft.player_in_id;
      payload.player_out_id = draft.player_out_id;
    } else {
      if (draft.player_id) payload.player_id = draft.player_id;
    }

    // meta by discipline/kind
    const meta: Record<string, any> = {};

    if (isBasketball(discipline) && draft.kind === "GOAL") {
      meta.points = draft.points;
    }

    if (isTennis(discipline) && draft.kind === "TENNIS_POINT") {
      meta.set_no = Math.max(1, Number(draft.tennis_set_no || 1));
      meta.game_no = Math.max(1, Number(draft.tennis_game_no || 1));
    }

    const note = (draft.note || "").trim();
    if (note) meta.note = note;

    payload.meta = meta;

    setIncLoading(true);
    try {
      const res = await apiFetch(`/api/matches/${matchId}/incidents/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || "Nie udało się dodać incydentu.");

      // odśwież listę incydentów
      await loadIncidents();

      // Backend może automatycznie zmienić wynik (np. GOAL) – odśwież listę meczów w rodzicu.
      await onAfterRecompute?.();

      // TIMEOUT (stop-clock sports) może automatycznie spauzować zegar na backendzie.
      if (draft.kind === "TIMEOUT") {
        await loadClock();
      }

      // czyść część pól
      setDraft((d) => ({
        ...d,
        time_source: "CLOCK",
        minute: "",
        minute_raw: "",
        player_id: "",
        player_in_id: "",
        player_out_id: "",
        note: "",
      }));
    } catch (e: any) {
      setIncError(e?.message ?? "Błąd dodawania incydentu.");
    } finally {
      setIncLoading(false);
    }
  };

  const deleteIncident = async (incidentId: number) => {
    setIncError(null);
    setIncLoading(true);
    try {
      const res = await apiFetch(`/api/incidents/${incidentId}/`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail || "Nie udało się usunąć incydentu.");
      }
      await loadIncidents();

      // Backend może automatycznie zmienić wynik (np. GOAL) – odśwież listę meczów w rodzicu.
      await onAfterRecompute?.();
    } catch (e: any) {
      setIncError(e?.message ?? "Błąd usuwania incydentu.");
    } finally {
      setIncLoading(false);
    }
  };

  const kinds = useMemo(() => incidentKindOptions(discipline), [discipline]);

  const rosterHome = homeTeamId ? playersByTeam[homeTeamId] ?? [] : [];
  const rosterAway = awayTeamId ? playersByTeam[awayTeamId] ?? [] : [];

  const rosterForSide = (side: "HOME" | "AWAY") => (side === "HOME" ? rosterHome : rosterAway);

  const showPlayerSelect =
    !isTennis(discipline) &&
    ["GOAL", "YELLOW_CARD", "RED_CARD", "FOUL", "HANDBALL_TWO_MINUTES"].includes(draft.kind);

  const showSubSelect = draft.kind === "SUBSTITUTION";

  // tenis: licz aktualny wynik punktów w “wybranym” gemie
  const tennisPointsView = useMemo(() => {
    if (!isTennis(discipline)) return null;
    if (!homeTeamId || !awayTeamId) return null;

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
  }, [discipline, incidents, draft.tennis_set_no, draft.tennis_game_no, homeTeamId, awayTeamId]);

  const inProgress = matchStatus === "IN_PROGRESS" || matchStatus === "RUNNING";

  const headerBg =
    matchStatus === "FINISHED"
      ? "rgba(30,144,255,0.10)"
      : inProgress
      ? "rgba(46,204,113,0.08)"
      : "rgba(255,255,255,0.02)";

  return (
    <div style={{ marginTop: "0.9rem" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          padding: "0.45rem 0.8rem",
          borderRadius: 6,
          border: "1px solid #444",
          background: headerBg,
          color: "#fff",
          cursor: "pointer",
          fontSize: "0.85em",
        }}
      >
        {open ? "Ukryj LIVE (zegar + incydenty)" : "Pokaż LIVE (zegar + incydenty)"}
      </button>

      {open && (
        <div
          style={{
            marginTop: "0.75rem",
            border: "1px solid #333",
            borderRadius: 10,
            padding: "0.85rem",
            background: "rgba(0,0,0,0.15)",
            display: "grid",
            gap: "0.9rem",
          }}
        >
          {/* ===================== CLOCK ===================== */}
          <div
            style={{
              border: "1px solid #333",
              borderRadius: 10,
              padding: "0.85rem",
              background: "rgba(255,255,255,0.02)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontWeight: 700 }}>Zegar</div>
              <div style={{ opacity: 0.8, fontSize: "0.9em" }}>
                Stan: <strong>{clock ? fmtClockState(clock.clock_state) : "—"}</strong>
                {clock && clock.clock_period !== "NONE" && (
                  <>
                    {" "}
                    | Okres: <strong>{clock.clock_period}</strong>
                  </>
                )}
                {clock && (
                  <>
                    {" "}
                    | Minuta: <strong>{clock.minute_total}</strong>
                  </>
                )}
              </div>
            </div>

            {clockError && <div style={{ marginTop: 8, color: "crimson" }}>{clockError}</div>}

            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button
                type="button"
                disabled={clockLoading || !canEdit}
                onClick={() => postClock("start/")}
                style={{ padding: "0.35rem 0.7rem", borderRadius: 6, border: "1px solid #444", background: "rgba(46,204,113,0.15)", color: "#fff" }}
              >
                Start
              </button>
              <button
                type="button"
                disabled={clockLoading || !canEdit}
                onClick={() => postClock("pause/")}
                style={{ padding: "0.35rem 0.7rem", borderRadius: 6, border: "1px solid #444", background: "rgba(255,255,255,0.04)", color: "#fff" }}
              >
                Pauza
              </button>
              <button
                type="button"
                disabled={clockLoading || !canEdit}
                onClick={() => postClock("resume/")}
                style={{ padding: "0.35rem 0.7rem", borderRadius: 6, border: "1px solid #444", background: "rgba(255,255,255,0.04)", color: "#fff" }}
              >
                Wznów
              </button>
              <button
                type="button"
                disabled={clockLoading || !canEdit}
                onClick={() => postClock("stop/")}
                style={{ padding: "0.35rem 0.7rem", borderRadius: 6, border: "1px solid #444", background: "rgba(231,76,60,0.12)", color: "#fff" }}
              >
                Stop
              </button>

              <button
                type="button"
                disabled={clockLoading}
                onClick={loadClock}
                style={{ padding: "0.35rem 0.7rem", borderRadius: 6, border: "1px solid #444", background: "rgba(255,255,255,0.04)", color: "#fff" }}
              >
                Odśwież
              </button>
            </div>

            {/* okres gry */}
            {periodOptions(discipline).length > 0 && (
              <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ opacity: 0.8, fontSize: "0.9em" }}>Okres gry:</div>
                <select
                  value={clock?.clock_period && clock.clock_period !== "NONE" ? clock.clock_period : periodOptions(discipline)[0].value}
                  disabled={clockLoading || !canEdit}
                  onChange={(e) => postClock("period/", { period: e.target.value })}
                  style={{ padding: "0.35rem 0.5rem", borderRadius: 6, background: "rgba(0,0,0,0.25)", color: "#fff", border: "1px solid #444" }}
                >
                  {periodOptions(discipline).map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>

                {/* doliczony czas tylko w piłce nożnej */}
                {isFootball(discipline) && (
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ opacity: 0.8, fontSize: "0.9em" }}>Doliczony czas (sek):</span>
                    <input
                      type="number"
                      min={0}
                      value={clock?.clock_added_seconds ?? 0}
                      disabled={clockLoading || !canEdit}
                      onChange={(e) => postClock("added-seconds/", { added_seconds: Math.max(0, Number(e.target.value || 0)) })}
                      style={{ width: 100, textAlign: "center", padding: "0.35rem", borderRadius: 6, border: "1px solid #444", background: "rgba(0,0,0,0.25)", color: "#fff" }}
                    />
                  </div>
                )}
              </div>
            )}

            {!canEdit && (
              <div style={{ marginTop: 10, opacity: 0.75, fontSize: "0.9em" }}>
                Edycja zegara jest zablokowana (mecz zakończony bez trybu edycji).
              </div>
            )}
          </div>

          {/* ===================== INCIDENTS ===================== */}
          <div
            style={{
              border: "1px solid #333",
              borderRadius: 10,
              padding: "0.85rem",
              background: "rgba(255,255,255,0.02)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontWeight: 700 }}>Incydenty</div>

              <div style={{ opacity: 0.65, fontSize: "0.85em" }}>
                Wynik aktualizuje się automatycznie na podstawie incydentów (GOAL).
              </div>
            </div>

            {incError && <div style={{ marginTop: 8, color: "crimson" }}>{incError}</div>}

            {/* form */}
            <div
              style={{
                marginTop: 10,
                border: "1px dashed #444",
                borderRadius: 10,
                padding: "0.75rem",
                opacity: canEdit ? 1 : 0.75,
              }}
            >
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ opacity: 0.85, fontSize: "0.9em" }}>Typ:</div>
                <select
                  value={draft.kind}
                  disabled={!canEdit || incLoading}
                  onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value, player_id: "", player_in_id: "", player_out_id: "" }))}
                  style={{ padding: "0.35rem 0.5rem", borderRadius: 6, background: "rgba(0,0,0,0.25)", color: "#fff", border: "1px solid #444" }}
                >
                  {kinds.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>

                <div style={{ marginLeft: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="radio"
                      name={`side-${matchId}`}
                      checked={draft.side === "HOME"}
                      disabled={!canEdit || incLoading}
                      onChange={() => setDraft((d) => ({ ...d, side: "HOME" }))}
                    />
                    <span style={{ opacity: 0.9 }}>{homeTeamName}</span>
                  </label>
                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="radio"
                      name={`side-${matchId}`}
                      checked={draft.side === "AWAY"}
                      disabled={!canEdit || incLoading}
                      onChange={() => setDraft((d) => ({ ...d, side: "AWAY" }))}
                    />
                    <span style={{ opacity: 0.9 }}>{awayTeamName}</span>
                  </label>
                </div>
              </div>

              {/* time source */}
              <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ opacity: 0.85, fontSize: "0.9em" }}>Czas:</div>

                <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    type="radio"
                    name={`ts-${matchId}`}
                    checked={draft.time_source === "CLOCK"}
                    disabled={!canEdit || incLoading}
                    onChange={() => setDraft((d) => ({ ...d, time_source: "CLOCK" }))}
                  />
                  <span>Z zegara</span>
                </label>

                <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    type="radio"
                    name={`ts-${matchId}`}
                    checked={draft.time_source === "MANUAL"}
                    disabled={!canEdit || incLoading}
                    onChange={() => setDraft((d) => ({ ...d, time_source: "MANUAL" }))}
                  />
                  <span>Ręcznie</span>
                </label>

                {draft.time_source === "MANUAL" && (
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <input
                      placeholder="min (np. 73)"
                      value={draft.minute}
                      disabled={!canEdit || incLoading}
                      onChange={(e) => setDraft((d) => ({ ...d, minute: e.target.value }))}
                      style={{ width: 120, padding: "0.35rem", borderRadius: 6, border: "1px solid #444", background: "rgba(0,0,0,0.25)", color: "#fff" }}
                    />
                    <input
                      placeholder="minute_raw (np. 90+3)"
                      value={draft.minute_raw}
                      disabled={!canEdit || incLoading}
                      onChange={(e) => setDraft((d) => ({ ...d, minute_raw: e.target.value }))}
                      style={{ width: 160, padding: "0.35rem", borderRadius: 6, border: "1px solid #444", background: "rgba(0,0,0,0.25)", color: "#fff" }}
                    />
                  </div>
                )}
              </div>

              {/* extra fields by kind */}
              {isBasketball(discipline) && draft.kind === "GOAL" && (
                <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ opacity: 0.85, fontSize: "0.9em" }}>Punkty:</div>
                  <select
                    value={draft.points}
                    disabled={!canEdit || incLoading}
                    onChange={(e) => setDraft((d) => ({ ...d, points: Number(e.target.value) as 1 | 2 | 3 }))}
                    style={{ padding: "0.35rem 0.5rem", borderRadius: 6, background: "rgba(0,0,0,0.25)", color: "#fff", border: "1px solid #444" }}
                  >
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                  </select>
                </div>
              )}

              {isTennis(discipline) && draft.kind === "TENNIS_POINT" && (
                <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <div style={{ opacity: 0.85, fontSize: "0.9em" }}>Tenis:</div>

                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ opacity: 0.85 }}>Set</span>
                    <input
                      type="number"
                      min={1}
                      value={draft.tennis_set_no}
                      disabled={!canEdit || incLoading}
                      onChange={(e) => setDraft((d) => ({ ...d, tennis_set_no: Math.max(1, Number(e.target.value || 1)) }))}
                      style={{ width: 80, textAlign: "center", padding: "0.35rem", borderRadius: 6, border: "1px solid #444", background: "rgba(0,0,0,0.25)", color: "#fff" }}
                    />
                  </label>

                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <span style={{ opacity: 0.85 }}>Gem</span>
                    <input
                      type="number"
                      min={1}
                      value={draft.tennis_game_no}
                      disabled={!canEdit || incLoading}
                      onChange={(e) => setDraft((d) => ({ ...d, tennis_game_no: Math.max(1, Number(e.target.value || 1)) }))}
                      style={{ width: 80, textAlign: "center", padding: "0.35rem", borderRadius: 6, border: "1px solid #444", background: "rgba(0,0,0,0.25)", color: "#fff" }}
                    />
                  </label>

                  <button
                    type="button"
                    disabled={!canEdit || incLoading}
                    onClick={() => setDraft((d) => ({ ...d, tennis_game_no: Math.max(1, Number(d.tennis_game_no || 1)) + 1 }))}
                    style={{ padding: "0.35rem 0.7rem", borderRadius: 6, border: "1px solid #444", background: "rgba(255,255,255,0.04)", color: "#fff" }}
                    title="Przejdź do następnego gema (tylko stan UI; punkty zapisują się w meta set_no/game_no)"
                  >
                    Następny gem
                  </button>

                  {tennisPointsView && (
                    <div style={{ marginLeft: 10, opacity: 0.9, fontSize: "0.9em" }}>
                      Aktualny gem (Set {tennisPointsView.setNo}, Gem {tennisPointsView.gameNo}):{" "}
                      <strong>
                        {homeTeamName} {tennisPointsView.homeLabel} : {tennisPointsView.awayLabel} {awayTeamName}
                      </strong>
                    </div>
                  )}
                </div>
              )}

              {showPlayerSelect && (
                <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <div style={{ opacity: 0.85, fontSize: "0.9em" }}>Zawodnik (opcjonalnie):</div>
                  <select
                    value={draft.player_id}
                    disabled={!canEdit || incLoading}
                    onChange={(e) => setDraft((d) => ({ ...d, player_id: e.target.value ? Number(e.target.value) : "" }))}
                    style={{ padding: "0.35rem 0.5rem", borderRadius: 6, background: "rgba(0,0,0,0.25)", color: "#fff", border: "1px solid #444", minWidth: 240 }}
                  >
                    <option value="">— brak —</option>
                    {rosterForSide(draft.side).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.jersey_number != null ? `#${p.jersey_number} ` : ""}
                        {p.display_name}
                      </option>
                    ))}
                  </select>

                  {teamIdForSide(draft.side) && playersLoading[teamIdForSide(draft.side)!] && (
                    <span style={{ opacity: 0.75, fontSize: "0.85em" }}>Ładowanie składu…</span>
                  )}
                </div>
              )}

              {showSubSelect && (
                <div style={{ marginTop: 10, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                  <div style={{ opacity: 0.85, fontSize: "0.9em" }}>Zmiana:</div>

                  <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ opacity: 0.85 }}>Schodzi</span>
                    <select
                      value={draft.player_out_id}
                      disabled={!canEdit || incLoading}
                      onChange={(e) => setDraft((d) => ({ ...d, player_out_id: e.target.value ? Number(e.target.value) : "" }))}
                      style={{ padding: "0.35rem 0.5rem", borderRadius: 6, background: "rgba(0,0,0,0.25)", color: "#fff", border: "1px solid #444", minWidth: 220 }}
                    >
                      <option value="">— wybierz —</option>
                      {rosterForSide(draft.side).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.jersey_number != null ? `#${p.jersey_number} ` : ""}
                          {p.display_name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ opacity: 0.85 }}>Wchodzi</span>
                    <select
                      value={draft.player_in_id}
                      disabled={!canEdit || incLoading}
                      onChange={(e) => setDraft((d) => ({ ...d, player_in_id: e.target.value ? Number(e.target.value) : "" }))}
                      style={{ padding: "0.35rem 0.5rem", borderRadius: 6, background: "rgba(0,0,0,0.25)", color: "#fff", border: "1px solid #444", minWidth: 220 }}
                    >
                      <option value="">— wybierz —</option>
                      {rosterForSide(draft.side).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.jersey_number != null ? `#${p.jersey_number} ` : ""}
                          {p.display_name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}

              <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <input
                  placeholder="Notatka (opcjonalnie)"
                  value={draft.note}
                  disabled={!canEdit || incLoading}
                  onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
                  style={{ flex: "1 1 320px", padding: "0.35rem", borderRadius: 6, border: "1px solid #444", background: "rgba(0,0,0,0.25)", color: "#fff" }}
                />

                <button
                  type="button"
                  disabled={!canEdit || incLoading}
                  onClick={submitIncident}
                  style={{
                    padding: "0.45rem 0.9rem",
                    borderRadius: 6,
                    border: "1px solid rgba(46,204,113,0.5)",
                    background: "rgba(46,204,113,0.15)",
                    color: "#fff",
                    cursor: "pointer",
                    opacity: !canEdit ? 0.55 : 1,
                    fontWeight: 700,
                  }}
                >
                  Dodaj incydent
                </button>
              </div>

              {!canEdit && (
                <div style={{ marginTop: 10, opacity: 0.75, fontSize: "0.9em" }}>
                  Dodawanie/usuwanie incydentów jest zablokowane (mecz zakończony bez trybu edycji).
                </div>
              )}
            </div>

            {/* list */}
            <div style={{ marginTop: 12 }}>
              <div style={{ opacity: 0.85, marginBottom: 8 }}>
                Lista incydentów ({incidents.length}){" "}
                <button
                  type="button"
                  disabled={incLoading}
                  onClick={loadIncidents}
                  style={{ marginLeft: 8, padding: "0.25rem 0.6rem", borderRadius: 6, border: "1px solid #444", background: "rgba(255,255,255,0.04)", color: "#fff" }}
                >
                  Odśwież
                </button>
              </div>

              {incLoading && incidents.length === 0 && <div style={{ opacity: 0.75 }}>Ładowanie…</div>}

              {incidents.length === 0 ? (
                <div style={{ opacity: 0.75 }}>Brak incydentów.</div>
              ) : (
                <div style={{ display: "grid", gap: 6 }}>
                  {incidents.map((i) => (
                    <div
                      key={i.id}
                      style={{
                        display: "flex",
                        gap: 10,
                        justifyContent: "space-between",
                        alignItems: "center",
                        border: "1px solid #333",
                        borderRadius: 8,
                        padding: "0.55rem 0.65rem",
                        background: "rgba(0,0,0,0.10)",
                      }}
                    >
                      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                        <div style={{ minWidth: 78, opacity: 0.85 }}>
                          {i.minute_raw ? i.minute_raw : i.minute != null ? `${i.minute}'` : "—"}
                        </div>

                        <div style={{ fontWeight: 700 }}>{i.kind_display ?? i.kind}</div>

                        <div style={{ opacity: 0.85 }}>
                          {i.team_id === homeTeamId ? homeTeamName : i.team_id === awayTeamId ? awayTeamName : `Team ${i.team_id}`}
                        </div>

                        {(i.player_name || i.player_in_name || i.player_out_name) && (
                          <div style={{ opacity: 0.8, fontSize: "0.9em" }}>
                            {i.kind === "SUBSTITUTION"
                              ? `Zmiana: ${i.player_out_name ?? "—"} → ${i.player_in_name ?? "—"}`
                              : `Zawodnik: ${i.player_name ?? "—"}`}
                          </div>
                        )}

                        {isBasketball(discipline) && i.kind === "GOAL" && typeof i.meta?.points === "number" && (
                          <div style={{ opacity: 0.85, fontSize: "0.9em" }}>({i.meta.points} pkt)</div>
                        )}

                        {isTennis(discipline) && i.kind === "TENNIS_POINT" && (
                          <div style={{ opacity: 0.85, fontSize: "0.9em" }}>
                            (Set {i.meta?.set_no ?? 1}, Gem {i.meta?.game_no ?? 1})
                          </div>
                        )}

                        {typeof i.meta?.note === "string" && i.meta.note.trim() && (
                          <div style={{ opacity: 0.75, fontSize: "0.9em" }}>— {i.meta.note}</div>
                        )}
                      </div>

                      <div>
                        <button
                          type="button"
                          disabled={!canEdit || incLoading}
                          onClick={() => deleteIncident(i.id)}
                          style={{
                            padding: "0.25rem 0.6rem",
                            borderRadius: 6,
                            border: "1px solid #444",
                            background: "rgba(231,76,60,0.12)",
                            color: "#fff",
                            cursor: "pointer",
                            opacity: !canEdit ? 0.55 : 1,
                          }}
                        >
                          Usuń
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ marginTop: 10, opacity: 0.75, fontSize: "0.85em" }}>
              Uwaga: “Szybki wynik” (np. 25:23) nadal działa niezależnie. Incydenty służą do prowadzenia meczu live i zapisu minut/zawodników.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
