// frontend/src/pages/TournamentResults.tsx
// Plik renderuje widok wyników turnieju i rozdziela prezentację meczów od rezultatów etapowych MASS_START.

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { Brackets, Calendar, Clock, Gauge, TimerReset } from "lucide-react";

import { apiFetch } from "../api";
import { useTournamentWs } from "../hooks/useTournamentWs";
import MatchRow from "../components/MatchRow";
import MassStartStageCard from "../components/MassStartStageCard";

import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { toast } from "../ui/Toast";

import type {
  AdvanceMassStartStageResponseDTO,
  MatchDTO,
  TournamentDTO,
  TournamentMassStartResultsResponseDTO,
  TournamentResultConfigDTO,
  MassStartEntryDTO,
  MassStartStageDTO,
  StageMassStartResultWriteDTO,
} from "../types/results";

import {
  formatDatePL,
  isByeMatch,
  TournamentMatchesScaffold,
  type MatchLikeBase,
} from "./_shared/TournamentMatchesScaffold";

type ToastKind = "saved" | "success" | "error" | "info";
type MatchLike = MatchDTO & MatchLikeBase;

type MassStartResultSaveResponseDTO = {
  detail?: string;
  payload?: TournamentMassStartResultsResponseDTO | null;
};

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

function getCustomResultHint(config: TournamentResultConfigDTO): string {
  const valueKind = String(config.value_kind ?? "").toUpperCase();

  if (valueKind === "TIME") {
    const format = config.time_format ?? "MM:SS.hh";
    return `Wynik wpisywany jako czas. Format prezentacji: ${format}.`;
  }

  if (valueKind === "PLACE") {
    return "Wynik wpisywany jako miejsce w klasyfikacji. Niższa wartość oznacza lepszy rezultat.";
  }

  const unit = String(config.unit_label ?? config.unit ?? "").trim();
  const better = String(config.better_result ?? "HIGHER").toUpperCase();
  const decimals = typeof config.decimal_places === "number" ? config.decimal_places : 0;
  const betterLabel = better === "LOWER" ? "niższy lepszy" : "wyższy lepszy";
  const unitLabel = unit ? ` Jednostka: ${unit}.` : "";

  return `Wynik wpisywany jako liczba, dokładność: ${decimals} miejsce po przecinku.${unitLabel} Zasada rankingu: ${betterLabel}.`;
}

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

  const ordered = [...stages].sort((a, b) => a.stage_order - b.stage_order);

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

function getVisibleMassStartStages(stages: MassStartStageDTO[] | undefined | null) {
  if (!Array.isArray(stages)) return [];
  return [...stages]
    .filter((stage) => !isStagePlanned(stage))
    .sort((a, b) => a.stage_order - b.stage_order);
}

