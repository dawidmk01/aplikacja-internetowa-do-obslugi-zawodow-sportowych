/*
  Wspólne typy i helpery dla LIVE (zegar, incydenty, komentarze).
  Plik celowo jest "lekki" - logika biznesowa zostaje w panelach.
*/

export type ClockState = "NOT_STARTED" | "RUNNING" | "PAUSED" | "STOPPED";
export type ClockPeriod = "NONE" | "FH" | "SH" | "ET1" | "ET2" | "H1" | "H2";

export type MatchClockDTO = {
  match_id: number;
  clock_state: ClockState;
  clock_period: ClockPeriod;
  clock_started_at: string | null;
  clock_elapsed_seconds: number;
  clock_added_seconds: number;

  // legacy fields
  seconds_in_period?: number;
  seconds_total?: number;
  minute_total?: number;
  server_time: string;

  // nowe (opcjonalnie)
  is_break?: boolean;
  break_seconds?: number;
  break_level?: "NORMAL" | "WARN" | "DANGER";
  write_locked?: boolean;
  cap_reached?: boolean;
  max_clock_seconds?: number;
};

export type IncidentTimeSource = "CLOCK" | "MANUAL";

export type IncidentDTO = {
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

export type MatchStatus = "SCHEDULED" | "IN_PROGRESS" | "RUNNING" | "FINISHED";

export function lower(s: string | null | undefined) {
  return (s ?? "").toLowerCase();
}

export function isFootball(discipline: string) {
  return lower(discipline) === "football";
}

export function isHandball(discipline: string) {
  return lower(discipline) === "handball";
}

export function isBasketball(discipline: string) {
  return lower(discipline) === "basketball";
}

export function isTennis(discipline: string) {
  return lower(discipline) === "tennis";
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

export function fmtClockState(s: ClockState) {
  if (s === "NOT_STARTED") return "Nie rozpoczęty";
  if (s === "RUNNING") return "W trakcie";
  if (s === "PAUSED") return "Wstrzymany";
  return "Zatrzymany";
}

export function safeInt(v: string): number | null {
  const t = (v ?? "").trim();
  if (!t) return null;
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

export function periodOptions(discipline: string): { value: ClockPeriod; label: string }[] {
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

export function incidentKindOptions(discipline: string): { value: string; label: string }[] {
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

export function periodBaseOffsetSeconds(discipline: string, period: ClockPeriod): number {
  // Wyświetlanie "minuty meczu" jako czasu narastającego.
  const d = lower(discipline);

  const isFootballLike = d === "football" || d === "ice_hockey";
  const isHandballLike = d === "handball";
  const isBasketballLike = d === "basketball";

  if (isFootballLike) {
    if (period === "SH") return 45 * 60;
    if (period === "ET1") return 90 * 60;
    if (period === "ET2") return 105 * 60;
    return 0;
  }

  if (isHandballLike) {
    if (period === "H2") return 30 * 60;
    if (period === "ET1") return 60 * 60;
    if (period === "ET2") return 65 * 60;
    return 0;
  }

  if (isBasketballLike) return 0;
  return 0;
}

export function periodLimitSeconds(discipline: string, period: ClockPeriod): number | null {
  // Limity per okres (UI).
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

export function isKnockoutLike(stageType?: string): boolean {
  const s = String(stageType || "").toUpperCase();
  return s === "KNOCKOUT" || s === "THIRD_PLACE";
}

export function nextPeriodFromIntermission(
  discipline: string,
  current: ClockPeriod,
  opts: { allowExtraTimeStart: boolean }
): ClockPeriod | null {
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

/* =========================
   Break UI (frontend-only)
   ========================= */

export const BreakMode = {
  NONE: "NONE",
  INTERMISSION: "INTERMISSION",
  TECH: "TECH",
} as const;
export type BreakMode = (typeof BreakMode)[keyof typeof BreakMode];

function breakKey(matchId: number, key: "mode" | "startedAt") {
  return `matchBreak:${matchId}:${key}`;
}

export function readBreakMode(matchId: number): BreakMode {
  try {
    return (localStorage.getItem(breakKey(matchId, "mode")) as BreakMode) || BreakMode.NONE;
  } catch {
    return BreakMode.NONE;
  }
}

export function writeBreakMode(matchId: number, mode: BreakMode) {
  try {
    localStorage.setItem(breakKey(matchId, "mode"), mode);
  } catch {
    // ignore
  }
}

export function readBreakStartedAt(matchId: number): number | null {
  try {
    const raw = localStorage.getItem(breakKey(matchId, "startedAt"));
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function writeBreakStartedAt(matchId: number, tsMs: number | null) {
  try {
    if (!tsMs) localStorage.removeItem(breakKey(matchId, "startedAt"));
    else localStorage.setItem(breakKey(matchId, "startedAt"), String(tsMs));
  } catch {
    // ignore
  }
}

export function clearBreak(matchId: number) {
  writeBreakMode(matchId, BreakMode.NONE);
  writeBreakStartedAt(matchId, null);
}

export function computeBreakLevel(seconds: number): "NORMAL" | "WARN" | "DANGER" {
  if (seconds >= 15 * 60) return "DANGER";
  if (seconds >= 13 * 60) return "WARN";
  return "NORMAL";
}

/* =========================
   Tennis points display
   ========================= */

export function tennisPointLabel(aPts: number, bPts: number): string {
  if (aPts >= 4 && aPts - bPts >= 2) return "G";
  if (bPts >= 4 && bPts - aPts >= 2) return "-";

  const map = ["0", "15", "30", "40"];
  if (aPts >= 3 && bPts >= 3) {
    if (aPts === bPts) return "40";
    if (aPts === bPts + 1) return "AD";
    return "40";
  }
  return map[Math.min(aPts, 3)] ?? "0";
}

export function tennisPointLabelOther(aPts: number, bPts: number): string {
  if (bPts >= 4 && bPts - aPts >= 2) return "G";
  if (aPts >= 4 && aPts - bPts >= 2) return "-";

  const map = ["0", "15", "30", "40"];
  if (aPts >= 3 && bPts >= 3) {
    if (aPts === bPts) return "40";
    if (bPts === aPts + 1) return "AD";
    return "40";
  }
  return map[Math.min(bPts, 3)] ?? "0";
}
