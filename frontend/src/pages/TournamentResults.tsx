import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../api";

/* ============================================================
   Typy API
   ============================================================ */

type TournamentDTO = {
  id: number;
  discipline: string;
  status: "DRAFT" | "CONFIGURED" | "RUNNING" | "FINISHED";
};

type MatchDTO = {
  id: number;
  stage_id: number;
  stage_type: "LEAGUE" | "KNOCKOUT" | "GROUP";
  status: "SCHEDULED" | "FINISHED";
  home_team_name: string;
  away_team_name: string | null; // w KO może być BYE (null albo "BYE" zależnie od serializera)
  home_score: number | null;
  away_score: number | null;
};

/* ============================================================
   Helpers
   ============================================================ */

function stageTitle(stageType: MatchDTO["stage_type"], stageIndex1Based: number) {
  if (stageType === "KNOCKOUT") return `Etap pucharowy – runda ${stageIndex1Based}`;
  if (stageType === "GROUP") return `Faza grupowa – etap ${stageIndex1Based}`;
  return `Liga – etap ${stageIndex1Based}`;
}

function safeNumberFromInput(v: string): number | null {
  if (v.trim() === "") return null;
  if (!/^\d+$/.test(v)) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
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
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
    return data;
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
     Grupowanie po etapach (stage_id)
     ============================================================ */

  const stages = useMemo(() => {
    const map = new Map<number, MatchDTO[]>();
    for (const m of matches) {
      const arr = map.get(m.stage_id) ?? [];
      arr.push(m);
      map.set(m.stage_id, arr);
    }

    // sort: po stage_id rosnąco (w praktyce OK jako kolejność etapów)
    const entries = Array.from(map.entries()).sort((a, b) => a[0] - b[0]);

    // w każdym etapie możesz sobie sortować mecze, np. po id
    for (const [, arr] of entries) arr.sort((a, b) => a.id - b.id);

    return entries;
  }, [matches]);

  const lastStageId = useMemo(() => {
    if (!stages.length) return null;
    return stages[stages.length - 1][0];
  }, [stages]);

  /* ============================================================
     Zapis wyniku (jak TournamentTeams)
     - wynik jest edytowalny zawsze
     - przy błędzie: pokazujemy komunikat i reload
     - po sukcesie: reload (żeby od razu mieć status FINISHED i ewentualny rollback etapów)
     ============================================================ */

  const updateMatchScore = async (matchId: number, home: number | null, away: number | null) => {
    const res = await apiFetch(`/api/matches/${matchId}/result/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ home_score: home, away_score: away }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.detail || "Nie udało się zapisać wyniku.");
    }
  };

  const onBlurSave = async (match: MatchDTO, homeInput: string, awayInput: string) => {
    // Jeśli user zostawił pola tak jak były – nie wysyłamy
    const homeParsed = safeNumberFromInput(homeInput);
    const awayParsed = safeNumberFromInput(awayInput);

    // Warunek „nie wysyłaj, jeśli nadal brak sensownej wartości”
    // (ale: jeśli oba są liczbą 0 i user tak chce, to jest sensowna wartość)
    if (homeParsed === null || awayParsed === null) {
      // nic nie zapisujemy, przywracamy stan serwera
      setMessage("Wynik nie został zapisany (uzupełnij oba pola liczbami ≥ 0).");
      await loadMatches().catch(() => null);
      return;
    }

    // Optimistic: już masz wpisane w state, więc tylko zapisujemy w backendzie
    try {
      setMessage(null);
      await updateMatchScore(match.id, homeParsed, awayParsed);

      // po zapisie odświeżamy mecze:
      // - status FINISHED wchodzi od razu
      // - jeżeli backend cofnął kolejne etapy, zobaczysz to bez refresh
      await loadMatches();

      // turniej też może zmienić status (np. z FINISHED -> RUNNING po rollbacku)
      await loadTournament().catch(() => null);

      setMessage("Wynik zapisany.");
    } catch (e: any) {
      setMessage(e.message);
      await loadMatches().catch(() => null);
    }
  };

  /* ============================================================
     Potwierdzenie etapu (tylko ostatni etap)
     ============================================================ */

  const confirmStage = async (stageId: number) => {
    if (!id) return;

    const ok = window.confirm(
      "Czy na pewno chcesz zakończyć ten etap?\n" +
        "Jeżeli to KO, system spróbuje wygenerować kolejny etap.\n" +
        "Jeżeli to był finał, turniej zostanie zakończony."
    );
    if (!ok) return;

    try {
      setBusy(true);
      setMessage(null);

      const res = await apiFetch(`/api/stages/${stageId}/confirm/`, {
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail || "Nie udało się zatwierdzić etapu.");
      }

      // po confirm zawsze odświeżamy stan
      await Promise.all([loadTournament(), loadMatches()]);

      const goSchedule = window.confirm(
        "Etap został zakończony.\nCzy chcesz przejść do ustawiania harmonogramu?"
      );
      if (goSchedule) navigate(`/tournaments/${id}/schedule`);
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
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

  return (
    <div style={{ padding: "2rem", maxWidth: 900 }}>
      <h1>Wprowadzanie wyników</h1>

      <section style={{ opacity: 0.85, marginBottom: "1rem" }}>
        <div>
          <strong>Status turnieju:</strong> {tournament.status}
        </div>
        <div style={{ marginTop: "0.25rem" }}>
          Wynik zapisuje się po opuszczeniu pola (onBlur). Wyniki można edytować w dowolnym momencie.
        </div>
        <div style={{ marginTop: "0.25rem" }}>
          Jeśli istnieją już kolejne etapy, zmiana wyniku w starszym etapie cofnie wygenerowane etapy (backend).
        </div>
      </section>

      {stages.map(([stageId, stageMatches], idx) => {
        const title = stageTitle(stageMatches[0].stage_type, idx + 1);

        const allFinished = stageMatches.every((m) => m.status === "FINISHED");
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
            <h2 style={{ marginBottom: "0.75rem" }}>{title}</h2>

            {stageMatches.map((match) => {
              const awayName = match.away_team_name ?? "BYE";

              return (
                <div
                  key={match.id}
                  style={{
                    borderBottom: "1px solid #333",
                    padding: "1rem 0",
                  }}
                >
                  <strong>
                    {match.home_team_name} vs {awayName}
                  </strong>

                  <div
                    style={{
                      display: "flex",
                      gap: "0.5rem",
                      marginTop: "0.5rem",
                      alignItems: "center",
                    }}
                  >
                    <input
                      type="number"
                      min={0}
                      defaultValue={match.home_score ?? 0}
                      onBlur={(e) => {
                        const homeVal = e.currentTarget.value;
                        const awayEl = document.getElementById(
                          `away-${match.id}`
                        ) as HTMLInputElement | null;
                        const awayVal = awayEl ? awayEl.value : String(match.away_score ?? 0);

                        // Optimistic UI: na bieżąco odzwierciedlamy w state
                        setMatches((prev) =>
                          prev.map((m) =>
                            m.id === match.id
                              ? { ...m, home_score: Number(homeVal), away_score: Number(awayVal) }
                              : m
                          )
                        );

                        onBlurSave(match, homeVal, awayVal);
                      }}
                    />

                    <span>:</span>

                    <input
                      id={`away-${match.id}`}
                      type="number"
                      min={0}
                      defaultValue={match.away_score ?? 0}
                      onBlur={(e) => {
                        const awayVal = e.currentTarget.value;
                        const homeEl = document.getElementById(
                          `home-${match.id}`
                        ) as HTMLInputElement | null;
                        const homeVal = homeEl ? homeEl.value : String(match.home_score ?? 0);

                        setMatches((prev) =>
                          prev.map((m) =>
                            m.id === match.id
                              ? { ...m, home_score: Number(homeVal), away_score: Number(awayVal) }
                              : m
                          )
                        );

                        onBlurSave(match, homeVal, awayVal);
                      }}
                    />
                    {/* pomocnicze id do odczytu pary */}
                    <input id={`home-${match.id}`} type="hidden" value={match.home_score ?? 0} readOnly />
                  </div>

                  <div style={{ marginTop: "0.35rem", opacity: 0.8 }}>
                    Status meczu: {match.status === "FINISHED" ? "Zakończony" : "Zaplanowany"}
                  </div>
                </div>
              );
            })}

            {isLastStage && tournament.status !== "FINISHED" && (
              <div style={{ marginTop: "1rem" }}>
                <button onClick={() => confirmStage(stageId)} disabled={!allFinished || busy}>
                  {busy ? "Zamykanie etapu…" : "Zatwierdź etap"}
                </button>

                {!allFinished && (
                  <p style={{ opacity: 0.6, marginTop: "0.5rem" }}>
                    Aby zatwierdzić etap, wszystkie mecze w tym etapie muszą mieć status „Zakończony”.
                  </p>
                )}
              </div>
            )}
          </section>
        );
      })}

      <div style={{ marginTop: "2rem", display: "flex", gap: "1rem" }}>
        <button onClick={() => navigate(-1)}>← Wróć</button>
        <button onClick={() => navigate(`/tournaments/${id}/matches`)}>Podgląd rozgrywek →</button>
        <button onClick={() => navigate(`/tournaments/${id}/schedule`)}>Harmonogram →</button>
      </div>

      {message && <p style={{ marginTop: "1rem", opacity: 0.9 }}>{message}</p>}
    </div>
  );
}
