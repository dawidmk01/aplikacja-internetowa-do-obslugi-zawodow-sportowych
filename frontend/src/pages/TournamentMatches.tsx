import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../api";

// ============================================================
// Typy
// ============================================================

type TournamentDTO = {
  id: number;
  participants_count?: number;
  tournament_format?: "LEAGUE" | "CUP" | "MIXED";
};

type Match = {
  id: number;

  stage_id?: number;
  stage_order?: number;

  round_number: number | null;
  stage_type: "LEAGUE" | "KNOCKOUT";
  home_team_name: string;
  away_team_name: string | null;

  home_score: number | null;
  away_score: number | null;

  is_technical?: boolean;
};

// ============================================================
// Helpers
// ============================================================

function normalizeName(name: string | null | undefined): string {
  return (name ?? "").toString().trim();
}

function isTechnicalMatch(m: Match): boolean {
  if (typeof m.is_technical === "boolean") return m.is_technical;

  const h = normalizeName(m.home_team_name);
  const a = normalizeName(m.away_team_name);

  // u Ciebie BYE to "__SYSTEM_BYE__"
  return h.includes("__SYSTEM_BYE__") || a.includes("__SYSTEM_BYE__");
}

function pairKeyByNames(home: string, away: string | null): string {
  const a = normalizeName(home);
  const b = normalizeName(away);
  return a < b ? `${a}||${b}` : `${b}||${a}`;
}

function nextPowerOfTwo(n: number): number {
  if (n <= 1) return 1;
  return 2 ** Math.ceil(Math.log2(n));
}

// teams=2 => finał, teams=4 => półfinał, teams=16 => 1/8 finału
function knockoutRoundLabelFromTeams(teams: number): string {
  if (teams <= 2) return "Finał";
  if (teams === 4) return "Półfinał";
  if (teams === 8) return "Ćwierćfinał";
  return `1/${teams / 2} finału`;
}

function stageKey(m: Match): string {
  // klucz MUSI rozróżniać etapy KO; round_number się do tego nie nadaje
  if (typeof m.stage_id === "number") return `sid:${m.stage_id}`;
  if (typeof m.stage_order === "number") return `ord:${m.stage_order}`;
  // ostateczny fallback (będzie sklejał etapy KO, jeśli API nie daje stage_id/order)
  return `fallback:${m.stage_type}:${m.round_number ?? 0}`;
}

function stageSortValue(matchesInStage: Match[]): number {
  // sortuj po stage_order jeśli jest, potem po stage_id, na końcu 0
  const m0 = matchesInStage[0];
  if (typeof m0?.stage_order === "number") return m0.stage_order;
  if (typeof m0?.stage_id === "number") return m0.stage_id;
  return 0;
}

type PairGroup = {
  key: string;
  teams: [string, string];
  matches: Match[]; // 1 (single) albo 2 (dwumecz)
};

function extractTeamsFromPair(pairMatches: Match[]): [string, string] {
  const names = new Set<string>();
  for (const m of pairMatches) {
    names.add(normalizeName(m.home_team_name));
    names.add(normalizeName(m.away_team_name));
  }
  const arr = Array.from(names).filter((x) => x.length > 0);
  const a = arr[0] ?? "—";
  const b = arr[1] ?? "—";
  return a < b ? [a, b] : [b, a];
}

function inferCupMatchesFromStage(pairs: PairGroup[]): 1 | 2 {
  // jeżeli jakakolwiek para ma 2 mecze, to traktujemy etap jako dwumecz
  return pairs.some((p) => p.matches.length >= 2) ? 2 : 1;
}

function canComputeAggregate(pair: PairGroup): boolean {
  return (
    pair.matches.length === 2 &&
    pair.matches.every((m) => m.home_score !== null && m.away_score !== null)
  );
}

function aggregateScore(pair: PairGroup): Record<string, number> {
  const sum: Record<string, number> = {};
  for (const m of pair.matches) {
    const h = normalizeName(m.home_team_name);
    const a = normalizeName(m.away_team_name);
    sum[h] = (sum[h] ?? 0) + (m.home_score ?? 0);
    sum[a] = (sum[a] ?? 0) + (m.away_score ?? 0);
  }
  return sum;
}

function computePairWinnerLoser(pair: PairGroup): { winner: string; loser: string } | null {
  // single
  if (pair.matches.length === 1) {
    const m = pair.matches[0];
    if (m.home_score === null || m.away_score === null) return null;
    if (m.home_score === m.away_score) return null;

    const winner = m.home_score > m.away_score ? normalizeName(m.home_team_name) : normalizeName(m.away_team_name);
    const loser = m.home_score > m.away_score ? normalizeName(m.away_team_name) : normalizeName(m.home_team_name);

    if (!winner || !loser) return null;
    return { winner, loser };
  }

  // two legs
  if (pair.matches.length === 2) {
    if (!canComputeAggregate(pair)) return null;

    const sum = aggregateScore(pair);
    const [t1, t2] = pair.teams;
    const g1 = sum[t1] ?? 0;
    const g2 = sum[t2] ?? 0;
    if (g1 === g2) return null;

    return g1 > g2 ? { winner: t1, loser: t2 } : { winner: t2, loser: t1 };
  }

  return null;
}

