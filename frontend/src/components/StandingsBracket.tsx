// frontend/src/components/StandingsBracket.tsx
// Komponent renderuje klasyfikację i drabinkę turnieju w widoku publicznym oraz panelowym.

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Brackets,
  Gauge,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  Scan,
  Table2,
  TimerReset,
} from "lucide-react";

import { apiFetch } from "../api";
import { cn } from "../lib/cn";
import { displayGroupName, isByeMatch } from "../flow/stagePresentation";

import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { InlineAlert } from "../ui/InlineAlert";

// ===== Dostęp i kontekst publiczny =====

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

function hasAccessToken(): boolean {
  try {
    const keys = ["access", "accessToken", "access_token", "jwt_access", "token"];
    for (const key of keys) {
      const value = localStorage.getItem(key);
      if (value && value.trim()) return true;
    }

    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key) continue;

      const lowered = key.toLowerCase();
      if (!lowered.includes("access") || lowered.includes("refresh")) continue;

      const value = localStorage.getItem(key);
      if (value && value.trim()) return true;
    }
  } catch {}

  return false;
}

// ===== Typy danych =====

export type Tournament = {
  id: number;
  name: string;
  discipline?: string;
  custom_discipline_name?: string | null;
  tournament_format: "LEAGUE" | "CUP" | "MIXED";
  result_mode?: "SCORE" | "CUSTOM";
  format_config?: Record<string, any>;
  result_config?: Record<string, any>;
};

export type MatchDto = {
  id: number;
  stage_type: "LEAGUE" | "GROUP" | "KNOCKOUT" | "THIRD_PLACE";
  stage_id: number;
  stage_order: number;
  round_number: number | null;
  group_name?: string | null;
  home_team_id: number;
  away_team_id: number;
  home_team_name: string;
  away_team_name: string;
  home_score: number | null;
  away_score: number | null;
  winner_id: number | null;
  status: "SCHEDULED" | "IN_PROGRESS" | "FINISHED";
};

export type StandingRow = {
  team_id: number;
  team_name: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  games_for?: number;
  games_against?: number;
  games_difference?: number;
  sets_for?: number;
  sets_against?: number;
  sets_diff?: number;
  games_diff?: number;
  rank?: number | null;
  is_custom_result?: boolean;
  custom_mode?: string | null;
  custom_value_kind?: "NUMBER" | "TIME" | "PLACE" | null;
  custom_result_numeric?: string | null;
  custom_result_time_ms?: number | null;
  custom_result_place?: number | null;
  custom_result_display?: string | null;
};

type FormResult = "W" | "D" | "L";

export type BracketDuelItem = {
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

export type BracketRound = {
  round_number: number;
  label: string;
  items: BracketDuelItem[];
};

export type BracketData = {
  rounds: BracketRound[];
  third_place: BracketDuelItem | null;
};

export type GroupStanding = {
  group_id: number;
  group_name: string;
  table: StandingRow[];
};

export type StandingsMeta = {
  discipline?: string;
  competition_model?: string;
  tournament_format?: string;
  result_mode?: string;
  table_schema?: string;
  tennis_points_mode?: string;
  custom_discipline_name?: string | null;
  custom_mode?: string;
  custom_value_kind?: string | null;
  result_config?: Record<string, any>;
  format_config?: Record<string, any>;
  shows_points_table?: boolean;
  shows_result_ranking?: boolean;
};

export type StandingsResponse = {
  meta?: StandingsMeta;
  table?: StandingRow[];
  groups?: GroupStanding[];
  bracket?: BracketData;
};

type StandingsBracketProps = {
  tournamentId: number;
  divisionId?: number;
  accessCode?: string;
  showHeader?: boolean;
};

// ===== Komponent: pobieranie i render =====

export default function StandingsBracket({
  tournamentId,
  divisionId,
  accessCode,
  showHeader = true,
}: StandingsBracketProps) {
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [matches, setMatches] = useState<MatchDto[]>([]);
  const [standings, setStandings] = useState<StandingsResponse | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const qs = useMemo(
    () =>
      appendQueryParams("", {
        code: (accessCode ?? "").trim() || undefined,
        division_id: divisionId ?? undefined,
      }),
    [accessCode, divisionId]
  );

  const url = (path: string) => `${path}${qs}`;

  useEffect(() => {
    let alive = true;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const tournamentResponse = await apiFetch(url(`/api/tournaments/${tournamentId}/`), {
          toastOnError: false,
        } as any);
        if (!tournamentResponse.ok) {
          throw new Error("Nie udało się pobrać danych turnieju.");
        }

        const tournamentData = await tournamentResponse.json();
        const nextTournament: Tournament = {
          id: tournamentData.id,
          name: tournamentData.name,
          discipline: tournamentData.discipline ?? undefined,
          custom_discipline_name: tournamentData.custom_discipline_name ?? null,
          tournament_format: (tournamentData.tournament_format ?? "LEAGUE") as Tournament["tournament_format"],
          result_mode: tournamentData.result_mode ?? "SCORE",
          format_config: tournamentData.format_config ?? undefined,
          result_config: tournamentData.result_config ?? undefined,
        };

        let nextStandings: StandingsResponse | null = null;
        const standingsResponse = await apiFetch(url(`/api/tournaments/${tournamentId}/standings/`), {
          toastOnError: false,
        } as any);

        if (standingsResponse.ok) {
          nextStandings = await standingsResponse.json();
        } else {
          const publicStandingsResponse = await apiFetch(
            url(`/api/tournaments/${tournamentId}/public/standings/`),
            { toastOnError: false } as any
          );
          if (publicStandingsResponse.ok) {
            nextStandings = await publicStandingsResponse.json();
          }
        }

        const authed = hasAccessToken();
        const isPublicContext = Boolean(accessCode) || !authed;

        const fetchAndMapPublicMatches = async () => {
          const publicMatchesResponse = await apiFetch(
            url(`/api/tournaments/${tournamentId}/public/matches/`),
            { toastOnError: false } as any
          );
          if (!publicMatchesResponse.ok) {
            throw new Error("Nie udało się pobrać meczów publicznych.");
          }

          const raw = await publicMatchesResponse.json();
          const list = Array.isArray(raw)
            ? raw
            : Array.isArray(raw?.results)
              ? raw.results
              : [];

          return list.map((match: any) => ({
            id: Number(match.id),
            stage_type: (match.stage_type ?? "LEAGUE") as MatchDto["stage_type"],
            stage_id: Number(match.stage_id ?? 0),
            stage_order: Number(match.stage_order ?? 0),
            round_number: match.round_number ?? null,
            group_name: match.group_name ?? null,
            home_team_id: Number(match.home_team_id ?? 0),
            away_team_id: Number(match.away_team_id ?? 0),
            home_team_name: String(match.home_team_name ?? ""),
            away_team_name: String(match.away_team_name ?? ""),
            home_score: match.home_score ?? null,
            away_score: match.away_score ?? null,
            winner_id: match.winner_id ?? null,
            status: (match.status ?? "SCHEDULED") as MatchDto["status"],
          }));
        };

        let nextMatches: MatchDto[] = [];

        if (isPublicContext) {
          nextMatches = await fetchAndMapPublicMatches();
        } else {
          const matchesResponse = await apiFetch(url(`/api/tournaments/${tournamentId}/matches/`), {
            toastOnError: false,
          } as any);

          if (matchesResponse.status === 401 || matchesResponse.status === 403) {
            nextMatches = await fetchAndMapPublicMatches();
          } else {
            if (!matchesResponse.ok) {
              throw new Error("Nie udało się pobrać meczów.");
            }

            const raw = await matchesResponse.json();
            nextMatches = Array.isArray(raw)
              ? raw
              : Array.isArray(raw?.results)
                ? raw.results
                : [];
          }
        }

        if (!alive) return;

        setTournament(nextTournament);
        setStandings(nextStandings);
        setMatches(nextMatches);
      } catch (err: any) {
        if (!alive) return;
        setError(err?.message || "Wystąpił błąd");
      } finally {
        if (alive) setLoading(false);
      }
    };

    void load();

    return () => {
      alive = false;
    };
  }, [accessCode, divisionId, qs, tournamentId]);

  if (loading) return <div className="text-sm text-slate-300">Ładowanie...</div>;
  if (error) return <InlineAlert variant="error">{error}</InlineAlert>;
  if (!tournament) return null;

  return (
    <TournamentStandingsView
      tournament={tournament}
      matches={matches}
      standings={standings}
      showHeader={showHeader}
    />
  );
}

