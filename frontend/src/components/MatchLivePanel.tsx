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

  // legacy fields (Twoja aktualna wersja)
  seconds_in_period?: number;
  seconds_total?: number;
  minute_total?: number;
  server_time: string;

  // nowe (opcjonalnie – jeśli masz już zaktualizowany backend match_clock.py)
  is_break?: boolean;
  break_seconds?: number;
  break_level?: "NORMAL" | "WARN" | "DANGER";
  write_locked?: boolean;
  cap_reached?: boolean;
  max_clock_seconds?: number;
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

type MatchStatus = "SCHEDULED" | "IN_PROGRESS" | "RUNNING" | "FINISHED";

type PendingConfirm = {
  kind: "FINISH_FORCE";
  title: string;
  detail: string;
  delete_count?: number;
  delete_ids?: number[];
};

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;


}

function periodBaseOffsetSeconds(discipline: string, period: ClockPeriod): number {
  // Wyświetlanie "minuty meczu" jako czasu narastającego (np. 2 połowa startuje od 45:00).
  // Sam zegar po stronie API nadal pracuje per-okres (seconds_in_period), tu tylko prezentacja.
  const d = (discipline || "").toLowerCase();

  const isFootballLike = d === "football" || d === "ice_hockey";
  const isHandballLike = d === "handball";
  const isBasketballLike = d === "basketball";

  // Football domyślnie: 45/45 + ET 15/15.
  if (isFootballLike) {
    if (period === "SH") return 45 * 60;
    if (period === "ET1") return 90 * 60;
    if (period === "ET2") return 105 * 60;
    return 0;
  }

  // Handball: 30/30 + ET 5/5 (domyślnie).
  if (isHandballLike) {
    if (period === "H2") return 30 * 60;
    if (period === "ET1") return 60 * 60;
    if (period === "ET2") return 65 * 60;
    return 0;
  }

  // Basketball: brak offsetu (w API nie ma kwart).
  if (isBasketballLike) return 0;

  return 0;
}


export type LiveMatchSummary = {
  id: number;
  status: MatchStatus;

  homeTeamId?: number;
  awayTeamId?: number;
  homeTeamName: string;
  awayTeamName: string;
};

type PropsCommon = {
  // Jeśli w TournamentResults włączona jest dogrywka,
  // bramki/punkty (GOAL) dodane w LIVE powinny trafić do dogrywki.
  goalScope?: "REGULAR" | "EXTRA_TIME";

  tournamentId: string; // z useParams
  discipline: string;

  canEdit: boolean;

  // Kontekst wyniku / etapu (z karty meczu). Używane m.in. do logiki dogrywki.
  scoreContext?: {
    home: number;
    away: number;
    stageType?: string;
    wentToExtraTime?: boolean;
  };

  // Potwierdzenie (modal) przed usunięciem incydentu.
  onRequestConfirmIncidentDelete?: (req: any, proceed: () => void) => void;

  // Gdy zegar przełącza się na dogrywkę (ET1) – chcemy natychmiast odzwierciedlić to w karcie meczu.
  onEnterExtraTime?: () => void;

  onAfterRecompute?: () => Promise<void> | void;
};

type Props =
  | (PropsCommon & { match: LiveMatchSummary })
  | (PropsCommon & {
      matchId: number;
      matchStatus: MatchStatus;

      homeTeamId?: number;
      awayTeamId?: number;
      homeTeamName: string;
      awayTeamName: string;
    });


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

  // tennis
  tennis_set_no: number;
  tennis_game_no: number;

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
      { value: "ET1", label: "Dogrywka 1" },
      { value: "ET2", label: "Dogrywka 2" },

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
      { value: "GOAL", label: "Punkt" },
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

