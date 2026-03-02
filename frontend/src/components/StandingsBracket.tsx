// frontend/src/components/StandingsBracket.tsx
// Komponent renderuje tabelę i drabinkę turnieju w widoku publicznym oraz panelowym.

import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Brackets, Maximize2, Minimize2, Minus, Plus, Scan, Table2 } from "lucide-react";

import { apiFetch } from "../api";
import { cn } from "../lib/cn";
import { displayGroupName, isByeMatch } from "../flow/stagePresentation";

import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { InlineAlert } from "../ui/InlineAlert";

// ===== Dostęp i kontekst publiczny =====

function hasAccessToken(): boolean {
  try {
    const keys = ["access", "accessToken", "access_token", "jwt_access", "token"];
    for (const k of keys) {
      const v = localStorage.getItem(k);
      if (v && v.trim()) return true;
    }
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      const lk = k.toLowerCase();
      if (lk.includes("access") && !lk.includes("refresh")) {
        const v = localStorage.getItem(k);
        if (v && v.trim()) return true;
      }
    }
  } catch {}
  return false;
}

// ===== Typy danych =====

export type Tournament = {
  id: number;
  name: string;
  discipline?: string;
  tournament_format: "LEAGUE" | "CUP" | "MIXED";
  format_config?: Record<string, any>;
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

  tennis_sets_leg1?: any | null;
  tennis_sets_leg2?: any | null;
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
  table_schema?: string;
  tennis_points_mode?: string;
};

export type StandingsResponse = {
  meta?: StandingsMeta;
  table?: StandingRow[];
  groups?: GroupStanding[];
  bracket?: BracketData;
};

type StandingsBracketProps = {
  tournamentId: number;
  accessCode?: string;
  showHeader?: boolean;
};

// ===== Komponent: pobieranie i render =====

export default function StandingsBracket({ tournamentId, accessCode, showHeader = true }: StandingsBracketProps) {
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [matches, setMatches] = useState<MatchDto[]>([]);
  const [standings, setStandings] = useState<StandingsResponse | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const qs = useMemo(() => {
    const c = (accessCode ?? "").trim();
    return c ? `?code=${encodeURIComponent(c)}` : "";
  }, [accessCode]);

  const url = (p: string) => `${p}${qs}`;

  useEffect(() => {
    let alive = true;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const tRes = await apiFetch(url(`/api/tournaments/${tournamentId}/`), { toastOnError: false } as any);
        if (!tRes.ok) throw new Error("Nie udało się pobrać danych turnieju.");
        const tData = await tRes.json();

        const t: Tournament = {
          id: tData.id,
          name: tData.name,
          discipline: tData.discipline ?? undefined,
          tournament_format: (tData.tournament_format ?? "LEAGUE") as Tournament["tournament_format"],
          format_config: tData.format_config ?? undefined,
        };

        let sData: StandingsResponse | null = null;
        const sRes = await apiFetch(url(`/api/tournaments/${tournamentId}/standings/`), { toastOnError: false } as any);
        if (sRes.ok) {
          sData = await sRes.json();
        } else {
          const spRes = await apiFetch(url(`/api/tournaments/${tournamentId}/public/standings/`), {
            toastOnError: false,
          } as any);
          if (spRes.ok) sData = await spRes.json();
          else sData = null;
        }

        const authed = hasAccessToken();
        const isPublicContext = !!accessCode || !authed;

        const fetchAndMapPublicMatches = async () => {
          const mpRes = await apiFetch(url(`/api/tournaments/${tournamentId}/public/matches/`), {
            toastOnError: false,
          } as any);
          if (!mpRes.ok) throw new Error("Nie udało się pobrać meczów publicznych.");
          const raw = await mpRes.json();
          const list = Array.isArray(raw) ? raw : Array.isArray(raw?.results) ? raw.results : [];

          return list.map((m: any) => ({
            id: Number(m.id),
            stage_type: (m.stage_type ?? "LEAGUE") as MatchDto["stage_type"],
            stage_id: Number(m.stage_id ?? 0),
            stage_order: Number(m.stage_order ?? 0),
            round_number: m.round_number ?? null,
            group_name: m.group_name ?? null,
            home_team_id: Number(m.home_team_id ?? 0),
            away_team_id: Number(m.away_team_id ?? 0),
            home_team_name: String(m.home_team_name ?? ""),
            away_team_name: String(m.away_team_name ?? ""),
            home_score: m.home_score ?? null,
            away_score: m.away_score ?? null,
            winner_id: m.winner_id ?? null,
            status: (m.status ?? "SCHEDULED") as MatchDto["status"],
          }));
        };

        let mData: MatchDto[] = [];

        if (isPublicContext) {
          mData = await fetchAndMapPublicMatches();
        } else {
          const mRes = await apiFetch(url(`/api/tournaments/${tournamentId}/matches/`), { toastOnError: false } as any);
          if (mRes.status === 401 || mRes.status === 403) {
            mData = await fetchAndMapPublicMatches();
          } else {
            if (!mRes.ok) throw new Error("Nie udało się pobrać meczów.");
            const raw = await mRes.json();
            const list = Array.isArray(raw) ? raw : Array.isArray(raw?.results) ? raw.results : [];
            mData = list;
          }
        }

        if (!alive) return;

        setTournament(t);
        setStandings(sData);
        setMatches(mData);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || "Wystąpił błąd");
      } finally {
        if (alive) setLoading(false);
      }
    };

    load();

    return () => {
      alive = false;
    };
  }, [tournamentId, qs, accessCode]);

  if (loading) return <div className="text-sm text-slate-300">Ładowanie...</div>;
  if (error) return <InlineAlert variant="error">{error}</InlineAlert>;
  if (!tournament) return null;

  return (
    <TournamentStandingsView tournament={tournament} matches={matches} standings={standings} showHeader={showHeader} />
  );
}

