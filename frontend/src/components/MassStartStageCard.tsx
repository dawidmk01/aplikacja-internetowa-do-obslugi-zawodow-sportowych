// frontend/src/components/MassStartStageCard.tsx
// Komponent renderuje pojedynczy etap lub konkurencję MASS_START w widoku wprowadzania rezultatów.

import { useMemo } from "react";

import { Lock, Save, Trophy } from "lucide-react";

import { cn } from "../lib/cn";

import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Input } from "../ui/Input";

import type {
  MassStartEntryDTO,
  MassStartResultStatus,
  MassStartStageDTO,
  TournamentResultConfigDTO,
} from "../types/results";

type StageStructureMode = "REDUCTION" | "MULTI_EVENT";
type ValueInputKind = "text" | "number";
type ValueInputMode = "numeric" | "decimal";

type Props = {
  stage: MassStartStageDTO;
  customResultConfig: TournamentResultConfigDTO;
  stageStructureMode: StageStructureMode;
  canManageTournament: boolean;
  drafts: Record<string, string>;
  statusDrafts: Record<string, MassStartResultStatus>;
  savingRows: Record<string, boolean>;
  onDraftChange: (key: string, value: string) => void;
  onStatusDraftChange: (key: string, value: MassStartResultStatus) => void;
  onSaveEntry: (
    stage: MassStartStageDTO,
    groupId: number | null,
    entry: MassStartEntryDTO
  ) => Promise<void>;
};

const RESULT_STATUS_OPTIONS: Array<{ value: MassStartResultStatus; label: string }> = [
  { value: "OK", label: "Wynik" },
  { value: "DNS", label: "DNS - nie wystartował" },
  { value: "DNF", label: "DNF - nie ukończył" },
  { value: "DSQ", label: "DSQ - dyskwalifikacja" },
];

// ===== Identyfikacja wpisów wynikowych =====

function draftKey(stageId: number, groupId: number | null, teamId: number, roundNumber: number) {
  return `${stageId}:${groupId ?? 0}:${teamId}:${roundNumber}`;
}

// ===== Prezentacja trybu etapów i konkurencji =====

function isMultiEventMode(stageStructureMode: StageStructureMode) {
  return stageStructureMode === "MULTI_EVENT";
}

function getRoundLabel(stageStructureMode: StageStructureMode) {
  return isMultiEventMode(stageStructureMode) ? "Próba" : "Runda";
}

function getAggregateLabel(stageStructureMode: StageStructureMode) {
  return isMultiEventMode(stageStructureMode) ? "Wynik konkurencji" : "Suma / wynik";
}

function stageSummary(stage: MassStartStageDTO, stageStructureMode: StageStructureMode) {
  const roundsLabel = isMultiEventMode(stageStructureMode) ? "próby" : "rundy";
  const parts = [
    `grupy: ${stage.groups_count}`,
    `uczestnicy: ${stage.participants_count ?? "-"}`,
    `${roundsLabel}: ${stage.rounds_count}`,
  ];

  if (!isMultiEventMode(stageStructureMode)) {
    parts.splice(2, 0, `awans: ${stage.advance_count ?? "-"}`);
  }

  return parts.join(" • ");
}

function getStageStatusLabel(stage: MassStartStageDTO, stageStructureMode: StageStructureMode) {
  const status = String(stage.stage_status ?? "").toUpperCase();

  if (isMultiEventMode(stageStructureMode)) {
    if (status === "CLOSED") return "Zamknięta";
    if (status === "OPEN") return "Otwarta";
    return "Dostępna";
  }

  if (status === "CLOSED") return "Zamknięty";
  if (status === "PLANNED") return "Zaplanowany";
  return "Otwarty";
}

// ===== Dostępność edycji rezultatów =====

function isStageEditable(
  stage: MassStartStageDTO,
  canManageTournament: boolean,
  stageStructureMode: StageStructureMode
) {
  if (!canManageTournament) return false;

  const status = String(stage.stage_status ?? "").toUpperCase();

  if (isMultiEventMode(stageStructureMode)) {
    // Konkurencje w wieloboju nie są kolejnymi szczeblami awansu, dlatego status PLANNED nie blokuje edycji wyników.
    return status !== "CLOSED";
  }

  return status === "" || status === "OPEN";
}

function getStageTone(stage: MassStartStageDTO, stageStructureMode: StageStructureMode) {
  const status = String(stage.stage_status ?? "").toUpperCase();
  const editableLike = isMultiEventMode(stageStructureMode) && status !== "CLOSED";

  if (status === "OPEN" || editableLike) {
    return {
      card: "border-emerald-400/20 bg-emerald-500/[0.05]",
      badge: "border-emerald-400/30 bg-emerald-500/[0.10] text-emerald-100",
      dot: "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.5)]",
    };
  }

  if (status === "CLOSED") {
    return {
      card: "border-sky-400/15 bg-sky-500/[0.04]",
      badge: "border-sky-400/25 bg-sky-500/[0.08] text-sky-100",
      dot: "bg-sky-300 shadow-[0_0_10px_rgba(125,211,252,0.35)]",
    };
  }

  return {
    card: "border-white/10 bg-white/[0.03]",
    badge: "border-white/15 bg-white/[0.06] text-slate-100",
    dot: "bg-white/60",
  };
}

