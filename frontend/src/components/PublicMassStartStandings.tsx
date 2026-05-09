// frontend/src/components/PublicMassStartStandings.tsx
// Komponent renderuje publiczną klasyfikację rezultatów MASS_START w trybach etapów redukcyjnych i wielu konkurencji.

import { useEffect, useMemo, useState } from "react";
import { Sparkles, Trophy, Users } from "lucide-react";

import { apiFetch } from "../api";
import { cn } from "../lib/cn";

import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { InlineAlert } from "../ui/InlineAlert";

type CustomResultValueKind = "NUMBER" | "TIME" | "PLACE";
type CustomTimeFormat = "HH:MM:SS" | "MM:SS" | "MM:SS.hh" | "SS.hh";
type CustomStageStructureMode = "REDUCTION" | "MULTI_EVENT";
type MultiEventOverallMode = "POINTS_BY_RANK" | "SUM_RANKS" | "SUM_RESULTS";
type MassStartResultStatus = "OK" | "DNS" | "DNF" | "DSQ";

type TournamentResultConfigDTO = {
  value_kind?: CustomResultValueKind;
  measured_value_kind?: CustomResultValueKind;
  mass_start_value_kind?: CustomResultValueKind;
  unit?: string;
  unit_label?: string;
  decimal_places?: number | null;
  time_format?: CustomTimeFormat | null;
  better_result?: "HIGHER" | "LOWER";
  allow_ties?: boolean;
  stage_structure_mode?: CustomStageStructureMode | string | null;
  multi_event_overall_mode?: MultiEventOverallMode | string | null;
};

type MassStartRoundResultDTO = {
  round_number: number;
  result_id: number | null;
  numeric_value?: string | null;
  time_ms?: number | null;
  place_value?: number | null;
  result_status?: MassStartResultStatus;
  display_value?: string | null;
  rank?: number | null;
  is_active: boolean;
};

type MassStartEntryDTO = {
  team_id: number;
  team_name: string;
  group_id: number | null;
  rank?: number | null;
  aggregate_value?: string | number | null;
  aggregate_display?: string | null;
  rounds: MassStartRoundResultDTO[];
};

type MassStartGroupDTO = {
  group_id: number;
  group_name: string;
  entries: MassStartEntryDTO[];
};

type MassStartStageDTO = {
  stage_id: number;
  stage_order: number;
  stage_name: string;
  stage_status?: string;
  groups_count: number;
  participants_count?: number | null;
  advance_count?: number | null;
  rounds_count: number;
  aggregation_mode: string;
  groups: MassStartGroupDTO[];
};

type MassStartOverallEventDTO = {
  stage_id: number;
  stage_order: number;
  stage_name: string;
};

type MassStartOverallEventResultDTO = {
  stage_id: number;
  stage_order: number;
  stage_name: string;
  rank?: number | null;
  points: number;
  aggregate_value?: string | number | null;
  aggregate_display?: string | null;
  overall_contribution?: string | number | null;
  overall_contribution_display?: string | null;
  is_completed?: boolean;
  result_status?: MassStartResultStatus;
  result_status_display?: string | null;
};

type MassStartOverallStandingDTO = {
  rank?: number | null;
  team_id: number;
  team_name: string;
  overall_score?: string | number | null;
  overall_display?: string | null;
  total_points: number;
  total_rank_sum?: number | null;
  total_result_value?: string | number | null;
  events_count: number;
  completed_events_count: number;
  special_statuses_count: number;
  event_results: MassStartOverallEventResultDTO[];
};

type TournamentMassStartResultsResponseDTO = {
  tournament_id: number;
  competition_model: string;
  stage_structure_mode?: CustomStageStructureMode | string | null;
  value_kind?: CustomResultValueKind;
  unit_label?: string;
  allow_ties?: boolean;
  overall_mode?: MultiEventOverallMode | string | null;
  overall_events?: MassStartOverallEventDTO[];
  overall_standings?: MassStartOverallStandingDTO[];
  stages: MassStartStageDTO[];
};

type Props = {
  tournamentId: number;
  divisionId?: number;
  accessCode?: string;
  refreshKey?: number;
  resultConfig?: TournamentResultConfigDTO;
  stageStructureMode?: CustomStageStructureMode | string | null;
};

