
import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiFetch } from "../api";

/* =========================
   Typy
   ========================= */

type TournamentScheduleDTO = {
  id: number;
  start_date: string | null;
  end_date: string | null;
  location: string | null;
  participants_count?: number; // Potrzebne do niektórych labeli, opcjonalnie
};

type MatchScheduleDTO = {
  id: number;
  stage_id: number;
  stage_order: number;
  stage_type: "LEAGUE" | "KNOCKOUT" | "GROUP" | "THIRD_PLACE";
  group_name?: string | null;
  round_number: number | null;

  home_team_name: string;
  away_team_name: string;

  scheduled_date: string | null;
  scheduled_time: string | null;
  location: string | null;
};

/* =========================
   Helpers (Ujednolicone z resztą systemu)
   ========================= */

function isByeTeamName(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = name.trim().toUpperCase();
  return (
    n === "BYE" ||
    n.includes("SYSTEM_BYE") ||
    n === "__SYSTEM_BYE__" ||
    n.includes("__SYSTEM_BYE__")
  );
}

function isByeMatch(m: MatchScheduleDTO): boolean {
  return isByeTeamName(m.home_team_name) || isByeTeamName(m.away_team_name);
}

function normalizeName(name: string | null | undefined): string {
  return (name ?? "").toString().trim();
}

function displayGroupName(originalName: string, index: number): string {
  if (originalName && originalName.length <= 2 && originalName !== "—") return `Grupa ${originalName}`;
  const letter = String.fromCharCode(65 + index); // 65 = 'A'
  return `Grupa ${letter}`;
}

// --- Grupowanie ---

