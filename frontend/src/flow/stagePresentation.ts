// src/flow/stagePresentation.ts

export type StageType = "LEAGUE" | "KNOCKOUT" | "GROUP" | "THIRD_PLACE";

export type StageMatchLike = {
  id: number;
  stage_id: number;
  stage_order: number;
  stage_type: StageType;
  group_name?: string | null;
  round_number: number | null;

  home_team_name?: string | null;
  away_team_name?: string | null;
};

export function isByeTeamName(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = name.trim().toUpperCase();
  return (
    n === "BYE" ||
    n.includes("SYSTEM_BYE") ||
    n === "__SYSTEM_BYE__" ||
    n.includes("__SYSTEM_BYE__")
  );
}

export function isByeMatch(m: Pick<StageMatchLike, "home_team_name" | "away_team_name">): boolean {
  return isByeTeamName(m.home_team_name ?? null) || isByeTeamName(m.away_team_name ?? null);
}

export function displayGroupName(originalName: string, index: number): string {
  if (originalName && originalName.length <= 2 && originalName !== "—") return `Grupa ${originalName}`;
  const letter = String.fromCharCode(65 + index); // A, B, C...
  return `Grupa ${letter}`;
}

export function groupMatchesByGroup<T extends StageMatchLike>(matches: T[]) {
  const map = new Map<string, T[]>();
  for (const m of matches) {
    const key = m.group_name ?? "—";
    const arr = map.get(key) ?? [];
    arr.push(m);
    map.set(key, arr);
  }
  return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

export function groupMatchesByRound<T extends StageMatchLike>(matches: T[]) {
  const map = new Map<number, T[]>();
  for (const m of matches) {
    const round = m.round_number ?? 0;
    const arr = map.get(round) ?? [];
    arr.push(m);
    map.set(round, arr);
  }
  return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
}

export function groupMatchesByStage<T extends StageMatchLike>(matches: T[]) {
  const map = new Map<number, T[]>();
  for (const m of matches) {
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

function normalizeName(name: string | null | undefined): string {
  return (name ?? "").toString().trim();
}

export function countUniqueTeams<T extends StageMatchLike>(matches: T[]): number {
  const teams = new Set<string>();
  for (const m of matches) {
    const h = normalizeName(m.home_team_name ?? "");
    const a = normalizeName(m.away_team_name ?? "");
    if (h && !isByeTeamName(h)) teams.add(h);
    if (a && !isByeTeamName(a)) teams.add(a);
  }
  return teams.size;
}

export function resolveKoTitleFromMatches<T extends StageMatchLike>(matches: T[]): string {
  const teamCount = countUniqueTeams(matches);

  if (teamCount > 8 && teamCount <= 16) return "1/8 finału";
  if (teamCount > 4 && teamCount <= 8) return "Ćwierćfinał";
  if (teamCount > 2 && teamCount <= 4) return "Półfinał";
  if (teamCount === 2) return "Finał";

  if (teamCount > 16) return `1/${Math.floor(teamCount / 2)} finału`;
  return "Faza pucharowa";
}

export function stageHeaderTitle(
  stageType: StageType,
  stageOrder: number,
  matchesForTitle: StageMatchLike[]
): string {
  if (stageType === "THIRD_PLACE") return "Mecz o 3. miejsce";
  if (stageType === "GROUP") return "Faza grupowa";
  if (stageType === "LEAGUE") return "Liga";
  if (stageType === "KNOCKOUT") return resolveKoTitleFromMatches(matchesForTitle);
  return `Etap ${stageOrder}`;
}

export function buildStagesForView<T extends StageMatchLike>(
  matches: T[],
  opts: { showBye: boolean }
): Array<{
  stageId: number;
  stageType: StageType;
  stageOrder: number;
  matches: T[];
  allMatches: T[];
}> {
  const grouped = groupMatchesByStage(matches);

  return grouped
    .map(([stageId, stageMatches]) => {
      const filtered = opts.showBye ? stageMatches : stageMatches.filter((m) => !isByeMatch(m));
      const stageType = stageMatches[0]?.stage_type ?? "LEAGUE";
      const stageOrder = stageMatches[0]?.stage_order ?? 1;
      return { stageId, stageType, stageOrder, matches: filtered, allMatches: stageMatches };
    })
    .filter((s) => s.matches.length > 0);
}
