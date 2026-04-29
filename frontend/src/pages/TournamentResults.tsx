// frontend/src/pages/TournamentResults.tsx
// Plik renderuje widok wyników turnieju i rozdziela prezentację meczów od rezultatów etapowych MASS_START.

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import { Brackets, Calendar, Clock, Gauge, TimerReset } from "lucide-react";

import { apiFetch } from "../api";
import MassStartStageCard from "../components/MassStartStageCard";
import MatchRow from "../components/MatchRow";
import { useTournamentWs } from "../hooks/useTournamentWs";
import { cn } from "../lib/cn";
import { getLabel, RESULT_VALUE_KIND_LABELS, TIME_FORMAT_LABELS } from "../lib/sportLabels";

import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { toast } from "../ui/Toast";

import type {
  AdvanceMassStartStageResponseDTO,
  MassStartEntryDTO,
  MassStartOverallEventDTO,
  MassStartOverallStandingDTO,
  MassStartResultStatus,
  MassStartStageDTO,
  MatchDTO,
  StageMassStartResultWriteDTO,
  TournamentDTO,
  TournamentMassStartResultsResponseDTO,
  TournamentResultConfigDTO,
} from "../types/results";

import {
  formatDatePL,
  isByeMatch,
  TournamentMatchesScaffold,
  type MatchLikeBase,
} from "./_shared/TournamentMatchesScaffold";

type ToastKind = "saved" | "success" | "error" | "info";
type StageStructureMode = "REDUCTION" | "MULTI_EVENT";
type MatchLike = MatchDTO & MatchLikeBase;
type DivisionSummaryDTO = { id: number; name?: string; status?: string };
type MassStartResultSaveResponseDTO = {
  detail?: string;
  payload?: TournamentMassStartResultsResponseDTO | null;
};

// ===== Normalizacja danych i trybu turnieju =====

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

function normalizeMatchList(raw: unknown): MatchLike[] {
  if (Array.isArray(raw)) return raw as MatchLike[];
  if (Array.isArray((raw as { results?: unknown[] } | null)?.results)) {
    return (raw as { results: MatchLike[] }).results;
  }
  return [];
}

function getResultConfig(tournament: TournamentDTO | null): TournamentResultConfigDTO {
  if (!tournament?.result_config) return {};
  return tournament.result_config;
}

function getCompetitionModel(tournament: TournamentDTO | null): string {
  return String(tournament?.competition_model ?? "").toUpperCase();
}

function getStageStructureMode(tournament: TournamentDTO | null): StageStructureMode {
  const directValue = String((tournament as any)?.stage_structure_mode ?? "").toUpperCase();
  const configValue = String((tournament as any)?.result_config?.stage_structure_mode ?? "").toUpperCase();
  const resolvedValue = directValue || configValue;

  return resolvedValue === "MULTI_EVENT" ? "MULTI_EVENT" : "REDUCTION";
}

function isMultiEventMode(stageStructureMode: StageStructureMode): boolean {
  return stageStructureMode === "MULTI_EVENT";
}

function getStageEntityLabel(stageStructureMode: StageStructureMode): string {
  return isMultiEventMode(stageStructureMode) ? "konkurencji" : "etapów";
}

function sortStageOrder(value: number | null | undefined): number {
  return typeof value === "number" ? value : Number.MAX_SAFE_INTEGER;
}

function displayText(value: unknown, fallback = "-"): string {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "string" || typeof value === "number") return String(value);
  return fallback;
}

function numericCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getCustomResultHint(config: TournamentResultConfigDTO): string {
  const valueKind = String(config.value_kind ?? "").toUpperCase();

  if (valueKind === "TIME") {
    const formatCode = String(config.time_format ?? "MM:SS.hh");
    const formatLabel = getLabel(TIME_FORMAT_LABELS, formatCode, formatCode);
    return `Wynik wpisywany jako czas. Format prezentacji: ${formatLabel}.`;
  }

  if (valueKind === "PLACE") {
    return "Wynik wpisywany jako miejsce w klasyfikacji. Niższa wartość oznacza lepszy rezultat.";
  }

  const unit = String(config.unit_label ?? config.unit ?? "").trim();
  const better = String(config.better_result ?? "HIGHER").toUpperCase();
  const decimals = typeof config.decimal_places === "number" ? config.decimal_places : 0;
  const betterLabel = better === "LOWER" ? "niższy lepszy" : "wyższy lepszy";
  const unitLabel = unit ? ` Jednostka: ${unit}.` : "";
  const valueKindLabel = getLabel(RESULT_VALUE_KIND_LABELS, valueKind, "Wynik liczbowy").toLowerCase();

  return `${valueKindLabel}, dokładność: ${decimals} miejsce po przecinku.${unitLabel} Zasada rankingu: ${betterLabel}.`;
}

