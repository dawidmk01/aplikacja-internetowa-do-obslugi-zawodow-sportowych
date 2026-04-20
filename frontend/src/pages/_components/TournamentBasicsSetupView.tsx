// frontend/src/pages/_components/TournamentBasicsSetupView.tsx
// Komponent renderuje formularz pierwszego etapu konfiguracji turnieju oraz panel podsumowania.

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  ChevronUp,
  Layers3,
} from "lucide-react";

import { cn } from "../../lib/cn";
import {
  AGGREGATION_MODE_LABELS,
  BETTER_RESULT_LABELS,
  COMPETITION_MODEL_LABELS,
  COMPETITION_TYPE_LABELS,
  DISCIPLINE_LABELS,
  HEAD_TO_HEAD_MODE_LABELS,
  RESULT_VALUE_KIND_LABELS,
  TENNIS_POINTS_MODE_LABELS,
  TIME_FORMAT_LABELS,
  TOURNAMENT_FORMAT_LABELS,
  UNIT_PRESET_LABELS,
  WRESTLING_COMPETITION_MODE_LABELS,
  WRESTLING_STYLE_LABELS,
  getLabel,
} from "../../lib/sportLabels";

import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";
import { InlineAlert } from "../../ui/InlineAlert";
import { Input } from "../../ui/Input";
import { Portal } from "../../ui/Portal";
import { Select, type SelectOption } from "../../ui/Select";
import { Textarea } from "../../ui/Textarea";
const WRESTLING_STYLE_OPTIONS = [
  { value: "FREESTYLE", label: WRESTLING_STYLE_LABELS.FREESTYLE },
  { value: "GRECO_ROMAN", label: WRESTLING_STYLE_LABELS.GRECO_ROMAN },
] as const;

const WRESTLING_COMPETITION_MODE_OPTIONS = [
  { value: "AUTO", label: WRESTLING_COMPETITION_MODE_LABELS.AUTO },
  { value: "NORDIC", label: WRESTLING_COMPETITION_MODE_LABELS.NORDIC },
  { value: "TWO_POOLS", label: WRESTLING_COMPETITION_MODE_LABELS.TWO_POOLS },
  { value: "ELIMINATION_REPECHAGE", label: WRESTLING_COMPETITION_MODE_LABELS.ELIMINATION_REPECHAGE },
] as const;


export type Discipline =
  | "football"
  | "volleyball"
  | "basketball"
  | "handball"
  | "tennis"
  | "wrestling"
  | "custom";

export type TournamentFormat = "LEAGUE" | "CUP" | "MIXED";

export type CompetitionType = "TEAM" | "INDIVIDUAL";
export type CompetitionModel = "HEAD_TO_HEAD" | "MASS_START";

export type CustomHeadToHeadMode = "POINTS_TABLE" | "MEASURED_RESULT";
export type CustomMassStartValueKind = "TIME" | "NUMBER" | "POINTS" | "PLACE";
export type CustomMeasuredValueKind = "TIME" | "NUMBER" | "PLACE";

export type CustomBetterResult = "HIGHER" | "LOWER";
export type CustomTimeFormat = "HH:MM:SS" | "MM:SS" | "MM:SS.hh" | "SS.hh";
export type CustomAggregationMode = "SUM" | "AVERAGE" | "BEST" | "LAST_ROUND";
export type CustomUnitPreset =
  | "POINTS"
  | "SECONDS"
  | "MILLISECONDS"
  | "MINUTES"
  | "METERS"
  | "CENTIMETERS"
  | "KILOGRAMS"
  | "GRAMS"
  | "REPS"
  | "PLACE"
  | "CUSTOM";

export type CustomStageConfig = {
  id: string;
  name: string;
  groupsCount: number;
  participantsCount: number | null;
  advanceCount: number | null;
  roundsCount: number;
  aggregationMode: CustomAggregationMode;
  contributesToFinalRanking: boolean;
};

export type TournamentResultConfig = {
  competition_model: CompetitionModel;

  // ===== HEAD_TO_HEAD =====
  headToHeadMode: CustomHeadToHeadMode;
  allowDraw: boolean;
  allowOvertime: boolean;
  allowShootout: boolean;

  pointsWin: number;
  pointsDraw: number;
  pointsLoss: number;
  pointsOvertimeWin: number;
  pointsOvertimeLoss: number;
  pointsShootoutWin: number;
  pointsShootoutLoss: number;

  customMatchSeriesMode?: CustomMatchSeriesMode;
  groupResolutionMode?: CustomGroupResolutionMode;
  knockoutResolutionMode?: CustomKnockoutResolutionMode;
  legsCount: number | null;
  bestOf: number | null;
  roundsCount: number;
  aggregationMode: CustomAggregationMode;

  measuredValueKind: CustomMeasuredValueKind;
  measuredUnitPreset: CustomUnitPreset;
  measuredUnitCustomLabel: string;
  measuredBetterResult: CustomBetterResult;
  measuredDecimalPlaces: number | null;
  measuredTimeFormat: CustomTimeFormat | null;
  measuredAllowTies: boolean;

  // ===== MASS_START =====
  massStartValueKind: CustomMassStartValueKind;
  massStartUnitPreset: CustomUnitPreset;
  massStartUnitCustomLabel: string;
  massStartBetterResult: CustomBetterResult;
  massStartDecimalPlaces: number | null;
  massStartTimeFormat: CustomTimeFormat | null;
  massStartAllowTies: boolean;
  massStartRoundsCount: number;
  massStartAggregationMode: CustomAggregationMode;
  stages: CustomStageConfig[];
};

export type HandballTableDrawMode = "ALLOW_DRAW" | "PENALTIES" | "OVERTIME_PENALTIES";
export type HandballKnockoutTiebreak = "OVERTIME_PENALTIES" | "PENALTIES";
export type HandballPointsMode = "2_1_0" | "3_1_0" | "3_2_1_0";
export type BasketballResolutionMode = "OVERTIME_ONLY";
export type WrestlingStyle = "FREESTYLE" | "GRECO_ROMAN";
export type WrestlingCompetitionMode = "AUTO" | "NORDIC" | "TWO_POOLS" | "ELIMINATION_REPECHAGE";

export type TennisBestOf = 3 | 5;
export type TennisPointsMode = "NONE" | "PLT";

export type MatchesPreview = {
  total: number;
  groupTotal: number;
  koTotal: number;
  groups: number;
  advancing: number;
};

export type StructureDivisionItem = {
  id: number;
  name: string;
  order: number;
  isDefault?: boolean;
  isActive?: boolean;
  statusLabel?: string;
};

type ThirdPlaceSelectValue = "NONE" | "ONE_MATCH" | "TWO_MATCHES";

type CustomMatchSeriesMode =
  | "ONE_MATCH"
  | "TWO_MATCHES"
  | "BEST_OF_3"
  | "BEST_OF_5"
  | "BEST_OF_7"
  | "BEST_OF_9";

type CustomGroupResolutionMode =
  | "DRAW_ALLOWED"
  | "OVERTIME_ONLY"
  | "DECIDING_SHOTS_ONLY"
  | "OVERTIME_DECIDING_SHOTS";

type CustomKnockoutResolutionMode =
  | "OVERTIME_ONLY"
  | "DECIDING_SHOTS_ONLY"
  | "OVERTIME_DECIDING_SHOTS";

export const FORMAT_OPTIONS: SelectOption<TournamentFormat>[] = [
  { value: "LEAGUE", label: TOURNAMENT_FORMAT_LABELS.LEAGUE },
  { value: "CUP", label: TOURNAMENT_FORMAT_LABELS.CUP },
  { value: "MIXED", label: TOURNAMENT_FORMAT_LABELS.MIXED },
];

export const DISCIPLINE_OPTIONS: SelectOption<Discipline>[] = [
  { value: "football", label: "Piłka nożna" },
  { value: "handball", label: "Piłka ręczna" },
  { value: "basketball", label: "Koszykówka" },
  { value: "volleyball", label: "Siatkówka" },
  { value: "tennis", label: "Tenis" },
  {
    value: "wrestling",
    label: "Zapasy",
    description: "Styl wolny lub klasyczny z konfiguracją trybu zawodów.",
  },
  {
    value: "custom",
    label: "Inna / niestandardowa",
    description: "Rozszerzona konfiguracja dla dyscyplin własnych.",
  },
];

export const COMPETITION_TYPE_OPTIONS: SelectOption<CompetitionType>[] = [
  { value: "TEAM", label: COMPETITION_TYPE_LABELS.TEAM },
  { value: "INDIVIDUAL", label: COMPETITION_TYPE_LABELS.INDIVIDUAL },
];

export const COMPETITION_MODEL_OPTIONS: SelectOption<CompetitionModel>[] = [
  {
    value: "HEAD_TO_HEAD",
    label: COMPETITION_MODEL_LABELS.HEAD_TO_HEAD,
    description: "Uczestnik przeciwko uczestnikowi albo drużyna przeciwko drużynie.",
  },
  {
    value: "MASS_START",
    label: COMPETITION_MODEL_LABELS.MASS_START,
    description: "Bez meczów 1 na 1, klasyfikacja etapowa lub globalna.",
  },
];

export const HEAD_TO_HEAD_MODE_OPTIONS: SelectOption<CustomHeadToHeadMode>[] = [
  {
    value: "POINTS_TABLE",
    label: HEAD_TO_HEAD_MODE_LABELS.POINTS_TABLE,
    description: "Punkty za wynik i różne typy rozstrzygnięcia.",
  },
  {
    value: "MEASURED_RESULT",
    label: HEAD_TO_HEAD_MODE_LABELS.MEASURED_RESULT,
    description: "Np. czas, liczba, miejsce w pojedynku.",
  },
];

export const MASS_START_VALUE_KIND_OPTIONS: SelectOption<CustomMassStartValueKind>[] = [
  { value: "TIME", label: RESULT_VALUE_KIND_LABELS.TIME },
  { value: "NUMBER", label: RESULT_VALUE_KIND_LABELS.NUMBER },
  { value: "POINTS", label: RESULT_VALUE_KIND_LABELS.POINTS },
  { value: "PLACE", label: RESULT_VALUE_KIND_LABELS.PLACE },
];

export const MEASURED_VALUE_KIND_OPTIONS: SelectOption<CustomMeasuredValueKind>[] = [
  { value: "TIME", label: RESULT_VALUE_KIND_LABELS.TIME },
  { value: "NUMBER", label: RESULT_VALUE_KIND_LABELS.NUMBER },
  { value: "PLACE", label: RESULT_VALUE_KIND_LABELS.PLACE },
];

export const CUSTOM_BETTER_RESULT_OPTIONS: SelectOption<CustomBetterResult>[] = [
  { value: "HIGHER", label: BETTER_RESULT_LABELS.HIGHER },
  { value: "LOWER", label: BETTER_RESULT_LABELS.LOWER },
];

export const CUSTOM_TIME_FORMAT_OPTIONS: SelectOption<CustomTimeFormat>[] = [
  { value: "HH:MM:SS", label: TIME_FORMAT_LABELS["HH:MM:SS"] },
  { value: "MM:SS", label: TIME_FORMAT_LABELS["MM:SS"] },
  { value: "MM:SS.hh", label: TIME_FORMAT_LABELS["MM:SS.hh"] },
  { value: "SS.hh", label: TIME_FORMAT_LABELS["SS.hh"] },
];

export const AGGREGATION_MODE_OPTIONS: SelectOption<CustomAggregationMode>[] = [
  { value: "SUM", label: AGGREGATION_MODE_LABELS.SUM },
  { value: "AVERAGE", label: AGGREGATION_MODE_LABELS.AVERAGE },
  { value: "BEST", label: AGGREGATION_MODE_LABELS.BEST },
  { value: "LAST_ROUND", label: AGGREGATION_MODE_LABELS.LAST_ROUND },
];

export const UNIT_PRESET_OPTIONS: SelectOption<CustomUnitPreset>[] = [
  { value: "POINTS", label: UNIT_PRESET_LABELS.POINTS },
  { value: "SECONDS", label: UNIT_PRESET_LABELS.SECONDS },
  { value: "MILLISECONDS", label: UNIT_PRESET_LABELS.MILLISECONDS },
  { value: "MINUTES", label: UNIT_PRESET_LABELS.MINUTES },
  { value: "METERS", label: UNIT_PRESET_LABELS.METERS },
  { value: "CENTIMETERS", label: UNIT_PRESET_LABELS.CENTIMETERS },
  { value: "KILOGRAMS", label: UNIT_PRESET_LABELS.KILOGRAMS },
  { value: "GRAMS", label: UNIT_PRESET_LABELS.GRAMS },
  { value: "REPS", label: UNIT_PRESET_LABELS.REPS },
  { value: "PLACE", label: UNIT_PRESET_LABELS.PLACE },
  { value: "CUSTOM", label: UNIT_PRESET_LABELS.CUSTOM },
];

export const DECIMAL_PLACES_OPTIONS: SelectOption<number>[] = [
  { value: 0, label: "0" },
  { value: 1, label: "1" },
  { value: 2, label: "2" },
  { value: 3, label: "3" },
  { value: 4, label: "4" },
];