function getLockedMessage(stage: MassStartStageDTO, stageStructureMode: StageStructureMode) {
  const status = String(stage.stage_status ?? "").toUpperCase();

  if (isMultiEventMode(stageStructureMode)) {
    if (status === "CLOSED") {
      return "Ta konkurencja jest zamknięta. Wyniki są dostępne tylko do podglądu.";
    }

    return "Ta konkurencja nie jest obecnie otwarta do wprowadzania rezultatów.";
  }

  if (status === "CLOSED") {
    return "Ten etap jest zamknięty. Wyniki są dostępne tylko do podglądu.";
  }

  return "Ten etap nie jest obecnie otwarty do wprowadzania rezultatów.";
}

// ===== Normalizacja wartości wyników =====

function getValueMeta(config: TournamentResultConfigDTO) {
  const valueKind = String(config.value_kind ?? "NUMBER").toUpperCase();
  const unitLabel = String(config.unit_label ?? config.unit ?? "").trim();

  const inputType: ValueInputKind = valueKind === "TIME" ? "number" : "text";
  const inputMode: ValueInputMode = valueKind === "TIME" ? "numeric" : "decimal";

  const placeholder =
    valueKind === "TIME"
      ? "ms"
      : valueKind === "PLACE"
        ? "miejsce"
        : unitLabel
          ? `wynik (${unitLabel})`
          : "wynik";

  return {
    valueKind,
    unitLabel,
    inputType,
    inputMode,
    placeholder,
  };
}

function getEntryBusy(
  savingRows: Record<string, boolean>,
  stageId: number,
  groupId: number | null,
  teamId: number
) {
  return Object.keys(savingRows).some(
    (key) => key.startsWith(`${stageId}:${groupId ?? 0}:${teamId}:`) && savingRows[key]
  );
}

function hasAnySavedResult(entry: MassStartEntryDTO) {
  return entry.rounds.some(
    (round) =>
      (round.result_status != null && round.result_status !== "OK") ||
      round.display_value ||
      round.numeric_value != null ||
      round.time_ms != null ||
      round.place_value != null
  );
}

function getEntryTone(stageEditable: boolean, entry: MassStartEntryDTO, rowBusy: boolean) {
  if (rowBusy) {
    return {
      wrapper: "border-amber-400/20 bg-amber-500/[0.05]",
      chip: "border-amber-400/25 bg-amber-500/[0.10] text-amber-100",
      dot: "bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,0.35)]",
    };
  }

  if (!stageEditable) {
    return {
      wrapper: "border-white/10 bg-white/[0.03]",
      chip: "border-white/10 bg-white/[0.05] text-slate-300",
      dot: "bg-white/40",
    };
  }

  if (hasAnySavedResult(entry)) {
    return {
      wrapper: "border-emerald-400/15 bg-emerald-500/[0.04]",
      chip: "border-emerald-400/25 bg-emerald-500/[0.10] text-emerald-100",
      dot: "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.35)]",
    };
  }

  return {
    wrapper: "border-white/10 bg-white/[0.03]",
    chip: "border-white/10 bg-white/[0.05] text-slate-300",
    dot: "bg-white/40",
  };
}

function getStatusDisplay(resultStatus?: MassStartResultStatus | null) {
  if (!resultStatus || resultStatus === "OK") return "";
  return RESULT_STATUS_OPTIONS.find((option) => option.value === resultStatus)?.label ?? resultStatus;
}

function getRoundSavedLabel(
  round: MassStartEntryDTO["rounds"][number],
  valueKind: string,
  unitLabel: string
) {
  const statusDisplay = getStatusDisplay(round.result_status);
  if (statusDisplay) return `Zapisano: ${statusDisplay}`;
  if (round.display_value) return `Zapisano: ${round.display_value}`;
  if (valueKind === "TIME") return "Brak czasu";
  if (valueKind === "PLACE") return "Brak miejsca";
  return unitLabel ? `Brak wyniku (${unitLabel})` : "Brak wyniku";
}

// ===== Karta rezultatów MASS_START =====

