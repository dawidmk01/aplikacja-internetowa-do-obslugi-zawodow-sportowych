// frontend/src/pages/_shared/TournamentMatchesScaffold.tsx
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

import {
  Check,
  ChevronDown,
  ChevronUp,
  Eraser,
  Filter,
  LayoutGrid,
  LayoutList,
  Search,
} from "lucide-react";

import { cn } from "../../lib/cn";

import { Card } from "../../ui/Card";
import { Input } from "../../ui/Input";

export type MatchStatusBucket = "PLANNED" | "IN_PROGRESS" | "FINISHED";
export type StageFilterMode = "ALL" | "GROUP" | "KNOCKOUT";
export type BaseLayoutMode = "rounds" | "groups";

// Dodatkowy priorytet sortowania w obrębie sekcji
export type SecondaryPriority = "none" | "status" | "term";

export type StageType = "LEAGUE" | "KNOCKOUT" | "GROUP" | "THIRD_PLACE";

export type ViewMode = "list" | "grid";

export type MatchLikeBase = {
  id: number;

  stage_id: number;
  stage_type: StageType;
  stage_order: number;

  round_number?: number | null;
  group_name?: string | null;

  home_team_name: string;
  away_team_name: string;

  status?: string | null;

  scheduled_date?: string | null; // "YYYY-MM-DD"
  scheduled_time?: string | null; // "HH:MM" / "HH:MM:SS"
};

type StageView<TMatch extends MatchLikeBase> = {
  stageId: number;
  stageType: StageType;
  stageOrder: number;

  // do renderowania (bez BYE)
  matches: TMatch[];

  // do opcji filtrów/tytułów (z BYE)
  allMatches: TMatch[];
};

type FilterOption = {
  value: string;
  label: string;
  count: number;
  stage?: string;
};

export type MatchFiltersState = {
  stage: StageFilterMode;
  query: string;

  statuses: MatchStatusBucket[];
  rounds: string[];
  groups: string[];

  // Sortowanie (1 stopień)
  baseLayout: BaseLayoutMode;

  // Sortowanie (2 stopień) - tylko jedno
  secondaryPriority: SecondaryPriority;

  // Widok
  splitByStatus: boolean;
};

type MatchesFilterPanelProps = {
  totalMatchesCount: number;
  statusCounts: Record<MatchStatusBucket, number>;
  stages: { value: StageFilterMode; label: string }[];
  roundOptions: FilterOption[];
  groupOptions: FilterOption[];
  value: MatchFiltersState;
  onChange: (next: MatchFiltersState) => void;

  showByeAvailable: boolean;
  showBye: boolean;
  onToggleShowBye: (next: boolean) => void;

  showLayoutSection: boolean;

  // Widok listy/siatki
  viewMode: ViewMode;
  onViewModeChange: (next: ViewMode) => void;
};

export type TournamentMatchesScaffoldProps<TMatch extends MatchLikeBase> = {
  tournamentId: string;
  tournamentFormat?: string | null;

  title: string;
  description?: string;

  loading?: boolean;
  matches: TMatch[];

  headerSlot?: ReactNode;

  // Jeśli nie podasz, domyślnie: turniejepro.matches
  storageKeyPrefix?: string;
  // np. "schedule" albo "results" - rozdziela zapisy w localStorage
  storageScope: string;

  // Render pojedynczego meczu (bez BYE)
  renderMatch: (m: TMatch) => ReactNode;

  // Opcjonalnie: własna karta BYE
  renderByeMatch?: (m: TMatch, bucket: MatchStatusBucket) => ReactNode;

  // Opcjonalnie: własny tytuł etapu
  stageTitle?: (stageType: StageType, allMatches: TMatch[]) => string;
};

function safeReadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeWriteJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // brak
  }
}

export function normalizePL(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function bucketForStatus(status?: string | null): MatchStatusBucket {
  if (status === "FINISHED") return "FINISHED";
  if (status === "IN_PROGRESS" || status === "RUNNING") return "IN_PROGRESS";
  return "PLANNED";
}

export function sectionCardClasses(bucket: MatchStatusBucket): {
  shell: string;
  dot: string;
  title: string;
} {
  if (bucket === "IN_PROGRESS") {
    return {
      shell: "border-emerald-400/20 bg-emerald-500/[0.06]",
      dot: "bg-emerald-400/80",
      title: "text-emerald-50",
    };
  }
  if (bucket === "FINISHED") {
    return {
      shell: "border-amber-400/20 bg-amber-500/[0.06]",
      dot: "bg-amber-400/80",
      title: "text-amber-50",
    };
  }
  return {
    shell: "border-sky-400/20 bg-sky-500/[0.06]",
    dot: "bg-sky-400/80",
    title: "text-sky-50",
  };
}

function toggleInArray<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

export function isByeMatch<TMatch extends MatchLikeBase>(m: TMatch): boolean {
  const h = normalizePL(String(m.home_team_name || ""));
  const a = normalizePL(String(m.away_team_name || ""));
  return (
    h.includes("bye") ||
    a.includes("bye") ||
    h.includes("__system_bye__") ||
    a.includes("__system_bye__")
  );
}

function parseFirstInt(s: string): number | null {
  const m = String(s || "").match(/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

function sortOptionsStable(options: FilterOption[]): FilterOption[] {
  return [...options].sort((a, b) => {
    const an = parseFirstInt(a.label);
    const bn = parseFirstInt(b.label);

    if (an !== null && bn !== null) return an - bn;
    if (an !== null) return -1;
    if (bn !== null) return 1;

    return a.label.localeCompare(b.label, "pl");
  });
}

function groupMatchesByRound<TMatch extends MatchLikeBase>(
  matches: TMatch[]
): Array<[string, TMatch[]]> {
  const map = new Map<string, TMatch[]>();

  for (const m of matches) {
    const r = String(m.round_number ?? 0);
    const arr = map.get(r) ?? [];
    arr.push(m);
    map.set(r, arr);
  }

  return [...map.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
}

function groupMatchesByGroup<TMatch extends MatchLikeBase>(
  matches: TMatch[]
): Array<[string, TMatch[]]> {
  const map = new Map<string, TMatch[]>();

  for (const m of matches) {
    const g = String(m.group_name ?? "").trim() || "-";
    const arr = map.get(g) ?? [];
    arr.push(m);
    map.set(g, arr);
  }

  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], "pl"));
}

function displayGroupNameByIndex(idx: number): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  if (idx >= 0 && idx < letters.length) return `Grupa ${letters[idx]}`;
  return `Grupa ${idx + 1}`;
}

