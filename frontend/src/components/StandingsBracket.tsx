import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Brackets, Maximize2, Minimize2, Minus, Plus, Scan, Table2 } from "lucide-react";

import { apiFetch } from "../api";
import { cn } from "../lib/cn";
import { displayGroupName, isByeMatch } from "../flow/stagePresentation";

import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { InlineAlert } from "../ui/InlineAlert";

/* =========================
   HELPERY AUTH
   ========================= */

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

/* =========================
   TYPY
   ========================= */

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

/* =========================
   PROPS
   ========================= */

type StandingsBracketProps = {
  tournamentId: number;
  accessCode?: string;
  showHeader?: boolean;
};

/* =========================
   KOMPONENT (fetch + render)
   ========================= */

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
    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const tRes = await apiFetch(url(`/api/tournaments/${tournamentId}/`));
        if (!tRes.ok) throw new Error("Nie udało się pobrać danych turnieju.");
        const tData = await tRes.json();

        const t: Tournament = {
          id: tData.id,
          name: tData.name,
          discipline: tData.discipline ?? undefined,
          tournament_format: (tData.tournament_format ?? "LEAGUE") as Tournament["tournament_format"],
          format_config: tData.format_config ?? undefined,
        };
        setTournament(t);

        let sData: StandingsResponse | null = null;
        const sRes = await apiFetch(url(`/api/tournaments/${tournamentId}/standings/`));
        if (sRes.ok) {
          sData = await sRes.json();
        } else {
          const spRes = await apiFetch(url(`/api/tournaments/${tournamentId}/public/standings/`));
          if (spRes.ok) sData = await spRes.json();
          else sData = null;
        }
        setStandings(sData);

        const authed = hasAccessToken();
        const isPublicContext = !!accessCode || !authed;

        const fetchAndMapPublicMatches = async () => {
          const mpRes = await apiFetch(url(`/api/tournaments/${tournamentId}/public/matches/`));
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

        if (isPublicContext) {
          setMatches(await fetchAndMapPublicMatches());
        } else {
          const mRes = await apiFetch(url(`/api/tournaments/${tournamentId}/matches/`));
          if (mRes.status === 401 || mRes.status === 403) {
            setMatches(await fetchAndMapPublicMatches());
          } else {
            if (!mRes.ok) throw new Error("Nie udało się pobrać meczów.");
            const raw = await mRes.json();
            const list = Array.isArray(raw) ? raw : Array.isArray(raw?.results) ? raw.results : [];
            setMatches(list);
          }
        }
      } catch (e: any) {
        setError(e?.message || "Wystąpił błąd");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [tournamentId, qs, accessCode]);

  if (loading) return <div className="text-sm text-slate-300">Ładowanie...</div>;
  if (error) return <InlineAlert variant="error">{error}</InlineAlert>;
  if (!tournament) return null;

  return (
    <TournamentStandingsView tournament={tournament} matches={matches} standings={standings} showHeader={showHeader} />
  );
}

/* =========================
   HELPERY
   ========================= */

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

/* =========================
   WIDOK: tabela + drabinka
   ========================= */

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

  const { discipline, isTennis, showTennisPoints, isCup, isMixed, hasLeagueTable, hasGroups, hasTableData, hasBracketData } =
    derived;

  const showTabs = isMixed || (hasTableData && hasBracketData);

  return (
    <div className={cn(showHeader ? "px-4 py-4 sm:px-0" : "p-0")}>
      {showHeader ? (
        <div className="mb-4">
          <div className="text-sm text-slate-300">Wyniki</div>
          <h2 className="mt-1 text-2xl font-semibold text-white">{tournament.name}</h2>
        </div>
      ) : null}

      {showTabs ? (
        <div className="mb-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setTab("TABLE")}
            className={cn(
              "relative inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold transition",
              "border border-white/10 bg-white/[0.06] text-slate-200 hover:bg-white/[0.10]",
              "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/15",
              tab === "TABLE" && "border-white/15"
            )}
          >
            <span className="relative z-10 inline-flex items-center gap-2">
              <Table2 className="h-4 w-4 text-white/80" />
              Tabela
            </span>
          </button>

          <button
            type="button"
            onClick={() => setTab("BRACKET")}
            className={cn(
              "relative inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold transition",
              "border border-white/10 bg-white/[0.06] text-slate-200 hover:bg-white/[0.10]",
              "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/15",
              tab === "BRACKET" && "border-white/15"
            )}
          >
            <span className="relative z-10 inline-flex items-center gap-2">
              <Brackets className="h-4 w-4 text-white/80" />
              Drabinka
            </span>
          </button>
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
              <button
                type="button"
                onClick={() => setBracketMode("PYRAMID")}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                  "border-white/10 bg-white/[0.06] text-slate-200 hover:bg-white/[0.10]",
                  "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/15",
                  bracketMode === "PYRAMID" && "border-white/15 bg-white/10"
                )}
              >
                Piramida
              </button>

              <button
                type="button"
                onClick={() => setBracketMode("CENTERED")}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                  "border-white/10 bg-white/[0.06] text-slate-200 hover:bg-white/[0.10]",
                  "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/15",
                  bracketMode === "CENTERED" && "border-white/15 bg-white/10"
                )}
              >
                Finał w środku
              </button>
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