function groupMatchesByGroup(matches: MatchScheduleDTO[]) {
  const map = new Map<string, MatchScheduleDTO[]>();
  for (const m of matches) {
    const key = m.group_name ?? "—";
    const arr = map.get(key) ?? [];
    arr.push(m);
    map.set(key, arr);
  }
  return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

function groupMatchesByRound(matches: MatchScheduleDTO[]) {
  const map = new Map<number, MatchScheduleDTO[]>();
  for (const m of matches) {
    const round = m.round_number ?? 0;
    const arr = map.get(round) ?? [];
    arr.push(m);
    map.set(round, arr);
  }
  return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
}

function groupVisibleMatchesByStage(matches: MatchScheduleDTO[]) {
  const map = new Map<number, MatchScheduleDTO[]>();
  for (const m of matches) {
    const arr = map.get(m.stage_id) ?? [];
    arr.push(m);
    map.set(m.stage_id, arr);
  }

  const entries = Array.from(map.entries()).sort((a, b) => {
    const aOrder = a[1][0]?.stage_order ?? 0;
    const bOrder = b[1][0]?.stage_order ?? 0;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a[0] - b[0];
  });

  // Sortowanie wewnątrz etapów (kolejki/ID)
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

// --- KO Labels ---

function countUniqueTeams(matches: MatchScheduleDTO[]): number {
  const teams = new Set<string>();
  for (const m of matches) {
    if (m.home_team_name) teams.add(normalizeName(m.home_team_name));
    if (m.away_team_name) teams.add(normalizeName(m.away_team_name));
  }
  return teams.size;
}

function resolveKoTitle(matches: MatchScheduleDTO[]): string {
    const teamCount = countUniqueTeams(matches);

    if (teamCount > 8 && teamCount <= 16) return "1/8 finału";
    if (teamCount > 4 && teamCount <= 8) return "Ćwierćfinał";
    if (teamCount > 2 && teamCount <= 4) return "Półfinał";
    if (teamCount === 2) return "Finał";

    if (teamCount > 16) return `1/${Math.floor(teamCount / 2)} finału`;

    return "Faza pucharowa";
}

function stageHeaderTitle(
  stageType: MatchScheduleDTO["stage_type"],
  stageOrder: number,
  matches: MatchScheduleDTO[]
): string {
  if (stageType === "THIRD_PLACE") return "Mecz o 3. miejsce";
  if (stageType === "GROUP") return "Faza grupowa";
  if (stageType === "LEAGUE") return "Liga";
  if (stageType === "KNOCKOUT") return resolveKoTitle(matches);
  return `Etap ${stageOrder}`;
}

/* =========================
   Komponent
   ========================= */

export default function TournamentSchedule() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [tournament, setTournament] = useState<TournamentScheduleDTO | null>(null);
  const [matches, setMatches] = useState<MatchScheduleDTO[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showBye, setShowBye] = useState(false);

  /* =========================
     API
     ========================= */

  const loadData = async () => {
    if (!id) return;

    setError(null);
    setMessage(null);

    const [tRes, mRes] = await Promise.all([
      apiFetch(`/api/tournaments/${id}/`),
      apiFetch(`/api/tournaments/${id}/matches/`),
    ]);

    if (!tRes.ok) throw new Error("Nie udało się pobrać danych turnieju.");
    if (!mRes.ok) throw new Error("Nie udało się pobrać meczów.");

    const tData = await tRes.json();
    setTournament({
      id: tData.id,
      start_date: tData.start_date ?? null,
      end_date: tData.end_date ?? null,
      location: tData.location ?? null,
      participants_count: tData.participants_count
    });

    const mData: MatchScheduleDTO[] = await mRes.json();
    setMatches(mData);
  };

  useEffect(() => {
    loadData().catch((e: any) => setError(e.message));
  }, [id]);

  const saveTournament = async () => {
    if (!id || !tournament) return;
    setError(null);
    setMessage(null);

    const res = await apiFetch(`/api/tournaments/${id}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        start_date: tournament.start_date,
        end_date: tournament.end_date,
        location: tournament.location,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.detail || "Nie udało się zapisać danych turnieju.");
    }
    setMessage("Dane turnieju zapisane.");
  };

  const saveMatch = async (match: MatchScheduleDTO) => {
    setError(null);
    setMessage(null);

    const res = await apiFetch(`/api/matches/${match.id}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scheduled_date: match.scheduled_date,
        scheduled_time: match.scheduled_time,
        location: match.location,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.detail || "Nie udało się zapisać danych meczu.");
    }
    setMessage("Zapisano.");
  };

  /* =========================
     Widok: filtrowanie + grupowanie etapów
     ========================= */

  // Filtrujemy BYE globalnie (jeśli checkbox odznaczony)
  // Ale potem grupujemy wszystkie mecze, żeby zachować strukturę
  const stages = useMemo(() => {
    // Najpierw grupujemy wszystko
    const allStages = groupVisibleMatchesByStage(matches);

    // Potem wewnątrz każdego etapu filtrujemy mecze BYE jeśli trzeba
    return allStages.map(([stageId, stageMatches]) => {
      const filtered = showBye ? stageMatches : stageMatches.filter(m => !isByeMatch(m));
      return { stageId, matches: filtered, allMatches: stageMatches }; // allMatches potrzebne do resolveKoTitle
    }).filter(s => s.matches.length > 0); // Ukrywamy puste etapy
  }, [matches, showBye]);

  /* =========================
     Render Helper Row
     ========================= */
  const renderMatchRow = (m: MatchScheduleDTO) => (
    <div
        key={m.id}
        style={{
            borderBottom: "1px solid #333",
            padding: "0.75rem 0",
            marginBottom: "0.25rem"
        }}
    >
        <div style={{marginBottom: "0.5rem"}}>
            <strong>{m.home_team_name}</strong> <span style={{opacity:0.6}}>vs</span> <strong>{m.away_team_name}</strong>
        </div>

        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <input
            type="date"
            value={m.scheduled_date ?? ""}
            onChange={(e) =>
                setMatches((prev) =>
                prev.map((x) => x.id === m.id ? { ...x, scheduled_date: e.target.value || null } : x)
                )
            }
            style={{padding: "0.3rem"}}
            />

            <input
            type="time"
            value={m.scheduled_time ?? ""}
            onChange={(e) =>
                setMatches((prev) =>
                prev.map((x) => x.id === m.id ? { ...x, scheduled_time: e.target.value || null } : x)
                )
            }
            style={{padding: "0.3rem"}}
            />

            <input
            type="text"
            placeholder="Lokalizacja"
            value={m.location ?? ""}
            onChange={(e) =>
                setMatches((prev) =>
                prev.map((x) => x.id === m.id ? { ...x, location: e.target.value || null } : x)
                )
            }
            style={{padding: "0.3rem", width: "120px"}}
            />

            <button
            onClick={() => saveMatch(m).catch((e: any) => setError(e.message))}
            style={{
                padding: "0.3rem 0.8rem",
                border: "1px solid #555",
                background: "rgba(255,255,255,0.1)",
                color: "#fff",
                cursor: "pointer",
                borderRadius: "4px"
            }}
            >
            Zapisz
            </button>
        </div>
    </div>
  );

  /* =========================
     Render Main
     ========================= */

  if (!tournament) return <p style={{padding: "2rem"}}>Ładowanie…</p>;

  return (
    <div style={{ padding: "2rem", maxWidth: 900 }}>
      <h1>Harmonogram i lokalizacja</h1>

      <p style={{ opacity: 0.8, marginBottom: "2rem" }}>
        Wszystkie pola są opcjonalne. Możesz uzupełnić dane ogólne turnieju
        lub ustawić szczegóły dla poszczególnych meczów.
      </p>

      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {message && <div style={{
          position: "fixed", bottom: "2rem", right: "2rem",
          background: "#333", color: "#fff", padding: "1rem 2rem",
          borderRadius: "8px", borderLeft: "5px solid #2ecc71", zIndex: 100
      }}>{message}</div>}

      {/* --- DANE OGÓLNE --- */}
      <section style={{ marginBottom: "2rem", padding: "1rem", background: "rgba(255,255,255,0.02)", borderRadius: "8px" }}>
        <h2 style={{marginTop: 0}}>Dane ogólne turnieju</h2>
        <div style={{ display: "grid", gap: "1rem", maxWidth: 400 }}>
            <div>
                <label style={{display: "block", marginBottom: "0.25rem"}}>Data rozpoczęcia</label>
                <input
                type="date"
                value={tournament.start_date ?? ""}
                onChange={(e) => setTournament({ ...tournament, start_date: e.target.value || null })}
                style={{width: "100%", padding: "0.4rem"}}
                />
            </div>
            <div>
                <label style={{display: "block", marginBottom: "0.25rem"}}>Data zakończenia</label>
                <input
                type="date"
                value={tournament.end_date ?? ""}
                onChange={(e) => setTournament({ ...tournament, end_date: e.target.value || null })}
                style={{width: "100%", padding: "0.4rem"}}
                />
            </div>
            <div>
                <label style={{display: "block", marginBottom: "0.25rem"}}>Lokalizacja (domyślna)</label>
                <input
                type="text"
                value={tournament.location ?? ""}
                onChange={(e) => setTournament({ ...tournament, location: e.target.value || null })}
                style={{width: "100%", padding: "0.4rem"}}
                />
            </div>
            <button
            onClick={() => saveTournament().catch((e: any) => setError(e.message))}
            style={{padding: "0.6rem", cursor: "pointer", marginTop: "0.5rem", fontWeight: "bold"}}
            >
            Zapisz dane turnieju
            </button>
        </div>
      </section>

      <hr style={{ borderColor: "#444", margin: "2rem 0" }} />

      {/* --- LISTA MECZÓW --- */}
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1rem" }}>
        <h2 style={{ margin: 0 }}>Harmonogram meczów</h2>
        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", opacity: 0.85, cursor: "pointer", fontSize: "0.9em" }}>
          <input
            type="checkbox"
            checked={showBye}
            onChange={(e) => setShowBye(e.target.checked)}
          />
          Pokaż mecze techniczne (BYE)
        </label>
      </div>

      {stages.map((s) => {
          const stageType = s.matches[0]?.stage_type;
          const stageOrder = s.matches[0]?.stage_order ?? 1;
          // Używamy wszystkich meczów etapu do wyliczenia tytułu KO (żeby liczba drużyn się zgadzała nawet jak ukryjemy BYE)
          const header = stageHeaderTitle(stageType, stageOrder, s.allMatches);

          return (
            <section key={s.stageId} style={{ marginTop: "2rem" }}>
                <h3 style={{ borderBottom: "2px solid #444", paddingBottom: "0.5rem", marginBottom: "1rem", color: "#eee" }}>
                    {header}
                </h3>

                {/* --- LAYOUT GRUPOWY --- */}
                {stageType === "GROUP" ? (
                    groupMatchesByGroup(s.matches).map(([groupName, groupMatches], idx) => (
                        <div key={groupName} style={{ marginBottom: "1.5rem", paddingLeft: "1rem", borderLeft: "2px solid #333" }}>
                            <h4 style={{ color: "#aaa", margin: "0.5rem 0" }}>{displayGroupName(groupName, idx)}</h4>
                            {groupMatchesByRound(groupMatches).map(([round, roundMatches]) => (
                                <div key={round} style={{ marginBottom: "1rem" }}>
                                    <div style={{ fontSize: "0.8rem", textTransform: "uppercase", opacity: 0.6, letterSpacing: "1px", marginBottom: "0.25rem" }}>
                                        Kolejka {round}
                                    </div>
                                    {roundMatches.map(m => renderMatchRow(m))}
                                </div>
                            ))}
                        </div>
                    ))
                ) : stageType === "LEAGUE" ? (
                    /* --- LAYOUT LIGOWY --- */
                    groupMatchesByRound(s.matches).map(([round, roundMatches]) => (
                        <div key={round} style={{ marginBottom: "1.5rem" }}>
                            <h4 style={{ margin: "0.5rem 0", fontSize: "0.9rem", textTransform: "uppercase", opacity: 0.6, letterSpacing: "1px", borderBottom:"1px solid #333", paddingBottom:"0.25rem" }}>
                                Kolejka {round}
                            </h4>
                            {roundMatches.map(m => renderMatchRow(m))}
                        </div>
                    ))
                ) : (
                    /* --- LAYOUT PUCHAROWY --- */
                    <div>
                        {s.matches.map(m => renderMatchRow(m))}
                    </div>
                )}
            </section>
          );
      })}

      <div style={{ marginTop: "3rem", display: "flex", gap: "1rem" }}>
        <button onClick={() => navigate(-1)} style={{padding: "0.6rem 1.2rem", cursor: "pointer"}}>← Wróć</button>
        <button
          onClick={() => navigate(`/tournaments/${id}/results`)}
          style={{
            background: "#2980b9",
            color: "#fff",
            padding: "0.6rem 1.2rem",
            borderRadius: 6,
            border: "none",
            cursor: "pointer",
            fontWeight: "bold"
          }}
        >
          Przejdź do wprowadzania wyników →
        </button>
      </div>
    </div>
  );
}