export const MATCHES_COUNT_OPTIONS: SelectOption<1 | 2>[] = [
  { value: 1, label: "1 mecz" },
  { value: 2, label: "2 mecze (rewanż)" },
];

export const MATCHES_COUNT_ROUNDS_OPTIONS: SelectOption<1 | 2>[] = [
  { value: 1, label: "1 mecz" },
  { value: 2, label: "2 mecze (dwumecz)" },
];

export const THIRD_PLACE_OPTIONS: SelectOption<ThirdPlaceSelectValue>[] = [
  { value: "NONE", label: "Nie" },
  { value: "ONE_MATCH", label: "Tak" },
  { value: "TWO_MATCHES", label: "Tak - 2 mecze" },
];

export const CUSTOM_MATCH_SERIES_OPTIONS: SelectOption<CustomMatchSeriesMode>[] = [
  { value: "ONE_MATCH", label: "1 mecz" },
  { value: "TWO_MATCHES", label: "2 mecze (dwumecz)" },
  { value: "BEST_OF_3", label: "Do 2 wygranych" },
  { value: "BEST_OF_5", label: "Do 3 wygranych" },
  { value: "BEST_OF_7", label: "Do 4 wygranych" },
  { value: "BEST_OF_9", label: "Do 5 wygranych" },
];

export const CUSTOM_GROUP_RESOLUTION_OPTIONS: SelectOption<CustomGroupResolutionMode>[] = [
  { value: "DRAW_ALLOWED", label: "Remis" },
  { value: "OVERTIME_ONLY", label: "Dogrywka (możliwy remis)" },
  { value: "DECIDING_SHOTS_ONLY", label: "Rzuty rozstrzygające (pewny zwycięzca)" },
  { value: "OVERTIME_DECIDING_SHOTS", label: "Dogrywka + rzuty rozstrzygające (pewny zwycięzca)" },
];

export const CUSTOM_KNOCKOUT_RESOLUTION_OPTIONS: SelectOption<CustomKnockoutResolutionMode>[] = [
  { value: "OVERTIME_ONLY", label: "Dogrywka" },
  { value: "DECIDING_SHOTS_ONLY", label: "Rzuty rozstrzygające (pewny zwycięzca)" },
  { value: "OVERTIME_DECIDING_SHOTS", label: "Dogrywka + rzuty rozstrzygające (pewny zwycięzca)" },
];

export const HB_POINTS_OPTIONS: SelectOption<HandballPointsMode>[] = [
  { value: "2_1_0", label: "2-1-0 (W-R-P)" },
  { value: "3_1_0", label: "3-1-0 (W-R-P)" },
  { value: "3_2_1_0", label: "3-2-1-0 (karne: W=2, P=1)" },
];

export const TENNIS_BEST_OF_OPTIONS: SelectOption<TennisBestOf>[] = [
  { value: 3, label: "Do 2 wygranych setów" },
  { value: 5, label: "Do 3 wygranych setów" },
];

export const TENNIS_POINTS_MODE_OPTIONS: SelectOption<TennisPointsMode>[] = [
  {
    value: "NONE",
    label: TENNIS_POINTS_MODE_LABELS.NONE,
    description: "Tabela bez osobnej kolumny punktów. O kolejności decydują zwycięstwa, sety, gemy i bezpośredni mecz.",
  },
  {
    value: "PLT",
    label: TENNIS_POINTS_MODE_LABELS.PLT,
    description: "System wylicza punkty klasyfikacyjne w tabeli turniejowej.",
  },
];

export const HB_TABLE_DRAW_OPTIONS: SelectOption<HandballTableDrawMode>[] = [
  { value: "ALLOW_DRAW", label: "Remis dopuszczalny" },
  { value: "PENALTIES", label: "Remis - karne" },
  { value: "OVERTIME_PENALTIES", label: "Remis - dogrywka + karne" },
];

export const HB_KNOCKOUT_TIEBREAK_OPTIONS: SelectOption<HandballKnockoutTiebreak>[] = [
  { value: "OVERTIME_PENALTIES", label: "Dogrywka + karne" },
  { value: "PENALTIES", label: "Od razu karne" },
];

export const BASKETBALL_RESOLUTION_OPTIONS: SelectOption<BasketballResolutionMode>[] = [
  {
    value: "OVERTIME_ONLY",
    label: "Dogrywka po remisie",
    description: "Remis po czasie podstawowym jest rozstrzygany dogrywką. Karne nie są dostępne.",
  },
];

export function disciplineLabel(code?: Discipline, customName?: string) {
  if (code === "custom") {
    return customName?.trim() || DISCIPLINE_LABELS.custom;
  }

  return getLabel(DISCIPLINE_LABELS, code, "-");
}

export function formatLabel(v?: TournamentFormat) {
  return getLabel(TOURNAMENT_FORMAT_LABELS, v, "-");
}

export function competitionTypeLabel(v?: CompetitionType) {
  return getLabel(COMPETITION_TYPE_LABELS, v, "-");
}

export function competitionModelLabel(v?: CompetitionModel) {
  return getLabel(COMPETITION_MODEL_LABELS, v, "-");
}

function basketballResolutionModeLabel(v?: BasketballResolutionMode) {
  if (v === "OVERTIME_ONLY") return "Dogrywka po remisie";
  return "-";
}

function headToHeadModeLabel(v?: CustomHeadToHeadMode) {
  return getLabel(HEAD_TO_HEAD_MODE_LABELS, v, "-");
}

function massStartValueKindLabel(v?: CustomMassStartValueKind) {
  return getLabel(RESULT_VALUE_KIND_LABELS, v, "-");
}

function betterResultLabel(v?: CustomBetterResult) {
  return getLabel(BETTER_RESULT_LABELS, v, "-");
}

function timeFormatLabel(v?: CustomTimeFormat | null) {
  return getLabel(TIME_FORMAT_LABELS, v, TIME_FORMAT_LABELS["MM:SS.hh"]);
}

function wrestlingCompetitionModeLabel(v?: WrestlingCompetitionMode) {
  return getLabel(WRESTLING_COMPETITION_MODE_LABELS, v, WRESTLING_COMPETITION_MODE_LABELS.AUTO);
}

function unitPresetLabel(v?: CustomUnitPreset, customLabel?: string) {
  if (v === "CUSTOM") return customLabel?.trim() || UNIT_PRESET_LABELS.CUSTOM;
  return getLabel(UNIT_PRESET_LABELS, v, "-");
}

function aggregationModeLabel(v?: CustomAggregationMode) {
  return getLabel(AGGREGATION_MODE_LABELS, v, "-");
}

function measuredSummary(config: TournamentResultConfig) {
  const unit = unitPresetLabel(
    config.measuredUnitPreset,
    config.measuredUnitCustomLabel
  );

  if (config.measuredValueKind === "TIME") {
    return `${RESULT_VALUE_KIND_LABELS.TIME}, ${unit}, format ${timeFormatLabel(config.measuredTimeFormat)}, ${BETTER_RESULT_LABELS.LOWER.toLowerCase()}`;
  }

  if (config.measuredValueKind === "PLACE") {
    return `${RESULT_VALUE_KIND_LABELS.PLACE}, ${BETTER_RESULT_LABELS.LOWER.toLowerCase()}`;
  }

  return `${unit}, ${betterResultLabel(config.measuredBetterResult)}, dokładność ${config.measuredDecimalPlaces ?? 0}`;
}

function massStartSummary(config: TournamentResultConfig) {
  const unit = unitPresetLabel(
    config.massStartUnitPreset,
    config.massStartUnitCustomLabel
  );

  if (config.massStartValueKind === "TIME") {
    return `${RESULT_VALUE_KIND_LABELS.TIME}, ${unit}, format ${timeFormatLabel(config.massStartTimeFormat)}, ${BETTER_RESULT_LABELS.LOWER.toLowerCase()}`;
  }

  if (config.massStartValueKind === "PLACE") {
    return `${RESULT_VALUE_KIND_LABELS.PLACE}, ${BETTER_RESULT_LABELS.LOWER.toLowerCase()}`;
  }

  return `${massStartValueKindLabel(config.massStartValueKind)}, ${unit}, ${betterResultLabel(config.massStartBetterResult)}`;
}

function matchSeriesModeLabel(mode?: CustomMatchSeriesMode) {
  return CUSTOM_MATCH_SERIES_OPTIONS.find((option) => option.value === mode)?.label ?? "1 mecz";
}

function groupResolutionModeLabel(mode?: CustomGroupResolutionMode) {
  return CUSTOM_GROUP_RESOLUTION_OPTIONS.find((option) => option.value === mode)?.label ?? "Remis";
}

function knockoutResolutionModeLabel(mode?: CustomKnockoutResolutionMode) {
  return CUSTOM_KNOCKOUT_RESOLUTION_OPTIONS.find((option) => option.value === mode)?.label ?? "Dogrywka + rzuty rozstrzygające (pewny zwycięzca)";
}

function bestOfFromSeriesMode(mode?: CustomMatchSeriesMode): number | null {
  if (mode === "BEST_OF_3") return 3;
  if (mode === "BEST_OF_5") return 5;
  if (mode === "BEST_OF_7") return 7;
  if (mode === "BEST_OF_9") return 9;
  return null;
}

function legsCountFromSeriesMode(mode?: CustomMatchSeriesMode): number {
  return mode === "TWO_MATCHES" ? 2 : 1;
}

function deriveSeriesMode(config: TournamentResultConfig): CustomMatchSeriesMode {
  if (config.customMatchSeriesMode) return config.customMatchSeriesMode;
  if (config.bestOf === 9) return "BEST_OF_9";
  if (config.bestOf === 7) return "BEST_OF_7";
  if (config.bestOf === 5) return "BEST_OF_5";
  if (config.bestOf === 3) return "BEST_OF_3";
  if (config.legsCount === 2) return "TWO_MATCHES";
  return "ONE_MATCH";
}

function deriveGroupResolutionMode(config: TournamentResultConfig): CustomGroupResolutionMode {
  if (config.groupResolutionMode) return config.groupResolutionMode;
  if (config.allowDraw) return "DRAW_ALLOWED";
  if (config.allowOvertime && config.allowShootout) return "OVERTIME_DECIDING_SHOTS";
  if (config.allowShootout) return "DECIDING_SHOTS_ONLY";
  return "OVERTIME_ONLY";
}

function deriveKnockoutResolutionMode(config: TournamentResultConfig): CustomKnockoutResolutionMode {
  if (config.knockoutResolutionMode) return config.knockoutResolutionMode;
  if (config.allowOvertime && config.allowShootout) return "OVERTIME_DECIDING_SHOTS";
  if (config.allowShootout) return "DECIDING_SHOTS_ONLY";
  return "OVERTIME_ONLY";
}

function getThirdPlaceSelectValue(
  thirdPlace: boolean,
  thirdPlaceMatches: 1 | 2
): ThirdPlaceSelectValue {
  if (!thirdPlace) return "NONE";
  return thirdPlaceMatches === 2 ? "TWO_MATCHES" : "ONE_MATCH";
}

type BooleanSelectValue = "NO" | "YES";

const BOOLEAN_SELECT_OPTIONS: SelectOption<BooleanSelectValue>[] = [
  { value: "NO", label: "Nie" },
  { value: "YES", label: "Tak" },
];

const ACTIVE_STAGES_OPTIONS: SelectOption<1 | 2 | 3>[] = [
  { value: 1, label: "1 etap" },
  { value: 2, label: "2 etapy" },
  { value: 3, label: "3 etapy" },
];

function boolToSelectValue(value: boolean): BooleanSelectValue {
  return value ? "YES" : "NO";
}

function selectValueToBool(value: BooleanSelectValue): boolean {
  return value === "YES";
}

function getActiveStagesCount(stages: CustomStageConfig[]) {
  const stage3 = stages[2];
  if (stage3?.participantsCount != null) return 3;

  const stage2 = stages[1];
  if (stage2?.participantsCount != null) return 2;

  return 1;
}

function getStageMinParticipants(groupsCount: number) {
  return Math.max(2, groupsCount * 2);
}

function getStageWarnings(
  stage: CustomStageConfig,
  index: number,
  activeStagesCount: number,
  totalParticipants: number,
  previousStage: CustomStageConfig | null
) {
  const warnings: string[] = [];
  const effectiveParticipants = index === 0 ? totalParticipants : previousStage?.advanceCount ?? previousStage?.participantsCount ?? totalParticipants;
  const minParticipants = getStageMinParticipants(stage.groupsCount);

  if (index >= activeStagesCount) {
    return warnings;
  }

  if (stage.groupsCount < 1) {
    warnings.push("Liczba grup nie może być mniejsza niż 1.");
  }

  if (effectiveParticipants < minParticipants) {
    warnings.push(`Dla ${stage.groupsCount} grup potrzebujesz co najmniej ${minParticipants} uczestników.`);
  }

  if (stage.advanceCount != null) {
    if (stage.advanceCount > effectiveParticipants) {
      warnings.push("Liczba awansujących nie może być większa niż liczba uczestników etapu.");
    }

    if (stage.advanceCount < 1) {
      warnings.push("Liczba awansujących nie może być mniejsza niż 1.");
    }
  }

  if (index === activeStagesCount - 1 && stage.advanceCount != null) {
    warnings.push("Ostatni aktywny etap powinien mieć pustą liczbę awansujących.");
  }

  if (index < activeStagesCount - 1 && stage.advanceCount == null) {
    warnings.push("Podaj liczbę awansujących do kolejnego aktywnego etapu.");
  }

  return warnings;
}

