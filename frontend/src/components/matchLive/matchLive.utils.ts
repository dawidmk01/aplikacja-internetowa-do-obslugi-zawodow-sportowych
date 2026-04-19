// frontend/src/components/matchLive/matchLive.utils.ts
// Wspólne typy i helpery dla trybu live (zegar, incydenty, komentarze).

export type ClockState = "NOT_STARTED" | "RUNNING" | "PAUSED" | "STOPPED";
export type ClockPeriod =
  | "NONE"
  | "FH"
  | "SH"
  | "ET1"
  | "ET2"
  | "H1"
  | "H2"
  | "P1"
  | "BREAK"
  | "P2"
  | "Q1"
  | "Q2"
  | "Q3"
  | "Q4"
  | "OT1"
  | "OT2"
  | "OT3"
  | "OT4";
export type BreakLevel = "NORMAL" | "WARN" | "DANGER";

export type MatchClockDTO = {
  match_id: number;
  clock_state: ClockState;
  clock_period: ClockPeriod;
  clock_started_at: string | null;
  clock_elapsed_seconds: number;
  clock_added_seconds: number;

  // Pola legacy utrzymywane dla kompatybilności.
  seconds_in_period?: number;
  seconds_total?: number;
  minute_total?: number;

  server_time: string;

  // Pola opcjonalne dla UI.
  is_break?: boolean;
  break_seconds?: number;
  break_level?: BreakLevel;
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

  meta: Record<string, unknown>;
  created_at: string | null;
};

export type MatchStatus = "SCHEDULED" | "IN_PROGRESS" | "RUNNING" | "FINISHED";

export function lower(s: string | null | undefined): string {
  return (s ?? "").toLowerCase();
}

export function isFootball(discipline: string): boolean {
  return lower(discipline) === "football";
}

export function isHandball(discipline: string): boolean {
  return lower(discipline) === "handball";
}

export function isBasketball(discipline: string): boolean {
  return lower(discipline) === "basketball";
}

export function isTennis(discipline: string): boolean {
  return lower(discipline) === "tennis";
}

export function isWrestling(discipline: string): boolean {
  return lower(discipline) === "wrestling";
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

export function fmtClockState(s: ClockState): string {
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

  if (isBasketball(discipline)) {
    return [
      { value: "Q1", label: "1 kwarta" },
      { value: "Q2", label: "2 kwarta" },
      { value: "Q3", label: "3 kwarta" },
      { value: "Q4", label: "4 kwarta" },
      { value: "OT1", label: "Dogrywka 1" },
      { value: "OT2", label: "Dogrywka 2" },
      { value: "OT3", label: "Dogrywka 3" },
      { value: "OT4", label: "Dogrywka 4" },
    ];
  }

  if (isWrestling(discipline)) {
    return [
      { value: "P1", label: "1 okres" },
      { value: "BREAK", label: "Przerwa" },
      { value: "P2", label: "2 okres" },
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

  if (isWrestling(discipline)) {
    return [
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
  // Offset służy do prezentacji minuty narastająco w zależności od okresu.
  const d = lower(discipline);

  const isFootballLike = d === "football" || d === "ice_hockey";
  const isHandballLike = d === "handball";
  const isBasketballLike = d === "basketball";
  const isWrestlingLike = d === "wrestling";

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

  if (isBasketballLike) {
    if (period === "Q2") return 10 * 60;
    if (period === "Q3") return 20 * 60;
    if (period === "Q4") return 30 * 60;
    if (period === "OT1") return 40 * 60;
    if (period === "OT2") return 45 * 60;
    if (period === "OT3") return 50 * 60;
    if (period === "OT4") return 55 * 60;
    return 0;
  }

  if (isWrestlingLike) {
    if (period === "BREAK") return 3 * 60;
    if (period === "P2") return 3 * 60;
    return 0;
  }

  return 0;
}

export function periodLimitSeconds(discipline: string, period: ClockPeriod): number | null {
  // Limit jest wykorzystywany wyłącznie w UI do skalowania i walidacji.
  if (isFootball(discipline)) {
    if (period === "FH" || period === "SH") return 45 * 60;
    if (period === "ET1" || period === "ET2") return 15 * 60;
  }

  if (isHandball(discipline)) {
    if (period === "H1" || period === "H2") return 30 * 60;
    if (period === "ET1" || period === "ET2") return 5 * 60;
  }

  if (isBasketball(discipline)) {
    if (period === "Q1" || period === "Q2" || period === "Q3" || period === "Q4") return 10 * 60;
    if (period === "OT1" || period === "OT2" || period === "OT3" || period === "OT4") return 5 * 60;
  }

  if (isWrestling(discipline)) {
    if (period === "P1" || period === "P2") return 3 * 60;
    if (period === "BREAK") return 30;
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

  if (isWrestling(discipline)) {
    if (current === "P1" || current === "BREAK") return "P2";
    return null;
  }

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

  if (isBasketball(discipline)) {
    if (current === "Q1") return "Q2";
    if (current === "Q2") return "Q3";
    if (current === "Q3") return "Q4";
    if (current === "Q4" && allowExtraTimeStart) return "OT1";
    if (current === "OT1") return "OT2";
    if (current === "OT2") return "OT3";
    if (current === "OT3") return "OT4";
    return null;
  }

  return null;
}

// ===== Przerwy w UI =====

/** Stan przerwy jest frontendowy i utrzymywany w localStorage dla spójności między odświeżeniami. */
export const BreakMode = {
  NONE: "NONE",
  INTERMISSION: "INTERMISSION",
  TECH: "TECH",
} as const;
export type BreakMode = (typeof BreakMode)[keyof typeof BreakMode];

function breakKey(matchId: number, key: "mode" | "startedAt") {
  return `matchBreak:${matchId}:${key}`;
}

function isBreakMode(v: string | null): v is BreakMode {
  if (!v) return false;
  return v === BreakMode.NONE || v === BreakMode.INTERMISSION || v === BreakMode.TECH;
}

export function readBreakMode(matchId: number): BreakMode {
  try {
    const v = localStorage.getItem(breakKey(matchId, "mode"));
    return isBreakMode(v) ? v : BreakMode.NONE;
  } catch {
    return BreakMode.NONE;
  }
}

export function writeBreakMode(matchId: number, mode: BreakMode) {
  try {
    localStorage.setItem(breakKey(matchId, "mode"), mode);
  } catch {
    // brak
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
    // brak
  }
}

export function clearBreak(matchId: number) {
  writeBreakMode(matchId, BreakMode.NONE);
  writeBreakStartedAt(matchId, null);
}

export function computeBreakLevel(seconds: number): BreakLevel {
  if (seconds >= 15 * 60) return "DANGER";
  if (seconds >= 13 * 60) return "WARN";
  return "NORMAL";
}

// ===== Tenis - prezentacja punktów =====

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
