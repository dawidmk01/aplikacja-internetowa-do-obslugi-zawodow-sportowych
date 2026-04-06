// frontend/src/pages/TournamentSchedule.tsx
// Strona obsługuje harmonogram turnieju dla meczów par oraz harmonogram etapów i grup w trybie MASS_START.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import { Calendar, ChevronUp, Clock, Eraser, MapPin } from "lucide-react";

import { apiFetch } from "../api";
import DivisionSwitcher, {
  type DivisionSwitcherItem,
} from "../components/DivisionSwitcher";
import { useTournamentWs } from "../hooks/useTournamentWs";
import { cn } from "../lib/cn";
import { Card } from "../ui/Card";
import { Input } from "../ui/Input";
import { toast } from "../ui/Toast";

import AutosaveIndicator from "../components/AutosaveIndicator";
import { useAutosave } from "../hooks/useAutosave";

import {
  bucketForStatus,
  sectionCardClasses,
  TournamentMatchesScaffold,
  type MatchLikeBase,
  type MatchStatusBucket,
  type StageType,
} from "./_shared/TournamentMatchesScaffold";

import {
  TournamentMassStartScheduleScaffold,
  type MassStartViewMode,
} from "./_shared/TournamentMassStartScheduleScaffold";

// ---------------------------------------------------------------------------
// DTO types
// ---------------------------------------------------------------------------

type DivisionStatus = "DRAFT" | "CONFIGURED" | "RUNNING" | "FINISHED";
type DivisionSummaryDTO = DivisionSwitcherItem & {
  status?: DivisionStatus;
};

type ScheduleStageDTO = {
  stage_id: number;
  stage_type: StageType | "MASS_START";
  stage_order: number;
  stage_name: string;
  scheduled_date: string | null;
  scheduled_time: string | null;
  location: string | null;
};

type ScheduleGroupDTO = {
  group_id: number;
  group_name: string;
  stage_id: number;
  stage_order: number;
  stage_name: string;
  scheduled_date: string | null;
  scheduled_time: string | null;
  location: string | null;
};

type TournamentScheduleDTO = {
  id: number;
  discipline?: string | null;
  competition_model?: string | null;
  start_date: string | null;
  end_date: string | null;
  location: string | null;
  tournament_format?: string | null;
  active_division_id?: number | null;
  active_division_name?: string | null;
  active_division_slug?: string | null;
  division_status?: DivisionStatus | null;
  divisions?: DivisionSummaryDTO[];
  schedule_targets?: {
    stages: ScheduleStageDTO[];
    groups: ScheduleGroupDTO[];
  };
};

type MatchScheduleDTO = MatchLikeBase & {
  stage_type: StageType;
  round_number: number | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  location: string | null;
};

type MatchDraft = {
  scheduled_date: string | null;
  scheduled_time: string | null;
  location: string | null;
};

type TournamentMetaDraft = {
  start_date: string | null;
  end_date: string | null;
  location: string | null;
  stage_schedule: ScheduleStageDTO[];
  group_schedule: ScheduleGroupDTO[];
};

// ---------------------------------------------------------------------------
// Typ: która encja była ostatnio edytowana (na potrzeby wskaźnika autosave)
// ---------------------------------------------------------------------------
type LastEditedEntity =
  | { type: "tournament" }
  | { type: "stage"; id: number }
  | { type: "group"; id: number };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseDivisionId(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
}

