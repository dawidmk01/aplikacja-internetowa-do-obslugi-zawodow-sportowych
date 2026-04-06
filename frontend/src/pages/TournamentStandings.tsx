// frontend/src/pages/TournamentStandings.tsx
// Plik renderuje klasyfikację turnieju i rozdziela prezentację tabel klasycznych, customowych oraz drabinki.

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import { motion } from "framer-motion";
import { Brackets, Gauge, LayoutGrid, Table2, TimerReset, Trophy } from "lucide-react";

import { apiFetch, apiGet } from "../api";
import DivisionSwitcher, {
  type DivisionSwitcherItem,
} from "../components/DivisionSwitcher";
import { cn } from "../lib/cn";
import { displayGroupName, isByeMatch } from "../flow/stagePresentation";

import { Card } from "../ui/Card";
import { InlineAlert } from "../ui/InlineAlert";

import type {
  CustomBetterResult,
  CustomResultValueKind,
  MatchDTO,
  TournamentDTO,
  TournamentResultConfigDTO,
  TournamentStandingsResponseDTO,
  StandingsRowDTO,
} from "../types/results";

type Tournament = TournamentDTO;

type MatchDto = MatchDTO;

type StandingRow = StandingsRowDTO;

type FormResult = "W" | "D" | "L";

type BracketDuelItem = {
  id: number;
  status: "SCHEDULED" | "IN_PROGRESS" | "FINISHED";

  home_team_id: number;
  away_team_id: number;
  home_team_name: string;
  away_team_name: string;

  winner_id: number | null;

  is_two_legged: boolean;

  score_leg1_home: number | null;
  score_leg1_away: number | null;
  score_leg2_home?: number | null;
  score_leg2_away?: number | null;

  aggregate_home?: number | null;
  aggregate_away?: number | null;

  penalties_leg1_home?: number | null;
  penalties_leg1_away?: number | null;
  penalties_leg2_home?: number | null;
  penalties_leg2_away?: number | null;

  tennis_sets_leg1?: unknown[] | null;
  tennis_sets_leg2?: unknown[] | null;
};

type BracketRound = {
  round_number: number;
  label: string;
  items: BracketDuelItem[];
};

type BracketData = {
  rounds: BracketRound[];
  third_place: BracketDuelItem | null;
};

type GroupStanding = {
  group_id: number;
  group_name: string;
  table: StandingRow[];
};

type StandingsMeta = TournamentStandingsResponseDTO["meta"];

type StandingsResponse = {
  meta?: StandingsMeta;
  table?: StandingRow[];
  groups?: GroupStanding[];
  bracket?: BracketData;
};

type DivisionStatus = "DRAFT" | "CONFIGURED" | "RUNNING" | "FINISHED";

type DivisionSummaryDTO = DivisionSwitcherItem & {
  status?: DivisionStatus;
};

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

function normalizeGroupKey(name: string | null | undefined): string {
  const s = (name ?? "").trim().toLowerCase();
  if (!s) return "";
  return s.replace(/^grupa\s+/i, "").trim();
}

function last5Form(teamId: number, matches: MatchDto[]): FormResult[] {
  return matches
    .filter(
      (m) =>
        m.status === "FINISHED" &&
        !isByeMatch(m) &&
        (m.home_team_id === teamId || m.away_team_id === teamId)
    )
    .sort((a, b) => {
      if (a.stage_order !== b.stage_order) return b.stage_order - a.stage_order;

      const ra = a.round_number ?? 0;
      const rb = b.round_number ?? 0;
      if (ra !== rb) return rb - ra;

      return b.id - a.id;
    })
    .slice(0, 5)
    .map((m) => {
      const isHome = m.home_team_id === teamId;
      const scored = isHome ? (m.home_score ?? 0) : (m.away_score ?? 0);
      const conceded = isHome ? (m.away_score ?? 0) : (m.home_score ?? 0);

      if (scored > conceded) return "W";
      if (scored < conceded) return "L";
      return "D";
    });
}

function formatTennisSets(tennisSets: unknown): string | null {
  if (!Array.isArray(tennisSets) || tennisSets.length === 0) return null;

  const parts: string[] = [];
  for (const s of tennisSets) {
    if (!s || typeof s !== "object") continue;

    const homeGames = Number((s as { home_games?: unknown }).home_games);
    const awayGames = Number((s as { away_games?: unknown }).away_games);
    if (!Number.isFinite(homeGames) || !Number.isFinite(awayGames)) continue;

    const homeTb = (s as { home_tiebreak?: unknown }).home_tiebreak;
    const awayTb = (s as { away_tiebreak?: unknown }).away_tiebreak;

    if (Number.isFinite(Number(homeTb)) && Number.isFinite(Number(awayTb))) {
      parts.push(`${homeGames}-${awayGames}(${Number(homeTb)}-${Number(awayTb)})`);
    } else {
      parts.push(`${homeGames}-${awayGames}`);
    }
  }

  return parts.length ? parts.join(", ") : null;
}

function formatPenalties(
  home: number | null | undefined,
  away: number | null | undefined
): string | null {
  if (home == null || away == null) return null;
  return `k. ${home}:${away}`;
}

function safeNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function getTennisPointsMode(
  tournament: Tournament | null,
  standings: StandingsResponse | null
): "PLT" | "NONE" {
  const tMode = (tournament?.format_config?.tennis_points_mode ?? "")
    .toString()
    .toUpperCase();
  if (tMode === "PLT") return "PLT";
  if (tMode === "NONE") return "NONE";

  const sMode = (standings?.meta?.tennis_points_mode ?? "")
    .toString()
    .toUpperCase();
  if (sMode === "PLT") return "PLT";
  if (sMode === "NONE") return "NONE";

  return "NONE";
}

