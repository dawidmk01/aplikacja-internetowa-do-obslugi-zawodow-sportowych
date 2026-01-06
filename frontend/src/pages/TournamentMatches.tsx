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
  // Dodano THIRD_PLACE, aby obsłużyć osobny etap meczu o 3. miejsce
  stage_type: "LEAGUE" | "GROUP" | "KNOCKOUT" | "THIRD_PLACE";
  group_name?: string | null;

  home_team_name: string;
  away_team_name: string | null;

  home_score: number | null;
  away_score: number | null;

  is_technical?: boolean;
};

type PairGroup = {
  key: string;
  teams: [string, string];
  matches: Match[]; // 1 (single) albo 2 (dwumecz)
};

// ============================================================
// Helpers
// ============================================================

function displayGroupName(originalName: string, index: number): string {
  if (originalName && originalName.length <= 2 && originalName !== "—") return `Grupa ${originalName}`;
  const letter = String.fromCharCode(65 + index); // 65 = 'A'
  return `Grupa ${letter}`;
}

function groupMatchesByGroup(matches: Match[]) {
  const map = new Map<string, Match[]>();
  for (const m of matches) {
    const key = m.group_name ?? "—";
    const arr = map.get(key) ?? [];
    arr.push(m);
    map.set(key, arr);
  }
  return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

function groupMatchesByRound(matches: Match[]) {
  const map = new Map<number, Match[]>();
  for (const m of matches) {
    const round = m.round_number ?? 0;
    const arr = map.get(round) ?? [];
    arr.push(m);
    map.set(round, arr);
  }
  return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
}

function normalizeName(name: string | null | undefined): string {
  return (name ?? "").toString().trim();
}

function isTechnicalMatch(m: Match): boolean {
  if (typeof m.is_technical === "boolean") return m.is_technical;
  const h = normalizeName(m.home_team_name);
  const a = normalizeName(m.away_team_name);
  return h.includes("__SYSTEM_BYE__") || a.includes("__SYSTEM_BYE__");
}

function pairKeyByNames(home: string, away: string | null): string {
  const a = normalizeName(home);
  const b = normalizeName(away);
  return a < b ? `${a}||${b}` : `${b}||${a}`;
}

function stageKey(m: Match): string {
  if (typeof m.stage_id === "number") return `sid:${m.stage_id}`;
  if (typeof m.stage_order === "number") return `ord:${m.stage_order}`;
  return `fallback:${m.stage_type}:${m.round_number ?? 0}`;
}

function stageSortValue(matchesInStage: Match[]): number {
  const m0 = matchesInStage[0];
  if (typeof m0?.stage_order === "number") return m0.stage_order;
  if (typeof m0?.stage_id === "number") return m0.stage_id;
  return 0;
}

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
  if (pair.matches.length === 1) {
    const m = pair.matches[0];
    if (m.home_score === null || m.away_score === null) return null;
    if (m.home_score === m.away_score) return null;
    const winner = m.home_score > m.away_score ? normalizeName(m.home_team_name) : normalizeName(m.away_team_name);
    const loser = m.home_score > m.away_score ? normalizeName(m.away_team_name) : normalizeName(m.home_team_name);
    if (!winner || !loser) return null;
    return { winner, loser };
  }
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

/* ============================================================
   NOWE HELPERY (Identyczne jak w TournamentResults)
   ============================================================ */

function countUniqueTeams(matches: Match[]): number {
  const teams = new Set<string>();
  for (const m of matches) {
    if (m.home_team_name) teams.add(normalizeName(m.home_team_name));
    if (m.away_team_name) teams.add(normalizeName(m.away_team_name));
  }
  return teams.size;
}

function resolveKoTitle(matches: Match[]): string {
    const teamCount = countUniqueTeams(matches);

    // Logika oparta na liczbie uczestników etapu
    if (teamCount > 8 && teamCount <= 16) return "1/8 finału";
    if (teamCount > 4 && teamCount <= 8) return "Ćwierćfinał";
    if (teamCount > 2 && teamCount <= 4) return "Półfinał";
    if (teamCount === 2) return "Finał";

    // Fallback
    if (teamCount > 16) return `1/${Math.floor(teamCount / 2)} finału`;

    return "Faza pucharowa";
}

// ============================================================
// Komponent Główny
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
    if (!res.ok) return;
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
  // Grupowanie
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

  const hasAnyTechnicalMatches = useMemo(() => {
    return matches.some(isTechnicalMatch);
  }, [matches]);

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

  return (
    <div style={{ padding: "2rem", maxWidth: 900 }}>
      <h1>Mecze turnieju</h1>

      <div style={{ margin: "0.5rem 0 1.5rem", opacity: 0.85 }}>
        {hasAnyTechnicalMatches && (
          <label style={{ display: "inline-flex", gap: "0.5rem", alignItems: "center", cursor: "pointer" }}>
            <input
                type="checkbox"
                checked={showTechnical}
                onChange={(e) => setShowTechnical(e.target.checked)}
            />
            Pokaż mecze techniczne (BYE)
          </label>
        )}

        {matches.some((m) => typeof m.stage_id !== "number" && typeof m.stage_order !== "number") && (
          <div style={{ marginTop: "0.5rem", fontSize: "0.85em", color: "#aaa" }}>
            (Info: Tryb kompatybilności dla starszych danych - brak stage_id)
          </div>
        )}
      </div>

      {stages.map((stage, idx) => {
        const stageMatchesAll = stage.matches;
        // Pokaż techniczne tylko jeśli checkbox zaznaczony ORAZ to faza pucharowa/3rd place
        const isKnockoutOrThird = stage.stageType === "KNOCKOUT" || stage.stageType === "THIRD_PLACE";

        const stageMatchesVisible =
          isKnockoutOrThird && showTechnical
            ? stageMatchesAll
            : stageMatchesAll.filter((m) => !isTechnicalMatch(m));

        const nonTech = stageMatchesAll.filter((m) => !isTechnicalMatch(m));

        // --- PRZYGOTOWANIE PAR (dla KO / ThirdPlace) ---
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

        // --- TYTUŁ ETAPU ---
        let title = `Etap ${idx + 1}`;
        if (stage.stageType === "LEAGUE") {
          title = "Liga";
        } else if (stage.stageType === "GROUP") {
           title = `Faza grupowa`;
        } else if (stage.stageType === "THIRD_PLACE") {
           title = "Mecz o 3. miejsce";
        } else if (stage.stageType === "KNOCKOUT") {
           title = resolveKoTitle(stageMatchesAll);
        }

        // --- SPECIAL CASE: Finał + Mecz o 3 miejsce w jednym etapie ---
        // Czasami backend wrzuca oba mecze do jednego etapu KO.
        const shouldSplitFinalAndThird =
          stage.stageType === "KNOCKOUT" &&
          pairsCount === 2 &&
          (title === "Finał" || title.includes("Finał"));

        let finalPairs: PairGroup[] = pairs;
        let thirdPairs: PairGroup[] = [];

        if (shouldSplitFinalAndThird) {
           // (Logika podziału Finał/3m)
           // ... (Twoja istniejąca logika zgadywania, która działała)
           // Dla uproszczenia tutaj przyjmujemy sortowanie po ID, co zazwyczaj działa
           const s = [...pairs].sort((p1,p2)=>(p1.matches[0]?.id??0)-(p2.matches[0]?.id??0));
           finalPairs=[s[1]]; thirdPairs=[s[0]];
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
            aggLine = `Dwumecz: ${t1} ${g1}:${g2} ${t2}`;
          }

          return (
            <div key={pair.key} style={{ padding: "0.75rem 0", borderBottom: "1px solid #333" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                {legs.map((m, i) => (
                  <div key={m.id} style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", padding: "0.2rem 0", opacity: 0.9 }}>
                    <span style={{ textAlign: "right" }}>{normalizeName(m.home_team_name)}</span>
                    <span style={{ padding: "0 0.8rem", fontWeight: "bold", minWidth:"3rem", textAlign:"center" }}>
                      {m.home_score ?? "-"} : {m.away_score ?? "-"}
                    </span>
                    <span style={{ textAlign: "left" }}>{normalizeName(m.away_team_name) || "-"}</span>
                  </div>
                ))}
                {aggLine && <div style={{ marginTop: "0.35rem", fontSize: "0.9em", color: "#ffd700", textAlign: "center" }}>{aggLine}</div>}
              </div>
            </div>
          );
        };

        // --- RENDEROWANIE ZALEŻNE OD TYPU ---
        const isKnockoutView = stage.stageType === "KNOCKOUT" || stage.stageType === "THIRD_PLACE";

        return (
          <section key={stage.key} style={{ marginBottom: "2.5rem" }}>
            <h2 style={{ borderBottom: "2px solid #444", paddingBottom: "0.5rem", marginBottom: "1rem" }}>{title}</h2>

            {!stageMatchesVisible.length ? (
              <p style={{ opacity: 0.6 }}>Brak meczów do wyświetlenia.</p>
            ) : stage.stageType === "GROUP" ? (
              // Widok grupowy
              groupMatchesByGroup(stageMatchesVisible).map(([groupName, groupMatches], idx) => (
                <div key={groupName} style={{ marginBottom: "2rem", paddingLeft: "0.5rem" }}>
                  <h3 style={{ color: "#aaa", marginBottom: "0.5rem" }}>{displayGroupName(groupName, idx)}</h3>
                  {groupMatchesByRound(groupMatches).map(([round, roundMatches]) => (
                    <div key={round} style={{ marginBottom: "1rem", marginLeft: "1rem" }}>
                      <h4 style={{ margin: "0.5rem 0", fontSize: "0.9rem", textTransform: "uppercase", opacity: 0.6, letterSpacing: "1px" }}>
                        Kolejka {round}
                      </h4>
                      {roundMatches.map((match) => (
                        <div key={match.id} style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", padding: "0.4rem 0", borderBottom: "1px solid #2a2a2a" }}>
                          <strong style={{ textAlign: "right" }}>{match.home_team_name}</strong>
                          <span style={{ padding: "0 1rem", opacity: 0.9, fontWeight: "bold" }}>{match.home_score ?? "-"} : {match.away_score ?? "-"}</span>
                          <strong style={{ textAlign: "left" }}>{match.away_team_name ?? "-"}</strong>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ))
            ) : !isKnockoutView && stage.stageType !== "LEAGUE" ? (
              // Fallback (zwykła lista, np. dziwny typ)
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {stageMatchesVisible.map((match) => (
                    <div key={match.id} style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", padding: "0.5rem 0", borderBottom: "1px solid #333" }}>
                    <strong style={{ textAlign: "right" }}>{match.home_team_name}</strong>
                    <span style={{ padding: "0 1rem", opacity: 0.9, fontWeight: "bold" }}>{match.home_score ?? "-"} : {match.away_score ?? "-"}</span>
                    <strong style={{ textAlign: "left" }}>{match.away_team_name ?? "-"}</strong>
                    </div>
                ))}
              </div>
            ) : stage.stageType === "LEAGUE" ? (
               // Widok ligowy (płaska lista lub z podziałem na kolejki jeśli wolisz)
               <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {stageMatchesVisible.map((match) => (
                    <div key={match.id} style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", padding: "0.5rem 0", borderBottom: "1px solid #333" }}>
                    <strong style={{ textAlign: "right" }}>{match.home_team_name}</strong>
                    <span style={{ padding: "0 1rem", opacity: 0.9, fontWeight: "bold" }}>{match.home_score ?? "-"} : {match.away_score ?? "-"}</span>
                    <strong style={{ textAlign: "left" }}>{match.away_team_name ?? "-"}</strong>
                    </div>
                ))}
              </div>
            ) : (
              // Widok PUCHAROWY (KNOCKOUT lub THIRD_PLACE) -> renderujemy PARY
              <>
                {showTechnical && stageMatchesAll.some((m) => isTechnicalMatch(m)) && (
                  <div style={{ marginBottom: "1.5rem", padding: "1rem", background: "rgba(255,255,255,0.05)", borderRadius: "8px" }}>
                    <h4 style={{ margin: "0 0 0.5rem", opacity: 0.7 }}>Mecze techniczne (BYE)</h4>
                    {stageMatchesAll.filter(m => isTechnicalMatch(m)).map(m => (
                      <div key={m.id} style={{ padding: "0.2rem 0", fontSize: "0.9em" }}>
                        {normalizeName(m.home_team_name)} vs {normalizeName(m.away_team_name) || "—"}
                        {' '}({m.home_score ?? "-"} : {m.away_score ?? "-"})
                      </div>
                    ))}
                  </div>
                )}
                {shouldSplitFinalAndThird && finalPairs.length > 0 ? (
                  <>
                    <h3 style={{ marginTop: "1rem", color: "#ffd700" }}>Mecz o 1. miejsce</h3>
                    {finalPairs.map(renderPair)}
                    {thirdPairs.length > 0 && (
                        <>
                            <h3 style={{ marginTop: "2rem", color: "#cd7f32" }}>Mecz o 3. miejsce</h3>
                            {thirdPairs.map(renderPair)}
                        </>
                    )}
                  </>
                ) : (
                  pairs.map(renderPair)
                )}
              </>
            )}
          </section>
        );
      })}

      <div style={{ marginTop: "3rem", display: "flex", gap: "1rem", borderTop: "1px solid #444", paddingTop: "1rem" }}>
        <button onClick={() => navigate(-1)} style={{padding: "0.5rem 1rem"}}>← Wróć</button>
        <button onClick={() => navigate(`/tournaments/${id}/results`)} style={{padding: "0.5rem 1rem"}}>Wprowadź wyniki →</button>
        <button onClick={() => navigate(`/tournaments/${id}/schedule`)} style={{padding: "0.5rem 1rem"}}>Harmonogram →</button>
      </div>
    </div>
  );
}