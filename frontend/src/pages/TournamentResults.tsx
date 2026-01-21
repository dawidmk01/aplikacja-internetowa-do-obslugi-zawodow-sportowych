// frontend/src/pages/TournamentResults.tsx

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { apiFetch } from "../api";
import MatchLivePanel from "../components/MatchLivePanel";
import {
  buildStagesForView,
  displayGroupName,
  groupMatchesByGroup,
  groupMatchesByRound,
  isByeMatch,
  stageHeaderTitle,
} from "../flow/stagePresentation";

/* ============================================================
   TYPES
   ============================================================ */

export type MatchStageType = "LEAGUE" | "KNOCKOUT" | "GROUP" | "THIRD_PLACE";
export type MatchStatus = "SCHEDULED" | "IN_PROGRESS" | "RUNNING" | "FINISHED";

type HandballTableDrawMode = "ALLOW_DRAW" | "PENALTIES" | "OVERTIME_PENALTIES";
type HandballKnockoutTiebreak = "OVERTIME_PENALTIES" | "PENALTIES";

export type TennisSetDTO = {
  home_games: number;
  away_games: number;
  home_tiebreak?: number | null;
  away_tiebreak?: number | null;
};

export type TournamentDTO = {
  id: number;
  name?: string;
  discipline: string;
  tournament_format?: "LEAGUE" | "CUP" | "MIXED";
  status: "DRAFT" | "CONFIGURED" | "RUNNING" | "FINISHED";
  format_config?: {
    cup_matches?: number;
    cup_matches_by_stage_order?: Record<string, number>;
    handball_table_draw_mode?: HandballTableDrawMode;
    handball_knockout_tiebreak?: HandballKnockoutTiebreak;

    // TENNIS:
    // best-of-3 albo best-of-5
    tennis_best_of?: 3 | 5 | number;
  };
};

export type MatchDTO = {
  id: number;
  stage_id: number;
  stage_order: number;
  stage_type: MatchStageType;
  group_name?: string | null;
  status: MatchStatus;
  round_number: number | null;

  home_team_id?: number;
  away_team_id?: number;

  home_team_name: string | null;
  away_team_name: string | null;

  // Dla tenisa: sety wygrane (liczone z tennis_sets)
  home_score: number | null;
  away_score: number | null;

  // TENNIS (gemy per set)
  tennis_sets?: TennisSetDTO[] | null;

  went_to_extra_time?: boolean;
  home_extra_time_score?: number | null;
  away_extra_time_score?: number | null;

  decided_by_penalties?: boolean;
  home_penalty_score?: number | null;
  away_penalty_score?: number | null;

  result_entered?: boolean;
  winner_id?: number | null;
};

type MatchDraft = Partial<
  Pick<
    MatchDTO,
    | "home_score"
    | "away_score"
    | "tennis_sets"
    | "went_to_extra_time"
    | "home_extra_time_score"
    | "away_extra_time_score"
    | "decided_by_penalties"
    | "home_penalty_score"
    | "away_penalty_score"
  >
>;


function comparableResult(m: MatchDTO) {
  return {
    home_score: m.home_score ?? 0,
    away_score: m.away_score ?? 0,
    tennis_sets: m.tennis_sets ?? null,
    went_to_extra_time: !!m.went_to_extra_time,
    home_extra_time_score: m.home_extra_time_score ?? null,
    away_extra_time_score: m.away_extra_time_score ?? null,
    decided_by_penalties: !!m.decided_by_penalties,
    home_penalty_score: m.home_penalty_score ?? null,
    away_penalty_score: m.away_penalty_score ?? null,
  };
}

function sameComparableResult(a: MatchDTO, b: MatchDTO): boolean {
  return JSON.stringify(comparableResult(a)) === JSON.stringify(comparableResult(b));
}
type ApiErrorObj = { message: string; code?: string; data?: any };

type PendingForceOp = "SAVE" | "FINISH";

type PendingForce = {
  matchId: number;
  op: PendingForceOp;
  message: string;
  code?: string;
  wouldDelete?: any[];
};


/* ============================================================
   HELPERS: numeric parsing
   ============================================================ */

export function scoreToInputValue(score: number | null | undefined): string {
  if (score == null) return "0";
  return String(score);
}