// ===== Obsługa rezultatów MASS_START =====

function draftKey(stageId: number, groupId: number | null, teamId: number, roundNumber: number) {
  return `${stageId}:${groupId ?? 0}:${teamId}:${roundNumber}`;
}

function isStageOpen(stage: MassStartStageDTO) {
  return String(stage.stage_status ?? "").toUpperCase() === "OPEN";
}

function isStagePlanned(stage: MassStartStageDTO) {
  return String(stage.stage_status ?? "").toUpperCase() === "PLANNED";
}

function hasIncompleteRounds(stage: MassStartStageDTO) {
  return stage.groups.some((group) =>
    group.entries.some((entry) =>
      entry.rounds.some((round) => !round.display_value)
    )
  );
}

function getAdvanceCandidateStage(stages: MassStartStageDTO[] | undefined | null) {
  if (!Array.isArray(stages) || stages.length === 0) return null;

  const ordered = [...stages].sort((a, b) => sortStageOrder(a.stage_order) - sortStageOrder(b.stage_order));

  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index];
    const next = ordered[index + 1];

    if (!current || !next) continue;
    if (!isStageOpen(current)) continue;
    if (!isStagePlanned(next)) continue;
    if (hasIncompleteRounds(current)) continue;

    return current;
  }

  return null;
}

function getVisibleMassStartStages(
  stages: MassStartStageDTO[] | undefined | null,
  stageStructureMode: StageStructureMode
) {
  if (!Array.isArray(stages)) return [];

  const orderedStages = [...stages].sort((a, b) => sortStageOrder(a.stage_order) - sortStageOrder(b.stage_order));

  if (isMultiEventMode(stageStructureMode)) {
    // Konkurencje są równoległymi częściami wydarzenia, dlatego nie są ukrywane jako zaplanowane etapy awansu.
    return orderedStages;
  }

  return orderedStages.filter((stage) => !isStagePlanned(stage));
}


// ===== Widok rezultatów etapowych i konkurencji =====

function overallSort(left: MassStartOverallStandingDTO, right: MassStartOverallStandingDTO) {
  const leftRank = typeof left.rank === "number" ? left.rank : Number.MAX_SAFE_INTEGER;
  const rightRank = typeof right.rank === "number" ? right.rank : Number.MAX_SAFE_INTEGER;
  if (leftRank !== rightRank) return leftRank - rightRank;
  return left.team_name.localeCompare(right.team_name, "pl");
}

function overallEventsLabel(row: MassStartOverallStandingDTO) {
  return `${numericCount(row.completed_events_count)}/${numericCount(row.events_count)}`;
}

function overallModeLabel(mode?: string | null) {
  if (mode === "SUM_RANKS") return "Suma miejsc";
  if (mode === "SUM_RESULTS") return "Suma wyników";
  return "Punkty za miejsca";
}

function overallValueHeader(mode?: string | null) {
  if (mode === "SUM_RANKS") return "Suma miejsc";
  if (mode === "SUM_RESULTS") return "Suma wyników";
  return "Punkty";
}

function overallValue(row: MassStartOverallStandingDTO) {
  return displayText(row.overall_display || row.overall_score || row.total_points);
}

function eventResultByStage(row: MassStartOverallStandingDTO, stageId: number) {
  return row.event_results.find((event) => event.stage_id === stageId);
}

function resultStatusLabel(resultStatus?: MassStartResultStatus | null) {
  if (!resultStatus || resultStatus === "OK") return "";
  if (resultStatus === "DNS") return "DNS - nie wystartował";
  if (resultStatus === "DNF") return "DNF - nie ukończył";
  if (resultStatus === "DSQ") return "DSQ - dyskwalifikacja";
  return resultStatus;
}

function eventContributionLabel(event?: MassStartOverallStandingDTO["event_results"][number]) {
  if (!event) return "-";
  return displayText(event.overall_contribution_display || event.aggregate_display);
}

function eventDetailLabel(event?: MassStartOverallStandingDTO["event_results"][number]) {
  if (!event) return "Brak danych";
  const status = resultStatusLabel(event.result_status);
  if (status) return status;

  const fragments: string[] = [];
  if (typeof event.rank === "number") fragments.push(`miejsce ${event.rank}`);
  if (event.aggregate_display) fragments.push(`wynik ${event.aggregate_display}`);
  if (Number.isFinite(Number(event.points))) fragments.push(`${displayText(event.points)} pkt`);
  return fragments.join(" • ") || "Brak wyniku";
}