function appendQueryParams(
  url: string,
  params: Record<string, string | number | boolean | null | undefined>
): string {
  const queryIndex = url.indexOf("?");
  const base = queryIndex >= 0 ? url.slice(0, queryIndex) : url;
  const rawQuery = queryIndex >= 0 ? url.slice(queryIndex + 1) : "";
  const search = new URLSearchParams(rawQuery);

  Object.entries(params).forEach(([key, value]) => {
    if (value === null || typeof value === "undefined" || value === "") {
      search.delete(key);
      return;
    }
    search.set(key, String(value));
  });

  const query = search.toString();
  return query ? `${base}?${query}` : base;
}

function getResolvedValueKind(resultConfig?: TournamentResultConfigDTO): CustomResultValueKind {
  const direct = String(resultConfig?.value_kind ?? "").toUpperCase();
  if (direct === "NUMBER" || direct === "TIME" || direct === "PLACE") {
    return direct as CustomResultValueKind;
  }

  const massStart = String(resultConfig?.mass_start_value_kind ?? "").toUpperCase();
  if (massStart === "NUMBER" || massStart === "TIME" || massStart === "PLACE") {
    return massStart as CustomResultValueKind;
  }

  return "NUMBER";
}

function resolveStageStructureMode(
  explicitMode: Props["stageStructureMode"],
  resultConfig?: TournamentResultConfigDTO,
  payload?: TournamentMassStartResultsResponseDTO | null
): CustomStageStructureMode {
  const candidates = [
    explicitMode,
    payload?.stage_structure_mode,
    resultConfig?.stage_structure_mode,
  ];

  return candidates.some((value) => String(value ?? "").toUpperCase() === "MULTI_EVENT")
    ? "MULTI_EVENT"
    : "REDUCTION";
}

function isMultiEventMode(stageStructureMode: CustomStageStructureMode) {
  return stageStructureMode === "MULTI_EVENT";
}

function stageSummary(stage: MassStartStageDTO, stageStructureMode: CustomStageStructureMode) {
  const isMultiEvent = isMultiEventMode(stageStructureMode);
  const parts = [
    `grupy: ${stage.groups_count}`,
    `uczestnicy: ${stage.participants_count ?? "-"}`,
  ];

  if (!isMultiEvent) {
    parts.push(`awans: ${stage.advance_count ?? "-"}`);
  }

  parts.push(`${isMultiEvent ? "próby" : "rundy"}: ${stage.rounds_count}`);
  return parts.join(" • ");
}

function stageStatusLabel(stage: MassStartStageDTO, stageStructureMode: CustomStageStructureMode) {
  const status = String(stage.stage_status ?? "").toUpperCase();

  if (isMultiEventMode(stageStructureMode)) {
    if (status === "CLOSED") return "Zamknięta";
    if (status === "PLANNED") return "Dostępna";
    return "Otwarta";
  }

  if (status === "CLOSED") return "Zamknięty";
  if (status === "PLANNED") return "Zaplanowany";
  return "Otwarty";
}

function stageTone(stage: MassStartStageDTO, stageStructureMode: CustomStageStructureMode) {
  const status = String(stage.stage_status ?? "").toUpperCase();
  const editableLike = isMultiEventMode(stageStructureMode) && status !== "CLOSED";

  if (status === "OPEN" || editableLike) {
    return {
      card: "border-emerald-400/20 bg-emerald-500/[0.05]",
      badge: "border-emerald-400/30 bg-emerald-500/[0.10] text-emerald-100",
      dot: "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.5)]",
      glow: "from-emerald-500/10 via-transparent to-transparent",
    };
  }

  if (status === "CLOSED") {
    return {
      card: "border-sky-400/15 bg-sky-500/[0.04]",
      badge: "border-sky-400/25 bg-sky-500/[0.08] text-sky-100",
      dot: "bg-sky-300 shadow-[0_0_10px_rgba(125,211,252,0.35)]",
      glow: "from-sky-500/10 via-transparent to-transparent",
    };
  }

  return {
    card: "border-white/10 bg-white/[0.03]",
    badge: "border-white/15 bg-white/[0.06] text-slate-100",
    dot: "bg-white/60",
    glow: "from-white/5 via-transparent to-transparent",
  };
}

