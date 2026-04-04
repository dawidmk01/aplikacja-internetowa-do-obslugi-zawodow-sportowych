// frontend/src/pages/TournamentBasicsSetup.tsx
// Strona obsługuje konfigurację podstawowych parametrów turnieju przed kolejnymi etapami.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";

import { apiFetch } from "../api";
import { useTournamentFlowGuard } from "../flow/TournamentFlowGuardContext";

import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { InlineAlert } from "../ui/InlineAlert";
import { toast } from "../ui/Toast";

import TournamentFlowNav from "../components/TournamentFlowNav";

import {
  BasicsCard,
  ConfirmModal,
  StructureCard,
  SummaryCard,
  getDefaultResultConfig,
  type CompetitionModel,
  type CompetitionType,
  type CustomAggregationMode,
  type CustomBetterResult,
  type CustomHeadToHeadMode,
  type CustomMassStartValueKind,
  type CustomMeasuredValueKind,
  type CustomStageConfig,
  type CustomTimeFormat,
  type CustomUnitPreset,
  type Discipline,
  type HandballKnockoutTiebreak,
  type HandballPointsMode,
  type HandballTableDrawMode,
  type MatchesPreview,
  type TennisBestOf,
  type TennisPointsMode,
  type TournamentFormat,
  type TournamentResultConfig,
} from "./_components/TournamentBasicsSetupView";

type TournamentDTO = {
  id: number;
  name: string;
  description?: string | null;
  discipline: Discipline;
  tournament_format: TournamentFormat;
  format_config: Record<string, any>;
  status?: "DRAFT" | "CONFIGURED" | "RUNNING" | "FINISHED";
  my_role?: "ORGANIZER" | "ASSISTANT" | null;
  my_permissions?: Record<string, boolean>;
};

type TeamDTO = { id: number; name: string };

