import { useEffect, useMemo, useState } from "react";
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
  stage_type: "LEAGUE" | "KNOCKOUT" | "GROUP";
  status: "SCHEDULED" | "FINISHED";
  round_number: number | null;
  home_team_name: string;
  away_team_name: string | null; // (awaryjnie) gdyby BYE było serializowane jako null
  home_score: number | null;
  away_score: number | null;
};

/* ============================================================
   Helpers
   ============================================================ */

function nextPowerOfTwo(n: number): number {
  if (n <= 1) return 1;
  return 2 ** Math.ceil(Math.log2(n));
}

function knockoutRoundLabelFromTeams(teams: number): string {
  if (teams === 2) return "Finał";
  if (teams === 4) return "Półfinał";
  if (teams === 8) return "Ćwierćfinał";
  return `1/${teams} finału`;
}

/**
 * KO: nazwa rundy z uwzględnieniem BYE w 1. etapie.
 * - standardowo teams = matches*2
 * - jeśli w 1. etapie KO była nieparzysta liczba uczestników, to bracket = nextPow2(participantsCount)
 *   i etykieta powinna wynikać z bracketu, a nie z liczby meczów (bo przy BYE meczów jest mniej).
 */
function knockoutStageTitle(
  stageMatches: MatchDTO[],
  stageIndex1Based: number,
  tournamentParticipantsCount?: number
): string {
  const matchesCount = stageMatches.length;

  // klasyczne przypadki
  if (matchesCount === 1) return "Finał";
  if (matchesCount === 2) return "Półfinał";
  if (matchesCount === 4) return "Ćwierćfinał";

  // 1. etap KO + możliwe BYE: bierzemy z participants_count (jeśli mamy)
  if (stageIndex1Based === 1 && typeof tournamentParticipantsCount === "number") {
    const bracket = nextPowerOfTwo(tournamentParticipantsCount);
    return knockoutRoundLabelFromTeams(bracket);
  }

  // fallback:
  // jeśli liczba meczów nie pasuje do klasyki, zakładamy teams = nextPow2(matches*2 (+1 jeśli wygląda na BYE))
  const approxTeams = matchesCount * 2;
  // jeśli ktoś miał BYE i nie mamy participants_count, to nieparzystość zwykle objawia się „za małą liczbą meczów”
  // więc próbujemy +1 i dopiero potęga 2
  const bracketGuess = nextPowerOfTwo(approxTeams + 1);
  return knockoutRoundLabelFromTeams(bracketGuess);
}

function stageHeaderTitle(
  stageType: MatchDTO["stage_type"],
  stageMatches: MatchDTO[],
  stageIndex1Based: number,
  tournament: TournamentDTO
): string {
  if (stageType === "KNOCKOUT") {
    return `Puchar: ${knockoutStageTitle(
      stageMatches,
      stageIndex1Based,
      tournament.participants_count
    )}`;
  }

  if (stageType === "GROUP") {
    return `Faza grupowa — etap ${stageIndex1Based}`;
  }

  return `Liga — etap ${stageIndex1Based}`;
}

function scoreToInputValue(score: number | null): string {
  return score === null || typeof score === "undefined" ? "" : String(score);
}

