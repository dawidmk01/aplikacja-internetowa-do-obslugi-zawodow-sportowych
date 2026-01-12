import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { apiFetch } from "../api";
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
export type MatchStatus = "SCHEDULED" | "IN_PROGRESS" | "FINISHED";

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

  home_team_name: string;
  away_team_name: string;

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

  // inne wyniki nie zamykają seta (np. 6:5, 5:6, 4:4 itd.)
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
        message:
          `Nieprawidłowy wynik w secie ${i + 1}. ` +
          "Dozwolone: 6:0–6:4, 7:5, 7:6 (wymaga tie-breaka).",
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

function aggregateForPair(pair: MatchDTO[]): {
  ok: boolean;
  tie: boolean;
  secondLegId: number | null;
  message?: string;
} {
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

function normalizeMatchForConfig(
  t: TournamentDTO | null,
  m: MatchDTO,
  cupMatches: 1 | 2,
  allMatches: MatchDTO[]
): MatchDTO {
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
    // blokada dwumeczu w KO
    if (knockoutLike && cupMatches === 2) {
      return { ok: false, message: "Tenis nie wspiera trybu dwumeczu (cup_matches=2)." };
    }

    // brak ET/karnych
    if (match.went_to_extra_time || match.decided_by_penalties) {
      return { ok: false, message: "W tenisie nie obsługujemy dogrywki ani karnych." };
    }

    const v = validateTennisSetsForMatch({ tournament, sets: match.tennis_sets });
    if (!v.ok) return { ok: false, message: v.message ?? "Nieprawidłowy wynik tenisowy." };

    if (!v.finished) {
      const target = tennisTargetSets(tournament);
      return { ok: false, message: `Aby zakończyć mecz, ktoś musi wygrać ${target} sety (best-of-${getTennisBestOf(tournament)}).` };
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
          return { ok: false, message: "Mecz pucharowy (1 mecz) nie może zakończyć się remisem – ustaw rozstrzygnięcie (karne)." };
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
  const [loading, setLoading] = useState(true);

  const [busyMatchId, setBusyMatchId] = useState<number | null>(null);
  const [busyGenerate, setBusyGenerate] = useState(false);

  const [message, setMessage] = useState<string | null>(null);

  // "edited" = zapisane (zielony akcent)
  const [edited, setEdited] = useState<Set<number>>(new Set());

  // "dirty" = ma niezapisane zmiany
  const [dirty, setDirty] = useState<Set<number>>(new Set());

  // drafty – żeby reload po zapisie nie kasował innych lokalnych zmian
  const [drafts, setDrafts] = useState<Record<number, MatchDraft>>({});

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
    setMessage("Tryb edycji: po zapisaniu zmiany mogą wpłynąć na kolejne etapy KO.");
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

    setMessage("Edycja anulowana.");
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

  const parseApiError = async (res: Response): Promise<string> => {
    const data = await res.json().catch(() => null);
    if (!data) return "Błąd żądania.";
    if (typeof (data as any)?.detail === "string") return (data as any).detail;
    return "Błąd żądania.";
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

    const normalizedApi = list.map((m: any) => ({
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
    }));

    const effectiveTournament = tOverride ?? tournament;
    const final = mergeDrafts(normalizedApi, effectiveTournament ?? null);

    setMatches(final);
    return final;
  };

  const updateMatchScore = async (match: MatchDTO) => {
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

    const res = await apiFetch(`/api/matches/${match.id}/result/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(await parseApiError(res));
  };

  const finishMatch = async (matchId: number) => {
    const res = await apiFetch(`/api/matches/${matchId}/finish/`, { method: "POST" });
    if (!res.ok) throw new Error(await parseApiError(res));
  };

  const generateNextStage = async (stageId: number) => {
    if (!id) return;
    setBusyGenerate(true);
    setMessage(null);
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
    setMessage(null);
    try {
      const res = await apiFetch(`/api/tournaments/${id}/advance-from-groups/`, { method: "POST" });
      if (!res.ok) throw new Error(await parseApiError(res));
      const t = await loadTournament().catch(() => tournament);
      await loadMatches(t ?? null);
      setMessage("Faza pucharowa wygenerowana.");
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusyGenerate(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    let mounted = true;

    const init = async () => {
      try {
        setMessage(null);
        setLoading(true);

        // najpierw turniej (konfig), potem mecze (normalizacja)
        const t = await loadTournament();
        await loadMatches(t);
      } catch (e: any) {
        if (mounted) setMessage(e.message);
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
    if (m.status === "IN_PROGRESS") return "W_TRAKCIE";
    return "ZAPLANOWANY";
  }

  function uiStatusLabel(s: ReturnType<typeof uiStatus>) {
    if (s === "ZAPLANOWANY") return "Zaplanowany";
    if (s === "W_TRAKCIE") return "W trakcie";
    return "Zakończony";
  }

  const saveMatch = async (matchId: number, opts?: { silentMessage?: boolean; matchOverride?: MatchDTO }) => {
    const match = opts?.matchOverride ?? matches.find((m) => m.id === matchId);
    if (!match) return;

    try {
      setBusyMatchId(match.id);
      if (!opts?.silentMessage) setMessage(null);

      await updateMatchScore(match);

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

      if (isEditingFinished(match.id)) {
        exitEditFinished(match.id);
      }

      if (!opts?.silentMessage) setMessage("Wynik zapisany.");
    } catch (e: any) {
      setMessage(e.message);
      await loadMatches(tournament).catch(() => null);
    } finally {
      setBusyMatchId(null);
    }
  };

  const onFinishMatchClick = async (matchId: number) => {
    const match = matches.find((m) => m.id === matchId);
    if (!match) return;

    if (match.status === "FINISHED") {
      setMessage("Ten mecz jest już zakończony. Użyj „Wprowadź zmiany”, jeśli chcesz coś poprawić.");
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
      setMessage(verdict.message ?? "Nie można zakończyć meczu.");
      return;
    }

    try {
      setBusyMatchId(match.id);
      setMessage(null);

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

      setMessage("Mecz zakończony.");
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusyMatchId(null);
    }
  };

  const updateLocalMatch = (matchId: number, updater: (m: MatchDTO) => MatchDTO) => {
    const current = matches.find((m) => m.id === matchId);
    if (!current) return;

    const base = matches.map((m) => (m.id === matchId ? updater(m) : m));
    const changed = base.find((m) => m.id === matchId);
    if (!changed) return;

    const cupMatches = getCupMatchesForStage(tournament, changed.stage_order);
    const normalizedChanged = normalizeMatchForConfig(tournament, changed, cupMatches, base);

    const nextList = base.map((m) => (m.id === matchId ? normalizedChanged : m));
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
      const nextSet = normalizeTennisSet({ ...current, ...patch });
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
    const isDirty = dirty.has(match.id);

    const isFinished = match.status === "FINISHED";
    const inEditFinished = isFinished && isEditingFinished(match.id);

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

    const bg = isFinished ? "rgba(30, 144, 255, 0.10)" : wasEdited ? "rgba(46, 204, 113, 0.08)" : "transparent";

    const borderLeft = isFinished
      ? "4px solid rgba(30,144,255,0.8)"
      : wasEdited
      ? "4px solid rgba(46,204,113,0.8)"
      : "4px solid transparent";

    const finishVerdict = canFinishMatchUI({ tournament, match, cupMatches, allMatches: matches });
    const showFinishWarning = !finishVerdict.ok && !isFinished;

    const lockByFinish = isFinished && !inEditFinished;

    // w tenisie nie blokujemy edycji przez ET/karne (bo ich nie ma)
    const lockRegularInputs = isBusy || lockByFinish || (!tn && (!!match.went_to_extra_time || !!match.decided_by_penalties));

    const tennisSets = Array.isArray(match.tennis_sets) ? match.tennis_sets : [];

    const tennisValidation = tn ? validateTennisSetsForMatch({ tournament, sets: match.tennis_sets }) : { ok: true as const };

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
            <strong style={{ textAlign: "right", flex: 1 }}>{match.home_team_name}</strong>
            <span style={{ opacity: 0.6 }}>vs</span>
            <strong style={{ textAlign: "left", flex: 1 }}>{match.away_team_name ?? "—"}</strong>
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
                            (wygrywa: {setWinner === 1 ? match.home_team_name : match.away_team_name})
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
                            value={scoreToInputValue(ns.home_tiebreak ?? 0)}
                            disabled={lockRegularInputs || !needsTB}
                            onChange={(e) =>
                              updateTennisSet(match.id, idx, { home_tiebreak: needsTB ? inputValueToScore(e.target.value) : null })
                            }
                            style={{ width: 60, textAlign: "center", padding: "0.3rem" }}
                          />
                          <span style={{ fontWeight: "bold", opacity: 0.7 }}>:</span>
                          <input
                            type="number"
                            min={0}
                            value={scoreToInputValue(ns.away_tiebreak ?? 0)}
                            disabled={lockRegularInputs || !needsTB}
                            onChange={(e) =>
                              updateTennisSet(match.id, idx, { away_tiebreak: needsTB ? inputValueToScore(e.target.value) : null })
                            }
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
          {!isFinished ? (
            <>
              <button
                onClick={() => saveMatch(match.id)}
                disabled={isBusy || !isDirty}
                style={{
                  marginLeft: tn ? 0 : "1rem",
                  padding: "0.4rem 0.8rem",
                  borderRadius: 4,
                  border: "1px solid rgba(46,204,113,0.5)",
                  background: isDirty ? "rgba(46,204,113,0.18)" : "rgba(255,255,255,0.05)",
                  color: "#fff",
                  cursor: isDirty ? "pointer" : "not-allowed",
                  opacity: isBusy ? 0.6 : 1,
                  fontSize: "0.85em",
                }}
              >
                Zapisz wynik
              </button>

              <button
                onClick={() => onFinishMatchClick(match.id)}
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
                Zakończ mecz
              </button>

              {isDirty && <span style={{ marginLeft: "0.5rem", fontSize: "0.85em", opacity: 0.75 }}>Niezapisane zmiany</span>}
            </>
          ) : !inEditFinished ? (
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
          ) : (
            <>
              <button
                onClick={() => saveMatch(match.id)}
                disabled={isBusy || !isDirty}
                style={{
                  marginLeft: "1rem",
                  padding: "0.4rem 0.8rem",
                  borderRadius: 4,
                  border: "1px solid rgba(46,204,113,0.5)",
                  background: isDirty ? "rgba(46,204,113,0.18)" : "rgba(255,255,255,0.05)",
                  color: "#fff",
                  cursor: isDirty ? "pointer" : "not-allowed",
                  opacity: isBusy ? 0.6 : 1,
                  fontSize: "0.85em",
                }}
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

              {isDirty && <span style={{ marginLeft: "0.5rem", fontSize: "0.85em", opacity: 0.75 }}>Niezapisane zmiany</span>}
            </>
          )}
        </div>

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

        {showFinishWarning && (
          <div style={{ marginTop: "0.6rem", fontSize: "0.85em", color: "#e74c3c" }}>{finishVerdict.message}</div>
        )}
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
                        .then(() => setMessage("Następny etap wygenerowany."))
                        .catch((e: any) => setMessage(e.message))
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

      {message && (
        <div
          style={{
            position: "fixed",
            bottom: "2rem",
            right: "2rem",
            background: "#333",
            color: "#fff",
            padding: "1rem 2rem",
            borderRadius: "8px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
            borderLeft: "5px solid #2ecc71",
          }}
        >
          {message}
        </div>
      )}
    </div>
  );
}