/* =========================
   TABELA
   ========================= */

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

/* =========================
   DRABINKA PREMIUM: układ + linie + drag
   ========================= */

type BracketMode = "PYRAMID" | "CENTERED";

type BracketDims = {
  cardW: number;
  cardH: number;
  colGap: number;
  rowUnit: number;
  halfUnit: number;
};

function getDefaultDims(): BracketDims {
  // Parametry dobrane pod czytelność i “fit to width” na desktop
  const cardW = 240;
  const cardH = 80;
  const colGap = 64;
  const rowUnit = 108; // odstęp między meczami w rundzie 1
  const halfUnit = Math.round(rowUnit / 2);
  return { cardW, cardH, colGap, rowUnit, halfUnit };
}

function buildPyramidLayout(rounds: BracketRound[], dims: BracketDims) {
  const nRounds = rounds.length;
  const n0 = rounds[0]?.items?.length ?? 0;

  const contentW = nRounds > 0 ? nRounds * dims.cardW + (nRounds - 1) * dims.colGap : 0;
  const contentH = n0 > 0 ? (n0 - 1) * dims.rowUnit + dims.cardH : 0;

  const pos = rounds.map((r, ri) =>
    r.items.map((_, mi) => {
      // piramida bokiem: w kolejnych rundach mecze są “pomiędzy” parami
      const base = Math.pow(2, ri);
      const step = Math.pow(2, ri + 1);
      const slot = step * mi + (base - 1); // 0,2,4... / 1,5,9... / 3,11...
      const y = slot * dims.halfUnit;
      const x = ri * (dims.cardW + dims.colGap);
      return { x, y };
    })
  );

  const paths: string[] = [];
  for (let ri = 0; ri < rounds.length - 1; ri++) {
    const fromRound = rounds[ri];
    const toRound = rounds[ri + 1];

    for (let mi = 0; mi < fromRound.items.length; mi++) {
      const ti = Math.floor(mi / 2);
      if (!toRound.items[ti]) continue;

      const a = pos[ri][mi];
      const b = pos[ri + 1][ti];

      const x1 = a.x + dims.cardW;
      const y1 = a.y + dims.cardH / 2;

      const x2 = b.x;
      const y2 = b.y + dims.cardH / 2;

      const mid = x1 + (x2 - x1) / 2;

      paths.push(`M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`);
    }
  }

  return { contentW, contentH, pos, paths };
}

