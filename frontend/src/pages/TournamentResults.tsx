import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../api";

/* ============================================================
   Typy API
   ============================================================ */

type TournamentDTO = {
  id: number;
  name?: string;
  discipline: string;
  tournament_format?: "LEAGUE" | "CUP" | "MIXED";
  participants_count?: number;
  status: "DRAFT" | "CONFIGURED" | "RUNNING" | "FINISHED";
};

type MatchDTO = {
  id: number;

  stage_id: number;
  stage_order: number; // <-- ważne: sort etapów po order, nie po ID
  stage_type: "LEAGUE" | "KNOCKOUT" | "GROUP";

  status: "SCHEDULED" | "IN_PROGRESS" | "FINISHED"; // <-- brakowało IN_PROGRESS
  round_number: number | null;

  home_team_name: string;
  away_team_name: string;

  home_score: number;
  away_score: number;
};

/* ============================================================
   Helpers (BYE + KO nazwy)
   ============================================================ */

function isByeName(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = name.trim().toUpperCase();
  return (
    n === "BYE" ||
    n.includes("SYSTEM_BYE") ||
    n === "__SYSTEM_BYE__" ||
    n.includes("__SYSTEM_BYE__")
  );
}

function isByeMatch(m: MatchDTO): boolean {
  return isByeName(m.home_team_name) || isByeName(m.away_team_name);
}

function nextPowerOfTwo(n: number): number {
  if (n <= 1) return 1;
  return 2 ** Math.ceil(Math.log2(n));
}

function knockoutRoundLabelFromTeams(teams: number): string {
  if (teams === 2) return "Finał";
  if (teams === 4) return "Półfinał";
  if (teams === 8) return "Ćwierćfinał";
  return `1/${teams / 2} finału`;
}

function knockoutStageTitle(
  stageMatchesAll: MatchDTO[],
  stageIndex1Based: number,
  tournamentParticipantsCount?: number
): string {
  // Nazwa rundy ma wynikać z rozmiaru drabinki (BYE nie zaburza)
  if (stageIndex1Based === 1 && typeof tournamentParticipantsCount === "number") {
    const bracket = nextPowerOfTwo(tournamentParticipantsCount);
    return knockoutRoundLabelFromTeams(bracket);
  }

  // fallback – z liczby spotkań (bezpieczne jeśli brak BYE)
  const nonBye = stageMatchesAll.filter((m) => !isByeMatch(m));
  const teams = Math.max(2, nonBye.length * 2);
  const bracketGuess = nextPowerOfTwo(teams);
  return knockoutRoundLabelFromTeams(bracketGuess);
}

function stageHeaderTitle(
  stageType: MatchDTO["stage_type"],
  stageMatchesAll: MatchDTO[],
  stageIndex1Based: number,
  tournament: TournamentDTO
): string {
  if (stageType === "KNOCKOUT") {
    return `Puchar: ${knockoutStageTitle(
      stageMatchesAll,
      stageIndex1Based,
      tournament.participants_count
    )}`;
  }
  if (stageType === "GROUP") return `Faza grupowa — etap ${stageIndex1Based}`;
  return `Liga — etap ${stageIndex1Based}`;
}

function scoreToInputValue(score: number): string {
  return String(score);
}