function entrySort(left: MassStartEntryDTO, right: MassStartEntryDTO) {
  const leftRank = typeof left.rank === "number" ? left.rank : Number.MAX_SAFE_INTEGER;
  const rightRank = typeof right.rank === "number" ? right.rank : Number.MAX_SAFE_INTEGER;
  if (leftRank !== rightRank) return leftRank - rightRank;
  return left.team_name.localeCompare(right.team_name, "pl");
}

function overallSort(left: MassStartOverallStandingDTO, right: MassStartOverallStandingDTO) {
  const leftRank = typeof left.rank === "number" ? left.rank : Number.MAX_SAFE_INTEGER;
  const rightRank = typeof right.rank === "number" ? right.rank : Number.MAX_SAFE_INTEGER;
  if (leftRank !== rightRank) return leftRank - rightRank;
  return left.team_name.localeCompare(right.team_name, "pl");
}

function formatOverallEvents(row: MassStartOverallStandingDTO) {
  return `${row.completed_events_count}/${row.events_count}`;
}

function overallModeLabel(mode?: MultiEventOverallMode | string | null) {
  if (mode === "SUM_RANKS") return "Suma miejsc";
  if (mode === "SUM_RESULTS") return "Suma wyników";
  return "Punkty za miejsca";
}

function overallValueHeader(mode?: MultiEventOverallMode | string | null) {
  if (mode === "SUM_RANKS") return "Suma miejsc";
  if (mode === "SUM_RESULTS") return "Suma wyników";
  return "Punkty";
}

function overallValue(row: MassStartOverallStandingDTO) {
  return row.overall_display || row.overall_score || row.total_points;
}

function eventResultByStage(row: MassStartOverallStandingDTO, stageId: number) {
  return row.event_results.find((event) => event.stage_id === stageId);
}

function eventContributionLabel(event?: MassStartOverallEventResultDTO) {
  if (!event) return "-";
  return event.overall_contribution_display || event.aggregate_display || "-";
}

function eventDetailLabel(
  event?: MassStartOverallEventResultDTO,
  mode?: MultiEventOverallMode | string | null,
) {
  if (!event) return "Brak danych";
  const status = resultStatusLabel(event.result_status);
  if (status) return status;

  const fragments = [];
  if (typeof event.rank === "number") fragments.push(`miejsce ${event.rank}`);
  if (event.aggregate_display) fragments.push(`wynik ${event.aggregate_display}`);
  if (
    (!mode || mode === "POINTS_BY_RANK") &&
    Number.isFinite(Number(event.points))
  ) {
    fragments.push(`${event.points} pkt`);
  }
  return fragments.join(" • ") || "Brak wyniku";
}

function resultStatusLabel(resultStatus?: MassStartResultStatus | null) {
  if (!resultStatus || resultStatus === "OK") return "";
  if (resultStatus === "DNS") return "DNS - nie wystartował";
  if (resultStatus === "DNF") return "DNF - nie ukończył";
  if (resultStatus === "DSQ") return "DSQ - dyskwalifikacja";
  return resultStatus;
}

function roundValueLabel(round: MassStartRoundResultDTO) {
  const statusDisplay = resultStatusLabel(round.result_status);
  if (statusDisplay) return statusDisplay;

  const display = String(round.display_value ?? "").trim();
  if (display) return display;

  if (round.numeric_value != null) return String(round.numeric_value);
  if (round.time_ms != null) return `${round.time_ms} ms`;
  if (round.place_value != null) return String(round.place_value);

  return "-";
}

function groupName(group: MassStartGroupDTO, index: number) {
  const raw = String(group.group_name ?? "").trim();
  if (!raw) return `Grupa ${index + 1}`;

  const lower = raw.toLowerCase();
  if (lower.startsWith("grupa ")) return raw;
  return raw;
}

function valueKindLabel(valueKind: CustomResultValueKind, unitLabel: string) {
  if (valueKind === "TIME") return "Wynik czasowy";
  if (valueKind === "PLACE") return "Wynik według miejsca";
  return unitLabel ? `Wynik liczbowy (${unitLabel})` : "Wynik liczbowy";
}

function stageDisplayName(stage: MassStartStageDTO, stageStructureMode: CustomStageStructureMode) {
  const raw = String(stage.stage_name ?? "").trim();
  if (raw) return raw;
  return `${isMultiEventMode(stageStructureMode) ? "Konkurencja" : "Etap"} ${stage.stage_order}`;
}