function MassStartResultsView({
  loading,
  pageTitle,
  pageDescription,
  customModeCard,
  customResultConfig,
  massStartData,
  canManageTournament,
  drafts,
  savingRows,
  onDraftChange,
  onSaveEntry,
}: {
  loading: boolean;
  pageTitle: string;
  pageDescription: string;
  customModeCard: ReactNode;
  customResultConfig: TournamentResultConfigDTO;
  massStartData: TournamentMassStartResultsResponseDTO | null;
  canManageTournament: boolean;
  drafts: Record<string, string>;
  savingRows: Record<string, boolean>;
  onDraftChange: (key: string, value: string) => void;
  onSaveEntry: (stage: MassStartStageDTO, groupId: number | null, entry: MassStartEntryDTO) => Promise<void>;
}) {
  const visibleStages = useMemo(
    () => getVisibleMassStartStages(massStartData?.stages),
    [massStartData]
  );

  return (
    <div className="w-full py-6">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
        <div className="mb-6">
          <div className="text-2xl font-extrabold text-white">{pageTitle}</div>
          <div className="mt-1 text-sm text-slate-300">{pageDescription}</div>
        </div>

        {customModeCard}

        {loading ? (
          <Card className="p-6 text-slate-200">Ładowanie rezultatów etapowych...</Card>
        ) : !massStartData || visibleStages.length === 0 ? (
          <Card className="p-6 text-slate-200">Brak etapów do wyświetlenia.</Card>
        ) : (
          <div className="space-y-6">
            {visibleStages.map((stage) => (
              <MassStartStageCard
                key={stage.stage_id}
                stage={stage}
                customResultConfig={customResultConfig}
                canManageTournament={canManageTournament}
                drafts={drafts}
                savingRows={savingRows}
                onDraftChange={onDraftChange}
                onSaveEntry={onSaveEntry}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function TournamentResults() {
  const { id } = useParams<{ id: string }>();
  const tournamentId = id ?? "";

  const mountedRef = useRef(true);

  const [tournament, setTournament] = useState<TournamentDTO | null>(null);
  const [matches, setMatches] = useState<MatchLike[]>([]);
  const [massStartData, setMassStartData] = useState<TournamentMassStartResultsResponseDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
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
      const tRes = await apiFetch(`/api/tournaments/${tournamentId}/`);
      if (!tRes.ok) throw new Error("Nie udało się pobrać danych turnieju.");

      const tData = (await tRes.json()) as TournamentDTO;
      if (!mountedRef.current) return;
      setTournament(tData);

      const competitionModel = getCompetitionModel(tData);
      const usesCustomResults = String(tData.result_mode ?? "SCORE").toUpperCase() === "CUSTOM";
      const isMassStart = usesCustomResults && competitionModel === "MASS_START";

      if (isMassStart) {
        const res = await apiFetch(`/api/tournaments/${tournamentId}/mass-start-results/`, {
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
        const mRes = await apiFetch(`/api/tournaments/${tournamentId}/matches/`);
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
  }, [pushToast, tournamentId]);

  useEffect(() => {
    if (!tournamentId) return;
    void reloadAll();
  }, [reloadAll, tournamentId]);

  useEffect(() => {
    if (!massStartData) return;

    const nextDrafts: Record<string, string> = {};
    for (const stage of massStartData.stages) {
      for (const group of stage.groups) {
        for (const entry of group.entries) {
          for (const round of entry.rounds) {
            const key = draftKey(stage.stage_id, group.group_id, entry.team_id, round.round_number);
            if (round.numeric_value != null) nextDrafts[key] = String(round.numeric_value);
            else if (round.time_ms != null) nextDrafts[key] = String(round.time_ms);
            else if (round.place_value != null) nextDrafts[key] = String(round.place_value);
            else nextDrafts[key] = "";
          }
        }
      }
    }
    setDrafts(nextDrafts);
  }, [massStartData]);

  useTournamentWs({
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

  const tournamentFormat = useMemo(() => String(tournament?.tournament_format ?? ""), [tournament]);

  const canManageTournament = useMemo(() => {
    const role = String(tournament?.my_role ?? "");
    return role === "ORGANIZER" || role === "ASSISTANT";
  }, [tournament]);

  const usesCustomResults = useMemo(
    () => String(tournament?.result_mode ?? "SCORE").toUpperCase() === "CUSTOM",
    [tournament]
  );

  const competitionModel = useMemo(() => getCompetitionModel(tournament), [tournament]);
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
    const customName = String(tournament?.custom_discipline_name ?? "").trim();
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
      const res = await apiFetch(`/api/tournaments/${tournamentId}/advance-from-groups/`, {
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
  }, [pushToast, reloadAll, tournamentId]);

  const advanceMassStartStage = useCallback(async () => {
    if (!tournamentId) return false;

    setAdvanceBusy(true);
    try {
      const res = await apiFetch(`/api/tournaments/${tournamentId}/advance-mass-start-stage/`, {
        method: "POST",
        toastOnError: false,
      } as any);

      const data = (await res.json().catch(() => null)) as
        | AdvanceMassStartStageResponseDTO
        | { detail?: string }
        | null;

      if (!res.ok) {
        throw new Error(String(data?.detail || "Nie udało się wygenerować kolejnego etapu MASS_START."));
      }

      pushToast(data?.detail || "Wygenerowano kolejny etap MASS_START.", "success");
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
  }, [pushToast, tournamentId]);

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
    const modeTitle = isCustomMassStartMode
      ? "Tryb rezultatów etapowych"
      : "Tryb wyników niestandardowych dla meczów";
    const modeBadge = isCustomMassStartMode
      ? isTime
        ? "Wynik etapowy - czasowy"
        : valueKind === "PLACE"
          ? "Wynik etapowy - miejsca"
          : "Wynik etapowy - liczbowy"
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
  }, [customDisciplineLabel, customResultConfig, isCustomMassStartMode, usesCustomResults]);

  const pageTitle = isCustomHeadToHeadMode ? "Wyniki" : usesCustomResults ? "Rezultaty" : "Wyniki";
  const pageDescription = isCustomMassStartMode
    ? "Wprowadzaj rezultaty uczestników i kontroluj postęp rywalizacji etapowej."
    : isCustomHeadToHeadMode
      ? "Wprowadzaj wyniki meczów i korzystaj z trybu LIVE również dla dyscyplin niestandardowych z pojedynkami."
      : "Wprowadzaj wyniki meczów i kontroluj postęp rozgrywek.";

  const onDraftChange = useCallback((key: string, value: string) => {
    setDrafts((prev) => ({ ...prev, [key]: value }));
  }, []);

  const onSaveMassStartEntry = useCallback(
    async (stage: MassStartStageDTO, groupId: number | null, entry: MassStartEntryDTO) => {
      if (!tournamentId) return;

      const stageStatus = String(stage.stage_status ?? "").toUpperCase();
      if (stageStatus && stageStatus !== "OPEN") {
        pushToast("Ten etap nie jest otwarty do zapisu rezultatów.", "info");
        return;
      }

      const requests: StageMassStartResultWriteDTO[] = [];
      for (const round of entry.rounds) {
        const key = draftKey(stage.stage_id, groupId, entry.team_id, round.round_number);
        const rawValue = (drafts[key] ?? "").trim();
        if (!rawValue) continue;

        const payload: StageMassStartResultWriteDTO = {
          stage_id: stage.stage_id,
          group_id: groupId,
          team_id: entry.team_id,
          round_number: round.round_number,
        };

        const valueKind = String(customResultConfig.value_kind ?? "NUMBER").toUpperCase();
        if (valueKind === "TIME") payload.time_ms = Number(rawValue);
        else if (valueKind === "PLACE") payload.place_value = Number(rawValue);
        else payload.numeric_value = rawValue;

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
          const res = await apiFetch(`/api/tournaments/${tournamentId}/mass-start-results/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            toastOnError: false,
          } as any);

          const data = (await res.json().catch(() => null)) as MassStartResultSaveResponseDTO | null;
          if (!res.ok) {
            throw new Error(String(data?.detail || "Nie udało się zapisać wyniku etapowego."));
          }

          if (data?.payload) {
            latestPayload = data.payload;
          }
        }

        pushToast(`Zapisano rezultat dla: ${entry.team_name}.`, "saved");

        const autoAdvanceStage = latestPayload ? getAdvanceCandidateStage(latestPayload.stages) : null;
        if (canManageTournament && autoAdvanceStage?.stage_id === stage.stage_id) {
          await advanceMassStartStage();
        }

        await reloadAll();
      } catch (e) {
        pushToast(e instanceof Error ? e.message : "Nie udało się zapisać rezultatu etapowego.", "error");
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
    [advanceMassStartStage, canManageTournament, customResultConfig.value_kind, drafts, pushToast, reloadAll, tournamentId]
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

  if (isCustomMassStartMode) {
    return (
      <MassStartResultsView
        loading={loading}
        pageTitle={pageTitle}
        pageDescription={pageDescription}
        customModeCard={customModeCard}
        customResultConfig={customResultConfig}
        massStartData={massStartData}
        canManageTournament={canManageTournament}
        drafts={drafts}
        savingRows={savingRows}
        onDraftChange={onDraftChange}
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
