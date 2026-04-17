// frontend/src/pages/_shared/TournamentMassStartScheduleScaffold.tsx
// Komponent udostępnia wspólny szkielet widoku harmonogramu etapów i grup dla trybu wszyscy razem.
// Wizualnie i strukturalnie maksymalnie zbliżony do TournamentMatchesScaffold.
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

import {
  Check,
  ChevronDown,
  ChevronUp,
  Eraser,
  Filter,
  Search,
} from "lucide-react";

import { cn } from "../../lib/cn";

import { Card } from "../../ui/Card";
import { Input } from "../../ui/Input";

export type MassStartViewMode = "list" | "grid";

export type MassStartStageLike = {
  stage_id: number;
  stage_order: number;
  stage_name: string;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  location?: string | null;
};

export type MassStartGroupLike = {
  group_id: number;
  group_name: string;
  stage_id: number;
  stage_order: number;
  stage_name: string;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  location?: string | null;
};

export type MassStartFiltersState = {
  query: string;
  stageIds: number[];
  groupKeys: string[];
};

type StageFilterOption = {
  value: number;
  label: string;
};

type GroupFilterOption = {
  value: string;
  label: string;
  stageId: number;
};

export type TournamentMassStartScheduleScaffoldProps<
  TStage extends MassStartStageLike,
  TGroup extends MassStartGroupLike,