function isFinalStage(stage: MassStartStageDTO, stages: MassStartStageDTO[]) {
  const lastOrder = Math.max(...stages.map((item) => item.stage_order));
  const name = String(stage.stage_name ?? "").toLowerCase();
  return stage.stage_order === lastOrder || name.includes("finał") || name.includes("final");
}

function placeBadgeClass(rank: number | null | undefined) {
  if (rank === 1) return "border-amber-300/25 bg-amber-400/10 text-amber-100";
  if (rank === 2) return "border-slate-200/15 bg-white/[0.06] text-slate-100";
  if (rank === 3) return "border-orange-300/20 bg-orange-400/10 text-orange-100";
  return "border-white/10 bg-white/[0.04] text-slate-200";
}

function rowTone(rank: number | null | undefined) {
  if (rank === 1) return "bg-white/[0.06]";
  if (rank === 2 || rank === 3) return "bg-white/[0.035]";
  return "bg-transparent";
}

function resultMetaText(valueKind: CustomResultValueKind, unitLabel: string) {
  if (valueKind === "TIME") return "Prezentacja według czasu.";
  if (valueKind === "PLACE") return "Prezentacja według miejsc.";
  return unitLabel ? `Prezentacja w jednostce ${unitLabel}.` : "Prezentacja wyników liczbowych.";
}

function readApiDetail(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "detail" in data) {
    const detail = (data as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail.trim()) {
      return detail;
    }
  }

  return fallback;
}