function normalizeMatchList(raw: unknown): MatchDto[] {
  if (Array.isArray(raw)) return raw as MatchDto[];
  if (Array.isArray((raw as { results?: unknown[] } | null)?.results)) {
    return (raw as { results: MatchDto[] }).results;
  }
  return [];
}

function getResultConfig(
  tournament: Tournament | null,
  standings: StandingsResponse | null
): TournamentResultConfigDTO {
  if (standings?.meta?.result_config) return standings.meta.result_config;
  if (tournament?.result_config) return tournament.result_config;
  return {};
}

function getCustomMode(standings: StandingsResponse | null): string {
  const direct = String(standings?.meta?.custom_mode ?? "").toUpperCase();
  if (direct) return direct;

  const schema = String(standings?.meta?.table_schema ?? "").toUpperCase();
  if (schema === "CUSTOM_POINTS") return "HEAD_TO_HEAD_POINTS";
  if (schema === "CUSTOM_MEASURED_HEAD_TO_HEAD") return "HEAD_TO_HEAD_MEASURED";
  if (schema === "CUSTOM_MEASURED_MASS_START") return "MASS_START_MEASURED";
  return "";
}

function getCustomValueKind(
  config: TournamentResultConfigDTO,
  customMode: string,
  row?: StandingRow | null
): CustomResultValueKind | "" {
  const rowValueKind = String(row?.custom_value_kind ?? "").toUpperCase();
  if (rowValueKind === "NUMBER" || rowValueKind === "TIME" || rowValueKind === "PLACE") {
    return rowValueKind;
  }

  if (customMode === "HEAD_TO_HEAD_MEASURED") {
    const measured = String(config.measured_value_kind ?? config.value_kind ?? "").toUpperCase();
    if (measured === "NUMBER" || measured === "TIME" || measured === "PLACE") return measured;
  }

  if (customMode === "MASS_START_MEASURED") {
    const massStart = String(config.mass_start_value_kind ?? config.value_kind ?? "").toUpperCase();
    if (massStart === "NUMBER" || massStart === "TIME" || massStart === "PLACE") return massStart;
  }

  const fallback = String(config.value_kind ?? "").toUpperCase();
  if (fallback === "NUMBER" || fallback === "TIME" || fallback === "PLACE") return fallback;
  return "";
}