// ===== Pomocnicze =====

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

function safeNum(v: any, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function getTennisPointsMode(tournament: Tournament | null, standings: StandingsResponse | null): "PLT" | "NONE" {
  const tMode = (tournament?.format_config?.tennis_points_mode ?? "").toString().toUpperCase();
  if (tMode === "PLT") return "PLT";
  if (tMode === "NONE") return "NONE";

  const sMode = (standings?.meta?.tennis_points_mode ?? "").toString().toUpperCase();
  if (sMode === "PLT") return "PLT";
  if (sMode === "NONE") return "NONE";

  return "NONE";
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
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

  useEffect(() => {
    if (tournament?.tournament_format === "CUP") setTab("BRACKET");
  }, [tournament?.tournament_format]);

  const derived = useMemo(() => {
    const tournamentDiscipline = (tournament.discipline ?? "").toLowerCase();
    const metaSchema = (standings?.meta?.table_schema ?? "").toUpperCase();
    const metaDiscipline = (standings?.meta?.discipline ?? "").toLowerCase();

    const discipline = (metaDiscipline || tournamentDiscipline || "").toLowerCase();
    const isTennis = metaSchema === "TENNIS" || discipline === "tennis";

    const tennisPointsMode = getTennisPointsMode(tournament, standings);
    const showTennisPoints = isTennis && tennisPointsMode === "PLT";

    const isCup = tournament.tournament_format === "CUP";
    const isMixed = tournament.tournament_format === "MIXED";

    const hasLeagueTable = (standings?.table?.length ?? 0) > 0;
    const hasGroups = (standings?.groups?.length ?? 0) > 0;
    const hasTableData = hasLeagueTable || hasGroups;
    const hasBracketData = (standings?.bracket?.rounds?.length ?? 0) > 0;

    return {
      discipline,
      isTennis,
      showTennisPoints,
      isCup,
      isMixed,
      hasLeagueTable,
      hasGroups,
      hasTableData,
      hasBracketData,
    };
  }, [tournament, standings]);

  const {
    discipline,
    isTennis,
    showTennisPoints,
    isCup,
    isMixed,
    hasLeagueTable,
    hasGroups,
    hasTableData,
    hasBracketData,
  } = derived;

  const showTabs = isMixed || (hasTableData && hasBracketData);

  return (
    <div className={cn(showHeader ? "px-4 py-4 sm:px-0" : "p-0", "mx-auto w-full max-w-7xl")}>
      {showHeader ? (
        <div className="mb-4">
          <div className="text-sm text-slate-300">Wyniki</div>
          <h2 className="mt-1 text-2xl font-semibold text-white">{tournament.name}</h2>
        </div>
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
              Tabela
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

      {tab === "TABLE" ? (
        hasGroups ? (
          <div className="space-y-4">
            {standings!.groups!.map((g, idx) => {
              const groupTitle =
                (g.group_name || "").toLowerCase().startsWith("grupa") ? g.group_name : displayGroupName(g.group_name, idx);

              const groupKey = normalizeGroupKey(g.group_name);
              const groupMatches = matches.filter(
                (m) => m.stage_type === "GROUP" && normalizeGroupKey(m.group_name) === groupKey
              );

              return (
                <Card key={g.group_id} className="p-5 sm:p-6">
                  <div className="mb-3">
                    <div className="text-xs text-slate-400">Faza grupowa</div>
                    <div className="mt-1 text-lg font-semibold text-slate-100">{groupTitle}</div>
                  </div>

                  <StandingsTable
                    rows={g.table}
                    matchesForForm={groupMatches}
                    isTennis={isTennis}
                    showTennisPoints={showTennisPoints}
                  />
                </Card>
              );
            })}
          </div>
        ) : hasLeagueTable ? (
          <Card className="p-5 sm:p-6">
            <div className="mb-3">
              <div className="text-xs text-slate-400">Tabela</div>
              <div className="mt-1 text-lg font-semibold text-slate-100">Klasyfikacja</div>
            </div>

            <StandingsTable
              rows={standings!.table!}
              matchesForForm={matches.filter((m) => m.stage_type === "LEAGUE")}
              isTennis={isTennis}
              showTennisPoints={showTennisPoints}
            />
          </Card>
        ) : (
          !isCup && <InlineAlert variant="info">Brak danych tabeli.</InlineAlert>
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
  showTennisPoints,
}: {
  rows: StandingRow[];
  matchesForForm: MatchDto[];
  isTennis: boolean;
  showTennisPoints: boolean;
}) {
  return (
    <>
      <div className="sm:hidden">
        <StandingsTableMobile
          rows={rows}
          matchesForForm={matchesForForm}
          isTennis={isTennis}
          showTennisPoints={showTennisPoints}
        />
      </div>

      <div className="hidden sm:block">
        <StandingsTableDesktop
          rows={rows}
          matchesForForm={matchesForForm}
          isTennis={isTennis}
          showTennisPoints={showTennisPoints}
        />
      </div>
    </>
  );
}

function StandingsTableMobile({
  rows,
  matchesForForm,
  isTennis,
  showTennisPoints,
}: {
  rows: StandingRow[];
  matchesForForm: MatchDto[];
  isTennis: boolean;
  showTennisPoints: boolean;
}) {
  return (
    <div className="grid gap-2">
      {rows.map((r, i) => {
        const form = last5Form(r.team_id, matchesForForm);

        if (isTennis) {
          const setsFor = safeNum(r.sets_for, safeNum(r.goals_for, 0));
          const setsAgainst = safeNum(r.sets_against, safeNum(r.goals_against, 0));
          const setsDiff = safeNum(r.sets_diff, safeNum(r.goal_difference, setsFor - setsAgainst));

          const gamesFor = safeNum(r.games_for, 0);
          const gamesAgainst = safeNum(r.games_against, 0);
          const gamesDiff = safeNum(r.games_diff, safeNum(r.games_difference, gamesFor - gamesAgainst));

          return (
            <Card key={r.team_id} className="bg-white/[0.03] p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs text-slate-400">#{i + 1}</div>
                  <div className="mt-0.5 truncate text-sm font-semibold text-white">{r.team_name}</div>
                </div>

                {showTennisPoints ? (
                  <div className="shrink-0 text-right">
                    <div className="text-xs text-slate-400">Pkt</div>
                    <div className="text-sm font-semibold text-sky-200">{r.points}</div>
                  </div>
                ) : null}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-200">
                <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                  <div className="text-[11px] text-slate-400">M</div>
                  <div className="font-semibold text-white">{r.played}</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                  <div className="text-[11px] text-slate-400">Z - P</div>
                  <div className="font-semibold text-white">
                    {r.wins} - {r.losses}
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                  <div className="text-[11px] text-slate-400">Sety + -</div>
                  <div className="font-semibold text-white">
                    {setsFor} - {setsAgainst}
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                  <div className="text-[11px] text-slate-400">RS</div>
                  <div className="font-semibold text-white">{setsDiff}</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                  <div className="text-[11px] text-slate-400">Gemy + -</div>
                  <div className="font-semibold text-white">
                    {gamesFor} - {gamesAgainst}
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                  <div className="text-[11px] text-slate-400">RG</div>
                  <div className="font-semibold text-white">{gamesDiff}</div>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="text-xs text-slate-400">Forma</div>
                <FormDots form={form} />
              </div>
            </Card>
          );
        }

        return (
          <Card key={r.team_id} className="bg-white/[0.03] p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-slate-400">#{i + 1}</div>
                <div className="mt-0.5 truncate text-sm font-semibold text-white">{r.team_name}</div>
              </div>

              <div className="shrink-0 text-right">
                <div className="text-xs text-slate-400">Pkt</div>
                <div className="text-sm font-semibold text-sky-200">{r.points}</div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-200">
              <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                <div className="text-[11px] text-slate-400">M</div>
                <div className="font-semibold text-white">{r.played}</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                <div className="text-[11px] text-slate-400">Z - R - P</div>
                <div className="font-semibold text-white">
                  {r.wins} - {r.draws} - {r.losses}
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                <div className="text-[11px] text-slate-400">B+ : B-</div>
                <div className="font-semibold text-white">
                  {r.goals_for}:{r.goals_against}
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                <div className="text-[11px] text-slate-400">RB</div>
                <div className="font-semibold text-white">{r.goal_difference}</div>
              </div>
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

function StandingsTableDesktop({
  rows,
  matchesForForm,
  isTennis,
  showTennisPoints,
}: {
  rows: StandingRow[];
  matchesForForm: MatchDto[];
  isTennis: boolean;
  showTennisPoints: boolean;
}) {
  const minW = isTennis ? (showTennisPoints ? "min-w-[950px]" : "min-w-[900px]") : "min-w-[600px]";

  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full border-separate border-spacing-0", minW)}>
        <thead>
          {isTennis ? (
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
          {rows.map((r, i) => {
            const form = last5Form(r.team_id, matchesForForm);

            if (isTennis) {
              const setsFor = safeNum(r.sets_for, safeNum(r.goals_for, 0));
              const setsAgainst = safeNum(r.sets_against, safeNum(r.goals_against, 0));
              const setsDiff = safeNum(r.sets_diff, safeNum(r.goal_difference, setsFor - setsAgainst));

              const gamesFor = safeNum(r.games_for, 0);
              const gamesAgainst = safeNum(r.games_against, 0);
              const gamesDiff = safeNum(r.games_diff, safeNum(r.games_difference, gamesFor - gamesAgainst));

              return (
                <tr key={r.team_id} className="border-t border-white/10 hover:bg-white/[0.04]">
                  <td className="py-3 pl-2 pr-3 text-slate-300">{i + 1}</td>
                  <td className="py-3 pr-3 font-semibold">{r.team_name}</td>
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

                  <td className="py-3 pr-2">
                    <FormDots form={form} />
                  </td>
                </tr>
              );
            }

            return (
              <tr key={r.team_id} className="border-t border-white/10 hover:bg-white/[0.04]">
                <td className="py-3 pl-2 pr-3 text-slate-300">{i + 1}</td>
                <td className="py-3 pr-3 font-semibold">{r.team_name}</td>
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
      {form.map((f, idx) => (
        <span
          key={`${f}-${idx}`}
          className={cn(
            "inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-white",
            f === "W" && "bg-emerald-500/80",
            f === "D" && "bg-slate-400/70",
            f === "L" && "bg-rose-500/80"
          )}
          title={f === "W" ? "Wygrana" : f === "D" ? "Remis" : "Porażka"}
        >
          {f}
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
  const cardW = 240;
  const cardH = 80;
  const colGap = 64;
  const rowUnit = 108;
  const halfUnit = Math.round(rowUnit / 2);
  return { cardW, cardH, colGap, rowUnit, halfUnit };
}

type BracketNode = {
  roundIndex: number;
  itemIndex: number;
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

  const maxItemsInAnyRound = Math.max(0, ...rounds.map((r) => r.items.length));
  const contentH = Math.max(cardH, maxItemsInAnyRound * rowUnit);

  const contentW = Math.max(cardW, roundCount * colW);

  rounds.forEach((round, rIdx) => {
    const items = round.items;
    const colX = rIdx * colW;

    const totalHeight = items.length * rowUnit;
    const startY = Math.max(0, (contentH - totalHeight) / 2);

    items.forEach((item, iIdx) => {
      const y = startY + iIdx * rowUnit + halfUnit - cardH / 2;

      nodes.push({
        roundIndex: rIdx,
        itemIndex: iIdx,
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

function buildCenteredLayout(data: BracketData, dims: BracketDims): BracketLayout | null {
  const rounds = data.rounds;
  if (rounds.length === 0) return null;

  const { cardW, cardH, colGap, rowUnit, halfUnit } = dims;

  const finalRoundIndex = rounds.length - 1;
  const finalRound = rounds[finalRoundIndex];
  if (!finalRound || finalRound.items.length === 0) return null;

  const nodes: BracketNode[] = [];
  const contentH = Math.max(cardH, Math.max(1, finalRound.items.length) * rowUnit);

  const colW = cardW + colGap;
  const contentW = Math.max(cardW, rounds.length * colW);

  const finalX = finalRoundIndex * colW;
  const finalStartY = Math.max(0, (contentH - finalRound.items.length * rowUnit) / 2);

  finalRound.items.forEach((item, iIdx) => {
    const y = finalStartY + iIdx * rowUnit + halfUnit - cardH / 2;
    nodes.push({
      roundIndex: finalRoundIndex,
      itemIndex: iIdx,
      x: finalX,
      y,
      w: cardW,
      h: cardH,
      item,
      label: finalRound.label,
    });
  });

  for (let r = finalRoundIndex - 1; r >= 0; r--) {
    const round = rounds[r];
    const colX = r * colW;

    const expectedPairs = round.items.length;
    const totalHeight = expectedPairs * rowUnit;
    const startY = Math.max(0, (contentH - totalHeight) / 2);

    round.items.forEach((item, iIdx) => {
      const y = startY + iIdx * rowUnit + halfUnit - cardH / 2;
      nodes.push({
        roundIndex: r,
        itemIndex: iIdx,
        x: colX,
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

  const map = new Map<string, BracketNode>();
  layout.nodes.forEach((n) => map.set(`${n.roundIndex}:${n.itemIndex}`, n));

  const conns: Connection[] = [];

  for (const node of layout.nodes) {
    const r = node.roundIndex;
    if (r >= layout.roundCount - 1) continue;

    const nextRoundIndex = r + 1;
    const nextIndex = Math.floor(node.itemIndex / 2);

    const next = map.get(`${nextRoundIndex}:${nextIndex}`);
    if (!next) continue;

    const x1 = node.x + cardW;
    const y1 = node.y + cardH / 2;
    const x2 = next.x;
    const y2 = next.y + cardH / 2;

    const midX = x1 + colGap / 2;

    conns.push({ x1, y1, x2: midX, y2: y1 });
    conns.push({ x1: midX, y1, x2: midX, y2 });
    conns.push({ x1: midX, y1: y2, x2, y2 });
  }

  return conns;
}

function BracketPremium({ data, discipline, mode }: { data: BracketData; discipline: string; mode: BracketMode }) {
  const dims = useMemo(() => getDefaultDims(), []);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);

  const [zoom, setZoom] = useState(1);
  const [fitZoom, setFitZoom] = useState(1);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [dragging, setDragging] = useState(false);

  const pyramid = useMemo(() => buildPyramidLayout(data.rounds, dims), [data.rounds, dims]);
  const centered = useMemo(() => buildCenteredLayout(data, dims), [data, dims]);

  const contentW = mode === "PYRAMID" ? pyramid.contentW : centered?.contentW ?? pyramid.contentW;
  const contentH = mode === "PYRAMID" ? pyramid.contentH : centered?.contentH ?? pyramid.contentH;

  const layout = mode === "PYRAMID" ? pyramid : centered ?? pyramid;
  const conns = useMemo(() => buildConnections(layout, dims), [layout, dims]);

  // ===== Dopasowanie zoom =====
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    const compute = () => {
      const w = el.clientWidth;
      const padding = 12;
      const available = Math.max(260, w - padding * 2);
      const fit = contentW > 0 ? clamp(available / contentW, 0.5, 1) : 1;

      setFitZoom(fit);

      if (zoom < 0.55) return;
      if (zoom > 1.05) return;

      setZoom(fit);
    };

    compute();

    const ro = new ResizeObserver(() => compute());
    ro.observe(el);

    return () => ro.disconnect();
  }, [contentW, zoom]);

  const handleZoom = (delta: number) => setZoom((z) => clamp(z + delta, 0.5, 2));
  const handleFit = () => setZoom(fitZoom);

  const requestFs = () => {
    setIsFullscreen(true);
    setTimeout(() => setZoom(fitZoom), 50);
  };
  const exitFs = () => {
    setIsFullscreen(false);
    setTimeout(() => setZoom(fitZoom), 50);
  };

  // ===== Tryb pełnoekranowy =====
  useEffect(() => {
    if (!isFullscreen) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") exitFs();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  // ===== Przesuwanie widoku =====
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    let isDown = false;
    let startX = 0;
    let startY = 0;
    let scrollLeft = 0;
    let scrollTop = 0;

    const onDown = (e: MouseEvent) => {
      if (!isFullscreen && e.button !== 0) return;
      isDown = true;
      setDragging(true);
      startX = e.pageX - el.offsetLeft;
      startY = e.pageY - el.offsetTop;
      scrollLeft = el.scrollLeft;
      scrollTop = el.scrollTop;
    };

    const onLeave = () => {
      isDown = false;
      setDragging(false);
    };

    const onUp = () => {
      isDown = false;
      setDragging(false);
    };

    const onMove = (e: MouseEvent) => {
      if (!isDown) return;
      e.preventDefault();
      const x = e.pageX - el.offsetLeft;
      const y = e.pageY - el.offsetTop;
      const walkX = x - startX;
      const walkY = y - startY;
      el.scrollLeft = scrollLeft - walkX;
      el.scrollTop = scrollTop - walkY;
    };

    el.addEventListener("mousedown", onDown);
    el.addEventListener("mouseleave", onLeave);
    el.addEventListener("mouseup", onUp);
    el.addEventListener("mousemove", onMove);

    return () => {
      el.removeEventListener("mousedown", onDown);
      el.removeEventListener("mouseleave", onLeave);
      el.removeEventListener("mouseup", onUp);
      el.removeEventListener("mousemove", onMove);
    };
  }, [isFullscreen]);

  const contentStyle = useMemo<CSSProperties>(() => {
    return {
      width: contentW,
      height: contentH,
      transform: `scale(${zoom})`,
      transformOrigin: "top left",
    };
  }, [contentW, contentH, zoom]);

  return (
    <div
      ref={hostRef}
      className={cn(
        "relative",
        isFullscreen &&
          "fixed inset-0 z-50 overflow-hidden bg-slate-950/95 backdrop-blur"
      )}
    >
      <div
        className={cn(
          "mb-3 flex flex-wrap items-center justify-between gap-2",
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
            <Button variant="secondary" onClick={requestFs} className="h-9 px-3">
              <Maximize2 className="h-4 w-4" />
            </Button>
          ) : (
            <Button variant="secondary" onClick={exitFs} className="h-9 px-3">
              <Minimize2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <div
        ref={viewportRef}
        className={cn(
          "relative overflow-auto rounded-2xl border border-white/10 bg-white/[0.03]",
          dragging && "cursor-grabbing",
          !dragging && "cursor-grab",
          isFullscreen ? "h-[calc(100vh-86px)]" : "max-h-[560px]"
        )}
      >
        <div
          className="relative"
          style={{
            width: contentW * zoom,
            height: contentH * zoom,
            padding: 12,
          }}
        >
          <svg
            className="absolute left-0 top-0"
            width={contentW * zoom}
            height={contentH * zoom}
            style={{ pointerEvents: "none" }}
          >
            <g transform={`scale(${zoom})`}>
              {conns.map((c, idx) => (
                <path
                  key={idx}
                  d={`M ${c.x1} ${c.y1} L ${c.x2} ${c.y2}`}
                  stroke="rgba(255,255,255,0.18)"
                  strokeWidth={2}
                  fill="none"
                />
              ))}
            </g>
          </svg>

          <div style={contentStyle}>
            <div className="relative">
              {layout.nodes.map((n) => (
                <div
                  key={`${n.roundIndex}-${n.itemIndex}-${n.item.id}`}
                  className="absolute"
                  style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
                >
                  <MatchCard item={n.item} discipline={discipline} roundLabel={n.label} />
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
  if (status === "FINISHED") return { label: "Zakończony", cls: "bg-emerald-500/15 text-emerald-100 border-emerald-400/20" };
  if (status === "IN_PROGRESS") return { label: "W trakcie", cls: "bg-sky-500/15 text-sky-100 border-sky-400/20" };
  return { label: "Zaplanowany", cls: "bg-white/[0.04] text-slate-200 border-white/10" };
}

function MatchCard({ item, discipline, roundLabel }: { item: BracketDuelItem; discipline: string; roundLabel: string }) {
  const status = badgeStatus(item.status);

  return (
    <div className="h-full w-full rounded-2xl border border-white/10 bg-white/[0.04] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-xs text-slate-400">{roundLabel}</div>
          <div className="mt-0.5 truncate text-sm font-semibold text-white">
            {item.home_team_name} vs {item.away_team_name}
          </div>
        </div>

        <span className={cn("shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold", status.cls)}>
          {status.label}
        </span>
      </div>

      <div className="grid gap-2">
        <MatchScoreBlock item={item} discipline={discipline} />
      </div>
    </div>
  );
}

function scoreText(a: number | null | undefined, b: number | null | undefined) {
  if (a == null || b == null) return "-";
  return `${a}:${b}`;
}

function hasPenalties(item: BracketDuelItem) {
  const p1 = item.penalties_leg1_home != null || item.penalties_leg1_away != null;
  const p2 = item.penalties_leg2_home != null || item.penalties_leg2_away != null;
  return p1 || p2;
}

function MatchScoreBlock({ item, discipline }: { item: BracketDuelItem; discipline: string }) {
  const isTennis = String(discipline || "").toLowerCase() === "tennis";

  const leg1 = scoreText(item.score_leg1_home, item.score_leg1_away);
  const leg2 = item.is_two_legged ? scoreText(item.score_leg2_home ?? null, item.score_leg2_away ?? null) : null;

  const agg = item.aggregate_home != null && item.aggregate_away != null ? `${item.aggregate_home}:${item.aggregate_away}` : null;

  const showPens = hasPenalties(item);

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <ScorePill label="Mecz" score={leg1} variant="leg" />

        {leg2 ? <ScorePill label="Rewanż" score={leg2} variant="leg" /> : null}

        {agg ? <ScorePill label="Agregat" score={agg} variant="agg" /> : null}

        {item.winner_id ? (
          <span className="ml-auto text-xs font-semibold text-slate-300">
            Zwycięzca:{" "}
            <span className="text-white">
              {item.winner_id === item.home_team_id ? item.home_team_name : item.away_team_name}
            </span>
          </span>
        ) : null}
      </div>

      {showPens ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
          <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">
            Karne:{" "}
            <span className="font-semibold text-white">
              {scoreText(item.penalties_leg1_home ?? null, item.penalties_leg1_away ?? null)}
            </span>
            {item.is_two_legged ? (
              <>
                {" "}
                /{" "}
                <span className="font-semibold text-white">
                  {scoreText(item.penalties_leg2_home ?? null, item.penalties_leg2_away ?? null)}
                </span>
              </>
            ) : null}
          </span>
        </div>
      ) : null}

      {isTennis ? (
        <div className="text-xs text-slate-300">
          {item.tennis_sets_leg1 ? (
            <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">
              Sety: <span className="font-semibold text-white">{String(item.tennis_sets_leg1)}</span>
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