function placeBadgeClass(rank: number | null | undefined) {
  if (rank === 1) return "border-amber-300/25 bg-amber-400/10 text-amber-100";
  if (rank === 2) return "border-slate-200/15 bg-white/[0.06] text-slate-100";
  if (rank === 3) return "border-orange-300/20 bg-orange-400/10 text-orange-100";
  return "border-white/10 bg-white/[0.04] text-slate-200";
}

function MassStartResultsView({
  loading,
  pageTitle,
  pageDescription,
  customModeCard,
  customResultConfig,
  stageStructureMode,
  massStartData,
  canManageTournament,
  drafts,
  statusDrafts,
  savingRows,
  onDraftChange,
  onStatusDraftChange,
  onSaveEntry,
}: {
  loading: boolean;
  pageTitle: string;
  pageDescription: string;
  customModeCard: ReactNode;
  customResultConfig: TournamentResultConfigDTO;
  stageStructureMode: StageStructureMode;
  massStartData: TournamentMassStartResultsResponseDTO | null;
  canManageTournament: boolean;
  drafts: Record<string, string>;
  statusDrafts: Record<string, MassStartResultStatus>;
  savingRows: Record<string, boolean>;
  onDraftChange: (key: string, value: string) => void;
  onStatusDraftChange: (key: string, value: MassStartResultStatus) => void;
  onSaveEntry: (stage: MassStartStageDTO, groupId: number | null, entry: MassStartEntryDTO) => Promise<void>;
}) {
  const visibleStages = useMemo(
    () => getVisibleMassStartStages(massStartData?.stages, stageStructureMode),
    [massStartData, stageStructureMode]
  );

  const overallStandings = useMemo(() => {
    return Array.isArray(massStartData?.overall_standings)
      ? [...massStartData.overall_standings].sort(overallSort)
      : [];
  }, [massStartData]);

  const overallEvents = useMemo<MassStartOverallEventDTO[]>(() => {
    if (Array.isArray(massStartData?.overall_events) && massStartData.overall_events.length > 0) {
      return [...massStartData.overall_events].sort((a, b) => sortStageOrder(a.stage_order) - sortStageOrder(b.stage_order));
    }

    const eventMap = new Map<number, MassStartOverallEventDTO>();
    for (const row of overallStandings) {
      for (const event of row.event_results || []) {
        eventMap.set(event.stage_id, {
          stage_id: event.stage_id,
          stage_order: event.stage_order ?? null,
          stage_name: event.stage_name ?? null,
        });
      }
    }

    return [...eventMap.values()].sort((a, b) => sortStageOrder(a.stage_order) - sortStageOrder(b.stage_order));
  }, [massStartData, overallStandings]);

  const overallMode = massStartData?.overall_mode ?? "POINTS_BY_RANK";

  const stageEntityLabel = getStageEntityLabel(stageStructureMode);

  return (
    <div className="w-full">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-2xl font-extrabold text-white">{pageTitle}</div>
          <div className="mt-1 text-sm text-slate-300">{pageDescription}</div>
        </div>
      </div>

      {customModeCard}

      {loading ? (
        <Card className="p-6 text-slate-200">Ładowanie rezultatów {stageEntityLabel}...</Card>
      ) : !massStartData || visibleStages.length === 0 ? (
        <Card className="p-6 text-slate-200">Brak {stageEntityLabel} do wyświetlenia.</Card>
      ) : (
        <div className="space-y-6">
          {stageStructureMode === "MULTI_EVENT" && overallStandings.length > 0 ? (
            <Card className="border border-amber-300/15 bg-amber-400/[0.04] p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-lg font-extrabold text-white">Klasyfikacja łączna wieloboju</div>
                  <div className="mt-1 text-sm text-slate-300">
                    Metoda: {overallModeLabel(overallMode)}. Statusy DNS, DNF i DSQ nie zwiększają wyniku w danej konkurencji.
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-300">
                  {overallStandings.length} uczestników
                </div>
              </div>

              <div className="mt-5 overflow-x-auto">
                <table className="min-w-full border-separate border-spacing-0">
                  <thead>
                    <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                      <th className="px-4 py-3">Miejsce</th>
                      <th className="px-4 py-3">Uczestnik</th>
                      <th className="px-4 py-3">{overallValueHeader(overallMode)}</th>
                      {overallEvents.map((event) => (
                        <th key={event.stage_id} className="min-w-[140px] px-4 py-3">
                          {event.stage_name ?? `Konkurencja ${event.stage_id}`}
                        </th>
                      ))}
                      <th className="px-4 py-3">Ukończone</th>
                      <th className="px-4 py-3">Statusy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overallStandings.map((row) => (
                      <tr key={row.team_id} className="text-sm text-slate-100">
                        <td className="border-t border-white/10 px-4 py-3">
                          <span className={cn("inline-flex min-w-[52px] justify-center rounded-full border px-3 py-1 text-xs font-semibold", placeBadgeClass(row.rank))}>
                            {row.rank ?? "-"}
                          </span>
                        </td>
                        <td className="border-t border-white/10 px-4 py-3 font-semibold">{row.team_name}</td>
                        <td className="border-t border-white/10 px-4 py-3 font-semibold text-white">{overallValue(row)}</td>
                        {overallEvents.map((event) => {
                          const eventResult = eventResultByStage(row, event.stage_id);

                          return (
                            <td key={event.stage_id} className="border-t border-white/10 px-4 py-3 align-top">
                              <div className="font-semibold text-white">{eventContributionLabel(eventResult)}</div>
                              <div className="mt-1 text-xs text-slate-400">{eventDetailLabel(eventResult)}</div>
                            </td>
                          );
                        })}
                        <td className="border-t border-white/10 px-4 py-3 text-slate-300">{overallEventsLabel(row)}</td>
                        <td className="border-t border-white/10 px-4 py-3 text-slate-300">
                          {numericCount(row.special_statuses_count) > 0 ? numericCount(row.special_statuses_count) : "Brak"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}

          {visibleStages.map((stage) => (
            <MassStartStageCard
              key={stage.stage_id}
              stage={stage}
              customResultConfig={customResultConfig}
              stageStructureMode={stageStructureMode}
              canManageTournament={canManageTournament}
              drafts={drafts}
              statusDrafts={statusDrafts}
              savingRows={savingRows}
              onDraftChange={onDraftChange}
              onStatusDraftChange={onStatusDraftChange}
              onSaveEntry={onSaveEntry}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function TournamentResults() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const tournamentId = id ?? "";
  const requestedDivisionId = useMemo(() => {
    return (
      parseDivisionId(searchParams.get("division_id")) ??
      parseDivisionId(searchParams.get("active_division_id"))
    );
  }, [searchParams]);

  const mountedRef = useRef(true);

  const [tournament, setTournament] = useState<TournamentDTO | null>(null);
  const [activeDivisionId, setActiveDivisionId] = useState<number | null>(requestedDivisionId);

  const effectiveDivisionId = requestedDivisionId ?? activeDivisionId;

  const [matches, setMatches] = useState<MatchLike[]>([]);
  const [massStartData, setMassStartData] = useState<TournamentMassStartResultsResponseDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [statusDrafts, setStatusDrafts] = useState<Record<string, MassStartResultStatus>>({});
  const [savingRows, setSavingRows] = useState<Record<string, boolean>>({});
  const [advanceBusy, setAdvanceBusy] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const pushToast = useCallback((message: string, kind: ToastKind = "info") => {
    if (kind === "success" || kind === "saved") {
      toast.success(message);
      return;
    }
    if (kind === "error") {
      toast.error(message);
      return;
    }
    toast.info(message);
  }, []);

  const reloadAll = useCallback(async () => {
    if (!tournamentId) return;

    if (mountedRef.current) setLoading(true);

    try {
      const tRes = await apiFetch(withDivisionQuery(`/api/tournaments/${tournamentId}/`, effectiveDivisionId));
      if (!tRes.ok) throw new Error("Nie udało się pobrać danych turnieju.");

      const tData = (await tRes.json()) as TournamentDTO;
      if (!mountedRef.current) return;

      setTournament(tData);
      setActiveDivisionId((tData as any).active_division_id ?? effectiveDivisionId ?? null);

      const resolvedDivisionId = (tData as any).active_division_id ?? effectiveDivisionId ?? null;
      if (
        !requestedDivisionId &&
        resolvedDivisionId &&
        Array.isArray((tData as any).divisions) &&
        ((tData as any).divisions as DivisionSummaryDTO[]).length > 1
      ) {
        const nextSearch = new URLSearchParams(window.location.search);
        nextSearch.set("division_id", String(resolvedDivisionId));
        setSearchParams(nextSearch, { replace: true });
      }

      const competitionModel = getCompetitionModel(tData);
      const usesCustomResults = String((tData as any).result_mode ?? "SCORE").toUpperCase() === "CUSTOM";
      const isMassStart = usesCustomResults && competitionModel === "MASS_START";

      if (isMassStart) {
        const res = await apiFetch(withDivisionQuery(`/api/tournaments/${tournamentId}/mass-start-results/`, resolvedDivisionId), {
          toastOnError: false,
        } as any);
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(String(data?.detail || "Nie udało się pobrać rezultatów etapowych."));
        }

        if (!mountedRef.current) return;
        setMassStartData(data as TournamentMassStartResultsResponseDTO);
        setMatches([]);
      } else {
        const mRes = await apiFetch(withDivisionQuery(`/api/tournaments/${tournamentId}/matches/`, resolvedDivisionId));
        if (!mRes.ok) throw new Error("Nie udało się pobrać meczów.");

        const raw = await mRes.json();
        const list = normalizeMatchList(raw);

        if (!mountedRef.current) return;
        setMatches(list);
        setMassStartData(null);
      }
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "Wystąpił błąd podczas ładowania.", "error");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [effectiveDivisionId, pushToast, requestedDivisionId, setSearchParams, tournamentId]);

  useEffect(() => {
    if (!tournamentId) return;
    void reloadAll();
  }, [reloadAll, tournamentId]);

  useEffect(() => {
    if (!massStartData) return;

    const nextDrafts: Record<string, string> = {};
    const nextStatusDrafts: Record<string, MassStartResultStatus> = {};

    for (const stage of massStartData.stages) {
      for (const group of stage.groups) {
        for (const entry of group.entries) {
          for (const round of entry.rounds) {
            const key = draftKey(stage.stage_id, group.group_id, entry.team_id, round.round_number);
            const resultStatus = String(round.result_status ?? "OK").toUpperCase() as MassStartResultStatus;
            nextStatusDrafts[key] = ["OK", "DNS", "DNF", "DSQ"].includes(resultStatus)
              ? resultStatus
              : "OK";

            if (round.numeric_value != null) nextDrafts[key] = String(round.numeric_value);
            else if (round.time_ms != null) nextDrafts[key] = String(round.time_ms);
            else if (round.place_value != null) nextDrafts[key] = String(round.place_value);
            else nextDrafts[key] = "";
          }
        }
      }
    }

    setDrafts(nextDrafts);
    setStatusDrafts(nextStatusDrafts);
  }, [massStartData]);

  useTournamentWs({
    tournamentId,
    enabled: Boolean(tournamentId),
    onEvent: ({ event }) => {
      const normalized = String(event).replaceAll(".", "_");

      if (
        normalized === "matches_changed" ||
        normalized === "incidents_changed" ||
        normalized === "clock_changed" ||
        normalized === "commentary_changed" ||
        normalized === "mass_start_results_changed"
      ) {
        void reloadAll();
      }
    },
  });

  const tournamentFormat = useMemo(() => String((tournament as any)?.tournament_format ?? ""), [tournament]);

  const canManageTournament = useMemo(() => {
    const role = String((tournament as any)?.my_role ?? "");
    return role === "ORGANIZER" || role === "ASSISTANT";
  }, [tournament]);

  const usesCustomResults = useMemo(
    () => String((tournament as any)?.result_mode ?? "SCORE").toUpperCase() === "CUSTOM",
    [tournament]
  );

  const competitionModel = useMemo(() => getCompetitionModel(tournament), [tournament]);
  const stageStructureMode = useMemo(() => getStageStructureMode(tournament), [tournament]);
  const isMassStartMultiEvent = isMultiEventMode(stageStructureMode);

  const isCustomMassStartMode = useMemo(
    () => usesCustomResults && competitionModel === "MASS_START",
    [competitionModel, usesCustomResults]
  );
  const isCustomHeadToHeadMode = useMemo(
    () => usesCustomResults && competitionModel !== "MASS_START",
    [competitionModel, usesCustomResults]
  );

  const customResultConfig = useMemo(() => getResultConfig(tournament), [tournament]);

  const customDisciplineLabel = useMemo(() => {
    const customName = String((tournament as any)?.custom_discipline_name ?? "").trim();
    return customName || "Dyscyplina niestandardowa";
  }, [tournament]);

  const hasGroupStage = useMemo(
    () => matches.some((m) => String((m as MatchDTO).stage_type ?? "").toUpperCase() === "GROUP"),
    [matches]
  );

  const hasKnockoutStage = useMemo(
    () => matches.some((m) => String((m as MatchDTO).stage_type ?? "").toUpperCase() === "KNOCKOUT"),
    [matches]
  );

  const groupsFinished = useMemo(() => {
    const groupMatches = matches.filter((m) => String((m as MatchDTO).stage_type ?? "").toUpperCase() === "GROUP");
    const relevant = groupMatches.filter((m) => !isByeMatch(m));
    if (!relevant.length) return false;
    return relevant.every((m) => String(m.status ?? "") === "FINISHED");
  }, [matches]);

  const showAdvanceFromGroups = useMemo(() => {
    const fmt = String(tournamentFormat ?? "").toUpperCase();
    const isMixed = fmt === "MIXED";
    return canManageTournament && (isMixed || hasGroupStage) && !hasKnockoutStage;
  }, [canManageTournament, hasGroupStage, hasKnockoutStage, tournamentFormat]);

  const onAdvanceFromGroups = useCallback(async () => {
    if (!tournamentId) return;

    setAdvanceBusy(true);
    try {
      const res = await apiFetch(withDivisionQuery(`/api/tournaments/${tournamentId}/advance-from-groups/`, effectiveDivisionId), {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(String(data?.detail || "Nie udało się wygenerować następnego etapu."));
      }

      pushToast("Wygenerowano fazę pucharową.", "success");
      await reloadAll();
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "Wystąpił błąd podczas generowania etapu.", "error");
    } finally {
      setAdvanceBusy(false);
    }
  }, [effectiveDivisionId, pushToast, reloadAll, tournamentId]);

  const advanceMassStartStage = useCallback(async () => {
    if (!tournamentId) return false;

    setAdvanceBusy(true);
    try {
      const res = await apiFetch(withDivisionQuery(`/api/tournaments/${tournamentId}/advance-mass-start-stage/`, effectiveDivisionId), {
        method: "POST",
        toastOnError: false,
      } as any);

      const data = (await res.json().catch(() => null)) as
        | AdvanceMassStartStageResponseDTO
        | { detail?: string }
        | null;

      if (!res.ok) {
        throw new Error(String(data?.detail || "Nie udało się wygenerować kolejnego etapu."));
      }

      pushToast(data?.detail || "Wygenerowano kolejny etap.", "success");
      return true;
    } catch (e) {
      pushToast(
        e instanceof Error ? e.message : "Wystąpił błąd podczas generowania kolejnego etapu.",
        "error"
      );
      return false;
    } finally {
      setAdvanceBusy(false);
    }
  }, [effectiveDivisionId, pushToast, tournamentId]);

  const stageAdvanceCard = useMemo(() => {
    if (!showAdvanceFromGroups) return null;
    const disabled = advanceBusy || !groupsFinished;

    return (
      <Card className="relative mb-6 overflow-hidden p-5 sm:p-6">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-20 left-1/2 h-44 w-[28rem] -translate-x-1/2 rounded-full bg-indigo-500/15 blur-3xl" />
          <div className="absolute -bottom-20 left-1/2 h-44 w-[28rem] -translate-x-1/2 rounded-full bg-sky-500/10 blur-3xl" />
        </div>

        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
                <Brackets className="h-4 w-4 text-slate-200" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-white">Następny etap</div>
                <div className="mt-1 text-xs text-slate-400">
                  Faza pucharowa po grupach - generowanie na podstawie tabel.
                </div>
              </div>
            </div>

            {!groupsFinished ? (
              <div className="mt-3 text-xs text-amber-200">
                Aby wygenerować fazę pucharową, zakończ wszystkie mecze w fazie grupowej.
              </div>
            ) : null}
          </div>

          <Button
            variant="secondary"
            onClick={onAdvanceFromGroups}
            disabled={disabled}
            leftIcon={<Brackets className="h-4 w-4" />}
            className="w-full sm:w-auto"
          >
            {advanceBusy ? "Generowanie..." : "Wygeneruj fazę pucharową"}
          </Button>
        </div>
      </Card>
    );
  }, [advanceBusy, groupsFinished, onAdvanceFromGroups, showAdvanceFromGroups]);

  const customModeCard = useMemo(() => {
    if (!usesCustomResults) return null;

    const valueKind = String(customResultConfig.value_kind ?? "").toUpperCase();
    const isTime = valueKind === "TIME";
    const isMultiEvent = isCustomMassStartMode && isMassStartMultiEvent;
    const resultScopeLabel = isMultiEvent ? "konkurencji" : isCustomMassStartMode ? "etapowy" : "meczowy";
    const modeTitle = isMultiEvent
      ? "Tryb wielu konkurencji"
      : isCustomMassStartMode
        ? "Tryb rezultatów etapowych"
        : "Tryb wyników niestandardowych dla meczów";
    const modeBadge = isCustomMassStartMode
      ? isTime
        ? `Wynik ${resultScopeLabel} - czasowy`
        : valueKind === "PLACE"
          ? `Wynik ${resultScopeLabel} - miejsca`
          : `Wynik ${resultScopeLabel} - liczbowy`
      : isTime
        ? "Wynik meczowy - czasowy"
        : "Wynik meczowy - liczbowy";

    return (
      <Card className="mb-6 p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
                {isTime ? (
                  <TimerReset className="h-4 w-4 text-slate-200" />
                ) : (
                  <Gauge className="h-4 w-4 text-slate-200" />
                )}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-white">{modeTitle}</div>
                <div className="mt-1 text-xs text-slate-400">{customDisciplineLabel}</div>
              </div>
            </div>

            <div className="mt-3 text-sm text-slate-300">{getCustomResultHint(customResultConfig)}</div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-300">
            {modeBadge}
          </div>
        </div>
      </Card>
    );
  }, [customDisciplineLabel, customResultConfig, isCustomMassStartMode, isMassStartMultiEvent, usesCustomResults]);

  const pageTitle = isCustomMassStartMode && isMassStartMultiEvent
    ? "Rezultaty konkurencji"
    : isCustomHeadToHeadMode
      ? "Wyniki"
      : usesCustomResults
        ? "Rezultaty"
        : "Wyniki";
  const pageDescription = isCustomMassStartMode
    ? isMassStartMultiEvent
      ? "Wprowadzaj rezultaty uczestników w kilku konkurencjach bez wymuszania przechodzenia etap po etapie."
      : "Wprowadzaj rezultaty uczestników i kontroluj postęp rywalizacji etapowej."
    : isCustomHeadToHeadMode
      ? "Wprowadzaj wyniki meczów i korzystaj z trybu LIVE również dla dyscyplin niestandardowych z pojedynkami."
      : "Wprowadzaj wyniki meczów i kontroluj postęp rozgrywek.";

  const onDraftChange = useCallback((key: string, value: string) => {
    setDrafts((prev) => ({ ...prev, [key]: value }));
  }, []);

  const onStatusDraftChange = useCallback((key: string, value: MassStartResultStatus) => {
    setStatusDrafts((prev) => ({ ...prev, [key]: value }));

    if (value !== "OK") {
      setDrafts((prev) => ({ ...prev, [key]: "" }));
    }
  }, []);

  const onSaveMassStartEntry = useCallback(
    async (stage: MassStartStageDTO, groupId: number | null, entry: MassStartEntryDTO) => {
      if (!tournamentId) return;

      const stageStatus = String(stage.stage_status ?? "").toUpperCase();
      // W trybie wielu konkurencji zapis nie jest blokowany przez kolejność etapów redukcyjnych.
      if (!isMassStartMultiEvent && stageStatus && stageStatus !== "OPEN") {
        pushToast("Ten etap nie jest otwarty do zapisu rezultatów.", "info");
        return;
      }

      const requests: StageMassStartResultWriteDTO[] = [];
      for (const round of entry.rounds) {
        const key = draftKey(stage.stage_id, groupId, entry.team_id, round.round_number);
        const resultStatus = statusDrafts[key] ?? round.result_status ?? "OK";
        const rawValue = (drafts[key] ?? "").trim();

        if (resultStatus === "OK" && !rawValue) continue;

        const payload: StageMassStartResultWriteDTO = {
          stage_id: stage.stage_id,
          group_id: groupId,
          team_id: entry.team_id,
          round_number: round.round_number,
          result_status: resultStatus,
        };

        if (resultStatus === "OK") {
          const valueKind = String(customResultConfig.value_kind ?? "NUMBER").toUpperCase();
          if (valueKind === "TIME") payload.time_ms = Number(rawValue);
          else if (valueKind === "PLACE") payload.place_value = Number(rawValue);
          else payload.numeric_value = rawValue;
        }

        requests.push(payload);
      }

      if (!requests.length) {
        pushToast("Brak zmian do zapisania.", "info");
        return;
      }

      setSavingRows((prev) => {
        const next = { ...prev };
        for (const item of requests) {
          next[draftKey(item.stage_id, item.group_id ?? null, item.team_id, item.round_number)] = true;
        }
        return next;
      });

      try {
        let latestPayload: TournamentMassStartResultsResponseDTO | null = null;

        for (const payload of requests) {
          const res = await apiFetch(withDivisionQuery(`/api/tournaments/${tournamentId}/mass-start-results/`, effectiveDivisionId), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            toastOnError: false,
          } as any);

          const data = (await res.json().catch(() => null)) as MassStartResultSaveResponseDTO | null;
          if (!res.ok) {
            const fallbackMessage = isMassStartMultiEvent
              ? "Nie udało się zapisać wyniku konkurencji."
              : "Nie udało się zapisać wyniku etapowego.";
            throw new Error(String(data?.detail || fallbackMessage));
          }

          if (data?.payload) {
            latestPayload = data.payload;
          }
        }

        pushToast(`Zapisano rezultat dla: ${entry.team_name}.`, "saved");

        const autoAdvanceStage = !isMassStartMultiEvent && latestPayload
          ? getAdvanceCandidateStage(latestPayload.stages)
          : null;
        if (canManageTournament && autoAdvanceStage?.stage_id === stage.stage_id) {
          await advanceMassStartStage();
        }

        await reloadAll();
      } catch (e) {
        const fallbackMessage = isMassStartMultiEvent
          ? "Nie udało się zapisać rezultatu konkurencji."
          : "Nie udało się zapisać rezultatu etapowego.";
        pushToast(e instanceof Error ? e.message : fallbackMessage, "error");
      } finally {
        setSavingRows((prev) => {
          const next = { ...prev };
          for (const item of requests) {
            delete next[draftKey(item.stage_id, item.group_id ?? null, item.team_id, item.round_number)];
          }
          return next;
        });
      }
    },
    [advanceMassStartStage, canManageTournament, customResultConfig.value_kind, drafts, effectiveDivisionId, isMassStartMultiEvent, pushToast, reloadAll, statusDrafts, tournamentId]
  );

  const renderMatch = useCallback(
    (m: MatchLike) => {
      const d = (m as MatchDTO).scheduled_date ?? null;
      const t = (m as MatchDTO).scheduled_time ?? null;
      const dateLabel = d ? formatDatePL(String(d)) : null;
      const timeLabel = t ? String(t).slice(0, 5) : null;

      return (
        <div key={m.id} className="space-y-2">
          {dateLabel || timeLabel ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
              {dateLabel ? (
                <span className="inline-flex items-center gap-2">
                  <Calendar className="h-3.5 w-3.5" />
                  {dateLabel}
                </span>
              ) : null}
              {timeLabel ? (
                <span className="inline-flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5" />
                  {timeLabel}
                </span>
              ) : null}
            </div>
          ) : null}

          <MatchRow
            tournamentId={tournamentId}
            tournament={tournament as TournamentDTO}
            match={m as unknown as MatchDTO}
            onReload={reloadAll}
            onToast={(text, kind) => pushToast(text, (kind ?? "info") as ToastKind)}
          />
        </div>
      );
    },
    [pushToast, reloadAll, tournament, tournamentId]
  );
  if (!tournamentId) {
    return (
      <div className="w-full">
        <Card className="p-6 text-slate-200">Brak ID turnieju.</Card>
      </div>
    );
  }

  if (!loading && !tournament) {
    return (
      <div className="w-full">
        <Card className="p-6 text-slate-200">Nie znaleziono turnieju.</Card>
      </div>
    );
  }

  if (isCustomMassStartMode) {
    return (
      <MassStartResultsView
        loading={loading}
        pageTitle={pageTitle}
        pageDescription={pageDescription}
        customModeCard={customModeCard}
        customResultConfig={customResultConfig}
        stageStructureMode={stageStructureMode}
        massStartData={massStartData}
        canManageTournament={canManageTournament}
        drafts={drafts}
        statusDrafts={statusDrafts}
        savingRows={savingRows}
        onDraftChange={onDraftChange}
        onStatusDraftChange={onStatusDraftChange}
        onSaveEntry={onSaveMassStartEntry}
      />
    );
  }

  return (
    <TournamentMatchesScaffold
      tournamentId={tournamentId}
      tournamentFormat={tournamentFormat}
      title={pageTitle}
      description={pageDescription}
      loading={loading}
      matches={matches}
      headerSlot={
        <>
          {customModeCard}
          {stageAdvanceCard}
        </>
      }
      storageScope="results"
      renderMatch={renderMatch}
    />
  );
}