> = {
  tournamentId: string;
  title: string;
  description?: string;
  loading?: boolean;
  headerSlot?: ReactNode;
  storageScope: string;
  storageKeyPrefix?: string;
  stages: TStage[];
  groups: TGroup[];
  renderStageBlock: (
    stage: TStage,
    groupsForStage: TGroup[],
    viewMode: MassStartViewMode,
    groupsCollapsed: boolean,
    onToggleGroupsCollapsed: () => void
  ) => ReactNode;
  emptyStateText?: string;
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

function normalizePL(s: string) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sortStages<TStage extends MassStartStageLike>(stages: TStage[]): TStage[] {
  return [...stages].sort((a, b) => {
    if (a.stage_order !== b.stage_order) return a.stage_order - b.stage_order;
    return a.stage_id - b.stage_id;
  });
}

function sortGroups<TGroup extends MassStartGroupLike>(groups: TGroup[]): TGroup[] {
  return [...groups].sort((a, b) => {
    if (a.stage_order !== b.stage_order) return a.stage_order - b.stage_order;
    return a.group_id - b.group_id;
  });
}

function getStageLabel(stageOrder: number) {
  return `Etap ${stageOrder}`;
}

function getStageHeading(stageName: string) {
  return stageName.trim() || "Etap";
}

type MassStartFilterPanelProps = {
  totalStageCount: number;
  totalGroupCount: number;
  stageOptions: StageFilterOption[];
  groupOptions: GroupFilterOption[];
  filters: MassStartFiltersState;
  onFiltersChange: (next: MassStartFiltersState) => void;
  panelCollapsed: boolean;
  onTogglePanelCollapsed: () => void;
  onClearAll: () => void;
};

function MassStartFilterPanel({
  totalStageCount,
  totalGroupCount,
  stageOptions,
  groupOptions,
  filters,
  onFiltersChange,
  panelCollapsed,
  onTogglePanelCollapsed,
  onClearAll,
}: MassStartFilterPanelProps) {
  const chipBase = cn(
    "inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-200 transition",
    "hover:bg-white/[0.07]",
    "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/15"
  );
  const chipActive = "bg-white/[0.10] border-white/20";

  const toggleStage = (stageId: number) => {
    const nextStageIds = filters.stageIds.includes(stageId)
      ? filters.stageIds.filter((value) => value !== stageId)
      : [...filters.stageIds, stageId];

    onFiltersChange({ ...filters, stageIds: nextStageIds });
  };

  const toggleGroup = (groupKey: string) => {
    const nextGroupKeys = filters.groupKeys.includes(groupKey)
      ? filters.groupKeys.filter((value) => value !== groupKey)
      : [...filters.groupKeys, groupKey];

    onFiltersChange({ ...filters, groupKeys: nextGroupKeys });
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
                <div className="text-xs text-slate-400">
                  Łącznie: {totalStageCount} etapów, {totalGroupCount} grup
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">

            <button
              type="button"
              onClick={onClearAll}
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
              onClick={onTogglePanelCollapsed}
              aria-expanded={!panelCollapsed}
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
          <div className="mt-4 space-y-5">
            <div>
              <div className="mb-2 text-xs font-semibold text-slate-300">Szukaj</div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  unstyled
                  type="search"
                  aria-label="Szukaj etapu lub grupy"
                  value={filters.query}
                  onChange={(e) => onFiltersChange({ ...filters, query: e.target.value })}
                  placeholder="Szukaj etapu lub grupy..."
                  className={cn(
                    "w-full rounded-2xl border border-white/10 bg-white/[0.04] px-10 py-2 text-sm text-slate-100 placeholder:text-slate-500",
                    "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/10 focus-visible:border-white/20"
                  )}
                />
              </div>
            </div>

            {stageOptions.length ? (
              <div>
                <div className="mb-2 text-xs font-semibold text-slate-300">Etapy</div>
                <div className="flex flex-wrap gap-2">
                  {stageOptions.map((option) => {
                    const active = filters.stageIds.includes(option.value);
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={active}
                        className={cn(chipBase, active && chipActive)}
                        onClick={() => toggleStage(option.value)}
                      >
                        {option.label}
                        {active ? <Check className="h-4 w-4 text-white" /> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {groupOptions.length ? (
              <div>
                <div className="mb-2 text-xs font-semibold text-slate-300">Grupy</div>
                <div className="flex flex-wrap gap-2">
                  {groupOptions.map((option) => {
                    const active = filters.groupKeys.includes(option.value);
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={active}
                        className={cn(chipBase, active && chipActive)}
                        onClick={() => toggleGroup(option.value)}
                      >
                        {option.label}
                        {active ? <Check className="h-4 w-4 text-white" /> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

export function TournamentMassStartScheduleScaffold<
  TStage extends MassStartStageLike,
  TGroup extends MassStartGroupLike,
>({
  tournamentId,
  title,
  description,
  loading,
  headerSlot,
  storageScope,
  storageKeyPrefix,
  stages,
  groups,
  renderStageBlock,
  emptyStateText = "Brak etapów lub grup pasujących do aktywnych filtrów.",
}: TournamentMassStartScheduleScaffoldProps<TStage, TGroup>) {
  const storageBase = useMemo(() => {
    const prefix = storageKeyPrefix || "turniejepro.massStartSchedule";
    return `${prefix}.${storageScope}.${tournamentId}`;
  }, [storageKeyPrefix, storageScope, tournamentId]);

  const filtersKey = `${storageBase}.filters.v3`;
  const uiKey = `${storageBase}.ui.v4`;

  const orderedStages = useMemo(() => sortStages(stages), [stages]);

  const groupsByStage = useMemo(() => {
    return groups.reduce<Record<number, TGroup[]>>((acc, group) => {
      if (!acc[group.stage_id]) acc[group.stage_id] = [];
      acc[group.stage_id].push(group);
      return acc;
    }, {});
  }, [groups]);

  const normalizedGroupsByStage = useMemo(() => {
    return orderedStages.reduce<Record<number, TGroup[]>>((acc, stage) => {
      acc[stage.stage_id] = sortGroups(groupsByStage[stage.stage_id] ?? []);
      return acc;
    }, {});
  }, [groupsByStage, orderedStages]);

  const stageOptions = useMemo<StageFilterOption[]>(() => {
    return orderedStages.map((stage) => ({
      value: stage.stage_id,
      label: stage.stage_name?.trim() || getStageLabel(stage.stage_order),
    }));
  }, [orderedStages]);

  const groupOptions = useMemo<GroupFilterOption[]>(() => {
    return orderedStages.flatMap((stage) => {
      const stageName = stage.stage_name?.trim() || getStageLabel(stage.stage_order);
      const stageGroups = normalizedGroupsByStage[stage.stage_id] ?? [];
      return stageGroups.map((group, index) => ({
        value: `${stage.stage_id}:${group.group_id}`,
        label: `${stageName} - ${group.group_name?.trim() || `Grupa ${index + 1}`}`,
        stageId: stage.stage_id,
      }));
    });
  }, [normalizedGroupsByStage, orderedStages]);

  const [filters, setFilters] = useState<MassStartFiltersState>(() => {
    const parsed = safeReadJson<Partial<MassStartFiltersState>>(filtersKey, {});
    return {
      query: typeof parsed.query === "string" ? parsed.query : "",
      stageIds: Array.isArray(parsed.stageIds)
        ? parsed.stageIds.filter((value) => Number.isFinite(value))
        : [],
      groupKeys: Array.isArray(parsed.groupKeys)
        ? parsed.groupKeys.filter((value) => typeof value === "string")
        : [],
    };
  });

  const [ui, setUi] = useState<{
    panelCollapsed: boolean;
    stageCollapsed: Record<number, boolean>;
    groupsCollapsed: Record<number, boolean>;
  }>(() => {
    const parsed = safeReadJson<{
      panelCollapsed?: boolean;
      stageCollapsed?: Record<number, boolean>;
      groupsCollapsed?: Record<number, boolean>;
    }>(uiKey, {});

    return {
      panelCollapsed: Boolean(parsed.panelCollapsed),
      stageCollapsed:
        parsed.stageCollapsed && typeof parsed.stageCollapsed === "object"
          ? parsed.stageCollapsed
          : {},
      groupsCollapsed:
        parsed.groupsCollapsed && typeof parsed.groupsCollapsed === "object"
          ? parsed.groupsCollapsed
          : {},
    };
  });

  useEffect(() => {
    safeWriteJson(filtersKey, filters);
  }, [filters, filtersKey]);

  useEffect(() => {
    safeWriteJson(uiKey, ui);
  }, [ui, uiKey]);

  const totalStageCount = orderedStages.length;
  const totalGroupCount = groups.length;

  const filteredStageBlocks = useMemo(() => {
    const query = normalizePL(filters.query);
    const selectedStageIds = new Set(filters.stageIds);
    const selectedGroupKeys = new Set(filters.groupKeys);

    return orderedStages
      .map((stage) => {
        const stageName = stage.stage_name?.trim() || getStageLabel(stage.stage_order);
        const stageGroups = normalizedGroupsByStage[stage.stage_id] ?? [];

        const baseGroups = stageGroups.filter((group) => {
          if (!selectedGroupKeys.size) return true;
          return selectedGroupKeys.has(`${stage.stage_id}:${group.group_id}`);
        });

        const stageMatchesQuery =
          !query ||
          normalizePL(stageName).includes(query) ||
          normalizePL(stage.location ?? "").includes(query);

        const groupsMatchingQuery = baseGroups.filter((group) => {
          if (!query) return true;
          return (
            normalizePL(group.group_name ?? "").includes(query) ||
            normalizePL(group.stage_name ?? "").includes(query) ||
            normalizePL(group.location ?? "").includes(query)
          );
        });

        const stageSelected = !selectedStageIds.size || selectedStageIds.has(stage.stage_id);
        if (!stageSelected) return null;

        const visibleGroups = query
          ? stageMatchesQuery
            ? baseGroups
            : groupsMatchingQuery
          : baseGroups;

        const shouldRenderStage =
          stageMatchesQuery ||
          visibleGroups.length > 0 ||
          (!query && !selectedGroupKeys.size);

        if (!shouldRenderStage) return null;

        return {
          stage,
          stageName,
          stageHeading: getStageHeading(stageName),
          groups: visibleGroups,
        };
      })
      .filter(Boolean) as Array<{
        stage: TStage;
        stageName: string;
        stageHeading: string;
        groups: TGroup[];
      }>;
  }, [filters.groupKeys, filters.query, filters.stageIds, normalizedGroupsByStage, orderedStages]);

  const toggleStageCollapsed = (stageId: number) => {
    setUi((prev) => ({
      ...prev,
      stageCollapsed: {
        ...prev.stageCollapsed,
        [stageId]: !prev.stageCollapsed[stageId],
      },
    }));
  };

  const toggleGroupsCollapsed = (stageId: number) => {
    setUi((prev) => ({
      ...prev,
      groupsCollapsed: {
        ...prev.groupsCollapsed,
        [stageId]: !prev.groupsCollapsed[stageId],
      },
    }));
  };

  const collapseBtn = (stageId: number, label: string) => {
    const isCollapsed = Boolean(ui.stageCollapsed[stageId]);
    return (
      <button
        type="button"
        onClick={() => toggleStageCollapsed(stageId)}
        aria-expanded={!isCollapsed}
        className={cn(
          "inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-200 transition",
          "hover:bg-white/[0.07]",
          "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/15"
        )}
      >
        {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        {isCollapsed ? `Rozwiń ${label.toLowerCase()}` : `Zwiń ${label.toLowerCase()}`}
      </button>
    );
  };

  const clearAll = () => setFilters({ query: "", stageIds: [], groupKeys: [] });

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6">
        <Card className="p-6 text-slate-200">Ładowanie...</Card>
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
          <MassStartFilterPanel
            totalStageCount={totalStageCount}
            totalGroupCount={totalGroupCount}
            stageOptions={stageOptions}
            groupOptions={groupOptions}
            filters={filters}
            onFiltersChange={setFilters}
            panelCollapsed={ui.panelCollapsed}
            onTogglePanelCollapsed={() =>
              setUi((prev) => ({ ...prev, panelCollapsed: !prev.panelCollapsed }))
            }
            onClearAll={clearAll}
          />
        </div>

        <div className="min-w-0">
          <div className="space-y-10">
            {!filteredStageBlocks.length ? (
              <Card className="p-6">
                <div className="text-sm text-slate-200">{emptyStateText}</div>
              </Card>
            ) : (
              filteredStageBlocks.map(({ stage, stageName, stageHeading, groups: stageGroups }) => {
                const isCollapsed = Boolean(ui.stageCollapsed[stage.stage_id]);

                return (
                  <div key={stage.stage_id} className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="text-base font-semibold text-white">{stageHeading}</div>
                      {collapseBtn(stage.stage_id, stageName)}
                    </div>

                    {!isCollapsed
                      ? renderStageBlock(
                          stage,
                          stageGroups,
                          "list",
                          Boolean(ui.groupsCollapsed[stage.stage_id]),
                          () => toggleGroupsCollapsed(stage.stage_id)
                        )
                      : null}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
