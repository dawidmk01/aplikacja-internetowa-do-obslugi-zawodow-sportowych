import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../api";

/* ============================================================
   TYPES
   ============================================================ */

export type MatchStageType = "LEAGUE" | "KNOCKOUT" | "GROUP" | "THIRD_PLACE";
export type MatchStatus = "SCHEDULED" | "IN_PROGRESS" | "FINISHED";

export type TournamentDTO = {
  id: number;
  name?: string;
  discipline: string;
  tournament_format?: "LEAGUE" | "CUP" | "MIXED";
  participants_count?: number;
  status: "DRAFT" | "CONFIGURED" | "RUNNING" | "FINISHED";
  format_config?: {
    cup_matches?: number;
    cup_matches_by_stage_order?: Record<string, number>;
  };
};

export type MatchDTO = {
  id: number;
  stage_id: number;
  stage_order: number;
  stage_type: MatchStageType;
  group_name?: string | null;
  status: MatchStatus;
  round_number: number | null;
  home_team_name: string;
  away_team_name: string;
  home_score: number;
  away_score: number;
};

/* ============================================================
   UTILS & HELPERS
   ============================================================ */

export function isByeName(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = name.trim().toUpperCase();
  return (
    n === "BYE" ||
    n.includes("SYSTEM_BYE") ||
    n === "__SYSTEM_BYE__" ||
    n.includes("__SYSTEM_BYE__")
  );
}

export function isByeMatch(m: MatchDTO): boolean {
  return isByeName(m.home_team_name) || isByeName(m.away_team_name);
}

/* --- GROUPING HELPERS --- */

function displayGroupName(originalName: string, index: number): string {
  if (originalName && originalName.length <= 2 && originalName !== "—") return `Grupa ${originalName}`;
  const letter = String.fromCharCode(65 + index); // 65 = 'A'
  return `Grupa ${letter}`;
}