function getStructureValidationMessages(params: {
  discipline: Discipline;
  participants: number;
  competitionModel: CompetitionModel;
  format: TournamentFormat;
  groupsCount: number;
  minGroupSize: number;
  activeStagesCount: number;
  stages: CustomStageConfig[];
  resultConfig: TournamentResultConfig;
}) {
  const messages: string[] = [];
  const {
    discipline,
    participants,
    competitionModel,
    format,
    groupsCount,
    minGroupSize,
    activeStagesCount,
    stages,
    resultConfig,
  } = params;

  if (participants < 2) {
    messages.push("Liczba uczestników nie może być mniejsza niż 2.");
  }

  if (discipline === "custom" && competitionModel === "MASS_START") {
    const activeStages = stages.slice(0, activeStagesCount);

    activeStages.forEach((stage, index) => {
      messages.push(...getStageWarnings(stage, index, activeStagesCount, participants, index > 0 ? activeStages[index - 1] : null));
    });

  }

  if (format === "MIXED" && groupsCount > 1 && minGroupSize < 2) {
    messages.push("W fazie grupowej każda grupa musi mieć co najmniej 2 uczestników.");
  }

  if (discipline === "custom" && competitionModel === "HEAD_TO_HEAD") {
    if (resultConfig.headToHeadMode === "POINTS_TABLE") {
      if (resultConfig.bestOf != null && ![3, 5, 7, 9].includes(resultConfig.bestOf)) {
        messages.push("Tryb serii do określonej liczby zwycięstw może mieć tylko wartości 3, 5, 7 lub 9.");
      }

      if (resultConfig.legsCount != null && (resultConfig.legsCount < 1 || resultConfig.legsCount > 2)) {
        messages.push("Liczba pojedynków może wynosić tylko 1 lub 2.");
      }

      if (resultConfig.allowShootout && !resultConfig.allowOvertime && resultConfig.pointsShootoutWin === resultConfig.pointsWin) {
        messages.push("Przy własnej punktacji warto odróżnić zwykłą wygraną od wygranej po rzutach rozstrzygających.");
      }
    }

    if (resultConfig.headToHeadMode === "MEASURED_RESULT" && resultConfig.measuredValueKind === "TIME" && !resultConfig.measuredTimeFormat) {
      messages.push("Dla wyniku czasowego wybierz format czasu.");
    }
  }

  if (discipline === "custom" && competitionModel === "MASS_START") {
    if (resultConfig.massStartValueKind === "TIME" && !resultConfig.massStartTimeFormat) {
      messages.push("Dla wyniku czasowego wybierz format czasu.");
    }
  }

  return Array.from(new Set(messages));
}

function FormatCopyBar({
  disableForm,
  canEditDivisions,
  copyDivisionOptions,
  copySourceDivisionId,
  onCopySourceDivisionChange,
  onCopyFormatFromDivision,
}: {
  disableForm: boolean;
  canEditDivisions: boolean;
  copyDivisionOptions: SelectOption<number>[];
  copySourceDivisionId: number | null;
  onCopySourceDivisionChange?: (divisionId: number) => void;
  onCopyFormatFromDivision?: () => void;
}) {
  if (!canEditDivisions || copyDivisionOptions.length === 0) {
    return null;
  }

  const selectedValue = copySourceDivisionId ?? copyDivisionOptions[0]?.value ?? null;
  if (selectedValue == null) {
    return null;
  }

  return (
    <div className="mb-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-300">Kopiuj ustawienia formatu z dywizji</div>
          <Select<number>
            value={selectedValue}
            disabled={disableForm}
            onChange={(value) => onCopySourceDivisionChange?.(value)}
            options={copyDivisionOptions}
            ariaLabel="Kopiuj ustawienia formatu z dywizji"
          />
        </div>

        <div className="flex items-end">
          <Button
            type="button"
            variant="secondary"
            disabled={disableForm}
            onClick={onCopyFormatFromDivision}
          >
            Kopiuj ustawienia
          </Button>
        </div>
      </div>

      <div className="mt-2 text-xs text-slate-400">
        Skopiowane zostaną ustawienia formatu aktywnej dywizji. Po skopiowaniu nadal możesz je edytować ręcznie.
      </div>
    </div>
  );
}

