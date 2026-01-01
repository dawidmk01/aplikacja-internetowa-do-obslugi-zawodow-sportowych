import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiFetch } from "../api";

/* ============================================================
   Typy API
   ============================================================ */

type TournamentDTO = {
  id: number;
  discipline: string;
};

type MatchDTO = {
  id: number;
  stage_id: number;
  stage_type: "LEAGUE" | "GROUP" | "KNOCKOUT";
  status: "SCHEDULED" | "FINISHED";
  round_number: number | null;
  home_team_name: string;
  away_team_name: string;
  home_score: number;
  away_score: number;
};

/* ============================================================
   Pomocnicze
   ============================================================ */

function stageTitle(stageType: MatchDTO["stage_type"], order: number) {
  if (stageType === "KNOCKOUT") {
    return `Etap pucharowy – runda ${order}`;
  }
  if (stageType === "GROUP") {
    return `Faza grupowa – etap ${order}`;
  }
  return `Liga – kolejka ${order}`;
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
     LOAD
     ============================================================ */

  const loadAll = async () => {
    if (!id) return;

    const [tRes, mRes] = await Promise.all([
      apiFetch(`/api/tournaments/${id}/`),
      apiFetch(`/api/tournaments/${id}/matches/`),
    ]);

    if (!tRes.ok || !mRes.ok) {
      throw new Error("Brak dostępu do danych turnieju.");
    }

    setTournament(await tRes.json());
    setMatches(await mRes.json());
  };

  useEffect(() => {
    setLoading(true);
    loadAll()
      .catch((e) => setMessage(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /* ============================================================
     ZAPIS WYNIKU
     ============================================================ */

  const saveScore = async (
    matchId: number,
    payload: { home_score?: number; away_score?: number }
  ) => {
    await apiFetch(`/api/matches/${matchId}/result/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    // 🔑 KLUCZ: odświeżamy stan z backendu
    await loadAll();
    setMessage("Wynik zapisany.");
  };

  /* ============================================================
     PODZIAŁ NA ETAPY
     ============================================================ */

  const stages = useMemo(() => {
    const map = new Map<number, MatchDTO[]>();

    for (const match of matches) {
      if (!map.has(match.stage_id)) {
        map.set(match.stage_id, []);
      }
      map.get(match.stage_id)!.push(match);
    }

    return Array.from(map.entries()).map(([stageId, stageMatches]) => ({
      stageId,
      stageType: stageMatches[0].stage_type,
      matches: stageMatches,
    }));
  }, [matches]);

  /* ============================================================
     AKTUALNY ETAP (OSTATNI OTWARTY)
     ============================================================ */

  const currentStage = stages[stages.length - 1];

  const allFinished =
    currentStage &&
    currentStage.matches.every((m) => m.status === "FINISHED");

  /* ============================================================
     ZATWIERDZENIE ETAPU
     ============================================================ */

  const confirmStage = async () => {
    if (!currentStage) return;

    const ok = window.confirm(
      "Czy na pewno chcesz zakończyć ten etap?\nPo zatwierdzeniu nie będzie można edytować wyników."
    );
    if (!ok) return;

    try {
      setBusy(true);
      setMessage(null);

      const res = await apiFetch(
        `/api/stages/${currentStage.stageId}/confirm/`,
        { method: "POST" }
      );

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail || "Nie udało się zatwierdzić etapu.");
      }

      await loadAll();

      const goSchedule = window.confirm(
        "Etap został zakończony.\nCzy chcesz teraz ustawić harmonogram nowego etapu?"
      );

      if (goSchedule) {
        navigate(`/tournaments/${id}/schedule`);
      }
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  };

  /* ============================================================
     RENDER
     ============================================================ */

  if (loading) return <p style={{ padding: "2rem" }}>Ładowanie…</p>;
  if (!tournament)
    return <p style={{ padding: "2rem" }}>Brak danych turnieju.</p>;

  return (
    <div style={{ padding: "2rem", maxWidth: 900 }}>
      <h1>Wprowadzanie wyników</h1>

      {stages.map((stage, idx) => (
        <section key={stage.stageId} style={{ marginBottom: "2rem" }}>
          <h2>{stageTitle(stage.stageType, idx + 1)}</h2>

          {stage.matches.map((match) => (
            <div
              key={match.id}
              style={{
                borderBottom: "1px solid #333",
                padding: "1rem 0",
              }}
            >
              <strong>
                {match.home_team_name} vs {match.away_team_name}
              </strong>

              <div
                style={{
                  display: "flex",
                  gap: "0.5rem",
                  marginTop: "0.5rem",
                }}
              >
                <input
                  type="number"
                  min={0}
                  value={match.home_score}
                  disabled={match.status === "FINISHED"}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    setMatches((prev) =>
                      prev.map((m) =>
                        m.id === match.id
                          ? { ...m, home_score: value }
                          : m
                      )
                    );
                  }}
                  onBlur={() =>
                    saveScore(match.id, {
                      home_score: match.home_score,
                    })
                  }
                />

                <span>:</span>

                <input
                  type="number"
                  min={0}
                  value={match.away_score}
                  disabled={match.status === "FINISHED"}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    setMatches((prev) =>
                      prev.map((m) =>
                        m.id === match.id
                          ? { ...m, away_score: value }
                          : m
                      )
                    );
                  }}
                  onBlur={() =>
                    saveScore(match.id, {
                      away_score: match.away_score,
                    })
                  }
                />
              </div>
            </div>
          ))}
        </section>
      ))}

      {/* ======================================================
          AKCJE ETAPU
         ====================================================== */}

      {currentStage && (
        <div style={{ marginTop: "2rem" }}>
          <button
            onClick={confirmStage}
            disabled={!allFinished || busy}
          >
            {busy ? "Zamykanie etapu…" : "Zatwierdź etap"}
          </button>

          {!allFinished && (
            <p style={{ opacity: 0.6, marginTop: "0.5rem" }}>
              Aby zakończyć etap, wszystkie mecze muszą być zakończone.
            </p>
          )}
        </div>
      )}

      <div style={{ marginTop: "2rem" }}>
        <button onClick={() => navigate(-1)}>← Wróć</button>
      </div>

      {message && (
        <p style={{ marginTop: "1rem", opacity: 0.9 }}>{message}</p>
      )}
    </div>
  );
}