function groupMatchesByGroup(matches: MatchDTO[]) {
  const map = new Map<string, MatchDTO[]>();
  for (const m of matches) {
    const key = m.group_name ?? "—";
    const arr = map.get(key) ?? [];
    arr.push(m);
    map.set(key, arr);
  }
  return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

function groupMatchesByRound(matches: MatchDTO[]) {
  const map = new Map<number, MatchDTO[]>();
  for (const m of matches) {
    const round = m.round_number ?? 0;
    const arr = map.get(round) ?? [];
    arr.push(m);
    map.set(round, arr);
  }
  return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
}

/* --- KO LABELS (Oparte na liczbie drużyn) --- */

// ✅ NOWA FUNKCJA: Liczy unikalne drużyny w etapie
function countUniqueTeams(matches: MatchDTO[]): number {
  const teams = new Set<string>();
  for (const m of matches) {
    // Jeśli nie chcesz wliczać BYE (walkowerów systemowych), odkomentuj:
    // if (isByeMatch(m)) continue;

    if (m.home_team_name) teams.add(m.home_team_name);
    if (m.away_team_name) teams.add(m.away_team_name);
  }
  return teams.size;
}

// ✅ NOWA FUNKCJA: Zwraca nazwę na podstawie liczby drużyn
function resolveKoTitle(matches: MatchDTO[]): string {
    const teamCount = countUniqueTeams(matches);

    // Logika:
    // 16 drużyn -> 1/8 finału
    // 8 drużyn  -> Ćwierćfinał
    // 4 drużyny -> Półfinał
    // 2 drużyny -> Finał

    if (teamCount > 8 && teamCount <= 16) return "1/8 finału";
    if (teamCount > 4 && teamCount <= 8) return "Ćwierćfinał";
    if (teamCount > 2 && teamCount <= 4) return "Półfinał";
    if (teamCount === 2) return "Finał";

    // Fallback dla dużych turniejów lub nietypowych liczb (np. przez BYE)
    if (teamCount > 16) return `1/${Math.floor(teamCount / 2)} finału`;

    return "Faza pucharowa";
}


/* --- SCORE & CONFIG --- */

export function scoreToInputValue(score: number): string {
  return String(score);
}

export function inputValueToScore(v: string): number {
  const s = v.trim();
  if (s === "") return 0;
  if (!/^\d+$/.test(s)) return 0;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

export function getCupMatchesForStage(
  tournament: TournamentDTO | null,
  stageOrder: number
): 1 | 2 {
  const cfg = tournament?.format_config;
  const perStage = cfg?.cup_matches_by_stage_order?.[String(stageOrder)];
  if (perStage === 1 || perStage === 2) return perStage;
  const global = cfg?.cup_matches;
  if (global === 1 || global === 2) return global;
  return 1;
}

export function isKnockoutLike(stageType: MatchStageType): boolean {
  return stageType === "KNOCKOUT" || stageType === "THIRD_PLACE";
}

export function canFinishMatchUI(args: {
  stageType: MatchStageType;
  cupMatches: 1 | 2;
  homeScore: number;
  awayScore: number;
}): { ok: boolean; message?: string } {
  const { stageType, cupMatches, homeScore, awayScore } = args;

  if (!isKnockoutLike(stageType)) return { ok: true };

  if (cupMatches === 1 && homeScore === awayScore) {
    return {
      ok: false,
      message: "Mecz pucharowy (1 mecz) nie może zakończyć się remisem.",
    };
  }
  return { ok: true };
}

/* --- GROUPING MAIN --- */

export function groupVisibleMatchesByStage(
  matches: MatchDTO[]
): Array<[number, MatchDTO[]]> {
  // Filtrujemy BYE z widoku, chyba że chcesz je widzieć
  const visible = matches.filter((m) => !isByeMatch(m));

  const map = new Map<number, MatchDTO[]>();
  for (const m of visible) {
    const arr = map.get(m.stage_id) ?? [];
    arr.push(m);
    map.set(m.stage_id, arr);
  }

  const entries = Array.from(map.entries()).sort((a, b) => {
    // Sortujemy po stage_order
    const aOrder = a[1][0]?.stage_order ?? 0;
    const bOrder = b[1][0]?.stage_order ?? 0;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a[0] - b[0];
  });

  for (const [, arr] of entries) {
    arr.sort((a, b) => {
      const ra = a.round_number ?? 0;
      const rb = b.round_number ?? 0;
      if (ra !== rb) return ra - rb;
      return a.id - b.id;
    });
  }

  return entries;
}

/* ============================================================
   MAIN COMPONENT
   ============================================================ */

export default function TournamentResults() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [tournament, setTournament] = useState<TournamentDTO | null>(null);
  const [matches, setMatches] = useState<MatchDTO[]>([]);
  const [loading, setLoading] = useState(true);

  const [busyMatchId, setBusyMatchId] = useState<number | null>(null);
  const [busyGenerate, setBusyGenerate] = useState(false);

  const [message, setMessage] = useState<string | null>(null);
  const [edited, setEdited] = useState<Set<number>>(new Set());

  const initialScoreRef = useRef<
    Map<number, { h: number; a: number; stage_type: MatchDTO["stage_type"] }>
  >(new Map());

  /* ============================================================
     API calls
     ============================================================ */
  const loadTournament = async (): Promise<TournamentDTO> => {
    const res = await apiFetch(`/api/tournaments/${id}/`);
    if (!res.ok) throw new Error("Nie udało się pobrać turnieju.");
    const data = await res.json();
    setTournament(data);
    return data;
  };

  const loadMatches = async (): Promise<MatchDTO[]> => {
    const res = await apiFetch(`/api/tournaments/${id}/matches/`);
    if (!res.ok) throw new Error("Nie udało się pobrać meczów.");
    const data = await res.json();
    setMatches(data);
    return data;
  };

  const parseApiError = async (res: Response): Promise<string> => {
    const data = await res.json().catch(() => null);
    if (!data) return "Błąd żądania.";
    if (typeof (data as any)?.detail === "string") return (data as any).detail;
    return "Błąd żądania.";
  };

  const updateMatchScore = async (matchId: number, home: number, away: number) => {
    const res = await apiFetch(`/api/matches/${matchId}/result/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ home_score: home, away_score: away }),
    });
    if (!res.ok) throw new Error(await parseApiError(res));
  };

  const finishMatch = async (matchId: number) => {
    const res = await apiFetch(`/api/matches/${matchId}/finish/`, { method: "POST" });
    if (!res.ok) throw new Error(await parseApiError(res));
  };

  const generateNextStage = async (stageId: number) => {
    if (!id) return;
    setBusyGenerate(true);
    setMessage(null);
    const res = await apiFetch(`/api/stages/${stageId}/confirm/`, { method: "POST" });
    if (!res.ok) {
      setBusyGenerate(false);
      throw new Error(await parseApiError(res));
    }
    await Promise.all([loadMatches(), loadTournament().catch(() => null)]);
    setBusyGenerate(false);
  };

  const advanceFromGroups = async () => {
    if (!id) return;
    setBusyGenerate(true);
    setMessage(null);
    try {
      const res = await apiFetch(`/api/tournaments/${id}/advance-from-groups/`, { method: "POST" });
      if (!res.ok) throw new Error(await parseApiError(res));
      await Promise.all([loadMatches(), loadTournament().catch(() => null)]);
      setMessage("Faza pucharowa wygenerowana.");
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusyGenerate(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    let mounted = true;
    const init = async () => {
      try {
        setMessage(null);
        setLoading(true);
        await Promise.all([loadTournament(), loadMatches()]);
      } catch (e: any) {
        if (mounted) setMessage(e.message);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    init();
    return () => { mounted = false; };
  }, [id]);

  /* ============================================================
     LOGIC & COMPUTED
     ============================================================ */

  const stages = useMemo(() => groupVisibleMatchesByStage(matches), [matches]);

  const lastStageId = useMemo(() => {
    if (!stages.length) return null;
    return stages[stages.length - 1][0];
  }, [stages]);

  const allMatchesInLastStageFinished = useMemo(() => {
    if (!lastStageId) return false;
    const last = stages.find(([sid]) => sid === lastStageId);
    if (!last) return false;
    const [, ms] = last;
    if (!ms.length) return false;
    return ms.every((m) => m.status === "FINISHED");
  }, [stages, lastStageId]);

  function uiStatus(m: MatchDTO) {
    if (m.status === "FINISHED") return "ZAKONCZONY";
    if (m.status === "IN_PROGRESS") return "W_TRAKCIE";
    return "ZAPLANOWANY";
  }

  function uiStatusLabel(s: ReturnType<typeof uiStatus>) {
    if (s === "ZAPLANOWANY") return "Zaplanowany";
    if (s === "W_TRAKCIE") return "W trakcie";
    return "Zakończony";
  }

  const saveOnBlur = async (matchId: number) => {
    const match = matches.find((m) => m.id === matchId);
    if (!match) return;
    try {
      setBusyMatchId(match.id);
      setMessage(null);
      await updateMatchScore(match.id, match.home_score, match.away_score);
      await Promise.all([loadMatches(), loadTournament().catch(() => null)]);
      setEdited((prev) => { const n = new Set(prev); n.add(match.id); return n; });
      setMessage("Wynik zapisany.");
    } catch (e: any) {
      setMessage(e.message);
      await loadMatches().catch(() => null);
    } finally {
      setBusyMatchId(null);
    }
  };

  const onFinishMatchClick = async (matchId: number) => {
    const match = matches.find((m) => m.id === matchId);
    if (!match) return;
    if (match.status === "FINISHED") {
      setMessage("Ten mecz jest już zakończony.");
      return;
    }
    const cupMatches = getCupMatchesForStage(tournament, match.stage_order);
    const verdict = canFinishMatchUI({
      stageType: match.stage_type,
      cupMatches,
      homeScore: match.home_score,
      awayScore: match.away_score,
    });
    if (!verdict.ok) {
      setMessage(verdict.message ?? "Nie można zakończyć meczu.");
      return;
    }
    try {
      setBusyMatchId(match.id);
      setMessage(null);
      await finishMatch(match.id);
      await Promise.all([loadMatches(), loadTournament().catch(() => null)]);
      setMessage("Mecz zakończony.");
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusyMatchId(null);
    }
  };

  // --- RENDER POJEDYNCZEGO MECZU ---
  const renderMatchRow = (match: MatchDTO) => {
    if (isByeMatch(match)) return null;

    const status = uiStatus(match);
    const isBusy = busyMatchId === match.id;
    const wasEdited = edited.has(match.id);
    const isFinished = match.status === "FINISHED";
    const knockoutLike = isKnockoutLike(match.stage_type);
    const cupMatches = getCupMatchesForStage(tournament, match.stage_order);

    const bg = isFinished ? "rgba(30, 144, 255, 0.10)" : wasEdited ? "rgba(46, 204, 113, 0.08)" : "transparent";
    const borderLeft = isFinished ? "4px solid rgba(30,144,255,0.8)" : wasEdited ? "4px solid rgba(46,204,113,0.8)" : "4px solid transparent";

    return (
      <div key={match.id} style={{ borderBottom: "1px solid #333", padding: "1rem 0", background: bg, borderLeft, paddingLeft: "0.75rem", marginBottom: "0.25rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ display: "flex", gap: "1rem", alignItems: "center", minWidth: "250px" }}>
                <strong style={{ textAlign: "right", flex: 1 }}>{match.home_team_name}</strong>
                <span style={{opacity:0.6}}>vs</span>
                <strong style={{ textAlign: "left", flex: 1 }}>{match.away_team_name ?? "—"}</strong>
            </div>
            <div style={{ opacity: 0.6, fontSize: "0.85em" }}>{uiStatusLabel(status)}</div>
        </div>

        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="number"
            min={0}
            value={scoreToInputValue(match.home_score)}
            disabled={isBusy}
            onChange={(e) => {
              const v = inputValueToScore(e.target.value);
              setMatches((prev) => prev.map((m) => m.id === match.id ? { ...m, home_score: v } : m));
            }}
            onBlur={() => saveOnBlur(match.id)}
            style={{ width: 70, textAlign: "center", padding: "0.4rem" }}
          />
          <span style={{fontWeight: "bold"}}>:</span>
          <input
            type="number"
            min={0}
            value={scoreToInputValue(match.away_score)}
            disabled={isBusy}
            onChange={(e) => {
              const v = inputValueToScore(e.target.value);
              setMatches((prev) => prev.map((m) => m.id === match.id ? { ...m, away_score: v } : m));
            }}
            onBlur={() => saveOnBlur(match.id)}
            style={{ width: 70, textAlign: "center", padding: "0.4rem" }}
          />

          <button
            onClick={() => onFinishMatchClick(match.id)}
            disabled={isBusy}
            style={{
              marginLeft: "1rem",
              padding: "0.4rem 0.8rem",
              borderRadius: 4,
              border: "1px solid #555",
              background: isFinished ? "rgba(30,144,255,0.25)" : "rgba(255,255,255,0.05)",
              color: "#fff",
              cursor: "pointer",
              opacity: isBusy ? 0.6 : 1,
              fontSize: "0.85em"
            }}
          >
            {isFinished ? "Mecz zakończony" : "Zakończ mecz"}
          </button>
        </div>
        {knockoutLike && cupMatches === 1 && match.home_score === match.away_score && !isFinished && (
          <div style={{ marginTop: "0.5rem", fontSize: "0.85em", color: "#e74c3c" }}>
            Mecz pucharowy: remis jest niedozwolony.
          </div>
        )}
      </div>
    );
  };

  /* ============================================================
     RENDER
     ============================================================ */

  if (loading) return <p style={{ padding: "2rem" }}>Ładowanie…</p>;
  if (!tournament) return <p style={{ padding: "2rem" }}>Brak danych turnieju.</p>;

  if (!matches.length) {
    return (
      <div style={{ padding: "2rem" }}>
        <h1>Wprowadzanie wyników</h1>
        <p>Brak meczów.</p>
        <button onClick={() => navigate(-1)}>← Wróć</button>
      </div>
    );
  }

  return (
    <div style={{ padding: "2rem", maxWidth: 980 }}>
      <h1>Wprowadzanie wyników</h1>

      <section style={{ opacity: 0.85, marginBottom: "2rem", fontSize: "0.9em", borderLeft: "4px solid #555", paddingLeft: "1rem" }}>
        {tournament.name && <div style={{ marginBottom: "0.25rem" }}><strong>Turniej:</strong> {tournament.name}</div>}
        <div>Wyniki zapisują się automatycznie po opuszczeniu pola (onBlur).</div>
      </section>

      {stages.map(([stageId, stageMatches]) => {
        const stageType = stageMatches[0]?.stage_type;
        // Zamiast polegać na stageOrder, obliczamy tytuł dynamicznie
        let headerTitle = `Etap`;

        if (stageType === "GROUP") {
            headerTitle = "Faza grupowa";
        } else if (stageType === "LEAGUE") {
            headerTitle = "Liga";
        } else if (stageType === "THIRD_PLACE") {
            headerTitle = "Mecz o 3. miejsce";
        } else if (stageType === "KNOCKOUT") {
            // ✅ NOWA LOGIKA: Nazwa na podstawie liczby drużyn
            headerTitle = resolveKoTitle(stageMatches);
        }

        const isLastStage = stageId === lastStageId;
        const canAdvanceFromGroups =
          tournament?.tournament_format === "MIXED" &&
          isLastStage &&
          stageType === "GROUP" &&
          allMatchesInLastStageFinished;

        return (
          <section key={stageId} style={{ marginTop: "3rem", paddingTop: "1rem", borderTop: "1px solid #333" }}>
            <h2 style={{ marginBottom: "1.5rem", color: "#eee" }}>{headerTitle}</h2>

            {stageType === "GROUP" ? (
                 groupMatchesByGroup(stageMatches).map(([groupName, groupMatches], idx) => (
                    <div key={groupName} style={{ marginBottom: "2rem", paddingLeft: "1rem", borderLeft: "2px solid #333" }}>
                        <h3 style={{ color: "#aaa", marginBottom: "1rem" }}>{displayGroupName(groupName, idx)}</h3>
                        {groupMatchesByRound(groupMatches).map(([round, roundMatches]) => (
                             <div key={round} style={{ marginBottom: "1.5rem" }}>
                                <h4 style={{ margin: "0.5rem 0", fontSize: "0.85rem", textTransform: "uppercase", opacity: 0.6, letterSpacing: "1px" }}>
                                    Kolejka {round}
                                </h4>
                                {roundMatches.map(m => renderMatchRow(m))}
                             </div>
                        ))}
                    </div>
                 ))
            ) : stageType === "LEAGUE" ? (
                groupMatchesByRound(stageMatches).map(([round, roundMatches]) => (
                    <div key={round} style={{ marginBottom: "2rem" }}>
                        <h4 style={{ margin: "0.5rem 0", fontSize: "0.9rem", textTransform: "uppercase", opacity: 0.6, letterSpacing: "1px", borderBottom:"1px solid #333", paddingBottom:"0.25rem" }}>
                            Kolejka {round}
                        </h4>
                        {roundMatches.map(m => renderMatchRow(m))}
                    </div>
                ))
            ) : (
                // Puchar (lista)
                <div>
                     {stageMatches.map(m => renderMatchRow(m))}
                </div>
            )}

            <div style={{ marginTop: "1.5rem", padding: "1rem", background: "rgba(255,255,255,0.02)", borderRadius: "8px" }}>
                {canAdvanceFromGroups && (
                <div>
                    <button
                    disabled={busyGenerate}
                    onClick={advanceFromGroups}
                    style={{
                        padding: "0.7rem 1.2rem",
                        borderRadius: 6,
                        border: "1px solid rgba(46, 204, 113, 0.4)",
                        cursor: "pointer",
                        background: "rgba(46, 204, 113, 0.15)",
                        color: "#fff",
                        fontWeight: "bold"
                    }}
                    >
                    {busyGenerate ? "Generowanie..." : "Zakończ fazę grupową i generuj drabinkę"}
                    </button>
                    <p style={{ marginTop: "0.5rem", opacity: 0.65, fontSize: "0.9em" }}>
                    Wszystkie mecze w grupach są zakończone. Możesz przejść do fazy pucharowej.
                    </p>
                </div>
                )}

                {isLastStage && stageType === "KNOCKOUT" && (
                <div>
                    <button
                    disabled={!allMatchesInLastStageFinished || busyGenerate}
                    onClick={() => generateNextStage(stageId).then(() => setMessage("Następny etap wygenerowany.")).catch((e: any) => setMessage(e.message))}
                    style={{
                        padding: "0.7rem 1.2rem",
                        borderRadius: 6,
                        border: "1px solid #444",
                        background: allMatchesInLastStageFinished ? "#2980b9" : "#333",
                        color: "#fff",
                        opacity: allMatchesInLastStageFinished ? 1 : 0.5,
                        cursor: allMatchesInLastStageFinished ? "pointer" : "not-allowed",
                        fontWeight: "bold"
                    }}
                    >
                    {busyGenerate ? "Generowanie…" : "Generuj następny etap"}
                    </button>

                    {!allMatchesInLastStageFinished && (
                    <p style={{ marginTop: "0.5rem", opacity: 0.65, fontSize: "0.9em" }}>
                        Aby wygenerować następny etap, zakończ wszystkie mecze (przycisk „Zakończ mecz”).
                    </p>
                    )}
                </div>
                )}
            </div>
          </section>
        );
      })}

      <div style={{ marginTop: "3rem", display: "flex", gap: "1rem", borderTop: "1px solid #444", paddingTop: "1.5rem" }}>
        <button onClick={() => navigate(-1)} style={{padding: "0.5rem 1rem", cursor:"pointer"}}>← Wróć</button>
        <button onClick={() => navigate(`/tournaments/${id}/standings`)} style={{padding: "0.5rem 1rem", cursor:"pointer"}}>Tabela / drabinka →</button>
        <button onClick={() => navigate(`/tournaments/${id}/schedule`)} style={{padding: "0.5rem 1rem", cursor:"pointer"}}>Harmonogram →</button>
      </div>

      {message && (
        <div style={{
            position: "fixed", bottom: "2rem", right: "2rem",
            background: "#333", color: "#fff", padding: "1rem 2rem",
            borderRadius: "8px", boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
            borderLeft: "5px solid #2ecc71"
        }}>
            {message}
        </div>
      )}
    </div>
  );
}