export default function MassStartStageCard({
  stage,
  customResultConfig,
  stageStructureMode,
  canManageTournament,
  drafts,
  statusDrafts,
  savingRows,
  onDraftChange,
  onStatusDraftChange,
  onSaveEntry,
}: Props) {
  const stageEditable = isStageEditable(stage, canManageTournament, stageStructureMode);
  const stageStatusLabel = getStageStatusLabel(stage, stageStructureMode);
  const tone = getStageTone(stage, stageStructureMode);
  const roundLabel = getRoundLabel(stageStructureMode);
  const aggregateLabel = getAggregateLabel(stageStructureMode);

  const { valueKind, unitLabel, inputType, inputMode, placeholder } =
    getValueMeta(customResultConfig);

  const inputClass = cn(
    "h-9 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm font-semibold text-white placeholder:text-slate-500",
    "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/10",
    "disabled:opacity-60",
    "[color-scheme:dark]"
  );

  const selectClass = cn(
    "h-9 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 text-sm font-semibold text-white",
    "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/10",
    "disabled:opacity-60",
    "[color-scheme:dark]"
  );

  const saveVariant = useMemo(() => {
    return stageEditable ? "primary" : "secondary";
  }, [stageEditable]);

  return (
    <Card className={cn("mb-4 border p-4 sm:p-5", tone.card)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-lg font-extrabold text-white">{stage.stage_name}</div>
          <div className="mt-1 text-xs text-slate-400">
            {stageSummary(stage, stageStructureMode)}
          </div>
        </div>

        <div
          className={cn(
            "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs",
            tone.badge
          )}
        >
          <span className={cn("h-2 w-2 rounded-full", tone.dot)} />
          {stageStatusLabel}
        </div>
      </div>

      {!stageEditable ? (
        <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          {getLockedMessage(stage, stageStructureMode)}
        </div>
      ) : null}

      <div className="mt-4 space-y-4">
        {stage.groups.map((group) => (
          <div
            key={group.group_id}
            className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm font-extrabold text-white">{group.group_name}</div>
              <div className="text-xs text-slate-400">{group.entries.length} uczestników</div>
            </div>

            {group.entries.length === 0 ? (
              <div className="mt-4 text-sm text-slate-300">Brak uczestników w tej grupie.</div>
            ) : (
              <div className="mt-4 space-y-3">
                {group.entries.map((entry) => {
                  const rowBusy = getEntryBusy(
                    savingRows,
                    stage.stage_id,
                    group.group_id,
                    entry.team_id
                  );

                  const entryTone = getEntryTone(stageEditable, entry, rowBusy);

                  return (
                    <div
                      key={entry.team_id}
                      className={cn(
                        "rounded-2xl border p-3 transition-colors",
                        entryTone.wrapper
                      )}
                    >
                      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                        <div className="min-w-0 xl:max-w-[17rem]">
                          <div className="break-words text-sm font-semibold text-white">
                            {entry.team_name}
                          </div>

                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                            <span className="inline-flex items-center gap-1.5">
                              <Trophy className="h-3.5 w-3.5" />
                              Miejsce: {entry.rank ?? "-"}
                            </span>
                            <span>
                              {aggregateLabel}: {entry.aggregate_display ?? "-"}
                            </span>
                          </div>
                        </div>

                        <div className="grid min-w-0 flex-1 gap-3 md:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(170px,1fr))]">
                          {entry.rounds.map((round) => {
                            const key = draftKey(
                              stage.stage_id,
                              group.group_id,
                              entry.team_id,
                              round.round_number
                            );
                            const value = drafts[key] ?? "";
                            const selectedStatus = statusDrafts[key] ?? round.result_status ?? "OK";
                            const valueInputDisabled = !stageEditable || rowBusy || selectedStatus !== "OK";

                            return (
                              <label key={key} className="grid gap-1 text-xs text-slate-300">
                                {roundLabel} {round.round_number}
                                <select
                                  value={selectedStatus}
                                  onChange={(event) =>
                                    onStatusDraftChange(key, event.target.value as MassStartResultStatus)
                                  }
                                  disabled={!stageEditable || rowBusy}
                                  className={selectClass}
                                >
                                  {RESULT_STATUS_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                                <Input
                                  value={value}
                                  onChange={(e) => onDraftChange(key, e.target.value)}
                                  type={inputType}
                                  inputMode={inputMode}
                                  placeholder={placeholder}
                                  disabled={valueInputDisabled}
                                  className={inputClass}
                                />
                                <span className="text-[11px] text-slate-500">
                                  {getRoundSavedLabel(round, valueKind, unitLabel)}
                                </span>
                              </label>
                            );
                          })}
                        </div>

                        <div className="flex items-start xl:shrink-0">
                          <div className="flex flex-col items-stretch gap-2 xl:min-w-[140px]">
                            <div
                              className={cn(
                                "inline-flex items-center justify-center gap-2 rounded-full border px-3 py-1 text-xs",
                                entryTone.chip
                              )}
                            >
                              <span className={cn("h-2 w-2 rounded-full", entryTone.dot)} />
                              {rowBusy
                                ? "Zapisywanie"
                                : stageEditable
                                  ? hasAnySavedResult(entry)
                                    ? "Wynik zapisany"
                                    : "Brak zapisu"
                                  : "Podgląd"}
                            </div>

                            <Button
                              type="button"
                              variant={saveVariant}
                              leftIcon={
                                stageEditable ? (
                                  <Save className="h-4 w-4" />
                                ) : (
                                  <Lock className="h-4 w-4" />
                                )
                              }
                              onClick={() => void onSaveEntry(stage, group.group_id, entry)}
                              disabled={!stageEditable || rowBusy}
                              className="w-full"
                            >
                              {rowBusy ? "Zapisywanie..." : stageEditable ? "Zapisz" : "Zablokowane"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