function inputValueToScore(v: string): number {
  const s = v.trim();
  if (s === "") return 0; // backend i tak trzyma liczby (default=0)
  if (!/^\d+$/.test(s)) return 0;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function decideWinnerSide(
  stageType: MatchDTO["stage_type"],
  h: number,
  a: number
): "HOME" | "AWAY" | "DRAW" {
  if (h === a) return "DRAW";
  return h > a ? "HOME" : "AWAY";
}

/* ============================================================
   Komponent
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

  // UI: które mecze były realnie zapisane (edytowane) w tej sesji
  const [edited, setEdited] = useState<Set<number>>(new Set());

  // snapshot wyników z serwera – do wykrycia czy zmiana zmieni zwycięzcę
  const initialScoreRef = useRef<
    Map<number, { h: number; a: number; stage_type: MatchDTO["stage_type"] }>
  >(new Map());

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

    // snapshot do rollback-ostrzeżeń
    const map = new Map<number, { h: number; a: number; stage_type: MatchDTO["stage_type"] }>();
    for (const m of data) map.set(m.id, { h: m.home_score, a: m.away_score, stage_type: m.stage_type });
    initialScoreRef.current = map;

    return data;
  };

  const parseApiError = async (res: Response): Promise<string> => {
    const data = await res.json().catch(() => null);

    if (!data) return "Błąd żądania.";
    if (typeof data?.detail === "string") return data.detail;

    // serializer errors: {field: ["msg", ...]}
    const firstKey = data && typeof data === "object" ? Object.keys(data)[0] : null;
    if (firstKey && Array.isArray(data[firstKey]) && data[firstKey][0]) {
      return String(data[firstKey][0]);
    }

    return "Błąd żądania.";
  };

  const updateMatchScore = async (matchId: number, home: number, away: number) => {
    const res = await apiFetch(`/api/matches/${matchId}/result/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ home_score: home, away_score: away }),
    });

    if (!res.ok) {
      throw new Error(await parseApiError(res));
    }
  };

  // To jest KLUCZ do zmiany statusu na FINISHED
  const finishMatch = async (matchId: number) => {
    const res = await apiFetch(`/api/matches/${matchId}/finish/`, { method: "POST" });
    if (!res.ok) {
      throw new Error(await parseApiError(res));
    }
  };

  // Legacy / opcjonalnie: wymuszenie generowania (gdy auto-progres nie działa)
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
     Grupowanie po etapach + filtrowanie BYE (widok wyników)
     ============================================================ */

  const stages = useMemo(() => {
    // ukrywamy BYE na stronie wyników
    const visible = matches.filter((m) => !isByeMatch(m));

    // stage_id -> matches
    const map = new Map<number, MatchDTO[]>();
    for (const m of visible) {
      const arr = map.get(m.stage_id) ?? [];
      arr.push(m);
      map.set(m.stage_id, arr);
    }

    // sort etapów po stage_order, dopiero potem stage_id
    const entries = Array.from(map.entries()).sort((a, b) => {
      const aOrder = a[1][0]?.stage_order ?? 0;
      const bOrder = b[1][0]?.stage_order ?? 0;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a[0] - b[0];
    });

    // sort meczów w etapie po round_number, potem id
    for (const [, arr] of entries) {
      arr.sort((a, b) => {
        const ra = a.round_number ?? 0;
        const rb = b.round_number ?? 0;
        if (ra !== rb) return ra - rb;
        return a.id - b.id;
      });
    }

    return entries;
  }, [matches]);

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
     Zapis (onBlur) + ostrzeżenie o rollback (KO)
     ============================================================ */

  const saveOnBlur = async (matchId: number) => {
    const match = matches.find((m) => m.id === matchId);
    if (!match) return;

    // Zmiana wyniku w meczu zakończonym w KO może wymusić rollback.
    const snap = initialScoreRef.current.get(match.id);
    const isFinished = match.status === "FINISHED";

    if (isFinished && match.stage_type === "KNOCKOUT" && snap) {
      const prevSide = decideWinnerSide(match.stage_type, snap.h, snap.a);
      const newSide = decideWinnerSide(match.stage_type, match.home_score, match.away_score);

      const changesWinner =
        (prevSide === "HOME" || prevSide === "AWAY") &&
        (newSide === "HOME" || newSide === "AWAY") &&
        prevSide !== newSide;

      if (changesWinner) {
        const ok = window.confirm(
          "Ta zmiana zmienia zwycięzcę meczu.\n" +
            "Jeśli istnieje kolejny etap KO, może zostać cofnięty i wygenerowany ponownie.\n\n" +
            "Czy na pewno chcesz zapisać zmianę?"
        );
        if (!ok) {
          // revert do snapshotu serwera
          setMatches((prev) =>
            prev.map((m) => (m.id === match.id ? { ...m, home_score: snap.h, away_score: snap.a } : m))
          );
          setMessage("Zmiana anulowana.");
          return;
        }
      }
    }

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
     Zakończenie meczu (POST /finish/) — to był brakujący element
     ============================================================ */

  const onFinishMatchClick = async (matchId: number) => {
    const match = matches.find((m) => m.id === matchId);
    if (!match) return;

    // W UI blokujemy bezsensowne akcje
    if (match.status === "FINISHED") {
      setMessage("Ten mecz jest już zakończony.");
      return;
    }

    // Dla czytelności UX: wymagamy wpisanego wyniku (obie wartości).
    // W praktyce backend dla KO i tak tego pilnuje (result_entered + winner),
    // ale tu dajemy szybki komunikat.
    if (typeof match.home_score !== "number" || typeof match.away_score !== "number") {
      setMessage("Aby zakończyć mecz, wpisz wynik.");
      return;
    }

    if (match.stage_type === "KNOCKOUT" && match.home_score === match.away_score) {
      setMessage("W KO remis jest niedozwolony — popraw wynik przed zakończeniem meczu.");
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
      </section>

      {stages.map(([stageId, stageMatches], idx) => {
        const stageIndex1Based = idx + 1;
        const stageType = stageMatches[0]?.stage_type;

        // do tytułu KO użyj pełnych meczów etapu (także z BYE)
        const allStageMatches = matches.filter((m) => m.stage_id === stageId);

        const header = stageHeaderTitle(stageType, allStageMatches, stageIndex1Based, tournament);
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
                      }}
                      title="Ustawia status FINISHED w backendzie (POST /api/matches/:id/finish/)."
                    >
                      Mecz zakończony
                    </button>
                  </div>

                  {isFinished && (
                    <div style={{ marginTop: "0.35rem", opacity: 0.75 }}>
                      Mecz jest zakończony w backendzie. Edycja wyniku nadal możliwa, ale w KO zmiana zwycięzcy może cofnąć kolejne etapy.
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
                  title={
                    allMatchesInLastStageFinished
                      ? "Wymuś generowanie kolejnego etapu (legacy). Jeśli auto-progres działa, nie musisz tego używać."
                      : "Aby wygenerować kolejny etap, wszystkie mecze w tym etapie muszą mieć status FINISHED."
                  }
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

        <button onClick={() => navigate(`/tournaments/${id}/bracket`)}>
          Tabela / drabinka pucharowa →
        </button>

        <button onClick={() => navigate(`/tournaments/${id}/schedule`)}>
          Harmonogram (opcjonalnie) →
        </button>
      </div>

      {message && <p style={{ marginTop: "1rem", opacity: 0.9 }}>{message}</p>}
    </div>
  );
}