// ============================================================
// Komponent
// ============================================================

export default function TournamentMatches() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [tournament, setTournament] = useState<TournamentDTO | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showTechnical, setShowTechnical] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTournament = async () => {
    if (!id) return;
    const res = await apiFetch(`/api/tournaments/${id}/`);
    if (!res.ok) return; // nie blokuj strony, jeśli endpoint nie daje participants_count
    const data: TournamentDTO = await res.json();
    setTournament(data);
  };

  const loadMatches = async () => {
    if (!id) return;

    const res = await apiFetch(`/api/tournaments/${id}/matches/`);
    if (!res.ok) throw new Error("Nie udało się pobrać meczów.");

    const data: Match[] = await res.json();
    setMatches(data);
  };

  useEffect(() => {
    if (!id) return;

    setLoading(true);
    setError(null);

    Promise.all([loadTournament().catch(() => null), loadMatches()])
      .catch((err: any) => setError(err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const generateMatches = async () => {
    if (!id || busy) return;

    try {
      setBusy(true);
      setError(null);

      const res = await apiFetch(`/api/tournaments/${id}/generate/`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail || "Nie udało się wygenerować rozgrywek.");
      }

      await loadMatches();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  // ============================================================
  // Grupowanie po etapach (stage_id / stage_order)
  // ============================================================

  const stages = useMemo(() => {
    const map = new Map<string, Match[]>();

    for (const m of matches) {
      const key = stageKey(m);
      const arr = map.get(key) ?? [];
      arr.push(m);
      map.set(key, arr);
    }

    const entries = Array.from(map.entries()).map(([key, ms]) => {
      ms.sort((a, b) => a.id - b.id);
      const stageType = ms[0]?.stage_type ?? "LEAGUE";
      const sortVal = stageSortValue(ms);
      return { key, matches: ms, stageType, sortVal };
    });

    entries.sort((a, b) => a.sortVal - b.sortVal || a.key.localeCompare(b.key));
    return entries;
  }, [matches]);

  // indeks KO tylko wśród etapów KO
  const koIndexByStageKey = useMemo(() => {
    const map = new Map<string, number>();
    let i = 0;
    for (const s of stages) {
      if (s.stageType === "KNOCKOUT") {
        i += 1;
        map.set(s.key, i);
      }
    }
    return map;
  }, [stages]);

  // ============================================================
  // Render
  // ============================================================

  if (loading) return <p>Ładowanie…</p>;
  if (error) return <p style={{ color: "crimson" }}>{error}</p>;

  if (!matches.length) {
    return (
      <div style={{ padding: "2rem" }}>
        <h1>Mecze turnieju</h1>
        <p>Brak wygenerowanych meczów.</p>

        <div style={{ marginTop: "1.5rem", display: "flex", gap: "1rem" }}>
          <button onClick={() => navigate(-1)}>← Wróć</button>
          <button onClick={generateMatches} disabled={busy}>
            {busy ? "Generowanie…" : "Generuj rozgrywki"}
          </button>
        </div>
      </div>
    );
  }

  const participantsCount = tournament?.participants_count;

  return (
    <div style={{ padding: "2rem", maxWidth: 900 }}>
      <h1>Mecze turnieju</h1>

      <div style={{ margin: "0.5rem 0 1.5rem", opacity: 0.85 }}>
        <label style={{ display: "inline-flex", gap: "0.5rem", alignItems: "center" }}>
          <input type="checkbox" checked={showTechnical} onChange={(e) => setShowTechnical(e.target.checked)} />
          Pokaż mecze techniczne (BYE)
        </label>

        {/* Informacja diagnostyczna, gdy API nie daje stage_id/order */}
        {matches.some((m) => typeof m.stage_id !== "number" && typeof m.stage_order !== "number") && (
          <div style={{ marginTop: "0.5rem", opacity: 0.75 }}>
            Uwaga: API nie zwraca stage_id ani stage_order dla części meczów. Rundy KO mogą się zlewać w jedną sekcję.
          </div>
        )}
      </div>

      {stages.map((stage, idx) => {
        const stageMatchesAll = stage.matches;

        // widoczne (BYE ukryte, jeśli showTechnical=false)
        const stageMatchesVisible = showTechnical ? stageMatchesAll : stageMatchesAll.filter((m) => !isTechnicalMatch(m));

        // grupowanie w pary (ignorujemy BYE do par)
        const nonTech = stageMatchesAll.filter((m) => !isTechnicalMatch(m));
        const pairMap = new Map<string, Match[]>();
        for (const m of nonTech) {
          const k = pairKeyByNames(m.home_team_name, m.away_team_name);
          const arr = pairMap.get(k) ?? [];
          arr.push(m);
          pairMap.set(k, arr);
        }

        const pairs: PairGroup[] = Array.from(pairMap.entries()).map(([k, ms]) => {
          ms.sort((a, b) => a.id - b.id);
          return { key: k, teams: extractTeamsFromPair(ms), matches: ms };
        });

        const pairsCount = pairs.length;
        const inferredCup = inferCupMatchesFromStage(pairs);

        // ---------
        // Tytuł etapu
        // ---------
        let title = `Etap ${idx + 1}`;

        if (stage.stageType === "LEAGUE") {
          title = `Liga — etap ${idx + 1}`;
        }

        if (stage.stageType === "KNOCKOUT") {
          const koIndex = koIndexByStageKey.get(stage.key) ?? 1;

          if (typeof participantsCount === "number" && participantsCount >= 2) {
            const bracket = nextPowerOfTwo(participantsCount);
            const teamsInRound = Math.max(2, Math.floor(bracket / 2 ** (koIndex - 1)));
            title = knockoutRoundLabelFromTeams(teamsInRound);

            // finał + 3 miejsce w jednym etapie (2 pary)
            if (teamsInRound === 2 && pairsCount === 2) {
              title = "Finał (oraz mecz o 3. miejsce)";
            }
          } else {
            // fallback, gdy nie mamy participants_count
            const teamsGuess = Math.max(2, pairsCount * 2);
            title = knockoutRoundLabelFromTeams(nextPowerOfTwo(teamsGuess));
          }
        }

        // ---------
        // Specjalny przypadek: finał + 3 miejsce w jednym etapie
        // ---------
        const shouldSplitFinalAndThird =
          stage.stageType === "KNOCKOUT" &&
          typeof participantsCount === "number" &&
          (koIndexByStageKey.get(stage.key) ?? 1) >= 1 &&
          pairsCount === 2 &&
          (() => {
            const koIndex = koIndexByStageKey.get(stage.key) ?? 1;
            const bracket = nextPowerOfTwo(participantsCount);
            const teamsInRound = Math.max(2, Math.floor(bracket / 2 ** (koIndex - 1)));
            return teamsInRound === 2;
          })();

        let finalPairs: PairGroup[] = pairs;
        let thirdPairs: PairGroup[] = [];

        if (shouldSplitFinalAndThird) {
          const koIndex = koIndexByStageKey.get(stage.key) ?? 1;
          const prevKoStage = stages
            .filter((s) => s.stageType === "KNOCKOUT")
            .find((s) => (koIndexByStageKey.get(s.key) ?? 0) === koIndex - 1);

          if (prevKoStage) {
            const prevNonTech = prevKoStage.matches.filter((m) => !isTechnicalMatch(m));
            const prevPairMap = new Map<string, Match[]>();
            for (const m of prevNonTech) {
              const k = pairKeyByNames(m.home_team_name, m.away_team_name);
              const arr = prevPairMap.get(k) ?? [];
              arr.push(m);
              prevPairMap.set(k, arr);
            }

            const prevPairs: PairGroup[] = Array.from(prevPairMap.entries()).map(([k, ms]) => {
              ms.sort((a, b) => a.id - b.id);
              return { key: k, teams: extractTeamsFromPair(ms), matches: ms };
            });

            const winners = new Set<string>();
            const losers = new Set<string>();

            for (const p of prevPairs) {
              const res = computePairWinnerLoser(p);
              if (res) {
                winners.add(res.winner);
                losers.add(res.loser);
              }
            }

            // klasyfikacja par: finał = dwie drużyny z "winners", 3 miejsce = dwie z "losers"
            const finals: PairGroup[] = [];
            const thirds: PairGroup[] = [];

            for (const p of pairs) {
              const [a, b] = p.teams;
              const inWinners = winners.has(a) && winners.has(b);
              const inLosers = losers.has(a) && losers.has(b);

              if (inWinners) finals.push(p);
              else if (inLosers) thirds.push(p);
            }

            // fallback, jeśli nie udało się ustalić (np. brak wyników)
            if (finals.length === 1 && thirds.length === 1) {
              finalPairs = finals;
              thirdPairs = thirds;
            } else {
              const sorted = [...pairs].sort((p1, p2) => (p1.matches[0]?.id ?? 0) - (p2.matches[0]?.id ?? 0));
              finalPairs = [sorted[0]];
              thirdPairs = [sorted[1]];
            }
          } else {
            const sorted = [...pairs].sort((p1, p2) => (p1.matches[0]?.id ?? 0) - (p2.matches[0]?.id ?? 0));
            finalPairs = [sorted[0]];
            thirdPairs = [sorted[1]];
          }
        }

        const renderPair = (pair: PairGroup) => {
          const [t1, t2] = pair.teams;

          const legs = pair.matches.slice().sort((a, b) => a.id - b.id);

          const has2 = legs.length >= 2;
          const showAggregate = has2 && canComputeAggregate(pair);

          let aggLine: string | null = null;
          if (showAggregate) {
            const sum = aggregateScore(pair);
            const g1 = sum[t1] ?? 0;
            const g2 = sum[t2] ?? 0;
            aggLine = `Suma: ${t1} ${g1} : ${g2} ${t2}`;
          }

          return (
            <div
              key={pair.key}
              style={{
                padding: "0.75rem 0",
                borderBottom: "1px solid #333",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                <strong>
                  {t1} vs {t2}
                </strong>
                <div style={{ opacity: 0.75 }}>{has2 ? "Dwumecz" : "Mecz"}</div>
              </div>

              <div style={{ marginTop: "0.5rem" }}>
                {legs.map((m, i) => (
                  <div
                    key={m.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto 1fr",
                      alignItems: "center",
                      padding: "0.35rem 0",
                      opacity: 0.92,
                    }}
                  >
                    <span style={{ textAlign: "right" }}>{normalizeName(m.home_team_name)}</span>
                    <span style={{ padding: "0 1rem", opacity: 0.9 }}>
                      {m.home_score ?? "-"} : {m.away_score ?? "-"}
                      {has2 ? ` (mecz ${i + 1})` : ""}
                    </span>
                    <span style={{ textAlign: "left" }}>{normalizeName(m.away_team_name) || "-"}</span>
                  </div>
                ))}

                {aggLine && <div style={{ marginTop: "0.35rem", opacity: 0.8 }}>{aggLine}</div>}
              </div>
            </div>
          );
        };

        return (
          <section key={stage.key} style={{ marginBottom: "2rem" }}>
            <h2>{title}</h2>

            {!stageMatchesVisible.length ? (
              <p style={{ opacity: 0.75 }}>Brak meczów do wyświetlenia w tym etapie.</p>
            ) : stage.stageType !== "KNOCKOUT" ? (
              stageMatchesVisible.map((match) => (
                <div
                  key={match.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto 1fr",
                    alignItems: "center",
                    padding: "0.5rem 0",
                    borderBottom: "1px solid #333",
                  }}
                >
                  <strong style={{ textAlign: "right" }}>{match.home_team_name}</strong>
                  <span style={{ padding: "0 1rem", opacity: 0.85 }}>
                    {match.home_score ?? "-"} : {match.away_score ?? "-"}
                  </span>
                  <strong style={{ textAlign: "left" }}>{match.away_team_name ?? "-"}</strong>
                </div>
              ))
            ) : (
              <>
                {shouldSplitFinalAndThird ? (
                  <>
                    <h3 style={{ marginTop: "0.75rem" }}>Finał</h3>
                    {finalPairs.map(renderPair)}

                    <h3 style={{ marginTop: "1rem" }}>Mecz o 3. miejsce</h3>
                    {thirdPairs.map(renderPair)}
                  </>
                ) : (
                  pairs.map(renderPair)
                )}

                {/* BYE (opcjonalnie) */}
                {showTechnical && stageMatchesAll.some((m) => isTechnicalMatch(m)) && (
                  <div style={{ marginTop: "1rem", opacity: 0.8 }}>
                    <h3>Mecze techniczne (BYE)</h3>
                    {stageMatchesAll
                      .filter((m) => isTechnicalMatch(m))
                      .map((m) => (
                        <div key={m.id} style={{ padding: "0.35rem 0" }}>
                          {normalizeName(m.home_team_name)} vs {normalizeName(m.away_team_name) || "—"} —{" "}
                          {m.home_score ?? "-"} : {m.away_score ?? "-"}
                        </div>
                      ))}
                  </div>
                )}
              </>
            )}
          </section>
        );
      })}

      <div style={{ marginTop: "2rem", display: "flex", gap: "1rem" }}>
        <button onClick={() => navigate(-1)}>← Wróć</button>
        <button onClick={() => navigate(`/tournaments/${id}/results`)}>Wprowadź wyniki →</button>
        <button onClick={() => navigate(`/tournaments/${id}/schedule`)}>Harmonogram (opcjonalnie) →</button>
      </div>
    </div>
  );
}
