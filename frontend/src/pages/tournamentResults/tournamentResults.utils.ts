import type { MatchDTO, MatchStageType, TournamentDTO } from "./tournamentResults.types";

/* ============================================================
   BYE
   ============================================================ */

export function isByeName(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = name.trim().toUpperCase();
  return n === "BYE" || n.includes("SYSTEM_BYE") || n === "__SYSTEM_BYE__" || n.includes("__SYSTEM_BYE__");
}

export function isByeMatch(m: MatchDTO): boolean {
  return isByeName(m.home_team_name) || isByeName(m.away_team_name);
}

/* ============================================================
   KO labels (participants_count + stage_order)
   ============================================================ */

export function nextPowerOfTwo(n: number): number {
  if (n <= 1) return 1;
  return 2 ** Math.ceil(Math.log2(n));
}

export function knockoutRoundLabelFromTeams(teams: number): string {
  if (teams === 2) return "Finał";
  if (teams === 4) return "Półfinał";
  if (teams === 8) return "Ćwierćfinał";
  return `1/${teams / 2} finału`;
}

export function knockoutStageTitleFromOrder(
  tournamentParticipantsCount: number | undefined,
  stageOrder: number
): string | null {
  if (typeof tournamentParticipantsCount !== "number" || tournamentParticipantsCount < 2) return null;

  const bracket = nextPowerOfTwo(tournamentParticipantsCount);
  const safeOrder = Math.max(1, stageOrder || 1);

  const divisor = 2 ** (safeOrder - 1);
  const teamsInStage = Math.max(2, Math.floor(bracket / divisor));

  return knockoutRoundLabelFromTeams(teamsInStage);
}

export function stageHeaderTitle(stageType: MatchStageType, stageOrder: number, tournament: TournamentDTO): string {
  if (stageType === "THIRD_PLACE") return "Mecz o 3. miejsce";

  if (stageType === "KNOCKOUT") {
    const label = knockoutStageTitleFromOrder(tournament.participants_count, stageOrder);
    return `Puchar: ${label ?? `Etap ${stageOrder}`}`;
  }

  if (stageType === "GROUP") return `Faza grupowa — etap ${stageOrder}`;
  return `Liga — etap ${stageOrder}`;
}

/* ============================================================
   Score parsing
   ============================================================ */

export function scoreToInputValue(score: number): string {
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

/* ============================================================
   cup_matches (globalnie lub per stage_order)
   ============================================================ */

export function getCupMatchesForStage(tournament: TournamentDTO | null, stageOrder: number): 1 | 2 {
  const cfg = tournament?.format_config;

  const perStage = cfg?.cup_matches_by_stage_order?.[String(stageOrder)];
  if (perStage === 1 || perStage === 2) return perStage;

  const global = cfg?.cup_matches;
  if (global === 1 || global === 2) return global;

  return 1;
}

export function isKnockoutLike(stageType: MatchStageType): boolean {
  return stageType === "KNOCKOUT" || stageType === "THIRD_PLACE";
}

/**
 * Reguły UI dla przycisku "Mecz zakończony":
 * - KO (1 mecz): remis blokowany
 * - KO (dwumecz): remis w meczu dozwolony (agregat waliduje backend po 2 meczu)
 */
export function canFinishMatchUI(args: {
  stageType: MatchStageType;
  cupMatches: 1 | 2;
  homeScore: number;
  awayScore: number;
}): { ok: boolean; message?: string } {
  const { stageType, cupMatches, homeScore, awayScore } = args;

  if (!isKnockoutLike(stageType)) return { ok: true };

  if (cupMatches === 1 && homeScore === awayScore) {
    return { ok: false, message: "Mecz pucharowy (1 mecz) nie może zakończyć się remisem." };
  }

  // cup_matches=2: remis w meczu OK (agregat sprawdza backend)
  return { ok: true };
}

/* ============================================================
   Grouping stages for view
   ============================================================ */

export function groupVisibleMatchesByStage(matches: MatchDTO[]): Array<[number, MatchDTO[]]> {
  const visible = matches.filter((m) => !isByeMatch(m));

  const map = new Map<number, MatchDTO[]>();
  for (const m of visible) {
    const arr = map.get(m.stage_id) ?? [];
    arr.push(m);
    map.set(m.stage_id, arr);
  }

  const entries = Array.from(map.entries()).sort((a, b) => {
    const aOrder = a[1][0]?.stage_order ?? 0;
    const bOrder = b[1][0]?.stage_order ?? 0;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a[0] - b[0];
  });

  for (const [, arr] of entries) {
    arr.sort((a, b) => {
      const ra = a.round_number ?? 0;
      const rb = b.round_number ?? 0;
      if (ra !== rb) return ra - rb;
      return a.id - b.id;
    });
  }

  return entries;
}