function formatCustomTimeValue(valueMs: number, config: TournamentResultConfigDTO): string {
  const totalMs = Math.max(0, Number(valueMs) || 0);
  const totalSeconds = Math.floor(totalMs / 1000);
  const ms = totalMs % 1000;
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const hundredths = Math.floor(ms / 10);
  const format = String(config.time_format ?? "MM:SS.hh");

  if (format === "HH:MM:SS") return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  if (format === "MM:SS") return `${String(totalMinutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  if (format === "SS.hh") return `${totalSeconds}.${String(hundredths).padStart(2, "0")}`;
  return `${String(totalMinutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

function formatCustomResultDisplay(
  row: StandingRow,
  config: TournamentResultConfigDTO,
  customMode: string
): string {
  const fromBackend = String(row.custom_result_display ?? "").trim();
  if (fromBackend) return fromBackend;

  const unitLabel = String(config.unit_label ?? config.unit ?? "").trim();
  const valueKind = getCustomValueKind(config, customMode, row);

  if (valueKind === "TIME" && row.custom_result_time_ms != null) {
    return formatCustomTimeValue(row.custom_result_time_ms, config);
  }

  if (valueKind === "PLACE" && row.custom_result_place != null) {
    return String(row.custom_result_place);
  }

  if (row.custom_result_numeric != null) {
    return unitLabel
      ? `${row.custom_result_numeric} ${unitLabel}`
      : String(row.custom_result_numeric);
  }

  return "-";
}

function getCustomRankingDescription(
  config: TournamentResultConfigDTO,
  customMode: string
): string {
  if (customMode === "HEAD_TO_HEAD_POINTS") {
    return "Klasyfikacja jest liczona jak tabela punktowa i zachowuje układ tabeli meczowej.";
  }

  const valueKind = getCustomValueKind(config, customMode, null);
  const better = String(config.better_result ?? "").toUpperCase() as CustomBetterResult | "";
  const unitLabel = String(config.unit_label ?? config.unit ?? "").trim();

  if (valueKind === "TIME") {
    const format = String(config.time_format ?? "MM:SS.hh");
    return `Ranking według czasu. Lepszy jest wynik niższy. Format prezentacji: ${format}.`;
  }

  if (valueKind === "PLACE") {
    return "Ranking według miejsca. Lepsza jest wartość niższa.";
  }

  if (valueKind === "NUMBER") {
    const direction =
      better === "LOWER" ? "Lepszy jest wynik niższy." : "Lepszy jest wynik wyższy.";
    const decimals =
      typeof config.decimal_places === "number" ? config.decimal_places : 0;
    const unitInfo = unitLabel ? ` Jednostka: ${unitLabel}.` : "";
    return `Ranking według wartości liczbowej. ${direction}${unitInfo} Dokładność: ${decimals} miejsce po przecinku.`;
  }

  return "Ranking niestandardowy.";
}

function getCustomModeBadgeLabel(customMode: string, valueKind: CustomResultValueKind | ""): string {
  if (customMode === "HEAD_TO_HEAD_POINTS") return "Tabela punktowa";
  if (valueKind === "TIME") return "Ranking czasowy";
  if (valueKind === "PLACE") return "Ranking miejsc";
  if (valueKind === "NUMBER") return "Ranking liczbowy";
  return "Ranking custom";
}

// ===== Strona: tabela i drabinka =====

export default function TournamentStandings() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const searchParamsKey = searchParams.toString();

  const requestedDivisionId = useMemo(() => {
    const current = new URLSearchParams(searchParamsKey);
    return (
      parseDivisionId(current.get("division_id")) ??
      parseDivisionId(current.get("active_division_id"))
    );
  }, [searchParamsKey]);

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [divisions, setDivisions] = useState<DivisionSummaryDTO[]>([]);
  const [activeDivisionId, setActiveDivisionId] = useState<number | null>(requestedDivisionId);
  const [activeDivisionName, setActiveDivisionName] = useState<string | null>(null);

  const effectiveDivisionId = requestedDivisionId ?? activeDivisionId;

  const [matches, setMatches] = useState<MatchDto[]>([]);
  const [standings, setStandings] = useState<StandingsResponse | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<"TABLE" | "BRACKET">("TABLE");
  const [layoutMode, setLayoutMode] = useState<"STANDARD" | "CENTERED">("STANDARD");

  useEffect(() => {
    if (!id) return;

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const t = await apiGet<Tournament>(
          withDivisionQuery(`/api/tournaments/${id}/`, effectiveDivisionId)
        );
        if (cancelled) return;

        setTournament(t);
        setDivisions(
          Array.isArray((t as any).divisions) ? ((t as any).divisions as DivisionSummaryDTO[]) : []
        );
        setActiveDivisionId((t as any).active_division_id ?? effectiveDivisionId ?? null);
        setActiveDivisionName((t as any).active_division_name ?? null);

        if (
          !requestedDivisionId &&
          (t as any).active_division_id &&
          Array.isArray((t as any).divisions) &&
          ((t as any).divisions as DivisionSummaryDTO[]).length > 1
        ) {
          const next = new URLSearchParams(searchParamsKey);
          next.set("division_id", String((t as any).active_division_id));
          setSearchParams(next, { replace: true });
        }

        if (t.tournament_format === "CUP") setTab("BRACKET");

        const resolvedDivisionId = (t as any).active_division_id ?? effectiveDivisionId ?? null;

        const [sRes, mRes] = await Promise.all([
          apiFetch(withDivisionQuery(`/api/tournaments/${id}/standings/`, resolvedDivisionId)),
          apiFetch(withDivisionQuery(`/api/tournaments/${id}/matches/`, resolvedDivisionId)),
        ]);

        if (!cancelled) {
          if (sRes.ok) {
            const data = (await sRes.json()) as StandingsResponse;
            setStandings(data);
          } else {
            setStandings(null);
          }

          if (mRes.ok) {
            const raw = await mRes.json();
            setMatches(normalizeMatchList(raw));
          } else {
            setMatches([]);
          }
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Wystąpił błąd");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [effectiveDivisionId, id, requestedDivisionId, searchParamsKey, setSearchParams]);

  const derived = useMemo(() => {
    const tournamentDiscipline = (tournament?.discipline ?? "").toLowerCase();
    const metaSchema = (standings?.meta?.table_schema ?? "").toUpperCase();
    const metaDiscipline = (standings?.meta?.discipline ?? "").toLowerCase();
    const customMode = getCustomMode(standings);

    const discipline = (metaDiscipline || tournamentDiscipline || "").toLowerCase();
    const isTennis = metaSchema === "TENNIS" || discipline === "tennis";
    const isCustom = metaSchema.startsWith("CUSTOM") || String(standings?.meta?.result_mode ?? "").toUpperCase() === "CUSTOM";
    const isCustomMeasured =
      customMode === "HEAD_TO_HEAD_MEASURED" ||
      customMode === "MASS_START_MEASURED" ||
      metaSchema === "CUSTOM_MEASURED_HEAD_TO_HEAD" ||
      metaSchema === "CUSTOM_MEASURED_MASS_START";
    const isMassStartMeasured = customMode === "MASS_START_MEASURED" || metaSchema === "CUSTOM_MEASURED_MASS_START";

    const tennisPointsMode = getTennisPointsMode(tournament, standings);
    const showTennisPoints = isTennis && tennisPointsMode === "PLT";

    const isCup = tournament?.tournament_format === "CUP";
    const isMixed = tournament?.tournament_format === "MIXED";

    const hasLeagueTable = (standings?.table?.length ?? 0) > 0;
    const hasGroups = (standings?.groups?.length ?? 0) > 0;
    const hasTableData = hasLeagueTable || hasGroups;
    const hasBracketData = (standings?.bracket?.rounds?.length ?? 0) > 0;

    return {
      discipline,
      isTennis,
      isCustom,
      isCustomMeasured,
      isMassStartMeasured,
      showTennisPoints,
      isCup: !!isCup,
      isMixed: !!isMixed,
      hasLeagueTable,
      hasGroups,
      hasTableData,
      hasBracketData,
    };
  }, [standings, tournament]);

  const customResultConfig = useMemo(
    () => getResultConfig(tournament, standings),
    [standings, tournament]
  );

  const customMode = useMemo(() => getCustomMode(standings), [standings]);
  const customValueKind = useMemo(
    () => getCustomValueKind(customResultConfig, customMode, null),
    [customMode, customResultConfig]
  );

  const customDisciplineLabel = useMemo(() => {
    const fromMeta = String(standings?.meta?.custom_discipline_name ?? "").trim();
    if (fromMeta) return fromMeta;

    const fromTournament = String(tournament?.custom_discipline_name ?? "").trim();
    if (fromTournament) return fromTournament;

    return "Dyscyplina niestandardowa";
  }, [standings, tournament]);


  const handleDivisionSwitch = (nextDivisionId: number) => {
    if (nextDivisionId === effectiveDivisionId) return;
    const next = new URLSearchParams(searchParamsKey);
    next.set("division_id", String(nextDivisionId));
    setSearchParams(next, { replace: false });
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[1400px] px-4 pb-24">
        <Card className="relative overflow-hidden p-6">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -top-24 left-1/2 h-48 w-[28rem] -translate-x-1/2 rounded-full bg-indigo-500/10 blur-3xl" />
            <div className="absolute -bottom-24 left-1/2 h-48 w-[28rem] -translate-x-1/2 rounded-full bg-sky-500/10 blur-3xl" />
          </div>

          <div className="relative animate-pulse space-y-3">
            <div className="h-4 w-40 rounded bg-white/10" />
            <div className="h-8 w-72 rounded bg-white/10" />
            <div className="h-40 w-full rounded-xl bg-white/5" />
          </div>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto w-full max-w-[1400px] px-4 pb-24">
        <InlineAlert variant="error">{error}</InlineAlert>
      </div>
    );
  }

  if (!tournament) return null;

  const {
    discipline,
    isTennis,
    isCustom,
    isCustomMeasured,
    isMassStartMeasured,
    showTennisPoints,
    isCup,
    isMixed,
    hasLeagueTable,
    hasGroups,
    hasTableData,
    hasBracketData,
  } = derived;

  const showTabs = isMixed || (hasTableData && hasBracketData);
  const showTableEmpty = !isCup && tab === "TABLE" && !hasGroups && !hasLeagueTable;
  const showMassStartInfo = isMassStartMeasured && !hasTableData && tab === "TABLE";

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 pb-24">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-slate-300">Tabela i drabinka</div>
          <h1 className="mt-1 text-2xl font-semibold text-white">{tournament.name}</h1>
          {activeDivisionName ? (
            <div className="mt-1 text-sm text-slate-400">
              Aktywna dywizja: <span className="text-slate-200">{activeDivisionName}</span>
            </div>
          ) : null}
        </div>

        <DivisionSwitcher
          divisions={divisions}
          activeDivisionId={effectiveDivisionId}
          onChange={handleDivisionSwitch}
          disabled={loading}
        />
      </div>

      {isCustomMeasured ? (
        <Card className="relative mb-5 overflow-hidden p-5 sm:p-6">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -top-24 left-1/2 h-48 w-[28rem] -translate-x-1/2 rounded-full bg-indigo-500/10 blur-3xl" />
            <div className="absolute -bottom-24 left-1/2 h-48 w-[28rem] -translate-x-1/2 rounded-full bg-sky-500/10 blur-3xl" />
          </div>

          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="text-xs text-slate-400">Klasyfikacja niestandardowa</div>
              <div className="mt-1 text-lg font-semibold text-slate-100">
                {customDisciplineLabel}
              </div>
              <div className="mt-3 text-sm text-slate-300">
                {getCustomRankingDescription(customResultConfig, customMode)}
              </div>
            </div>

            <div className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-2 text-xs font-semibold text-slate-200">
              {customValueKind === "TIME" ? (
                <TimerReset className="h-4 w-4 text-slate-200" />
              ) : (
                <Gauge className="h-4 w-4 text-slate-200" />
              )}
              {getCustomModeBadgeLabel(customMode, customValueKind)}
            </div>
          </div>
        </Card>
      ) : null}

      {showTabs ? (
        <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="Widok tabeli i drabinki">
          <SegmentButton
            id="standings-tab-table"
            panelId="standings-panel-table"
            icon={<Table2 className="h-4 w-4 text-white/80" />}
            active={tab === "TABLE"}
            onClick={() => setTab("TABLE")}
          >
            Tabela
          </SegmentButton>
          <SegmentButton
            id="standings-tab-bracket"
            panelId="standings-panel-bracket"
            icon={<Brackets className="h-4 w-4 text-white/80" />}
            active={tab === "BRACKET"}
            onClick={() => setTab("BRACKET")}
          >
            Drabinka
          </SegmentButton>
        </div>
      ) : null}

      <motion.div
        key={tab}
        initial={{ opacity: 0, y: 10, filter: "blur(2px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ duration: 0.25, ease: "easeOut" }}
      >
        {tab === "TABLE" ? (
          <div id="standings-panel-table" role="tabpanel" aria-labelledby="standings-tab-table">
            {hasGroups ? (
              <div className="space-y-4">
                {standings!.groups!.map((g, idx) => {
                  const groupTitle =
                    (g.group_name || "").toLowerCase().startsWith("grupa")
                      ? g.group_name
                      : displayGroupName(g.group_name, idx);

                  const groupKey = normalizeGroupKey(g.group_name);
                  const groupMatches = matches.filter(
                    (m) => m.stage_type === "GROUP" && normalizeGroupKey(m.group_name) === groupKey
                  );

                  return (
                    <Card key={g.group_id} className="relative overflow-hidden p-5 sm:p-6">
                      <div className="pointer-events-none absolute inset-0">
                        <div className="absolute -top-24 left-1/2 h-48 w-[28rem] -translate-x-1/2 rounded-full bg-indigo-500/10 blur-3xl" />
                        <div className="absolute -bottom-24 left-1/2 h-48 w-[28rem] -translate-x-1/2 rounded-full bg-sky-500/10 blur-3xl" />
                      </div>

                      <div className="relative">
                        <div className="mb-3">
                          <div className="text-xs text-slate-400">Faza grupowa</div>
                          <div className="mt-1 text-lg font-semibold text-slate-100">{groupTitle}</div>
                        </div>

                        <StandingsTable
                          rows={g.table}
                          matchesForForm={groupMatches}
                          isTennis={isTennis}
                          isCustomMeasured={isCustomMeasured}
                          showTennisPoints={showTennisPoints}
                          customResultConfig={customResultConfig}
                        />
                      </div>
                    </Card>
                  );
                })}
              </div>
            ) : hasLeagueTable ? (
              <Card className="relative overflow-hidden p-5 sm:p-6">
                <div className="pointer-events-none absolute inset-0">
                  <div className="absolute -top-24 left-1/2 h-48 w-[28rem] -translate-x-1/2 rounded-full bg-indigo-500/10 blur-3xl" />
                  <div className="absolute -bottom-24 left-1/2 h-48 w-[28rem] -translate-x-1/2 rounded-full bg-sky-500/10 blur-3xl" />
                </div>

                <div className="relative">
                  <div className="mb-3">
                    <div className="text-xs text-slate-400">
                      {isCustom ? "Ranking" : "Tabela"}
                    </div>
                    <div className="mt-1 text-lg font-semibold text-slate-100">
                      {isCustom ? "Klasyfikacja" : "Klasyfikacja"}
                    </div>
                  </div>

                  <StandingsTable
                    rows={standings!.table!}
                    matchesForForm={matches.filter((m) => m.stage_type === "LEAGUE")}
                    isTennis={isTennis}
                    isCustomMeasured={isCustomMeasured}
                    showTennisPoints={showTennisPoints}
                    customResultConfig={customResultConfig}
                  />
                </div>
              </Card>
            ) : showMassStartInfo ? (
              <InlineAlert variant="info">
                Ranking etapowy dla trybu MASS_START jest prezentowany po stronie rezultatów etapowych.
              </InlineAlert>
            ) : showTableEmpty ? (
              <InlineAlert variant="info">Brak danych tabeli.</InlineAlert>
            ) : null}
          </div>
        ) : hasBracketData ? (
          <div id="standings-panel-bracket" role="tabpanel" aria-labelledby="standings-tab-bracket">
            <Card className="relative overflow-hidden p-5 sm:p-6">
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute -top-24 left-1/2 h-48 w-[28rem] -translate-x-1/2 rounded-full bg-indigo-500/10 blur-3xl" />
                <div className="absolute -bottom-24 left-1/2 h-48 w-[28rem] -translate-x-1/2 rounded-full bg-sky-500/10 blur-3xl" />
              </div>

              <div className="relative">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-xs text-slate-400">Drabinka</div>
                    <div className="mt-1 text-lg font-semibold text-slate-100">Faza pucharowa</div>
                  </div>

                  <div className="flex flex-wrap gap-2" aria-label="Układ drabinki">
                    <SmallToggle
                      active={layoutMode === "STANDARD"}
                      onClick={() => setLayoutMode("STANDARD")}
                      icon={<LayoutGrid className="h-4 w-4 text-white/70" />}
                    >
                      Standard
                    </SmallToggle>
                    <SmallToggle
                      active={layoutMode === "CENTERED"}
                      onClick={() => setLayoutMode("CENTERED")}
                      icon={<Trophy className="h-4 w-4 text-amber-200" />}
                    >
                      Finał w środku
                    </SmallToggle>
                  </div>
                </div>

                {layoutMode === "STANDARD" ? (
                  <StandardBracketView data={standings!.bracket!} discipline={discipline} />
                ) : (
                  <CenteredBracketView data={standings!.bracket!} discipline={discipline} />
                )}
              </div>
            </Card>
          </div>
        ) : (
          <InlineAlert variant="info">
            Brak danych drabinki lub faza pucharowa jeszcze się nie rozpoczęła.
          </InlineAlert>
        )}
      </motion.div>
    </div>
  );
}

// ===== UI helpers =====

function SegmentButton({
  id,
  panelId,
  active,
  onClick,
  icon,
  children,
}: {
  id: string;
  panelId: string;
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      id={id}
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={panelId}
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      className={cn(
        "relative inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold transition",
        "border border-white/10 bg-white/[0.06] text-slate-200 hover:bg-white/[0.10]",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/15",
        active && "border-white/15"
      )}
    >
      {active ? (
        <motion.div
          layoutId="standings-page-tab-active"
          className="absolute inset-0 rounded-full bg-white/10"
          transition={{ type: "spring", bounce: 0.18, duration: 0.55 }}
        />
      ) : null}

      <span className="relative z-10">{icon}</span>
      <span className="relative z-10">{children}</span>
    </button>
  );
}

function SmallToggle({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "relative inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition",
        "border border-white/10 bg-white/[0.06] text-slate-200 hover:bg-white/[0.10]",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/15",
        active && "border-white/15"
      )}
    >
      {active ? (
        <motion.div
          layoutId="standings-page-layout-active"
          className="absolute inset-0 rounded-full bg-white/10"
          transition={{ type: "spring", bounce: 0.18, duration: 0.55 }}
        />
      ) : null}

      <span className="relative z-10 inline-flex items-center gap-2">
        {icon}
        {children}
      </span>
    </button>
  );
}

// ===== Tabela =====

function StandingsTable({
  rows,
  matchesForForm,
  isTennis,
  isCustomMeasured,
  showTennisPoints,
  customResultConfig,
}: {
  rows: StandingRow[];
  matchesForForm: MatchDto[];
  isTennis: boolean;
  isCustomMeasured: boolean;
  showTennisPoints: boolean;
  customResultConfig: TournamentResultConfigDTO;
}) {
  const customMode = String(rows[0]?.custom_mode ?? "").toUpperCase();
  const minW = isCustomMeasured
    ? "min-w-[700px]"
    : isTennis
      ? showTennisPoints
        ? "min-w-[950px]"
        : "min-w-[900px]"
      : "min-w-[640px]";

  return (
    <div
      className={cn(
        "relative rounded-2xl border border-white/10 bg-black/10",
        "shadow-[0_10px_30px_rgba(0,0,0,0.25)]"
      )}
    >
      <div className="max-h-[540px] overflow-auto">
        <table className={cn("w-full border-separate border-spacing-0", minW)}>
          <thead>
            {isCustomMeasured ? (
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                <ThSticky>#</ThSticky>
                <ThSticky>Uczestnik</ThSticky>
                <ThSticky>Wynik</ThSticky>
                <ThSticky>Typ</ThSticky>
                <ThSticky className="pr-3">Status</ThSticky>
              </tr>
            ) : isTennis ? (
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                <ThSticky>#</ThSticky>
                <ThSticky>Zawodnik</ThSticky>
                <ThSticky>M</ThSticky>
                <ThSticky>Z</ThSticky>
                <ThSticky>P</ThSticky>
                <ThSticky>Sety +</ThSticky>
                <ThSticky>Sety -</ThSticky>
                <ThSticky>RS</ThSticky>
                <ThSticky>Gemy +</ThSticky>
                <ThSticky>Gemy -</ThSticky>
                <ThSticky>RG</ThSticky>
                {showTennisPoints ? <ThSticky>Pkt (PLT)</ThSticky> : null}
                <ThSticky className="pr-3">Forma</ThSticky>
              </tr>
            ) : (
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                <ThSticky>#</ThSticky>
                <ThSticky>Drużyna</ThSticky>
                <ThSticky>M</ThSticky>
                <ThSticky>Z</ThSticky>
                <ThSticky>R</ThSticky>
                <ThSticky>P</ThSticky>
                <ThSticky>B+</ThSticky>
                <ThSticky>B-</ThSticky>
                <ThSticky>RB</ThSticky>
                <ThSticky>Pkt</ThSticky>
                <ThSticky className="pr-3">Forma</ThSticky>
              </tr>
            )}
          </thead>

          <tbody className="text-sm text-slate-100">
            {rows.map((r, i) => {
              const form = last5Form(r.team_id, matchesForForm);

              const rowClass = cn(
                "border-t border-white/10",
                i % 2 === 0 ? "bg-white/[0.01]" : "bg-transparent",
                "hover:bg-white/[0.04] transition"
              );

              if (isCustomMeasured) {
                const position = r.rank ?? i + 1;
                const valueKind = getCustomValueKind(customResultConfig, customMode, r);
                const hasResult =
                  r.custom_result_display != null ||
                  r.custom_result_numeric != null ||
                  r.custom_result_time_ms != null ||
                  r.custom_result_place != null;
                const resultLabel = formatCustomResultDisplay(r, customResultConfig, customMode);
                const kindLabel =
                  valueKind === "TIME"
                    ? "Czas"
                    : valueKind === "PLACE"
                      ? "Miejsce"
                      : "Liczba";

                return (
                  <tr key={r.team_id} className={rowClass}>
                    <td className="py-3 pl-3 pr-3 text-slate-300">{position}</td>
                    <td className="py-3 pr-3 font-semibold">
                      <span className="block max-w-[360px] truncate">{r.team_name}</span>
                    </td>
                    <td className="py-3 pr-3">
                      <span className="font-semibold text-sky-200">{resultLabel}</span>
                    </td>
                    <td className="py-3 pr-3 text-slate-200">{kindLabel}</td>
                    <td className="py-3 pr-3">
                      <span
                        className={cn(
                          "inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                          hasResult
                            ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-100"
                            : "border-white/10 bg-white/[0.04] text-slate-300"
                        )}
                      >
                        {hasResult ? "Wynik zapisany" : "Brak wyniku"}
                      </span>
                    </td>
                  </tr>
                );
              }

              if (isTennis) {
                const setsFor = safeNum(r.sets_for, safeNum(r.goals_for, 0));
                const setsAgainst = safeNum(r.sets_against, safeNum(r.goals_against, 0));
                const setsDiff = safeNum(
                  r.sets_diff,
                  safeNum(r.goal_difference, setsFor - setsAgainst)
                );

                const gamesFor = safeNum(r.games_for, 0);
                const gamesAgainst = safeNum(r.games_against, 0);
                const gamesDiff = safeNum(
                  r.games_diff,
                  safeNum(r.games_difference, gamesFor - gamesAgainst)
                );

                return (
                  <tr key={r.team_id} className={rowClass}>
                    <td className="py-3 pl-3 pr-3 text-slate-300">{i + 1}</td>
                    <td className="py-3 pr-3 font-semibold">
                      <span className="block max-w-[360px] truncate">{r.team_name}</span>
                    </td>
                    <td className="py-3 pr-3 text-slate-200">{r.played}</td>
                    <td className="py-3 pr-3 text-slate-200">{r.wins}</td>
                    <td className="py-3 pr-3 text-slate-200">{r.losses}</td>
                    <td className="py-3 pr-3 text-slate-200">{setsFor}</td>
                    <td className="py-3 pr-3 text-slate-200">{setsAgainst}</td>
                    <td className="py-3 pr-3 text-slate-200">{setsDiff}</td>
                    <td className="py-3 pr-3 text-slate-200">{gamesFor}</td>
                    <td className="py-3 pr-3 text-slate-200">{gamesAgainst}</td>
                    <td className="py-3 pr-3 text-slate-200">{gamesDiff}</td>

                    {showTennisPoints ? (
                      <td className="py-3 pr-3">
                        <span className="font-semibold text-sky-200">{r.points}</span>
                      </td>
                    ) : null}

                    <td className="py-3 pr-3">
                      <FormDots form={form} />
                    </td>
                  </tr>
                );
              }

              return (
                <tr key={r.team_id} className={rowClass}>
                  <td className="py-3 pl-3 pr-3 text-slate-300">{i + 1}</td>
                  <td className="py-3 pr-3 font-semibold">
                    <span className="block max-w-[360px] truncate">{r.team_name}</span>
                  </td>
                  <td className="py-3 pr-3 text-slate-200">{r.played}</td>
                  <td className="py-3 pr-3 text-slate-200">{r.wins}</td>
                  <td className="py-3 pr-3 text-slate-200">{r.draws}</td>
                  <td className="py-3 pr-3 text-slate-200">{r.losses}</td>
                  <td className="py-3 pr-3 text-slate-200">{r.goals_for}</td>
                  <td className="py-3 pr-3 text-slate-200">{r.goals_against}</td>
                  <td className="py-3 pr-3 text-slate-200">{r.goal_difference}</td>
                  <td className="py-3 pr-3">
                    <span className="font-semibold text-sky-200">{r.points}</span>
                  </td>
                  <td className="py-3 pr-3">
                    <FormDots form={form} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ThSticky({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cn(
        "sticky top-0 z-10 border-b border-white/10 bg-slate-950/85 backdrop-blur",
        "py-3 pl-3 pr-3",
        className
      )}
    >
      {children}
    </th>
  );
}

function FormDots({ form }: { form: FormResult[] }) {
  return (
    <div className="flex gap-1.5" aria-label="Forma (ostatnie 5 meczów)">
      {form.map((f, idx) => (
        <span
          key={`${f}-${idx}`}
          className={cn(
            "inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-white",
            f === "W" && "bg-emerald-500/80",
            f === "D" && "bg-slate-400/70",
            f === "L" && "bg-rose-500/80"
          )}
        >
          {f}
        </span>
      ))}
    </div>
  );
}

// ===== Drabinka =====

function StatusPill({ status }: { status: BracketDuelItem["status"] }) {
  const label =
    status === "IN_PROGRESS"
      ? "Na żywo"
      : status === "FINISHED"
        ? "Zakończony"
        : "Zaplanowany";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-semibold",
        status === "IN_PROGRESS" &&
          "border-emerald-400/30 bg-emerald-500/10 text-emerald-200",
        status === "FINISHED" && "border-white/10 bg-white/5 text-slate-200",
        status === "SCHEDULED" && "border-white/10 bg-white/5 text-slate-300"
      )}
    >
      {status === "IN_PROGRESS" ? (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300" />
      ) : null}
      {label}
    </span>
  );
}

function StandardBracketView({
  data,
  discipline,
}: {
  data: BracketData;
  discipline: string;
}) {
  const { rounds, third_place } = data;

  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-slate-950/80 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-slate-950/80 to-transparent" />

      <div className="overflow-x-auto pb-2">
        <div className="flex gap-7 snap-x snap-mandatory">
          {rounds.map((round) => (
            <div key={round.round_number} className="snap-start">
              <RoundColumn label={round.label} items={round.items} discipline={discipline} />
            </div>
          ))}

          {third_place ? (
            <div className="flex min-w-[280px] snap-start flex-col justify-center border-l border-dashed border-white/15 pl-6">
              <div className="mb-3 text-center text-xs font-semibold uppercase tracking-wide text-amber-200">
                Mecz o 3. miejsce
              </div>
              <div className="flex justify-center">
                <BracketMatchCard
                  item={third_place}
                  isThirdPlace
                  discipline={discipline}
                />
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CenteredBracketView({
  data,
  discipline,
}: {
  data: BracketData;
  discipline: string;
}) {
  const { rounds, third_place } = data;
  if (rounds.length === 0) return null;

  const finalRound = rounds[rounds.length - 1];
  const preFinalRounds = rounds.slice(0, rounds.length - 1);

  return (
    <div className="relative overflow-x-auto pb-2">
      <div className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-slate-950/80 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-slate-950/80 to-transparent" />

      <div className="flex justify-center">
        <div className="flex items-stretch snap-x snap-mandatory">
          <div className="flex gap-5">
            {preFinalRounds.map((round) => {
              const half = Math.ceil(round.items.length / 2);
              const leftItems = round.items.slice(0, half);
              return (
                <div key={`L-${round.round_number}`} className="snap-start">
                  <RoundColumn
                    label={round.label}
                    items={leftItems}
                    discipline={discipline}
                  />
                </div>
              );
            })}
          </div>

          <div className="mx-10 flex flex-col justify-center">
            <div className="mb-3 grid place-items-center">
              <div className="grid h-10 w-10 place-items-center rounded-2xl border border-amber-500/20 bg-amber-500/10">
                <Trophy className="h-5 w-5 text-amber-200" />
              </div>
            </div>

            <RoundColumn
              label={finalRound.label}
              items={finalRound.items}
              highlight
              discipline={discipline}
            />

            {third_place ? (
              <div className="mt-8 opacity-90">
                <div className="mb-2 text-center text-xs font-semibold uppercase tracking-wide text-amber-200">
                  Mecz o 3. miejsce
                </div>
                <div className="flex justify-center">
                  <BracketMatchCard
                    item={third_place}
                    isThirdPlace
                    discipline={discipline}
                  />
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex flex-row-reverse gap-5">
            {preFinalRounds.map((round) => {
              const half = Math.ceil(round.items.length / 2);
              const rightItems = round.items.slice(half);
              if (rightItems.length === 0) return null;
              return (
                <div key={`R-${round.round_number}`} className="snap-start">
                  <RoundColumn
                    label={round.label}
                    items={rightItems}
                    discipline={discipline}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function RoundColumn({
  label,
  items,
  highlight = false,
  discipline,
}: {
  label: string;
  items: BracketDuelItem[];
  highlight?: boolean;
  discipline: string;
}) {
  return (
    <div className="flex min-w-[260px] flex-col">
      <div
        className={cn(
          "mb-4 rounded-full border px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide",
          highlight
            ? "border-amber-400/30 bg-amber-500/10 text-amber-200"
            : "border-white/10 bg-white/[0.04] text-slate-300"
        )}
      >
        {label}
      </div>

      <div className="flex flex-1 flex-col justify-around gap-4">
        {items.map((item) => (
          <BracketMatchCard key={item.id} item={item} discipline={discipline} />
        ))}
      </div>
    </div>
  );
}

function BracketMatchCard({
  item,
  isThirdPlace,
  discipline,
}: {
  item: BracketDuelItem;
  isThirdPlace?: boolean;
  discipline: string;
}) {
  const isTennis = (discipline ?? "").toLowerCase() === "tennis";

  const homeWin = item.winner_id !== null && item.winner_id === item.home_team_id;
  const awayWin = item.winner_id !== null && item.winner_id === item.away_team_id;

  const aggregateHome = item.is_two_legged
    ? item.aggregate_home ?? (item.score_leg1_home ?? 0) + (item.score_leg2_home ?? 0)
    : null;
  const aggregateAway = item.is_two_legged
    ? item.aggregate_away ?? (item.score_leg1_away ?? 0) + (item.score_leg2_away ?? 0)
    : null;

  const canShowDetails = item.status !== "SCHEDULED";

  const tennisLeg1 =
    isTennis && canShowDetails ? formatTennisSets(item.tennis_sets_leg1) : null;
  const tennisLeg2 =
    isTennis && canShowDetails ? formatTennisSets(item.tennis_sets_leg2) : null;

  const penaltiesLeg2 = !isTennis
    ? formatPenalties(item.penalties_leg2_home ?? null, item.penalties_leg2_away ?? null)
    : null;
  const penaltiesLeg1 = !isTennis
    ? formatPenalties(item.penalties_leg1_home ?? null, item.penalties_leg1_away ?? null)
    : null;
  const penaltiesText = penaltiesLeg2 || penaltiesLeg1;

  return (
    <div
      className={cn(
        "rounded-2xl border bg-white/[0.04] p-3 shadow-[0_10px_30px_rgba(0,0,0,0.25)]",
        "transition hover:bg-white/[0.06]",
        isThirdPlace ? "border-amber-500/25" : "border-white/10"
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <StatusPill status={item.status} />
          {item.is_two_legged ? (
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-semibold text-slate-200">
              Dwumecz
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div
          className={cn(
            "min-w-0 text-sm",
            homeWin ? "font-semibold text-slate-100" : "text-slate-200"
          )}
        >
          <span className="block truncate">{item.home_team_name || "TBD"}</span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <ScoreBox score={item.score_leg1_home} isAgg={false} />
          {item.is_two_legged ? (
            <ScoreBox score={item.score_leg2_home} isAgg={false} />
          ) : null}
          {item.is_two_legged ? (
            <ScoreBox score={aggregateHome} isAgg highlight={homeWin} />
          ) : null}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-3">
        <div
          className={cn(
            "min-w-0 text-sm",
            awayWin ? "font-semibold text-slate-100" : "text-slate-200"
          )}
        >
          <span className="block truncate">{item.away_team_name || "TBD"}</span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <ScoreBox score={item.score_leg1_away} isAgg={false} />
          {item.is_two_legged ? (
            <ScoreBox score={item.score_leg2_away} isAgg={false} />
          ) : null}
          {item.is_two_legged ? (
            <ScoreBox score={aggregateAway} isAgg highlight={awayWin} />
          ) : null}
        </div>
      </div>

      {tennisLeg1 || tennisLeg2 || penaltiesText ? (
        <div className="mt-3 space-y-1 text-xs text-slate-300">
          {tennisLeg1 && !item.is_two_legged ? (
            <div>
              <span className="font-semibold text-slate-200">Sety (gemy):</span>{" "}
              {tennisLeg1}
            </div>
          ) : null}

          {item.is_two_legged && (tennisLeg1 || tennisLeg2) ? (
            <div>
              <span className="font-semibold text-slate-200">Sety (gemy):</span>{" "}
              {tennisLeg1 ? tennisLeg1 : "-"} {" | "} {tennisLeg2 ? tennisLeg2 : "-"}
            </div>
          ) : null}

          {penaltiesText ? (
            <div>
              <span className="font-semibold text-slate-200">Karne:</span>{" "}
              {penaltiesText}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ScoreBox({
  score,
  isAgg,
  highlight,
}: {
  score: number | null | undefined;
  isAgg: boolean;
  highlight?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 w-7 items-center justify-center rounded-md text-xs font-semibold",
        !isAgg && "border border-white/10 bg-white/5 text-slate-100",
        isAgg && !highlight && "border border-white/10 bg-white/10 text-slate-100",
        isAgg && highlight && "border border-sky-400/30 bg-sky-500/20 text-sky-100"
      )}
      title={isAgg ? "Agregat" : "Wynik"}
    >
      {score ?? "-"}
    </span>
  );
}