function fmtMMSS(totalSeconds: number | null | undefined) {
  const sec = Math.max(0, Number(totalSeconds || 0));
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
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
   Break UI helpers (frontend-only)
   ========================= */

// NOTE: the code uses BreakMode.* as values at runtime (e.g. BreakMode.NONE).
// A TS-only `type` would be erased and cause `ReferenceError: BreakMode is not defined`.
const BreakMode = {
  NONE: "NONE",
  INTERMISSION: "INTERMISSION",
  TECH: "TECH",
} as const;
type BreakMode = (typeof BreakMode)[keyof typeof BreakMode];

function breakKey(matchId: number, key: "mode" | "startedAt") {
  return `matchBreak:${matchId}:${key}`;
}

function readBreakMode(matchId: number): BreakMode {
  try {
    return (localStorage.getItem(breakKey(matchId, "mode")) as BreakMode) || BreakMode.NONE;
  } catch {
    return BreakMode.NONE;
  }
}

function writeBreakMode(matchId: number, mode: BreakMode) {
  try {
    localStorage.setItem(breakKey(matchId, "mode"), mode);
  } catch {
    // ignore
  }
}

function readBreakStartedAt(matchId: number): number | null {
  try {
    const raw = localStorage.getItem(breakKey(matchId, "startedAt"));
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function writeBreakStartedAt(matchId: number, tsMs: number | null) {
  try {
    if (!tsMs) localStorage.removeItem(breakKey(matchId, "startedAt"));
    else localStorage.setItem(breakKey(matchId, "startedAt"), String(tsMs));
  } catch {
    // ignore
  }
}

function clearBreak(matchId: number) {
  writeBreakMode(matchId, "NONE");
  writeBreakStartedAt(matchId, null);
}

function computeBreakLevel(seconds: number): "NORMAL" | "WARN" | "DANGER" {
  if (seconds >= 15 * 60) return "DANGER";
  if (seconds >= 13 * 60) return "WARN";
  return "NORMAL";
}

function periodLimitSeconds(discipline: string, period: ClockPeriod): number | null {
  // Limity per okres (w sekundach). Służą wyłącznie do wizualnej sygnalizacji przekroczenia czasu.
  if (isFootball(discipline)) {
    if (period === "FH" || period === "SH") return 45 * 60;
    if (period === "ET1" || period === "ET2") return 15 * 60;
  }
  if (isHandball(discipline)) {
    if (period === "H1" || period === "H2") return 30 * 60;
    if (period === "ET1" || period === "ET2") return 5 * 60;
  }
  return null;
}

function isKnockoutLike(stageType?: string): boolean {
  const s = String(stageType || "").toUpperCase();
  return s === "KNOCKOUT" || s === "THIRD_PLACE";
}

function nextPeriodFromIntermission(discipline: string, current: ClockPeriod, opts: { allowExtraTimeStart: boolean }): ClockPeriod | null {
  const allowExtraTimeStart = !!opts.allowExtraTimeStart;
  if (isFootball(discipline)) {
    if (current === "FH") return "SH";
    if (current === "SH" && allowExtraTimeStart) return "ET1";
    if (current === "ET1") return "ET2";
    return null;
  }
  if (isHandball(discipline)) {
    if (current === "H1") return "H2";
    if (current === "H2" && allowExtraTimeStart) return "ET1";
    if (current === "ET1") return "ET2";
    return null;
  }
  return null;
}

function nextPeriodForSecondHalf(discipline: string, current: ClockPeriod): ClockPeriod | null {
  if (isFootball(discipline)) {
    if (current === "FH") return "SH";
    return null;
  }
  if (isHandball(discipline)) {
    if (current === "H1") return "H2";
    return null;
  }
  return null;
}

/* =========================
   Tennis points display
   ========================= */

function tennisPointLabel(aPts: number, bPts: number): string {
  if (aPts >= 4 && aPts - bPts >= 2) return "G";
  if (bPts >= 4 && bPts - aPts >= 2) return "—";

  const map = ["0", "15", "30", "40"];
  if (aPts >= 3 && bPts >= 3) {
    if (aPts === bPts) return "40";
    if (aPts === bPts + 1) return "AD";
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
  const { tournamentId, discipline, goalScope = "REGULAR", canEdit, onAfterRecompute } = props;

  // Wspieramy dwa kontrakty propsów:
  // 1) nowy: props.match (bardziej spójny, minimalizuje duplikację pomiędzy stroną i komponentem),
  // 2) stary: matchId/matchStatus/homeTeamId/... (wsteczna kompatybilność).
  const liveMatch: LiveMatchSummary =
    "match" in props
      ? props.match
      : {
          id: props.matchId,
          status: props.matchStatus,
          homeTeamId: props.homeTeamId,
          awayTeamId: props.awayTeamId,
          homeTeamName: props.homeTeamName,
          awayTeamName: props.awayTeamName,
        };

  const matchId = liveMatch.id;
  const matchStatus = liveMatch.status;

  const homeTeamId = liveMatch.homeTeamId;
  const awayTeamId = liveMatch.awayTeamId;

  const homeTeamName = liveMatch.homeTeamName;
  const awayTeamName = liveMatch.awayTeamName;

  const [clock, setClock] = useState<MatchClockDTO | null>(null);
  // lokalny tick do wyświetlania czasu meczu (mm:ss) w UI bez ciągłego odpytywania backendu
  const [clockTick, setClockTick] = useState(0);
  const [clockLoading, setClockLoading] = useState(false);
  const [clockError, setClockError] = useState<string | null>(null);

  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [pendingConfirmBusy, setPendingConfirmBusy] = useState(false);


  // break ui
  const [breakMode, setBreakMode] = useState<BreakMode>(() => readBreakMode(matchId));
  const [breakTick, setBreakTick] = useState(0);

  // Aktualizuj wyświetlany czas meczu (mm:ss) lokalnie.
  useEffect(() => {
    if (!clock || clock.clock_state !== "RUNNING") return;
    const t = window.setInterval(() => setClockTick((x) => x + 1), 250);
    return () => window.clearInterval(t);
  }, [clock?.clock_state, clock?.clock_started_at, clock?.server_time]);

  const displaySeconds = useMemo(() => {
    if (!clock) return 0;
    const snapTotal =
      typeof clock.seconds_total === "number"
        ? clock.seconds_total
        : Math.max(0, Number(clock.clock_elapsed_seconds || 0) + Number(clock.clock_added_seconds || 0));

    const snapInPeriod = typeof clock.seconds_in_period === "number" ? Math.max(0, Number(clock.seconds_in_period || 0)) : snapTotal;

    if (clock.clock_state !== "RUNNING") return snapInPeriod;
    if (!clock.server_time) return snapInPeriod;
    const serverMs = new Date(clock.server_time).getTime();
    if (!Number.isFinite(serverMs)) return snapInPeriod;
    const delta = Math.max(0, (Date.now() - serverMs) / 1000);
    return snapInPeriod + delta;
  }, [clock, clockTick]);

  const baseOffsetSeconds = useMemo(() => {
    const p = clock?.clock_period || "NONE";
    return periodBaseOffsetSeconds(discipline, p as ClockPeriod);
  }, [clock?.clock_period, discipline]);

  const matchDisplaySeconds = useMemo(() => {
    return Math.max(0, Number(baseOffsetSeconds || 0) + Number(displaySeconds || 0));
  }, [baseOffsetSeconds, displaySeconds]);


  // incidents
  const [incidents, setIncidents] = useState<IncidentDTO[]>([]);
  const [incLoading, setIncLoading] = useState(false);
  const [incError, setIncError] = useState<string | null>(null);

  const [editIncidentId, setEditIncidentId] = useState<number | null>(null);
  const [editIncidentDraft, setEditIncidentDraft] = useState<{
    minute: string;
    player_id: number | "" | null;
    player_out_id: number | "" | null;
    player_in_id: number | "" | null;
  } | null>(null);
  const [incUpdating, setIncUpdating] = useState<Record<number, boolean>>({});

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

      // jeśli backend mówi, że przerwy nie ma, a my mamy stan lokalny – zostawiamy lokalny,
      // ale gdy zegar RUNNING, resetujemy breakMode (żeby UI nie wisiał na „przerwie”)
      if (data?.clock_state === "RUNNING") {
        clearBreak(matchId);
        setBreakMode("NONE");
      }
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
      const method = body ? (suffix === "period/" || suffix === "added-seconds/" ? "PATCH" : "POST") : "POST";
      const res = await apiFetch(clockUrl(suffix), {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || "Operacja zegara nie powiodła się.");
      setClock(data);
      return data as MatchClockDTO;
    } catch (e: any) {
      setClockError(e?.message ?? "Błąd operacji zegara.");
      throw e;
    } finally {
      setClockLoading(false);
    }
  };

  const loadIncidents = async () => {
    setIncError(null);
    setIncLoading(true);
    try {
      const res = await apiFetch(`/api/matches/${matchId}/incidents/`, { method: "GET" });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.detail || `Błąd pobierania incydentów (${res.status})`);
      }

      // API bywa zwracane jako lista lub obiekt z polem "incidents" / "results".
      const list = Array.isArray(data)
        ? data
        : Array.isArray(data?.incidents)
          ? data.incidents
          : Array.isArray(data?.results)
            ? data.results
            : [];

      setIncidents(list);
    } catch (e: any) {
      setIncError(e?.message || "Błąd pobierania incydentów.");
    } finally {
      setIncLoading(false);
    }
  };

  // Initial sync on mount (important after refresh)
  useEffect(() => {
    loadClock();
    loadIncidents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);



  const teamIdForSide = (side: "HOME" | "AWAY") => (side === "HOME" ? homeTeamId : awayTeamId);
  const teamNameForSide = (side: "HOME" | "AWAY") => (side === "HOME" ? homeTeamName : awayTeamName);

  const isBreakFromBackend = Boolean(clock?.is_break || clock?.write_locked);
  const localMode = breakMode;
  const localStarted = readBreakStartedAt(matchId);

  const localBreakSeconds =
    localMode !== "NONE" && localStarted ? Math.max(0, Math.floor((Date.now() - localStarted) / 1000)) : 0;

  const breakSeconds = typeof clock?.break_seconds === "number" ? clock.break_seconds : localBreakSeconds;
  const breakLevel =
    clock?.break_level ? clock.break_level : computeBreakLevel(breakSeconds);

  const showBreakTimer = (isBreakFromBackend && clock?.clock_state === "PAUSED") || (localMode !== "NONE" && localStarted);

  // Ticker przerwy – wymusza re-render co 1s, aby licznik przerwy aktualizował się w UI.
  useEffect(() => {
    if (!showBreakTimer) return;
    const t = window.setInterval(() => setBreakTick((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, [showBreakTimer, matchId]);

  const canRewind = canEdit && !!clock;

  const handlePrimary = async () => {
    if (!canEdit) return;

    // jeśli nie mamy zegara jeszcze, dociągnij
    if (!clock) {
      await loadClock();
      return;
    }

    // 1) start meczu
    if (clock.clock_state === "NOT_STARTED" || clock.clock_state === "STOPPED") {
      clearBreak(matchId);
      setBreakMode("NONE");
      await postClock("start/");
      return;
    }

    // 2) jeżeli jesteśmy w przerwie międzypołówkowej – rozpocznij drugą połowę
    if (clock.clock_state === "PAUSED" && localMode === "INTERMISSION") {
      const score = props.scoreContext;
      const allowExtraTimeStart =
        !!score && isKnockoutLike(score.stageType) && Number(score.home || 0) === Number(score.away || 0) && !score.wentToExtraTime;

      const next = nextPeriodFromIntermission(discipline, clock.clock_period, { allowExtraTimeStart });
      if (next) {
        await postClock("period/", { period: next });
        if (next === "ET1") {
          props.onEnterExtraTime?.();
        }
      }
      clearBreak(matchId);
      setBreakMode("NONE");
      await postClock("resume/");
      return;
    }

    // 3) zwykłe wznowienie
    if (clock.clock_state === "PAUSED") {
      clearBreak(matchId);
      setBreakMode("NONE");
      await postClock("resume/");
      return;
    }
  };

  const handleIntermissionBreak = async () => {
    if (!canEdit) return;
    // przerwa = pause z body {break:true} (backend rozróżnia przerwę od technicznej pauzy)
    writeBreakMode(matchId, "INTERMISSION");
    writeBreakStartedAt(matchId, Date.now());
    setBreakMode("INTERMISSION");
    await postClock("pause/", { break: true });
  };

  const handleTechPause = async () => {
    if (!canEdit) return;
    // pauza techniczna = zwykłe pause bez break
    writeBreakMode(matchId, "TECH");
    writeBreakStartedAt(matchId, Date.now());
    setBreakMode("TECH");
    await postClock("pause/", { break: false });
  };
  const handleReset = async () => {
    if (!clock) return;

    if (
      !window.confirm(
        "To zresetuje zegar bieżącego okresu do jego początku (bez ingerencji w incydenty i wynik). Kontynuować?"
      )
    ) {
      return;
    }

    setResetting(true);
    try {
      clearBreak(matchId);
      setBreakMode(BreakMode.NONE);

      // Bezpieczny reset: ustawiamy ten sam okres jeszcze raz (backend zeruje elapsed),
      // bez kasowania incydentów.
      const currentPeriod =
        clock.clock_period && clock.clock_period !== "NONE"
          ? clock.clock_period
          : periodOptions(liveMatch.discipline)[0]?.value || "NONE";

      await postClock("period/", { period: currentPeriod });
      await loadClock();
    } catch (e: any) {
      setClockError(e?.message || "Nie udało się zresetować zegara.");
    } finally {
      setResetting(false);
    }
  };
  const runFinish = async (force: boolean) => {
    setClockLoading(true);
    setClockError(null);

    try {
      const url = force
        ? `/api/matches/${matchId}/finish/?force=1`
        : `/api/matches/${matchId}/finish/`;

      const res = await apiFetch(url, { method: "POST" });
      const data: any = await res.json().catch(() => ({}));

      if (res.status === 409 && !force && data?.code === "SCORE_SYNC_CONFIRM_REQUIRED") {
        setPendingConfirm({
          kind: "FINISH_FORCE",
          title: "Potwierdź zakończenie meczu",
          detail: String(data?.detail || "Zmiana wyniku wymaga usunięcia części istniejących incydentów GOAL."),
          delete_count: Number(data?.delete_count || 0),
          delete_ids: Array.isArray(data?.delete_ids) ? data.delete_ids : undefined,
        });
        return;
      }

      if (!res.ok) {
        throw new Error(String(data?.detail || "Nie udało się zakończyć meczu."));
      }

      clearBreak(matchId);
      setBreakMode("NONE");

      await onAfterRecompute?.();
      await loadClock();
      await loadIncidents();
    } catch (e: any) {
      setClockError(e?.message ?? "Błąd zakończenia meczu.");
    } finally {
      setClockLoading(false);
    }
  };

  const handleFinish = async () => {
    await runFinish(false);
  };

  const submitIncident = async () => {
    setIncError(null);

    const team_id = teamIdForSide(draft.side);
    if (!team_id) {
      setIncError("Brak team_id dla tej strony (home/away).");
      return;
    }

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

    if (draft.time_source === "CLOCK") {
      const inIntermission = breakMode === BreakMode.INTERMISSION;
      // W przerwie dopisujemy do końca okresu (np. 45/90), w trakcie gry bierzemy aktualny czas.
      const base = Number(baseOffsetSeconds || 0);
      const absNow = Number(matchDisplaySeconds || 0);
      const absEnd = timeLimitSeconds ? Math.max(0, base + Number(timeLimitSeconds || 0)) : absNow;
      const chosen = inIntermission ? absEnd : absNow;
      payload.minute = Math.max(0, Math.floor(chosen / 60));
      payload.minute_raw = null;
    }

    // CLOCK + brak minute => backend sam policzy.

    // W przerwie backend (po naszej poprawce) przypisze minutę końca okresu (np. 45/90/30/60).

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

    const meta: Record<string, any> = {};

    // Jeśli użytkownik włączył dogrywkę w TournamentResults, to bramki/punkty z LIVE
    // powinny podnosić wynik dogrywki (home_extra_time_score / away_extra_time_score),
    // a nie wynik podstawowy.
    const effectiveGoalScope = goalScope ?? ((clock?.clock_period === "ET1" || clock?.clock_period === "ET2") ? "EXTRA_TIME" : "REGULAR");

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

    setIncLoading(true);
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
        await loadClock();
      }

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
      await onAfterRecompute?.();
    } catch (e: any) {
      setIncError(e?.message ?? "Błąd usuwania incydentu.");
    } finally {
      setIncLoading(false);
    }
  };

  const requestDeleteIncident = (i: IncidentDTO) => {
    const proceed = () => deleteIncident(i.id);

    const handler = props.onRequestConfirmIncidentDelete;
    if (!handler) {
      const ok = window.confirm("Czy na pewno chcesz usunąć ten incydent? Ta operacja jest nieodwracalna.");
      if (ok) proceed();
      return;
    }

    const teamLabel = i.team_id === homeTeamId ? homeTeamName : i.team_id === awayTeamId ? awayTeamName : undefined;
    handler(
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

  const beginEditIncident = (i: IncidentDTO) => {
    setEditIncidentId(i.id);
    setEditIncidentDraft({
      minute: i.minute != null ? String(i.minute) : "",
      player_id: i.player_id ?? "",
      player_out_id: i.player_out_id ?? "",
      player_in_id: i.player_in_id ?? "",
    });
  };

  const cancelEditIncident = () => {
    setEditIncidentId(null);
    setEditIncidentDraft(null);
  };

  const updateIncident = async (incidentId: number, patch: Record<string, any>) => {
    setIncError(null);
    setIncUpdating((prev) => ({ ...prev, [incidentId]: true }));
    try {
      const res = await apiFetch(`/api/incidents/${incidentId}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = data?.detail || data?.code || "Nie udało się zaktualizować incydentu.";
        throw new Error(msg);
      }

      // backend zwraca zaktualizowany incydent
      setIncidents((prev) => prev.map((x) => (x.id === incidentId ? data : x)));

      // po zmianie incydentu backend może przeliczyć wynik (goal-based)
      // dlatego odświeżamy widok incydentów i zegar (bezpiecznie)
      await loadIncidents();
      await loadClock();
    } catch (e: any) {
      setIncError(e?.message || "Nie udało się zaktualizować incydentu.");
    } finally {
      setIncUpdating((prev) => {
        const n = { ...prev };
        delete n[incidentId];
        return n;
      });
    }
  };

  const saveEditIncident = async (i: IncidentDTO) => {
    if (!editIncidentDraft) return;

    const minuteRaw = editIncidentDraft.minute.trim();
    const minute = minuteRaw === "" ? null : Math.max(1, Number(minuteRaw));
    const patch: Record<string, any> = { minute };

    if (supportsSubKind(i.kind)) {
      patch.player_out_id = editIncidentDraft.player_out_id || null;
      patch.player_in_id = editIncidentDraft.player_in_id || null;
    } else if (supportsPlayerKind(i.kind)) {
      patch.player_id = editIncidentDraft.player_id || null;
    }

    await updateIncident(i.id, patch);
    cancelEditIncident();
  };

  const kinds = useMemo(() => incidentKindOptions(discipline), [discipline]);

  const rosterHome = homeTeamId ? playersByTeam[homeTeamId] ?? [] : [];
  const rosterAway = awayTeamId ? playersByTeam[awayTeamId] ?? [] : [];

  const rosterForSide = (side: "HOME" | "AWAY") => (side === "HOME" ? rosterHome : rosterAway);

  const showPlayerSelect =
    !isTennis(discipline) &&
    ["GOAL", "YELLOW_CARD", "RED_CARD", "FOUL", "HANDBALL_TWO_MINUTES"].includes(draft.kind);

  const showSubSelect = draft.kind === "SUBSTITUTION";

  const showMinuteRaw = draft.time_source === "MANUAL" && draft.kind !== "GOAL";
  const showNoteInput = draft.kind !== "GOAL" && draft.kind !== "TENNIS_POINT";

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

  const sideForTeamId = (teamId: number | null | undefined): "HOME" | "AWAY" => (teamId === homeTeamId ? "HOME" : "AWAY");
  const supportsPlayerKind = (kind: string) => {
    // w praktyce: GOAL, CARD, FOUL itp. (dla SUBSTITUTION są osobne pola)
    return kind !== "SUBSTITUTION" && kind !== "TENNIS_POINT";
  };
  const supportsSubKind = (kind: string) => kind === "SUBSTITUTION";

  const inProgress = matchStatus === "IN_PROGRESS" || matchStatus === "RUNNING";

  const headerBg =
    matchStatus === "FINISHED"
      ? "rgba(30,144,255,0.10)"
      : inProgress
      ? "rgba(46,204,113,0.08)"
      : "rgba(255,255,255,0.02)";

  const primaryLabel = useMemo(() => {
    if (!clock) return "Zacznij mecz";
    if (clock.clock_state === "NOT_STARTED" || clock.clock_state === "STOPPED") return "Zacznij mecz";
    if (clock.clock_state === "PAUSED" && breakMode === "INTERMISSION") {
      const score = props.scoreContext;
      const allowExtraTimeStart =
        !!score && isKnockoutLike(score.stageType) && Number(score.home || 0) === Number(score.away || 0) && !score.wentToExtraTime;
      const next = nextPeriodFromIntermission(discipline, clock.clock_period, { allowExtraTimeStart });

      if (next === "SH" || next === "H2") return "Rozpocznij 2 połowę";
      if (next === "ET1") return "Rozpocznij dogrywkę";
      if (next === "ET2") return "Rozpocznij 2 połowę dogrywki";
      return "Rozpocznij kolejny etap";
    }
    if (clock.clock_state === "PAUSED") return "Wznów grę";
    return "W trakcie";
  }, [clock, breakMode, discipline, props.scoreContext]);

  const breakBadgeStyle = useMemo(() => {
    if (!showBreakTimer) return null;
    const bg =
      breakLevel === "DANGER" ? "rgba(231,76,60,0.25)" : breakLevel === "WARN" ? "rgba(241,196,15,0.22)" : "rgba(255,255,255,0.06)";
    const border =
      breakLevel === "DANGER" ? "1px solid rgba(231,76,60,0.55)" : breakLevel === "WARN" ? "1px solid rgba(241,196,15,0.55)" : "1px solid #444";
    return { background: bg, border };
  }, [showBreakTimer, breakLevel, breakTick]);

  const timeLimitSeconds = useMemo(() => {
    if (!clock) return null;
    return periodLimitSeconds(discipline, clock.clock_period);
  }, [clock, discipline]);

  const timeOverLimit = useMemo(() => {
    if (!timeLimitSeconds) return false;
    const absLimit = Math.max(0, Number(baseOffsetSeconds || 0) + Number(timeLimitSeconds || 0));
    return matchDisplaySeconds >= absLimit;
  }, [baseOffsetSeconds, matchDisplaySeconds, timeLimitSeconds]);

  const timeBadgeStyle = useMemo(() => {
    const over = timeOverLimit || Boolean(clock?.cap_reached);
    const bg = over ? "rgba(231,76,60,0.22)" : "rgba(255,255,255,0.06)";
    const border = over ? "1px solid rgba(231,76,60,0.55)" : "1px solid #444";
    return { background: bg, border };
  }, [timeOverLimit, clock?.cap_reached]);

  return (
    <div style={{ marginTop: "0.9rem" }}>
      {pendingConfirm && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: "1rem",
          }}
        >
          <div
            style={{
              background: "white",
              borderRadius: 12,
              maxWidth: 560,
              width: "100%",
              padding: "1rem",
              boxShadow: "0 10px 25px rgba(0,0,0,0.25)",
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 8 }}>{pendingConfirm.title}</div>

            <div style={{ fontSize: 13, lineHeight: 1.45, marginBottom: 10 }}>{pendingConfirm.detail}</div>

            {typeof pendingConfirm.delete_count === "number" && (
              <div style={{ fontSize: 13, marginBottom: 12 }}>
                Do usunięcia: <b>{pendingConfirm.delete_count}</b> incydentów GOAL.
              </div>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => (pendingConfirmBusy ? null : setPendingConfirm(null))}
                style={btnStyle}
                disabled={pendingConfirmBusy}
              >
                Anuluj
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (pendingConfirmBusy) return;
                  setPendingConfirmBusy(true);
                  try {
                    if (pendingConfirm.kind === "FINISH_FORCE") {
                      await runFinish(true);
                    }
                    setPendingConfirm(null);
                  } finally {
                    setPendingConfirmBusy(false);
                  }
                }}
                style={{ ...btnStyle, background: "#111", color: "white" }}
                disabled={pendingConfirmBusy}
              >
                Skoryguj i zakończ
              </button>
            </div>
          </div>
        </div>
      )}


        <div
          style={{
            // Styl bazowy kontroluje komponent-rodzic (karta meczu). Ten blok ma być „w środku karty”,
            // bez własnej ramki/kontrastowego tła, aby LIVE wyglądał jak rozwinięcie meczu, a nie osobny panel.
            marginTop: 0,
            border: "none",
            borderRadius: 0,
            padding: 0,
            background: "transparent",
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
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ fontWeight: 700 }}>Zegar</div>
            </div>

            {clockError && <div style={{ marginTop: 8, color: "crimson" }}>{clockError}</div>}

            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button
                type="button"
                disabled={clockLoading || !canEdit || clock?.clock_state === "RUNNING"}
                onClick={handlePrimary}
                style={{
                  padding: "0.35rem 0.7rem",
                  borderRadius: 6,
                  border: "1px solid #444",
                  background: "rgba(46,204,113,0.18)",
                  color: "#fff",
                }}
              >
                {primaryLabel}
              </button>

              <button
                type="button"
                disabled={clockLoading || !canEdit || !clock || clock.clock_state !== "RUNNING"}
                onClick={handleIntermissionBreak}
                style={{
                  padding: "0.35rem 0.7rem",
                  borderRadius: 6,
                  border: "1px solid #444",
                  background: "rgba(255,255,255,0.05)",
                  color: "#fff",
                }}
              >
                Przerwa
              </button>

              <button
                type="button"
                disabled={clockLoading || !canEdit || !clock || clock.clock_state !== "RUNNING"}
                onClick={handleTechPause}
                style={{
                  padding: "0.35rem 0.7rem",
                  borderRadius: 6,
                  border: "1px solid #444",
                  background: "rgba(255,255,255,0.05)",
                  color: "#fff",
                }}
              >
                Pauza techniczna
              </button>

              <button
                type="button"
                disabled={clockLoading || !canRewind}
                onClick={handleReset}
                title={canRewind ? "Resetuj zegar do początku okresu." : "Brak uprawnień lub zegar niedostępny."}
                style={{
                  padding: "0.35rem 0.7rem",
                  borderRadius: 6,
                  border: "1px solid #444",
                  background: canRewind ? "rgba(231,76,60,0.12)" : "rgba(255,255,255,0.03)",
                  color: "#fff",
                  opacity: canRewind ? 1 : 0.7,
                }}
              >
                Resetuj zegar
              </button>

              <button
                type="button"
                disabled={clockLoading || !canEdit}
                onClick={handleFinish}
                style={{
                  padding: "0.35rem 0.7rem",
                  borderRadius: 6,
                  border: "1px solid #444",
                  background: "rgba(231,76,60,0.14)",
                  color: "#fff",
                }}
              >
                Zakończ mecz
              </button>
</div>

            {clock && (
              <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "0.35rem 0.6rem",
                    borderRadius: 999,
                    ...(timeBadgeStyle as any),
                    color: "#fff",
                    fontSize: "0.9em",
                    fontFamily:
                      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                    fontVariantNumeric: "tabular-nums",
                  }}
                  title={
                    timeLimitSeconds
                      ? `Limit okresu: ${formatClock(timeLimitSeconds)}. Po przekroczeniu badge zmienia kolor na czerwony.`
                      : "Czas meczu (mm:ss)"
                  }
                >
                  <strong style={{ fontFamily: "inherit" }}>Czas meczu:</strong>
                  <span style={{ fontFamily: "inherit" }}>{formatClock(matchDisplaySeconds)}</span>
                  {(timeOverLimit || Boolean(clock?.cap_reached)) && <span style={{ opacity: 0.9 }}>(po czasie)</span>}
                </div>

                {showBreakTimer && (
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "0.35rem 0.6rem",
                      borderRadius: 999,
                      ...(breakBadgeStyle as any),
                      color: "#fff",
                      fontSize: "0.9em",
                    }}
                  >
                    <strong>{breakMode === "TECH" ? "Pauza techniczna:" : "Przerwa:"}</strong>
                    <span>
                      {Math.floor(breakSeconds / 60)}:{String(breakSeconds % 60).padStart(2, "0")}
                    </span>
                    <span style={{ opacity: 0.85 }}>
                      {breakLevel === "WARN" ? "zbliża się 15 min" : breakLevel === "DANGER" ? "przekroczono 15 min" : ""}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* okres gry – zostawiamy select (przydatny awaryjnie), ale to główny przycisk ma prowadzić flow */}
            {periodOptions(discipline).length > 0 && (
              <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ opacity: 0.8, fontSize: "0.9em" }}>Okres gry:</div>
                <select
                  value={clock?.clock_period && clock.clock_period !== "NONE" ? clock.clock_period : periodOptions(discipline)[0].value}
                  disabled={clockLoading || !canEdit}
                  onChange={async (e) => {
                    await postClock("period/", { period: e.target.value });
                    // zmiana okresu to zmiana „kontekstu”; czyścimy lokalną przerwę
                    clearBreak(matchId);
                    setBreakMode("NONE");
                  }}
                  style={{
                    padding: "0.35rem 0.5rem",
                    borderRadius: 6,
                    background: "rgba(0,0,0,0.25)",
                    color: "#fff",
                    border: "1px solid #444",
                  }}
                >
                  {periodOptions(discipline).map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>

                <div style={{ opacity: 0.7, fontSize: "0.85em" }}>
                  W przerwie można dodawać incydenty. Jeśli wybierzesz „z zegara”, system zapisze minutę końca połowy.
                </div>
              </div>
            )}

            {!canEdit && (
              <div style={{ marginTop: 10, opacity: 0.75, fontSize: "0.9em" }}>
                Edycja LIVE jest zablokowana (mecz zakończony bez trybu edycji).
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
                {isTennis(discipline)
                  ? "Tenis: incydenty opisują przebieg (punkty)."
                  : "Bramki/punkty w LIVE mogą aktualizować szybki wynik; w przerwie dopiszesz incydent do końca połowy."}
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
                  <span style={{ opacity: 0.9 }}>Z zegara</span>
                </label>

                <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input
                    type="radio"
                    name={`ts-${matchId}`}
                    checked={draft.time_source === "MANUAL"}
                    disabled={!canEdit || incLoading}
                    onChange={() => setDraft((d) => ({ ...d, time_source: "MANUAL" }))}
                  />
                  <span style={{ opacity: 0.9 }}>Ręcznie</span>
                </label>

                {draft.time_source === "MANUAL" && (
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <input
                      type="text"
                      placeholder="min"
                      value={draft.minute}
                      disabled={!canEdit || incLoading}
                      onChange={(e) => setDraft((d) => ({ ...d, minute: e.target.value }))}
                      style={{ width: 70, textAlign: "center", padding: "0.35rem", borderRadius: 6, border: "1px solid #444", background: "rgba(0,0,0,0.25)", color: "#fff" }}
                    />
                    {showMinuteRaw && (

                      <input

                        type="text"

                        placeholder="opis (opc.)"

                        value={draft.minute_raw}

                        disabled={!canEdit || incLoading}

                        onChange={(e) => setDraft((d) => ({ ...d, minute_raw: e.target.value }))}

                        style={{ width: 160, padding: "0.35rem", borderRadius: 6, border: "1px solid #444", background: "rgba(0,0,0,0.25)", color: "#fff" }}

                      />

                    )}

                  </div>
                )}
              </div>

              {/* players */}
              <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                {showPlayerSelect && (
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ opacity: 0.85, fontSize: "0.9em" }}>Zawodnik:</div>
                    <select
                      value={draft.player_id}
                      disabled={!canEdit || incLoading}
                      onChange={(e) => setDraft((d) => ({ ...d, player_id: e.target.value ? Number(e.target.value) : "" }))}
                      style={{ padding: "0.35rem 0.5rem", borderRadius: 6, background: "rgba(0,0,0,0.25)", color: "#fff", border: "1px solid #444", minWidth: 250 }}
                    >
                      <option value="">(brak)</option>
                      {rosterForSide(draft.side).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.display_name}
                          {p.jersey_number != null ? ` (#${p.jersey_number})` : ""}
                        </option>
                      ))}
                    </select>

                    {playersLoading[teamIdForSide(draft.side) || 0] && (
                      <span style={{ opacity: 0.7, fontSize: "0.85em" }}>Wczytywanie składu…</span>
                    )}
                  </div>
                )}

                {showSubSelect && (
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <div style={{ opacity: 0.85, fontSize: "0.9em" }}>Zmiana:</div>

                    <select
                      value={draft.player_out_id}
                      disabled={!canEdit || incLoading}
                      onChange={(e) => setDraft((d) => ({ ...d, player_out_id: e.target.value ? Number(e.target.value) : "" }))}
                      style={{ padding: "0.35rem 0.5rem", borderRadius: 6, background: "rgba(0,0,0,0.25)", color: "#fff", border: "1px solid #444", minWidth: 220 }}
                    >
                      <option value="">Schodzi…</option>
                      {rosterForSide(draft.side).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.display_name}
                        </option>
                      ))}
                    </select>

                    <select
                      value={draft.player_in_id}
                      disabled={!canEdit || incLoading}
                      onChange={(e) => setDraft((d) => ({ ...d, player_in_id: e.target.value ? Number(e.target.value) : "" }))}
                      style={{ padding: "0.35rem 0.5rem", borderRadius: 6, background: "rgba(0,0,0,0.25)", color: "#fff", border: "1px solid #444", minWidth: 220 }}
                    >
                      <option value="">Wchodzi…</option>
                      {rosterForSide(draft.side).map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.display_name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* basketball points */}
                {isBasketball(discipline) && draft.kind === "GOAL" && (
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
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

                {/* tennis selectors */}
                {isTennis(discipline) && (
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ opacity: 0.85, fontSize: "0.9em" }}>Tenis:</div>
                    <input
                      type="number"
                      min={1}
                      value={draft.tennis_set_no}
                      disabled={!canEdit || incLoading}
                      onChange={(e) => setDraft((d) => ({ ...d, tennis_set_no: Math.max(1, Number(e.target.value || 1)) }))}
                      style={{ width: 90, textAlign: "center", padding: "0.35rem", borderRadius: 6, border: "1px solid #444", background: "rgba(0,0,0,0.25)", color: "#fff" }}
                    />
                    <input
                      type="number"
                      min={1}
                      value={draft.tennis_game_no}
                      disabled={!canEdit || incLoading}
                      onChange={(e) => setDraft((d) => ({ ...d, tennis_game_no: Math.max(1, Number(e.target.value || 1)) }))}
                      style={{ width: 90, textAlign: "center", padding: "0.35rem", borderRadius: 6, border: "1px solid #444", background: "rgba(0,0,0,0.25)", color: "#fff" }}
                    />

                    {tennisPointsView && (
                      <div style={{ opacity: 0.85, fontSize: "0.9em" }}>
                        Gem {tennisPointsView.gameNo}, Set {tennisPointsView.setNo}:{" "}
                        <strong>
                          {homeTeamName} {tennisPointsView.homeLabel} : {tennisPointsView.awayLabel} {awayTeamName}
                        </strong>
                      </div>
                    )}
                  </div>
                )}

                {showNoteInput && (
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ opacity: 0.85, fontSize: "0.9em" }}>Notatka:</div>
                    <input
                      type="text"
                      value={draft.note}
                      disabled={!canEdit || incLoading}
                      onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
                      placeholder="opcjonalnie"
                      style={{ width: 320, padding: "0.35rem", borderRadius: 6, border: "1px solid #444", background: "rgba(0,0,0,0.25)", color: "#fff" }}
                    />
                  </div>
                )}
              </div>

              <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <button
                  type="button"
                  disabled={!canEdit || incLoading}
                  onClick={submitIncident}
                  style={{
                    padding: "0.38rem 0.75rem",
                    borderRadius: 6,
                    border: "1px solid #444",
                    background: "rgba(46,204,113,0.15)",
                    color: "#fff",
                  }}
                >
                  Dodaj incydent
                </button>
</div>
            </div>

            {/* list */}
            <div style={{ marginTop: 10 }}>
              {incLoading && <div style={{ opacity: 0.75 }}>Wczytywanie…</div>}
              {!incLoading && incidents.length === 0 && <div style={{ opacity: 0.7 }}>Brak incydentów.</div>}

              {!incLoading && incidents.length > 0 && (
                <div style={{ display: "grid", gap: 6 }}>
                  {incidents
                    .slice()
                    .reverse()
                    .map((i) => (
                      <div
                        key={i.id}
                        style={{
                          border: "1px solid #333",
                          borderRadius: 8,
                          padding: "0.55rem 0.65rem",
                          background: "rgba(0,0,0,0.18)",
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 10,
                          alignItems: "center",
                          flexWrap: "wrap",
                        }}
                      >
                        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                          <span style={{ opacity: 0.85, fontSize: "0.9em" }}>
                            {teamNameForSide(i.team_id === homeTeamId ? "HOME" : "AWAY")}
                          </span>
                          <strong>{i.kind_display ?? i.kind}</strong>
                          <span style={{ opacity: 0.8, fontSize: "0.9em" }}>
                            {i.minute != null ? `${i.minute}'` : ""}
                            {i.minute_raw ? ` (${i.minute_raw})` : ""}
                          </span>
                          {i.player_name && <span style={{ opacity: 0.9 }}>{i.player_name}</span>}
                        </div>

                        {editIncidentId === i.id && editIncidentDraft && (
                          <div style={{ width: "100%", marginTop: 6, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                            <span style={{ opacity: 0.85, fontSize: "0.9em" }}>Edycja incydentu:</span>

                            <span style={{ opacity: 0.85, fontSize: "0.9em" }}>Minuta:</span>
                            <input
                              type="number"
                              min={1}
                              value={editIncidentDraft.minute}
                              disabled={!canEdit || !!incUpdating[i.id] || incLoading}
                              onChange={(e) => setEditIncidentDraft((d) => (d ? { ...d, minute: e.target.value } : d))}
                              style={{ width: 90, textAlign: "center", padding: "0.35rem", borderRadius: 6, border: "1px solid #444", background: "rgba(0,0,0,0.25)", color: "#fff" }}
                            />

                            {supportsSubKind(i.kind) ? (
                              <>
                                <span style={{ opacity: 0.85, fontSize: "0.9em" }}>Schodzi:</span>
                                <select
                                  value={editIncidentDraft.player_out_id ?? ""}
                                  disabled={!canEdit || !!incUpdating[i.id] || incLoading}
                                  onChange={(e) => setEditIncidentDraft((d) => (d ? { ...d, player_out_id: e.target.value ? Number(e.target.value) : "" } : d))}
                                  style={{ padding: "0.35rem 0.5rem", borderRadius: 6, background: "rgba(0,0,0,0.25)", color: "#fff", border: "1px solid #444", minWidth: 200 }}
                                >
                                  <option value="">(brak)</option>
                                  {rosterForSide(sideForTeamId(i.team_id)).map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.display_name}
                                      {p.jersey_number != null ? ` (#${p.jersey_number})` : ""}
                                    </option>
                                  ))}
                                </select>

                                <span style={{ opacity: 0.85, fontSize: "0.9em" }}>Wchodzi:</span>
                                <select
                                  value={editIncidentDraft.player_in_id ?? ""}
                                  disabled={!canEdit || !!incUpdating[i.id] || incLoading}
                                  onChange={(e) => setEditIncidentDraft((d) => (d ? { ...d, player_in_id: e.target.value ? Number(e.target.value) : "" } : d))}
                                  style={{ padding: "0.35rem 0.5rem", borderRadius: 6, background: "rgba(0,0,0,0.25)", color: "#fff", border: "1px solid #444", minWidth: 200 }}
                                >
                                  <option value="">(brak)</option>
                                  {rosterForSide(sideForTeamId(i.team_id)).map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.display_name}
                                      {p.jersey_number != null ? ` (#${p.jersey_number})` : ""}
                                    </option>
                                  ))}
                                </select>
                              </>
                            ) : supportsPlayerKind(i.kind) ? (
                              <>
                                <span style={{ opacity: 0.85, fontSize: "0.9em" }}>Zawodnik:</span>
                                <select
                                  value={editIncidentDraft.player_id ?? ""}
                                  disabled={!canEdit || !!incUpdating[i.id] || incLoading}
                                  onChange={(e) => setEditIncidentDraft((d) => (d ? { ...d, player_id: e.target.value ? Number(e.target.value) : "" } : d))}
                                  style={{ padding: "0.35rem 0.5rem", borderRadius: 6, background: "rgba(0,0,0,0.25)", color: "#fff", border: "1px solid #444", minWidth: 240 }}
                                >
                                  <option value="">(brak)</option>
                                  {rosterForSide(sideForTeamId(i.team_id)).map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.display_name}
                                      {p.jersey_number != null ? ` (#${p.jersey_number})` : ""}
                                    </option>
                                  ))}
                                </select>
                              </>
                            ) : null}

                            <button
                              type="button"
                              disabled={!canEdit || !!incUpdating[i.id] || incLoading}
                              onClick={() => saveEditIncident(i)}
                              style={{
                                padding: "0.25rem 0.65rem",
                                borderRadius: 6,
                                border: "1px solid #444",
                                background: "rgba(46,204,113,0.15)",
                                color: "#fff",
                              }}
                            >
                              Zapisz
                            </button>
                          </div>
                        )}

                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <span style={{ opacity: 0.6, fontSize: "0.82em" }}>
                            {i.created_at ? new Date(i.created_at).toLocaleString() : ""}
                          </span>

                          {canEdit && (
                            <button
                              type="button"
                              disabled={!!incUpdating[i.id] || incLoading}
                              onClick={() => (editIncidentId === i.id ? cancelEditIncident() : beginEditIncident(i))}
                              style={{
                                padding: "0.25rem 0.55rem",
                                borderRadius: 6,
                                border: "1px solid #444",
                                background: "rgba(255,255,255,0.04)",
                                color: "#fff",
                              }}
                            >
                              {editIncidentId === i.id ? "Anuluj edycję" : "Edytuj"}
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={!canEdit || incLoading}
                            onClick={() => requestDeleteIncident(i)}
                            style={{
                              padding: "0.25rem 0.55rem",
                              borderRadius: 6,
                              border: "1px solid #444",
                              background: "rgba(231,76,60,0.10)",
                              color: "#fff",
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
          </div>
        </div>
    </div>
  );
}