function buildStagesForView<TMatch extends MatchLikeBase>(
  allMatches: TMatch[]
): StageView<TMatch>[] {
  const stageMap = new Map<
    number,
    { stageType: StageType; stageOrder: number; allMatches: TMatch[] }
  >();

  for (const m of allMatches) {
    const stageId = Number(m.stage_id);
    const stageType = String(m.stage_type) as StageType;
    const stageOrder = Number(m.stage_order ?? 0);

    if (!Number.isFinite(stageId)) continue;

    const entry = stageMap.get(stageId) ?? { stageType, stageOrder, allMatches: [] };
    entry.stageType = entry.stageType ?? stageType;
    entry.stageOrder = Number.isFinite(entry.stageOrder) ? entry.stageOrder : stageOrder;
    entry.allMatches.push(m);
    stageMap.set(stageId, entry);
  }

  return [...stageMap.entries()]
    .map(([stageId, s]) => ({
      stageId,
      stageType: s.stageType,
      stageOrder: s.stageOrder,
      allMatches: s.allMatches,
      matches: s.allMatches.filter((m) => !isByeMatch(m)),
    }))
    .sort((a, b) => {
      if (a.stageOrder !== b.stageOrder) return a.stageOrder - b.stageOrder;
      return a.stageId - b.stageId;
    });
}

function knockoutTitleFromMatchCount(matchesCount: number): string {
  if (matchesCount <= 0) return "Puchar";

  if (matchesCount === 1) return "Finał";
  if (matchesCount === 2) return "Półfinał";
  if (matchesCount === 4) return "Ćwierćfinał";

  const denom = matchesCount * 2;
  if (denom >= 2) return `1/${denom} Finału`;

  return "Puchar";
}

function defaultStageHeaderTitle(stageType: StageType, allMatches: MatchLikeBase[]): string {
  if (stageType === "LEAGUE") return "Liga";
  if (stageType === "GROUP") return "Faza grupowa";
  if (stageType === "THIRD_PLACE") return "Mecz o 3 miejsce";
  if (stageType === "KNOCKOUT") return knockoutTitleFromMatchCount(allMatches.length);
  return "Etap";
}