export function inputValueToScore(v: string): number {
  const s = v.trim();
  if (s === "") return 0;
  if (!/^\d+$/.test(s)) return 0;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function lower(s: string | null | undefined) {
  return (s ?? "").toLowerCase();
}

function teamLabel(s: string | null | undefined): string {
  const v = (s ?? "").trim();
  return v ? v : "—";
}

function isHandball(t: TournamentDTO | null): boolean {
  return lower(t?.discipline) === "handball";
}

function isTennis(t: TournamentDTO | null): boolean {
  return lower(t?.discipline) === "tennis";
}

function getHandballTableDrawMode(t: TournamentDTO | null): HandballTableDrawMode {
  const m = t?.format_config?.handball_table_draw_mode;
  if (m === "PENALTIES" || m === "OVERTIME_PENALTIES" || m === "ALLOW_DRAW") return m;
  return "ALLOW_DRAW";
}

function getHandballKnockoutTiebreak(t: TournamentDTO | null): HandballKnockoutTiebreak {
  const m = t?.format_config?.handball_knockout_tiebreak;
  if (m === "PENALTIES" || m === "OVERTIME_PENALTIES") return m;
  return "OVERTIME_PENALTIES";
}

function getTennisBestOf(t: TournamentDTO | null): 3 | 5 {
  const raw = Number(t?.format_config?.tennis_best_of ?? 3);
  return raw === 5 ? 5 : 3;
}

function tennisTargetSets(t: TournamentDTO | null): number {
  const bestOf = getTennisBestOf(t);
  return bestOf === 5 ? 3 : 2;
}

export function isKnockoutLike(stageType: MatchStageType): boolean {
  return stageType === "KNOCKOUT" || stageType === "THIRD_PLACE";
}

export function getCupMatchesForStage(tournament: TournamentDTO | null, stageOrder: number): 1 | 2 {
  const cfg = tournament?.format_config;
  const perStage = cfg?.cup_matches_by_stage_order?.[String(stageOrder)];
  if (perStage === 1 || perStage === 2) return perStage;
  const global = cfg?.cup_matches;
  if (global === 1 || global === 2) return global;
  return 1;
}

function regularTie(m: MatchDTO): boolean {
  return (m.home_score ?? 0) === (m.away_score ?? 0);
}

function extraScore(m: MatchDTO): [number, number] {
  if (!m.went_to_extra_time) return [0, 0];
  return [m.home_extra_time_score ?? 0, m.away_extra_time_score ?? 0];
}

function finalScore(m: MatchDTO): [number, number] {
  const rh = m.home_score ?? 0;
  const ra = m.away_score ?? 0;
  const [eh, ea] = extraScore(m);
  return [rh + eh, ra + ea];
}

function finalTie(m: MatchDTO): boolean {
  const [fh, fa] = finalScore(m);
  return fh === fa;
}

function penaltiesValid(m: MatchDTO): boolean {
  if (!m.decided_by_penalties) return false;
  if (m.home_penalty_score == null || m.away_penalty_score == null) return false;
  return m.home_penalty_score !== m.away_penalty_score;
}

/* ============================================================
   TENNIS: compute/validate sets (gemy)
   ============================================================ */

function clampInt(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

function normalizeTennisSet(s: TennisSetDTO): TennisSetDTO {
  return {
    home_games: clampInt(s.home_games),
    away_games: clampInt(s.away_games),
    home_tiebreak: s.home_tiebreak == null ? null : clampInt(s.home_tiebreak),
    away_tiebreak: s.away_tiebreak == null ? null : clampInt(s.away_tiebreak),
  };
}

function tennisSetWinner(set: TennisSetDTO): 1 | 2 | null {
  const hg = set.home_games;
  const ag = set.away_games;

  // proste ograniczenie UI
  if (hg < 0 || ag < 0) return null;
  if (hg > 7 || ag > 7) return null;

  // 7:6 / 6:7 -> wymagany TB
  if (hg === 7 && ag === 6) {
    if (set.home_tiebreak == null || set.away_tiebreak == null) return null;
    if (set.home_tiebreak === set.away_tiebreak) return null;
    return set.home_tiebreak > set.away_tiebreak ? 1 : 2;
  }
  if (hg === 6 && ag === 7) {
    if (set.home_tiebreak == null || set.away_tiebreak == null) return null;
    if (set.home_tiebreak === set.away_tiebreak) return null;
    return set.home_tiebreak > set.away_tiebreak ? 1 : 2;
  }

  // poza 7:6 / 6:7 TB nie powinien istnieć
  if (set.home_tiebreak != null || set.away_tiebreak != null) return null;

  // 7:5 / 5:7
  if (hg === 7 && ag === 5) return 1;
  if (hg === 5 && ag === 7) return 2;

  // 6:x z przewagą 2
  if (hg === 6 && ag <= 4) return 1;
  if (ag === 6 && hg <= 4) return 2;

  // inne wyniki nie zamykają seta
  return null;
}

function computeTennisSetsScore(sets: TennisSetDTO[] | null | undefined): [number, number] {
  const list = Array.isArray(sets) ? sets : [];
  let hs = 0;
  let as = 0;
  for (const raw of list) {
    const s = normalizeTennisSet(raw);
    const w = tennisSetWinner(s);
    if (w === 1) hs += 1;
    if (w === 2) as += 1;
  }
  return [hs, as];
}

function validateTennisSetsForMatch(args: {
  tournament: TournamentDTO | null;
  sets: TennisSetDTO[] | null | undefined;
}): { ok: boolean; message?: string; homeSets?: number; awaySets?: number; finished?: boolean } {
  const { tournament, sets } = args;
  const bestOf = getTennisBestOf(tournament);
  const target = tennisTargetSets(tournament);

  const list = Array.isArray(sets) ? sets.map(normalizeTennisSet) : [];
  if (list.length === 0) {
    return { ok: false, message: "Uzupełnij przynajmniej 1 set (w gemach)." };
  }
  if (list.length > bestOf) {
    return { ok: false, message: `Za dużo setów. Dla best-of-${bestOf} maksymalnie ${bestOf} sety.` };
  }

  let hs = 0;
  let as = 0;

  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    const w = tennisSetWinner(s);
    if (w == null) {
      return {
        ok: false,
        message: `Nieprawidłowy wynik w secie ${i + 1}. Dozwolone: 6:0–6:4, 7:5, 7:6 (wymaga tie-breaka).`,
      };
    }
    if (w === 1) hs += 1;
    if (w === 2) as += 1;

    // nie pozwalamy dopisywać setów po osiągnięciu targetu
    if (hs === target || as === target) {
      if (i !== list.length - 1) {
        return { ok: false, message: "Mecz jest już rozstrzygnięty – usuń nadmiarowe sety." };
      }
    }
  }

  if (hs === as) {
    return { ok: false, message: "W tenisie remis w setach jest niedozwolony." };
  }

  const finished = hs === target || as === target;

  if (finished) {
    if (Math.max(hs, as) !== target) {
      return { ok: false, message: `Nieprawidłowa liczba setów. Zwycięzca musi mieć ${target} sety.` };
    }
  }

  return { ok: true, homeSets: hs, awaySets: as, finished };
}

/* ============================================================
   KO dwumecz: pary + agregat
   ============================================================ */

function pairKey(a?: number, b?: number): string | null {
  if (a == null || b == null) return null;
  const x = Math.min(a, b);
  const y = Math.max(a, b);
  return `${x}-${y}`;
}

function getPairMatches(all: MatchDTO[], current: MatchDTO): MatchDTO[] {
  const k = pairKey(current.home_team_id, current.away_team_id);
  if (!k) return [];
  return all.filter((m) => {
    if (m.stage_id !== current.stage_id) return false;
    const mk = pairKey(m.home_team_id, m.away_team_id);
    return mk === k;
  });
}

function goalsForTeam(m: MatchDTO, teamId: number): number {
  const [fh, fa] = finalScore(m);
  if (m.home_team_id === teamId) return fh;
  if (m.away_team_id === teamId) return fa;
  return 0;
}

function aggregateForPair(pair: MatchDTO[]): { ok: boolean; tie: boolean; secondLegId: number | null; message?: string } {
  if (pair.length !== 2) return { ok: false, tie: false, secondLegId: null };
  const [m1, m2] = pair;
  const second = m1.id > m2.id ? m1 : m2;

  const a = m1.home_team_id;
  const b = m1.away_team_id;
  if (a == null || b == null) {
    return { ok: false, tie: false, secondLegId: second.id, message: "Brak ID drużyn (home_team_id/away_team_id)." };
  }

  const scoreA = goalsForTeam(m1, a) + goalsForTeam(m2, a);
  const scoreB = goalsForTeam(m1, b) + goalsForTeam(m2, b);

  return { ok: true, tie: scoreA === scoreB, secondLegId: second.id };
}

/* ============================================================
   UI / DOMAIN validation for Finish
   ============================================================ */

function canUseExtraTimeUI(t: TournamentDTO | null, m: MatchDTO): boolean {
  // TENNIS: nigdy
  if (isTennis(t)) return false;

  const hb = isHandball(t);

  if (isKnockoutLike(m.stage_type)) {
    if (hb && getHandballKnockoutTiebreak(t) === "PENALTIES") return false;
    return true;
  }

  if (hb && (m.stage_type === "LEAGUE" || m.stage_type === "GROUP")) {
    return getHandballTableDrawMode(t) === "OVERTIME_PENALTIES";
  }

  return false;
}

function canUsePenaltiesUI(t: TournamentDTO | null, m: MatchDTO): boolean {
  // TENNIS: nigdy
  if (isTennis(t)) return false;

  const hb = isHandball(t);

  if (isKnockoutLike(m.stage_type)) return true;

  if (hb && (m.stage_type === "LEAGUE" || m.stage_type === "GROUP")) {
    const mode = getHandballTableDrawMode(t);
    return mode === "PENALTIES" || mode === "OVERTIME_PENALTIES";
  }

  return false;
}

function normalizeMatchForConfig(t: TournamentDTO | null, m: MatchDTO, cupMatches: 1 | 2, allMatches: MatchDTO[]): MatchDTO {
  const hb = isHandball(t);
  const tn = isTennis(t);

  let next: MatchDTO = { ...m };

  // TENNIS: czyścimy ET/karne zawsze
  if (tn) {
    next.went_to_extra_time = false;
    next.home_extra_time_score = null;
    next.away_extra_time_score = null;
    next.decided_by_penalties = false;
    next.home_penalty_score = null;
    next.away_penalty_score = null;

    const [hs, as] = computeTennisSetsScore(next.tennis_sets);
    next.home_score = hs;
    next.away_score = as;

    return next;
  }

  const extraAllowed = canUseExtraTimeUI(t, m);
  const penAllowed = canUsePenaltiesUI(t, m);

  if (!extraAllowed) {
    next.went_to_extra_time = false;
    next.home_extra_time_score = null;
    next.away_extra_time_score = null;
  }
  if (!penAllowed) {
    next.decided_by_penalties = false;
    next.home_penalty_score = null;
    next.away_penalty_score = null;
  }

  const isKO = isKnockoutLike(next.stage_type);
  if (isKO && cupMatches === 1 && !regularTie(next)) {
    next.went_to_extra_time = false;
    next.home_extra_time_score = null;
    next.away_extra_time_score = null;
    next.decided_by_penalties = false;
    next.home_penalty_score = null;
    next.away_penalty_score = null;
    return next;
  }

  if (!next.went_to_extra_time) {
    next.home_extra_time_score = null;
    next.away_extra_time_score = null;
  }

  if (!next.decided_by_penalties) {
    next.home_penalty_score = null;
    next.away_penalty_score = null;
  }

  if (hb && (next.stage_type === "LEAGUE" || next.stage_type === "GROUP")) {
    if (!regularTie(next)) {
      next.went_to_extra_time = false;
      next.home_extra_time_score = null;
      next.away_extra_time_score = null;
      next.decided_by_penalties = false;
      next.home_penalty_score = null;
      next.away_penalty_score = null;
      return next;
    }

    const mode = getHandballTableDrawMode(t);

    if (mode === "ALLOW_DRAW") {
      next.went_to_extra_time = false;
      next.home_extra_time_score = null;
      next.away_extra_time_score = null;
      next.decided_by_penalties = false;
      next.home_penalty_score = null;
      next.away_penalty_score = null;
    }

    if (mode === "PENALTIES") {
      next.went_to_extra_time = false;
      next.home_extra_time_score = null;
      next.away_extra_time_score = null;
      if (next.decided_by_penalties) {
        next.home_penalty_score = next.home_penalty_score ?? 0;
        next.away_penalty_score = next.away_penalty_score ?? 0;
      }
    }
  }

  if (isKO && cupMatches === 2) {
    if (next.decided_by_penalties) {
      next.home_penalty_score = next.home_penalty_score ?? 0;
      next.away_penalty_score = next.away_penalty_score ?? 0;
    }
  }

  return next;
}

function canFinishMatchUI(args: {
  tournament: TournamentDTO | null;
  match: MatchDTO;
  cupMatches: 1 | 2;
  allMatches: MatchDTO[];
}): { ok: boolean; message?: string } {
  const { tournament, match, cupMatches, allMatches } = args;

  const tn = isTennis(tournament);
  const hb = isHandball(tournament);
  const stageType = match.stage_type;
  const knockoutLike = isKnockoutLike(stageType);

  // TENNIS: osobna logika finish
  if (tn) {
    if (knockoutLike && cupMatches === 2) {
      return { ok: false, message: "Tenis nie wspiera trybu dwumeczu (cup_matches=2)." };
    }
    if (match.went_to_extra_time || match.decided_by_penalties) {
      return { ok: false, message: "W tenisie nie obsługujemy dogrywki ani karnych." };
    }
    const v = validateTennisSetsForMatch({ tournament, sets: match.tennis_sets });
    if (!v.ok) return { ok: false, message: v.message ?? "Nieprawidłowy wynik tenisowy." };
    if (!v.finished) {
      const target = tennisTargetSets(tournament);
      return {
        ok: false,
        message: `Aby zakończyć mecz, ktoś musi wygrać ${target} sety (best-of-${getTennisBestOf(tournament)}).`,
      };
    }
    return { ok: true };
  }

  const extraAllowed = canUseExtraTimeUI(tournament, match);
  const penAllowed = canUsePenaltiesUI(tournament, match);

  if (match.went_to_extra_time && !extraAllowed) {
    return { ok: false, message: "Dogrywka jest niedozwolona w tej konfiguracji." };
  }
  if (match.decided_by_penalties && !penAllowed) {
    return { ok: false, message: "Rzuty karne są niedozwolone w tej konfiguracji." };
  }

  if (match.went_to_extra_time) {
    if (match.home_extra_time_score == null || match.away_extra_time_score == null) {
      return { ok: false, message: "Uzupełnij wynik dogrywki." };
    }
  }

  if (match.decided_by_penalties) {
    if (match.home_penalty_score == null || match.away_penalty_score == null) {
      return { ok: false, message: "Uzupełnij wynik rzutów karnych." };
    }
    if (match.home_penalty_score === match.away_penalty_score) {
      return { ok: false, message: "Rzuty karne nie mogą zakończyć się remisem." };
    }
  }

  if (!knockoutLike && hb && (stageType === "LEAGUE" || stageType === "GROUP")) {
    const mode = getHandballTableDrawMode(tournament);

    if (!regularTie(match)) return { ok: true };
    if (mode === "ALLOW_DRAW") return { ok: true };

    if (mode === "PENALTIES") {
      if (!match.decided_by_penalties || !penaltiesValid(match)) {
        return { ok: false, message: "Piłka ręczna: remis wymaga rozstrzygnięcia w rzutach karnych." };
      }
      return { ok: true };
    }

    if (!match.went_to_extra_time) {
      return { ok: false, message: "Piłka ręczna: przy remisie wymagana dogrywka (a jeśli nadal remis, karne)." };
    }
    if (finalTie(match)) {
      if (!match.decided_by_penalties || !penaltiesValid(match)) {
        return { ok: false, message: "Piłka ręczna: jeśli remis po dogrywce, wymagane są karne." };
      }
    }
    return { ok: true };
  }

  if (knockoutLike) {
    if (cupMatches === 1) {
      if (hb && regularTie(match)) {
        const tb = getHandballKnockoutTiebreak(tournament);

        if (tb === "PENALTIES") {
          if (!match.decided_by_penalties || !penaltiesValid(match)) {
            return { ok: false, message: "Piłka ręczna (KO): remis wymaga karnych (bez dogrywki w tej konfiguracji)." };
          }
          return { ok: true };
        }

        if (!match.went_to_extra_time) {
          return { ok: false, message: "Piłka ręczna (KO): przy remisie wymagana dogrywka." };
        }
        if (finalTie(match)) {
          if (!match.decided_by_penalties || !penaltiesValid(match)) {
            return { ok: false, message: "Piłka ręczna (KO): jeśli remis po dogrywce, wymagane są karne." };
          }
        }
        return { ok: true };
      }

      if (finalTie(match)) {
        if (!match.decided_by_penalties || !penaltiesValid(match)) {
          return {
            ok: false,
            message: "Mecz pucharowy (1 mecz) nie może zakończyć się remisem – ustaw rozstrzygnięcie (karne).",
          };
        }
      }

      if (match.decided_by_penalties && !finalTie(match)) {
        return { ok: false, message: "Karne mają sens tylko przy remisie po regulaminie/dogrywce." };
      }

      return { ok: true };
    }

    if (cupMatches === 2) {
      const pair = getPairMatches(allMatches, match);
      if (pair.length !== 2) return { ok: true };

      const other = pair.find((m) => m.id !== match.id);
      if (!other) return { ok: true };
      if (other.status !== "FINISHED") return { ok: true };

      const agg = aggregateForPair(pair);
      const secondLegId = agg.secondLegId;
      if (!agg.ok) return { ok: true };

      if (agg.tie) {
        if (secondLegId === match.id) {
          if (!match.decided_by_penalties || !penaltiesValid(match)) {
            return { ok: false, message: "Dwumecz: agregat remisowy – rozstrzygnij karne w rewanżu." };
          }
          return { ok: true };
        } else {
          const secondLeg = pair.find((m) => m.id === secondLegId);
          const ok = !!(secondLeg?.decided_by_penalties && penaltiesValid(secondLeg));
          if (!ok) {
            return {
              ok: false,
              message:
                "Dwumecz: agregat remisowy – rozstrzygnięcie musi być w rewanżu (mecz o większym ID). Uzupełnij karne w rewanżu, potem zakończ ten mecz.",
            };
          }
          return { ok: true };
        }
      }

      return { ok: true };
    }
  }

  return { ok: true };
}

function toDraft(m: MatchDTO): MatchDraft {
  return {
    home_score: m.home_score,
    away_score: m.away_score,
    tennis_sets: m.tennis_sets ?? null,
    went_to_extra_time: !!m.went_to_extra_time,
    home_extra_time_score: m.home_extra_time_score ?? null,
    away_extra_time_score: m.away_extra_time_score ?? null,
    decided_by_penalties: !!m.decided_by_penalties,
    home_penalty_score: m.home_penalty_score ?? null,
    away_penalty_score: m.away_penalty_score ?? null,
  };
}

/* ============================================================
   MAIN COMPONENT
   ============================================================ */

export default function TournamentResults() {
  const { id } = useParams<{ id: string }>();

  const [tournament, setTournament] = useState<TournamentDTO | null>(null);
  const [matches, setMatches] = useState<MatchDTO[]>([]);
  const matchesRef = useRef<MatchDTO[]>([]);
  useEffect(() => {
    matchesRef.current = matches;
  }, [matches]);

  const [loading, setLoading] = useState(true);

  const [busyMatchId, setBusyMatchId] = useState<number | null>(null);
  const [busyGenerate, setBusyGenerate] = useState(false);


type ToastKind = "saved" | "success" | "error" | "info";
type ToastItem = { id: number; text: string; kind: ToastKind; durationMs: number };

const TOAST_DURATION_STANDARD_MS = 4800;
const TOAST_DURATION_SAVED_MS = 2000;

const [toasts, setToasts] = useState<ToastItem[]>([]);
const toastSeq = useRef(1);

const pushToast = useCallback((text: string, kind: ToastKind = "info") => {
  const durationMs = kind === "saved" ? TOAST_DURATION_SAVED_MS : TOAST_DURATION_STANDARD_MS;
  const id = toastSeq.current++;
  const item: ToastItem = { id, text, kind, durationMs };
  setToasts((prev) => [...prev, item]);
  window.setTimeout(() => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, durationMs);
}, []);

  // 409 z backendu: próba synchronizacji wyniku → incydenty wymagałaby usunięcia uzupełnionych incydentów
  const [pendingForce, setPendingForce] = useState<PendingForce | null>(null);


  // "edited" = zapisane (zielony akcent)
  const [edited, setEdited] = useState<Set<number>>(new Set());

  // "dirty" = ma niezapisane zmiany
  const [dirty, setDirty] = useState<Set<number>>(new Set());


  // drafty – żeby reload po zapisie nie kasował innych lokalnych zmian
  const [drafts, setDrafts] = useState<Record<number, MatchDraft>>({});

// ===== LIVE panel (toggle per mecz) =====
const [openLive, setOpenLive] = useState<Set<number>>(new Set());

// Persistuj stan otwarcia LIVE (per turniej) w localStorage
const liveStorageKey = id ? `tournament:${id}:results:openLive` : null;

useEffect(() => {
  if (!liveStorageKey) return;
  try {
    const raw = window.localStorage.getItem(liveStorageKey);
    if (!raw) return;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) setOpenLive(new Set(arr.filter((x) => typeof x === "number")));
  } catch {
    // ignoruj
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [liveStorageKey]);

useEffect(() => {
  if (!liveStorageKey) return;
  try {
    window.localStorage.setItem(liveStorageKey, JSON.stringify(Array.from(openLive)));
  } catch {
    // ignoruj
  }
}, [liveStorageKey, openLive]);

  // ===== edycja meczu zakończonego =====
  const [editingFinished, setEditingFinished] = useState<Set<number>>(new Set());
  const [finishedSnapshots, setFinishedSnapshots] = useState<Record<number, MatchDTO>>({});

  const isEditingFinished = (matchId: number) => editingFinished.has(matchId);

  const startEditFinished = (m: MatchDTO) => {
    setFinishedSnapshots((prev) => ({ ...prev, [m.id]: { ...m } }));
    setEditingFinished((prev) => {
      const n = new Set(prev);
      n.add(m.id);
      return n;
    });
    pushToast("Tryb edycji: po zapisaniu zmiany mogą wpłynąć na kolejne etapy KO.", "info");
  };

  const cancelEditFinished = (matchId: number) => {
    const snap = finishedSnapshots[matchId];
    if (snap) {
      setMatches((prev) => prev.map((x) => (x.id === matchId ? snap : x)));
    }

    setDrafts((prev) => {
      const n = { ...prev };
      delete n[matchId];
      return n;
    });

    setDirty((prev) => {
      const n = new Set(prev);
      n.delete(matchId);
      return n;
    });

    setEditingFinished((prev) => {
      const n = new Set(prev);
      n.delete(matchId);
      return n;
    });

    setFinishedSnapshots((prev) => {
      const n = { ...prev };
      delete n[matchId];
      return n;
    });

    pushToast("Edycja anulowana.", "info");
  };

  const exitEditFinished = (matchId: number) => {
    setEditingFinished((prev) => {
      const n = new Set(prev);
      n.delete(matchId);
      return n;
    });
    setFinishedSnapshots((prev) => {
      const n = { ...prev };
      delete n[matchId];
      return n;
    });
  };

  /* ============================================================
     API calls
     ============================================================ */

  const parseApiErrorObj = async (res: Response): Promise<ApiErrorObj> => {
    const data = await res.json().catch(() => null);

    const message =
      data && typeof (data as any)?.detail === "string"
        ? (data as any).detail
        : data && typeof (data as any)?.message === "string"
        ? (data as any).message
        : "Błąd żądania.";

    const code = data && typeof (data as any)?.code === "string" ? (data as any).code : undefined;

    return { message, code, data };
  };

  const parseApiError = async (res: Response): Promise<string> => {
    const e = await parseApiErrorObj(res);
    return e.message;
  };

  const throwApiError = async (res: Response) => {
    const e = await parseApiErrorObj(res);
    const err: any = new Error(e.message);
    err.code = e.code;
    err.data = e.data;
    throw err;
  };

  const isIncidentsSyncConflict = (e: any): boolean => {
    const code = String(e?.code ?? "");
    return code === "INCIDENTS_SYNC_WOULD_DELETE_FILLED" || code.startsWith("INCIDENTS_SYNC_");
  };

  const loadTournament = async (): Promise<TournamentDTO> => {
    const res = await apiFetch(`/api/tournaments/${id}/`);
    if (!res.ok) throw new Error("Nie udało się pobrać turnieju.");
    const data = await res.json();
    setTournament(data);
    return data;
  };

  const mergeDrafts = (base: MatchDTO[], t: TournamentDTO | null): MatchDTO[] => {
    // 1) nałóż drafty
    const withDrafts: MatchDTO[] = base.map((m) => ({ ...m, ...(drafts[m.id] ?? {}) }));

    // 2) normalizacja per konfiguracja
    const normalized = withDrafts.map((m) => {
      const cupMatches = getCupMatchesForStage(t, m.stage_order);
      return normalizeMatchForConfig(t, m, cupMatches, withDrafts);
    });

    // 3) czyść drafty które już nie istnieją
    const ids = new Set(normalized.map((m) => m.id));
    setDrafts((prev) => {
      const n: Record<number, MatchDraft> = {};
      for (const [k, v] of Object.entries(prev)) {
        const id = Number(k);
        if (ids.has(id)) n[id] = v;
      }
      return n;
    });

    setDirty((prev) => {
      const n = new Set<number>();
      for (const x of prev) if (ids.has(x)) n.add(x);
      return n;
    });

    return normalized;
  };

  const loadMatches = async (tOverride?: TournamentDTO | null): Promise<MatchDTO[]> => {
    const res = await apiFetch(`/api/tournaments/${id}/matches/`);
    if (!res.ok) throw new Error("Nie udało się pobrać meczów.");
    const raw = await res.json();

    const list: MatchDTO[] = Array.isArray(raw) ? raw : Array.isArray(raw?.results) ? raw.results : [];

    const normalizedApi: MatchDTO[] = list.map((m: any) => ({
      ...m,
      tennis_sets: m.tennis_sets ?? null,

      went_to_extra_time: !!m.went_to_extra_time,
      decided_by_penalties: !!m.decided_by_penalties,
      home_extra_time_score: m.home_extra_time_score ?? null,
      away_extra_time_score: m.away_extra_time_score ?? null,
      home_penalty_score: m.home_penalty_score ?? null,
      away_penalty_score: m.away_penalty_score ?? null,
      home_score: m.home_score ?? 0,
      away_score: m.away_score ?? 0,

      home_team_name: m.home_team_name ?? null,
      away_team_name: m.away_team_name ?? null,
    }));

    const effectiveTournament = tOverride ?? tournament;
    const final = mergeDrafts(normalizedApi, effectiveTournament ?? null);

    setMatches(final);
    return final;
  };

  // Wywoływane przez panel LIVE (incydenty), gdy backend automatycznie zmienia wynik.
  // Ważne: nie robimy full-refresh strony – tylko pobieramy aktualne mecze i nakładamy drafty.
  const refreshAfterLiveChange = async (matchId: number) => {
    setEdited((prev) => {
      const n = new Set(prev);
      n.add(matchId);
      return n;
    });

    // Jeśli użytkownik jest w trybie "Wprowadź zmiany" dla zakończonego meczu,
    // zmiana wyniku wynikająca z LIVE (np. usunięcie incydentów) ma odblokować "Zapisz zmiany".
    if (isEditingFinished(matchId)) {
      // Zakończony mecz w trybie edycji: użytkownik ma kliknąć „Zapisz zmiany”.
      setDirty((prev) => {
        const n = new Set(prev);
        n.add(matchId);
        return n;
      });
    } else {
      // Normalny mecz: wynik z LIVE (incydenty) jest już zapisany w backendzie.
      // Nie oznaczamy meczu jako "dirty" i nie wywołujemy zapisu wyniku.
    }

    await loadMatches(tournament).catch(() => null);
  };

  const updateMatchScore = async (match: MatchDTO, opts?: { force?: boolean }) => {
    const tn = isTennis(tournament);

    let payload: any;

    if (tn) {
      const sets = Array.isArray(match.tennis_sets) ? match.tennis_sets.map(normalizeTennisSet) : [];
      const v = validateTennisSetsForMatch({ tournament, sets });

      // Na SAVE dopuszczamy „niezakończone” (np. 1:0 w setach), ale sety muszą być poprawne.
      if (!v.ok) {
        throw new Error(v.message ?? "Nieprawidłowy wynik tenisowy.");
      }

      payload = {
        tennis_sets: sets,
        home_score: v.homeSets ?? 0,
        away_score: v.awaySets ?? 0,

        // tenis: twardo wyłącz
        went_to_extra_time: false,
        home_extra_time_score: null,
        away_extra_time_score: null,
        decided_by_penalties: false,
        home_penalty_score: null,
        away_penalty_score: null,
      };
    } else {
      payload = {
        home_score: match.home_score ?? 0,
        away_score: match.away_score ?? 0,

        went_to_extra_time: !!match.went_to_extra_time,
        home_extra_time_score: match.went_to_extra_time ? (match.home_extra_time_score ?? 0) : null,
        away_extra_time_score: match.went_to_extra_time ? (match.away_extra_time_score ?? 0) : null,

        decided_by_penalties: !!match.decided_by_penalties,
        home_penalty_score: match.decided_by_penalties ? (match.home_penalty_score ?? 0) : null,
        away_penalty_score: match.decided_by_penalties ? (match.away_penalty_score ?? 0) : null,
      };
    }

    const forceQ = opts?.force ? "?force=1" : "";

    const res = await apiFetch(`/api/matches/${match.id}/result/${forceQ}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) await throwApiError(res);
  };

  const finishMatch = async (matchId: number) => {
    const res = await apiFetch(`/api/matches/${matchId}/finish/`, { method: "POST" });
    if (!res.ok) await throwApiError(res);
  };

  const continueMatch = async (matchId: number) => {
    const res = await apiFetch(`/api/matches/${matchId}/continue/`, { method: "POST" });
    if (!res.ok) await throwApiError(res);
  };

  const generateNextStage = async (stageId: number) => {
    if (!id) return;
    setBusyGenerate(true);
    const res = await apiFetch(`/api/stages/${stageId}/confirm/`, { method: "POST" });
    if (!res.ok) {
      setBusyGenerate(false);
      throw new Error(await parseApiError(res));
    }
    const t = await loadTournament().catch(() => tournament);
    await loadMatches(t ?? null);
    setBusyGenerate(false);
  };

  const advanceFromGroups = async () => {
    if (!id) return;
    setBusyGenerate(true);
    try {
      const res = await apiFetch(`/api/tournaments/${id}/advance-from-groups/`, { method: "POST" });
      if (!res.ok) await throwApiError(res);
      const t = await loadTournament().catch(() => tournament);
      await loadMatches(t ?? null);
      pushToast("Faza pucharowa wygenerowana.", "success");
    } catch (e: any) {
      if (isIncidentsSyncConflict(e)) {
        const wouldDelete = Array.isArray(e?.data?.would_delete) ? e.data.would_delete : [];
        setPendingForce({
          matchId: match.id,
          op: "FINISH",
          message: e.message,
          code: e.code,
          wouldDelete,
        });
      }

      pushToast(e?.message ?? "Błąd.", "error");
    } finally {
      setBusyGenerate(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    let mounted = true;

    const init = async () => {
      try {
        setLoading(true);

        // najpierw turniej (konfig), potem mecze (normalizacja)
        const t = await loadTournament();
        await loadMatches(t);
      } catch (e: any) {
        if (mounted) pushToast(e?.message ?? "Błąd.", "error");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    init();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /* ============================================================
     LOGIC & COMPUTED
     ============================================================ */

  const stages = useMemo(() => buildStagesForView(matches, { showBye: false }), [matches]);

  const lastStageId = useMemo(() => {
    if (!stages.length) return null;
    return stages[stages.length - 1].stageId;
  }, [stages]);

  const allMatchesInLastStageFinished = useMemo(() => {
    if (!lastStageId) return false;
    const last = stages.find((s: any) => s.stageId === lastStageId);
    if (!last) return false;
    if (!last.matches.length) return false;
    return last.matches.every((m: MatchDTO) => m.status === "FINISHED");
  }, [stages, lastStageId]);

  function uiStatus(m: MatchDTO) {
    if (m.status === "FINISHED") return "ZAKONCZONY";
    if (m.status === "IN_PROGRESS" || m.status === "RUNNING") return "W_TRAKCIE";
    return "ZAPLANOWANY";
  }

  function uiStatusLabel(s: ReturnType<typeof uiStatus>) {
    if (s === "ZAPLANOWANY") return "Zaplanowany";
    if (s === "W_TRAKCIE") return "W trakcie";
    return "Zakończony";
  }

  const saveMatch = async (
    matchId: number,
    opts?: { silentMessage?: boolean; matchOverride?: MatchDTO }
  ) => {
    const match =
      opts?.matchOverride ??
      matchesRef.current.find((m) => m.id === matchId) ??
      matches.find((m) => m.id === matchId);
    if (!match) return;

    const silent = !!opts?.silentMessage;

    if (!silent) {
      setBusyMatchId(match.id);
      // jeśli jest otwarty panel "wymuś" dla tego meczu, zamknij (żeby UX był spójny)
      setPendingForce((prev) => (prev?.matchId === match.id ? null : prev));
    }

    try {
      await updateMatchScore(match);

      // Po lokalnych zmianach wynik zapisujemy ręcznie przyciskiem "Zapisz".
      // Po udanym zapisie czyścimy draft + znacznik "dirty" i oznaczamy mecz jako edytowany.
      setDrafts((prev) => {
        const n = { ...prev };
        delete n[match.id];
        return n;
      });
      setDirty((prev) => {
        const n = new Set(prev);
        n.delete(match.id);
        return n;
      });
      setEdited((prev) => {
        const n = new Set(prev);
        n.add(match.id);
        return n;
      });


      const t = await loadTournament().catch(() => tournament);
      await loadMatches(t ?? null).catch(() => null);

      if (isEditingFinished(match.id)) {
        exitEditFinished(match.id);
      }

      if (!silent) pushToast("Zapisano.", "saved");
    } catch (e: any) {
      // Jeśli zapis jest wywołany "cicho" (silent), przekaż błąd do wywołującego.
      if (silent) {
        throw e;
      }

      if (isIncidentsSyncConflict(e)) {
        const wouldDelete = Array.isArray(e?.data?.would_delete) ? e.data.would_delete : [];
        setPendingForce({
          matchId: match.id,
          op: "SAVE",
          message: e.message,
          code: e.code,
          wouldDelete,
        });
      }

      pushToast(e?.message ?? "Błąd.", "error");
      await loadMatches(tournament).catch(() => null);
    } finally {
      if (!silent) setBusyMatchId(null);
    }
  };

  const onFinishMatchClick = async (matchId: number) => {
    const match = matches.find((m) => m.id === matchId);
    if (!match) return;

    if (match.status === "FINISHED") {
      pushToast("Ten mecz jest już zakończony. Użyj „Wprowadź zmiany”, jeśli chcesz coś poprawić.", "info");
      return;
    }

    const cupMatches = getCupMatchesForStage(tournament, match.stage_order);

    const verdict = canFinishMatchUI({
      tournament,
      match,
      cupMatches,
      allMatches: matches,
    });

    if (!verdict.ok) {
      pushToast(verdict.message ?? "Nie można zakończyć meczu.", "error");
      return;
    }

    try {
      setBusyMatchId(match.id);
      setPendingForce((prev) => (prev?.matchId === match.id ? null : prev));
      // zawsze zapisujemy aktualny stan przed finishem
      await updateMatchScore(match);
      await finishMatch(match.id);

      setDrafts((prev) => {
        const n = { ...prev };
        delete n[match.id];
        return n;
      });
      setDirty((prev) => {
        const n = new Set(prev);
        n.delete(match.id);
        return n;
      });

      setEdited((prev) => {
        const n = new Set(prev);
        n.add(match.id);
        return n;
      });

      const t = await loadTournament().catch(() => tournament);
      await loadMatches(t ?? null);

      pushToast("Mecz zakończony.", "success");
    } catch (e: any) {
      if (isIncidentsSyncConflict(e)) {
        const wouldDelete = Array.isArray(e?.data?.would_delete) ? e.data.would_delete : [];
        setPendingForce({
          matchId: match.id,
          op: "FINISH",
          message: e.message,
          code: e.code,
          wouldDelete,
        });
      }

      pushToast(e?.message ?? "Błąd.", "error");
    } finally {
      setBusyMatchId(null);
    }
  };

  const onContinueMatchClick = async (matchId: number) => {
    const match = matches.find((m) => m.id === matchId);
    if (!match) return;

    if (match.status !== "FINISHED") {
      pushToast("Ten mecz nie jest zakończony.", "info");
      return;
    }

    try {
      setBusyMatchId(match.id);
      // Wyjście z trybu edycji zakończonego meczu (jeśli ktoś był w tym trybie)
      if (isEditingFinished(match.id)) {
        exitEditFinished(match.id);
      }

      await continueMatch(match.id);

      const t = await loadTournament().catch(() => tournament);
      await loadMatches(t ?? null);

      pushToast("Mecz wznowiony.", "success");
    } catch (e: any) {
      pushToast(e?.message ?? "Błąd.", "error");
    } finally {
      setBusyMatchId(null);
    }
  };


const updateLocalMatch = (matchId: number, updater: (m: MatchDTO) => MatchDTO) => {
  const current = matchesRef.current.find((m) => m.id === matchId);
  if (!current) return;

  const baseList = matchesRef.current;
  const base = baseList.map((m) => (m.id === matchId ? updater(m) : m));
  const changed = base.find((m) => m.id === matchId);
  if (!changed) return;

  const cupMatches = getCupMatchesForStage(tournament, changed.stage_order);
  const normalizedChanged = normalizeMatchForConfig(tournament, changed, cupMatches, baseList);

  const nextList = baseList.map((m) => (m.id === matchId ? normalizedChanged : m));

  // Krytyczne: aktualizuj ref natychmiast, żeby szybkie kliknięcia nie gubiły ostatniej zmiany
  matchesRef.current = nextList;
  setMatches(nextList);


  setDirty((prev) => {
    const n = new Set(prev);
    n.add(matchId);
    return n;
  });

  setDrafts((prev) => ({
    ...prev,
    [matchId]: toDraft(normalizedChanged),
  }));

  // Zapis jest ręczny (przycisk "Zapisz"). Tutaj tylko oznaczamy mecz jako "dirty".
};

/* ============================================================
   TENNIS UI helpers (per match)
   ============================================================ */

  const updateTennisSet = (matchId: number, idx: number, patch: Partial<TennisSetDTO>) => {
    updateLocalMatch(matchId, (m) => {
      const list = Array.isArray(m.tennis_sets) ? [...m.tennis_sets] : [];
      while (list.length <= idx) {
        list.push({ home_games: 0, away_games: 0, home_tiebreak: null, away_tiebreak: null });
      }

      const current = normalizeTennisSet(list[idx]);
      let nextSet = normalizeTennisSet({ ...current, ...patch });

      // AUTO-CLEAR TB gdy nie jest potrzebny
      const needsTB = (nextSet.home_games === 7 && nextSet.away_games === 6) || (nextSet.home_games === 6 && nextSet.away_games === 7);
      if (!needsTB) {
        nextSet = { ...nextSet, home_tiebreak: null, away_tiebreak: null };
      }

      list[idx] = nextSet;
      return { ...m, tennis_sets: list };
    });
  };

  const addTennisSet = (matchId: number) => {
    updateLocalMatch(matchId, (m) => {
      const bestOf = getTennisBestOf(tournament);
      const list = Array.isArray(m.tennis_sets) ? [...m.tennis_sets] : [];
      if (list.length >= bestOf) return m;
      list.push({ home_games: 0, away_games: 0, home_tiebreak: null, away_tiebreak: null });
      return { ...m, tennis_sets: list };
    });
  };

  const removeLastTennisSet = (matchId: number) => {
    updateLocalMatch(matchId, (m) => {
      const list = Array.isArray(m.tennis_sets) ? [...m.tennis_sets] : [];
      if (list.length <= 1) return m;
      list.pop();
      return { ...m, tennis_sets: list };
    });
  };

  const renderMatchRow = (match: MatchDTO) => {
    if (isByeMatch(match)) return null;

    const status = uiStatus(match);
    const isBusy = busyMatchId === match.id;
    const wasEdited = edited.has(match.id);
    const isFinished = match.status === "FINISHED";
    const inEditFinished = isFinished && isEditingFinished(match.id);

    const snap = finishedSnapshots[match.id];
    const changedVsSnapshot = inEditFinished && !!snap && !sameComparableResult(snap, match);
    const isDirty = dirty.has(match.id) || changedVsSnapshot;

    const knockoutLike = isKnockoutLike(match.stage_type);
    const cupMatches = getCupMatchesForStage(tournament, match.stage_order);

    const hb = isHandball(tournament);
    const tn = isTennis(tournament);

    const regIsTie = regularTie(match);
    const finIsTie = finalTie(match);

    const extraAllowed = canUseExtraTimeUI(tournament, match);
    const penAllowed = canUsePenaltiesUI(tournament, match);

    let showExtraSection = false;
    let showPenSection = false;

    if (!tn) {
      if (knockoutLike) {
        if (cupMatches === 1) {
          showExtraSection = extraAllowed && (regIsTie || !!match.went_to_extra_time);
          showPenSection = penAllowed && (finIsTie || !!match.decided_by_penalties || regIsTie);
        } else {
          const pair = getPairMatches(matches, match);
          const agg = pair.length === 2 ? aggregateForPair(pair) : null;
          const secondLegId = agg?.secondLegId ?? null;
          const other = pair.find((m) => m.id !== match.id);
          const willClosePair = !!other && other.status === "FINISHED";
          const needsPen = willClosePair && agg?.ok && agg.tie && secondLegId === match.id;

          showExtraSection = extraAllowed && (regIsTie || !!match.went_to_extra_time);
          showPenSection = penAllowed && (needsPen || !!match.decided_by_penalties);
        }
      } else if (hb && (match.stage_type === "LEAGUE" || match.stage_type === "GROUP")) {
        const mode = getHandballTableDrawMode(tournament);
        const forceShow = !!match.went_to_extra_time || !!match.decided_by_penalties;

        if ((regIsTie && mode !== "ALLOW_DRAW") || forceShow) {
          showExtraSection = extraAllowed && (regIsTie || !!match.went_to_extra_time);
          showPenSection = penAllowed && (regIsTie || !!match.decided_by_penalties);
        }
      }
    }

    const penaltiesLabel =
      match.decided_by_penalties && match.home_penalty_score != null && match.away_penalty_score != null
        ? `Karne: ${match.home_penalty_score}:${match.away_penalty_score}`
        : null;

    const extraLabel =
      match.went_to_extra_time && match.home_extra_time_score != null && match.away_extra_time_score != null
        ? `Dogrywka: ${match.home_extra_time_score}:${match.away_extra_time_score}`
        : null;

    const tennisLabel = tn ? `Sety: ${match.home_score ?? 0}:${match.away_score ?? 0}` : null;

    const isLive = match.status === "IN_PROGRESS" || match.status === "RUNNING";

    const bg = isFinished
      ? "rgba(30, 144, 255, 0.10)"
      : isLive
      ? "rgba(46, 204, 113, 0.08)"
      : wasEdited
      ? "rgba(46, 204, 113, 0.06)"
      : "transparent";

    const borderLeft = isFinished
      ? "4px solid rgba(30,144,255,0.8)"
      : isLive
      ? "4px solid rgba(46,204,113,0.8)"
      : wasEdited
      ? "4px solid rgba(46,204,113,0.6)"
      : "4px solid transparent";

    const finishVerdict = canFinishMatchUI({ tournament, match, cupMatches, allMatches: matches });
    const showFinishWarning = !finishVerdict.ok && !isFinished;

    const lockByFinish = isFinished && !inEditFinished;

    // w tenisie nie blokujemy edycji przez ET/karne (bo ich nie ma)
    const lockRegularInputs = isBusy || lockByFinish || (!tn && (!!match.went_to_extra_time || !!match.decided_by_penalties));

    const tennisSets = Array.isArray(match.tennis_sets) ? match.tennis_sets : [];

    const tennisValidation = tn ? validateTennisSetsForMatch({ tournament, sets: match.tennis_sets }) : { ok: true as const };

    // Bezpieczne renderowanie (null-safe)
    const homeName = teamLabel(match.home_team_name);
    const awayName = teamLabel(match.away_team_name);

    // Jeśli nie znasz dokładnego kontraktu propsów MatchLivePanel, a TS robi problemy,
    // to tym rzutowaniem wyciszamy typy w tym miejscu (nie wpływa na runtime).
    const MatchLivePanelAny = MatchLivePanel as any;

    return (
      <div
        key={match.id}
        style={{
          borderBottom: "1px solid #333",
          padding: "1rem 0",
          background: bg,
          borderLeft,
          paddingLeft: "0.75rem",
          marginBottom: "0.25rem",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "1rem",
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", gap: "1rem", alignItems: "center", minWidth: "250px" }}>
            <strong style={{ textAlign: "right", flex: 1 }}>{homeName}</strong>
            <span style={{ opacity: 0.6 }}>vs</span>
            <strong style={{ textAlign: "left", flex: 1 }}>{awayName}</strong>
          </div>

          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
            {tn && tennisLabel && <div style={{ opacity: 0.9, fontSize: "0.9em" }}>{tennisLabel}</div>}

            {!tn && extraLabel && (
              <div style={{ opacity: 0.85, fontSize: "0.85em" }}>
                {extraLabel} <span style={{ opacity: 0.6 }}>(dodaje się do wyniku)</span>
              </div>
            )}
            {!tn && penaltiesLabel && (
              <div style={{ opacity: 0.85, fontSize: "0.85em" }}>
                {penaltiesLabel} <span style={{ opacity: 0.6 }}>(nie wlicza się do wyniku)</span>
              </div>
            )}

            <div style={{ opacity: 0.6, fontSize: "0.85em" }}>{uiStatusLabel(status)}</div>
          </div>
        </div>

        {/* ===== Regular score / TENNIS sets ===== */}
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          {!tn ? (
            <>
              <input
                type="number"
                min={0}
                value={scoreToInputValue(match.home_score)}
                disabled={lockRegularInputs}
                onChange={(e) => {
                  const v = inputValueToScore(e.target.value);
                  updateLocalMatch(match.id, (m) => ({ ...m, home_score: v }));
                }}
                style={{ width: 70, textAlign: "center", padding: "0.4rem" }}
              />
              <span style={{ fontWeight: "bold" }}>:</span>
              <input
                type="number"
                min={0}
                value={scoreToInputValue(match.away_score)}
                disabled={lockRegularInputs}
                onChange={(e) => {
                  const v = inputValueToScore(e.target.value);
                  updateLocalMatch(match.id, (m) => ({ ...m, away_score: v }));
                }}
                style={{ width: 70, textAlign: "center", padding: "0.4rem" }}
              />
            </>
          ) : (
            <div style={{ width: "100%" }}>
              <div style={{ marginTop: "0.25rem", opacity: 0.85, fontSize: "0.9em" }}>
                Tenis (gemy). Best-of-{getTennisBestOf(tournament)}: do {tennisTargetSets(tournament)} wygranych setów.
              </div>

              <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                {tennisSets.map((s, idx) => {
                  const ns = normalizeTennisSet(s);
                  const needsTB = (ns.home_games === 7 && ns.away_games === 6) || (ns.home_games === 6 && ns.away_games === 7);
                  const setWinner = tennisSetWinner(ns);

                  return (
                    <div
                      key={idx}
                      style={{
                        display: "flex",
                        gap: "0.75rem",
                        alignItems: "center",
                        flexWrap: "wrap",
                        padding: "0.5rem",
                        border: "1px solid #333",
                        borderRadius: 6,
                        background: "rgba(255,255,255,0.02)",
                      }}
                    >
                      <div style={{ minWidth: 60, opacity: 0.75 }}>Set {idx + 1}</div>

                      <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                        <input
                          type="number"
                          min={0}
                          max={7}
                          value={scoreToInputValue(ns.home_games)}
                          disabled={lockRegularInputs}
                          onChange={(e) => updateTennisSet(match.id, idx, { home_games: inputValueToScore(e.target.value) })}
                          style={{ width: 70, textAlign: "center", padding: "0.35rem" }}
                        />
                        <span style={{ fontWeight: "bold" }}>:</span>
                        <input
                          type="number"
                          min={0}
                          max={7}
                          value={scoreToInputValue(ns.away_games)}
                          disabled={lockRegularInputs}
                          onChange={(e) => updateTennisSet(match.id, idx, { away_games: inputValueToScore(e.target.value) })}
                          style={{ width: 70, textAlign: "center", padding: "0.35rem" }}
                        />
                      </div>

                      <div style={{ opacity: 0.75, fontSize: "0.9em" }}>
                        gemy
                        {setWinner ? (
                          <span style={{ marginLeft: "0.5rem", opacity: 0.85 }}>
                            (wygrywa: {setWinner === 1 ? homeName : awayName})
                          </span>
                        ) : (
                          <span style={{ marginLeft: "0.5rem", color: "#e67e22" }}>(niepoprawny / niedokończony set)</span>
                        )}
                      </div>

                      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                        <label style={{ display: "flex", gap: "0.35rem", alignItems: "center", opacity: needsTB ? 1 : 0.6 }}>
                          <span style={{ fontSize: "0.85em" }}>TB</span>
                          <input
                            type="number"
                            min={0}
                            value={ns.home_tiebreak == null ? "" : String(ns.home_tiebreak)}
                            disabled={lockRegularInputs || !needsTB}
                            onChange={(e) => {
                              const raw = e.target.value;
                              updateTennisSet(match.id, idx, { home_tiebreak: raw === "" ? null : inputValueToScore(raw) });
                            }}
                            style={{ width: 60, textAlign: "center", padding: "0.3rem" }}
                          />
                          <span style={{ fontWeight: "bold", opacity: 0.7 }}>:</span>
                          <input
                            type="number"
                            min={0}
                            value={ns.away_tiebreak == null ? "" : String(ns.away_tiebreak)}
                            disabled={lockRegularInputs || !needsTB}
                            onChange={(e) => {
                              const raw = e.target.value;
                              updateTennisSet(match.id, idx, { away_tiebreak: raw === "" ? null : inputValueToScore(raw) });
                            }}
                            style={{ width: 60, textAlign: "center", padding: "0.3rem" }}
                          />
                        </label>

                        {!needsTB && (ns.home_tiebreak != null || ns.away_tiebreak != null) && (
                          <span style={{ color: "#e67e22", fontSize: "0.85em" }}>Tie-break dozwolony tylko przy 7:6 / 6:7.</span>
                        )}
                      </div>
                    </div>
                  );
                })}

                <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
                  <button
                    onClick={() => addTennisSet(match.id)}
                    disabled={lockRegularInputs || tennisSets.length >= getTennisBestOf(tournament)}
                    style={{
                      padding: "0.35rem 0.7rem",
                      borderRadius: 6,
                      border: "1px solid #444",
                      background: "rgba(255,255,255,0.05)",
                      color: "#fff",
                      cursor: "pointer",
                      opacity: lockRegularInputs || tennisSets.length >= getTennisBestOf(tournament) ? 0.5 : 1,
                      fontSize: "0.85em",
                    }}
                  >
                    Dodaj set
                  </button>

                  <button
                    onClick={() => removeLastTennisSet(match.id)}
                    disabled={lockRegularInputs || tennisSets.length <= 1}
                    style={{
                      padding: "0.35rem 0.7rem",
                      borderRadius: 6,
                      border: "1px solid #444",
                      background: "rgba(255,255,255,0.05)",
                      color: "#fff",
                      cursor: "pointer",
                      opacity: lockRegularInputs || tennisSets.length <= 1 ? 0.5 : 1,
                      fontSize: "0.85em",
                    }}
                  >
                    Usuń ostatni set
                  </button>

                  {!tennisValidation.ok && <span style={{ color: "#e67e22", fontSize: "0.85em" }}>{tennisValidation.message}</span>}
                </div>
              </div>
            </div>
          )}

          {/* ===== Buttons ===== */}
          {/* Toggle LIVE (zegar + incydenty) — jeden przycisk dla całej karty meczu */}
          <button
            type="button"
            onClick={() =>
              setOpenLive((prev) => {
                const n = new Set(prev);
                if (n.has(match.id)) n.delete(match.id);
                else n.add(match.id);
                return n;
              })
            }
            disabled={isBusy}
            style={{
              marginLeft: tn ? 0 : "1rem",
              padding: "0.4rem 0.8rem",
              borderRadius: 4,
              border: "1px solid #2e7d32",
              background: openLive.has(match.id) ? "rgba(46,204,113,0.12)" : "rgba(46,204,113,0.08)",
              color: "#fff",
              cursor: isBusy ? "not-allowed" : "pointer",
              opacity: isBusy ? 0.6 : 1,
              fontSize: "0.85em",
            }}
          >
            {openLive.has(match.id) ? "Ukryj LIVE (zegar + incydenty)" : "Pokaż LIVE (zegar + incydenty)"}
          </button>


                    {!isFinished ? (
            <>
              <button
                onClick={() => saveMatch(match.id)}
                disabled={isBusy || !isDirty}
                style={{
                  marginLeft: "1rem",
                  padding: "0.4rem 0.8rem",
                  borderRadius: 4,
                  border: "1px solid rgba(46,204,113,0.6)",
                  background: isDirty ? "rgba(46,204,113,0.18)" : "rgba(255,255,255,0.05)",
                  color: "#fff",
                  cursor: isBusy || !isDirty ? "not-allowed" : "pointer",
                  opacity: isBusy ? 0.6 : 1,
                  fontSize: "0.85em",
                }}
                title={isDirty ? "Zapisz zmiany wyniku" : "Brak zmian do zapisu"}
              >
                Zapisz wynik
              </button>

              {!openLive.has(match.id) && (
                <button
                  onClick={() => onFinishMatchClick(match.id)}
                  disabled={isBusy}
                  style={{
                    marginLeft: "0.6rem",
                    padding: "0.4rem 0.8rem",
                    borderRadius: 4,
                    border: "1px solid #555",
                    background: "rgba(255,255,255,0.05)",
                    color: "#fff",
                    cursor: "pointer",
                    opacity: isBusy ? 0.6 : 1,
                    fontSize: "0.85em",
                  }}
                >
                  Zakończ mecz
                </button>
              )}
            </>
          ) : inEditFinished ? (
            <>
              <button
                onClick={() => saveMatch(match.id)}
                disabled={isBusy || !isDirty}
                style={{
                  marginLeft: "1rem",
                  padding: "0.4rem 0.8rem",
                  borderRadius: 4,
                  border: "1px solid rgba(46,204,113,0.6)",
                  background: isDirty ? "rgba(46,204,113,0.18)" : "rgba(255,255,255,0.05)",
                  color: "#fff",
                  cursor: isBusy || !isDirty ? "not-allowed" : "pointer",
                  opacity: isBusy ? 0.6 : 1,
                  fontSize: "0.85em",
                }}
                title={isDirty ? "Zapisz zmiany w zakończonym meczu" : "Brak zmian do zapisu"}
              >
                Zapisz zmiany
              </button>

              <button
                onClick={() => cancelEditFinished(match.id)}
                disabled={isBusy}
                style={{
                  padding: "0.4rem 0.8rem",
                  borderRadius: 4,
                  border: "1px solid #555",
                  background: "rgba(255,255,255,0.05)",
                  color: "#fff",
                  cursor: "pointer",
                  opacity: isBusy ? 0.6 : 1,
                  fontSize: "0.85em",
                }}
              >
                Anuluj
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => startEditFinished(match)}
                disabled={isBusy}
                style={{
                  marginLeft: "1rem",
                  padding: "0.4rem 0.8rem",
                  borderRadius: 4,
                  border: "1px solid rgba(30,144,255,0.6)",
                  background: "rgba(30,144,255,0.25)",
                  color: "#fff",
                  cursor: "pointer",
                  opacity: isBusy ? 0.6 : 1,
                  fontSize: "0.85em",
                }}
              >
                Wprowadź zmiany
              </button>

              <button
                onClick={() => onContinueMatchClick(match.id)}
                disabled={isBusy}
                style={{
                  padding: "0.4rem 0.8rem",
                  borderRadius: 4,
                  border: "1px solid rgba(46,204,113,0.5)",
                  background: "rgba(46,204,113,0.12)",
                  color: "#fff",
                  cursor: "pointer",
                  opacity: isBusy ? 0.6 : 1,
                  fontSize: "0.85em",
                }}
                title="Cofnij zakończenie i wróć do statusu: W trakcie"
              >
                Wznów mecz
              </button>
            </>
          )}
        {/* ===== 409: wymuszenie synchronizacji wyniku → incydenty ===== */}
        {pendingForce?.matchId === match.id && (
          <div
            style={{
              marginTop: "0.85rem",
              padding: "0.75rem",
              borderRadius: 8,
              border: "1px solid rgba(231, 76, 60, 0.55)",
              background: "rgba(231, 76, 60, 0.08)",
            }}
          >
            <div style={{ fontSize: "0.9em", opacity: 0.95 }}>
              <strong>Konflikt synchronizacji</strong>: {pendingForce.message}
              {pendingForce.code ? <span style={{ marginLeft: "0.5rem", opacity: 0.7 }}>({pendingForce.code})</span> : null}
            </div>

            {Array.isArray(pendingForce.wouldDelete) && pendingForce.wouldDelete.length > 0 && (
              <div style={{ marginTop: "0.5rem", fontSize: "0.85em", opacity: 0.9 }}>
                Backend musiałby usunąć <strong>{pendingForce.wouldDelete.length}</strong> uzupełnionych incydentów GOAL.
              </div>
            )}

            <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.7rem", flexWrap: "wrap" }}>
              <button
                disabled={isBusy}
                onClick={async () => {
                  try {
                    setBusyMatchId(match.id);
                    await updateMatchScore(match, { force: true });

                    if (pendingForce.op === "FINISH") {
                      await finishMatch(match.id);
                    }

                    setPendingForce(null);

                    setDrafts((prev) => {
                      const n = { ...prev };
                      delete n[match.id];
                      return n;
                    });
                    setDirty((prev) => {
                      const n = new Set(prev);
                      n.delete(match.id);
                      return n;
                    });

                    setEdited((prev) => {
                      const n = new Set(prev);
                      n.add(match.id);
                      return n;
                    });

                    const t = await loadTournament().catch(() => tournament);
                    await loadMatches(t ?? null);

                    pushToast(pendingForce.op === "FINISH" ? "Mecz zakończony (wymuszenie)." : "Wynik zapisany (wymuszenie).", "success");
                  } catch (e2: any) {
                    pushToast(e2?.message ?? "Błąd.", "error");
                  } finally {
                    setBusyMatchId(null);
                  }
                }}
                style={{
                  padding: "0.45rem 0.85rem",
                  borderRadius: 6,
                  border: "1px solid rgba(231, 76, 60, 0.7)",
                  background: "rgba(231, 76, 60, 0.22)",
                  color: "#fff",
                  cursor: isBusy ? "not-allowed" : "pointer",
                  opacity: isBusy ? 0.6 : 1,
                  fontSize: "0.85em",
                }}
              >
                Wymuś (usuń uzupełnione incydenty)
              </button>

              <button
                disabled={isBusy}
                onClick={() => setPendingForce(null)}
                style={{
                  padding: "0.45rem 0.85rem",
                  borderRadius: 6,
                  border: "1px solid #555",
                  background: "rgba(255,255,255,0.05)",
                  color: "#fff",
                  cursor: isBusy ? "not-allowed" : "pointer",
                  opacity: isBusy ? 0.6 : 1,
                  fontSize: "0.85em",
                }}
              >
                Anuluj
              </button>
            </div>

            <div style={{ marginTop: "0.55rem", fontSize: "0.82em", opacity: 0.8 }}>
              Wymuszenie spowoduje dopasowanie LIVE do „szybkiego wyniku” poprzez usunięcie także tych incydentów GOAL,
              które mają już uzupełnionego zawodnika lub czas.
            </div>
          </div>
        )}
{isFinished && !inEditFinished && (
          <div style={{ marginTop: "0.5rem", fontSize: "0.85em", opacity: 0.75 }}>
            Mecz jest zakończony. Jeśli musisz poprawić wynik, kliknij „Wprowadź zmiany”.
          </div>
        )}

        {!tn && !lockByFinish && (match.went_to_extra_time || match.decided_by_penalties) && (
          <div style={{ marginTop: "0.5rem", fontSize: "0.85em", opacity: 0.75 }}>
            Aby zmienić wynik podstawowy, wyłącz najpierw dogrywkę i/lub karne.
          </div>
        )}

        {/* ===== Extra time section ===== */}
        {!tn && showExtraSection && (
          <div style={{ marginTop: "0.75rem", display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", opacity: 0.9 }}>
              <input
                type="checkbox"
                checked={!!match.went_to_extra_time}
                disabled={isBusy || lockByFinish || !extraAllowed}
                onChange={(e) => {
                  const checked = e.target.checked;
                  updateLocalMatch(match.id, (m) => ({
                    ...m,
                    went_to_extra_time: checked,
                    home_extra_time_score: checked ? (m.home_extra_time_score ?? 0) : null,
                    away_extra_time_score: checked ? (m.away_extra_time_score ?? 0) : null,
                  }));
                }}
              />
              Dogrywka
            </label>

            {match.went_to_extra_time && (
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <span style={{ opacity: 0.75, fontSize: "0.9em" }}>Wynik dogrywki:</span>
                <input
                  type="number"
                  min={0}
                  value={scoreToInputValue(match.home_extra_time_score ?? 0)}
                  disabled={isBusy || lockByFinish}
                  onChange={(e) => {
                    const v = inputValueToScore(e.target.value);
                    updateLocalMatch(match.id, (m) => ({ ...m, home_extra_time_score: v }));
                  }}
                  style={{ width: 70, textAlign: "center", padding: "0.35rem" }}
                />
                <span style={{ fontWeight: "bold" }}>:</span>
                <input
                  type="number"
                  min={0}
                  value={scoreToInputValue(match.away_extra_time_score ?? 0)}
                  disabled={isBusy || lockByFinish}
                  onChange={(e) => {
                    const v = inputValueToScore(e.target.value);
                    updateLocalMatch(match.id, (m) => ({ ...m, away_extra_time_score: v }));
                  }}
                  style={{ width: 70, textAlign: "center", padding: "0.35rem" }}
                />
              </div>
            )}
          </div>
        )}

        {/* ===== Penalties section ===== */}
        {!tn && showPenSection && (
          <div style={{ marginTop: "0.75rem", display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", opacity: 0.9 }}>
              <input
                type="checkbox"
                checked={!!match.decided_by_penalties}
                disabled={isBusy || lockByFinish || !penAllowed}
                onChange={(e) => {
                  const checked = e.target.checked;
                  updateLocalMatch(match.id, (m) => ({
                    ...m,
                    decided_by_penalties: checked,
                    home_penalty_score: checked ? (m.home_penalty_score ?? 0) : null,
                    away_penalty_score: checked ? (m.away_penalty_score ?? 0) : null,
                  }));
                }}
              />
              Rozstrzygnięcie w rzutach karnych
            </label>

            {match.decided_by_penalties && (
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <span style={{ opacity: 0.75, fontSize: "0.9em" }}>Karne:</span>
                <input
                  type="number"
                  min={0}
                  value={scoreToInputValue(match.home_penalty_score ?? 0)}
                  disabled={isBusy || lockByFinish}
                  onChange={(e) => {
                    const v = inputValueToScore(e.target.value);
                    updateLocalMatch(match.id, (m) => ({ ...m, home_penalty_score: v }));
                  }}
                  style={{ width: 70, textAlign: "center", padding: "0.35rem" }}
                />
                <span style={{ fontWeight: "bold" }}>:</span>
                <input
                  type="number"
                  min={0}
                  value={scoreToInputValue(match.away_penalty_score ?? 0)}
                  disabled={isBusy || lockByFinish}
                  onChange={(e) => {
                    const v = inputValueToScore(e.target.value);
                    updateLocalMatch(match.id, (m) => ({ ...m, away_penalty_score: v }));
                  }}
                  style={{ width: 70, textAlign: "center", padding: "0.35rem" }}
                />
              </div>
            )}
          </div>
        )}

        {showFinishWarning && <div style={{ marginTop: "0.6rem", fontSize: "0.85em", color: "#e74c3c" }}>{finishVerdict.message}</div>}

        {/* ============================================================
           MATCH LIVE / INCYDENTY (panel)
           ============================================================ */}
        {openLive.has(match.id) && (
          <div style={{ marginTop: "0.85rem" }}>
            <MatchLivePanelAny
              tournamentId={String(tournament?.id ?? "")}
              discipline={tournament?.discipline ?? ""}
              matchId={match.id}
              matchStatus={match.status}
              homeTeamId={match.home_team_id}
              awayTeamId={match.away_team_id}
              homeTeamName={homeName}
              awayTeamName={awayName}
              canEdit={!lockByFinish || inEditFinished}
              onAfterRecompute={() => refreshAfterLiveChange(match.id)}
            />
          </div>
        )}
      </div>
      </div>
    );
  };

  /* ============================================================
     RENDER
     ============================================================ */

  if (loading) return <p style={{ padding: "2rem" }}>Ładowanie…</p>;
  if (!tournament) return <p style={{ padding: "2rem" }}>Brak danych turnieju.</p>;

  if (!matches.length) {
    return (
      <div style={{ padding: "2rem" }}>
        <h1>Wprowadzanie wyników</h1>
        <p>Brak meczów.</p>
      </div>
    );
  }

  const hb = isHandball(tournament);
  const hbMode = hb ? getHandballTableDrawMode(tournament) : null;
  const hbTB = hb ? getHandballKnockoutTiebreak(tournament) : null;

  const tn = isTennis(tournament);
  const tnBestOf = tn ? getTennisBestOf(tournament) : null;
  const tnTarget = tn ? tennisTargetSets(tournament) : null;

  return (
    <div style={{ padding: "2rem", maxWidth: 980 }}>
      <h1>Wprowadzanie wyników</h1>

      <section
        style={{
          opacity: 0.85,
          marginBottom: "2rem",
          fontSize: "0.9em",
          borderLeft: "4px solid #555",
          paddingLeft: "1rem",
        }}
      >
        {tournament.name && (
          <div style={{ marginBottom: "0.25rem" }}>
            <strong>Turniej:</strong> {tournament.name}
          </div>
        )}

        <div>
          Wyniki zapisują się dopiero po kliknięciu <strong>„Zapisz wynik / Zapisz zmiany”</strong> (lub{" "}
          <strong>„Zakończ mecz”</strong>). Zmiany w checkboxach (dogrywka/karne) również wymagają zapisu.
        </div>

        {tn && (
          <div style={{ marginTop: "0.5rem", opacity: 0.9 }}>
            <strong>Tenis:</strong> wynik wpisujesz jako <strong>sety w gemach</strong>. Best-of-{tnBestOf}: do {tnTarget} wygranych setów.
            Tie-break podajesz tylko dla wyniku <strong>7:6</strong> (lub <strong>6:7</strong>).
          </div>
        )}

        {hb && (
          <div style={{ marginTop: "0.5rem", opacity: 0.85 }}>
            <strong>Piłka ręczna – tryb remisów:</strong>{" "}
            {hbMode === "ALLOW_DRAW"
              ? "Liga/grupa: remis dopuszczalny"
              : hbMode === "PENALTIES"
              ? "Liga/grupa: remis → karne"
              : "Liga/grupa: remis → dogrywka + karne"}{" "}
            | <strong>KO:</strong> {hbTB === "PENALTIES" ? "od razu karne" : "dogrywka + karne"}
          </div>
        )}
      </section>

      {stages.map((s: any) => {
        const headerTitle = stageHeaderTitle(s.stageType, s.stageOrder, s.allMatches);

        const isLastStage = s.stageId === lastStageId;
        const canAdvanceFromGroups =
          tournament?.tournament_format === "MIXED" && isLastStage && s.stageType === "GROUP" && allMatchesInLastStageFinished;

        return (
          <section key={s.stageId} style={{ marginTop: "3rem", paddingTop: "1rem", borderTop: "1px solid #333" }}>
            <h2 style={{ marginBottom: "1.5rem", color: "#eee" }}>{headerTitle}</h2>

            {s.stageType === "GROUP" ? (
              groupMatchesByGroup(s.matches).map(([groupName, gm], idx) => (
                <div key={groupName} style={{ marginBottom: "2rem", paddingLeft: "1rem", borderLeft: "2px solid #333" }}>
                  <h3 style={{ color: "#aaa", marginBottom: "1rem" }}>{displayGroupName(groupName, idx)}</h3>

                  {groupMatchesByRound(gm).map(([round, roundMatches]) => (
                    <div key={round} style={{ marginBottom: "1.5rem" }}>
                      <h4
                        style={{
                          margin: "0.5rem 0",
                          fontSize: "0.85rem",
                          textTransform: "uppercase",
                          opacity: 0.6,
                          letterSpacing: "1px",
                        }}
                      >
                        Kolejka {round}
                      </h4>
                      {roundMatches.map((m) => renderMatchRow(m))}
                    </div>
                  ))}
                </div>
              ))
            ) : s.stageType === "LEAGUE" ? (
              groupMatchesByRound(s.matches).map(([round, roundMatches]) => (
                <div key={round} style={{ marginBottom: "2rem" }}>
                  <h4
                    style={{
                      margin: "0.5rem 0",
                      fontSize: "0.9rem",
                      textTransform: "uppercase",
                      opacity: 0.6,
                      letterSpacing: "1px",
                      borderBottom: "1px solid #333",
                      paddingBottom: "0.25rem",
                    }}
                  >
                    Kolejka {round}
                  </h4>
                  {roundMatches.map((m) => renderMatchRow(m))}
                </div>
              ))
            ) : (
              <div>{s.matches.map((m: MatchDTO) => renderMatchRow(m))}</div>
            )}

            <div
              style={{
                marginTop: "1.5rem",
                padding: "1rem",
                background: "rgba(255,255,255,0.02)",
                borderRadius: "8px",
              }}
            >
              {canAdvanceFromGroups && (
                <div>
                  <button
                    disabled={busyGenerate}
                    onClick={advanceFromGroups}
                    style={{
                      padding: "0.7rem 1.2rem",
                      borderRadius: 6,
                      border: "1px solid rgba(46, 204, 113, 0.4)",
                      cursor: "pointer",
                      background: "rgba(46, 204, 113, 0.15)",
                      color: "#fff",
                      fontWeight: "bold",
                    }}
                  >
                    {busyGenerate ? "Generowanie..." : "Zakończ fazę grupową i generuj drabinkę"}
                  </button>
                  <p style={{ marginTop: "0.5rem", opacity: 0.65, fontSize: "0.9em" }}>
                    Wszystkie mecze w grupach są zakończone. Możesz przejść do fazy pucharowej.
                  </p>
                </div>
              )}

              {isLastStage && s.stageType === "KNOCKOUT" && (
                <div>
                  <button
                    disabled={!allMatchesInLastStageFinished || busyGenerate}
                    onClick={() =>
                      generateNextStage(s.stageId)
                        .then(() => pushToast("Następny etap wygenerowany.", "success"))
                        .catch((e: any) => pushToast(e?.message ?? "Błąd.", "error"))
                    }
                    style={{
                      padding: "0.7rem 1.2rem",
                      borderRadius: 6,
                      border: "1px solid #444",
                      background: allMatchesInLastStageFinished ? "#2980b9" : "#333",
                      color: "#fff",
                      opacity: allMatchesInLastStageFinished ? 1 : 0.5,
                      cursor: allMatchesInLastStageFinished ? "pointer" : "not-allowed",
                      fontWeight: "bold",
                    }}
                  >
                    {busyGenerate ? "Generowanie…" : "Generuj następny etap"}
                  </button>

                  {!allMatchesInLastStageFinished && (
                    <p style={{ marginTop: "0.5rem", opacity: 0.65, fontSize: "0.9em" }}>
                      Aby wygenerować następny etap, zakończ wszystkie mecze (przycisk „Zakończ mecz”).
                    </p>
                  )}
                </div>
              )}
            </div>
          </section>
        );
      })}

{/* Toasts (prawy dolny róg) */}
{toasts.length > 0 && (
  <div
    style={{
      position: "fixed",
      bottom: "2rem",
      right: "2rem",
      display: "flex",
      flexDirection: "column",
      gap: "0.6rem",
      zIndex: 9999,
      pointerEvents: "none",
    }}
  >
    {toasts.map((t) => {
      const borderLeft =
        t.kind === "error"
          ? "5px solid #e74c3c"
          : t.kind === "success" || t.kind === "saved"
          ? "5px solid #2ecc71"
          : "5px solid #777";

      return (
        <div
          key={t.id}
          style={{
            background: "#2b2b2b",
            color: "#fff",
            padding: "0.8rem 1.1rem",
            borderRadius: 10,
            boxShadow: "0 6px 18px rgba(0,0,0,0.45)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderLeft,
            minWidth: 260,
            maxWidth: 520,
            lineHeight: 1.35,
            fontSize: "0.95rem",
          }}
        >
          {t.text}
        </div>
      );
    })}
  </div>
)}

    </div>
  );
}
