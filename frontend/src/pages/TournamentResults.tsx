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

export type TournamentDTO = {
  id: number;
  name?: string;
  discipline: string; // "football" | "handball" | ...
  tournament_format?: "LEAGUE" | "CUP" | "MIXED";
  status: "DRAFT" | "CONFIGURED" | "RUNNING" | "FINISHED";
  format_config?: {
    cup_matches?: number;
    cup_matches_by_stage_order?: Record<string, number>;

    // Handball config (opcjonalne)
    handball_table_draw_mode?: HandballTableDrawMode;
    handball_knockout_tiebreak?: HandballKnockoutTiebreak;
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
  home_score: number;
  away_score: number;

  // dogrywka
  went_to_extra_time?: boolean;
  home_extra_time_score?: number | null;
  away_extra_time_score?: number | null;

  // karne
  decided_by_penalties?: boolean;
  home_penalty_score?: number | null;
  away_penalty_score?: number | null;

  // meta
  result_entered?: boolean;
  winner_id?: number | null;
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

function isHandball(t: TournamentDTO | null): boolean {
  return lower(t?.discipline) === "handball";
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

  const scoreA =
    goalsForTeam(m1, a) + goalsForTeam(m2, a);
  const scoreB =
    goalsForTeam(m1, b) + goalsForTeam(m2, b);

  return { ok: true, tie: scoreA === scoreB, secondLegId: second.id };
}

function goalsForTeam(m: MatchDTO, teamId: number): number {
  const [fh, fa] = finalScore(m);
  if (m.home_team_id === teamId) return fh;
  if (m.away_team_id === teamId) return fa;
  return 0;
}

/* ============================================================
   UI / DOMAIN validation for Finish
   ============================================================ */

function canUseExtraTimeUI(t: TournamentDTO | null, m: MatchDTO): boolean {
  const hb = isHandball(t);

  if (isKnockoutLike(m.stage_type)) {
    if (hb && getHandballKnockoutTiebreak(t) === "PENALTIES") return false;
    return true; // football i inne: pozwól
  }

  // Handball w lidze/grupie zależnie od draw-mode
  if (hb && (m.stage_type === "LEAGUE" || m.stage_type === "GROUP")) {
    return getHandballTableDrawMode(t) === "OVERTIME_PENALTIES";
  }

  return false;
}

function canUsePenaltiesUI(t: TournamentDTO | null, m: MatchDTO): boolean {
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
  const extraAllowed = canUseExtraTimeUI(t, m);
  const penAllowed = canUsePenaltiesUI(t, m);

  let next: MatchDTO = { ...m };

  // 1) Jeśli konfiguracja zabrania – czyść
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

  // 2) Minimalna higiena: w KO (cup_matches=1) przy braku remisu nie trzymamy dogrywki/karnych
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

  // 3) Jeśli dogrywka wyłączona -> czyść jej wyniki
  if (!next.went_to_extra_time) {
    next.home_extra_time_score = null;
    next.away_extra_time_score = null;
  }

  // 4) Jeśli karne wyłączone -> czyść ich wyniki
  if (!next.decided_by_penalties) {
    next.home_penalty_score = null;
    next.away_penalty_score = null;
  }

  // 5) Dodatkowa logika handball:
  //    - w lidze/grupie: ALLOW_DRAW -> nie trzymamy rozstrzygnięć
  if (hb && (next.stage_type === "LEAGUE" || next.stage_type === "GROUP")) {
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
    }
  }

  // 6) Dwumecz: karnych NIE czyścimy automatycznie (mogą być potrzebne przy agregacie)
  //    ale pilnujemy, żeby włączenie karnych miało sens (wyniki nie-null, gdy checkbox on)
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

  const hb = isHandball(tournament);
  const stageType = match.stage_type;
  const knockoutLike = isKnockoutLike(stageType);

  const extraAllowed = canUseExtraTimeUI(tournament, match);
  const penAllowed = canUsePenaltiesUI(tournament, match);

  // ===== Spójność pól =====
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

  // ==========================================================
  // LEAGUE / GROUP – tylko handball ma tryby rozstrzygania remisów
  // ==========================================================
  if (!knockoutLike && hb && (stageType === "LEAGUE" || stageType === "GROUP")) {
    const mode = getHandballTableDrawMode(tournament);

    if (!regularTie(match)) return { ok: true };

    // remis
    if (mode === "ALLOW_DRAW") {
      return { ok: true };
    }

    if (mode === "PENALTIES") {
      if (!match.decided_by_penalties || !penaltiesValid(match)) {
        return { ok: false, message: "Piłka ręczna: remis wymaga rozstrzygnięcia w rzutach karnych." };
      }
      return { ok: true };
    }

    // OVERTIME_PENALTIES
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

  // ==========================================================
  // KO / THIRD_PLACE
  // ==========================================================
  if (knockoutLike) {
    // 1 mecz w parze -> musi być rozstrzygnięcie
    if (cupMatches === 1) {
      // handball KO – tryb tiebreak
      if (hb && regularTie(match)) {
        const tb = getHandballKnockoutTiebreak(tournament);

        if (tb === "PENALTIES") {
          if (!match.decided_by_penalties || !penaltiesValid(match)) {
            return { ok: false, message: "Piłka ręczna (KO): remis wymaga karnych (bez dogrywki w tej konfiguracji)." };
          }
          return { ok: true };
        }

        // OVERTIME_PENALTIES
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

      // football i inne: jeśli remis po final score -> wymagane karne
      if (finalTie(match)) {
        if (!match.decided_by_penalties || !penaltiesValid(match)) {
          return { ok: false, message: "Mecz pucharowy (1 mecz) nie może zakończyć się remisem – ustaw rozstrzygnięcie (karne)." };
        }
      }

      // Ważne: przy cup_matches=1, karne mają sens tylko przy remisie po final score
      // (backend /finish/ waliduje tę spójność)
      if (match.decided_by_penalties && !finalTie(match)) {
        return { ok: false, message: "Karne mają sens tylko przy remisie po regulaminie/dogrywce." };
      }

      return { ok: true };
    }

    // dwumecz: remis w pojedynczym meczu jest dozwolony,
    // ale przy domykaniu pary agregat nie może być remisowy (musi być rozstrzygnięcie w rewanżu).
    if (cupMatches === 2) {
      const pair = getPairMatches(allMatches, match);
      if (pair.length !== 2) {
        // BYE albo nienormalna para -> nie blokuj
        return { ok: true };
      }

      const other = pair.find((m) => m.id !== match.id);
      if (!other) return { ok: true };

      // Jeśli drugi mecz pary NIE jest jeszcze FINISHED, to domknięcie pary nie następuje -> nie blokuj
      if (other.status !== "FINISHED") return { ok: true };

      // teraz finish tego meczu domyka parę -> sprawdzamy agregat
      const agg = aggregateForPair(pair);
      const secondLegId = agg.secondLegId;

      if (!agg.ok) return { ok: true };

      if (agg.tie) {
        // rozstrzygnięcie jest w "rewanżu" (backend używa meczu o większym ID)
        if (secondLegId === match.id) {
          // to jest rewanż -> wymagamy karnych i ich poprawności
          if (!match.decided_by_penalties || !penaltiesValid(match)) {
            return { ok: false, message: "Dwumecz: agregat remisowy – rozstrzygnij karne w rewanżu." };
          }
          return { ok: true };
        } else {
          // rewanżem jest DRUGI mecz (już zakończony) -> musi już mieć wpisane karne
          const secondLeg = pair.find((m) => m.id === secondLegId);
          const ok = secondLeg?.decided_by_penalties && penaltiesValid(secondLeg);
          if (!ok) {
            return {
              ok: false,
              message: "Dwumecz: agregat remisowy – rozstrzygnięcie musi być w rewanżu (mecz o większym ID). Uzupełnij karne w rewanżu, potem zakończ ten mecz.",
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
  const [edited, setEdited] = useState<Set<number>>(new Set());

  /* ============================================================
     API calls
     ============================================================ */

  const loadTournament = async (): Promise<TournamentDTO> => {
    const res = await apiFetch(`/api/tournaments/${id}/`);
    if (!res.ok) throw new Error("Nie udało się pobrać turnieju.");
    const data = await res.json();
    setTournament(data);
    return data;
  };

  const loadMatches = async (): Promise<MatchDTO[]> => {
    const res = await apiFetch(`/api/tournaments/${id}/matches/`);
    if (!res.ok) throw new Error("Nie udało się pobrać meczów.");
    const raw = await res.json();

    const list: MatchDTO[] = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.results)
        ? raw.results
        : [];

    // Normalizacja pól opcjonalnych na wartości „bezpieczne” dla UI
    const normalized = list.map((m) => ({
      ...m,
      went_to_extra_time: !!m.went_to_extra_time,
      decided_by_penalties: !!m.decided_by_penalties,
      home_extra_time_score: m.home_extra_time_score ?? null,
      away_extra_time_score: m.away_extra_time_score ?? null,
      home_penalty_score: m.home_penalty_score ?? null,
      away_penalty_score: m.away_penalty_score ?? null,
    }));

    setMatches(normalized);
    return normalized;
  };

  const parseApiError = async (res: Response): Promise<string> => {
    const data = await res.json().catch(() => null);
    if (!data) return "Błąd żądania.";
    if (typeof (data as any)?.detail === "string") return (data as any).detail;
    return "Błąd żądania.";
  };

  const updateMatchScore = async (match: MatchDTO) => {
    const payload: any = {
      home_score: match.home_score,
      away_score: match.away_score,

      went_to_extra_time: !!match.went_to_extra_time,
      home_extra_time_score: match.went_to_extra_time ? (match.home_extra_time_score ?? 0) : null,
      away_extra_time_score: match.went_to_extra_time ? (match.away_extra_time_score ?? 0) : null,

      decided_by_penalties: !!match.decided_by_penalties,
      home_penalty_score: match.decided_by_penalties ? (match.home_penalty_score ?? 0) : null,
      away_penalty_score: match.decided_by_penalties ? (match.away_penalty_score ?? 0) : null,
    };

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
    await Promise.all([loadMatches(), loadTournament().catch(() => null)]);
    setBusyGenerate(false);
  };

  const advanceFromGroups = async () => {
    if (!id) return;
    setBusyGenerate(true);
    setMessage(null);
    try {
      const res = await apiFetch(`/api/tournaments/${id}/advance-from-groups/`, { method: "POST" });
      if (!res.ok) throw new Error(await parseApiError(res));
      await Promise.all([loadMatches(), loadTournament().catch(() => null)]);
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
        await Promise.all([loadTournament(), loadMatches()]);
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
    const last = stages.find((s) => s.stageId === lastStageId);
    if (!last) return false;
    if (!last.matches.length) return false;
    return last.matches.every((m) => m.status === "FINISHED");
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

  const saveMatch = async (matchId: number, opts?: { silentMessage?: boolean }) => {
    const match = matches.find((m) => m.id === matchId);
    if (!match) return;

    try {
      setBusyMatchId(match.id);
      if (!opts?.silentMessage) setMessage(null);

      await updateMatchScore(match);
      await Promise.all([loadMatches(), loadTournament().catch(() => null)]);

      setEdited((prev) => {
        const n = new Set(prev);
        n.add(match.id);
        return n;
      });

      if (!opts?.silentMessage) setMessage("Wynik zapisany.");
    } catch (e: any) {
      setMessage(e.message);
      await loadMatches().catch(() => null);
    } finally {
      setBusyMatchId(null);
    }
  };

  const saveOnBlur = async (matchId: number) => {
    await saveMatch(matchId);
  };

  const onFinishMatchClick = async (matchId: number) => {
    const match = matches.find((m) => m.id === matchId);
    if (!match) return;

    if (match.status === "FINISHED") {
      setMessage("Ten mecz jest już zakończony.");
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

      // przed finish zapisujemy aktualne dane (dogrywka/karne też)
      await updateMatchScore(match);

      await finishMatch(match.id);
      await Promise.all([loadMatches(), loadTournament().catch(() => null)]);
      setMessage("Mecz zakończony.");
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusyMatchId(null);
    }
  };

  const updateLocalMatch = (matchId: number, updater: (m: MatchDTO) => MatchDTO) => {
    setMatches((prev) => {
      const base = prev.map((m) => (m.id === matchId ? updater(m) : m));
      const changed = base.find((m) => m.id === matchId);
      if (!changed) return base;

      const cupMatches = getCupMatchesForStage(tournament, changed.stage_order);
      const normalized = normalizeMatchForConfig(tournament, changed, cupMatches, base);

      return base.map((m) => (m.id === matchId ? normalized : m));
    });
  };

  const renderMatchRow = (match: MatchDTO) => {
    if (isByeMatch(match)) return null;

    const status = uiStatus(match);
    const isBusy = busyMatchId === match.id;
    const wasEdited = edited.has(match.id);
    const isFinished = match.status === "FINISHED";
    const knockoutLike = isKnockoutLike(match.stage_type);
    const cupMatches = getCupMatchesForStage(tournament, match.stage_order);

    const hb = isHandball(tournament);
    const regIsTie = regularTie(match);
    const finIsTie = finalTie(match);

    const extraAllowed = canUseExtraTimeUI(tournament, match);
    const penAllowed = canUsePenaltiesUI(tournament, match);

    // Kiedy pokazać sekcje:
    // - KO cup=1: gdy remis w regulaminie lub już ustawiono dogrywkę/karne
    // - KO cup=2: pokazuj karne, gdy to rewanż i para może się domknąć agregatem remisowym
    // - Handball liga/grupa: zależnie od draw-mode (tylko gdy remis)
    let showExtraSection = false;
    let showPenSection = false;

    if (knockoutLike) {
      if (cupMatches === 1) {
        showExtraSection = extraAllowed && (regIsTie || !!match.went_to_extra_time);
        showPenSection = penAllowed && (finIsTie || !!match.decided_by_penalties || regIsTie);
      } else {
        // dwumecz
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
      if (regIsTie && mode !== "ALLOW_DRAW") {
        showExtraSection = extraAllowed;
        showPenSection = penAllowed;
      }
    }

    const penaltiesLabel =
      match.decided_by_penalties &&
      match.home_penalty_score != null &&
      match.away_penalty_score != null
        ? `Karne: ${match.home_penalty_score}:${match.away_penalty_score}`
        : null;

    const extraLabel =
      match.went_to_extra_time &&
      match.home_extra_time_score != null &&
      match.away_extra_time_score != null
        ? `Dogrywka: ${match.home_extra_time_score}:${match.away_extra_time_score}`
        : null;

    const bg = isFinished
      ? "rgba(30, 144, 255, 0.10)"
      : wasEdited
        ? "rgba(46, 204, 113, 0.08)"
        : "transparent";

    const borderLeft = isFinished
      ? "4px solid rgba(30,144,255,0.8)"
      : wasEdited
        ? "4px solid rgba(46,204,113,0.8)"
        : "4px solid transparent";

    // Ostrzeżenia (miękkie, informacyjne)
    const finishVerdict = canFinishMatchUI({ tournament, match, cupMatches, allMatches: matches });
    const showFinishWarning = !finishVerdict.ok && !isFinished;

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
            {extraLabel && (
              <div style={{ opacity: 0.85, fontSize: "0.85em" }}>
                {extraLabel} <span style={{ opacity: 0.6 }}>(dodaje się do wyniku)</span>
              </div>
            )}
            {penaltiesLabel && (
              <div style={{ opacity: 0.85, fontSize: "0.85em" }}>
                {penaltiesLabel} <span style={{ opacity: 0.6 }}>(nie wlicza się do wyniku)</span>
              </div>
            )}
            <div style={{ opacity: 0.6, fontSize: "0.85em" }}>{uiStatusLabel(status)}</div>
          </div>
        </div>

        {/* ===== Regular score ===== */}
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="number"
            min={0}
            value={scoreToInputValue(match.home_score)}
            disabled={isBusy}
            onChange={(e) => {
              const v = inputValueToScore(e.target.value);
              updateLocalMatch(match.id, (m) => ({ ...m, home_score: v }));
            }}
            onBlur={() => saveOnBlur(match.id)}
            style={{ width: 70, textAlign: "center", padding: "0.4rem" }}
          />
          <span style={{ fontWeight: "bold" }}>:</span>
          <input
            type="number"
            min={0}
            value={scoreToInputValue(match.away_score)}
            disabled={isBusy}
            onChange={(e) => {
              const v = inputValueToScore(e.target.value);
              updateLocalMatch(match.id, (m) => ({ ...m, away_score: v }));
            }}
            onBlur={() => saveOnBlur(match.id)}
            style={{ width: 70, textAlign: "center", padding: "0.4rem" }}
          />

          <button
            onClick={() => onFinishMatchClick(match.id)}
            disabled={isBusy}
            style={{
              marginLeft: "1rem",
              padding: "0.4rem 0.8rem",
              borderRadius: 4,
              border: "1px solid #555",
              background: isFinished ? "rgba(30,144,255,0.25)" : "rgba(255,255,255,0.05)",
              color: "#fff",
              cursor: "pointer",
              opacity: isBusy ? 0.6 : 1,
              fontSize: "0.85em",
            }}
          >
            {isFinished ? "Mecz zakończony" : "Zakończ mecz"}
          </button>
        </div>

        {/* ===== Extra time section ===== */}
        {showExtraSection && (
          <div
            style={{
              marginTop: "0.75rem",
              display: "flex",
              gap: "1rem",
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", opacity: 0.9 }}>
              <input
                type="checkbox"
                checked={!!match.went_to_extra_time}
                disabled={isBusy || isFinished || !extraAllowed}
                onChange={async (e) => {
                  const checked = e.target.checked;
                  updateLocalMatch(match.id, (m) => ({
                    ...m,
                    went_to_extra_time: checked,
                    home_extra_time_score: checked ? (m.home_extra_time_score ?? 0) : null,
                    away_extra_time_score: checked ? (m.away_extra_time_score ?? 0) : null,
                  }));
                  // zapis od razu – checkbox nie ma naturalnego onBlur UX
                  await saveMatch(match.id, { silentMessage: true });
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
                  disabled={isBusy || isFinished}
                  onChange={(e) => {
                    const v = inputValueToScore(e.target.value);
                    updateLocalMatch(match.id, (m) => ({ ...m, home_extra_time_score: v }));
                  }}
                  onBlur={() => saveOnBlur(match.id)}
                  style={{ width: 70, textAlign: "center", padding: "0.35rem" }}
                />
                <span style={{ fontWeight: "bold" }}>:</span>
                <input
                  type="number"
                  min={0}
                  value={scoreToInputValue(match.away_extra_time_score ?? 0)}
                  disabled={isBusy || isFinished}
                  onChange={(e) => {
                    const v = inputValueToScore(e.target.value);
                    updateLocalMatch(match.id, (m) => ({ ...m, away_extra_time_score: v }));
                  }}
                  onBlur={() => saveOnBlur(match.id)}
                  style={{ width: 70, textAlign: "center", padding: "0.35rem" }}
                />
              </div>
            )}
          </div>
        )}

        {/* ===== Penalties section ===== */}
        {showPenSection && (
          <div
            style={{
              marginTop: "0.75rem",
              display: "flex",
              gap: "1rem",
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", opacity: 0.9 }}>
              <input
                type="checkbox"
                checked={!!match.decided_by_penalties}
                disabled={isBusy || isFinished || !penAllowed}
                onChange={async (e) => {
                  const checked = e.target.checked;
                  updateLocalMatch(match.id, (m) => ({
                    ...m,
                    decided_by_penalties: checked,
                    home_penalty_score: checked ? (m.home_penalty_score ?? 0) : null,
                    away_penalty_score: checked ? (m.away_penalty_score ?? 0) : null,
                  }));
                  await saveMatch(match.id, { silentMessage: true });
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
                  disabled={isBusy || isFinished}
                  onChange={(e) => {
                    const v = inputValueToScore(e.target.value);
                    updateLocalMatch(match.id, (m) => ({ ...m, home_penalty_score: v }));
                  }}
                  onBlur={() => saveOnBlur(match.id)}
                  style={{ width: 70, textAlign: "center", padding: "0.35rem" }}
                />
                <span style={{ fontWeight: "bold" }}>:</span>
                <input
                  type="number"
                  min={0}
                  value={scoreToInputValue(match.away_penalty_score ?? 0)}
                  disabled={isBusy || isFinished}
                  onChange={(e) => {
                    const v = inputValueToScore(e.target.value);
                    updateLocalMatch(match.id, (m) => ({ ...m, away_penalty_score: v }));
                  }}
                  onBlur={() => saveOnBlur(match.id)}
                  style={{ width: 70, textAlign: "center", padding: "0.35rem" }}
                />
              </div>
            )}
          </div>
        )}

        {/* ===== Informacyjne ostrzeżenia ===== */}
        {showFinishWarning && (
          <div style={{ marginTop: "0.6rem", fontSize: "0.85em", color: "#e74c3c" }}>
            {finishVerdict.message}
          </div>
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
        <div>Wyniki zapisują się automatycznie po opuszczeniu pola (onBlur). Checkboxy zapisują się od razu.</div>
        {hb && (
          <div style={{ marginTop: "0.5rem", opacity: 0.85 }}>
            <strong>Piłka ręczna – tryb remisów:</strong>{" "}
            {hbMode === "ALLOW_DRAW"
              ? "Liga/grupa: remis dopuszczalny"
              : hbMode === "PENALTIES"
                ? "Liga/grupa: remis → karne"
                : "Liga/grupa: remis → dogrywka + karne"}{" "}
            | <strong>KO:</strong>{" "}
            {hbTB === "PENALTIES" ? "od razu karne" : "dogrywka + karne"}
          </div>
        )}
      </section>

      {stages.map((s) => {
        const headerTitle = stageHeaderTitle(s.stageType, s.stageOrder, s.allMatches);

        const isLastStage = s.stageId === lastStageId;
        const canAdvanceFromGroups =
          tournament?.tournament_format === "MIXED" &&
          isLastStage &&
          s.stageType === "GROUP" &&
          allMatchesInLastStageFinished;

        return (
          <section
            key={s.stageId}
            style={{ marginTop: "3rem", paddingTop: "1rem", borderTop: "1px solid #333" }}
          >
            <h2 style={{ marginBottom: "1.5rem", color: "#eee" }}>{headerTitle}</h2>

            {s.stageType === "GROUP" ? (
              groupMatchesByGroup(s.matches).map(([groupName, gm], idx) => (
                <div
                  key={groupName}
                  style={{ marginBottom: "2rem", paddingLeft: "1rem", borderLeft: "2px solid #333" }}
                >
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
              <div>{s.matches.map((m) => renderMatchRow(m))}</div>
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