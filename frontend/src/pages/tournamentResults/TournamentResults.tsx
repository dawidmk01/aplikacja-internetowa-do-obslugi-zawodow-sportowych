import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../../api";

import type { MatchDTO, TournamentDTO } from "./tournamentResults.types";
import {
  getCupMatchesForStage,
  groupVisibleMatchesByStage,
  scoreToInputValue,
  inputValueToScore,
  stageHeaderTitle,
  isByeMatch,
  isKnockoutLike,
  canFinishMatchUI,
} from "./tournamentResults.utils";

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

  const initialScoreRef = useRef<Map<number, { h: number; a: number; stage_type: MatchDTO["stage_type"] }>>(new Map());

  /* ============================================================
     API
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

    const map = new Map<number, { h: number; a: number; stage_type: MatchDTO["stage_type"] }>();
    for (const m of data) map.set(m.id, { h: m.home_score, a: m.away_score, stage_type: m.stage_type });
    initialScoreRef.current = map;

    return data;
  };

  const parseApiError = async (res: Response): Promise<string> => {
    const data = await res.json().catch(() => null);

    if (!data) return "Błąd żądania.";
    if (typeof (data as any)?.detail === "string") return (data as any).detail;

    const firstKey = data && typeof data === "object" ? Object.keys(data)[0] : null;
    if (firstKey && Array.isArray((data as any)[firstKey]) && (data as any)[firstKey][0]) {
      return String((data as any)[firstKey][0]);
    }

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

  /* ============================================================
     INIT
     ============================================================ */

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
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /* ============================================================
     Grupowanie po etapach + filtrowanie BYE
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

  /* ============================================================
     Statusy UI
     ============================================================ */

  function uiStatus(m: MatchDTO): "ZAPLANOWANY" | "W_TRAKCIE" | "ZAKONCZONY" {
    if (m.status === "FINISHED") return "ZAKONCZONY";
    if (m.status === "IN_PROGRESS") return "W_TRAKCIE";
    return "ZAPLANOWANY";
  }

  function uiStatusLabel(s: ReturnType<typeof uiStatus>) {
    if (s === "ZAPLANOWANY") return "Zaplanowany";
    if (s === "W_TRAKCIE") return "W trakcie";
    return "Zakończony";
  }

  /* ============================================================
     Zapis (onBlur)
     ============================================================ */

  const saveOnBlur = async (matchId: number) => {
    const match = matches.find((m) => m.id === matchId);
    if (!match) return;

    try {
      setBusyMatchId(match.id);
      setMessage(null);

      await updateMatchScore(match.id, match.home_score, match.away_score);
      await Promise.all([loadMatches(), loadTournament().catch(() => null)]);

      setEdited((prev) => {
        const n = new Set(prev);
        n.add(match.id);
        return n;
      });

      setMessage("Wynik zapisany.");
    } catch (e: any) {
      setMessage(e.message);
      await loadMatches().catch(() => null);
    } finally {
      setBusyMatchId(null);
    }
  };

  /* ============================================================
     Zakończenie meczu (POST /finish/)
     ============================================================ */

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

  /* ============================================================
     Render
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

  if (!stages.length) {
    return (
      <div style={{ padding: "2rem" }}>
        <h1>Wprowadzanie wyników</h1>
        <p>Brak meczów do wyświetlenia (BYE są ukryte).</p>
        <button onClick={() => navigate(-1)}>← Wróć</button>
      </div>
    );
  }

  return (
    <div style={{ padding: "2rem", maxWidth: 980 }}>
      <h1>Wprowadzanie wyników</h1>

      <section style={{ opacity: 0.85, marginBottom: "1rem" }}>
        {tournament.name && (
          <div>
            <strong>Turniej:</strong> {tournament.name}
          </div>
        )}

        <div style={{ marginTop: "0.25rem" }}>
          Wynik zapisuje się po opuszczeniu pola (onBlur). Wyniki można edytować w dowolnym momencie.
        </div>

        <div style={{ marginTop: "0.25rem" }}>
          „Mecz zakończony” wysyła POST /api/matches/:id/finish/ i ustawia FINISHED w backendzie.
        </div>

        <div style={{ marginTop: "0.25rem" }}>
          KO: przy <code>cup_matches=1</code> remis jest zabroniony. Przy <code>cup_matches=2</code> remis w pojedynczym
          meczu jest dozwolony, ale agregat po 2 meczach musi wyłonić zwycięzcę.
        </div>
      </section>

      {stages.map(([stageId, stageMatches]) => {
        const stageType = stageMatches[0]?.stage_type;
        const stageOrder = stageMatches[0]?.stage_order ?? 1;

        const header = stageHeaderTitle(stageType, stageOrder, tournament);
        const isLastStage = stageId === lastStageId;

        return (
          <section
            key={stageId}
            style={{
              marginTop: "1.25rem",
              paddingTop: "1rem",
              borderTop: "1px solid #333",
            }}
          >
            <h2 style={{ marginBottom: "0.75rem" }}>{header}</h2>

            {stageMatches.map((match) => {
              if (isByeMatch(match)) return null;

              const status = uiStatus(match);
              const isBusy = busyMatchId === match.id;

              const wasEdited = edited.has(match.id);
              const isFinished = match.status === "FINISHED";

              const bg = isFinished
                ? "rgba(30, 144, 255, 0.10)"
                : wasEdited
                ? "rgba(46, 204, 113, 0.08)"
                : "transparent";

              const borderLeft = isFinished
                ? "4px solid rgba(30,144,255,0.8)"
                : wasEdited
                ? "4px solid rgba(46,204,113,0.8)"
                : "4px solid transparent";

              const cupMatches = getCupMatchesForStage(tournament, match.stage_order);
              const knockoutLike = isKnockoutLike(match.stage_type);

              return (
                <div
                  key={match.id}
                  style={{
                    borderBottom: "1px solid #333",
                    padding: "1rem 0",
                    background: bg,
                    borderLeft,
                    paddingLeft: "0.75rem",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
                    <strong>
                      {match.home_team_name} vs {match.away_team_name ?? "—"}
                    </strong>

                    <div style={{ opacity: 0.8 }}>{uiStatusLabel(status)}</div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: "0.5rem",
                      marginTop: "0.5rem",
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <input
                      type="number"
                      min={0}
                      value={scoreToInputValue(match.home_score)}
                      disabled={isBusy}
                      onChange={(e) => {
                        const v = inputValueToScore(e.target.value);
                        setMatches((prev) => prev.map((m) => (m.id === match.id ? { ...m, home_score: v } : m)));
                      }}
                      onBlur={() => saveOnBlur(match.id)}
                      style={{ width: 90 }}
                    />

                    <span>:</span>

                    <input
                      type="number"
                      min={0}
                      value={scoreToInputValue(match.away_score)}
                      disabled={isBusy}
                      onChange={(e) => {
                        const v = inputValueToScore(e.target.value);
                        setMatches((prev) => prev.map((m) => (m.id === match.id ? { ...m, away_score: v } : m)));
                      }}
                      onBlur={() => saveOnBlur(match.id)}
                      style={{ width: 90 }}
                    />

                    {isBusy && <span style={{ opacity: 0.7 }}>Zapisywanie…</span>}

                    <button
                      onClick={() => onFinishMatchClick(match.id)}
                      disabled={isBusy}
                      style={{
                        marginLeft: "0.5rem",
                        padding: "0.45rem 0.75rem",
                        borderRadius: 6,
                        border: "1px solid #444",
                        background: isFinished ? "rgba(30,144,255,0.25)" : "transparent",
                        cursor: "pointer",
                        opacity: isBusy ? 0.6 : 1,
                      }}
                      title="Ustawia status FINISHED w backendzie (POST /api/matches/:id/finish/)."
                    >
                      Mecz zakończony
                    </button>
                  </div>

                  {knockoutLike && cupMatches === 1 && match.home_score === match.away_score && !isFinished && (
                    <div style={{ marginTop: "0.35rem", opacity: 0.7 }}>
                      KO (1 mecz): remis jest zabroniony — aby zakończyć mecz, wynik musi wyłonić zwycięzcę.
                    </div>
                  )}

                  {knockoutLike && cupMatches === 2 && !isFinished && (
                    <div style={{ marginTop: "0.35rem", opacity: 0.7 }}>
                      Dwumecz: remis w tym meczu jest dozwolony. Agregat po 2 meczach musi wyłonić zwycięzcę.
                    </div>
                  )}

                  {isFinished && (
                    <div style={{ marginTop: "0.35rem", opacity: 0.75 }}>
                      Mecz jest zakończony w backendzie. Edycja wyniku nadal możliwa, ale w KO zmiana rozstrzygnięcia może
                      cofnąć kolejne etapy.
                    </div>
                  )}
                </div>
              );
            })}

            {isLastStage && stageType === "KNOCKOUT" && (
              <div style={{ marginTop: "1rem" }}>
                <button
                  disabled={!allMatchesInLastStageFinished || busyGenerate}
                  onClick={() =>
                    generateNextStage(stageId)
                      .then(() => setMessage("Następny etap wygenerowany."))
                      .catch((e: any) => setMessage(e.message))
                  }
                  style={{
                    padding: "0.6rem 1rem",
                    borderRadius: 6,
                    border: "1px solid #444",
                    opacity: allMatchesInLastStageFinished ? 1 : 0.5,
                    cursor: allMatchesInLastStageFinished ? "pointer" : "not-allowed",
                  }}
                >
                  {busyGenerate ? "Generowanie…" : "Generuj następny etap"}
                </button>

                {!allMatchesInLastStageFinished && (
                  <p style={{ marginTop: "0.5rem", opacity: 0.65 }}>
                    Aby wygenerować następny etap, zakończ wszystkie mecze (przycisk „Mecz zakończony”).
                  </p>
                )}
              </div>
            )}
          </section>
        );
      })}

      <div style={{ marginTop: "2rem", display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        <button onClick={() => navigate(-1)}>← Wróć</button>
        <button onClick={() => navigate(`/tournaments/${id}/standings`)}>Tabela / drabinka pucharowa →</button>
        <button onClick={() => navigate(`/tournaments/${id}/schedule`)}>Harmonogram (opcjonalnie) →</button>
      </div>

      {message && <p style={{ marginTop: "1rem", opacity: 0.9 }}>{message}</p>}
    </div>
  );
}