function buildCenteredLayout(data: BracketData, dims: BracketDims) {
  const rounds = data.rounds;
  if (rounds.length === 0) return null;

  const finalRound = rounds[rounds.length - 1];
  const pre = rounds.slice(0, rounds.length - 1);

  const splitIdx0 = Math.ceil((pre[0]?.items?.length ?? 0) / 2);

  const leftRounds: BracketRound[] = pre.map((r) => ({
    ...r,
    items: r.items.slice(0, Math.ceil(r.items.length / 2)),
  }));

  const rightRounds: BracketRound[] = pre.map((r) => ({
    ...r,
    items: r.items.slice(Math.ceil(r.items.length / 2)),
  }));

  const leftN0 = leftRounds[0]?.items?.length ?? 0;
  const rightN0 = rightRounds[0]?.items?.length ?? 0;

  const preCols = pre.length; // bez finału
  const centerGap = 96;

  const leftW = preCols * dims.cardW + Math.max(0, preCols - 1) * dims.colGap;
  const finalW = dims.cardW;
  const rightW = preCols * dims.cardW + Math.max(0, preCols - 1) * dims.colGap;

  const contentW = leftW + centerGap + finalW + centerGap + rightW;

  const maxN0 = Math.max(leftN0 * 2, rightN0 * 2, splitIdx0 * 2);
  const effectiveN0 = Math.max(maxN0 / 2, 1);
  const contentH = (effectiveN0 - 1) * dims.rowUnit + dims.cardH;

  const leftBaseX = 0;
  const finalX = leftW + centerGap;
  const rightBaseX = finalX + finalW + centerGap;

  const leftPos = leftRounds.map((r, ri) =>
    r.items.map((_, mi) => {
      const base = Math.pow(2, ri);
      const step = Math.pow(2, ri + 1);
      const slot = step * mi + (base - 1);
      const y = slot * dims.halfUnit;
      const x = leftBaseX + ri * (dims.cardW + dims.colGap);
      return { x, y };
    })
  );

  const rightXForRound = (ri: number) => {
    // round 0 ma być najdalej na prawo, więc round rośnie w lewo
    const offset = (preCols - 1 - ri) * (dims.cardW + dims.colGap);
    return rightBaseX + offset;
  };

  const rightPos = rightRounds.map((r, ri) =>
    r.items.map((_, mi) => {
      const base = Math.pow(2, ri);
      const step = Math.pow(2, ri + 1);
      const slot = step * mi + (base - 1);
      const y = slot * dims.halfUnit;
      const x = rightXForRound(ri);
      return { x, y };
    })
  );

  const finalPos = finalRound.items.map((_, mi) => {
    const y = (contentH - dims.cardH) / 2;
    const x = finalX;
    return { x, y, mi };
  });

  const paths: string[] = [];

  // Lewa strona: standardowo w prawo
  for (let ri = 0; ri < leftRounds.length - 1; ri++) {
    for (let mi = 0; mi < leftRounds[ri].items.length; mi++) {
      const ti = Math.floor(mi / 2);
      if (!leftRounds[ri + 1].items[ti]) continue;

      const a = leftPos[ri][mi];
      const b = leftPos[ri + 1][ti];

      const x1 = a.x + dims.cardW;
      const y1 = a.y + dims.cardH / 2;
      const x2 = b.x;
      const y2 = b.y + dims.cardH / 2;
      const mid = x1 + (x2 - x1) / 2;

      paths.push(`M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`);
    }
  }

  // Prawa strona: w lewo (do centrum)
  for (let ri = 0; ri < rightRounds.length - 1; ri++) {
    for (let mi = 0; mi < rightRounds[ri].items.length; mi++) {
      const ti = Math.floor(mi / 2);
      if (!rightRounds[ri + 1].items[ti]) continue;

      const a = rightPos[ri][mi];
      const b = rightPos[ri + 1][ti];

      const x1 = a.x; // lewa krawędź (w stronę centrum)
      const y1 = a.y + dims.cardH / 2;
      const x2 = b.x + dims.cardW; // prawa krawędź targetu (też w stronę centrum)
      const y2 = b.y + dims.cardH / 2;
      const mid = x2 + (x1 - x2) / 2;

      paths.push(`M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`);
    }
  }

  // Połączenia do finału
  const leftLast = leftRounds[leftRounds.length - 1];
  const rightLast = rightRounds[rightRounds.length - 1];

  if (finalPos[0]) {
    // lewy półfinał -> finał (wejście z lewej)
    if (leftLast?.items?.[0] && leftPos[leftPos.length - 1]?.[0]) {
      const a = leftPos[leftPos.length - 1][0];
      const x1 = a.x + dims.cardW;
      const y1 = a.y + dims.cardH / 2;

      const x2 = finalPos[0].x;
      const y2 = finalPos[0].y + dims.cardH / 2;
      const mid = x1 + (x2 - x1) / 2;

      paths.push(`M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`);
    }

    // prawy półfinał -> finał (wejście z prawej)
    if (rightLast?.items?.[0] && rightPos[rightPos.length - 1]?.[0]) {
      const a = rightPos[rightPos.length - 1][0];
      const x1 = a.x; // lewa krawędź półfinału (w stronę finału)
      const y1 = a.y + dims.cardH / 2;

      const x2 = finalPos[0].x + dims.cardW; // prawa krawędź finału
      const y2 = finalPos[0].y + dims.cardH / 2;
      const mid = x2 + (x1 - x2) / 2;

      paths.push(`M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`);
    }
  }

  return {
    contentW,
    contentH,
    leftRounds,
    rightRounds,
    finalRound,
    leftPos,
    rightPos,
    finalPos,
    paths,
  };
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
  const centered = useMemo(() => buildCenteredLayout(data, dims), [data, dims, mode]);

  const contentW = mode === "PYRAMID" ? pyramid.contentW : centered?.contentW ?? pyramid.contentW;
  const contentH = mode === "PYRAMID" ? pyramid.contentH : centered?.contentH ?? pyramid.contentH;

  // ===== Fit to width =====
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    const compute = () => {
      const w = el.clientWidth;
      const padding = 12;
      const available = Math.max(260, w - padding * 2);
      const fit = contentW > 0 ? clamp(available / contentW, 0.5, 1) : 1;

      setFitZoom(fit);

      // Jeżeli user nie zmieniał ręcznie, trzymamy “fit”
      setZoom((prev) => {
        const isNearPrevFit = Math.abs(prev - fit) < 0.02;
        return isNearPrevFit ? fit : prev;
      });
    };

    compute();

    const ro = new ResizeObserver(() => compute());
    ro.observe(el);

    return () => ro.disconnect();
  }, [contentW]);

  // ===== Fullscreen =====
  useEffect(() => {
    const onChange = () => {
      const fs = !!document.fullscreenElement;
      setIsFullscreen(fs);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const requestFs = async () => {
    const el = hostRef.current;
    if (!el) return;
    try {
      await el.requestFullscreen();
    } catch {
      // ignore
    }
  };

  const exitFs = async () => {
    try {
      await document.exitFullscreen();
    } catch {
      // ignore
    }
  };

  const pannable = isFullscreen || zoom > fitZoom + 0.02;

  // ===== Drag-to-pan =====
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;

    const state = {
      active: false,
      sx: 0,
      sy: 0,
      sl: 0,
      st: 0,
      pid: -1,
    };

    const isInteractive = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      return !!el.closest("button, a, input, textarea, select");
    };

    const onDown = (e: PointerEvent) => {
      if (!pannable) return;
      if (e.button !== 0) return;
      if (isInteractive(e.target)) return;

      state.active = true;
      state.pid = e.pointerId;
      state.sx = e.clientX;
      state.sy = e.clientY;
      state.sl = vp.scrollLeft;
      state.st = vp.scrollTop;

      vp.setPointerCapture(e.pointerId);
      setDragging(true);
    };

    const onMove = (e: PointerEvent) => {
      if (!state.active) return;
      const dx = e.clientX - state.sx;
      const dy = e.clientY - state.sy;
      vp.scrollLeft = state.sl - dx;
      vp.scrollTop = state.st - dy;
    };

    const onUp = (e: PointerEvent) => {
      if (!state.active) return;
      if (state.pid === e.pointerId) {
        state.active = false;
        state.pid = -1;
        setDragging(false);
      }
    };

    vp.addEventListener("pointerdown", onDown);
    vp.addEventListener("pointermove", onMove);
    vp.addEventListener("pointerup", onUp);
    vp.addEventListener("pointercancel", onUp);

    return () => {
      vp.removeEventListener("pointerdown", onDown);
      vp.removeEventListener("pointermove", onMove);
      vp.removeEventListener("pointerup", onUp);
      vp.removeEventListener("pointercancel", onUp);
    };
  }, [pannable]);

  const handleZoom = (delta: number) => {
    setZoom((z) => clamp(Math.round((z + delta) * 100) / 100, 0.5, 1.6));
  };

  const handleFit = () => setZoom(fitZoom);

  const wrapStyle: CSSProperties = {
    width: contentW,
    height: contentH,
    transform: `scale(${zoom})`,
    transformOrigin: "top left",
  };

  const svgStyle: CSSProperties = {
    width: contentW,
    height: contentH,
  };

  const lineStroke = "rgba(255,255,255,0.22)";

  const paths =
    mode === "PYRAMID" ? pyramid.paths : centered?.paths ?? pyramid.paths;

  return (
    <div
      ref={hostRef}
      className={cn(
        "relative rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5",
        isFullscreen && "h-[100svh] w-full rounded-none border-0 p-0"
      )}
    >
      {/* ===== Toolbar ===== */}
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

      {/* ===== Viewport ===== */}
      <div
        ref={viewportRef}
        className={cn(
          "relative w-full rounded-2xl border border-white/10 bg-black/10",
          pannable ? "overflow-auto" : "overflow-hidden",
          pannable && "select-none",
          pannable && (dragging ? "cursor-grabbing" : "cursor-grab"),
          isFullscreen ? "h-[calc(100svh-84px)]" : "h-[520px] sm:h-[560px]"
        )}
      >
        <div className="relative">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute -top-24 left-1/2 h-44 w-[34rem] -translate-x-1/2 rounded-full bg-indigo-500/12 blur-3xl" />
            <div className="absolute -bottom-28 left-1/2 h-44 w-[34rem] -translate-x-1/2 rounded-full bg-sky-500/10 blur-3xl" />
          </div>

          <div className="relative p-4">
            <div className="relative" style={wrapStyle}>
              {/* ===== Linie połączeń ===== */}
              <svg
                className="absolute left-0 top-0 pointer-events-none"
                style={svgStyle}
                viewBox={`0 0 ${contentW} ${contentH}`}
              >
                {paths.map((d, idx) => (
                  <path
                    key={idx}
                    d={d}
                    fill="none"
                    stroke={lineStroke}
                    strokeWidth={2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                ))}
              </svg>

              {/* ===== Karty meczów ===== */}
              {mode === "PYRAMID" ? (
                <BracketCardsAbsolute
                  rounds={data.rounds}
                  pos={pyramid.pos}
                  dims={dims}
                  discipline={discipline}
                  thirdPlace={data.third_place}
                />
              ) : centered ? (
                <CenteredCardsAbsolute
                  centered={centered}
                  dims={dims}
                  discipline={discipline}
                  thirdPlace={data.third_place}
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BracketCardsAbsolute({
  rounds,
  pos,
  dims,
  discipline,
  thirdPlace,
}: {
  rounds: BracketRound[];
  pos: { x: number; y: number }[][];
  dims: BracketDims;
  discipline: string;
  thirdPlace: BracketDuelItem | null;
}) {
  return (
    <>
      {rounds.map((r, ri) =>
        r.items.map((item, mi) => {
          const p = pos[ri]?.[mi];
          if (!p) return null;

          const style: CSSProperties = {
            position: "absolute",
            left: p.x,
            top: p.y,
            width: dims.cardW,
            height: dims.cardH,
          };

          return <BracketMatchCard key={item.id} style={style} item={item} discipline={discipline} />;
        })
      )}

      {thirdPlace && rounds.length > 0 ? (
        <div
          style={{
            position: "absolute",
            left: (rounds.length - 1) * (dims.cardW + dims.colGap),
            top: Math.max(0, (pos[0]?.length ?? 0) * dims.rowUnit),
            width: dims.cardW,
            height: dims.cardH,
          }}
        >
          <div className="mb-1 text-center text-[11px] font-semibold uppercase tracking-wide text-amber-200">
            3. miejsce
          </div>
          <BracketMatchCard item={thirdPlace} discipline={discipline} />
        </div>
      ) : null}
    </>
  );
}

function CenteredCardsAbsolute({
  centered,
  dims,
  discipline,
  thirdPlace,
}: {
  centered: NonNullable<ReturnType<typeof buildCenteredLayout>>;
  dims: BracketDims;
  discipline: string;
  thirdPlace: BracketDuelItem | null;
}) {
  const { leftRounds, rightRounds, finalRound, leftPos, rightPos, finalPos } = centered;

  return (
    <>
      {leftRounds.map((r, ri) =>
        r.items.map((item, mi) => {
          const p = leftPos[ri]?.[mi];
          if (!p) return null;

          return (
            <BracketMatchCard
              key={`L-${item.id}`}
              style={{ position: "absolute", left: p.x, top: p.y, width: dims.cardW, height: dims.cardH }}
              item={item}
              discipline={discipline}
            />
          );
        })
      )}

      {rightRounds.map((r, ri) =>
        r.items.map((item, mi) => {
          const p = rightPos[ri]?.[mi];
          if (!p) return null;

          return (
            <BracketMatchCard
              key={`R-${item.id}`}
              style={{ position: "absolute", left: p.x, top: p.y, width: dims.cardW, height: dims.cardH }}
              item={item}
              discipline={discipline}
            />
          );
        })
      )}

      {finalRound.items.map((item, idx) => {
        const p = finalPos[idx];
        if (!p) return null;

        return (
          <BracketMatchCard
            key={`F-${item.id}`}
            style={{ position: "absolute", left: p.x, top: p.y, width: dims.cardW, height: dims.cardH }}
            item={item}
            discipline={discipline}
            highlight
          />
        );
      })}

      {thirdPlace ? (
        <div
          style={{
            position: "absolute",
            left: finalPos[0]?.x ?? 0,
            top: (finalPos[0]?.y ?? 0) + dims.cardH + 70,
            width: dims.cardW,
          }}
        >
          <div className="mb-1 text-center text-[11px] font-semibold uppercase tracking-wide text-amber-200">
            3. miejsce
          </div>
          <BracketMatchCard item={thirdPlace} discipline={discipline} />
        </div>
      ) : null}
    </>
  );
}

/* =========================
   KARTA MECZU (bez statusu)
   ========================= */

function BracketMatchCard({
  item,
  discipline,
  style,
  highlight,
}: {
  item: BracketDuelItem;
  discipline: string;
  style?: CSSProperties;
  highlight?: boolean;
}) {
  const isTennis = (discipline ?? "").toLowerCase() === "tennis";

  const homeWin = item.winner_id !== null && item.winner_id === item.home_team_id;
  const awayWin = item.winner_id !== null && item.winner_id === item.away_team_id;

  const aggHome = item.is_two_legged
    ? (item.aggregate_home ?? ((item.score_leg1_home ?? 0) + (item.score_leg2_home ?? 0)))
    : null;

  const aggAway = item.is_two_legged
    ? (item.aggregate_away ?? ((item.score_leg1_away ?? 0) + (item.score_leg2_away ?? 0)))
    : null;

  const showLeg2 = item.is_two_legged;

  // Zgodnie z wymaganiem: brak statusu. Pokazujemy tylko wynik.
  return (
    <div
      style={style}
      className={cn(
        "rounded-2xl border bg-white/[0.04] p-3",
        "shadow-[0_12px_34px_rgba(0,0,0,0.28)]",
        highlight ? "border-amber-400/25" : "border-white/10"
      )}
    >
      {item.is_two_legged ? (
        <div className="mb-1 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          Dwumecz
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <div className={cn("min-w-0 text-sm", homeWin ? "font-semibold text-slate-100" : "text-slate-200")}>
          <span className="block truncate">{item.home_team_name || "TBD"}</span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <ScoreBox score={item.score_leg1_home} variant="leg" />
          {showLeg2 ? <ScoreBox score={item.score_leg2_home} variant="leg" /> : null}
          {showLeg2 ? <ScoreBox score={aggHome} variant={homeWin ? "aggWin" : "agg"} /> : null}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-3">
        <div className={cn("min-w-0 text-sm", awayWin ? "font-semibold text-slate-100" : "text-slate-200")}>
          <span className="block truncate">{item.away_team_name || "TBD"}</span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <ScoreBox score={item.score_leg1_away} variant="leg" />
          {showLeg2 ? <ScoreBox score={item.score_leg2_away} variant="leg" /> : null}
          {showLeg2 ? <ScoreBox score={aggAway} variant={awayWin ? "aggWin" : "agg"} /> : null}
        </div>
      </div>

      {!isTennis ? null : (
        <div className="mt-2 text-[11px] text-slate-400">
          Tenis: sety w gemach są dostępne w szczegółach meczu.
        </div>
      )}
    </div>
  );
}

function ScoreBox({ score, variant }: { score: number | null | undefined; variant: "leg" | "agg" | "aggWin" }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 w-8 items-center justify-center rounded-md text-xs font-semibold",
        variant === "leg" && "border border-white/10 bg-white/5 text-slate-100",
        variant === "agg" && "border border-white/10 bg-white/10 text-slate-100",
        variant === "aggWin" && "border border-sky-400/30 bg-sky-500/20 text-sky-100"
      )}
      title={variant === "leg" ? "Wynik" : "Agregat"}
    >
      {score ?? "-"}
    </span>
  );
}

/*
Co zmieniono:
1) Dodano linie łączące rundy (SVG) - drabinka ma układ piramidy bokiem, a nie schodów.
2) Dodano drag-to-pan (przeciąganie) dla powiększenia i fullscreen.
3) Dodano kontrolki: +, -, dopasuj (fit) i fullscreen, bez poziomego slidera na desktop w trybie fit.
4) Usunięto statusy meczów z drabinki - pozostają drużyny i wyniki (oraz agregat dla dwumeczu).
*/