function inputValueToScore(v: string): number | null {
  const s = v.trim();
  if (s === "") return null;
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
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
  const [busyMatchId, setBusyMatchId] = useState<number | null>(null);
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
     - stabilnie sortujemy po stage_id rosnąco (w praktyce odpowiada kolejności tworzenia)
     ============================================================ */

  const stages = useMemo(() => {
    const map = new Map<number, MatchDTO[]>();

    for (const m of matches) {
      const arr = map.get(m.stage_id) ?? [];
      arr.push(m);
      map.set(m.stage_id, arr);
    }

    const entries = Array.from(map.entries()).sort((a, b) => a[0] - b[0]);

    // sort wewnątrz etapu
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

  /* ============================================================
     Zapis na blur (styl TournamentTeams)
     - zawsze edytowalne
     - po zapisie: reload matches + tournament (żeby zobaczyć auto-generację/rollback)
     ============================================================ */

  const saveOnBlur = async (match: MatchDTO) => {
    const home = match.home_score;
    const away = match.away_score;

    // jeśli ktoś wpisze śmieci, nie zapisujemy — cofamy stan do serwera
    // (tu powinno się zdarzać rzadko, bo input type=number)
    if (home !== null && home < 0) {
      setMessage("Wynik nie został zapisany (wartość ujemna).");
      await loadMatches().catch(() => null);
      return;
    }
    if (away !== null && away < 0) {
      setMessage("Wynik nie został zapisany (wartość ujemna).");
      await loadMatches().catch(() => null);
      return;
    }

    // BYE / brak przeciwnika – nie zapisujemy wyniku
    if (!match.away_team_name) return;

    try {
      setBusyMatchId(match.id);
      setMessage(null);

      await updateMatchScore(match.id, home, away);

      // po zapisie odświeżamy:
      // - status meczu (FINISHED/SCHEDULED)
      // - ewentualne rollbacki i nowe etapy
      await Promise.all([loadMatches(), loadTournament().catch(() => null)]);

      setMessage("Wynik zapisany.");
    } catch (e: any) {
      setMessage(e.message);
      await loadMatches().catch(() => null);
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

  return (
    <div style={{ padding: "2rem", maxWidth: 980 }}>
      <h1>Wprowadzanie wyników</h1>

      <section style={{ opacity: 0.85, marginBottom: "1rem" }}>
        {tournament.name && (
          <div>
            <strong>Turniej:</strong> {tournament.name}
          </div>
        )}
        <div>
          <strong>Status:</strong> {tournament.status}
        </div>
        <div style={{ marginTop: "0.25rem" }}>
          Wynik zapisuje się po opuszczeniu pola (onBlur). Wyniki można edytować w dowolnym momencie.
        </div>
        <div style={{ marginTop: "0.25rem" }}>
          Jeśli zmienisz wynik w etapie wcześniejszym i zmieni się zwycięzca, backend cofnie późniejsze etapy i wygeneruje je ponownie.
        </div>
      </section>

      {stages.map(([stageId, stageMatches], idx) => {
        const stageIndex1Based = idx + 1;
        const stageType = stageMatches[0]?.stage_type;

        const header = stageHeaderTitle(stageType, stageMatches, stageIndex1Based, tournament);

        const isKnockout = stageType === "KNOCKOUT";
        const isLeagueOrGroup = stageType === "LEAGUE" || stageType === "GROUP";

        // podział na kolejki w lidze/grupach
        const roundsMap = new Map<number, MatchDTO[]>();
        if (isLeagueOrGroup) {
          for (const m of stageMatches) {
            const r = typeof m.round_number === "number" ? m.round_number : 0;
            const arr = roundsMap.get(r) ?? [];
            arr.push(m);
            roundsMap.set(r, arr);
          }
        }

        const rounds = isLeagueOrGroup
          ? Array.from(roundsMap.keys()).sort((a, b) => a - b)
          : [];

        return (
          <section
            key={stageId}
            style={{
              marginTop: "1.25rem",
              paddingTop: "1rem",
              borderTop: "1px solid #333",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}>
              <h2 style={{ marginBottom: "0.75rem" }}>{header}</h2>
              <div style={{ opacity: 0.6, paddingTop: "0.35rem" }}>
                stage_id: {stageId}
              </div>
            </div>

            {/* KO: lista meczów */}
            {isKnockout &&
              stageMatches.map((match) => {
                const awayName = match.away_team_name ?? "BYE";
                const isBye = match.away_team_name === null;

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
                        value={scoreToInputValue(match.home_score)}
                        disabled={isBye || busyMatchId === match.id}
                        onChange={(e) => {
                          const v = inputValueToScore(e.target.value);
                          setMatches((prev) =>
                            prev.map((m) => (m.id === match.id ? { ...m, home_score: v } : m))
                          );
                        }}
                        onBlur={() => saveOnBlur(match)}
                      />

                      <span>:</span>

                      <input
                        type="number"
                        min={0}
                        value={scoreToInputValue(match.away_score)}
                        disabled={isBye || busyMatchId === match.id}
                        onChange={(e) => {
                          const v = inputValueToScore(e.target.value);
                          setMatches((prev) =>
                            prev.map((m) => (m.id === match.id ? { ...m, away_score: v } : m))
                          );
                        }}
                        onBlur={() => saveOnBlur(match)}
                      />

                      {busyMatchId === match.id && <span style={{ opacity: 0.7 }}>Zapisywanie…</span>}
                    </div>

                    <div style={{ marginTop: "0.35rem", opacity: 0.8 }}>
                      Status meczu: {match.status === "FINISHED" ? "Zakończony" : "W trakcie / niepełny wynik"}
                    </div>
                  </div>
                );
              })}

            {/* LEAGUE/GROUP: kolejki */}
            {isLeagueOrGroup &&
              rounds.map((roundNo) => {
                const roundMatches = roundsMap.get(roundNo) ?? [];
                const roundTitle =
                  stageType === "LEAGUE" ? `Kolejka ${roundNo}` : `Runda ${roundNo}`;

                return (
                  <div key={roundNo} style={{ marginBottom: "1.25rem" }}>
                    <h3 style={{ margin: "0.75rem 0" }}>{roundTitle}</h3>

                    {roundMatches.map((match) => {
                      const awayName = match.away_team_name ?? "—";
                      const isBye = match.away_team_name === null;

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
                              value={scoreToInputValue(match.home_score)}
                              disabled={isBye || busyMatchId === match.id}
                              onChange={(e) => {
                                const v = inputValueToScore(e.target.value);
                                setMatches((prev) =>
                                  prev.map((m) => (m.id === match.id ? { ...m, home_score: v } : m))
                                );
                              }}
                              onBlur={() => saveOnBlur(match)}
                            />

                            <span>:</span>

                            <input
                              type="number"
                              min={0}
                              value={scoreToInputValue(match.away_score)}
                              disabled={isBye || busyMatchId === match.id}
                              onChange={(e) => {
                                const v = inputValueToScore(e.target.value);
                                setMatches((prev) =>
                                  prev.map((m) => (m.id === match.id ? { ...m, away_score: v } : m))
                                );
                              }}
                              onBlur={() => saveOnBlur(match)}
                            />

                            {busyMatchId === match.id && <span style={{ opacity: 0.7 }}>Zapisywanie…</span>}
                          </div>

                          <div style={{ marginTop: "0.35rem", opacity: 0.8 }}>
                            Status meczu: {match.status === "FINISHED" ? "Zakończony" : "W trakcie / niepełny wynik"}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
          </section>
        );
      })}

      <div style={{ marginTop: "2rem", display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        <button onClick={() => navigate(-1)}>← Wróć</button>
        <button onClick={() => navigate(`/tournaments/${id}/matches`)}>Podgląd rozgrywek →</button>
        <button onClick={() => navigate(`/tournaments/${id}/schedule`)}>Harmonogram →</button>
      </div>

      {message && <p style={{ marginTop: "1rem", opacity: 0.9 }}>{message}</p>}
    </div>
  );
}