export function formatDatePL(iso: string): string {
  try {
    const [y, m, d] = iso.split("-").map((x) => Number(x));
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return iso;
    const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
    return new Intl.DateTimeFormat("pl-PL", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(dt);
  } catch {
    return iso;
  }
}

function getScheduleKey<TMatch extends MatchLikeBase>(m: TMatch): string | null {
  const d = m.scheduled_date ?? null;
  const t = m.scheduled_time ?? null;
  if (!d) return null;
  return `${d}T${t || "99:99"}`;
}

function statusPriority(bucket: MatchStatusBucket): number {
  if (bucket === "IN_PROGRESS") return 0;
  if (bucket === "PLANNED") return 1;
  return 2;
}

// Priorytet działa w obrębie sekcji (kolejka/grupa), bez mieszania sekcji
function applySecondaryPriority<TMatch extends MatchLikeBase>(
  list: TMatch[],
  secondaryPriority: SecondaryPriority
): TMatch[] {
  if (secondaryPriority === "none") return list;

  const enriched = list.map((m, idx) => {
    const bucket = bucketForStatus(m.status);
    const scheduleKey = getScheduleKey(m);
    return { m, idx, bucket, scheduleKey };
  });

  enriched.sort((a, b) => {
    if (secondaryPriority === "status") {
      const ap = statusPriority(a.bucket);
      const bp = statusPriority(b.bucket);
      if (ap !== bp) return ap - bp;
      return a.idx - b.idx;
    }

    // secondaryPriority === "term"
    const ap = statusPriority(a.bucket);
    const bp = statusPriority(b.bucket);
    if (ap !== bp) return ap - bp;

    const ah = a.scheduleKey ? 0 : 1;
    const bh = b.scheduleKey ? 0 : 1;
    if (ah !== bh) return ah - bh;
    if (a.scheduleKey && b.scheduleKey && a.scheduleKey !== b.scheduleKey) {
      return a.scheduleKey.localeCompare(b.scheduleKey);
    }

    return a.idx - b.idx;
  });

  return enriched.map((x) => x.m);
}

function collapseKey(parts: Array<string | number | null | undefined>): string {
  return parts
    .map((p) => (p === null || p === undefined ? "na" : String(p)))
    .join(":");
}

function MatchesListOrGrid({
  mode,
  children,
  className,
}: {
  mode: ViewMode;
  children: ReactNode;
  className?: string;
}) {
  if (mode === "grid") {
    return (
      <div className={cn("grid gap-4", "sm:grid-cols-2 xl:grid-cols-3", className)}>
        {children}
      </div>
    );
  }

  return <div className={cn("space-y-4", className)}>{children}</div>;
}

function MatchesFilterPanel({
  totalMatchesCount,
  statusCounts,
  stages,
  roundOptions,
  groupOptions,
  value,
  onChange,
  showByeAvailable,
  showBye,
  onToggleShowBye,
  showLayoutSection,
  viewMode,
  onViewModeChange,
}: MatchesFilterPanelProps) {
  const roundsSorted = useMemo(() => sortOptionsStable(roundOptions ?? []), [roundOptions]);
  const groupsSorted = useMemo(() => sortOptionsStable(groupOptions ?? []), [groupOptions]);

  const chipBase = cn(
    "inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-200 transition",
    "hover:bg-white/[0.07]",
    "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/15"
  );
  const chipActive = "bg-white/[0.10] border-white/20";
  const chipDisabled = "opacity-50 cursor-not-allowed hover:bg-white/[0.04]";

  const statusAny = value.statuses.length > 0;
  const isStatusActive = (s: MatchStatusBucket) => value.statuses.includes(s);

  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const panelContentId = "matches-filter-panel-content";

  const clearAll = () => {
    onChange({
      stage: "ALL",
      query: "",
      statuses: [],
      rounds: [],
      groups: [],
      baseLayout: "rounds",
      secondaryPriority: "none",
      splitByStatus: false,
    });
  };

  const setValue = (next: MatchFiltersState) => {
    if (next.splitByStatus && next.secondaryPriority === "status") {
      next = { ...next, secondaryPriority: "none" };
    }
    onChange(next);
  };

  const viewChip = (mode: ViewMode, label: string, icon: ReactNode) => {
    const active = viewMode === mode;
    return (
      <button
        type="button"
        onClick={() => onViewModeChange(mode)}
        aria-pressed={active}
        title={label}
        className={cn(
          "inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs transition",
          "border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.07]",
          "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/15",
          active && "border-white/20 bg-white/[0.10]"
        )}
      >
        {icon}
        {label}
      </button>
    );
  };

  return (
    <Card className="relative overflow-hidden p-4 sm:p-5">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-20 left-1/2 h-44 w-[28rem] -translate-x-1/2 rounded-full bg-indigo-500/15 blur-3xl" />
        <div className="absolute -bottom-20 left-1/2 h-44 w-[28rem] -translate-x-1/2 rounded-full bg-sky-500/10 blur-3xl" />
      </div>

      <div className="relative">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
                <Filter className="h-4 w-4 text-slate-200" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-white">Filtry</div>
                <div className="text-xs text-slate-400">Łącznie: {totalMatchesCount} meczów</div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {viewChip("list", "Lista", <LayoutList className="h-4 w-4" />)}
            {viewChip("grid", "Siatka", <LayoutGrid className="h-4 w-4" />)}

            <button
              type="button"
              onClick={clearAll}
              className={cn(
                "inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-200 transition",
                "hover:bg-white/[0.07]",
                "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/15"
              )}
            >
              <Eraser className="h-4 w-4" />
              Wyczyść
            </button>

            <button
              type="button"
              onClick={() => setPanelCollapsed((v) => !v)}
              aria-expanded={!panelCollapsed}
              aria-controls={panelContentId}
              className={cn(
                "inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-200 transition",
                "hover:bg-white/[0.07]",
                "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/15"
              )}
            >
              {panelCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
              {panelCollapsed ? "Rozwiń" : "Zwiń"}
            </button>
          </div>
        </div>

        {!panelCollapsed ? (
          <div id={panelContentId} className="mt-4 space-y-5">
            <div>
              <div className="mb-2 text-xs font-semibold text-slate-300">Szukaj</div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />

                <Input
                  unstyled
                  type="search"
                  name="matches_query"
                  aria-label="Szukaj drużyny"
                  value={value.query}
                  onChange={(e) => setValue({ ...value, query: e.target.value })}
                  placeholder="Szukaj drużyny..."
                  className={cn(
                    "w-full rounded-2xl border border-white/10 bg-white/[0.04] px-10 py-2 text-sm text-slate-100 placeholder:text-slate-500",
                    "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/10 focus-visible:border-white/20"
                  )}
                />
              </div>
            </div>

            <div>
              <div className="mb-2 text-xs font-semibold text-slate-300">Status</div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  aria-pressed={!statusAny}
                  className={cn(chipBase, !statusAny && chipActive)}
                  onClick={() => setValue({ ...value, statuses: [] })}
                >
                  <span className="inline-flex h-2 w-2 rounded-full bg-white/60" />
                  Wszystkie ({statusCounts.PLANNED + statusCounts.IN_PROGRESS + statusCounts.FINISHED})
                  {!statusAny ? <Check className="h-4 w-4 text-white" /> : null}
                </button>

                <button
                  type="button"
                  aria-pressed={isStatusActive("IN_PROGRESS")}
                  className={cn(chipBase, isStatusActive("IN_PROGRESS") && chipActive)}
                  onClick={() =>
                    setValue({
                      ...value,
                      statuses: toggleInArray(value.statuses, "IN_PROGRESS"),
                    })
                  }
                >
                  <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400/80" />
                  W trakcie ({statusCounts.IN_PROGRESS})
                  {isStatusActive("IN_PROGRESS") ? <Check className="h-4 w-4 text-emerald-100" /> : null}
                </button>

                <button
                  type="button"
                  aria-pressed={isStatusActive("PLANNED")}
                  className={cn(chipBase, isStatusActive("PLANNED") && chipActive)}
                  onClick={() =>
                    setValue({
                      ...value,
                      statuses: toggleInArray(value.statuses, "PLANNED"),
                    })
                  }
                >
                  <span className="inline-flex h-2 w-2 rounded-full bg-sky-400/80" />
                  Zaplanowane ({statusCounts.PLANNED})
                  {isStatusActive("PLANNED") ? <Check className="h-4 w-4 text-sky-100" /> : null}
                </button>

                <button
                  type="button"
                  aria-pressed={isStatusActive("FINISHED")}
                  className={cn(chipBase, isStatusActive("FINISHED") && chipActive)}
                  onClick={() =>
                    setValue({
                      ...value,
                      statuses: toggleInArray(value.statuses, "FINISHED"),
                    })
                  }
                >
                  <span className="inline-flex h-2 w-2 rounded-full bg-amber-400/80" />
                  Zakończone ({statusCounts.FINISHED})
                  {isStatusActive("FINISHED") ? <Check className="h-4 w-4 text-amber-100" /> : null}
                </button>
              </div>
            </div>

            {stages.length ? (
              <div>
                <div className="mb-2 text-xs font-semibold text-slate-300">Etap</div>
                <div className="flex flex-wrap gap-2">
                  {stages.map((opt) => {
                    const active = value.stage === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        aria-pressed={active}
                        className={cn(chipBase, active && chipActive)}
                        onClick={() => setValue({ ...value, stage: opt.value })}
                      >
                        {opt.label}
                        {active ? <Check className="h-4 w-4 text-white" /> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {roundsSorted.length ? (
              <div>
                <div className="mb-2 text-xs font-semibold text-slate-300">Kolejki</div>
                <div className="flex flex-wrap gap-2">
                  {roundsSorted.map((opt) => {
                    const active = value.rounds.includes(opt.value);
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        aria-pressed={active}
                        className={cn(chipBase, active && chipActive)}
                        onClick={() =>
                          setValue({
                            ...value,
                            rounds: toggleInArray(value.rounds, opt.value),
                          })
                        }
                      >
                        {opt.label} ({opt.count})
                        {active ? <Check className="h-4 w-4 text-white" /> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {groupsSorted.length ? (
              <div>
                <div className="mb-2 text-xs font-semibold text-slate-300">Grupy</div>
                <div className="flex flex-wrap gap-2">
                  {groupsSorted.map((opt) => {
                    const active = value.groups.includes(opt.value);
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        aria-pressed={active}
                        className={cn(chipBase, active && chipActive)}
                        onClick={() =>
                          setValue({
                            ...value,
                            groups: toggleInArray(value.groups, opt.value),
                          })
                        }
                      >
                        {opt.label} ({opt.count})
                        {active ? <Check className="h-4 w-4 text-white" /> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {showByeAvailable ? (
              <div>
                <div className="mb-2 text-xs font-semibold text-slate-300">BYE</div>
                <button
                  type="button"
                  aria-pressed={showBye}
                  className={cn(chipBase, showBye && chipActive)}
                  onClick={() => onToggleShowBye(!showBye)}
                >
                  {showBye ? "Ukryj BYE" : "Pokaż BYE"}
                  {showBye ? <Check className="h-4 w-4 text-white" /> : null}
                </button>
              </div>
            ) : null}

            {showLayoutSection ? (
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <div className="mb-2 text-xs font-semibold text-slate-300">Układ</div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      aria-pressed={value.baseLayout === "rounds"}
                      className={cn(chipBase, value.baseLayout === "rounds" && chipActive)}
                      onClick={() => setValue({ ...value, baseLayout: "rounds" })}
                    >
                      Kolejkami
                      {value.baseLayout === "rounds" ? <Check className="h-4 w-4 text-white" /> : null}
                    </button>
                    <button
                      type="button"
                      aria-pressed={value.baseLayout === "groups"}
                      className={cn(chipBase, value.baseLayout === "groups" && chipActive)}
                      onClick={() => setValue({ ...value, baseLayout: "groups" })}
                    >
                      Grupami
                      {value.baseLayout === "groups" ? <Check className="h-4 w-4 text-white" /> : null}
                    </button>
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-xs font-semibold text-slate-300">Priorytet</div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      aria-pressed={value.secondaryPriority === "none"}
                      className={cn(chipBase, value.secondaryPriority === "none" && chipActive)}
                      onClick={() => setValue({ ...value, secondaryPriority: "none" })}
                    >
                      Brak
                      {value.secondaryPriority === "none" ? <Check className="h-4 w-4 text-white" /> : null}
                    </button>
                    <button
                      type="button"
                      aria-pressed={value.secondaryPriority === "status"}
                      aria-disabled={value.splitByStatus}
                      className={cn(
                        chipBase,
                        value.secondaryPriority === "status" && chipActive,
                        value.splitByStatus && chipDisabled
                      )}
                      onClick={() => {
                        if (value.splitByStatus) return;
                        setValue({ ...value, secondaryPriority: "status" });
                      }}
                      disabled={value.splitByStatus}
                    >
                      Status
                      {value.secondaryPriority === "status" ? <Check className="h-4 w-4 text-white" /> : null}
                    </button>
                    <button
                      type="button"
                      aria-pressed={value.secondaryPriority === "term"}
                      className={cn(chipBase, value.secondaryPriority === "term" && chipActive)}
                      onClick={() => setValue({ ...value, secondaryPriority: "term" })}
                    >
                      Termin
                      {value.secondaryPriority === "term" ? <Check className="h-4 w-4 text-white" /> : null}
                    </button>
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-xs font-semibold text-slate-300">Podział</div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      aria-pressed={!value.splitByStatus}
                      className={cn(chipBase, !value.splitByStatus && chipActive)}
                      onClick={() => setValue({ ...value, splitByStatus: false })}
                    >
                      Brak
                      {!value.splitByStatus ? <Check className="h-4 w-4 text-white" /> : null}
                    </button>
                    <button
                      type="button"
                      aria-pressed={value.splitByStatus}
                      className={cn(chipBase, value.splitByStatus && chipActive)}
                      onClick={() => setValue({ ...value, splitByStatus: !value.splitByStatus })}
                    >
                      Statusy
                      {value.splitByStatus ? <Check className="h-4 w-4 text-white" /> : null}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function StatusHeaderCard<TMatch extends MatchLikeBase>({
  bucket,
  stages,
  collapsed,
  onToggleCollapsed,
}: {
  bucket: MatchStatusBucket;
  stages: StageView<TMatch>[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const styles = sectionCardClasses(bucket);

  const matchCount = useMemo(() => stages.reduce((sum, s) => sum + s.matches.length, 0), [stages]);

  const title =
    bucket === "IN_PROGRESS" ? "W trakcie" : bucket === "FINISHED" ? "Zakończone" : "Zaplanowane";

  return (
    <Card className={cn("p-4 sm:p-5 border", styles.shell)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className={cn("flex items-center gap-2 text-sm font-semibold", styles.title)}>
            <span className={cn("inline-flex h-2 w-2 rounded-full", styles.dot)} />
            {title}
          </div>
          <div className="mt-1 text-xs text-slate-300">
            Mecze: {matchCount} - Sekcje: {stages.length}
          </div>
        </div>

        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          className={cn(
            "inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-200 transition",
            "hover:bg-white/[0.07]",
            "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/15"
          )}
        >
          {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          {collapsed ? "Rozwiń wszystko" : "Zwiń wszystko"}
        </button>
      </div>
    </Card>
  );
}

export function TournamentMatchesScaffold<TMatch extends MatchLikeBase>({
  tournamentId,
  tournamentFormat,
  title,
  description,
  loading,
  matches,
  headerSlot,
  storageKeyPrefix,
  storageScope,
  renderMatch,
  renderByeMatch,
  stageTitle,
}: TournamentMatchesScaffoldProps<TMatch>) {
  const fmt = useMemo(() => String(tournamentFormat ?? "").toUpperCase(), [tournamentFormat]);

  const isLeagueTournament = fmt === "LEAGUE";
  const isMixedTournament = fmt === "MIXED";

  const storageBase = useMemo(() => {
    const prefix = storageKeyPrefix || "turniejepro.matches";
    return `${prefix}.${storageScope}.${tournamentId}`;
  }, [storageKeyPrefix, storageScope, tournamentId]);

  const filtersKey = `${storageBase}.filters.v1`;
  // Klucz UI jest wersjonowany, aby nie mieszać formatów w localStorage.
  const uiKey = `${storageBase}.ui.v2`;

  const defaultFilters: MatchFiltersState = useMemo(
    () => ({
      stage: "ALL",
      query: "",
      statuses: [],
      rounds: [],
      groups: [],
      baseLayout: "rounds",
      secondaryPriority: "none",
      splitByStatus: false,
    }),
    []
  );

  const [filters, setFilters] = useState<MatchFiltersState>(() => {
    const parsed = safeReadJson<Partial<MatchFiltersState>>(filtersKey, {});

    const stageRaw = String((parsed as any).stage ?? "ALL");
    const stage: StageFilterMode =
      stageRaw === "GROUP" || stageRaw === "KNOCKOUT" || stageRaw === "ALL" ? stageRaw : "ALL";

    const baseLayout: BaseLayoutMode = parsed.baseLayout === "groups" ? "groups" : "rounds";

    const secRaw = String((parsed as any).secondaryPriority ?? "none");
    const secondaryPriority: SecondaryPriority = secRaw === "status" || secRaw === "term" ? secRaw : "none";

    const next: MatchFiltersState = {
      stage,
      query: typeof parsed.query === "string" ? parsed.query : "",
      statuses: Array.isArray(parsed.statuses)
        ? (parsed.statuses.filter(
            (x) => x === "PLANNED" || x === "IN_PROGRESS" || x === "FINISHED"
          ) as MatchStatusBucket[])
        : [],
      rounds: Array.isArray(parsed.rounds) ? parsed.rounds.filter((x) => typeof x === "string") : [],
      groups: Array.isArray(parsed.groups) ? parsed.groups.filter((x) => typeof x === "string") : [],
      baseLayout,
      secondaryPriority,
      splitByStatus: Boolean(parsed.splitByStatus),
    };

    if (next.splitByStatus && next.secondaryPriority === "status") return { ...next, secondaryPriority: "none" };
    return next;
  });

  const [ui, setUi] = useState(() => {
    const parsed = safeReadJson<{
      showBye?: boolean;
      collapsed?: Record<string, boolean>;
      statusCollapsed?: Record<MatchStatusBucket, boolean>;
      viewMode?: ViewMode;
    }>(uiKey, {});

    const viewMode: ViewMode =
      parsed.viewMode === "list" || parsed.viewMode === "grid" ? parsed.viewMode : "grid";

    return {
      showBye: Boolean(parsed.showBye),
      viewMode,
      collapsed:
        parsed.collapsed && typeof parsed.collapsed === "object"
          ? parsed.collapsed
          : ({} as Record<string, boolean>),
      statusCollapsed:
        parsed.statusCollapsed && typeof parsed.statusCollapsed === "object"
          ? ({
              IN_PROGRESS: Boolean(parsed.statusCollapsed.IN_PROGRESS),
              PLANNED: Boolean(parsed.statusCollapsed.PLANNED),
              FINISHED: Boolean(parsed.statusCollapsed.FINISHED),
            } as Record<MatchStatusBucket, boolean>)
          : ({ IN_PROGRESS: false, PLANNED: false, FINISHED: false } as Record<MatchStatusBucket, boolean>),
    };
  });

  useEffect(() => {
    safeWriteJson(filtersKey, filters);
  }, [filters, filtersKey]);

  useEffect(() => {
    safeWriteJson(uiKey, ui);
  }, [ui, uiKey]);

  useEffect(() => {
    if (!isMixedTournament && filters.stage !== "ALL") {
      setFilters((prev) => ({ ...prev, stage: "ALL" }));
    }
  }, [filters.stage, isMixedTournament]);

  useEffect(() => {
    if (filters.splitByStatus && filters.secondaryPriority === "status") {
      setFilters((prev) => ({ ...prev, secondaryPriority: "none" }));
    }
  }, [filters.secondaryPriority, filters.splitByStatus]);

  const matchesLike = useMemo(() => (Array.isArray(matches) ? matches : ([] as TMatch[])), [matches]);

  const allStages = useMemo(() => buildStagesForView(matchesLike), [matchesLike]);
  const regularStages = useMemo(
    () => buildStagesForView(matchesLike.filter((m) => !isByeMatch(m))),
    [matchesLike]
  );

  const byeMatchesAll = useMemo(() => matchesLike.filter((m) => isByeMatch(m)), [matchesLike]);

  const showByeAvailable = useMemo(() => {
    if (isLeagueTournament) return false;
    return byeMatchesAll.length > 0;
  }, [byeMatchesAll.length, isLeagueTournament]);

  useEffect(() => {
    if (!showByeAvailable && ui.showBye) {
      setUi((prev) => ({ ...prev, showBye: false }));
    }
  }, [showByeAvailable, ui.showBye]);

  const stageFilterOptions = useMemo(() => {
    if (!isMixedTournament) return [];
    return [
      { value: "ALL" as const, label: "Wszystkie" },
      { value: "GROUP" as const, label: "Grupy" },
      { value: "KNOCKOUT" as const, label: "Puchar" },
    ];
  }, [isMixedTournament]);

  const statusCounts = useMemo(() => {
    const base: Record<MatchStatusBucket, number> = { PLANNED: 0, IN_PROGRESS: 0, FINISHED: 0 };
    for (const m of matchesLike) base[bucketForStatus(m.status)] += 1;
    return base;
  }, [matchesLike]);

  const stageTitleFn = useMemo(() => stageTitle ?? defaultStageHeaderTitle, [stageTitle]);

  const groupLabelByStage = useMemo(() => {
    const outer = new Map<number, Map<string, string>>();

    for (const s of allStages) {
      if (s.stageType !== "GROUP") continue;

      const grouped = groupMatchesByGroup(s.allMatches);
      const inner = new Map<string, string>();

      grouped.forEach(([rawName], idx) => {
        const key = String(rawName ?? "").trim() || "-";
        inner.set(key, displayGroupNameByIndex(idx));
      });

      outer.set(s.stageId, inner);
    }

    return outer;
  }, [allStages]);

  const groupOptions = useMemo(() => {
    const out: FilterOption[] = [];

    for (const s of allStages) {
      if (s.stageType !== "GROUP") continue;

      const grouped = groupMatchesByGroup(s.allMatches);
      grouped.forEach(([rawName, ms], idx) => {
        const groupKey = String(rawName ?? "").trim() || "-";
        const label = groupLabelByStage.get(s.stageId)?.get(groupKey) ?? displayGroupNameByIndex(idx);
        out.push({ value: `${s.stageId}:${groupKey}`, label, count: ms.length });
      });
    }

    const merged = new Map<string, { label: string; count: number }>();
    for (const o of out) {
      const prev = merged.get(o.value);
      merged.set(o.value, { label: o.label, count: (prev?.count ?? 0) + o.count });
    }

    return Array.from(merged.entries()).map(([value, v]) => ({
      value,
      label: v.label,
      count: v.count,
    }));
  }, [allStages, groupLabelByStage]);

  const roundOptions = useMemo(() => {
    const out: FilterOption[] = [];

    for (const s of allStages) {
      const header = stageTitleFn(s.stageType, s.allMatches);

      if (s.stageType === "LEAGUE") {
        groupMatchesByRound(s.allMatches).forEach(([r, ms]) => {
          out.push({
            value: `round:${s.stageId}:${r}`,
            label: `Kolejka ${r}`,
            count: ms.length,
            stage: header,
          });
        });
      } else if (s.stageType === "GROUP") {
        const c = new Map<number | null, number>();
        s.allMatches.forEach((m) => c.set(m.round_number ?? 0, (c.get(m.round_number ?? 0) || 0) + 1));
        c.forEach((cnt, r) => {
          const rr = r ?? 0;
          out.push({
            value: `round:${s.stageId}:${rr}`,
            label: `Kolejka ${rr}`,
            count: cnt,
            stage: header,
          });
        });
      } else if (s.stageType === "KNOCKOUT" || s.stageType === "THIRD_PLACE") {
        out.push({ value: `stage:${s.stageId}`, label: header, count: s.allMatches.length, stage: "Puchar" });
      }
    }

    return out;
  }, [allStages, stageTitleFn]);

  const filteredStagesBase = useMemo(() => {
    const stageFiltered = regularStages.filter((s) => {
      if (filters.stage === "ALL") return true;
      if (filters.stage === "GROUP") return s.stageType === "GROUP";
      return s.stageType === "KNOCKOUT" || s.stageType === "THIRD_PLACE";
    });

    return stageFiltered
      .map((s) => {
        const inner = s.matches.filter((m) => {
          if (filters.statuses.length && !filters.statuses.includes(bucketForStatus(m.status))) return false;

          if (filters.rounds.length) {
            if (s.stageType === "KNOCKOUT" || s.stageType === "THIRD_PLACE") {
              if (!filters.rounds.includes(`stage:${s.stageId}`)) return false;
            } else {
              const r = String(m.round_number ?? 0);
              if (!filters.rounds.includes(`round:${s.stageId}:${r}`)) return false;
            }
          }

          if (filters.groups.length) {
            if (s.stageType !== "GROUP") return false;
            const groupKey = String(m.group_name ?? "").trim() || "-";
            const valueKey = `${s.stageId}:${groupKey}`;
            if (!filters.groups.includes(valueKey)) return false;
          }

          if (filters.query) {
            const q = normalizePL(filters.query);
            if (!normalizePL(m.home_team_name).includes(q) && !normalizePL(m.away_team_name).includes(q)) return false;
          }

          return true;
        });

        return { ...s, matches: inner };
      })
      .filter((s) => s.matches.length > 0);
  }, [filters.groups, filters.query, filters.rounds, filters.stage, filters.statuses, regularStages]);

  const filteredByeMatches = useMemo(() => {
    if (!showByeAvailable || !ui.showBye) return [];

    return byeMatchesAll.filter((m) => {
      if (filters.statuses.length && !filters.statuses.includes(bucketForStatus(m.status))) return false;
      if (filters.query) {
        const q = normalizePL(filters.query);
        if (!normalizePL(m.home_team_name).includes(q) && !normalizePL(m.away_team_name).includes(q)) return false;
      }
      return true;
    });
  }, [byeMatchesAll, filters.query, filters.statuses, showByeAvailable, ui.showBye]);

  const filteredStagesByStatus = useMemo(() => {
    if (!filters.splitByStatus) return null;

    return {
      IN_PROGRESS: filteredStagesBase
        .map((s) => ({
          ...s,
          matches: s.matches.filter((m) => bucketForStatus(m.status) === "IN_PROGRESS"),
        }))
        .filter((s) => s.matches.length),
      PLANNED: filteredStagesBase
        .map((s) => ({
          ...s,
          matches: s.matches.filter((m) => bucketForStatus(m.status) === "PLANNED"),
        }))
        .filter((s) => s.matches.length),
      FINISHED: filteredStagesBase
        .map((s) => ({
          ...s,
          matches: s.matches.filter((m) => bucketForStatus(m.status) === "FINISHED"),
        }))
        .filter((s) => s.matches.length),
    } as Record<MatchStatusBucket, StageView<TMatch>[]>;
  }, [filteredStagesBase, filters.splitByStatus]);

  const blocks: Array<{ key: string; bucket: MatchStatusBucket | null; list: StageView<TMatch>[] }> = useMemo(() => {
    if (filters.splitByStatus && filteredStagesByStatus) {
      return (["IN_PROGRESS", "PLANNED", "FINISHED"] as MatchStatusBucket[]).map((bucket) => ({
        key: bucket,
        bucket,
        list: filteredStagesByStatus[bucket] ?? [],
      }));
    }
    return [{ key: "ALL", bucket: null, list: filteredStagesBase }];
  }, [filteredStagesBase, filteredStagesByStatus, filters.splitByStatus]);

  const toggleCollapsed = (k: string) =>
    setUi((p) => ({ ...p, collapsed: { ...p.collapsed, [k]: !p.collapsed[k] } }));

  const collapseBtn = (key: string, labelOpen: string, labelClosed: string) => (
    <button
      type="button"
      onClick={() => toggleCollapsed(key)}
      aria-expanded={!ui.collapsed[key]}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-200 transition",
        "hover:bg-white/[0.07]",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/15"
      )}
    >
      {ui.collapsed[key] ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
      {ui.collapsed[key] ? labelClosed : labelOpen}
    </button>
  );

  const toggleStatusCollapsed = (bucket: MatchStatusBucket) =>
    setUi((p) => ({ ...p, statusCollapsed: { ...p.statusCollapsed, [bucket]: !p.statusCollapsed[bucket] } }));

  const renderByeDefault = (m: TMatch) => {
    const bucket = bucketForStatus(m.status);
    const styles = sectionCardClasses(bucket);

    return (
      <Card key={m.id} className={cn("p-4 sm:p-5 border", styles.shell)}>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-slate-100">
            <span className="font-semibold">{m.home_team_name}</span>
            <span className="mx-2 text-slate-500">vs</span>
            <span className="font-semibold">{m.away_team_name}</span>
            <span className="ml-2 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-xs text-slate-200">
              BYE
            </span>
          </div>
          <div className="text-xs text-slate-400">Mecz techniczny</div>
        </div>
      </Card>
    );
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6">
        <Card className="p-6 text-slate-200">Ładowanie...</Card>
      </div>
    );
  }

  if (!matchesLike.length) {
    return (
      <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
          {description ? <p className="mt-1 text-sm text-slate-400">{description}</p> : null}
        </div>

        {headerSlot}

        <Card className="p-6">
          <div className="text-sm text-slate-200">Brak meczów.</div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
        {description ? <p className="mt-1 text-sm text-slate-400">{description}</p> : null}
      </div>

      {headerSlot}

      <div className="mt-6 grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="xl:sticky xl:top-[calc(var(--app-navbar-h,84px)+12px)] xl:self-start">
          <MatchesFilterPanel
            totalMatchesCount={matchesLike.length}
            statusCounts={statusCounts}
            stages={stageFilterOptions}
            roundOptions={roundOptions}
            groupOptions={groupOptions}
            value={filters}
            onChange={setFilters}
            showByeAvailable={showByeAvailable}
            showBye={ui.showBye}
            onToggleShowBye={(next) => setUi((p) => ({ ...p, showBye: next }))}
            showLayoutSection={isMixedTournament}
            viewMode={ui.viewMode}
            onViewModeChange={(next) => setUi((p) => ({ ...p, viewMode: next }))}
          />
        </div>

        <div className="min-w-0">
          <div className="space-y-10">
            {showByeAvailable && ui.showBye && filteredByeMatches.length > 0 ? (
              <section className="space-y-4">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-white/60" />
                  <div className="text-base font-semibold text-white">Mecze techniczne (BYE)</div>
                </div>

                <MatchesListOrGrid mode={ui.viewMode}>
                  {filteredByeMatches.map((m) => {
                    const bucket = bucketForStatus(m.status);
                    return renderByeMatch ? renderByeMatch(m, bucket) : renderByeDefault(m);
                  })}
                </MatchesListOrGrid>
              </section>
            ) : null}

            {blocks.map((block) => {
              if (!block.list.length) return null;

              const bucket = block.bucket;
              const isAllCollapsed = bucket ? ui.statusCollapsed[bucket] : false;

              return (
                <section key={block.key} className="space-y-6">
                  {bucket ? (
                    <StatusHeaderCard
                      bucket={bucket}
                      stages={block.list}
                      collapsed={Boolean(ui.statusCollapsed[bucket])}
                      onToggleCollapsed={() => toggleStatusCollapsed(bucket)}
                    />
                  ) : null}

                  {isAllCollapsed ? null : (
                    <>
                      {block.list.map((s) => {
                        const stageHeader = stageTitleFn(s.stageType, s.allMatches);
                        const collapseKeyBase = ["stage", s.stageId];

                        return (
                          <div key={s.stageId} className="space-y-4">
                            <div className="flex items-center justify-between">
                              <div className="text-base font-semibold text-white">{stageHeader}</div>
                            </div>

                            {s.stageType === "GROUP" ? (
                              filters.baseLayout === "groups" ? (
                                groupMatchesByGroup(s.matches).map(([rawGroup, gMatches], idx) => {
                                  const groupKey = String(rawGroup ?? "").trim() || "-";
                                  const groupLabel =
                                    groupLabelByStage.get(s.stageId)?.get(groupKey) ??
                                    displayGroupNameByIndex(idx);
                                  const gKey = collapseKey([...collapseKeyBase, "g", groupKey]);

                                  return (
                                    <div key={groupKey} className="space-y-3">
                                      <div className="flex items-center justify-between">
                                        <div className="text-base text-white">{groupLabel}</div>
                                        {collapseBtn(gKey, `Zwiń ${groupLabel}`, `Rozwiń ${groupLabel}`)}
                                      </div>

                                      {!ui.collapsed[gKey] ? (
                                        <div className="space-y-6">
                                          {groupMatchesByRound(gMatches).map(([r, rm]) => (
                                            <div key={r} className="space-y-3">
                                              <div className="text-base text-white">Kolejka {r}</div>

                                              <MatchesListOrGrid mode={ui.viewMode}>
                                                {applySecondaryPriority(rm, filters.secondaryPriority).map((m) => (
                                                  <div key={m.id}>{renderMatch(m)}</div>
                                                ))}
                                              </MatchesListOrGrid>
                                            </div>
                                          ))}
                                        </div>
                                      ) : null}
                                    </div>
                                  );
                                })
                              ) : (
                                <div className="space-y-8">
                                  {groupMatchesByRound(s.matches).map(([r, rm]) => {
                                    const rKey = collapseKey([...collapseKeyBase, "r", r]);
                                    const groupedInRound = groupMatchesByGroup(rm);

                                    return (
                                      <div key={r} className="space-y-3">
                                        <div className="flex items-center justify-between">
                                          <div className="text-base text-white">Kolejka {r}</div>
                                          {collapseBtn(rKey, `Zwiń kolejkę ${r}`, `Rozwiń kolejkę ${r}`)}
                                        </div>

                                        {!ui.collapsed[rKey] ? (
                                          <div className="space-y-6">
                                            {groupedInRound.map(([rawGroup, gm], idx) => {
                                              const groupKey = String(rawGroup ?? "").trim() || "-";
                                              const groupLabel =
                                                groupLabelByStage.get(s.stageId)?.get(groupKey) ??
                                                displayGroupNameByIndex(idx);

                                              return (
                                                <div key={groupKey} className="space-y-2">
                                                  <div className="text-xs font-semibold text-slate-400">{groupLabel}</div>

                                                  <MatchesListOrGrid mode={ui.viewMode}>
                                                    {applySecondaryPriority(gm, filters.secondaryPriority).map((m) => (
                                                      <div key={m.id}>{renderMatch(m)}</div>
                                                    ))}
                                                  </MatchesListOrGrid>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        ) : null}
                                      </div>
                                    );
                                  })}
                                </div>
                              )
                            ) : s.stageType === "LEAGUE" ? (
                              <div className="space-y-6">
                                {groupMatchesByRound(s.matches).map(([r, rm]) => {
                                  const rKey = collapseKey([...collapseKeyBase, "r", r]);
                                  return (
                                    <div key={r} className="space-y-3">
                                      <div className="flex items-center justify-between">
                                        <div className="text-base text-white">Kolejka {r}</div>
                                        {collapseBtn(rKey, `Zwiń kolejkę ${r}`, `Rozwiń kolejkę ${r}`)}
                                      </div>

                                      {!ui.collapsed[rKey] ? (
                                        <MatchesListOrGrid mode={ui.viewMode}>
                                          {applySecondaryPriority(rm, filters.secondaryPriority).map((m) => (
                                            <div key={m.id}>{renderMatch(m)}</div>
                                          ))}
                                        </MatchesListOrGrid>
                                      ) : null}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <MatchesListOrGrid mode={ui.viewMode}>
                                {applySecondaryPriority(s.matches, filters.secondaryPriority).map((m) => (
                                  <div key={m.id}>{renderMatch(m)}</div>
                                ))}
                              </MatchesListOrGrid>
                            )}
                          </div>
                        );
                      })}
                    </>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}