export default function PublicMassStartStandings({
  tournamentId,
  divisionId,
  accessCode,
  refreshKey = 0,
  resultConfig,
  stageStructureMode: explicitStageStructureMode,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<TournamentMassStartResultsResponseDTO | null>(null);
  const [selectedStageId, setSelectedStageId] = useState<number | null>(null);

  const qs = useMemo(
    () =>
      appendQueryParams("", {
        code: String(accessCode ?? "").trim() || undefined,
        division_id: divisionId ?? undefined,
      }),
    [accessCode, divisionId]
  );

  const valueKind = useMemo(() => getResolvedValueKind(resultConfig), [resultConfig]);
  const unitLabel = useMemo(
    () => String(resultConfig?.unit_label ?? resultConfig?.unit ?? "").trim(),
    [resultConfig]
  );
  const stageStructureMode = useMemo(
    () => resolveStageStructureMode(explicitStageStructureMode, resultConfig, payload),
    [explicitStageStructureMode, payload, resultConfig]
  );
  const isMultiEvent = isMultiEventMode(stageStructureMode);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const res = await apiFetch(
          `/api/tournaments/${tournamentId}/public/mass-start-results/${qs}`,
          { toastOnError: false } as any
        );

        const data = (await res.json().catch(() => null)) as
          | TournamentMassStartResultsResponseDTO
          | { detail?: string }
          | null;

        if (!res.ok) {
          throw new Error(readApiDetail(data, "Nie udało się pobrać klasyfikacji."));
        }

        if (!alive) return;
        setPayload(data as TournamentMassStartResultsResponseDTO);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message ?? "Nie udało się pobrać klasyfikacji.");
      } finally {
        if (alive) setLoading(false);
      }
    };

    void load();

    return () => {
      alive = false;
    };
  }, [divisionId, qs, refreshKey, tournamentId]);

  const stages = useMemo(() => {
    return Array.isArray(payload?.stages)
      ? [...payload.stages]
          .filter((stage) => isMultiEvent || String(stage.stage_status ?? "").toUpperCase() !== "PLANNED")
          .sort((a, b) => a.stage_order - b.stage_order)
      : [];
  }, [isMultiEvent, payload]);

  useEffect(() => {
    if (stages.length === 0 || isMultiEvent) {
      setSelectedStageId(null);
      return;
    }

    setSelectedStageId((current) => {
      if (current && stages.some((stage) => stage.stage_id === current)) {
        return current;
      }
      return stages[stages.length - 1]?.stage_id ?? stages[0]?.stage_id ?? null;
    });
  }, [isMultiEvent, stages]);

  const selectedStage = useMemo(() => {
    if (isMultiEvent) return null;
    if (!selectedStageId) return stages[0] ?? null;
    return stages.find((stage) => stage.stage_id === selectedStageId) ?? stages[0] ?? null;
  }, [isMultiEvent, selectedStageId, stages]);

  const overallStandings = useMemo(() => {
    return Array.isArray(payload?.overall_standings)
      ? [...payload.overall_standings].sort(overallSort)
      : [];
  }, [payload]);

  const overallEvents = useMemo(() => {
    if (Array.isArray(payload?.overall_events) && payload.overall_events.length > 0) {
      return [...payload.overall_events].sort((a, b) => a.stage_order - b.stage_order);
    }

    const eventMap = new Map<number, MassStartOverallEventDTO>();
    for (const row of overallStandings) {
      for (const event of row.event_results || []) {
        eventMap.set(event.stage_id, {
          stage_id: event.stage_id,
          stage_order: event.stage_order,
          stage_name: event.stage_name,
        });
      }
    }

    return [...eventMap.values()].sort((a, b) => a.stage_order - b.stage_order);
  }, [overallStandings, payload]);

  const overallMode = payload?.overall_mode ?? resultConfig?.multi_event_overall_mode ?? "POINTS_BY_RANK";

  if (loading) {
    return (
      <div className="text-sm text-slate-300">
        {isMultiEvent ? "Ładowanie klasyfikacji konkurencji..." : "Ładowanie rankingu etapowego..."}
      </div>
    );
  }

  if (error) {
    return <InlineAlert variant="error">{error}</InlineAlert>;
  }

  if (!payload || stages.length === 0 || (!isMultiEvent && !selectedStage)) {
    return (
      <InlineAlert variant="info">
        {isMultiEvent ? "Brak danych klasyfikacji konkurencji." : "Brak danych rankingu etapowego."}
      </InlineAlert>
    );
  }

  const roundLabel = isMultiEvent ? "Próba" : "Runda";
  const aggregateLabel = isMultiEvent ? "Wynik konkurencji" : "Suma / wynik";
  const headerBadge = isMultiEvent ? "Klasyfikacja konkurencji" : "Klasyfikacja etapowa";
  const headerTitle = isMultiEvent ? "Publiczna klasyfikacja konkurencji" : "Publiczna klasyfikacja etapowa";
  const headerDescription = isMultiEvent
    ? "Poniżej widoczne są wszystkie konkurencje wraz z miejscami, wynikami łącznymi i rezultatami prób."
    : "Wybierz etap, aby zobaczyć miejsca, sumę wyników i rezultaty rund bez przeładowywania całej strony.";

  const renderOverallCard = () => {
    if (!isMultiEvent || overallStandings.length === 0) return null;

    return (
      <Card className="relative overflow-hidden border border-amber-300/15 bg-amber-400/[0.04] p-4 sm:p-5">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-amber-400/10 via-transparent to-sky-500/10" />

        <div className="relative">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-100">
                <Trophy className="h-3.5 w-3.5" />
                Klasyfikacja łączna
              </div>
              <div className="mt-3 text-lg font-extrabold text-white">Klasyfikacja łączna wieloboju</div>
              <div className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-300">
                Metoda: {overallModeLabel(overallMode)}. Statusy DNS, DNF i DSQ nie zwiększają wyniku w danej konkurencji.
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-300">
              {overallStandings.length} uczestników w klasyfikacji
            </div>
          </div>

          <div className="mt-5 hidden overflow-x-auto lg:block">
            <table className="min-w-full border-separate border-spacing-0 overflow-hidden rounded-3xl border border-white/10 bg-white/[0.025]">
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                  <th className="px-5 py-4">Miejsce</th>
                  <th className="px-5 py-4">Uczestnik</th>
                  <th className="px-5 py-4">{overallValueHeader(overallMode)}</th>
                  {overallEvents.map((event) => (
                    <th key={event.stage_id} className="min-w-[150px] px-5 py-4">
                      {event.stage_name}
                    </th>
                  ))}
                  <th className="px-5 py-4">Ukończone</th>
                  <th className="px-5 py-4">Statusy</th>
                </tr>
              </thead>
              <tbody>
                {overallStandings.map((row) => (
                  <tr key={row.team_id} className={cn("text-sm text-slate-100", rowTone(row.rank))}>
                    <td className="border-t border-white/10 px-5 py-4 align-middle">
                      <span
                        className={cn(
                          "inline-flex min-w-[52px] items-center justify-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold",
                          placeBadgeClass(row.rank)
                        )}
                      >
                        {row.rank === 1 ? <Sparkles className="h-3.5 w-3.5" /> : null}
                        {row.rank ?? "-"}
                      </span>
                    </td>
                    <td className="border-t border-white/10 px-5 py-4 font-semibold">{row.team_name}</td>
                    <td className="border-t border-white/10 px-5 py-4 font-semibold text-white">{overallValue(row)}</td>
                    {overallEvents.map((event) => {
                      const eventResult = eventResultByStage(row, event.stage_id);

                      return (
                        <td key={event.stage_id} className="border-t border-white/10 px-5 py-4 align-top">
                          <div className="font-semibold text-white">{eventContributionLabel(eventResult)}</div>
                          <div className="mt-1 text-xs text-slate-400">{eventDetailLabel(eventResult, overallMode)}</div>
                        </td>
                      );
                    })}
                    <td className="border-t border-white/10 px-5 py-4 text-slate-300">{formatOverallEvents(row)}</td>
                    <td className="border-t border-white/10 px-5 py-4 text-slate-300">
                      {row.special_statuses_count > 0 ? `${row.special_statuses_count} status specjalny` : "Brak"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-5 grid gap-3 lg:hidden">
            {overallStandings.map((row) => (
              <div
                key={row.team_id}
                className={cn(
                  "rounded-2xl border border-white/10 bg-white/[0.035] p-4",
                  rowTone(row.rank)
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white">{row.team_name}</div>
                    <div className="mt-1 text-xs text-slate-400">
                      {overallValueHeader(overallMode)}: {overallValue(row)} • konkurencje: {formatOverallEvents(row)}
                    </div>
                  </div>
                  <span
                    className={cn(
                      "inline-flex min-w-[52px] items-center justify-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold",
                      placeBadgeClass(row.rank)
                    )}
                  >
                    {row.rank === 1 ? <Sparkles className="h-3.5 w-3.5" /> : null}
                    {row.rank ?? "-"}
                  </span>
                </div>

                <div className="mt-4 grid gap-2">
                  {overallEvents.map((event) => {
                    const eventResult = eventResultByStage(row, event.stage_id);

                    return (
                      <div key={event.stage_id} className="rounded-2xl border border-white/10 bg-black/10 px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-xs font-semibold text-slate-300">{event.stage_name}</div>
                          <div className="text-xs font-bold text-white">{eventContributionLabel(eventResult)}</div>
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500">{eventDetailLabel(eventResult, overallMode)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>
    );
  };

  const renderStageCard = (stage: MassStartStageDTO) => {
    const tone = stageTone(stage, stageStructureMode);
    const finalStage = !isMultiEvent && isFinalStage(stage, stages);

    return (
      <Card key={stage.stage_id} className={cn("relative overflow-hidden border p-4 sm:p-5", tone.card)}>
        <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br", tone.glow)} />

        <div className="relative">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="text-lg font-extrabold text-white">{stageDisplayName(stage, stageStructureMode)}</div>
              <div className="mt-1 text-xs text-slate-400">{stageSummary(stage, stageStructureMode)}</div>
            </div>

            <div
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs",
                tone.badge
              )}
            >
              <span className={cn("h-2 w-2 rounded-full", tone.dot)} />
              {stageStatusLabel(stage, stageStructureMode)}
            </div>
          </div>

          <div className="mt-5 space-y-4">
            {stage.groups.map((group, groupIndex) => {
              const entries = [...group.entries].sort(entrySort);

              return (
                <div
                  key={group.group_id}
                  className="overflow-hidden rounded-[26px] border border-white/10 bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
                    <div className="text-base font-bold text-white">
                      {groupName(group, groupIndex)}
                    </div>
                    <div className="inline-flex items-center gap-2 text-xs text-slate-400">
                      <Users className="h-3.5 w-3.5" />
                      {entries.length} uczestników
                    </div>
                  </div>

                  {entries.length === 0 ? (
                    <div className="px-5 py-4 text-sm text-slate-300">
                      Brak uczestników w tej grupie.
                    </div>
                  ) : (
                    <>
                      <div className="hidden overflow-x-auto lg:block">
                        <table className="min-w-full border-separate border-spacing-0">
                          <thead>
                            <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                              <th className="px-5 py-4">Miejsce</th>
                              <th className="px-5 py-4">Uczestnik</th>
                              <th className="px-5 py-4">{aggregateLabel}</th>
                              {Array.from({ length: stage.rounds_count }, (_, index) => (
                                <th key={index} className="px-5 py-4">
                                  {roundLabel} {index + 1}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {entries.map((entry) => {
                              const firstInFinal = finalStage && entry.rank === 1;
                              return (
                                <tr
                                  key={entry.team_id}
                                  className={cn(
                                    "text-sm text-slate-100",
                                    rowTone(entry.rank)
                                  )}
                                >
                                  <td className="border-t border-white/10 px-5 py-4 align-middle">
                                    <span
                                      className={cn(
                                        "inline-flex min-w-[52px] items-center justify-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold",
                                        placeBadgeClass(entry.rank)
                                      )}
                                    >
                                      {firstInFinal ? <Sparkles className="h-3.5 w-3.5" /> : null}
                                      {entry.rank ?? "-"}
                                    </span>
                                  </td>
                                  <td className="border-t border-white/10 px-5 py-4 font-semibold">
                                    {entry.team_name}
                                  </td>
                                  <td className="border-t border-white/10 px-5 py-4">
                                    <span className="font-semibold text-white">{entry.aggregate_display ?? "-"}</span>
                                  </td>
                                  {entry.rounds.map((round) => (
                                    <td key={round.round_number} className="border-t border-white/10 px-5 py-4 text-slate-200">
                                      {roundValueLabel(round)}
                                    </td>
                                  ))}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      <div className="grid gap-0 lg:hidden">
                        {entries.map((entry, index) => {
                          const firstInFinal = finalStage && entry.rank === 1;
                          return (
                            <div
                              key={entry.team_id}
                              className={cn(
                                "px-4 py-4",
                                index > 0 && "border-t border-white/10",
                                rowTone(entry.rank)
                              )}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold text-white">{entry.team_name}</div>
                                  <div className="mt-1 text-xs text-slate-400">
                                    {aggregateLabel}: {entry.aggregate_display ?? "-"}
                                  </div>
                                </div>

                                <span
                                  className={cn(
                                    "inline-flex min-w-[52px] items-center justify-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold",
                                    placeBadgeClass(entry.rank)
                                  )}
                                >
                                  {firstInFinal ? <Sparkles className="h-3.5 w-3.5" /> : null}
                                  {entry.rank ?? "-"}
                                </span>
                              </div>

                              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                {entry.rounds.map((round) => (
                                  <div
                                    key={round.round_number}
                                    className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2"
                                  >
                                    <div className="text-[11px] uppercase tracking-wide text-slate-400">
                                      {roundLabel} {round.round_number}
                                    </div>
                                    <div className="mt-1 text-sm font-semibold text-white">
                                      {roundValueLabel(round)}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Card>
    );
  };

  return (
    <div className="space-y-5">
      <Card className="relative overflow-hidden p-5 sm:p-6">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-indigo-500/10 via-transparent to-sky-500/10" />

        <div className="relative flex flex-col gap-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-300">
                <Sparkles className="h-3.5 w-3.5" />
                {headerBadge}
              </div>
              <div className="mt-3 text-xl font-bold text-white">{headerTitle}</div>
              <div className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-300">
                {headerDescription}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-300">
                {valueKindLabel(valueKind, unitLabel)}
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-400">
                {resultMetaText(valueKind, unitLabel)}
              </div>
            </div>
          </div>

          {!isMultiEvent ? (
            <div className="flex flex-wrap gap-2">
              {stages.map((stage) => {
                const active = selectedStage?.stage_id === stage.stage_id;
                return (
                  <Button
                    key={stage.stage_id}
                    type="button"
                    variant="secondary"
                    onClick={() => setSelectedStageId(stage.stage_id)}
                    className={cn(
                      "h-auto rounded-2xl px-4 py-3 text-left",
                      active
                        ? "border-white/15 bg-white/[0.11] text-white shadow-[0_0_0_1px_rgba(255,255,255,0.03)]"
                        : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.07]"
                    )}
                  >
                    <div className="text-sm font-semibold">Etap {stage.stage_order}</div>
                    <div className="mt-0.5 text-xs opacity-80">{stageDisplayName(stage, stageStructureMode)}</div>
                  </Button>
                );
              })}
            </div>
          ) : null}
        </div>
      </Card>

      {renderOverallCard()}
      {isMultiEvent ? stages.map(renderStageCard) : selectedStage ? renderStageCard(selectedStage) : null}
    </div>
  );
}