function DivisionSection({
  showSection,
  disableForm,
  canEditDivisions,
  participants,
  onParticipantsChange,
  activeDivisionName,
  activeDivisionStatusLabel,
  visibleDivisions,
  showDivisionTiles,
  newDivisionName,
  divisionActionLoading,
  editingDivisionId,
  editingDivisionName,
  onNewDivisionNameChange,
  onCreateDivision,
  onDivisionSwitch,
  onStartDivisionRename,
  onEditingDivisionNameChange,
  onCancelDivisionRename,
  onSaveDivisionRename,
  onArchiveDivision,
}: {
  showSection: boolean;
  disableForm: boolean;
  canEditDivisions: boolean;
  participants: number;
  onParticipantsChange: (v: number) => void;
  activeDivisionName?: string | null;
  activeDivisionStatusLabel?: string | null;
  visibleDivisions: StructureDivisionItem[];
  showDivisionTiles: boolean;
  newDivisionName: string;
  divisionActionLoading: boolean;
  editingDivisionId: number | null;
  editingDivisionName: string;
  onNewDivisionNameChange?: (value: string) => void;
  onCreateDivision?: () => void;
  onDivisionSwitch?: (divisionId: number) => void;
  onStartDivisionRename?: (divisionId: number, currentName: string) => void;
  onEditingDivisionNameChange?: (value: string) => void;
  onCancelDivisionRename?: () => void;
  onSaveDivisionRename?: (divisionId: number) => void;
  onArchiveDivision?: (divisionId: number) => void;
}) {
  const [expandedDivisionId, setExpandedDivisionId] = useState<number | null>(null);

  useEffect(() => {
    if (editingDivisionId != null) {
      setExpandedDivisionId(editingDivisionId);
      return;
    }

    setExpandedDivisionId((current) => {
      if (current == null) return null;
      return visibleDivisions.some((division) => division.id === current) ? current : null;
    });
  }, [editingDivisionId, visibleDivisions]);

  if (!showSection) {
    return null;
  }

  const activeDivision = visibleDivisions.find((division) => division.isActive);

  return (
    <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="text-sm font-semibold text-white">Dywizje</div>

      <div className="mt-1 text-sm text-slate-300">
        Nazwa i opis turnieju pozostają globalne. Dywizje rozdzielają konfigurację rozgrywek oraz liczbę uczestników.
      </div>

      {canEditDivisions && (
        <div className="mt-4 rounded-2xl border border-white/10 bg-black/10 p-4">
          <div className="text-xs font-semibold text-slate-300">Dodaj dywizję</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Input
              value={newDivisionName}
              disabled={disableForm}
              onChange={(e) => onNewDivisionNameChange?.(e.target.value)}
              placeholder="Np. Kwalifikacje kobiet"
            />
            <Button
              type="button"
              disabled={disableForm || !newDivisionName.trim()}
              onClick={onCreateDivision}
            >
              {divisionActionLoading ? "Trwa..." : "Dodaj dywizję"}
            </Button>
          </div>
        </div>
      )}

      {showDivisionTiles ? (
        <div className="mt-4 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
          {visibleDivisions.map((division) => {
            const isEditing = editingDivisionId === division.id;
            const isActive = Boolean(division.isActive);
            const isExpanded = expandedDivisionId === division.id || isEditing;

            return (
              <div
                key={division.id}
                className={cn(
                  "min-w-0 rounded-2xl border p-3 transition",
                  isActive
                    ? "border-cyan-400/40 bg-cyan-400/10 shadow-[0_0_0_1px_rgba(34,211,238,0.08)]"
                    : "border-white/10 bg-black/10"
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    disabled={disableForm}
                    onClick={() => onDivisionSwitch?.(division.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className={cn("truncate text-sm font-semibold", isActive ? "text-cyan-100" : "text-white")}>
                      {division.name}
                    </div>
                    <div className={cn("mt-1 text-xs", isActive ? "text-cyan-200/80" : "text-slate-400")}>
                      {division.statusLabel ?? "-"}
                      {division.isDefault ? " - podstawowa" : ""}
                    </div>
                  </button>

                  {canEditDivisions ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-3 text-xs text-slate-200 hover:bg-white/[0.07]"
                      rightIcon={isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      onClick={() => setExpandedDivisionId((current) => (current === division.id ? null : division.id))}
                      disabled={disableForm}
                    >
                      Więcej
                    </Button>
                  ) : null}
                </div>

                {canEditDivisions && isExpanded ? (
                  <div className="mt-3 border-t border-white/10 pt-3">
                    {isEditing ? (
                      <div className="space-y-3">
                        <Input
                          value={editingDivisionName}
                          disabled={disableForm}
                          onChange={(e) => onEditingDivisionNameChange?.(e.target.value)}
                        />

                        <div className="flex items-center justify-end gap-2 overflow-x-auto pb-0.5">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="h-8 shrink-0 rounded-xl px-3"
                            disabled={disableForm}
                            onClick={() => {
                              onCancelDivisionRename?.();
                              setExpandedDivisionId(null);
                            }}
                          >
                            Anuluj
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="h-8 shrink-0 rounded-xl px-3"
                            disabled={disableForm || !editingDivisionName.trim()}
                            onClick={() => onSaveDivisionRename?.(division.id)}
                          >
                            Zapisz nazwę
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-2 overflow-x-auto pb-0.5">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="h-8 shrink-0 rounded-xl px-3"
                          disabled={disableForm}
                          onClick={() => {
                            setExpandedDivisionId(division.id);
                            onStartDivisionRename?.(division.id, division.name);
                          }}
                        >
                          Zmień nazwę
                        </Button>

                        {!division.isDefault ? (
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="h-8 shrink-0 rounded-xl px-3"
                            disabled={disableForm}
                            onClick={() => onArchiveDivision?.(division.id)}
                          >
                            Archiwizuj
                          </Button>
                        ) : null}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-4">
          <InlineAlert variant="info" title="Aktywna dywizja">
            {activeDivisionName ?? "Aktywna dywizja"}
            {activeDivisionStatusLabel ? ` - ${activeDivisionStatusLabel}` : ""}
            {" - utwórz kolejną dywizję, aby rozdzielić konfigurację i uczestników."}
          </InlineAlert>
        </div>
      )}

      <div
        className={cn(
          "mt-4 rounded-2xl border p-4 transition",
          activeDivision
            ? "border-cyan-400/40 bg-cyan-400/10 shadow-[0_0_0_1px_rgba(34,211,238,0.08)]"
            : "border-white/10 bg-black/10"
        )}
      >
        <div className="text-xs font-semibold text-slate-300">Liczba uczestników wybranej dywizji</div>
        <div className="mt-3 max-w-xs space-y-2">
          <Input
            type="number"
            min={2}
            max={10000}
            disabled={disableForm}
            value={participants}
            onChange={(e) => onParticipantsChange(Number(e.target.value))}
          />
          <div className={cn("text-xs", activeDivision ? "text-cyan-200/80" : "text-slate-400")}>
            {activeDivisionName ?? "Aktywna dywizja"}
            {activeDivisionStatusLabel ? ` - ${activeDivisionStatusLabel}` : ""}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
      <div className="text-xs font-semibold text-slate-300">{label}</div>
      <div className="text-right text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

function ToggleRow({
  checked,
  disabled,
  title,
  desc,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  title: string;
  desc: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "w-full rounded-2xl border px-4 py-3 text-left transition",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/10",
        "disabled:pointer-events-none disabled:opacity-60",
        checked
          ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
          : "border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.06]"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold">
            {title}: {checked ? "Włączone" : "Wyłączone"}
          </div>
          <div className="mt-1 text-sm text-slate-300">{desc}</div>
        </div>

        <span
          className={cn(
            "mt-0.5 inline-flex h-6 w-11 items-center rounded-full border p-0.5 transition",
            checked ? "border-emerald-400/30 bg-emerald-400/20" : "border-white/10 bg-white/[0.06]"
          )}
          aria-hidden
        >
          <span
            className={cn(
              "block h-5 w-5 rounded-full transition",
              checked ? "translate-x-5 bg-white" : "translate-x-0 bg-white/80"
            )}
          />
        </span>
      </div>
    </button>
  );
}

function NumberInput({
  value,
  min,
  max,
  disabled,
  onChange,
  placeholder,
}: {
  value: number | null;
  min?: number;
  max?: number;
  disabled?: boolean;
  onChange: (next: number | null) => void;
  placeholder?: string;
}) {
  return (
    <Input
      type="number"
      min={min}
      max={max}
      disabled={disabled}
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(e) => {
        const raw = e.target.value;
        if (!raw.trim()) {
          onChange(null);
          return;
        }
        const parsed = Number(raw);
        if (Number.isNaN(parsed)) {
          onChange(null);
          return;
        }
        onChange(parsed);
      }}
    />
  );
}

function StageCard({
  index,
  stage,
  disabled,
  isLastActiveStage,
  stageWarnings,
  totalParticipants,
  previousStageParticipants,
  onChange,
}: {
  index: number;
  stage: CustomStageConfig;
  disabled?: boolean;
  isLastActiveStage: boolean;
  stageWarnings: string[];
  totalParticipants: number;
  previousStageParticipants: number;
  onChange: (patch: Partial<CustomStageConfig>) => void;
}) {
  const effectiveParticipants = index === 0 ? totalParticipants : Math.max(0, previousStageParticipants);
  const minParticipants = getStageMinParticipants(stage.groupsCount);
  const maxParticipants = Math.max(2, effectiveParticipants);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="mb-4 flex items-center gap-2">
        <Layers3 className="h-4 w-4 text-white/80" />
        <div className="text-sm font-semibold text-white">Etap {index + 1}</div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-300">Nazwa etapu</div>
          <Input
            value={stage.name}
            disabled={disabled}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder={`Np. ${index === 0 ? "Kwalifikacje" : index === 1 ? "Półfinał" : "Finał"}`}
          />
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-300">Liczba grup</div>
          <NumberInput
            value={stage.groupsCount}
            min={1}
            max={Math.max(1, Math.floor(maxParticipants / 2))}
            disabled={disabled}
            onChange={(next) => onChange({ groupsCount: Math.max(1, next ?? 1) })}
          />
          <div className="text-xs text-slate-400">
            Przy {stage.groupsCount} grupach potrzebujesz minimum {minParticipants} uczestników.
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-300">Liczba uczestników w etapie</div>
          <NumberInput
            value={effectiveParticipants}
            min={index === 0 ? totalParticipants : minParticipants}
            max={maxParticipants}
            disabled
            onChange={() => undefined}
            placeholder="Liczba wyliczana automatycznie"
          />
          <div className="text-xs text-slate-400">
            {index === 0
              ? "Pierwszy etap zawsze startuje z pełną liczbą uczestników turnieju."
              : "Ta wartość wynika z liczby awansujących z poprzedniego etapu."}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-300">Ilu przechodzi dalej łącznie</div>
          <NumberInput
            value={stage.advanceCount}
            min={1}
            max={stage.participantsCount ?? maxParticipants}
            disabled={disabled || isLastActiveStage}
            onChange={(next) => onChange({ advanceCount: isLastActiveStage ? null : next })}
            placeholder={isLastActiveStage ? "Ostatni etap - puste" : "Np. 20"}
          />
          <div className="text-xs text-slate-400">
            {isLastActiveStage
              ? "Ostatni aktywny etap nie przekazuje awansu dalej."
              : "Podaj łączną liczbę awansujących do następnego etapu."}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-300">Rundy / próby w etapie</div>
          <NumberInput
            value={stage.roundsCount}
            min={1}
            max={20}
            disabled={disabled}
            onChange={(next) => onChange({ roundsCount: Math.max(1, next ?? 1) })}
          />
        </div>

      </div>

      {stageWarnings.length > 0 && (
        <div className="mt-4">
          <InlineAlert variant="warning" title="Sprawdź ustawienia etapu">
            <ul className="list-disc space-y-1 pl-5">
              {stageWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </InlineAlert>
        </div>
      )}
    </div>
  );
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <Portal>
          <motion.div
            key="confirm-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={onCancel}
          >
            <div className="absolute inset-0 bg-black/60" />

            <motion.div
              key="confirm-modal"
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              transition={{ duration: 0.18 }}
              className="relative w-full max-w-md"
              onClick={(e) => e.stopPropagation()}
            >
              <Card className="p-5">
                <div className="space-y-2">
                  <div className="text-base font-semibold text-slate-100">{title}</div>
                  <div className="whitespace-pre-wrap text-sm text-slate-300">{message}</div>
                </div>

                <div className="mt-5 flex items-center justify-end gap-2">
                  <Button variant="secondary" onClick={onCancel}>
                    {cancelLabel}
                  </Button>
                  <Button onClick={onConfirm}>{confirmLabel}</Button>
                </div>
              </Card>
            </motion.div>
          </motion.div>
        </Portal>
      )}
    </AnimatePresence>
  );
}

// Karta podstawowa utrzymuje kontrakt wprowadzania danych wymaganych do utworzenia turnieju.
export function BasicsCard({
  disableForm,
  isCreateMode,
  isTournamentCreated,
  name,
  description,
  onNameChange,
  onDescriptionChange,
  onCreate,
}: {
  disableForm: boolean;
  isCreateMode: boolean;
  isTournamentCreated: boolean;
  name: string;
  description: string;
  onNameChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  onCreate: () => void;
}) {
  return (
    <Card className="flex min-h-[26rem] flex-col p-6">
      <div className="min-w-0">
        <div className="text-base font-semibold text-white">Podstawowe informacje</div>
        <div className="text-sm text-slate-300">Nazwa i opis widoczne w podglądzie turnieju.</div>
      </div>

      <div className="mt-5 flex flex-1 flex-col gap-4">
        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-300">Nazwa turnieju</div>
          <Input
            value={name}
            disabled={disableForm}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Wymagane - np. Liga miejska 2026"
          />
        </div>

        <div className="flex flex-1 flex-col space-y-2">
          <div className="text-xs font-semibold text-slate-300">Opis turnieju</div>
          <div className="relative flex-1">
            <Textarea
              unstyled
              value={description}
              disabled={disableForm}
              onChange={(e) => onDescriptionChange(e.target.value)}
              placeholder="Krótki opis dla uczestników, np. zasady, lokalizacja, terminy."
              className={cn(
                "h-full min-h-[110px] w-full resize-y rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-100",
                "focus-visible:border-white/20 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/10",
                "disabled:pointer-events-none disabled:opacity-60"
              )}
            />
          </div>
          <div className="text-xs text-slate-400">
            Opcjonalnie. Jeśli nie podasz opisu, w podglądzie zostanie pominięty.
          </div>
        </div>

        {isCreateMode && (
          <div className="pt-4">
            <Button
              onClick={onCreate}
              disabled={disableForm || isTournamentCreated || !name.trim()}
              className="w-full"
            >
              Utwórz turniej
            </Button>
            {!isTournamentCreated && (
              <div className="mt-2 text-xs text-slate-400">
                Po utworzeniu turnieju odblokujesz sekcje struktury i podsumowania.
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

// Karta struktury renderuje parametry ogólne, dywizje i parametry formatu bez zmiany istniejących reguł sportów.
export function StructureCard({
  isTournamentCreated,
  disableForm,
  saving,
  discipline,
  format,
  participants,
  showDivisionSection = false,
  activeDivisionName = null,
  activeDivisionStatusLabel = null,
  visibleDivisions = [],
  showDivisionTiles = false,
  canEditDivisions = false,
  newDivisionName = "",
  divisionActionLoading = false,
  editingDivisionId = null,
  editingDivisionName = "",
  copyDivisionOptions = [],
  copySourceDivisionId = null,
  onNewDivisionNameChange,
  onCreateDivision,
  onDivisionSwitch,
  onStartDivisionRename,
  onEditingDivisionNameChange,
  onCancelDivisionRename,
  onSaveDivisionRename,
  onArchiveDivision,
  onCopySourceDivisionChange,
  onCopyFormatFromDivision,
  leagueMatches,
  groupsCount,
  groupMatches,
  advanceFromGroup,
  hbTableDrawMode,
  hbPointsMode,
  hbKnockoutTiebreak,
  basketballResolutionMode,
  wrestlingStyle = "FREESTYLE",
  wrestlingCompetitionMode = "AUTO",
  cupMatches,
  finalMatches,
  thirdPlace,
  thirdPlaceMatches,
  tennisBestOf,
  tennisPointsMode,
  maxGroupsForMin2PerGroup,
  groupSizes,
  minGroupSize,
  advanceOptions,
  showLeagueOrGroupConfig,
  showKnockoutConfig,
  onSave,
  onDisciplineChange,
  onFormatChange,
  onParticipantsChange,
  onLeagueMatchesChange,
  onGroupsCountChange,
  onGroupMatchesChange,
  onAdvanceFromGroupChange,
  onHbTableDrawModeChange,
  onHbPointsModeChange,
  onHbKnockoutTiebreakChange,
  onBasketballResolutionModeChange,
  onWrestlingStyleChange,
  onWrestlingCompetitionModeChange,
  onCupMatchesChange,
  onFinalMatchesChange,
  onThirdPlaceChange,
  onThirdPlaceMatchesChange,
  onTennisBestOfChange,
  onTennisPointsModeChange,

  competitionType = "INDIVIDUAL",
  competitionModel = "MASS_START",
  customDisciplineName = "",
  resultConfig = getDefaultResultConfig(),

  onCompetitionTypeChange,
  onCompetitionModelChange,
  onCustomDisciplineNameChange,
  onHeadToHeadModeChange,
  onAllowDrawChange,
  onAllowOvertimeChange,
  onAllowShootoutChange,
  onCustomMatchSeriesModeChange,
  onCustomGroupResolutionModeChange,
  onCustomKnockoutResolutionModeChange,
  onPointsWinChange,
  onPointsDrawChange,
  onPointsLossChange,
  onPointsOvertimeWinChange,
  onPointsOvertimeLossChange,
  onPointsShootoutWinChange,
  onPointsShootoutLossChange,
  onLegsCountChange,
  onBestOfChange,
  onHeadToHeadRoundsCountChange,
  onHeadToHeadAggregationModeChange,
  onMeasuredValueKindChange,
  onMeasuredUnitPresetChange,
  onMeasuredUnitCustomLabelChange,
  onMeasuredBetterResultChange,
  onMeasuredDecimalPlacesChange,
  onMeasuredTimeFormatChange,
  onMeasuredAllowTiesChange,
  onMassStartValueKindChange,
  onMassStartUnitPresetChange,
  onMassStartUnitCustomLabelChange,
  onMassStartBetterResultChange,
  onMassStartDecimalPlacesChange,
  onMassStartTimeFormatChange,
  onMassStartAllowTiesChange,
  onMassStartRoundsCountChange,
  onMassStartAggregationModeChange,
  onStageChange,
}: {
  isTournamentCreated: boolean;
  disableForm: boolean;
  saving: boolean;

  discipline: Discipline;
  format: TournamentFormat;
  participants: number;

  showDivisionSection?: boolean;
  activeDivisionName?: string | null;
  activeDivisionStatusLabel?: string | null;
  visibleDivisions?: StructureDivisionItem[];
  showDivisionTiles?: boolean;
  canEditDivisions?: boolean;
  newDivisionName?: string;
  divisionActionLoading?: boolean;
  editingDivisionId?: number | null;
  editingDivisionName?: string;
  copyDivisionOptions?: SelectOption<number>[];
  copySourceDivisionId?: number | null;

  onNewDivisionNameChange?: (v: string) => void;
  onCreateDivision?: () => void;
  onDivisionSwitch?: (divisionId: number) => void;
  onStartDivisionRename?: (divisionId: number, currentName: string) => void;
  onEditingDivisionNameChange?: (v: string) => void;
  onCancelDivisionRename?: () => void;
  onSaveDivisionRename?: (divisionId: number) => void;
  onArchiveDivision?: (divisionId: number) => void;
  onCopySourceDivisionChange?: (divisionId: number) => void;
  onCopyFormatFromDivision?: () => void;

  leagueMatches: 1 | 2;
  groupsCount: number;
  groupMatches: 1 | 2;
  advanceFromGroup: number;

  hbTableDrawMode: HandballTableDrawMode;
  hbPointsMode: HandballPointsMode;
  hbKnockoutTiebreak: HandballKnockoutTiebreak;
  basketballResolutionMode: BasketballResolutionMode;

  cupMatches: 1 | 2;
  finalMatches: 1 | 2;
  thirdPlace: boolean;
  thirdPlaceMatches: 1 | 2;

  tennisBestOf: TennisBestOf;
  tennisPointsMode: TennisPointsMode;

  maxGroupsForMin2PerGroup: number;
  groupSizes: number[];
  minGroupSize: number;
  advanceOptions: number[];

  showLeagueOrGroupConfig: boolean;
  showKnockoutConfig: boolean;

  onSave: () => void;

  onDisciplineChange: (v: Discipline) => void;
  onFormatChange: (v: TournamentFormat) => void;
  onParticipantsChange: (v: number) => void;

  onLeagueMatchesChange: (v: 1 | 2) => void;
  onGroupsCountChange: (v: number) => void;
  onGroupMatchesChange: (v: 1 | 2) => void;
  onAdvanceFromGroupChange: (v: number) => void;

  onHbTableDrawModeChange: (v: HandballTableDrawMode) => void;
  onHbPointsModeChange: (v: HandballPointsMode) => void;
  onHbKnockoutTiebreakChange: (v: HandballKnockoutTiebreak) => void;
  onBasketballResolutionModeChange: (v: BasketballResolutionMode) => void;

  onCupMatchesChange: (v: 1 | 2) => void;
  onFinalMatchesChange: (v: 1 | 2) => void;
  onThirdPlaceChange: (v: boolean) => void;
  onThirdPlaceMatchesChange: (v: 1 | 2) => void;

  onTennisBestOfChange: (v: TennisBestOf) => void;
  onTennisPointsModeChange: (v: TennisPointsMode) => void;

  competitionType?: CompetitionType;
  competitionModel?: CompetitionModel;
  customDisciplineName?: string;
  resultConfig?: TournamentResultConfig;

  onCompetitionTypeChange?: (v: CompetitionType) => void;
  onCompetitionModelChange?: (v: CompetitionModel) => void;
  onCustomDisciplineNameChange?: (v: string) => void;

  onHeadToHeadModeChange?: (v: CustomHeadToHeadMode) => void;
  onAllowDrawChange?: (v: boolean) => void;
  onAllowOvertimeChange?: (v: boolean) => void;
  onAllowShootoutChange?: (v: boolean) => void;
  onCustomMatchSeriesModeChange?: (v: CustomMatchSeriesMode) => void;
  onCustomGroupResolutionModeChange?: (v: CustomGroupResolutionMode) => void;
  onCustomKnockoutResolutionModeChange?: (v: CustomKnockoutResolutionMode) => void;
  onPointsWinChange?: (v: number | null) => void;
  onPointsDrawChange?: (v: number | null) => void;
  onPointsLossChange?: (v: number | null) => void;
  onPointsOvertimeWinChange?: (v: number | null) => void;
  onPointsOvertimeLossChange?: (v: number | null) => void;
  onPointsShootoutWinChange?: (v: number | null) => void;
  onPointsShootoutLossChange?: (v: number | null) => void;
  onLegsCountChange?: (v: number | null) => void;
  onBestOfChange?: (v: number | null) => void;
  onHeadToHeadRoundsCountChange?: (v: number | null) => void;
  onHeadToHeadAggregationModeChange?: (v: CustomAggregationMode) => void;

  onMeasuredValueKindChange?: (v: CustomMeasuredValueKind) => void;
  onMeasuredUnitPresetChange?: (v: CustomUnitPreset) => void;
  onMeasuredUnitCustomLabelChange?: (v: string) => void;
  onMeasuredBetterResultChange?: (v: CustomBetterResult) => void;
  onMeasuredDecimalPlacesChange?: (v: number) => void;
  onMeasuredTimeFormatChange?: (v: CustomTimeFormat) => void;
  onMeasuredAllowTiesChange?: (v: boolean) => void;

  onMassStartValueKindChange?: (v: CustomMassStartValueKind) => void;
  onMassStartUnitPresetChange?: (v: CustomUnitPreset) => void;
  onMassStartUnitCustomLabelChange?: (v: string) => void;
  onMassStartBetterResultChange?: (v: CustomBetterResult) => void;
  onMassStartDecimalPlacesChange?: (v: number) => void;
  onMassStartTimeFormatChange?: (v: CustomTimeFormat) => void;
  onMassStartAllowTiesChange?: (v: boolean) => void;
  onMassStartRoundsCountChange?: (v: number | null) => void;
  onMassStartAggregationModeChange?: (v: CustomAggregationMode) => void;

  onStageChange?: (stageId: string, patch: Partial<CustomStageConfig>) => void;
}) {
  const isHandball = discipline === "handball";
  const isBasketball = discipline === "basketball";
  const isTennis = discipline === "tennis";
  const isWrestling = discipline === "wrestling";
  const isCustomDiscipline = discipline === "custom";

  const isHeadToHead = competitionModel === "HEAD_TO_HEAD";
  const isMassStart = competitionModel === "MASS_START";

  const showStandardFormatConfig = !isCustomDiscipline;

  const measuredUsesCustomUnit = resultConfig.measuredUnitPreset === "CUSTOM";
  const massStartUsesCustomUnit = resultConfig.massStartUnitPreset === "CUSTOM";

  const measuredIsTime = resultConfig.measuredValueKind === "TIME";
  const measuredIsPlace = resultConfig.measuredValueKind === "PLACE";

  const massStartIsTime = resultConfig.massStartValueKind === "TIME";
  const massStartIsPlace = resultConfig.massStartValueKind === "PLACE";
  const customSeriesMode = deriveSeriesMode(resultConfig);
  const customGroupResolutionMode = deriveGroupResolutionMode(resultConfig);
  const customKnockoutResolutionMode = deriveKnockoutResolutionMode(resultConfig);

  const thirdPlaceValue = getThirdPlaceSelectValue(thirdPlace, thirdPlaceMatches);
  const activeStagesCount = getActiveStagesCount(resultConfig.stages);
  const validationMessages = getStructureValidationMessages({
    discipline,
    participants,
    competitionModel,
    format,
    groupsCount,
    minGroupSize,
    activeStagesCount,
    stages: resultConfig.stages,
    resultConfig,
  });

  const handleCustomSeriesModeChange = (value: CustomMatchSeriesMode) => {
    const bestOf = bestOfFromSeriesMode(value);
    onCustomMatchSeriesModeChange?.(value);
    onLegsCountChange?.(legsCountFromSeriesMode(value));
    onBestOfChange?.(bestOf);
  };

  const handleCustomGroupResolutionModeChange = (value: CustomGroupResolutionMode) => {
    onCustomGroupResolutionModeChange?.(value);

    if (value === "DRAW_ALLOWED") {
      onAllowDrawChange?.(true);
      onAllowOvertimeChange?.(false);
      onAllowShootoutChange?.(false);
      return;
    }

    if (value === "OVERTIME_ONLY") {
      onAllowDrawChange?.(false);
      onAllowOvertimeChange?.(true);
      onAllowShootoutChange?.(false);
      return;
    }

    if (value === "DECIDING_SHOTS_ONLY") {
      onAllowDrawChange?.(false);
      onAllowOvertimeChange?.(false);
      onAllowShootoutChange?.(true);
      return;
    }

    onAllowDrawChange?.(false);
    onAllowOvertimeChange?.(true);
    onAllowShootoutChange?.(true);
  };

  const handleCustomKnockoutResolutionModeChange = (value: CustomKnockoutResolutionMode) => {
    onCustomKnockoutResolutionModeChange?.(value);

    if (value === "OVERTIME_ONLY") {
      onAllowOvertimeChange?.(true);
      onAllowShootoutChange?.(false);
      return;
    }

    if (value === "DECIDING_SHOTS_ONLY") {
      onAllowOvertimeChange?.(false);
      onAllowShootoutChange?.(true);
      return;
    }

    onAllowOvertimeChange?.(true);
    onAllowShootoutChange?.(true);
  };

  const handleThirdPlaceSelectChange = (value: ThirdPlaceSelectValue) => {
    if (value === "NONE") {
      onThirdPlaceChange(false);
      onThirdPlaceMatchesChange(1);
      return;
    }

    if (value === "ONE_MATCH") {
      onThirdPlaceChange(true);
      onThirdPlaceMatchesChange(1);
      return;
    }

    onThirdPlaceChange(true);
    onThirdPlaceMatchesChange(2);
  };

  const handleActiveStagesChange = (value: 1 | 2 | 3) => {
    const defaults = getDefaultStages();

    if (!onStageChange) {
      return;
    }

    let previousStageAdvanceOrParticipants = participants;

    resultConfig.stages.forEach((stage, index) => {
      if (index >= value) {
        onStageChange(stage.id, {
          participantsCount: null,
          advanceCount: null,
          name: defaults[index].name,
          groupsCount: 1,
          roundsCount: 1,
          aggregationMode: defaults[index].aggregationMode,
          contributesToFinalRanking: defaults[index].contributesToFinalRanking,
        });
        return;
      }

      const participantsCount = index === 0 ? participants : previousStageAdvanceOrParticipants;
      const advanceCount =
        index === value - 1
          ? null
          : stage.advanceCount ?? Math.max(2, Math.floor(participantsCount / 2));

      onStageChange(stage.id, {
        participantsCount,
        advanceCount,
        name: stage.name || defaults[index].name,
        contributesToFinalRanking: index === value - 1,
      });

      previousStageAdvanceOrParticipants = advanceCount ?? participantsCount;
    });
  };

  return (
    <Card className={cn("p-6", !isTournamentCreated && "pointer-events-none opacity-60 blur-[1px]")}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-base font-semibold text-white">Struktura rozgrywek</div>
          <div className="text-sm text-slate-300">Dobierz parametry dyscypliny, formatu i etapów.</div>
        </div>

        <Button onClick={onSave} disabled={disableForm || validationMessages.length > 0} variant="secondary">
          {saving ? "Zapisywanie..." : "Zapisz"}
        </Button>
      </div>

      {validationMessages.length > 0 && (
        <div className="mt-5">
          <InlineAlert variant="warning" title="Konfiguracja wymaga poprawek">
            <ul className="list-disc space-y-1 pl-5">
              {validationMessages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </InlineAlert>
        </div>
      )}

      <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
        <div className="text-sm font-semibold text-white">Parametry ogólne</div>

        <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-300">Dyscyplina</div>
            <Select<Discipline>
              value={discipline}
              disabled={disableForm}
              onChange={onDisciplineChange}
              options={DISCIPLINE_OPTIONS}
              ariaLabel="Dyscyplina"
            />
          </div>

          {!isCustomDiscipline && !isWrestling && (
            <>
              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-300">Format turnieju</div>
                <Select<TournamentFormat>
                  value={format}
                  disabled={disableForm}
                  onChange={onFormatChange}
                  options={FORMAT_OPTIONS}
                  ariaLabel="Format turnieju"
                />
              </div>

            </>
          )}

          {isCustomDiscipline && (
            <>
              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-300">Nazwa dyscypliny</div>
                <Input
                  value={customDisciplineName}
                  disabled={disableForm}
                  onChange={(e) => onCustomDisciplineNameChange?.(e.target.value)}
                  placeholder="Np. Bieg na 400 m, Bench Press"
                />
              </div>

              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-300">Typ uczestnictwa</div>
                <Select<CompetitionType>
                  value={competitionType}
                  disabled={disableForm}
                  onChange={(value) => onCompetitionTypeChange?.(value)}
                  options={COMPETITION_TYPE_OPTIONS}
                  ariaLabel="Typ uczestnictwa custom"
                />
              </div>

              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-300">Model rywalizacji</div>
                <Select<CompetitionModel>
                  value={competitionModel}
                  disabled={disableForm}
                  onChange={(value) => onCompetitionModelChange?.(value)}
                  options={COMPETITION_MODEL_OPTIONS}
                  ariaLabel="Model rywalizacji custom"
                />
              </div>

              {isHeadToHead && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-300">Format turnieju</div>
                  <Select<TournamentFormat>
                    value={format}
                    disabled={disableForm}
                    onChange={onFormatChange}
                    options={FORMAT_OPTIONS}
                    ariaLabel="Format turnieju custom"
                  />
                </div>
              )}

            </>
          )}
        </div>
      </div>

      <DivisionSection
        showSection={showDivisionSection}
        disableForm={disableForm}
        canEditDivisions={canEditDivisions}
        participants={participants}
        onParticipantsChange={onParticipantsChange}
        activeDivisionName={activeDivisionName}
        activeDivisionStatusLabel={activeDivisionStatusLabel}
        visibleDivisions={visibleDivisions}
        showDivisionTiles={showDivisionTiles}
        newDivisionName={newDivisionName}
        divisionActionLoading={divisionActionLoading}
        editingDivisionId={editingDivisionId}
        editingDivisionName={editingDivisionName}
        onNewDivisionNameChange={onNewDivisionNameChange}
        onCreateDivision={onCreateDivision}
        onDivisionSwitch={onDivisionSwitch}
        onStartDivisionRename={onStartDivisionRename}
        onEditingDivisionNameChange={onEditingDivisionNameChange}
        onCancelDivisionRename={onCancelDivisionRename}
        onSaveDivisionRename={onSaveDivisionRename}
        onArchiveDivision={onArchiveDivision}
      />

      {isCustomDiscipline && (
        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="text-sm font-semibold text-white">Format wyniku</div>

          <div className="mt-4">
            <FormatCopyBar
              disableForm={disableForm}
              canEditDivisions={canEditDivisions}
              copyDivisionOptions={copyDivisionOptions}
              copySourceDivisionId={copySourceDivisionId}
              onCopySourceDivisionChange={onCopySourceDivisionChange}
              onCopyFormatFromDivision={onCopyFormatFromDivision}
            />
          </div>

          {isHeadToHead && (
            <div className="mt-4 space-y-4">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-300">Typ wyniku</div>
                  <Select<CustomHeadToHeadMode>
                    value={resultConfig.headToHeadMode}
                    disabled={disableForm}
                    onChange={(value) => onHeadToHeadModeChange?.(value)}
                    options={[
                      {
                        value: "POINTS_TABLE",
                        label: "Własne zasady punktacji",
                        description: "Punkty do klasyfikacji za różne typy rozstrzygnięcia.",
                      },
                      {
                        value: "MEASURED_RESULT",
                        label: "Wynik mierzalny",
                        description: "Np. czas, liczba, miejsce w pojedynku.",
                      },
                    ]}
                    ariaLabel="Typ wyniku head-to-head"
                  />
                </div>
              </div>

              {resultConfig.headToHeadMode === "POINTS_TABLE" ? (
                <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                  <div className="mb-3 text-sm font-semibold text-white">Własne zasady punktacji</div>
                  <div className="mb-4 text-sm text-slate-300">
                    Punkty przyznawane do klasyfikacji za poszczególne typy rozstrzygnięcia. Dozwolone są także wartości ujemne.
                  </div>

                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-slate-300">Wygrana</div>
                        <NumberInput value={resultConfig.pointsWin} disabled={disableForm} onChange={onPointsWinChange ?? (() => undefined)} />
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-slate-300">Remis</div>
                        <NumberInput value={resultConfig.pointsDraw} disabled={disableForm} onChange={onPointsDrawChange ?? (() => undefined)} />
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-slate-300">Porażka</div>
                        <NumberInput value={resultConfig.pointsLoss} disabled={disableForm} onChange={onPointsLossChange ?? (() => undefined)} />
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-slate-300">Wygrana po dogrywce</div>
                        <NumberInput value={resultConfig.pointsOvertimeWin} disabled={disableForm || !resultConfig.allowOvertime} onChange={onPointsOvertimeWinChange ?? (() => undefined)} />
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-slate-300">Porażka po dogrywce</div>
                        <NumberInput value={resultConfig.pointsOvertimeLoss} disabled={disableForm || !resultConfig.allowOvertime} onChange={onPointsOvertimeLossChange ?? (() => undefined)} />
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-slate-300">Wygrana po karnych</div>
                        <NumberInput value={resultConfig.pointsShootoutWin} disabled={disableForm || !resultConfig.allowShootout} onChange={onPointsShootoutWinChange ?? (() => undefined)} />
                      </div>
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-slate-300">Porażka po karnych</div>
                        <NumberInput value={resultConfig.pointsShootoutLoss} disabled={disableForm || !resultConfig.allowShootout} onChange={onPointsShootoutLossChange ?? (() => undefined)} />
                      </div>
                    </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                  <div className="mb-3 text-sm font-semibold text-white">Wynik mierzalny w pojedynku</div>

                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <div className="space-y-2">
                      <div className="text-xs font-semibold text-slate-300">Typ wyniku</div>
                      <Select<CustomMeasuredValueKind>
                        value={resultConfig.measuredValueKind}
                        disabled={disableForm}
                        onChange={(value) => onMeasuredValueKindChange?.(value)}
                        options={MEASURED_VALUE_KIND_OPTIONS}
                        ariaLabel="Typ mierzalnego wyniku"
                      />
                    </div>

                    {measuredIsTime ? (
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-slate-300">Format czasu</div>
                        <Select<CustomTimeFormat>
                          value={resultConfig.measuredTimeFormat ?? "MM:SS.hh"}
                          disabled={disableForm}
                          onChange={(value) => onMeasuredTimeFormatChange?.(value)}
                          options={CUSTOM_TIME_FORMAT_OPTIONS}
                          ariaLabel="Format czasu mierzalnego wyniku"
                        />
                      </div>
                    ) : (
                      <>
                        <div className="space-y-2">
                          <div className="text-xs font-semibold text-slate-300">Jednostka</div>
                          <Select<CustomUnitPreset>
                            value={resultConfig.measuredUnitPreset}
                            disabled={disableForm}
                            onChange={(value) => onMeasuredUnitPresetChange?.(value)}
                            options={UNIT_PRESET_OPTIONS}
                            ariaLabel="Jednostka wyniku mierzalnego"
                          />
                        </div>

                        {measuredUsesCustomUnit && (
                          <div className="space-y-2">
                            <div className="text-xs font-semibold text-slate-300">Własna jednostka</div>
                            <Input
                              value={resultConfig.measuredUnitCustomLabel}
                              disabled={disableForm}
                              onChange={(e) => onMeasuredUnitCustomLabelChange?.(e.target.value)}
                              placeholder="Np. trafienia"
                            />
                          </div>
                        )}

                        {!measuredIsPlace && (
                          <>
                            <div className="space-y-2">
                              <div className="text-xs font-semibold text-slate-300">Lepszy wynik</div>
                              <Select<CustomBetterResult>
                                value={resultConfig.measuredBetterResult}
                                disabled={disableForm}
                                onChange={(value) => onMeasuredBetterResultChange?.(value)}
                                options={CUSTOM_BETTER_RESULT_OPTIONS}
                                ariaLabel="Lepszy wynik mierzalny"
                              />
                            </div>

                            <div className="space-y-2">
                              <div className="text-xs font-semibold text-slate-300">Miejsca po przecinku</div>
                              <Select<number>
                                value={resultConfig.measuredDecimalPlaces ?? 0}
                                disabled={disableForm}
                                onChange={(value) => onMeasuredDecimalPlacesChange?.(value)}
                                options={DECIMAL_PLACES_OPTIONS}
                                ariaLabel="Miejsca po przecinku"
                              />
                            </div>
                          </>
                        )}
                      </>
                    )}

                    <div className="space-y-2">
                      <div className="text-xs font-semibold text-slate-300">Remisy</div>
                      <Select<BooleanSelectValue>
                        value={boolToSelectValue(resultConfig.measuredAllowTies)}
                        disabled={disableForm}
                        onChange={(value) => onMeasuredAllowTiesChange?.(selectValueToBool(value))}
                        options={BOOLEAN_SELECT_OPTIONS}
                        ariaLabel="Remisy w wyniku mierzalnym"
                      />
                    </div>

                  </div>
                </div>
              )}
            </div>
          )}

          {isMassStart && (
            <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-300">Typ wyniku</div>
                <Select<CustomMassStartValueKind>
                  value={resultConfig.massStartValueKind}
                  disabled={disableForm}
                  onChange={(value) => onMassStartValueKindChange?.(value)}
                  options={MASS_START_VALUE_KIND_OPTIONS}
                  ariaLabel="Typ wyniku wszyscy razem"
                />
              </div>

              {massStartIsTime ? (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-300">Format czasu</div>
                  <Select<CustomTimeFormat>
                    value={resultConfig.massStartTimeFormat ?? "MM:SS.hh"}
                    disabled={disableForm}
                    onChange={(value) => onMassStartTimeFormatChange?.(value)}
                    options={CUSTOM_TIME_FORMAT_OPTIONS}
                    ariaLabel="Format czasu wszyscy razem"
                  />
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-300">Jednostka</div>
                    <Select<CustomUnitPreset>
                      value={resultConfig.massStartUnitPreset}
                      disabled={disableForm}
                      onChange={(value) => onMassStartUnitPresetChange?.(value)}
                      options={UNIT_PRESET_OPTIONS}
                      ariaLabel="Jednostka wszyscy razem"
                    />
                  </div>

                  {massStartUsesCustomUnit && (
                    <div className="space-y-2">
                      <div className="text-xs font-semibold text-slate-300">Własna jednostka</div>
                      <Input
                        value={resultConfig.massStartUnitCustomLabel}
                        disabled={disableForm}
                        onChange={(e) => onMassStartUnitCustomLabelChange?.(e.target.value)}
                        placeholder="Np. próby"
                      />
                    </div>
                  )}

                  {!massStartIsPlace && (
                    <>
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-slate-300">Lepszy wynik</div>
                        <Select<CustomBetterResult>
                          value={resultConfig.massStartBetterResult}
                          disabled={disableForm}
                          onChange={(value) => onMassStartBetterResultChange?.(value)}
                          options={CUSTOM_BETTER_RESULT_OPTIONS}
                          ariaLabel="Lepszy wynik wszyscy razem"
                        />
                      </div>

                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-slate-300">Miejsca po przecinku</div>
                        <Select<number>
                          value={resultConfig.massStartDecimalPlaces ?? 0}
                          disabled={disableForm}
                          onChange={(value) => onMassStartDecimalPlacesChange?.(value)}
                          options={DECIMAL_PLACES_OPTIONS}
                          ariaLabel="Miejsca po przecinku wszyscy razem"
                        />
                      </div>
                    </>
                  )}
                </>
              )}

              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-300">Remisy</div>
                <Select<BooleanSelectValue>
                  value={boolToSelectValue(resultConfig.massStartAllowTies)}
                  disabled={disableForm}
                  onChange={(value) => onMassStartAllowTiesChange?.(selectValueToBool(value))}
                  options={BOOLEAN_SELECT_OPTIONS}
                  ariaLabel="Remisy wszyscy razem"
                />
              </div>

              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-300">Rundy / próby domyślnie</div>
                <NumberInput
                  value={resultConfig.massStartRoundsCount}
                  min={1}
                  max={20}
                  disabled={disableForm}
                  onChange={onMassStartRoundsCountChange ?? (() => undefined)}
                />
              </div>

              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-300">Domyślne liczenie wyniku</div>
                <Select<CustomAggregationMode>
                  value={resultConfig.massStartAggregationMode}
                  disabled={disableForm}
                  onChange={(value) => onMassStartAggregationModeChange?.(value)}
                  options={AGGREGATION_MODE_OPTIONS}
                  ariaLabel="Agregacja wyniku wszyscy razem"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {isCustomDiscipline && isHeadToHead && (
        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="text-sm font-semibold text-white">Parametry formatu</div>

          {resultConfig.headToHeadMode === "POINTS_TABLE" && (
            <div className="mt-4 rounded-2xl border border-white/10 bg-black/10 p-4">
              <div className="text-sm font-semibold text-white">Model meczu / serii</div>
              <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-300">Model meczu / serii</div>
                  <Select<CustomMatchSeriesMode>
                    value={customSeriesMode}
                    disabled={disableForm}
                    onChange={handleCustomSeriesModeChange}
                    options={CUSTOM_MATCH_SERIES_OPTIONS}
                    ariaLabel="Model meczu / serii"
                  />
                </div>
              </div>
            </div>
          )}

          {resultConfig.headToHeadMode === "MEASURED_RESULT" && (
            <div className="mt-4 rounded-2xl border border-white/10 bg-black/10 p-4">
              <div className="text-sm font-semibold text-white">Model pojedynku</div>
              <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-300">Liczba prób / rund w pojedynku</div>
                  <NumberInput
                    value={resultConfig.roundsCount}
                    min={1}
                    max={10}
                    disabled={disableForm}
                    onChange={onHeadToHeadRoundsCountChange ?? (() => undefined)}
                  />
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-300">Jak liczyć wynik prób</div>
                  <Select<CustomAggregationMode>
                    value={resultConfig.aggregationMode}
                    disabled={disableForm}
                    onChange={(value) => onHeadToHeadAggregationModeChange?.(value)}
                    options={AGGREGATION_MODE_OPTIONS}
                    ariaLabel="Agregacja prób w pojedynku"
                  />
                </div>
              </div>
            </div>
          )}

          {format === "LEAGUE" && (
            <div className="mt-4 rounded-2xl border border-white/10 bg-black/10 p-4">
              <div className="text-sm font-semibold text-white">{isWrestling ? "Zapasy" : "Liga"}</div>
              <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-300">Mecze każdy z każdym</div>
                  <Select<1 | 2>
                    value={leagueMatches}
                    disabled={disableForm}
                    onChange={onLeagueMatchesChange}
                    options={[
                      { value: 1, label: "1 mecz (bez rewanżu)" },
                      { value: 2, label: "2 mecze (rewanż)" },
                    ]}
                    ariaLabel="Liga - liczba meczów"
                  />
                </div>

                <div className="space-y-2 md:col-span-2 xl:col-span-2">
                  <div className="text-xs font-semibold text-slate-300">Rozstrzygnięcie meczu po czasie podstawowym</div>
                  <Select<CustomGroupResolutionMode>
                    value={customGroupResolutionMode}
                    disabled={disableForm}
                    onChange={handleCustomGroupResolutionModeChange}
                    options={CUSTOM_GROUP_RESOLUTION_OPTIONS}
                    ariaLabel="Rozstrzygnięcie meczu ligowego"
                  />
                </div>
              </div>
            </div>
          )}

          {format === "MIXED" && (
            <div className="mt-4 space-y-4">
              <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                <div className="text-sm font-semibold text-white">Faza grupowa</div>
                <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-300">Liczba grup</div>
                    <Input
                      type="number"
                      min={1}
                      max={maxGroupsForMin2PerGroup}
                      disabled={disableForm}
                      value={groupsCount}
                      onChange={(e) => onGroupsCountChange(Number(e.target.value))}
                    />
                    {groupSizes.length > 0 && (
                      <div className="text-xs text-slate-400">
                        Rozmiary grup: {groupSizes.join(", ")} (min: {minGroupSize})
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-300">Mecze w grupach</div>
                    <Select<1 | 2>
                      value={groupMatches}
                      disabled={disableForm}
                      onChange={onGroupMatchesChange}
                      options={MATCHES_COUNT_OPTIONS}
                      ariaLabel="Grupy - mecze"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-300">Awans z grupy</div>
                    <Select<number>
                      value={advanceFromGroup}
                      disabled={disableForm || minGroupSize < 2}
                      onChange={onAdvanceFromGroupChange}
                      options={advanceOptions.map((v) => ({ value: v, label: String(v) }))}
                      ariaLabel="Awans z grupy"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-300">Rozstrzygnięcie meczu po czasie podstawowym</div>
                    <Select<CustomGroupResolutionMode>
                      value={customGroupResolutionMode}
                      disabled={disableForm}
                      onChange={handleCustomGroupResolutionModeChange}
                      options={CUSTOM_GROUP_RESOLUTION_OPTIONS}
                      ariaLabel="Rozstrzygnięcie meczu grupowego"
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                <div className="text-sm font-semibold text-white">Faza pucharowa</div>
                <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-300">Rundy (mecze)</div>
                    <Select<1 | 2>
                      value={cupMatches}
                      disabled={disableForm}
                      onChange={onCupMatchesChange}
                      options={MATCHES_COUNT_ROUNDS_OPTIONS}
                      ariaLabel="Puchar - liczba meczów"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-300">Finał</div>
                    <Select<1 | 2>
                      value={finalMatches}
                      disabled={disableForm}
                      onChange={onFinalMatchesChange}
                      options={[
                        { value: 1, label: "1 mecz" },
                        { value: 2, label: "2 mecze" },
                      ]}
                      ariaLabel="Puchar - finał"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-300">Mecz o 3. miejsce</div>
                    <Select<ThirdPlaceSelectValue>
                      value={thirdPlaceValue}
                      disabled={disableForm}
                      onChange={handleThirdPlaceSelectChange}
                      options={THIRD_PLACE_OPTIONS}
                      ariaLabel="Puchar - mecz o 3. miejsce"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-300">Rozstrzygnięcie remisu w fazie pucharowej</div>
                    <Select<CustomKnockoutResolutionMode>
                      value={customKnockoutResolutionMode}
                      disabled={disableForm}
                      onChange={handleCustomKnockoutResolutionModeChange}
                      options={CUSTOM_KNOCKOUT_RESOLUTION_OPTIONS}
                      ariaLabel="Rozstrzygnięcie remisu w fazie pucharowej"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {format === "CUP" && (
            <div className="mt-4 rounded-2xl border border-white/10 bg-black/10 p-4">
              <div className="text-sm font-semibold text-white">Faza pucharowa</div>
              <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-300">Rundy (mecze)</div>
                  <Select<1 | 2>
                    value={cupMatches}
                    disabled={disableForm}
                    onChange={onCupMatchesChange}
                    options={MATCHES_COUNT_ROUNDS_OPTIONS}
                    ariaLabel="Puchar - liczba meczów"
                  />
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-300">Finał</div>
                  <Select<1 | 2>
                    value={finalMatches}
                    disabled={disableForm}
                    onChange={onFinalMatchesChange}
                    options={[
                      { value: 1, label: "1 mecz" },
                      { value: 2, label: "2 mecze" },
                    ]}
                    ariaLabel="Puchar - finał"
                  />
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-300">Mecz o 3. miejsce</div>
                  <Select<ThirdPlaceSelectValue>
                    value={thirdPlaceValue}
                    disabled={disableForm}
                    onChange={handleThirdPlaceSelectChange}
                    options={THIRD_PLACE_OPTIONS}
                    ariaLabel="Puchar - mecz o 3. miejsce"
                  />
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-300">Rozstrzygnięcie remisu w fazie pucharowej</div>
                  <Select<CustomKnockoutResolutionMode>
                    value={customKnockoutResolutionMode}
                    disabled={disableForm}
                    onChange={handleCustomKnockoutResolutionModeChange}
                    options={CUSTOM_KNOCKOUT_RESOLUTION_OPTIONS}
                    ariaLabel="Rozstrzygnięcie remisu w fazie pucharowej"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {isCustomDiscipline && isMassStart && (
        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="text-sm font-semibold text-white">Struktura rywalizacji</div>

          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-300">Liczba aktywnych etapów</div>
              <Select<1 | 2 | 3>
                value={activeStagesCount}
                disabled={disableForm}
                onChange={handleActiveStagesChange}
                options={ACTIVE_STAGES_OPTIONS}
                ariaLabel="Liczba aktywnych etapów"
              />
            </div>
          </div>

          <div className="mt-4 space-y-4">
            {resultConfig.stages.slice(0, activeStagesCount).map((stage, index) => {
              const activeStages = resultConfig.stages.slice(0, activeStagesCount);
              const previousStageParticipants =
                index === 0
                  ? participants
                  : activeStages[index - 1].advanceCount ?? activeStages[index - 1].participantsCount ?? participants;

              return (
                <StageCard
                  key={stage.id}
                  index={index}
                  stage={stage}
                  disabled={disableForm}
                  isLastActiveStage={index === activeStagesCount - 1}
                  totalParticipants={participants}
                  previousStageParticipants={previousStageParticipants}
                  stageWarnings={getStageWarnings(
                    stage,
                    index,
                    activeStagesCount,
                    participants,
                    index > 0 ? activeStages[index - 1] : null
                  )}
                  onChange={(patch) => {
                    onStageChange?.(stage.id, patch);

                    if (!onStageChange) {
                      return;
                    }

                    if (patch.advanceCount !== undefined) {
                      const nextStage = activeStages[index + 1];
                      if (nextStage) {
                        onStageChange(nextStage.id, {
                          participantsCount: patch.advanceCount,
                        });
                      }
                    }
                  }}
                />
              );
            })}
          </div>
        </div>
      )}

      {showStandardFormatConfig && (
        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="text-sm font-semibold text-white">Parametry formatu</div>

          <div className="mt-4">
            <FormatCopyBar
              disableForm={disableForm}
              canEditDivisions={canEditDivisions}
              copyDivisionOptions={copyDivisionOptions}
              copySourceDivisionId={copySourceDivisionId}
              onCopySourceDivisionChange={onCopySourceDivisionChange}
              onCopyFormatFromDivision={onCopyFormatFromDivision}
            />
          </div>

          <div className="mt-4 space-y-4">
            {((showLeagueOrGroupConfig && format === "LEAGUE") || isWrestling) && (
              <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                <div className="text-sm font-semibold text-white">Liga</div>

                <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  {!isWrestling ? (
                    <div className="space-y-2">
                      <div className="text-xs font-semibold text-slate-300">Mecze każdy z każdym</div>
                      <Select<1 | 2>
                        value={leagueMatches}
                        disabled={disableForm}
                        onChange={onLeagueMatchesChange}
                        options={[
                          { value: 1, label: "1 mecz (bez rewanżu)" },
                          { value: 2, label: "2 mecze (rewanż)" },
                        ]}
                        ariaLabel="Liga - liczba meczów"
                      />
                    </div>
                  ) : null}

                  {isTennis && (
                    <>
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-slate-300">Format meczu</div>
                        <Select<TennisBestOf>
                          value={tennisBestOf}
                          disabled={disableForm}
                          onChange={onTennisBestOfChange}
                          options={TENNIS_BEST_OF_OPTIONS}
                          ariaLabel="Tenis - best of"
                        />
                      </div>

                      <div className="space-y-2 md:col-span-2 xl:col-span-2">
                        <div className="text-xs font-semibold text-slate-300">System klasyfikacji</div>
                        <Select<TennisPointsMode>
                          value={tennisPointsMode}
                          disabled={disableForm}
                          onChange={onTennisPointsModeChange}
                          options={TENNIS_POINTS_MODE_OPTIONS}
                          ariaLabel="Tenis - system klasyfikacji"
                        />
                        <div className="text-xs text-slate-400">
                          {TENNIS_POINTS_MODE_OPTIONS.find((x) => x.value === tennisPointsMode)?.description}
                        </div>
                      </div>
                    </>
                  )}

                  {isHandball && (
                    <>
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-slate-300">Punktacja</div>
                        <Select<HandballPointsMode>
                          value={hbPointsMode}
                          disabled={disableForm}
                          onChange={onHbPointsModeChange}
                          options={HB_POINTS_OPTIONS}
                          ariaLabel="Piłka ręczna - punktacja"
                        />
                      </div>

                      <div className="space-y-2 md:col-span-2 xl:col-span-2">
                        <div className="text-xs font-semibold text-slate-300">Rozstrzyganie meczów</div>
                        <Select<HandballTableDrawMode>
                          value={hbTableDrawMode}
                          disabled={disableForm || hbPointsMode === "3_2_1_0"}
                          onChange={onHbTableDrawModeChange}
                          options={HB_TABLE_DRAW_OPTIONS}
                          ariaLabel="Piłka ręczna - remisy"
                        />
                      </div>
                    </>
                  )}

                  {isBasketball && (
                    <>
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-slate-300">Rozstrzyganie remisu</div>
                        <Select<BasketballResolutionMode>
                          value={basketballResolutionMode}
                          disabled={disableForm}
                          onChange={onBasketballResolutionModeChange}
                          options={BASKETBALL_RESOLUTION_OPTIONS}
                          ariaLabel="Koszykówka - rozstrzyganie remisu"
                        />
                      </div>

                      <div className="space-y-2 md:col-span-2 xl:col-span-2">
                        <div className="text-xs font-semibold text-slate-300">Zasada</div>
                        <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-200">
                          Remis po czasie podstawowym jest rozstrzygany dogrywką. Karne nie są dostępne.
                        </div>
                      </div>
                    </>
                  )}
                  {isWrestling && (
                    <>
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-slate-300">Styl</div>
                        <Select<WrestlingStyle>
                          value={wrestlingStyle}
                          disabled={disableForm}
                          onChange={(value) => onWrestlingStyleChange?.(value)}
                          options={WRESTLING_STYLE_OPTIONS}
                          ariaLabel="Zapasy - styl"
                        />
                      </div>

                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-slate-300">Tryb zawodów</div>
                        <Select<WrestlingCompetitionMode>
                          value={wrestlingCompetitionMode}
                          disabled={disableForm}
                          onChange={(value) => onWrestlingCompetitionModeChange?.(value)}
                          options={WRESTLING_COMPETITION_MODE_OPTIONS}
                          ariaLabel="Zapasy - tryb zawodów"
                        />
                      </div>

                      <div className="space-y-2 md:col-span-2 xl:col-span-2">
                        <div className="text-xs font-semibold text-slate-300">Zasada</div>
                        <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-200">
                          Zapasy działają jako dyscyplina indywidualna w modelu pojedynków. Klasyczny format turnieju nie jest tu wybierany osobno - strukturę zawodów definiuje tryb zawodów. Kategorie Women, U20, U17 i U15 konfiguruj przez dywizje.
                        </div>
                      </div>
                    </>
                  )}

                  {isBasketball && (
                    <>
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-slate-300">Rozstrzyganie remisu</div>
                        <Select<BasketballResolutionMode>
                          value={basketballResolutionMode}
                          disabled={disableForm}
                          onChange={onBasketballResolutionModeChange}
                          options={BASKETBALL_RESOLUTION_OPTIONS}
                          ariaLabel="Koszykówka - rozstrzyganie remisu"
                        />
                      </div>

                      <div className="space-y-2 md:col-span-2 xl:col-span-2">
                        <div className="text-xs font-semibold text-slate-300">Zasada</div>
                        <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-200">
                          Remis po czasie podstawowym jest rozstrzygany dogrywką. Karne nie są dostępne.
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {showLeagueOrGroupConfig && format === "MIXED" && (
              <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                <div className="text-sm font-semibold text-white">Faza grupowa</div>

                <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-300">Liczba grup</div>
                    <Input
                      type="number"
                      min={1}
                      max={maxGroupsForMin2PerGroup}
                      disabled={disableForm}
                      value={groupsCount}
                      onChange={(e) => onGroupsCountChange(Number(e.target.value))}
                    />
                    {groupSizes.length > 0 && (
                      <div className="text-xs text-slate-400">
                        Rozmiary grup: {groupSizes.join(", ")} (min: {minGroupSize})
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-300">Mecze w grupach</div>
                    <Select<1 | 2>
                      value={groupMatches}
                      disabled={disableForm}
                      onChange={onGroupMatchesChange}
                      options={MATCHES_COUNT_OPTIONS}
                      ariaLabel="Grupy - mecze"
                    />
                  </div>

                  <div className="space-y-2 md:col-span-2 xl:col-span-2">
                    <div className="text-xs font-semibold text-slate-300">Awans z grupy</div>
                    <Select<number>
                      value={advanceFromGroup}
                      disabled={disableForm || minGroupSize < 2}
                      onChange={onAdvanceFromGroupChange}
                      options={advanceOptions.map((v) => ({ value: v, label: String(v) }))}
                      ariaLabel="Awans z grupy"
                    />
                  </div>

                  {isTennis && (
                    <>
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-slate-300">Format meczu</div>
                        <Select<TennisBestOf>
                          value={tennisBestOf}
                          disabled={disableForm}
                          onChange={onTennisBestOfChange}
                          options={TENNIS_BEST_OF_OPTIONS}
                          ariaLabel="Tenis - best of"
                        />
                      </div>

                      <div className="space-y-2 md:col-span-2 xl:col-span-2">
                        <div className="text-xs font-semibold text-slate-300">System klasyfikacji</div>
                        <Select<TennisPointsMode>
                          value={tennisPointsMode}
                          disabled={disableForm}
                          onChange={onTennisPointsModeChange}
                          options={TENNIS_POINTS_MODE_OPTIONS}
                          ariaLabel="Tenis - system klasyfikacji"
                        />
                      </div>
                    </>
                  )}

                  {isHandball && (
                    <>
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-slate-300">Punktacja</div>
                        <Select<HandballPointsMode>
                          value={hbPointsMode}
                          disabled={disableForm}
                          onChange={onHbPointsModeChange}
                          options={HB_POINTS_OPTIONS}
                          ariaLabel="Piłka ręczna - punktacja"
                        />
                      </div>

                      <div className="space-y-2 md:col-span-2 xl:col-span-2">
                        <div className="text-xs font-semibold text-slate-300">Rozstrzyganie meczów</div>
                        <Select<HandballTableDrawMode>
                          value={hbTableDrawMode}
                          disabled={disableForm || hbPointsMode === "3_2_1_0"}
                          onChange={onHbTableDrawModeChange}
                          options={HB_TABLE_DRAW_OPTIONS}
                          ariaLabel="Piłka ręczna - remisy"
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {showKnockoutConfig && (
              <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                <div className="text-sm font-semibold text-white">Faza pucharowa</div>

                <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-300">Rundy (mecze)</div>
                    <Select<1 | 2>
                      value={cupMatches}
                      disabled={disableForm || isTennis}
                      onChange={onCupMatchesChange}
                      options={MATCHES_COUNT_ROUNDS_OPTIONS}
                      ariaLabel="Puchar - liczba meczów"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-300">Finał</div>
                    <Select<1 | 2>
                      value={finalMatches}
                      disabled={disableForm || isTennis}
                      onChange={onFinalMatchesChange}
                      options={[
                        { value: 1, label: "1 mecz" },
                        { value: 2, label: "2 mecze" },
                      ]}
                      ariaLabel="Puchar - finał"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-300">Mecz o 3. miejsce</div>
                    <Select<ThirdPlaceSelectValue>
                      value={isTennis ? "ONE_MATCH" : thirdPlaceValue}
                      disabled={disableForm || isTennis}
                      onChange={handleThirdPlaceSelectChange}
                      options={THIRD_PLACE_OPTIONS}
                      ariaLabel="Puchar - mecz o 3. miejsce"
                    />
                  </div>

                  {isTennis && (
                    <div className="space-y-2">
                      <div className="text-xs font-semibold text-slate-300">Format meczu</div>
                      <Select<TennisBestOf>
                        value={tennisBestOf}
                        disabled={disableForm}
                        onChange={onTennisBestOfChange}
                        options={TENNIS_BEST_OF_OPTIONS}
                        ariaLabel="Tenis - format meczu w pucharze"
                      />
                    </div>
                  )}

                  {isHandball && (
                    <div className="space-y-2 md:col-span-2 xl:col-span-3">
                      <div className="text-xs font-semibold text-slate-300">Rozstrzyganie remisów</div>
                      <Select<HandballKnockoutTiebreak>
                        value={hbKnockoutTiebreak}
                        disabled={disableForm}
                        onChange={onHbKnockoutTiebreakChange}
                        options={HB_KNOCKOUT_TIEBREAK_OPTIONS}
                        ariaLabel="Puchar - rozstrzyganie remisów"
                      />
                    </div>
                  )}

                  {isBasketball && (
                    <div className="space-y-2 md:col-span-2 xl:col-span-3">
                      <div className="text-xs font-semibold text-slate-300">Rozstrzyganie remisów</div>
                      <Select<BasketballResolutionMode>
                        value={basketballResolutionMode}
                        disabled={disableForm}
                        onChange={onBasketballResolutionModeChange}
                        options={BASKETBALL_RESOLUTION_OPTIONS}
                        ariaLabel="Koszykówka - rozstrzyganie remisów w pucharze"
                      />
                      <div className="text-xs text-slate-400">
                        Remis po czasie podstawowym jest rozstrzygany dogrywką. Karne nie są dostępne.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

export function SummaryCard({
  isTournamentCreated,
  discipline,
  format,
  participants,
  preview,
  isAssistantReadOnly,
  competitionType = "INDIVIDUAL",
  competitionModel = "MASS_START",
  customDisciplineName = "",
  resultConfig = getDefaultResultConfig(),
  basketballResolutionMode = "OVERTIME_ONLY",
  wrestlingStyle = "FREESTYLE",
  wrestlingCompetitionMode = "AUTO",
}: {
  isTournamentCreated: boolean;
  discipline: Discipline;
  format: TournamentFormat;
  participants: number;
  preview: MatchesPreview;
  isAssistantReadOnly: boolean;
  competitionType?: CompetitionType;
  competitionModel?: CompetitionModel;
  customDisciplineName?: string;
  resultConfig?: TournamentResultConfig;
  basketballResolutionMode?: BasketballResolutionMode;
  wrestlingStyle?: WrestlingStyle;
  wrestlingCompetitionMode?: WrestlingCompetitionMode;
}) {
  const isCustomDiscipline = discipline === "custom";
  const isWrestling = discipline === "wrestling";
  const isHeadToHead = competitionModel === "HEAD_TO_HEAD";
  const isMassStart = competitionModel === "MASS_START";

  const customSeriesMode = deriveSeriesMode(resultConfig);
  const customGroupResolutionMode = deriveGroupResolutionMode(resultConfig);
  const customKnockoutResolutionMode = deriveKnockoutResolutionMode(resultConfig);

  return (
    <Card
      className={cn(
        "relative min-h-[26rem] overflow-hidden p-6",
        !isTournamentCreated && "pointer-events-none opacity-60 blur-[1px]"
      )}
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 left-1/2 h-48 w-[28rem] -translate-x-1/2 rounded-full bg-indigo-500/15 blur-3xl" />
        <div className="absolute -bottom-24 left-1/2 h-48 w-[28rem] -translate-x-1/2 rounded-full bg-sky-500/10 blur-3xl" />
      </div>

      <div className="relative">
        <div className="min-w-0">
          <div className="text-base font-semibold text-white">Podsumowanie</div>
          <div className="mt-1 text-sm text-slate-300">Ogólne informacje o turnieju oraz skrót aktywnej dywizji.</div>
        </div>

        <div className="mt-4 grid gap-2">
          <StatRow label="Dyscyplina" value={disciplineLabel(discipline, customDisciplineName)} />
          {!isCustomDiscipline || isHeadToHead ? <StatRow label="Format" value={formatLabel(format)} /> : null}
        </div>

        <div className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">Podsumowanie dywizji</div>

        <div className="mt-2 grid gap-2">
          {!isCustomDiscipline ? (
            <>
              <StatRow label="Uczestnicy" value={participants} />
              {format === "MIXED" && (
                <>
                  <StatRow label="Liczba grup" value={preview.groups} />
                  <StatRow label="Awansujących do pucharu" value={preview.advancing} />
                </>
              )}
              {format !== "CUP" && <StatRow label="Mecze fazy tabeli" value={preview.groupTotal} />}
              {format !== "LEAGUE" && <StatRow label="Mecze fazy pucharowej" value={preview.koTotal} />}
              {discipline === "basketball" ? (
                <StatRow label="Rozstrzyganie remisu" value={basketballResolutionModeLabel(basketballResolutionMode)} />
              ) : null}
              {isWrestling ? <StatRow label="Styl" value={getLabel(WRESTLING_STYLE_LABELS, wrestlingStyle, WRESTLING_STYLE_LABELS.FREESTYLE)} /> : null}
              {isWrestling ? (
                <StatRow
                  label="Tryb zawodów"
                  value={wrestlingCompetitionModeLabel(wrestlingCompetitionMode)}
                />
              ) : null}
              <StatRow label="Szac. łączna liczba meczów" value={preview.total} />
            </>
          ) : (
            <>
              <StatRow label="Uczestnicy" value={participants} />
              <StatRow label="Typ uczestnictwa" value={competitionTypeLabel(competitionType)} />
              <StatRow label="Model rywalizacji" value={competitionModelLabel(competitionModel)} />

              {isHeadToHead && (
                <>
                  <StatRow
                    label="Tryb wyniku"
                    value={headToHeadModeLabel(resultConfig.headToHeadMode)}
                  />

                  {resultConfig.headToHeadMode === "POINTS_TABLE" ? (
                    <>
                      <StatRow
                        label="Punktacja podstawowa"
                        value={`${resultConfig.pointsWin} / ${resultConfig.pointsDraw} / ${resultConfig.pointsLoss}`}
                      />
                      <StatRow
                        label="Rozstrzygnięcie grupowe"
                        value={groupResolutionModeLabel(customGroupResolutionMode)}
                      />
                      <StatRow
                        label="Model meczu / serii"
                        value={matchSeriesModeLabel(customSeriesMode)}
                      />
                    </>
                  ) : (
                    <>
                      <StatRow
                        label="Wynik mierzalny"
                        value={measuredSummary(resultConfig)}
                      />
                      <StatRow
                        label="Próby w pojedynku"
                        value={`${resultConfig.roundsCount} • ${aggregationModeLabel(resultConfig.aggregationMode)}`}
                      />
                    </>
                  )}
                </>
              )}

              {isMassStart && (
                <>
                  <StatRow label="Typ wyniku" value={massStartValueKindLabel(resultConfig.massStartValueKind)} />
                  <StatRow label="Jednostka / ranking" value={massStartSummary(resultConfig)} />
                  <StatRow
                    label="Rundy domyślne"
                    value={`${resultConfig.massStartRoundsCount} • ${aggregationModeLabel(resultConfig.massStartAggregationMode)}`}
                  />
                  <StatRow label="Liczba etapów" value={getActiveStagesCount(resultConfig.stages)} />
                </>
              )}
            </>
          )}
        </div>

        {isCustomDiscipline && isMassStart && getActiveStagesCount(resultConfig.stages) > 0 && (
          <div className="mt-4 space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Etapy
            </div>

            <div className="space-y-2">
              {resultConfig.stages.slice(0, getActiveStagesCount(resultConfig.stages)).map((stage, index) => (
                <div
                  key={stage.id}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2"
                >
                  <div className="text-sm font-semibold text-white">
                    {index + 1}. {stage.name || `Etap ${index + 1}`}
                  </div>
                  <div className="mt-1 text-xs leading-relaxed text-slate-300">
                    grupy: {stage.groupsCount} • uczestnicy: {stage.participantsCount ?? "-"} • awans: {stage.advanceCount ?? "-"} • rundy: {stage.roundsCount}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {isAssistantReadOnly && (
          <div className="mt-4">
            <InlineAlert variant="info" title="Tryb podglądu">
              Jako asystent nie możesz zmieniać konfiguracji bez uprawnienia "tournament_edit".
            </InlineAlert>
          </div>
        )}
      </div>
    </Card>
  );
}

export function getDefaultStages(): CustomStageConfig[] {
  return [
    {
      id: "stage-1",
      name: "Etap 1",
      groupsCount: 1,
      participantsCount: null,
      advanceCount: null,
      roundsCount: 1,
      aggregationMode: "BEST",
      contributesToFinalRanking: false,
    },
    {
      id: "stage-2",
      name: "Etap 2",
      groupsCount: 1,
      participantsCount: null,
      advanceCount: null,
      roundsCount: 1,
      aggregationMode: "BEST",
      contributesToFinalRanking: false,
    },
    {
      id: "stage-3",
      name: "Etap 3",
      groupsCount: 1,
      participantsCount: null,
      advanceCount: null,
      roundsCount: 1,
      aggregationMode: "BEST",
      contributesToFinalRanking: false,
    },
  ];
}

export function getDefaultResultConfig(): TournamentResultConfig {
  return {
    competition_model: "MASS_START",

    headToHeadMode: "POINTS_TABLE",
    allowDraw: true,
    allowOvertime: false,
    allowShootout: false,

    pointsWin: 3,
    pointsDraw: 1,
    pointsLoss: 0,
    pointsOvertimeWin: 2,
    pointsOvertimeLoss: 1,
    pointsShootoutWin: 2,
    pointsShootoutLoss: 1,

    customMatchSeriesMode: "ONE_MATCH",
    groupResolutionMode: "DRAW_ALLOWED",
    knockoutResolutionMode: "OVERTIME_DECIDING_SHOTS",
    legsCount: 1,
    bestOf: null,
    roundsCount: 1,
    aggregationMode: "SUM",

    measuredValueKind: "NUMBER",
    measuredUnitPreset: "POINTS",
    measuredUnitCustomLabel: "",
    measuredBetterResult: "HIGHER",
    measuredDecimalPlaces: 0,
    measuredTimeFormat: null,
    measuredAllowTies: true,

    massStartValueKind: "TIME",
    massStartUnitPreset: "SECONDS",
    massStartUnitCustomLabel: "",
    massStartBetterResult: "LOWER",
    massStartDecimalPlaces: 0,
    massStartTimeFormat: "MM:SS.hh",
    massStartAllowTies: true,
    massStartRoundsCount: 1,
    massStartAggregationMode: "BEST",
    stages: [
      {
        id: "stage-1",
        name: "Etap 1",
        groupsCount: 1,
        participantsCount: null,
        advanceCount: null,
        roundsCount: 1,
        aggregationMode: "BEST",
        contributesToFinalRanking: false,
      },
      {
        id: "stage-2",
        name: "Etap 2",
        groupsCount: 1,
        participantsCount: null,
        advanceCount: null,
        roundsCount: 1,
        aggregationMode: "BEST",
        contributesToFinalRanking: false,
      },
      {
        id: "stage-3",
        name: "Etap 3",
        groupsCount: 1,
        participantsCount: null,
        advanceCount: null,
        roundsCount: 1,
        aggregationMode: "BEST",
        contributesToFinalRanking: false,
      },
    ],
  };
}