// ===== Pomocnicze =====

function normalizeGroupKey(name: string | null | undefined): string {
  const normalized = (name ?? "").trim().toLowerCase();
  if (!normalized) return "";
  return normalized.replace(/^grupa\s+/i, "").trim();
}

function last5Form(teamId: number, matches: MatchDto[]): FormResult[] {
  return matches
    .filter(
      (match) =>
        match.status === "FINISHED" &&
        !isByeMatch(match) &&
        (match.home_team_id === teamId || match.away_team_id === teamId)
    )
    .sort((left, right) => {
      if (left.stage_order !== right.stage_order) {
        return right.stage_order - left.stage_order;
      }

      const leftRound = left.round_number ?? 0;
      const rightRound = right.round_number ?? 0;
      if (leftRound !== rightRound) return rightRound - leftRound;

      return right.id - left.id;
    })
    .slice(0, 5)
    .map((match) => {
      const isHome = match.home_team_id === teamId;
      const scored = isHome ? (match.home_score ?? 0) : (match.away_score ?? 0);
      const conceded = isHome ? (match.away_score ?? 0) : (match.home_score ?? 0);

      if (scored > conceded) return "W";
      if (scored < conceded) return "L";
      return "D";
    });
}

function safeNum(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getTennisPointsMode(
  tournament: Tournament | null,
  standings: StandingsResponse | null
): "PLT" | "NONE" {
  const tournamentMode = (tournament?.format_config?.tennis_points_mode ?? "")
    .toString()
    .toUpperCase();
  if (tournamentMode === "PLT") return "PLT";
  if (tournamentMode === "NONE") return "NONE";

  const standingsMode = (standings?.meta?.tennis_points_mode ?? "")
    .toString()
    .toUpperCase();
  if (standingsMode === "PLT") return "PLT";
  if (standingsMode === "NONE") return "NONE";

  return "NONE";
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getResultConfig(
  tournament: Tournament | null,
  standings: StandingsResponse | null
): Record<string, any> {
  if (standings?.meta?.result_config) return standings.meta.result_config;
  if (tournament?.result_config) return tournament.result_config;
  return {};
}

function getCustomValueKind(config: Record<string, any>, meta?: StandingsMeta | null): string {
  const fromMeta = String(meta?.custom_value_kind ?? "").toUpperCase();
  if (fromMeta) return fromMeta;

  const headToHeadMode = String(config.head_to_head_mode ?? "").toUpperCase();
  if (headToHeadMode === "MEASURED_RESULT") {
    const measured = String(config.measured_value_kind ?? "").toUpperCase();
    if (measured) return measured;
  }

  const massStart = String(config.mass_start_value_kind ?? "").toUpperCase();
  if (massStart) return massStart;

  const direct = String(config.value_kind ?? "").toUpperCase();
  if (direct) return direct;

  return "NUMBER";
}

function formatTimeFromMs(totalMs: number, timeFormat?: string | null): string {
  const safeMs = Math.max(0, Number(totalMs) || 0);
  const totalSeconds = Math.floor(safeMs / 1000);
  const ms = safeMs % 1000;
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const hundredths = Math.floor(ms / 10);

  if (timeFormat === "HH:MM:SS") return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  if (timeFormat === "MM:SS") return `${totalMinutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  if (timeFormat === "SS.hh") return `${totalSeconds}.${hundredths.toString().padStart(2, "0")}`;
  return `${totalMinutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${hundredths.toString().padStart(2, "0")}`;
}

function formatCustomResultDisplay(
  row: StandingRow,
  resultConfig: Record<string, any>,
  meta?: StandingsMeta | null
): string {
  const fromBackend = String(row.custom_result_display ?? "").trim();
  if (fromBackend) return fromBackend;

  const valueKind = getCustomValueKind(resultConfig, meta);
  const unitLabel = String(resultConfig.unit_label ?? resultConfig.unit ?? "").trim();
  const timeFormat = String(resultConfig.time_format ?? "MM:SS.hh");

  if (valueKind === "TIME" && row.custom_result_time_ms != null) {
    return formatTimeFromMs(Number(row.custom_result_time_ms), timeFormat);
  }

  if (valueKind === "PLACE" && row.custom_result_place != null) {
    return String(row.custom_result_place);
  }

  if (row.custom_result_numeric != null) {
    return unitLabel ? `${row.custom_result_numeric} ${unitLabel}` : String(row.custom_result_numeric);
  }

  return "-";
}

function getCustomTypeLabel(row: StandingRow, resultConfig: Record<string, any>, meta?: StandingsMeta | null): string {
  const valueKind = getCustomValueKind(resultConfig, meta);
  if (valueKind === "TIME") return "Czas";
  if (valueKind === "PLACE") return "Miejsce";
  return "Liczba";
}

function getCustomRankingDescription(resultConfig: Record<string, any>, meta?: StandingsMeta | null): string {
  const valueKind = getCustomValueKind(resultConfig, meta);
  const unitLabel = String(resultConfig.unit_label ?? resultConfig.unit ?? "").trim();
  const better = String(resultConfig.better_result ?? "HIGHER").toUpperCase();

  if (valueKind === "TIME") {
    const format = String(resultConfig.time_format ?? "MM:SS.hh");
    return `Ranking według czasu. Lepszy jest wynik niższy. Format prezentacji: ${format}.`;
  }

  if (valueKind === "PLACE") {
    return "Ranking według zajętego miejsca. Lepszy jest wynik niższy.";
  }

  const decimals = typeof resultConfig.decimal_places === "number" ? resultConfig.decimal_places : 0;
  const direction = better === "LOWER" ? "Lepszy jest wynik niższy." : "Lepszy jest wynik wyższy.";
  const unitInfo = unitLabel ? ` Jednostka: ${unitLabel}.` : "";
  return `Ranking według wartości liczbowej. ${direction}${unitInfo} Dokładność: ${decimals} miejsce po przecinku.`;
}

// ===== Widok: tabela i drabinka =====

function TournamentStandingsView({
  tournament,
  matches,
  standings,
  showHeader,
}: {
  tournament: Tournament;
  matches: MatchDto[];
  standings: StandingsResponse | null;
  showHeader: boolean;
}) {
  const [tab, setTab] = useState<"TABLE" | "BRACKET">("TABLE");
  const [bracketMode, setBracketMode] = useState<"PYRAMID" | "CENTERED">("PYRAMID");

  const resolvedTournamentFormat = useMemo(() => {
    const metaFormat = String(standings?.meta?.tournament_format ?? "").toUpperCase();
    if (metaFormat === "CUP" || metaFormat === "LEAGUE" || metaFormat === "MIXED") {
      return metaFormat as Tournament["tournament_format"];
    }
    return tournament.tournament_format ?? "LEAGUE";
  }, [standings?.meta?.tournament_format, tournament.tournament_format]);

  const derived = useMemo(() => {
    const tournamentDiscipline = (tournament.discipline ?? "").toLowerCase();
    const metaSchema = (standings?.meta?.table_schema ?? "").toUpperCase();
    const metaDiscipline = (standings?.meta?.discipline ?? "").toLowerCase();
    const metaResultMode = (standings?.meta?.result_mode ?? tournament.result_mode ?? "").toUpperCase();

    const discipline = (metaDiscipline || tournamentDiscipline || "").toLowerCase();
    const isTennis = metaSchema === "TENNIS" || discipline === "tennis";
    const isCustom = metaSchema.startsWith("CUSTOM") || metaResultMode === "CUSTOM";

    const tennisPointsMode = getTennisPointsMode(tournament, standings);
    const showTennisPoints = isTennis && tennisPointsMode === "PLT";

    const isCup = resolvedTournamentFormat === "CUP";
    const isMixed = resolvedTournamentFormat === "MIXED";

    const hasLeagueTable = (standings?.table?.length ?? 0) > 0;
    const hasGroups = (standings?.groups?.length ?? 0) > 0;
    const hasTableData = hasLeagueTable || hasGroups;
    const hasBracketData = (standings?.bracket?.rounds?.length ?? 0) > 0;

    return {
      discipline,
      isTennis,
      isCustom,
      customMode: String(standings?.meta?.custom_mode ?? "").toUpperCase(),
      showTennisPoints,
      isCup,
      isMixed,
      hasLeagueTable,
      hasGroups,
      hasTableData,
      hasBracketData,
    };
  }, [resolvedTournamentFormat, standings, tournament]);

  const resultConfig = useMemo(() => getResultConfig(tournament, standings), [standings, tournament]);

  const customDisciplineLabel = useMemo(() => {
    const fromMeta = String(standings?.meta?.custom_discipline_name ?? "").trim();
    if (fromMeta) return fromMeta;

    const fromTournament = String(tournament.custom_discipline_name ?? "").trim();
    if (fromTournament) return fromTournament;

    return "Dyscyplina niestandardowa";
  }, [standings, tournament]);

  const {
    discipline,
    isTennis,
    isCustom,
    customMode,
    showTennisPoints,
    isCup,
    isMixed,
    hasLeagueTable,
    hasGroups,
    hasTableData,
    hasBracketData,
  } = derived;

  useEffect(() => {
    if (hasBracketData && !hasTableData) {
      setTab("BRACKET");
      return;
    }
    if (hasTableData && !hasBracketData) {
      setTab("TABLE");
      return;
    }
    if (resolvedTournamentFormat === "CUP") {
      setTab("BRACKET");
    }
  }, [hasBracketData, hasTableData, resolvedTournamentFormat]);

  const showTabs = hasTableData && hasBracketData;
  const activeTab: "TABLE" | "BRACKET" = showTabs
    ? tab
    : hasBracketData
      ? "BRACKET"
      : "TABLE";
  const tableTitle = isCustom ? "Ranking" : "Tabela";
  const tableSectionTitle = isCustom ? "Klasyfikacja" : "Klasyfikacja";

  return (
    <div className={cn(showHeader ? "px-4 py-4 sm:px-0" : "p-0", "mx-auto w-full max-w-7xl")}>
      {showHeader ? (
        <div className="mb-4">
          <div className="text-sm text-slate-300">{isCustom ? "Ranking" : "Wyniki"}</div>
          <h2 className="mt-1 text-2xl font-semibold text-white">{tournament.name}</h2>
        </div>
      ) : null}

      {isCustom ? (
        <Card className="mb-5 p-5 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="text-xs text-slate-400">Klasyfikacja niestandardowa</div>
              <div className="mt-1 text-lg font-semibold text-slate-100">{customDisciplineLabel}</div>
              <div className="mt-3 text-sm text-slate-300">
                {getCustomRankingDescription(resultConfig, standings?.meta)}
              </div>
            </div>

            <div className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-2 text-xs font-semibold text-slate-200">
              {getCustomValueKind(resultConfig, standings?.meta) === "TIME" ? (
                <TimerReset className="h-4 w-4 text-slate-200" />
              ) : (
                <Gauge className="h-4 w-4 text-slate-200" />
              )}
              {customMode === "HEAD_TO_HEAD_POINTS" ? "Tabela punktowa" : "Ranking custom"}
            </div>
          </div>
        </Card>
      ) : null}

      {showTabs ? (
        <div className="mb-5 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setTab("TABLE")}
            aria-pressed={tab === "TABLE"}
            className={cn(
              "rounded-full px-3.5 py-2 text-sm font-semibold",
              tab === "TABLE" && "border-white/15 bg-white/10"
            )}
          >
            <span className="inline-flex items-center gap-2">
              <Table2 className="h-4 w-4 text-white/80" />
              {tableTitle}
            </span>
          </Button>

          <Button
            type="button"
            variant="secondary"
            onClick={() => setTab("BRACKET")}
            aria-pressed={tab === "BRACKET"}
            className={cn(
              "rounded-full px-3.5 py-2 text-sm font-semibold",
              tab === "BRACKET" && "border-white/15 bg-white/10"
            )}
          >
            <span className="inline-flex items-center gap-2">
              <Brackets className="h-4 w-4 text-white/80" />
              Drabinka
            </span>
          </Button>
        </div>
      ) : null}

      {activeTab === "TABLE" ? (
        hasGroups ? (
          <div className="space-y-4">
            {standings!.groups!.map((group, index) => {
              const groupTitle =
                (group.group_name || "").toLowerCase().startsWith("grupa")
                  ? group.group_name
                  : displayGroupName(group.group_name, index);

              const groupKey = normalizeGroupKey(group.group_name);
              const groupMatches = matches.filter(
                (match) => match.stage_type === "GROUP" && normalizeGroupKey(match.group_name) === groupKey
              );

              return (
                <Card key={group.group_id} className="p-5 sm:p-6">
                  <div className="mb-3">
                    <div className="text-xs text-slate-400">
                      {isCustom ? "Grupa rankingu" : "Faza grupowa"}
                    </div>
                    <div className="mt-1 text-lg font-semibold text-slate-100">{groupTitle}</div>
                  </div>

                  <StandingsTable
                    rows={group.table}
                    matchesForForm={groupMatches}
                    isTennis={isTennis}
                    isCustom={isCustom}
                    showTennisPoints={showTennisPoints}
                    resultConfig={resultConfig}
                    standingsMeta={standings?.meta}
                  />
                </Card>
              );
            })}
          </div>
        ) : hasLeagueTable ? (
          <Card className="p-5 sm:p-6">
            <div className="mb-3">
              <div className="text-xs text-slate-400">{tableTitle}</div>
              <div className="mt-1 text-lg font-semibold text-slate-100">{tableSectionTitle}</div>
            </div>

            <StandingsTable
              rows={standings!.table!}
              matchesForForm={matches.filter((match) => match.stage_type === "LEAGUE")}
              isTennis={isTennis}
              isCustom={isCustom}
              showTennisPoints={showTennisPoints}
              resultConfig={resultConfig}
              standingsMeta={standings?.meta}
            />
          </Card>
        ) : hasBracketData ? (
          <Card className="p-5 sm:p-6">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs text-slate-400">Drabinka</div>
                <div className="mt-1 text-lg font-semibold text-slate-100">Faza pucharowa</div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setBracketMode("PYRAMID")}
                  aria-pressed={bracketMode === "PYRAMID"}
                  className={cn(
                    "h-8 rounded-full px-3 text-xs font-semibold",
                    bracketMode === "PYRAMID" && "border-white/15 bg-white/10"
                  )}
                >
                  Piramida
                </Button>

                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setBracketMode("CENTERED")}
                  aria-pressed={bracketMode === "CENTERED"}
                  className={cn(
                    "h-8 rounded-full px-3 text-xs font-semibold",
                    bracketMode === "CENTERED" && "border-white/15 bg-white/10"
                  )}
                >
                  Finał w środku
                </Button>
              </div>
            </div>

            <BracketPremium data={standings!.bracket!} discipline={discipline} mode={bracketMode} />
          </Card>
        ) : (
          <InlineAlert variant="info">
            {isCustom
              ? "Brak danych rankingu dla bieżącej konfiguracji turnieju."
              : "Brak danych tabeli."}
          </InlineAlert>
        )
      ) : hasBracketData ? (
        <Card className="p-5 sm:p-6">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs text-slate-400">Drabinka</div>
              <div className="mt-1 text-lg font-semibold text-slate-100">Faza pucharowa</div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setBracketMode("PYRAMID")}
                aria-pressed={bracketMode === "PYRAMID"}
                className={cn(
                  "h-8 rounded-full px-3 text-xs font-semibold",
                  bracketMode === "PYRAMID" && "border-white/15 bg-white/10"
                )}
              >
                Piramida
              </Button>

              <Button
                type="button"
                variant="secondary"
                onClick={() => setBracketMode("CENTERED")}
                aria-pressed={bracketMode === "CENTERED"}
                className={cn(
                  "h-8 rounded-full px-3 text-xs font-semibold",
                  bracketMode === "CENTERED" && "border-white/15 bg-white/10"
                )}
              >
                Finał w środku
              </Button>
            </div>
          </div>

          <BracketPremium data={standings!.bracket!} discipline={discipline} mode={bracketMode} />
        </Card>
      ) : (
        <InlineAlert variant="info">Brak danych drabinki lub faza pucharowa jeszcze się nie rozpoczęła.</InlineAlert>
      )}
    </div>
  );
}

// ===== Tabela =====

function StandingsTable({
  rows,
  matchesForForm,
  isTennis,
  isCustom,
  showTennisPoints,
  resultConfig,
  standingsMeta,
}: {
  rows: StandingRow[];
  matchesForForm: MatchDto[];
  isTennis: boolean;
  isCustom: boolean;
  showTennisPoints: boolean;
  resultConfig: Record<string, any>;
  standingsMeta?: StandingsMeta | null;
}) {
  return (
    <>
      <div className="sm:hidden">
        <StandingsTableMobile
          rows={rows}
          matchesForForm={matchesForForm}
          isTennis={isTennis}
          isCustom={isCustom}
          showTennisPoints={showTennisPoints}
          resultConfig={resultConfig}
          standingsMeta={standingsMeta}
        />
      </div>

      <div className="hidden sm:block">
        <StandingsTableDesktop
          rows={rows}
          matchesForForm={matchesForForm}
          isTennis={isTennis}
          isCustom={isCustom}
          showTennisPoints={showTennisPoints}
          resultConfig={resultConfig}
          standingsMeta={standingsMeta}
        />
      </div>
    </>
  );
}

function StandingsTableMobile({
  rows,
  matchesForForm,
  isTennis,
  isCustom,
  showTennisPoints,
  resultConfig,
  standingsMeta,
}: {
  rows: StandingRow[];
  matchesForForm: MatchDto[];
  isTennis: boolean;
  isCustom: boolean;
  showTennisPoints: boolean;
  resultConfig: Record<string, any>;
  standingsMeta?: StandingsMeta | null;
}) {
  return (
    <div className="grid gap-2">
      {rows.map((row, index) => {
        const form = last5Form(row.team_id, matchesForForm);

        if (isCustom) {
          const hasResult =
            row.custom_result_display != null ||
            row.custom_result_numeric != null ||
            row.custom_result_time_ms != null ||
            row.custom_result_place != null;

          return (
            <Card key={row.team_id} className="bg-white/[0.03] p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs text-slate-400">#{row.rank ?? index + 1}</div>
                  <div className="mt-0.5 truncate text-sm font-semibold text-white">{row.team_name}</div>
                </div>

                <div className="shrink-0 text-right">
                  <div className="text-xs text-slate-400">Typ</div>
                  <div className="text-sm font-semibold text-slate-100">
                    {getCustomTypeLabel(row, resultConfig, standingsMeta)}
                  </div>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-200">
                <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                  <div className="text-[11px] text-slate-400">Wynik</div>
                  <div className="font-semibold text-sky-200">
                    {formatCustomResultDisplay(row, resultConfig, standingsMeta)}
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                  <div className="text-[11px] text-slate-400">Status</div>
                  <div className="font-semibold text-white">
                    {hasResult ? "Wynik zapisany" : "Brak wyniku"}
                  </div>
                </div>
              </div>
            </Card>
          );
        }

        if (isTennis) {
          const setsFor = safeNum(row.sets_for, safeNum(row.goals_for, 0));
          const setsAgainst = safeNum(row.sets_against, safeNum(row.goals_against, 0));
          const setsDiff = safeNum(row.sets_diff, safeNum(row.goal_difference, setsFor - setsAgainst));
          const gamesFor = safeNum(row.games_for, 0);
          const gamesAgainst = safeNum(row.games_against, 0);
          const gamesDiff = safeNum(row.games_diff, safeNum(row.games_difference, gamesFor - gamesAgainst));

          return (
            <Card key={row.team_id} className="bg-white/[0.03] p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs text-slate-400">#{index + 1}</div>
                  <div className="mt-0.5 truncate text-sm font-semibold text-white">{row.team_name}</div>
                </div>

                {showTennisPoints ? (
                  <div className="shrink-0 text-right">
                    <div className="text-xs text-slate-400">Pkt</div>
                    <div className="text-sm font-semibold text-sky-200">{row.points}</div>
                  </div>
                ) : null}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-200">
                <StatMini label="M" value={row.played} />
                <StatMini label="Z - P" value={`${row.wins} - ${row.losses}`} />
                <StatMini label="Sety + -" value={`${setsFor} - ${setsAgainst}`} />
                <StatMini label="RS" value={setsDiff} />
                <StatMini label="Gemy + -" value={`${gamesFor} - ${gamesAgainst}`} />
                <StatMini label="RG" value={gamesDiff} />
              </div>

              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="text-xs text-slate-400">Forma</div>
                <FormDots form={form} />
              </div>
            </Card>
          );
        }

        return (
          <Card key={row.team_id} className="bg-white/[0.03] p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-slate-400">#{index + 1}</div>
                <div className="mt-0.5 truncate text-sm font-semibold text-white">{row.team_name}</div>
              </div>

              <div className="shrink-0 text-right">
                <div className="text-xs text-slate-400">Pkt</div>
                <div className="text-sm font-semibold text-sky-200">{row.points}</div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-200">
              <StatMini label="M" value={row.played} />
              <StatMini label="Z - R - P" value={`${row.wins} - ${row.draws} - ${row.losses}`} />
              <StatMini label="B+ : B-" value={`${row.goals_for}:${row.goals_against}`} />
              <StatMini label="RB" value={row.goal_difference} />
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
              <div className="text-xs text-slate-400">Forma</div>
              <FormDots form={form} />
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function StatMini({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="font-semibold text-white">{value}</div>
    </div>
  );
}

function StandingsTableDesktop({
  rows,
  matchesForForm,
  isTennis,
  isCustom,
  showTennisPoints,
  resultConfig,
  standingsMeta,
}: {
  rows: StandingRow[];
  matchesForForm: MatchDto[];
  isTennis: boolean;
  isCustom: boolean;
  showTennisPoints: boolean;
  resultConfig: Record<string, any>;
  standingsMeta?: StandingsMeta | null;
}) {
  const minW = isCustom
    ? "min-w-[700px]"
    : isTennis
      ? showTennisPoints
        ? "min-w-[950px]"
        : "min-w-[900px]"
      : "min-w-[600px]";

  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full border-separate border-spacing-0", minW)}>
        <thead>
          {isCustom ? (
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
              <th className="py-3 pl-2 pr-3">#</th>
              <th className="py-3 pr-3">Uczestnik</th>
              <th className="py-3 pr-3">Wynik</th>
              <th className="py-3 pr-3">Typ</th>
              <th className="py-3 pr-2">Status</th>
            </tr>
          ) : isTennis ? (
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
              <th className="py-3 pl-2 pr-3">#</th>
              <th className="py-3 pr-3">Zawodnik</th>
              <th className="py-3 pr-3">M</th>
              <th className="py-3 pr-3">Z</th>
              <th className="py-3 pr-3">P</th>
              <th className="py-3 pr-3">Sety +</th>
              <th className="py-3 pr-3">Sety -</th>
              <th className="py-3 pr-3">RS</th>
              <th className="py-3 pr-3">Gemy +</th>
              <th className="py-3 pr-3">Gemy -</th>
              <th className="py-3 pr-3">RG</th>
              {showTennisPoints ? <th className="py-3 pr-3">Pkt (PLT)</th> : null}
              <th className="py-3 pr-2">Forma</th>
            </tr>
          ) : (
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
              <th className="py-3 pl-2 pr-3">#</th>
              <th className="py-3 pr-3">Drużyna</th>
              <th className="py-3 pr-3">M</th>
              <th className="py-3 pr-3">Z</th>
              <th className="py-3 pr-3">R</th>
              <th className="py-3 pr-3">P</th>
              <th className="py-3 pr-3">B+</th>
              <th className="py-3 pr-3">B-</th>
              <th className="py-3 pr-3">RB</th>
              <th className="py-3 pr-3">Pkt</th>
              <th className="py-3 pr-2">Forma</th>
            </tr>
          )}
        </thead>

        <tbody className="text-sm text-slate-100">
          {rows.map((row, index) => {
            const form = last5Form(row.team_id, matchesForForm);

            if (isCustom) {
              const hasResult =
                row.custom_result_display != null ||
                row.custom_result_numeric != null ||
                row.custom_result_time_ms != null ||
                row.custom_result_place != null;

              return (
                <tr key={row.team_id} className="border-t border-white/10 hover:bg-white/[0.04]">
                  <td className="py-3 pl-2 pr-3 text-slate-300">{row.rank ?? index + 1}</td>
                  <td className="py-3 pr-3 font-semibold">{row.team_name}</td>
                  <td className="py-3 pr-3">
                    <span className="font-semibold text-sky-200">
                      {formatCustomResultDisplay(row, resultConfig, standingsMeta)}
                    </span>
                  </td>
                  <td className="py-3 pr-3 text-slate-200">
                    {getCustomTypeLabel(row, resultConfig, standingsMeta)}
                  </td>
                  <td className="py-3 pr-2">
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
              const setsFor = safeNum(row.sets_for, safeNum(row.goals_for, 0));
              const setsAgainst = safeNum(row.sets_against, safeNum(row.goals_against, 0));
              const setsDiff = safeNum(row.sets_diff, safeNum(row.goal_difference, setsFor - setsAgainst));
              const gamesFor = safeNum(row.games_for, 0);
              const gamesAgainst = safeNum(row.games_against, 0);
              const gamesDiff = safeNum(row.games_diff, safeNum(row.games_difference, gamesFor - gamesAgainst));

              return (
                <tr key={row.team_id} className="border-t border-white/10 hover:bg-white/[0.04]">
                  <td className="py-3 pl-2 pr-3 text-slate-300">{index + 1}</td>
                  <td className="py-3 pr-3 font-semibold">{row.team_name}</td>
                  <td className="py-3 pr-3 text-slate-200">{row.played}</td>
                  <td className="py-3 pr-3 text-slate-200">{row.wins}</td>
                  <td className="py-3 pr-3 text-slate-200">{row.losses}</td>
                  <td className="py-3 pr-3 text-slate-200">{setsFor}</td>
                  <td className="py-3 pr-3 text-slate-200">{setsAgainst}</td>
                  <td className="py-3 pr-3 text-slate-200">{setsDiff}</td>
                  <td className="py-3 pr-3 text-slate-200">{gamesFor}</td>
                  <td className="py-3 pr-3 text-slate-200">{gamesAgainst}</td>
                  <td className="py-3 pr-3 text-slate-200">{gamesDiff}</td>
                  {showTennisPoints ? (
                    <td className="py-3 pr-3">
                      <span className="font-semibold text-sky-200">{row.points}</span>
                    </td>
                  ) : null}
                  <td className="py-3 pr-2">
                    <FormDots form={form} />
                  </td>
                </tr>
              );
            }

            return (
              <tr key={row.team_id} className="border-t border-white/10 hover:bg-white/[0.04]">
                <td className="py-3 pl-2 pr-3 text-slate-300">{index + 1}</td>
                <td className="py-3 pr-3 font-semibold">{row.team_name}</td>
                <td className="py-3 pr-3 text-slate-200">{row.played}</td>
                <td className="py-3 pr-3 text-slate-200">{row.wins}</td>
                <td className="py-3 pr-3 text-slate-200">{row.draws}</td>
                <td className="py-3 pr-3 text-slate-200">{row.losses}</td>
                <td className="py-3 pr-3 text-slate-200">{row.goals_for}</td>
                <td className="py-3 pr-3 text-slate-200">{row.goals_against}</td>
                <td className="py-3 pr-3 text-slate-200">{row.goal_difference}</td>
                <td className="py-3 pr-3">
                  <span className="font-semibold text-sky-200">{row.points}</span>
                </td>
                <td className="py-3 pr-2">
                  <FormDots form={form} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FormDots({ form }: { form: FormResult[] }) {
  return (
    <div className="flex gap-1.5">
      {form.map((item, index) => (
        <span
          key={`${item}-${index}`}
          className={cn(
            "inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-white",
            item === "W" && "bg-emerald-500/80",
            item === "D" && "bg-slate-400/70",
            item === "L" && "bg-rose-500/80"
          )}
          title={item === "W" ? "Wygrana" : item === "D" ? "Remis" : "Porażka"}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

// ===== Drabinka premium =====

type BracketMode = "PYRAMID" | "CENTERED";

type BracketDims = {
  cardW: number;
  cardH: number;
  colGap: number;
  rowUnit: number;
  halfUnit: number;
};

function getDefaultDims(): BracketDims {
  const cardW = 260;
  const cardH = 84;
  const colGap = 76;
  const rowUnit = 108;
  const halfUnit = Math.round(rowUnit / 2);
  return { cardW, cardH, colGap, rowUnit, halfUnit };
}

type BracketNodeSide = "LEFT" | "RIGHT" | "CENTER";

type BracketNode = {
  roundIndex: number;
  itemIndex: number;
  branchIndex: number;
  side: BracketNodeSide;
  x: number;
  y: number;
  w: number;
  h: number;
  item: BracketDuelItem;
  label: string;
};

type BracketLayout = {
  nodes: BracketNode[];
  contentW: number;
  contentH: number;
  roundCount: number;
};

function buildPyramidLayout(rounds: BracketRound[], dims: BracketDims): BracketLayout {
  const nodes: BracketNode[] = [];
  const roundCount = rounds.length;
  const { cardW, cardH, colGap, rowUnit, halfUnit } = dims;
  const colW = cardW + colGap;

  const maxItemsInAnyRound = Math.max(0, ...rounds.map((round) => round.items.length));
  const contentH = Math.max(cardH, maxItemsInAnyRound * rowUnit);
  const contentW = Math.max(cardW, roundCount * colW);

  rounds.forEach((round, roundIndex) => {
    const colX = roundIndex * colW;
    const totalHeight = round.items.length * rowUnit;
    const startY = Math.max(0, (contentH - totalHeight) / 2);

    round.items.forEach((item, itemIndex) => {
      const y = startY + itemIndex * rowUnit + halfUnit - cardH / 2;
      nodes.push({
        roundIndex,
        itemIndex,
        branchIndex: itemIndex,
        side: "CENTER",
        x: colX,
        y,
        w: cardW,
        h: cardH,
        item,
        label: round.label,
      });
    });
  });

  return { nodes, contentW, contentH, roundCount };
}

function splitRoundItems(items: BracketDuelItem[]): {
  leftItems: BracketDuelItem[];
  rightItems: BracketDuelItem[];
} {
  const half = Math.ceil(items.length / 2);
  return {
    leftItems: items.slice(0, half),
    rightItems: items.slice(half),
  };
}

function buildCenteredLayout(data: BracketData, dims: BracketDims): BracketLayout | null {
  const rounds = data.rounds;
  if (rounds.length === 0) return null;

  const { cardW, cardH, colGap, rowUnit, halfUnit } = dims;
  const finalRoundIndex = rounds.length - 1;
  const finalRound = rounds[finalRoundIndex];
  if (!finalRound || finalRound.items.length === 0) return null;

  const colW = cardW + colGap;
  const centerColumn = rounds.length - 1;
  const totalColumns = rounds.length * 2 - 1;
  const contentW = Math.max(cardW, totalColumns * colW);

  const maxColumnRows = Math.max(
    1,
    ...rounds.map((round, index) => {
      if (index === finalRoundIndex) return round.items.length;
      const { leftItems, rightItems } = splitRoundItems(round.items);
      return Math.max(leftItems.length, rightItems.length);
    })
  );
  const contentH = Math.max(cardH, maxColumnRows * rowUnit);
  const nodes: BracketNode[] = [];

  const finalStartY = Math.max(0, (contentH - finalRound.items.length * rowUnit) / 2);
  finalRound.items.forEach((item, itemIndex) => {
    const y = finalStartY + itemIndex * rowUnit + halfUnit - cardH / 2;
    nodes.push({
      roundIndex: finalRoundIndex,
      itemIndex,
      branchIndex: itemIndex,
      side: "CENTER",
      x: centerColumn * colW,
      y,
      w: cardW,
      h: cardH,
      item,
      label: finalRound.label,
    });
  });

  for (let roundIndex = finalRoundIndex - 1; roundIndex >= 0; roundIndex -= 1) {
    const round = rounds[roundIndex];
    const distanceToCenter = finalRoundIndex - roundIndex;
    const leftColumn = centerColumn - distanceToCenter;
    const rightColumn = centerColumn + distanceToCenter;
    const { leftItems, rightItems } = splitRoundItems(round.items);

    const leftStartY = Math.max(0, (contentH - leftItems.length * rowUnit) / 2);
    leftItems.forEach((item, branchIndex) => {
      const y = leftStartY + branchIndex * rowUnit + halfUnit - cardH / 2;
      nodes.push({
        roundIndex,
        itemIndex: branchIndex,
        branchIndex,
        side: "LEFT",
        x: leftColumn * colW,
        y,
        w: cardW,
        h: cardH,
        item,
        label: round.label,
      });
    });

    const rightStartY = Math.max(0, (contentH - rightItems.length * rowUnit) / 2);
    rightItems.forEach((item, branchIndex) => {
      const y = rightStartY + branchIndex * rowUnit + halfUnit - cardH / 2;
      nodes.push({
        roundIndex,
        itemIndex: leftItems.length + branchIndex,
        branchIndex,
        side: "RIGHT",
        x: rightColumn * colW,
        y,
        w: cardW,
        h: cardH,
        item,
        label: round.label,
      });
    });
  }

  return { nodes, contentW, contentH, roundCount: rounds.length };
}

type Connection = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

function buildConnections(layout: BracketLayout, dims: BracketDims): Connection[] {
  const { cardW, cardH, colGap } = dims;
  const nodeMap = new Map<string, BracketNode>();

  layout.nodes.forEach((node) => {
    nodeMap.set(`${node.roundIndex}:${node.side}:${node.branchIndex}`, node);
  });

  const connections: Connection[] = [];

  for (const node of layout.nodes) {
    if (node.roundIndex >= layout.roundCount - 1) continue;

    let next: BracketNode | undefined;
    const nextRoundIndex = node.roundIndex + 1;

    if (node.side === "CENTER") {
      next = nodeMap.get(`${nextRoundIndex}:CENTER:${Math.floor(node.branchIndex / 2)}`);
    } else if (nextRoundIndex === layout.roundCount - 1) {
      next = nodeMap.get(`${nextRoundIndex}:CENTER:0`);
    } else {
      next = nodeMap.get(`${nextRoundIndex}:${node.side}:${Math.floor(node.branchIndex / 2)}`);
    }

    if (!next) continue;

    const nodeCenterY = node.y + cardH / 2;
    const nextCenterY = next.y + cardH / 2;

    if (node.x < next.x) {
      const x1 = node.x + cardW;
      const x2 = next.x;
      const midX = x1 + colGap / 2;
      connections.push({ x1, y1: nodeCenterY, x2: midX, y2: nodeCenterY });
      connections.push({ x1: midX, y1: nodeCenterY, x2: midX, y2: nextCenterY });
      connections.push({ x1: midX, y1: nextCenterY, x2, y2: nextCenterY });
    } else {
      const x1 = node.x;
      const x2 = next.x + cardW;
      const midX = x1 - colGap / 2;
      connections.push({ x1, y1: nodeCenterY, x2: midX, y2: nodeCenterY });
      connections.push({ x1: midX, y1: nodeCenterY, x2: midX, y2: nextCenterY });
      connections.push({ x1: midX, y1: nextCenterY, x2, y2: nextCenterY });
    }
  }

  return connections;
}

function BracketPremium({
  data,
  discipline,
  mode,
}: {
  data: BracketData;
  discipline: string;
  mode: BracketMode;
}) {
  const dims = useMemo(() => getDefaultDims(), []);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);

  const [zoom, setZoom] = useState(1);
  const [fitZoom, setFitZoom] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [zoomMode, setZoomMode] = useState<"FIT" | "MANUAL">("FIT");

  const pyramid = useMemo(() => buildPyramidLayout(data.rounds, dims), [data.rounds, dims]);
  const centered = useMemo(() => buildCenteredLayout(data, dims), [data, dims]);

  const layout = mode === "CENTERED" ? centered ?? pyramid : pyramid;
  const contentW = layout.contentW;
  const contentH = layout.contentH;
  const connections = useMemo(() => buildConnections(layout, dims), [layout, dims]);

  useEffect(() => {
    const element = hostRef.current;
    if (!element) return;

    const compute = () => {
      const width = element.clientWidth;
      const padding = isFullscreen ? 32 : 12;
      const available = Math.max(260, width - padding * 2);
      const fit = contentW > 0 ? clamp(available / contentW, 0.45, 1.08) : 1;

      setFitZoom(fit);
      if (zoomMode === "FIT") {
        setZoom(fit);
      }
    };

    compute();

    const observer = new ResizeObserver(() => compute());
    observer.observe(element);
    return () => observer.disconnect();
  }, [contentW, isFullscreen, zoomMode]);

  useEffect(() => {
    setZoomMode("FIT");
  }, [mode, contentW]);

  useEffect(() => {
    const syncFullscreen = () => {
      const active = document.fullscreenElement === hostRef.current;
      setIsFullscreen(active);
      setZoomMode("FIT");
    };

    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    const centerFocus = () => {
      let focusNode: BracketNode | undefined;

      if (mode === "CENTERED") {
        focusNode = [...layout.nodes]
          .filter((node) => node.roundIndex === layout.roundCount - 1)
          .sort((left, right) => left.itemIndex - right.itemIndex)[0];
      } else {
        focusNode = [...layout.nodes]
          .sort((left, right) => {
            if (right.roundIndex !== left.roundIndex) return right.roundIndex - left.roundIndex;
            return left.itemIndex - right.itemIndex;
          })[0];
      }

      if (!focusNode) return;

      const scaledX = (focusNode.x + focusNode.w / 2) * zoom;
      const scaledY = (focusNode.y + focusNode.h / 2) * zoom;

      element.scrollLeft = Math.max(0, scaledX - element.clientWidth / 2);
      element.scrollTop = Math.max(0, scaledY - element.clientHeight / 2);
    };

    const timeout = window.setTimeout(centerFocus, 40);
    return () => window.clearTimeout(timeout);
  }, [isFullscreen, layout, mode, zoom]);

  const handleZoom = (delta: number) => {
    setZoomMode("MANUAL");
    setZoom((current) => clamp(current + delta, 0.45, 2));
  };

  const handleFit = () => {
    setZoomMode("FIT");
    setZoom(fitZoom);
  };

  const requestFullscreen = async () => {
    const element = hostRef.current;
    if (!element) return;

    try {
      if (document.fullscreenElement !== element) {
        await element.requestFullscreen();
      }
    } catch {
      setIsFullscreen(true);
    } finally {
      setZoomMode("FIT");
    }
  };

  const exitFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        setIsFullscreen(false);
      }
    } catch {
      setIsFullscreen(false);
    } finally {
      setZoomMode("FIT");
    }
  };

  useEffect(() => {
    if (!isFullscreen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        void exitFullscreen();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isFullscreen]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;

    let isDown = false;
    let startX = 0;
    let startY = 0;
    let scrollLeft = 0;
    let scrollTop = 0;

    const onDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      isDown = true;
      setDragging(true);
      startX = event.pageX - element.offsetLeft;
      startY = event.pageY - element.offsetTop;
      scrollLeft = element.scrollLeft;
      scrollTop = element.scrollTop;
    };

    const onLeave = () => {
      isDown = false;
      setDragging(false);
    };

    const onUp = () => {
      isDown = false;
      setDragging(false);
    };

    const onMove = (event: MouseEvent) => {
      if (!isDown) return;
      event.preventDefault();
      const x = event.pageX - element.offsetLeft;
      const y = event.pageY - element.offsetTop;
      const walkX = x - startX;
      const walkY = y - startY;
      element.scrollLeft = scrollLeft - walkX;
      element.scrollTop = scrollTop - walkY;
    };

    element.addEventListener("mousedown", onDown);
    element.addEventListener("mouseleave", onLeave);
    element.addEventListener("mouseup", onUp);
    element.addEventListener("mousemove", onMove);

    return () => {
      element.removeEventListener("mousedown", onDown);
      element.removeEventListener("mouseleave", onLeave);
      element.removeEventListener("mouseup", onUp);
      element.removeEventListener("mousemove", onMove);
    };
  }, []);

  const contentStyle = useMemo<CSSProperties>(() => {
    return {
      width: contentW,
      height: contentH,
      transform: `translate(16px, 16px) scale(${zoom})`,
      transformOrigin: "top left",
    };
  }, [contentH, contentW, zoom]);

  return (
    <div
      ref={hostRef}
      className={cn(
        "relative",
        isFullscreen && "fixed inset-0 z-50 overflow-hidden bg-slate-950/95 backdrop-blur"
      )}
    >
      <div
        className={cn(
          "mb-3 flex flex-wrap items-center justify-between gap-3",
          isFullscreen && "px-4 pt-4"
        )}
      >
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5">
            <Brackets className="h-3.5 w-3.5 text-white/70" />
            Linie łączą rundy
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5">
            Drag: przeciągnij aby przesunąć
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5">
            Zoom: {Math.round(zoom * 100)}%
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => handleZoom(-0.08)} className="h-9 px-3">
            <Minus className="h-4 w-4" />
          </Button>
          <Button variant="secondary" onClick={() => handleZoom(+0.08)} className="h-9 px-3">
            <Plus className="h-4 w-4" />
          </Button>
          <Button variant="secondary" onClick={handleFit} className="h-9 px-3">
            <Scan className="h-4 w-4" />
          </Button>

          {!isFullscreen ? (
            <Button variant="secondary" onClick={() => void requestFullscreen()} className="h-9 px-3">
              <Maximize2 className="h-4 w-4" />
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => void exitFullscreen()} className="h-9 px-3">
              <Minimize2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <div
        ref={viewportRef}
        className={cn(
          "relative overflow-auto rounded-2xl border border-white/10 bg-white/[0.03] transition-[height] duration-200",
          dragging ? "cursor-grabbing select-none" : "cursor-grab",
          isFullscreen ? "h-[calc(100vh-110px)]" : "max-h-[620px] min-h-[320px]"
        )}
      >
        <div
          className="relative"
          style={{
            width: contentW * zoom + 32,
            height: contentH * zoom + 32,
            padding: 16,
          }}
        >
          <svg
            className="absolute left-0 top-0"
            width={contentW * zoom + 32}
            height={contentH * zoom + 32}
            style={{ pointerEvents: "none" }}
          >
            <g transform={`translate(16, 16) scale(${zoom})`}>
              {connections.map((connection, index) => (
                <path
                  key={index}
                  d={`M ${connection.x1} ${connection.y1} L ${connection.x2} ${connection.y2}`}
                  stroke="rgba(255,255,255,0.18)"
                  strokeWidth={2}
                  fill="none"
                />
              ))}
            </g>
          </svg>

          <div style={contentStyle}>
            <div className="relative">
              {layout.nodes.map((node) => (
                <div
                  key={`${node.side}-${node.roundIndex}-${node.itemIndex}-${node.item.id}`}
                  className="absolute"
                  style={{ left: node.x, top: node.y, width: node.w, height: node.h }}
                >
                  <MatchCard item={node.item} discipline={discipline} roundLabel={node.label} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {data.third_place ? (
        <div className={cn("mt-4", isFullscreen && "px-4 pb-4")}>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Mecz o 3. miejsce
          </div>
          <div className="max-w-[420px]">
            <MatchCard item={data.third_place} discipline={discipline} roundLabel="3. miejsce" />
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ===== Karty meczów =====

function badgeStatus(status: BracketDuelItem["status"]) {
  if (status === "FINISHED") {
    return {
      label: "Zakończony",
      cls: "bg-emerald-500/15 text-emerald-100 border-emerald-400/20",
    };
  }

  if (status === "IN_PROGRESS") {
    return {
      label: "W trakcie",
      cls: "bg-sky-500/15 text-sky-100 border-sky-400/20",
    };
  }

  return {
    label: "Zaplanowany",
    cls: "bg-white/[0.04] text-slate-200 border-white/10",
  };
}

function MatchCard({
  item,
  discipline,
  roundLabel,
}: {
  item: BracketDuelItem;
  discipline: string;
  roundLabel: string;
}) {
  const status = badgeStatus(item.status);

  return (
    <div className="h-full w-full rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.06] to-white/[0.03] p-3 shadow-[0_12px_32px_rgba(2,6,23,0.22)]">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-xs text-slate-400">{roundLabel}</div>
          <div className="mt-0.5 truncate text-sm font-semibold text-white">
            {item.home_team_name} vs {item.away_team_name}
          </div>
        </div>

        <span
          className={cn(
            "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold",
            status.cls
          )}
        >
          {status.label}
        </span>
      </div>

      <div className="grid gap-2">
        <MatchScoreBlock item={item} discipline={discipline} />
      </div>
    </div>
  );
}

function scoreText(home: number | null | undefined, away: number | null | undefined) {
  if (home == null || away == null) return "-";
  return `${home}:${away}`;
}

function hasPenalties(item: BracketDuelItem) {
  const hasFirst = item.penalties_leg1_home != null || item.penalties_leg1_away != null;
  const hasSecond = item.penalties_leg2_home != null || item.penalties_leg2_away != null;
  return hasFirst || hasSecond;
}

function formatTennisSets(sets: unknown): string | null {
  if (!Array.isArray(sets) || sets.length === 0) return null;

  const parts: string[] = [];
  for (const setItem of sets) {
    if (!setItem || typeof setItem !== "object") continue;

    const homeGames = Number((setItem as { home_games?: unknown }).home_games);
    const awayGames = Number((setItem as { away_games?: unknown }).away_games);
    if (!Number.isFinite(homeGames) || !Number.isFinite(awayGames)) continue;

    const homeTiebreak = (setItem as { home_tiebreak?: unknown }).home_tiebreak;
    const awayTiebreak = (setItem as { away_tiebreak?: unknown }).away_tiebreak;

    if (Number.isFinite(Number(homeTiebreak)) && Number.isFinite(Number(awayTiebreak))) {
      parts.push(`${homeGames}-${awayGames}(${Number(homeTiebreak)}-${Number(awayTiebreak)})`);
    } else {
      parts.push(`${homeGames}-${awayGames}`);
    }
  }

  return parts.length ? parts.join(", ") : null;
}

function MatchScoreBlock({ item, discipline }: { item: BracketDuelItem; discipline: string }) {
  const isTennis = String(discipline || "").toLowerCase() === "tennis";
  const firstLeg = scoreText(item.score_leg1_home, item.score_leg1_away);
  const secondLeg = item.is_two_legged
    ? scoreText(item.score_leg2_home ?? null, item.score_leg2_away ?? null)
    : null;
  const aggregate =
    item.aggregate_home != null && item.aggregate_away != null
      ? `${item.aggregate_home}:${item.aggregate_away}`
      : null;
  const showPenaltySeries = hasPenalties(item);
  const tennisLeg1 = isTennis ? formatTennisSets(item.tennis_sets_leg1) : null;
  const tennisLeg2 = isTennis ? formatTennisSets(item.tennis_sets_leg2) : null;

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <ScorePill label="Mecz" score={firstLeg} variant="leg" />
        {secondLeg ? <ScorePill label="Rewanż" score={secondLeg} variant="leg" /> : null}
        {aggregate ? <ScorePill label="Agregat" score={aggregate} variant="agg" /> : null}

        {item.winner_id ? (
          <span className="ml-auto text-xs font-semibold text-slate-300">
            Zwycięzca:{" "}
            <span className="text-white">
              {item.winner_id === item.home_team_id ? item.home_team_name : item.away_team_name}
            </span>
          </span>
        ) : null}
      </div>

      {showPenaltySeries ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
          <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">
            Karne:{" "}
            <span className="font-semibold text-white">
              {scoreText(item.penalties_leg1_home ?? null, item.penalties_leg1_away ?? null)}
            </span>
            {item.is_two_legged ? (
              <>
                {" "}/ {" "}
                <span className="font-semibold text-white">
                  {scoreText(item.penalties_leg2_home ?? null, item.penalties_leg2_away ?? null)}
                </span>
              </>
            ) : null}
          </span>
        </div>
      ) : null}

      {isTennis && (tennisLeg1 || tennisLeg2) ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
          {tennisLeg1 ? (
            <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">
              Sety: <span className="font-semibold text-white">{tennisLeg1}</span>
            </span>
          ) : null}
          {tennisLeg2 ? (
            <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">
              Sety rewanżu: <span className="font-semibold text-white">{tennisLeg2}</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ScorePill({
  label,
  score,
  variant,
}: {
  label: string;
  score: string | null;
  variant: "leg" | "agg" | "aggWin";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs",
        "border border-white/10 bg-white/[0.03] text-slate-200",
        variant === "agg" && "border border-white/15 bg-white/[0.05] text-white",
        variant === "aggWin" && "border border-sky-400/30 bg-sky-500/20 text-sky-100"
      )}
      title={label}
      aria-label={label}
    >
      {score ?? "-"}
    </span>
  );
}