function clampInt(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function defaultGroupsCountFor4PerGroup(participants: number) {
  const p = Math.max(2, Math.trunc(participants));
  return Math.max(1, Math.ceil(p / 4));
}

function splitIntoGroups(participants: number, groupsCount: number): number[] {
  const p = Math.max(0, Math.trunc(participants));
  const g = clampInt(groupsCount, 1, Math.max(1, p));
  const base = Math.floor(p / g);
  const extra = p % g;

  const sizes: number[] = [];
  for (let i = 0; i < g; i++) sizes.push(i < extra ? base + 1 : base);
  return sizes;
}

function roundRobinMatches(size: number, matchesPerPair: 1 | 2) {
  if (size < 2) return 0;
  return ((size * (size - 1)) / 2) * matchesPerPair;
}

function isPowerOfTwo(n: number) {
  if (n < 1) return false;
  return (n & (n - 1)) === 0;
}

function pickFirstError(payload: any): string | null {
  if (!payload) return null;
  if (typeof payload === "string") return payload;
  if (typeof payload?.detail === "string") return payload.detail;

  const tryKeys = ["non_field_errors", "name", "description", "discipline", "tournament_format"];
  for (const k of tryKeys) {
    const v = payload?.[k];
    if (typeof v === "string") return v;
    if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  }

  const anyKey = Object.keys(payload || {})[0];
  const anyVal = anyKey ? payload?.[anyKey] : null;
  if (typeof anyVal === "string") return anyVal;
  if (Array.isArray(anyVal) && typeof anyVal[0] === "string") return anyVal[0];

  return null;
}



type BackendCustomStageConfig = {
  id?: string;
  name?: string;
  groups_count?: number | null;
  participants_count?: number | null;
  advance_count?: number | null;
  rounds_count?: number | null;
  aggregation_mode?: CustomAggregationMode | null;
};

const RESULT_CONFIG_KEY_MAP = {
  headToHeadMode: "head_to_head_mode",
  customMatchSeriesMode: "custom_match_series_mode",
  groupResolutionMode: "group_resolution_mode",
  knockoutResolutionMode: "knockout_resolution_mode",
  allowDraw: "allow_draw",
  allowOvertime: "allow_overtime",
  allowShootout: "allow_shootout",
  pointsWin: "points_win",
  pointsDraw: "points_draw",
  pointsLoss: "points_loss",
  pointsOvertimeWin: "points_overtime_win",
  pointsOvertimeLoss: "points_overtime_loss",
  pointsShootoutWin: "points_shootout_win",
  pointsShootoutLoss: "points_shootout_loss",
  legsCount: "legs_count",
  bestOf: "best_of",
  roundsCount: "rounds_count",
  aggregationMode: "aggregation_mode",
  measuredValueKind: "measured_value_kind",
  measuredUnitPreset: "measured_unit_preset",
  measuredUnitCustomLabel: "measured_unit_custom_label",
  measuredBetterResult: "measured_better_result",
  measuredDecimalPlaces: "measured_decimal_places",
  measuredTimeFormat: "measured_time_format",
  measuredAllowTies: "measured_allow_ties",
  massStartValueKind: "mass_start_value_kind",
  massStartUnitPreset: "mass_start_unit_preset",
  massStartUnitCustomLabel: "mass_start_unit_custom_label",
  massStartBetterResult: "mass_start_better_result",
  massStartDecimalPlaces: "mass_start_decimal_places",
  massStartTimeFormat: "mass_start_time_format",
  massStartAllowTies: "mass_start_allow_ties",
  massStartRoundsCount: "mass_start_rounds_count",
  massStartAggregationMode: "mass_start_aggregation_mode",
} as const;

function getActiveCustomStagesCount(stages: CustomStageConfig[]): 1 | 2 | 3 {
  const stage3 = stages[2];
  if (stage3?.participantsCount != null) return 3;

  const stage2 = stages[1];
  if (stage2?.participantsCount != null) return 2;

  return 1;
}

function serializeCustomStage(stage: CustomStageConfig) {
  return {
    id: stage.id,
    name: stage.name,
    groups_count: stage.groupsCount,
    participants_count: stage.participantsCount,
    advance_count: stage.advanceCount,
    rounds_count: stage.roundsCount,
    aggregation_mode: stage.aggregationMode,
  };
}

function serializeCustomResultConfig(config: TournamentResultConfig) {
  const payload: Record<string, any> = {
    competition_model: config.competition_model,
  };

  for (const [frontendKey, backendKey] of Object.entries(RESULT_CONFIG_KEY_MAP)) {
    const value = (config as any)[frontendKey];
    if (value !== undefined) {
      payload[backendKey] = value;
    }
  }

  if (config.competition_model === "MASS_START") {
    payload.custom_mode = "MASS_START_MEASURED";
    payload.value_kind = config.massStartValueKind;
    payload.unit_preset = config.massStartUnitPreset;
    payload.unit = config.massStartUnitCustomLabel || "";
    payload.unit_label = config.massStartUnitCustomLabel || "";
    payload.better_result = config.massStartBetterResult;
    payload.decimal_places =
      config.massStartValueKind === "TIME" || config.massStartValueKind === "PLACE"
        ? null
        : config.massStartDecimalPlaces;
    payload.time_format = config.massStartValueKind === "TIME" ? config.massStartTimeFormat : null;
    payload.allow_ties = config.massStartAllowTies;
    payload.rounds_count = config.massStartRoundsCount;
    payload.aggregation_mode = config.massStartAggregationMode;
    payload.stages = Array.isArray(config.stages)
      ? config.stages.slice(0, getActiveCustomStagesCount(config.stages)).map(serializeCustomStage)
      : [];

    return payload;
  }

  payload.stages = [];
  return payload;
}

function deserializeCustomResultConfig(rawConfig: any, participants: number): TournamentResultConfig {
  const defaults = getDefaultResultConfig();
  const safeParticipants = Math.max(2, Math.trunc(participants));
  const raw = rawConfig && typeof rawConfig === "object" ? rawConfig : {};

  const mapped: Record<string, any> = {
    ...defaults,
    competition_model: raw.competition_model ?? defaults.competition_model,
  };

  for (const [frontendKey, backendKey] of Object.entries(RESULT_CONFIG_KEY_MAP)) {
    if (raw[backendKey] !== undefined) {
      mapped[frontendKey] = raw[backendKey];
    }
  }

  if (mapped.competition_model === "MASS_START") {
    mapped.massStartValueKind = raw.value_kind ?? raw.mass_start_value_kind ?? defaults.massStartValueKind;
    mapped.massStartUnitPreset = raw.unit_preset ?? raw.mass_start_unit_preset ?? defaults.massStartUnitPreset;
    mapped.massStartUnitCustomLabel =
      raw.unit_label ?? raw.unit ?? raw.mass_start_unit_custom_label ?? defaults.massStartUnitCustomLabel;
    mapped.massStartBetterResult = raw.better_result ?? raw.mass_start_better_result ?? defaults.massStartBetterResult;
    mapped.massStartDecimalPlaces = raw.decimal_places ?? raw.mass_start_decimal_places ?? defaults.massStartDecimalPlaces;
    mapped.massStartTimeFormat = raw.time_format ?? raw.mass_start_time_format ?? defaults.massStartTimeFormat;
    mapped.massStartAllowTies = raw.allow_ties ?? raw.mass_start_allow_ties ?? defaults.massStartAllowTies;
    mapped.massStartRoundsCount = raw.rounds_count ?? raw.mass_start_rounds_count ?? defaults.massStartRoundsCount;
    mapped.massStartAggregationMode =
      raw.aggregation_mode ?? raw.mass_start_aggregation_mode ?? defaults.massStartAggregationMode;
  }

  const baseStages = createDefaultStages(safeParticipants);
  const incomingStages: BackendCustomStageConfig[] = Array.isArray(raw.stages) ? raw.stages.slice(0, 3) : [];
  const activeStagesCount = Math.max(1, Math.min(3, incomingStages.length || 1));

  let previousAdvance: number | null = safeParticipants;
  mapped.stages = baseStages.map((baseStage, index) => {
    const rawStage = incomingStages[index];

    if (!rawStage) {
      return {
        ...baseStage,
        participantsCount: index === 0 ? safeParticipants : null,
        advanceCount: null,
        contributesToFinalRanking: index === activeStagesCount - 1,
      } satisfies CustomStageConfig;
    }

    const rawParticipantsCount = rawStage.participants_count;
    const participantsCount =
      rawParticipantsCount === null || rawParticipantsCount === undefined
        ? index === 0
          ? safeParticipants
          : previousAdvance
        : Math.max(1, Math.trunc(rawParticipantsCount));

    const advanceCount =
      rawStage.advance_count === null || rawStage.advance_count === undefined
        ? null
        : Math.max(1, Math.trunc(rawStage.advance_count));

    previousAdvance = advanceCount ?? participantsCount ?? previousAdvance;

    return {
      ...baseStage,
      id: typeof rawStage.id === "string" ? rawStage.id : baseStage.id,
      name: typeof rawStage.name === "string" && rawStage.name.trim() ? rawStage.name : baseStage.name,
      groupsCount: Number.isFinite(rawStage.groups_count as number)
        ? Math.max(1, Math.trunc(rawStage.groups_count as number))
        : baseStage.groupsCount,
      participantsCount,
      advanceCount,
      roundsCount: Number.isFinite(rawStage.rounds_count as number)
        ? Math.max(1, Math.trunc(rawStage.rounds_count as number))
        : baseStage.roundsCount,
      aggregationMode: (rawStage.aggregation_mode as CustomAggregationMode | undefined) ?? baseStage.aggregationMode,
      contributesToFinalRanking: index === activeStagesCount - 1,
    } satisfies CustomStageConfig;
  });

  return mapped as TournamentResultConfig;
}
function createDefaultStages(participants: number): CustomStageConfig[] {
  const safeParticipants = Math.max(2, Math.trunc(participants));

  return [
    {
      id: "stage-1",
      name: "Kwalifikacje",
      groupsCount: 1,
      participantsCount: safeParticipants,
      advanceCount: null,
      roundsCount: 1,
      aggregationMode: "BEST",
      contributesToFinalRanking: false,
    },
    {
      id: "stage-2",
      name: "Półfinał",
      groupsCount: 1,
      participantsCount: null,
      advanceCount: null,
      roundsCount: 1,
      aggregationMode: "BEST",
      contributesToFinalRanking: false,
    },
    {
      id: "stage-3",
      name: "Finał",
      groupsCount: 1,
      participantsCount: null,
      advanceCount: null,
      roundsCount: 1,
      aggregationMode: "BEST",
      contributesToFinalRanking: true,
    },
  ];
}

// Zapis jest etapowy, aby backend mógł wykryć potrzebę resetu i utrzymać spójność danych.
export default function TournamentBasicsSetup() {
  const { id } = useParams<{ id: string }>();
  const isCreateMode = !id;

  const navigate = useNavigate();
  const location = useLocation();

  const { dirty, markDirty, registerSave } = useTournamentFlowGuard();
  const createdIdRef = useRef<string | null>(null);

  const [loading, setLoading] = useState(!isCreateMode);
  const [saving, setSaving] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState<string>("Potwierdzenie");
  const [confirmMessage, setConfirmMessage] = useState<string>("");
  const [confirmConfirmLabel, setConfirmConfirmLabel] = useState<string>("Kontynuuj");
  const [confirmCancelLabel, setConfirmCancelLabel] = useState<string>("Anuluj");
  const confirmResolverRef = useRef<((value: boolean) => void) | null>(null);

  const askConfirm = useCallback(
    (opts: { title?: string; message: string; confirmLabel?: string; cancelLabel?: string }) => {
      setConfirmTitle(opts.title ?? "Potwierdzenie");
      setConfirmMessage(opts.message);
      setConfirmConfirmLabel(opts.confirmLabel ?? "Kontynuuj");
      setConfirmCancelLabel(opts.cancelLabel ?? "Anuluj");
      setConfirmOpen(true);
      return new Promise<boolean>((resolve) => {
        confirmResolverRef.current = resolve;
      });
    },
    []
  );

  const resolveConfirm = useCallback((value: boolean) => {
    setConfirmOpen(false);
    const r = confirmResolverRef.current;
    confirmResolverRef.current = null;
    if (r) r(value);
  }, []);

  const [myRole, setMyRole] = useState<"ORGANIZER" | "ASSISTANT" | null>(null);
  const [myPerms, setMyPerms] = useState<Record<string, boolean>>({});

  const canEditTournament = myRole === "ORGANIZER" || Boolean(myPerms?.tournament_edit);
  const isAssistantReadOnly = !isCreateMode && !canEditTournament;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const [initialName, setInitialName] = useState("");
  const [initialDescription, setInitialDescription] = useState("");

  const [discipline, setDiscipline] = useState<Discipline>("football");
  const [initialDiscipline, setInitialDiscipline] = useState<Discipline>("football");

  const [format, setFormat] = useState<TournamentFormat>("LEAGUE");
  const [participants, setParticipants] = useState(8);
  const initialParticipantsRef = useRef<number>(8);

  const [leagueMatches, setLeagueMatches] = useState<1 | 2>(1);
  const [groupsCount, setGroupsCount] = useState(2);
  const [groupMatches, setGroupMatches] = useState<1 | 2>(1);
  const [advanceFromGroup, setAdvanceFromGroup] = useState(2);

  const [hbTableDrawMode, setHbTableDrawMode] = useState<HandballTableDrawMode>("ALLOW_DRAW");
  const [hbPointsMode, setHbPointsMode] = useState<HandballPointsMode>("2_1_0");
  const [hbKnockoutTiebreak, setHbKnockoutTiebreak] =
    useState<HandballKnockoutTiebreak>("OVERTIME_PENALTIES");

  const [cupMatches, setCupMatches] = useState<1 | 2>(1);
  const [finalMatches, setFinalMatches] = useState<1 | 2>(1);
  const [thirdPlace, setThirdPlace] = useState(false);
  const [thirdPlaceMatches, setThirdPlaceMatches] = useState<1 | 2>(1);

  const [tennisBestOf, setTennisBestOf] = useState<TennisBestOf>(3);
  const [tennisPointsMode, setTennisPointsMode] = useState<TennisPointsMode>("NONE");

  // ===== Lokalny stan pod nowy formularz custom (UI-only w tym etapie) =====
  const [competitionType, setCompetitionType] = useState<CompetitionType>("INDIVIDUAL");
  const [competitionModel, setCompetitionModel] = useState<CompetitionModel>("MASS_START");
  const [customDisciplineName, setCustomDisciplineName] = useState("");
  const [resultConfig, setResultConfig] = useState<TournamentResultConfig>(() => {
    const config = getDefaultResultConfig();
    return {
      ...config,
      stages: createDefaultStages(8),
    };
  });

  const isHandball = discipline === "handball";
  const isTennis = discipline === "tennis";
  const isCustomDiscipline = discipline === "custom";

  useEffect(() => {
    const flash = (location.state as any)?.flashError as string | undefined;
    if (flash) {
      setInlineError(flash);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, navigate, location.pathname]);

  useEffect(() => {
    if (hbPointsMode === "3_2_1_0" && hbTableDrawMode === "ALLOW_DRAW") {
      setHbTableDrawMode("PENALTIES");
    }
  }, [hbPointsMode, hbTableDrawMode]);

  useEffect(() => {
    if (!isTennis) return;
    if (cupMatches !== 1) setCupMatches(1);
    if (finalMatches !== 1) setFinalMatches(1);
    if (thirdPlaceMatches !== 1) setThirdPlaceMatches(1);
  }, [isTennis, cupMatches, finalMatches, thirdPlaceMatches]);

  useEffect(() => {
    if (!isCustomDiscipline) return;
    setResultConfig((prev) => ({
      ...prev,
      competition_model: competitionModel,
    }));
  }, [competitionModel, isCustomDiscipline]);

  useEffect(() => {
    if (!isCustomDiscipline || competitionModel !== "MASS_START") return;

    setResultConfig((prev) => {
      const stages = prev.stages.map((stage, index) => {
        if (index === 0) {
          return {
            ...stage,
            participantsCount: participants,
          };
        }
        return stage;
      });

      return {
        ...prev,
        stages,
      };
    });
  }, [participants, isCustomDiscipline, competitionModel]);

  const maxGroupsForMin2PerGroup = useMemo(() => {
    return Math.max(1, Math.floor(Math.max(2, participants) / 2));
  }, [participants]);

  useEffect(() => {
    if (format !== "MIXED") return;
    setGroupsCount((prev) => clampInt(prev, 1, maxGroupsForMin2PerGroup));
  }, [format, maxGroupsForMin2PerGroup]);

  const groupSizes = useMemo(() => {
    if (format !== "MIXED") return [];
    const safeParticipants = clampInt(participants, 2, 10_000);
    const safeGroups = clampInt(groupsCount, 1, Math.max(1, safeParticipants));
    return splitIntoGroups(safeParticipants, safeGroups);
  }, [format, participants, groupsCount]);

  const minGroupSize = useMemo(() => {
    if (!groupSizes.length) return 0;
    return Math.min(...groupSizes);
  }, [groupSizes]);

  useEffect(() => {
    if (format !== "MIXED") return;
    if (minGroupSize < 2) return;
    setAdvanceFromGroup((prev) => clampInt(prev, 1, minGroupSize));
  }, [format, minGroupSize]);

  const advanceOptions = useMemo(() => {
    if (format !== "MIXED" || minGroupSize < 2) return [1, 2].filter((x) => x <= Math.max(1, minGroupSize));
    const maxOpt = Math.min(minGroupSize, 8);
    return Array.from({ length: maxOpt }, (_, i) => i + 1);
  }, [format, minGroupSize]);

  useEffect(() => {
    if (isCreateMode) return;

    const load = async () => {
      setLoading(true);
      setInlineError(null);
      try {
        const [tRes, teamsRes] = await Promise.all([
          apiFetch(`/api/tournaments/${id}/`, { toastOnError: false } as any),
          apiFetch(`/api/tournaments/${id}/teams/`, { toastOnError: false } as any),
        ]);

        if (!tRes.ok) {
          const data = await tRes.json().catch(() => ({}));
          setInlineError(pickFirstError(data) || "Nie udało się pobrać danych turnieju.");
          return;
        }
        if (!teamsRes.ok) {
          const data = await teamsRes.json().catch(() => ({}));
          setInlineError(pickFirstError(data) || "Nie udało się pobrać listy uczestników.");
          return;
        }

        const t: TournamentDTO = await tRes.json();
        const teams: TeamDTO[] = await teamsRes.json();

        setMyRole(t.my_role ?? null);
        setMyPerms(t.my_permissions ?? {});

        setName(t.name || "");
        setInitialName(t.name || "");

        const desc = (t.description ?? "") as string;
        setDescription(desc);
        setInitialDescription(desc);

        setDiscipline(t.discipline);
        setInitialDiscipline(t.discipline);

        setFormat(t.tournament_format);

        const currentCount = Math.max(2, teams.length);
        setParticipants(currentCount);
        initialParticipantsRef.current = currentCount;

        // Dla etapu wizualnego ustawiamy sensowne domyślne dane custom po załadowaniu.
        setResultConfig((prev) => ({
          ...prev,
          stages: createDefaultStages(currentCount),
        }));

        const cfg = t.format_config || {};

        setLeagueMatches(cfg.league_matches === 2 ? 2 : 1);

        const savedGroups = cfg.groups_count;
        if (typeof savedGroups === "number" && savedGroups >= 1) {
          setGroupsCount(savedGroups);
        } else {
          setGroupsCount(defaultGroupsCountFor4PerGroup(currentCount));
        }

        setGroupMatches(cfg.group_matches === 2 ? 2 : 1);

        const savedAdvance = Number(cfg.advance_from_group ?? 2);
        setAdvanceFromGroup(Number.isFinite(savedAdvance) ? savedAdvance : 2);

        setCupMatches(cfg.cup_matches === 2 ? 2 : 1);
        setFinalMatches(cfg.final_matches === 2 ? 2 : 1);
        setThirdPlace(!!cfg.third_place);
        setThirdPlaceMatches(cfg.third_place_matches === 2 ? 2 : 1);

        setHbTableDrawMode(cfg.handball_table_draw_mode ?? "ALLOW_DRAW");
        setHbKnockoutTiebreak(cfg.handball_knockout_tiebreak ?? "OVERTIME_PENALTIES");
        setHbPointsMode(cfg.handball_points_mode ?? "2_1_0");

        setTennisBestOf(cfg.tennis_best_of === 5 ? 5 : 3);
        const tpm = (cfg.tennis_points_mode ?? "NONE").toString().toUpperCase();
        setTennisPointsMode(tpm === "PLT" ? "PLT" : "NONE");

        if (t.discipline === "custom") {
          setCompetitionType((t.competition_type as CompetitionType) ?? "INDIVIDUAL");
          setCompetitionModel((t.competition_model as CompetitionModel) ?? "MASS_START");
          setCustomDisciplineName(t.custom_discipline_name ?? "");

          const incoming = t.result_config && typeof t.result_config === "object" ? t.result_config : {};
          setResultConfig(deserializeCustomResultConfig(incoming, currentCount));
        }
      } catch {
        toast.error("Brak połączenia z serwerem. Spróbuj ponownie.", { title: "Sieć" });
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [id, isCreateMode]);

  const preview: MatchesPreview = useMemo(() => {
    const p = clampInt(participants, 2, 10_000);

    if (isCustomDiscipline && competitionModel === "MASS_START") {
      return {
        total: 0,
        groupTotal: 0,
        koTotal: 0,
        groups: resultConfig.stages[0]?.groupsCount ?? 1,
        advancing: resultConfig.stages[0]?.advanceCount ?? 0,
      };
    }

    if (format === "LEAGUE") {
      const matches = ((p * (p - 1)) / 2) * leagueMatches;
      return { total: matches, groupTotal: matches, koTotal: 0, groups: 0, advancing: 0 };
    }

    if (format === "CUP") {
      const roundsMatches = Math.max(0, (p - 2) * cupMatches);
      const finalCount = finalMatches;
      const thirdCount = thirdPlace ? thirdPlaceMatches : 0;
      const koTotal = roundsMatches + finalCount + thirdCount;
      return { total: koTotal, groupTotal: 0, koTotal, groups: 0, advancing: 0 };
    }

    const safeGroups = clampInt(groupsCount, 1, Math.max(1, Math.floor(p / 2)));
    const sizes = splitIntoGroups(p, safeGroups);
    const groupTotal = sizes.reduce((sum, size) => sum + roundRobinMatches(size, groupMatches), 0);
    const minSize = sizes.length ? Math.min(...sizes) : 2;
    const adv = clampInt(advanceFromGroup, 1, Math.max(1, minSize));
    const advancing = sizes.length * adv;

    if (advancing < 2) {
      return { total: groupTotal, groupTotal, koTotal: 0, groups: sizes.length, advancing };
    }

    const koRoundsMatches = Math.max(0, (advancing - 2) * cupMatches);
    const finalCount = finalMatches;
    const thirdCount = thirdPlace ? thirdPlaceMatches : 0;
    const koTotal = koRoundsMatches + finalCount + thirdCount;

    return { total: groupTotal + koTotal, groupTotal, koTotal, groups: sizes.length, advancing };
  }, [
    format,
    participants,
    leagueMatches,
    cupMatches,
    finalMatches,
    thirdPlace,
    thirdPlaceMatches,
    groupsCount,
    groupMatches,
    advanceFromGroup,
    isCustomDiscipline,
    competitionModel,
    resultConfig.stages,
  ]);

  const validateLocalBeforeSave = (): string | null => {
    const trimmedName = name.trim();
    if (!trimmedName) return "Wpisz nazwę turnieju - bez tego nie da się przejść dalej.";

    const p = clampInt(participants, 2, 10_000);

    if (isCustomDiscipline) {
      if (!customDisciplineName.trim()) {
        return "Dla dyscypliny niestandardowej podaj własną nazwę.";
      }

      if (competitionModel === "MASS_START") {
        const visibleStages = resultConfig.stages.slice(0, 3);

        for (let index = 0; index < visibleStages.length; index += 1) {
          const stage = visibleStages[index];

          if (!stage.name.trim()) {
            return `Uzupełnij nazwę dla etapu ${index + 1}.`;
          }

          if (stage.groupsCount < 1) {
            return `Etap ${index + 1} musi mieć co najmniej 1 grupę.`;
          }

          if (index === 0 && (!stage.participantsCount || stage.participantsCount < 1)) {
            return "Pierwszy etap w trybie 'wszyscy razem' musi mieć liczbę uczestników.";
          }
        }
      }

      return null;
    }

    if (format === "MIXED") {
      const gMax = Math.max(1, Math.floor(p / 2));
      const g = clampInt(groupsCount, 1, gMax);
      const sizes = splitIntoGroups(p, g);
      const minSize = sizes.length ? Math.min(...sizes) : 2;

      if (minSize < 2) {
        return "W grupach + puchar każda grupa musi mieć co najmniej 2 uczestników (zmniejsz liczbę grup).";
      }

      const adv = clampInt(advanceFromGroup, 1, minSize);
      if (adv !== advanceFromGroup) {
        return `Awans z grupy nie może być większy niż liczba zespołów w najmniejszej grupie (min: ${minSize}).`;
      }

      const advancing = g * adv;
      if (advancing >= 2 && !isPowerOfTwo(advancing)) {
        return `Uwaga: awansujących jest ${advancing}. To nie jest potęga 2, więc w drabince mogą pojawić się wolne losy (BYE).`;
      }
    }

    if (isTennis) {
      if (cupMatches !== 1 || finalMatches !== 1 || thirdPlaceMatches !== 1) {
        return "Tenis: KO nie wspiera dwumeczów - ustaw rundy/finał/3. miejsce na 1 mecz.";
      }
    }

    return null;
  };

  const buildFormatConfig = () => {
    const safeParticipants = clampInt(participants, 2, 10_000);
    const maxGroups = Math.max(1, Math.floor(safeParticipants / 2));
    const safeGroups = clampInt(groupsCount, 1, Math.max(1, maxGroups));
    const sizes = splitIntoGroups(safeParticipants, safeGroups);
    const computedTeamsPerGroup = Math.max(2, ...(sizes.length ? sizes : [2]));
    const minSize = sizes.length ? Math.min(...sizes) : 2;
    const safeAdvance = clampInt(advanceFromGroup, 1, Math.max(1, minSize));

    const rawConfig: Record<string, any> = {
      league_matches: leagueMatches,
      groups_count: safeGroups,
      teams_per_group: computedTeamsPerGroup,
      group_matches: groupMatches,
      advance_from_group: safeAdvance,
      cup_matches: isTennis ? 1 : cupMatches,
      final_matches: isTennis ? 1 : finalMatches,
      third_place: thirdPlace,
      third_place_matches: isTennis ? 1 : thirdPlaceMatches,
    };

    if (isHandball) {
      rawConfig.handball_table_draw_mode = hbTableDrawMode;
      rawConfig.handball_knockout_tiebreak = hbKnockoutTiebreak;
      rawConfig.handball_points_mode = hbPointsMode;
    }

    if (isTennis) {
      rawConfig.tennis_best_of = tennisBestOf;
      rawConfig.tennis_points_mode = tennisPointsMode;
    }

    const finalConfig = { ...rawConfig };

    if (format === "LEAGUE") {
      delete finalConfig.cup_matches;
      delete finalConfig.final_matches;
      delete finalConfig.third_place;
      delete finalConfig.third_place_matches;
      delete finalConfig.advance_from_group;
      delete finalConfig.groups_count;
      delete finalConfig.teams_per_group;
      delete finalConfig.group_matches;
      delete finalConfig.handball_knockout_tiebreak;
    }

    if (format === "CUP") {
      delete finalConfig.league_matches;
      delete finalConfig.groups_count;
      delete finalConfig.teams_per_group;
      delete finalConfig.group_matches;
      delete finalConfig.advance_from_group;
      delete finalConfig.handball_table_draw_mode;
      delete finalConfig.handball_points_mode;
      delete finalConfig.tennis_points_mode;
    }

    if (format === "MIXED") {
      delete finalConfig.league_matches;
    }

    return finalConfig;
  };

  const saveAll = useCallback(async (): Promise<{ tournamentId: number }> => {
    if (isAssistantReadOnly) {
      const msg = "Tryb podglądu: brak uprawnień do zmiany konfiguracji.";
      setInlineError(msg);
      throw new Error(msg);
    }

    const localMsg = validateLocalBeforeSave();
    if (localMsg) {
      if (localMsg.startsWith("Uwaga:")) {
        const ok = await askConfirm({
          title: "Zapis konfiguracji",
          message: `${localMsg}\n\nKontynuować zapis?`,
          confirmLabel: "Zapisz",
          cancelLabel: "Anuluj",
        });
        if (!ok) {
          setInlineError("Anulowano zapis konfiguracji.");
          throw new Error("Anulowano zapis konfiguracji.");
        }
      } else {
        setInlineError(localMsg);
        throw new Error(localMsg);
      }
    }

    if (!isCreateMode && !dirty) return { tournamentId: Number(id) };

    setSaving(true);
    setInlineError(null);

    let createdId: number | null = null;

    try {
      const trimmedName = name.trim();
      const trimmedDesc = description.trim();
      let tournamentId = Number(id);

      if (isCreateMode) {
        const createRes = await apiFetch("/api/tournaments/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: trimmedName,
            description: trimmedDesc ? trimmedDesc : null,
            discipline,
          }),
          toastOnError: false,
        } as any);

        if (!createRes.ok) {
          const data = await createRes.json().catch(() => ({}));
          const msg = pickFirstError(data) || "Nie udało się utworzyć turnieju.";
          setInlineError(msg);
          throw new Error(msg);
        }

        const created = await createRes.json();
        createdId = created.id;
        tournamentId = created.id;

        setInitialName(trimmedName);
        setInitialDescription(trimmedDesc);
        setInitialDiscipline(discipline);
      } else {
        if (discipline !== initialDiscipline) {
          const ok = await askConfirm({
            title: "Zmiana dyscypliny",
            message:
              "Zmiana dyscypliny spowoduje usunięcie wprowadzonych wyników oraz danych pochodnych.\n\nCzy na pewno chcesz kontynuować?",
            confirmLabel: "Zmień",
            cancelLabel: "Anuluj",
          });

          if (!ok) {
            setDiscipline(initialDiscipline);
            throw new Error("Anulowano zmianę dyscypliny.");
          }

          const changePayload: Record<string, any> =
            discipline === "custom"
              ? {
                  discipline,
                  custom_discipline_name: customDisciplineName.trim(),
                  competition_type: competitionType,
                  competition_model: competitionModel,
                  result_mode: "CUSTOM",
                  result_config: serializeCustomResultConfig(resultConfig),
                }
              : {
                  discipline,
                };

          const res = await apiFetch(`/api/tournaments/${tournamentId}/change-discipline/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(changePayload),
            toastOnError: false,
          } as any);

          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            const msg = pickFirstError(data) || "Nie udało się zmienić dyscypliny.";
            setInlineError(msg);
            throw new Error(msg);
          }

          setInitialDiscipline(discipline);
        }

        const patch: Record<string, any> = {};
        if (trimmedName !== initialName) patch.name = trimmedName;
        if (trimmedDesc !== initialDescription) patch.description = trimmedDesc ? trimmedDesc : null;

        if (Object.keys(patch).length) {
          const res = await apiFetch(`/api/tournaments/${tournamentId}/`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
            toastOnError: false,
          } as any);

          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            const msg = pickFirstError(data) || "Nie udało się zapisać danych turnieju.";
            setInlineError(msg);
            throw new Error(msg);
          }

          setInitialName(trimmedName);
          setInitialDescription(trimmedDesc);
        }
      }

      if (isCustomDiscipline) {
        const payload: Record<string, any> = {
          custom_discipline_name: customDisciplineName.trim(),
          competition_type: competitionType,
          competition_model: competitionModel,
          tournament_format: format,
          result_mode: "CUSTOM",
          result_config: serializeCustomResultConfig(resultConfig),
          format_config: buildFormatConfig(),
        };

        if (isCreateMode) {
          payload.discipline = discipline;
        }

        const res = await apiFetch(`/api/tournaments/${tournamentId}/`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          toastOnError: false,
        } as any);

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          const msg = pickFirstError(data) || "Błąd zapisu konfiguracji custom.";
          setInlineError(msg);
          throw new Error(msg);
        }

        setInitialDiscipline(discipline);
      } else {
        const format_config = buildFormatConfig();

        const dry = await apiFetch(`/api/tournaments/${tournamentId}/setup/?dry_run=true`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tournament_format: format, format_config }),
          toastOnError: false,
        } as any);

        if (!dry.ok) {
          const data = await dry.json().catch(() => ({}));
          const msg = pickFirstError(data) || "Błąd walidacji konfiguracji.";
          setInlineError(msg);
          throw new Error(msg);
        }

        const dryData = await dry.json().catch(() => ({}));
        const resetNeeded = Boolean((dryData as any)?.reset_needed);

        if (!isCreateMode && resetNeeded) {
          const ok = await askConfirm({
            title: "Zmiana konfiguracji",
            message: "Zmiana konfiguracji usunie istniejące mecze. Kontynuować?",
            confirmLabel: "Kontynuuj",
            cancelLabel: "Anuluj",
          });
          if (!ok) throw new Error("Anulowano zapis konfiguracji.");
        }

        const res = await apiFetch(`/api/tournaments/${tournamentId}/setup/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tournament_format: format, format_config }),
          toastOnError: false,
        } as any);

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          const msg = pickFirstError(data) || "Błąd zapisu konfiguracji.";
          setInlineError(msg);
          throw new Error(msg);
        }
      }

      const safeParticipants = clampInt(participants, 2, 10_000);
      const participantsChanged = safeParticipants !== initialParticipantsRef.current;

      if (!isCreateMode && participantsChanged && !isCustomDiscipline) {
        const ok = await askConfirm({
          title: "Zmiana uczestników",
          message: "Zmiana liczby uczestników spowoduje reset rozgrywek. Kontynuować?",
          confirmLabel: "Kontynuuj",
          cancelLabel: "Anuluj",
        });
        if (!ok) throw new Error("Anulowano zmianę liczby uczestników.");
      }

      const teamsRes = await apiFetch(`/api/tournaments/${tournamentId}/teams/setup/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teams_count: safeParticipants,
          participants_count: safeParticipants,
        }),
        toastOnError: false,
      } as any);

      if (!teamsRes.ok) {
        const data = await teamsRes.json().catch(() => ({}));
        const msg = pickFirstError(data) || "Nie udało się ustawić liczby uczestników.";
        setInlineError(msg);
        throw new Error(msg);
      }

      initialParticipantsRef.current = safeParticipants;
      createdIdRef.current = String(tournamentId);

      if (isCreateMode) {
        navigate(`/tournaments/${tournamentId}/detail/setup`, { replace: true });
      } else {
        toast.success("Zapisano konfigurację.", { title: "Turniej" });
      }

      return { tournamentId };
    } catch (e: any) {
      const msg = e?.message || "Nie udało się zapisać.";
      if (isCreateMode && createdId) {
        navigate(`/tournaments/${createdId}/setup`, {
          replace: true,
          state: { flashError: msg },
        });
        return { tournamentId: createdId };
      }
      throw e;
    } finally {
      setSaving(false);
    }
  }, [
    isAssistantReadOnly,
    isCreateMode,
    dirty,
    id,
    name,
    description,
    discipline,
    initialDiscipline,
    initialName,
    initialDescription,
    format,
    participants,
    leagueMatches,
    groupsCount,
    groupMatches,
    advanceFromGroup,
    cupMatches,
    finalMatches,
    thirdPlace,
    thirdPlaceMatches,
    hbTableDrawMode,
    hbKnockoutTiebreak,
    hbPointsMode,
    tennisBestOf,
    tennisPointsMode,
    isTennis,
    isCustomDiscipline,
    customDisciplineName,
    competitionType,
    competitionModel,
    resultConfig,
    buildFormatConfig,
    navigate,
    askConfirm,
    validateLocalBeforeSave,
  ]);

  const goNext = useCallback(async () => {
    try {
      const { tournamentId } = await saveAll();
      navigate(`/tournaments/${tournamentId}/detail`, { replace: true });
    } catch (e: any) {
      const msg = e?.message || "Nie udało się zapisać.";
      setInlineError(msg);
    }
  }, [saveAll, navigate]);

  useEffect(() => {
    if (isAssistantReadOnly) {
      registerSave(null);
      return () => registerSave(null);
    }
    registerSave(async () => {
      const { tournamentId } = await saveAll();
      createdIdRef.current = String(tournamentId);
    });
    return () => registerSave(null);
  }, [registerSave, saveAll, isAssistantReadOnly]);

  const disableForm = loading || saving || isAssistantReadOnly;
  const isTournamentCreated = !isCreateMode || Boolean(createdIdRef.current);
  const showLeagueOrGroupConfig = format === "LEAGUE" || format === "MIXED";
  const showKnockoutConfig = format === "CUP" || format === "MIXED";

  const clearInlineError = useCallback(() => {
    if (inlineError) setInlineError(null);
  }, [inlineError]);

  const onNameChange = useCallback(
    (v: string) => {
      setName(v);
      markDirty();
      clearInlineError();
    },
    [clearInlineError, markDirty]
  );

  const onDescriptionChange = useCallback(
    (v: string) => {
      setDescription(v);
      markDirty();
      clearInlineError();
    },
    [clearInlineError, markDirty]
  );

  const onDisciplineChange = useCallback(
    (v: Discipline) => {
      setDiscipline(v);
      if (v !== "custom") {
        setCompetitionType("INDIVIDUAL");
        setCompetitionModel("MASS_START");
        setCustomDisciplineName("");
        setResultConfig({
          ...getDefaultResultConfig(),
          stages: createDefaultStages(participants),
        });
      }
      markDirty();
      clearInlineError();
    },
    [clearInlineError, markDirty, participants]
  );

  const onFormatChange = useCallback(
    (v: TournamentFormat) => {
      setFormat(v);
      markDirty();
      clearInlineError();
      if (v !== "CUP") setThirdPlace(false);
    },
    [clearInlineError, markDirty]
  );

  const onParticipantsChange = useCallback(
    (raw: number) => {
      const p = clampInt(Number(raw), 2, 10_000);
      setParticipants(p);
      markDirty();
      clearInlineError();
      if (!isCustomDiscipline && format === "MIXED") {
        const gMax = Math.max(1, Math.floor(p / 2));
        setGroupsCount((prev) => clampInt(prev, 1, gMax));
      }
    },
    [format, isCustomDiscipline, clearInlineError, markDirty]
  );

  const patchResultConfig = useCallback(
    (patch: Partial<TournamentResultConfig>) => {
      setResultConfig((prev) => ({ ...prev, ...patch }));
      markDirty();
      clearInlineError();
    },
    [clearInlineError, markDirty]
  );

  const updateStage = useCallback(
    (stageId: string, patch: Partial<CustomStageConfig>) => {
      setResultConfig((prev) => ({
        ...prev,
        stages: prev.stages.map((stage) => (stage.id === stageId ? { ...stage, ...patch } : stage)),
      }));
      markDirty();
      clearInlineError();
    },
    [clearInlineError, markDirty]
  );

  if (loading) {
    return (
      <div className="w-full py-8">
        <Card className="p-6">
          <div className="text-sm text-slate-300">Ładowanie...</div>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6 py-8">
      {isCreateMode && (
        <div className="-mt-2">
          <TournamentFlowNav />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            {isCreateMode ? "Utwórz turniej" : "Ustawienia turnieju"}
          </h1>
          {isAssistantReadOnly && (
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-100">
              <AlertTriangle className="h-3.5 w-3.5" />
              Podgląd (asystent)
            </span>
          )}
        </div>

        <div className="text-sm leading-relaxed text-slate-300">
          {isCreateMode
            ? "Ustal podstawy i strukturę rozgrywek. W kolejnym kroku uzupełnisz uczestników."
            : "Zmień parametry rozgrywek. Uwaga: część zmian może wymagać resetu."}
        </div>
      </div>

      <AnimatePresence>
        {inlineError && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
            <div className="space-y-2">
              <InlineAlert variant="error" title="Nie udało się zapisać">
                {inlineError}
              </InlineAlert>
              <div className="flex justify-end">
                <Button variant="ghost" onClick={() => setInlineError(null)}>
                  Zamknij
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid items-start gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6">
          <BasicsCard
            disableForm={disableForm}
            isCreateMode={isCreateMode}
            isTournamentCreated={isTournamentCreated}
            name={name}
            description={description}
            onNameChange={onNameChange}
            onDescriptionChange={onDescriptionChange}
            onCreate={async () => {
              try {
                setInlineError(null);
                await saveAll();
              } catch (e: any) {
                setInlineError(e?.message || "Nie udało się utworzyć turnieju.");
              }
            }}
          />

          <StructureCard
            isTournamentCreated={isTournamentCreated}
            disableForm={disableForm}
            saving={saving}
            discipline={discipline}
            format={format}
            participants={participants}
            leagueMatches={leagueMatches}
            groupsCount={groupsCount}
            groupMatches={groupMatches}
            advanceFromGroup={advanceFromGroup}
            hbTableDrawMode={hbTableDrawMode}
            hbPointsMode={hbPointsMode}
            hbKnockoutTiebreak={hbKnockoutTiebreak}
            cupMatches={cupMatches}
            finalMatches={finalMatches}
            thirdPlace={thirdPlace}
            thirdPlaceMatches={thirdPlaceMatches}
            tennisBestOf={tennisBestOf}
            tennisPointsMode={tennisPointsMode}
            maxGroupsForMin2PerGroup={maxGroupsForMin2PerGroup}
            groupSizes={groupSizes}
            minGroupSize={minGroupSize}
            advanceOptions={advanceOptions}
            showLeagueOrGroupConfig={showLeagueOrGroupConfig}
            showKnockoutConfig={showKnockoutConfig}
            competitionType={competitionType}
            competitionModel={competitionModel}
            customDisciplineName={customDisciplineName}
            resultConfig={resultConfig}
            onSave={async () => {
              try {
                setInlineError(null);
                await saveAll();
              } catch (e: any) {
                setInlineError(e?.message || "Nie udało się zapisać.");
              }
            }}
            onDisciplineChange={onDisciplineChange}
            onFormatChange={onFormatChange}
            onParticipantsChange={onParticipantsChange}
            onLeagueMatchesChange={(v) => {
              setLeagueMatches(v);
              markDirty();
              clearInlineError();
            }}
            onGroupsCountChange={(raw) => {
              setGroupsCount(clampInt(Number(raw), 1, maxGroupsForMin2PerGroup));
              markDirty();
              clearInlineError();
            }}
            onGroupMatchesChange={(v) => {
              setGroupMatches(v);
              markDirty();
              clearInlineError();
            }}
            onAdvanceFromGroupChange={(v) => {
              setAdvanceFromGroup(v);
              markDirty();
              clearInlineError();
            }}
            onHbTableDrawModeChange={(v) => {
              setHbTableDrawMode(v);
              markDirty();
              clearInlineError();
            }}
            onHbPointsModeChange={(v) => {
              setHbPointsMode(v);
              markDirty();
              clearInlineError();
            }}
            onHbKnockoutTiebreakChange={(v) => {
              setHbKnockoutTiebreak(v);
              markDirty();
              clearInlineError();
            }}
            onCupMatchesChange={(v) => {
              setCupMatches(v);
              markDirty();
              clearInlineError();
            }}
            onFinalMatchesChange={(v) => {
              setFinalMatches(v);
              markDirty();
              clearInlineError();
            }}
            onThirdPlaceChange={(v) => {
              setThirdPlace(v);
              markDirty();
              clearInlineError();
            }}
            onThirdPlaceMatchesChange={(v) => {
              setThirdPlaceMatches(v);
              markDirty();
              clearInlineError();
            }}
            onTennisBestOfChange={(v) => {
              setTennisBestOf(v);
              markDirty();
              clearInlineError();
            }}
            onTennisPointsModeChange={(v) => {
              setTennisPointsMode(v);
              markDirty();
              clearInlineError();
            }}
            onCompetitionTypeChange={(v) => {
              setCompetitionType(v);
              markDirty();
              clearInlineError();
            }}
            onCompetitionModelChange={(v) => {
              setCompetitionModel(v);
              patchResultConfig({ competition_model: v });
            }}
            onCustomDisciplineNameChange={(v) => {
              setCustomDisciplineName(v);
              markDirty();
              clearInlineError();
            }}
            onHeadToHeadModeChange={(v: CustomHeadToHeadMode) => {
              patchResultConfig({ headToHeadMode: v });
            }}
            onCustomMatchSeriesModeChange={(v) => {
              patchResultConfig({ customMatchSeriesMode: v });
            }}
            onCustomGroupResolutionModeChange={(v) => {
              patchResultConfig({ groupResolutionMode: v });
            }}
            onCustomKnockoutResolutionModeChange={(v) => {
              patchResultConfig({ knockoutResolutionMode: v });
            }}
            onAllowDrawChange={(v) => {
              patchResultConfig({ allowDraw: v });
            }}
            onAllowOvertimeChange={(v) => {
              patchResultConfig({ allowOvertime: v });
            }}
            onAllowShootoutChange={(v) => {
              patchResultConfig({ allowShootout: v });
            }}
            onPointsWinChange={(v) => {
              patchResultConfig({ pointsWin: v ?? 0 });
            }}
            onPointsDrawChange={(v) => {
              patchResultConfig({ pointsDraw: v ?? 0 });
            }}
            onPointsLossChange={(v) => {
              patchResultConfig({ pointsLoss: v ?? 0 });
            }}
            onPointsOvertimeWinChange={(v) => {
              patchResultConfig({ pointsOvertimeWin: v ?? 0 });
            }}
            onPointsOvertimeLossChange={(v) => {
              patchResultConfig({ pointsOvertimeLoss: v ?? 0 });
            }}
            onPointsShootoutWinChange={(v) => {
              patchResultConfig({ pointsShootoutWin: v ?? 0 });
            }}
            onPointsShootoutLossChange={(v) => {
              patchResultConfig({ pointsShootoutLoss: v ?? 0 });
            }}
            onLegsCountChange={(v) => {
              patchResultConfig({ legsCount: v });
            }}
            onBestOfChange={(v) => {
              patchResultConfig({ bestOf: v });
            }}
            onHeadToHeadRoundsCountChange={(v) => {
              patchResultConfig({ roundsCount: v ?? 1 });
            }}
            onHeadToHeadAggregationModeChange={(v: CustomAggregationMode) => {
              patchResultConfig({ aggregationMode: v });
            }}
            onMeasuredValueKindChange={(v: CustomMeasuredValueKind) => {
              patchResultConfig({ measuredValueKind: v });
            }}
            onMeasuredUnitPresetChange={(v: CustomUnitPreset) => {
              patchResultConfig({ measuredUnitPreset: v });
            }}
            onMeasuredUnitCustomLabelChange={(v) => {
              patchResultConfig({ measuredUnitCustomLabel: v });
            }}
            onMeasuredBetterResultChange={(v: CustomBetterResult) => {
              patchResultConfig({ measuredBetterResult: v });
            }}
            onMeasuredDecimalPlacesChange={(v) => {
              patchResultConfig({ measuredDecimalPlaces: v });
            }}
            onMeasuredTimeFormatChange={(v: CustomTimeFormat) => {
              patchResultConfig({ measuredTimeFormat: v });
            }}
            onMeasuredAllowTiesChange={(v) => {
              patchResultConfig({ measuredAllowTies: v });
            }}
            onMassStartValueKindChange={(v: CustomMassStartValueKind) => {
              patchResultConfig({ massStartValueKind: v });
            }}
            onMassStartUnitPresetChange={(v: CustomUnitPreset) => {
              patchResultConfig({ massStartUnitPreset: v });
            }}
            onMassStartUnitCustomLabelChange={(v) => {
              patchResultConfig({ massStartUnitCustomLabel: v });
            }}
            onMassStartBetterResultChange={(v: CustomBetterResult) => {
              patchResultConfig({ massStartBetterResult: v });
            }}
            onMassStartDecimalPlacesChange={(v) => {
              patchResultConfig({ massStartDecimalPlaces: v });
            }}
            onMassStartTimeFormatChange={(v: CustomTimeFormat) => {
              patchResultConfig({ massStartTimeFormat: v });
            }}
            onMassStartAllowTiesChange={(v) => {
              patchResultConfig({ massStartAllowTies: v });
            }}
            onMassStartRoundsCountChange={(v) => {
              patchResultConfig({ massStartRoundsCount: v ?? 1 });
            }}
            onMassStartAggregationModeChange={(v: CustomAggregationMode) => {
              patchResultConfig({ massStartAggregationMode: v });
            }}
            onStageChange={updateStage}
          />

          {isCreateMode && (
            <div className="pt-2">
              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={() => {
                    void goNext();
                  }}
                  disabled={saving || disableForm || !name.trim()}
                >
                  {saving ? "Zapisywanie..." : "Utwórz turniej"}
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="lg:sticky lg:top-[92px]">
          <SummaryCard
            isTournamentCreated={isTournamentCreated}
            discipline={discipline}
            format={format}
            participants={participants}
            preview={preview}
            isAssistantReadOnly={isAssistantReadOnly}
            competitionType={competitionType}
            competitionModel={competitionModel}
            customDisciplineName={customDisciplineName}
            resultConfig={resultConfig}
          />
        </div>
      </div>

      <ConfirmModal
        open={confirmOpen}
        title={confirmTitle}
        message={confirmMessage}
        confirmLabel={confirmConfirmLabel}
        cancelLabel={confirmCancelLabel}
        onConfirm={() => resolveConfirm(true)}
        onCancel={() => resolveConfirm(false)}
      />
    </div>
  );
}