function withDivisionQuery(url: string, divisionId: number | null | undefined) {
  if (!divisionId) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}division_id=${divisionId}`;
}

function isIsoDateBetween(value: string, min: string | null, max: string | null) {
  if (!value) return { ok: true as const };
  if (min && value < min) return { ok: false as const, message: "Data przed startem turnieju." };
  if (max && value > max) return { ok: false as const, message: "Data po zakończeniu turnieju." };
  return { ok: true as const };
}

function validateTournamentDates(start_date: string | null, end_date: string | null) {
  if (!start_date || !end_date) return { ok: true as const };
  if (start_date > end_date) return { ok: false as const, message: "Start po zakończeniu." };
  return { ok: true as const };
}

function toDraft(m: MatchScheduleDTO): MatchDraft {
  return {
    scheduled_date: m.scheduled_date ?? null,
    scheduled_time: m.scheduled_time ?? null,
    location: m.location ?? null,
  };
}

function toMetaDraft(t: TournamentScheduleDTO | null): TournamentMetaDraft | null {
  if (!t) return null;
  return {
    start_date: t.start_date ?? null,
    end_date: t.end_date ?? null,
    location: t.location ?? null,
    stage_schedule: t.schedule_targets?.stages ?? [],
    group_schedule: t.schedule_targets?.groups ?? [],
  };
}

function normalizeMatches(raw: any): MatchScheduleDTO[] {
  if (Array.isArray(raw)) return raw as MatchScheduleDTO[];
  if (Array.isArray(raw?.results)) return raw.results as MatchScheduleDTO[];
  return [];
}

// ---------------------------------------------------------------------------
// MassStartStageBlock – oddzielny komponent dla etapu (zwijalne grupy + autosave)
// Dzięki osobnemu komponentowi każdy etap ma własny stan zwinięcia grup.
// ---------------------------------------------------------------------------

type MassStartStageBlockProps = {
  stage: ScheduleStageDTO;
  stageGroups: ScheduleGroupDTO[];
  viewMode: MassStartViewMode;
  tournamentStartDate: string | null;
  tournamentEndDate: string | null;
  fieldWrap: string;
  fieldIcon: string;
  fieldInput: string;
  metaStatus: string;
  metaError: string | null;
  lastEditedEntity: LastEditedEntity | null;
  groupsCollapsed: boolean;
  onToggleGroupsCollapsed: () => void;
  updateStageSchedule: (id: number, patch: Partial<ScheduleStageDTO>) => void;
  updateGroupSchedule: (id: number, patch: Partial<ScheduleGroupDTO>) => void;
  clearStageSchedule: (id: number) => void;
  clearGroupSchedule: (id: number) => void;
  commitMeta: () => void;
};

function MassStartStageBlock({
  stage,
  stageGroups,
  viewMode,
  tournamentStartDate,
  tournamentEndDate,
  fieldWrap,
  fieldIcon,
  fieldInput,
  metaStatus,
  metaError,
  lastEditedEntity,
  groupsCollapsed,
  onToggleGroupsCollapsed,
  updateStageSchedule,
  updateGroupSchedule,
  clearStageSchedule,
  clearGroupSchedule,
  commitMeta,
}: MassStartStageBlockProps) {
  const stageAutosaveStatus = (
    lastEditedEntity?.type === "stage" && lastEditedEntity.id === stage.stage_id
      ? metaStatus
      : "idle"
  ) as any;
  const stageAutosaveError =
    lastEditedEntity?.type === "stage" && lastEditedEntity.id === stage.stage_id
      ? metaError
      : null;

  const plannedCardStyles = sectionCardClasses("PLANNED");
  const stageCardTitle = stage.stage_name?.trim() || `Etap ${stage.stage_order}`;
  const groupsLayoutClass =
    viewMode === "grid"
      ? "grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
      : "space-y-4";

  const stageDateCheck = stage.scheduled_date
    ? isIsoDateBetween(stage.scheduled_date, tournamentStartDate, tournamentEndDate)
    : { ok: true as const };

  const toggleGroupsLabel = groupsCollapsed ? "Rozwiń grupy" : "Zwiń grupy";

  return (
    <div className="space-y-4">
      <Card className={cn("border p-5 sm:p-6", plannedCardStyles.shell)}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <span>{stageCardTitle}</span>
              <AutosaveIndicator
                status={stageAutosaveStatus}
                error={stageAutosaveError ?? undefined}
              />
            </div>
            {!stageDateCheck.ok ? (
              <div className="mt-1 text-xs text-rose-300">{stageDateCheck.message}</div>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => clearStageSchedule(stage.stage_id)}
            className="inline-flex items-center gap-2 px-2 py-2 text-xs font-medium text-slate-400 transition-colors hover:text-white"
            title="Wyczyść dane etapu"
          >
            <Eraser className="h-4 w-4" />
            <span className="hidden sm:inline">Wyczyść</span>
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className={fieldWrap}>
            <Calendar className={fieldIcon} />
            <Input
              unstyled
              className={cn(fieldInput, "[color-scheme:dark]")}
              type="date"
              value={stage.scheduled_date ?? ""}
              min={tournamentStartDate ?? undefined}
              max={tournamentEndDate ?? undefined}
              onChange={(e) =>
                updateStageSchedule(stage.stage_id, { scheduled_date: e.target.value || null })
              }
              onBlur={commitMeta}
              aria-label={`Data dla ${stage.stage_name}`}
            />
          </div>
          <div className={fieldWrap}>
            <Clock className={fieldIcon} />
            <Input
              unstyled
              className={cn(fieldInput, "[color-scheme:dark]")}
              type="time"
              value={stage.scheduled_time ?? ""}
              onChange={(e) =>
                updateStageSchedule(stage.stage_id, { scheduled_time: e.target.value || null })
              }
              onBlur={commitMeta}
              aria-label={`Godzina dla ${stage.stage_name}`}
            />
          </div>
          <div className={fieldWrap}>
            <MapPin className={fieldIcon} />
            <Input
              unstyled
              className={fieldInput}
              value={stage.location ?? ""}
              placeholder="Lokalizacja etapu"
              onChange={(e) =>
                updateStageSchedule(stage.stage_id, { location: e.target.value || null })
              }
              onBlur={commitMeta}
              aria-label={`Lokalizacja dla ${stage.stage_name}`}
            />
          </div>
        </div>
      </Card>

      {stageGroups.length ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-white">Grupy</div>
            <button
              type="button"
              onClick={onToggleGroupsCollapsed}
              aria-expanded={!groupsCollapsed}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-200 transition",
                "hover:bg-white/[0.07]",
                "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/15"
              )}
            >
              <ChevronUp className={cn("h-4 w-4 transition-transform", groupsCollapsed && "rotate-180")} />
              {toggleGroupsLabel}
            </button>
          </div>

          {!groupsCollapsed ? (
            <div className={groupsLayoutClass}>
              {stageGroups.map((group) => {
                const groupAutosaveStatus = (
                  lastEditedEntity?.type === "group" && lastEditedEntity.id === group.group_id
                    ? metaStatus
                    : "idle"
                ) as any;
                const groupAutosaveError =
                  lastEditedEntity?.type === "group" && lastEditedEntity.id === group.group_id
                    ? metaError
                    : null;

                const groupDateCheck = group.scheduled_date
                  ? isIsoDateBetween(group.scheduled_date, tournamentStartDate, tournamentEndDate)
                  : { ok: true as const };

                return (
                  <div key={group.group_id} className="min-w-0 space-y-3">
                    <Card className={cn("border p-5 sm:p-6", plannedCardStyles.shell)}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-sm font-semibold text-white">
                            <span className="truncate">{group.group_name}</span>
                            <AutosaveIndicator
                              status={groupAutosaveStatus}
                              error={groupAutosaveError ?? undefined}
                            />
                          </div>
                          {!groupDateCheck.ok ? (
                            <div className="mt-1 text-xs text-rose-300">{groupDateCheck.message}</div>
                          ) : null}
                        </div>

                        <button
                          type="button"
                          onClick={() => clearGroupSchedule(group.group_id)}
                          className="inline-flex items-center gap-2 px-2 py-2 text-xs font-medium text-slate-400 transition-colors hover:text-white"
                          title="Wyczyść dane grupy"
                        >
                          <Eraser className="h-4 w-4" />
                          <span className="hidden sm:inline">Wyczyść</span>
                        </button>
                      </div>

                      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <div className={fieldWrap}>
                          <Calendar className={fieldIcon} />
                          <Input
                            unstyled
                            className={cn(fieldInput, "[color-scheme:dark]")}
                            type="date"
                            value={group.scheduled_date ?? ""}
                            min={tournamentStartDate ?? undefined}
                            max={tournamentEndDate ?? undefined}
                            onChange={(e) =>
                              updateGroupSchedule(group.group_id, {
                                scheduled_date: e.target.value || null,
                              })
                            }
                            onBlur={commitMeta}
                            aria-label={`Data dla ${group.group_name}`}
                          />
                        </div>
                        <div className={fieldWrap}>
                          <Clock className={fieldIcon} />
                          <Input
                            unstyled
                            className={cn(fieldInput, "[color-scheme:dark]")}
                            type="time"
                            value={group.scheduled_time ?? ""}
                            onChange={(e) =>
                              updateGroupSchedule(group.group_id, {
                                scheduled_time: e.target.value || null,
                              })
                            }
                            onBlur={commitMeta}
                            aria-label={`Godzina dla ${group.group_name}`}
                          />
                        </div>
                        <div className={fieldWrap}>
                          <MapPin className={fieldIcon} />
                          <Input
                            unstyled
                            className={fieldInput}
                            value={group.location ?? ""}
                            placeholder="Lokalizacja grupy"
                            onChange={(e) =>
                              updateGroupSchedule(group.group_id, {
                                location: e.target.value || null,
                              })
                            }
                            onBlur={commitMeta}
                            aria-label={`Lokalizacja dla ${group.group_name}`}
                          />
                        </div>
                      </div>
                    </Card>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TournamentSchedule() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const tournamentId = id ?? "";
  const requestedDivisionId = useMemo(() => {
    return (
      parseDivisionId(searchParams.get("division_id")) ??
      parseDivisionId(searchParams.get("active_division_id"))
    );
  }, [searchParams]);

  const [divisions, setDivisions] = useState<DivisionSummaryDTO[]>([]);
  const [activeDivisionId, setActiveDivisionId] = useState<number | null>(
    requestedDivisionId
  );
  const [activeDivisionName, setActiveDivisionName] = useState<string | null>(null);

  const effectiveDivisionId = requestedDivisionId ?? activeDivisionId;

  const [tournament, setTournament] = useState<TournamentScheduleDTO | null>(null);
  const [matches, setMatches] = useState<MatchScheduleDTO[]>([]);
  const [loading, setLoading] = useState(true);

  // -------------------------------------------------------------------------
  // Śledzenie ostatnio edytowanej encji – osobna kropka zapisu dla każdej
  // -------------------------------------------------------------------------
  const [lastEditedEntity, setLastEditedEntity] = useState<LastEditedEntity | null>(null);

  // -------------------------------------------------------------------------
  // Autosave – mecze
  // -------------------------------------------------------------------------

  const matchAutosave = useAutosave<MatchDraft>({
    onSave: async (matchId, data) => {
      const res = await apiFetch(withDivisionQuery(`/api/matches/${matchId}/`, effectiveDivisionId), {
        method: "PATCH",
        toastOnError: false,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.detail || "Błąd zapisu meczu");
      }
      setMatches((prev) => prev.map((m) => (m.id === matchId ? { ...m, ...data } : m)));
    },
  });

  // -------------------------------------------------------------------------
  // Autosave – meta turnieju (daty + harmonogram etapów/grup)
  // -------------------------------------------------------------------------

  const tournamentAutosave = useAutosave<TournamentMetaDraft>({
    onSave: async (_key, data) => {
      const datesCheck = validateTournamentDates(data.start_date, data.end_date);
      if (!datesCheck.ok) throw new Error(datesCheck.message);

      const res = await apiFetch(withDivisionQuery(`/api/tournaments/${tournamentId}/meta/`, effectiveDivisionId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_date: data.start_date,
          end_date: data.end_date,
          location: data.location,
          stage_schedule: data.stage_schedule,
          group_schedule: data.group_schedule,
        }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.detail || "Błąd zapisu danych turnieju");
      }

      const payload = (await res.json().catch(() => null)) as TournamentScheduleDTO | null;
      if (payload) {
        setTournament(payload);
        setDivisions(Array.isArray(payload.divisions) ? payload.divisions : []);
        setActiveDivisionId(payload.active_division_id ?? effectiveDivisionId ?? null);
        setActiveDivisionName(payload.active_division_name ?? null);
      } else {
        setTournament((prev) =>
          prev
            ? {
                ...prev,
                start_date: data.start_date,
                end_date: data.end_date,
                location: data.location,
                schedule_targets: {
                  stages: data.stage_schedule,
                  groups: data.group_schedule,
                },
              }
            : prev
        );
      }
    },
  });

  const matchAutosaveRef = useRef(matchAutosave);
  const tournamentAutosaveRef = useRef(tournamentAutosave);
  const matchIdsRef = useRef<number[]>([]);

  useEffect(() => {
    matchAutosaveRef.current = matchAutosave;
  }, [matchAutosave]);

  useEffect(() => {
    tournamentAutosaveRef.current = tournamentAutosave;
  }, [tournamentAutosave]);

  useEffect(() => {
    matchIdsRef.current = matches.map((match) => match.id);
  }, [matches]);

  const resetDivisionScopedAutosave = useCallback(() => {
    tournamentAutosaveRef.current.clearDraft("meta");
    matchIdsRef.current.forEach((matchId) => {
      matchAutosaveRef.current.clearDraft(matchId);
    });
    setLastEditedEntity(null);
  }, []);

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!tournamentId) return;
    let alive = true;

    const init = async () => {
      try {
        setLoading(true);
        resetDivisionScopedAutosave();

        const [tRes, mRes] = await Promise.all([
          apiFetch(withDivisionQuery(`/api/tournaments/${tournamentId}/`, requestedDivisionId)),
          apiFetch(withDivisionQuery(`/api/tournaments/${tournamentId}/matches/`, requestedDivisionId)),
        ]);
        if (!tRes.ok || !mRes.ok) throw new Error("Błąd ładowania danych.");

        const tData = (await tRes.json()) as TournamentScheduleDTO;
        const raw = await mRes.json();
        if (!alive) return;

        setTournament(tData);
        setDivisions(Array.isArray(tData.divisions) ? tData.divisions : []);
        setActiveDivisionId(tData.active_division_id ?? requestedDivisionId ?? null);
        setActiveDivisionName(tData.active_division_name ?? null);
        setMatches(normalizeMatches(raw));

        const resolvedDivisionId = tData.active_division_id ?? requestedDivisionId ?? null;
        if (
          !requestedDivisionId &&
          resolvedDivisionId &&
          Array.isArray(tData.divisions) &&
          tData.divisions.length > 1
        ) {
          const nextSearch = new URLSearchParams(window.location.search);
          nextSearch.set("division_id", String(resolvedDivisionId));
          setSearchParams(nextSearch, { replace: true });
        }
      } catch (e: any) {
        toast.error(e?.message || "Wystąpił błąd podczas ładowania.");
      } finally {
        if (alive) setLoading(false);
      }
    };

    void init();
    return () => {
      alive = false;
    };
  }, [tournamentId, requestedDivisionId, resetDivisionScopedAutosave, setSearchParams]);

  // -------------------------------------------------------------------------
  // WebSocket reload
  // -------------------------------------------------------------------------

  const reloadMatches = useCallback(async () => {
    if (!tournamentId) return;
    try {
      const [tRes, mRes] = await Promise.all([
        apiFetch(withDivisionQuery(`/api/tournaments/${tournamentId}/`, effectiveDivisionId)),
        apiFetch(withDivisionQuery(`/api/tournaments/${tournamentId}/matches/`, effectiveDivisionId)),
      ]);
      if (tRes.ok) {
        const tData = (await tRes.json()) as TournamentScheduleDTO;
        setTournament(tData);
        setDivisions(Array.isArray(tData.divisions) ? tData.divisions : []);
        setActiveDivisionId(tData.active_division_id ?? effectiveDivisionId ?? null);
        setActiveDivisionName(tData.active_division_name ?? null);
      }
      if (mRes.ok) {
        const raw = await mRes.json();
        setMatches(normalizeMatches(raw));
      }
    } catch (e: any) {
      toast.error(e?.message || "Nie udało się odświeżyć danych");
    }
  }, [effectiveDivisionId, tournamentId]);

  const reloadTimerRef = useRef<number | null>(null);
  const requestMatchesReload = useCallback(() => {
    if (reloadTimerRef.current) return;
    reloadTimerRef.current = window.setTimeout(() => {
      reloadTimerRef.current = null;
      void reloadMatches();
    }, 200);
  }, [reloadMatches]);

  useTournamentWs({
    tournamentId,
    enabled: Boolean(tournamentId),
    onEvent: ({ event }) => {
      const normalized = String(event).replaceAll(".", "_");
      if (normalized === "matches_changed" || normalized === "tournament_changed") {
        requestMatchesReload();
      }
    },
  });

  const handleDivisionSwitch = useCallback(
    async (nextDivisionId: number) => {
      if (loading || nextDivisionId === effectiveDivisionId) return;

      const nextSearch = new URLSearchParams(searchParams);
      nextSearch.set("division_id", String(nextDivisionId));
      setSearchParams(nextSearch, { replace: false });
    },
    [effectiveDivisionId, loading, searchParams, setSearchParams]
  );

  // -------------------------------------------------------------------------
  // Derived state
  // -------------------------------------------------------------------------

  const tournamentFormat = useMemo(
    () => String(tournament?.tournament_format ?? ""),
    [tournament?.tournament_format]
  );

  const isMassStartScheduleMode = useMemo(() => {
    return (
      String(tournament?.discipline ?? "").toLowerCase() === "custom" &&
      String(tournament?.competition_model ?? "").toUpperCase() === "MASS_START"
    );
  }, [tournament?.competition_model, tournament?.discipline]);

  const currentMeta = (tournamentAutosave.drafts["meta"] ?? toMetaDraft(tournament)) as TournamentMetaDraft | null;
  const metaStatus = tournamentAutosave.statuses["meta"] ?? "idle";
  const metaError = tournamentAutosave.errors["meta"] ?? null;

  // -------------------------------------------------------------------------
  // Meta update helpers – każda z tych funkcji ustawia lastEditedEntity
  // -------------------------------------------------------------------------

  const updateMetaDraft = useCallback(
    (patch: Partial<TournamentMetaDraft>) => {
      if (!currentMeta) return;
      tournamentAutosave.update("meta", { ...currentMeta, ...patch });
    },
    [currentMeta, tournamentAutosave]
  );

  const updateStageSchedule = useCallback(
    (stageId: number, patch: Partial<ScheduleStageDTO>) => {
      if (!currentMeta) return;
      setLastEditedEntity({ type: "stage", id: stageId });
      updateMetaDraft({
        stage_schedule: currentMeta.stage_schedule.map((stage) =>
          stage.stage_id === stageId ? { ...stage, ...patch } : stage
        ),
      });
    },
    [currentMeta, updateMetaDraft]
  );

  const updateGroupSchedule = useCallback(
    (groupId: number, patch: Partial<ScheduleGroupDTO>) => {
      if (!currentMeta) return;
      setLastEditedEntity({ type: "group", id: groupId });
      updateMetaDraft({
        group_schedule: currentMeta.group_schedule.map((group) =>
          group.group_id === groupId ? { ...group, ...patch } : group
        ),
      });
    },
    [currentMeta, updateMetaDraft]
  );

  const forceSaveMeta = useCallback(
    (nextMeta: TournamentMetaDraft) => {
      tournamentAutosave.update("meta", nextMeta);
      void tournamentAutosave.forceSave("meta", nextMeta);
    },
    [tournamentAutosave]
  );

  const clearStageSchedule = useCallback(
    (stageId: number) => {
      if (!currentMeta) return;
      setLastEditedEntity({ type: "stage", id: stageId });
      const nextMeta: TournamentMetaDraft = {
        ...currentMeta,
        stage_schedule: currentMeta.stage_schedule.map((stage) =>
          stage.stage_id === stageId
            ? {
                ...stage,
                scheduled_date: null,
                scheduled_time: null,
                location: null,
              }
            : stage
        ),
      };
      forceSaveMeta(nextMeta);
    },
    [currentMeta, forceSaveMeta]
  );

  const clearGroupSchedule = useCallback(
    (groupId: number) => {
      if (!currentMeta) return;
      setLastEditedEntity({ type: "group", id: groupId });
      const nextMeta: TournamentMetaDraft = {
        ...currentMeta,
        group_schedule: currentMeta.group_schedule.map((group) =>
          group.group_id === groupId
            ? {
                ...group,
                scheduled_date: null,
                scheduled_time: null,
                location: null,
              }
            : group
        ),
      };
      forceSaveMeta(nextMeta);
    },
    [currentMeta, forceSaveMeta]
  );

  const commitMeta = useCallback(() => {
    if (!currentMeta) return;
    void tournamentAutosave.forceSave("meta", currentMeta);
  }, [currentMeta, tournamentAutosave]);

  // -------------------------------------------------------------------------
  // Shared field styles
  // -------------------------------------------------------------------------

  const fieldWrap =
    "relative flex min-w-0 items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 h-10";
  const fieldIcon = "h-4 w-4 text-slate-200/90 shrink-0";
  const fieldInput = cn(
    "h-10 w-full min-w-0 bg-transparent text-sm text-slate-100",
    "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/10"
  );

  // -------------------------------------------------------------------------
  // Tournament meta card (wspólna dla obu trybów)
  // Wskaźnik autosave w karcie turnieju reaguje tylko na edycję danych turnieju.
  // -------------------------------------------------------------------------

  // Status kroopki dla karty turnieju
  const tournamentIndicatorStatus = (
    lastEditedEntity?.type === "tournament" ? metaStatus : "idle"
  ) as any;

  const tournamentMetaCard = tournament ? (
    <Card className="w-full p-5 sm:p-6">
      <div className="flex flex-wrap justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold text-white">Dane turnieju</span>
          <AutosaveIndicator
            status={tournamentIndicatorStatus}
            error={lastEditedEntity?.type === "tournament" ? metaError ?? undefined : undefined}
          />
        </div>
        <button
          type="button"
          onClick={() => {
            if (!currentMeta) return;
            setLastEditedEntity({ type: "tournament" });
            void tournamentAutosave.forceSave("meta", {
              ...currentMeta,
              start_date: null,
              end_date: null,
              location: null,
              stage_schedule: currentMeta.stage_schedule.map((stage) => ({
                ...stage,
                scheduled_date: null,
                scheduled_time: null,
                location: null,
              })),
              group_schedule: currentMeta.group_schedule.map((group) => ({
                ...group,
                scheduled_date: null,
                scheduled_time: null,
                location: null,
              })),
            });
          }}
          className="inline-flex items-center gap-2 px-2 py-2 text-xs font-medium text-slate-400 transition-colors hover:text-white disabled:opacity-60"
          title="Wyczyść dane turnieju"
          disabled={!currentMeta}
        >
          <Eraser className="h-4 w-4" />
          <span className="hidden sm:inline">Wyczyść</span>
        </button>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className={fieldWrap}>
          <Calendar className={fieldIcon} />
          <Input
            unstyled
            className={cn(fieldInput, "[color-scheme:dark]")}
            type="date"
            name="tournament_start_date"
            aria-label="Data rozpoczęcia turnieju"
            value={currentMeta?.start_date ?? ""}
            max={currentMeta?.end_date ?? undefined}
            onChange={(e) => {
              setLastEditedEntity({ type: "tournament" });
              updateMetaDraft({ start_date: e.target.value || null });
            }}
            onBlur={commitMeta}
          />
        </div>
        <div className={fieldWrap}>
          <Calendar className={fieldIcon} />
          <Input
            unstyled
            className={cn(fieldInput, "[color-scheme:dark]")}
            type="date"
            name="tournament_end_date"
            aria-label="Data zakończenia turnieju"
            value={currentMeta?.end_date ?? ""}
            min={currentMeta?.start_date ?? undefined}
            onChange={(e) => {
              setLastEditedEntity({ type: "tournament" });
              updateMetaDraft({ end_date: e.target.value || null });
            }}
            onBlur={commitMeta}
          />
        </div>
        <div className={fieldWrap}>
          <MapPin className={fieldIcon} />
          <Input
            unstyled
            className={fieldInput}
            name="tournament_location"
            aria-label="Lokalizacja turnieju"
            placeholder="Lokalizacja"
            value={currentMeta?.location ?? ""}
            onChange={(e) => {
              setLastEditedEntity({ type: "tournament" });
              updateMetaDraft({ location: e.target.value || null });
            }}
            onBlur={commitMeta}
          />
        </div>
      </div>

      {lastEditedEntity?.type === "tournament" && metaError ? (
        <div className="mt-3 text-xs text-rose-300">{metaError}</div>
      ) : null}
    </Card>
  ) : null;

  const headerSlot = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {activeDivisionName ? (
            <div className="text-sm text-slate-300">
              Aktywna dywizja: <span className="text-slate-100">{activeDivisionName}</span>
            </div>
          ) : null}
        </div>

        <DivisionSwitcher
          divisions={divisions}
          activeDivisionId={effectiveDivisionId}
          disabled={loading}
          onChange={handleDivisionSwitch}
        />
      </div>

      {tournamentMetaCard}
    </div>
  );

  // -------------------------------------------------------------------------
  // Match mode helpers
  // -------------------------------------------------------------------------

  const cardShellForMatch = (bucket: MatchStatusBucket, isOutOfRange: boolean) => {
    const base = sectionCardClasses(bucket);
    if (isOutOfRange) {
      return { shell: cn(base.shell, "border-rose-400/25 bg-rose-500/[0.06]") };
    }
    return { shell: cn(base.shell) };
  };

  const stageTitle = (stageType: StageType, allMatchesForStage: MatchScheduleDTO[]) => {
    if (stageType === "LEAGUE") return "Liga - terminarz";
    if (stageType === "GROUP") return "Faza grupowa - terminarz";
    if (stageType === "THIRD_PLACE") return "Mecz o 3 miejsce";
    const matchesCount = allMatchesForStage.length;
    if (matchesCount === 1) return "Finał";
    if (matchesCount === 2) return "Półfinał";
    if (matchesCount === 4) return "Ćwierćfinał";
    return `1/${matchesCount * 2} Finału`;
  };

  const renderMatchRow = (m: MatchScheduleDTO) => {
    const draft = matchAutosave.drafts[m.id] ?? toDraft(m);
    const saveStatus = matchAutosave.statuses[m.id] ?? "idle";
    const error = matchAutosave.errors[m.id] ?? null;

    const dateCheck = draft.scheduled_date
      ? isIsoDateBetween(draft.scheduled_date, tournament?.start_date ?? null, tournament?.end_date ?? null)
      : { ok: true as const };

    const bucket = bucketForStatus(m.status);
    const shell = cardShellForMatch(bucket, !dateCheck.ok);

    const errId = `match-${m.id}-error`;
    const rangeId = `match-${m.id}-range`;

    return (
      <Card key={m.id} className={cn("border p-5 sm:p-6", shell.shell)}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <span className="min-w-0 truncate">
                {m.home_team_name} <span className="font-normal text-slate-400">vs</span> {m.away_team_name}
              </span>
              <AutosaveIndicator status={saveStatus} error={error} />
            </div>
            {error ? (
              <div id={errId} className="mt-1 text-xs text-rose-300">
                {error}
              </div>
            ) : null}
            {!dateCheck.ok ? (
              <div id={rangeId} className="mt-1 text-xs text-rose-300">
                {dateCheck.message}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => {
              void matchAutosave.forceSave(m.id, {
                scheduled_date: null,
                scheduled_time: null,
                location: null,
              });
            }}
            className="inline-flex items-center gap-2 px-2 py-2 text-xs font-medium text-slate-400 transition-colors hover:text-white"
            title="Wyczyść dane meczu"
          >
            <Eraser className="h-4 w-4" />
            <span className="hidden sm:inline">Wyczyść</span>
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className={fieldWrap}>
            <Calendar className={fieldIcon} />
            <Input
              unstyled
              className={cn(fieldInput, "[color-scheme:dark]")}
              type="date"
              name={`match_${m.id}_scheduled_date`}
              aria-label="Data meczu"
              aria-describedby={cn(error ? errId : "", !dateCheck.ok ? rangeId : "").trim() || undefined}
              value={draft.scheduled_date ?? ""}
              min={tournament?.start_date ?? undefined}
              max={tournament?.end_date ?? undefined}
              onChange={(e) => matchAutosave.update(m.id, { ...draft, scheduled_date: e.target.value || null })}
              onBlur={() => void matchAutosave.forceSave(m.id, draft)}
            />
          </div>
          <div className={fieldWrap}>
            <Clock className={fieldIcon} />
            <Input
              unstyled
              className={cn(fieldInput, "[color-scheme:dark]")}
              type="time"
              name={`match_${m.id}_scheduled_time`}
              aria-label="Godzina meczu"
              aria-describedby={error ? errId : undefined}
              value={draft.scheduled_time ?? ""}
              onChange={(e) => matchAutosave.update(m.id, { ...draft, scheduled_time: e.target.value || null })}
              onBlur={() => void matchAutosave.forceSave(m.id, draft)}
            />
          </div>
          <div className={fieldWrap}>
            <MapPin className={fieldIcon} />
            <Input
              unstyled
              className={fieldInput}
              name={`match_${m.id}_location`}
              aria-label="Miejsce meczu"
              aria-describedby={error ? errId : undefined}
              placeholder="Miejsce"
              value={draft.location ?? ""}
              onChange={(e) => matchAutosave.update(m.id, { ...draft, location: e.target.value || null })}
              onBlur={() => void matchAutosave.forceSave(m.id, draft)}
            />
          </div>
        </div>
      </Card>
    );
  };

  // -------------------------------------------------------------------------
  // Mass-start: renderStageBlock – zwraca osobny komponent MassStartStageBlock
  // Dzięki użyciu komponentu (a nie funkcji render) React zachowuje stan
  // zwinięcia grup między re-renderami, o ile key się nie zmienia.
  // -------------------------------------------------------------------------

  const renderStageBlock = useCallback(
    (
      stage: ScheduleStageDTO,
      stageGroups: ScheduleGroupDTO[],
      viewMode: MassStartViewMode,
      groupsCollapsed: boolean,
      onToggleGroupsCollapsed: () => void
    ) => (
      <MassStartStageBlock
        key={stage.stage_id}
        stage={stage}
        stageGroups={stageGroups}
        viewMode={viewMode}
        tournamentStartDate={tournament?.start_date ?? null}
        tournamentEndDate={tournament?.end_date ?? null}
        fieldWrap={fieldWrap}
        fieldIcon={fieldIcon}
        fieldInput={fieldInput}
        metaStatus={metaStatus}
        metaError={metaError}
        lastEditedEntity={lastEditedEntity}
        groupsCollapsed={groupsCollapsed}
        onToggleGroupsCollapsed={onToggleGroupsCollapsed}
        updateStageSchedule={updateStageSchedule}
        updateGroupSchedule={updateGroupSchedule}
        clearStageSchedule={clearStageSchedule}
        clearGroupSchedule={clearGroupSchedule}
        commitMeta={commitMeta}
      />
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      commitMeta,
      fieldIcon,
      fieldInput,
      fieldWrap,
      lastEditedEntity,
      metaError,
      metaStatus,
      tournament?.end_date,
      tournament?.start_date,
      updateGroupSchedule,
      updateStageSchedule,
      clearGroupSchedule,
      clearStageSchedule,
    ]
  );

  // -------------------------------------------------------------------------
  // Guard renders
  // -------------------------------------------------------------------------

  if (!tournamentId) {
    return (
      <div className="w-full py-6">
        <Card className="p-6 text-slate-200">Brak ID turnieju.</Card>
      </div>
    );
  }

  if (!loading && !tournament) {
    return (
      <div className="w-full py-6">
        <Card className="p-6 text-slate-200">Nie znaleziono turnieju.</Card>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Mass-start mode → scaffold
  // Tytuł i opis ujednolicone ze standardowym harmonogramem.
  // -------------------------------------------------------------------------

  if (isMassStartScheduleMode) {
    return (
      <TournamentMassStartScheduleScaffold
        tournamentId={tournamentId}
        title="Harmonogram i lokalizacja"
        description="Ustaw termin i lokalizację turnieju, a następnie doprecyzuj datę, godzinę i miejsce dla każdego etapu i grupy."
        loading={loading}
        headerSlot={headerSlot}
        storageScope="schedule"
        stages={currentMeta?.stage_schedule ?? []}
        groups={currentMeta?.group_schedule ?? []}
        renderStageBlock={renderStageBlock}
      />
    );
  }

  // -------------------------------------------------------------------------
  // Standard matches mode → TournamentMatchesScaffold
  // -------------------------------------------------------------------------

  return (
    <TournamentMatchesScaffold
      tournamentId={tournamentId}
      tournamentFormat={tournamentFormat}
      title="Harmonogram i lokalizacja"
      description="Ustaw termin i lokalizację turnieju, a następnie doprecyzuj datę, godzinę i miejsce dla każdego meczu."
      loading={loading}
      matches={matches}
      headerSlot={headerSlot}
      storageScope="schedule"
      renderMatch={renderMatchRow}
      stageTitle={stageTitle}
    />
  );
}
