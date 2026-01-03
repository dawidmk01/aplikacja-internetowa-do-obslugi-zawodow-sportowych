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
};

type MatchScheduleDTO = {
  id: number;
  stage_id: number;
  stage_type: "LEAGUE" | "KNOCKOUT" | "GROUP";
  round_number: number | null;

  home_team_name: string;
  away_team_name: string;

  scheduled_date: string | null;
  scheduled_time: string | null;
  location: string | null;
};

/* =========================
   Helpers
   ========================= */

function isByeTeamName(name: string | null | undefined): boolean {
  if (!name) return true;
  const n = name.trim().toUpperCase();
  return n === "__SYSTEM_BYE__" || n.includes("SYSTEM_BYE") || n === "BYE" || n.includes(" BYE");
}

function isByeMatch(m: MatchScheduleDTO): boolean {
  return isByeTeamName(m.home_team_name) || isByeTeamName(m.away_team_name);
}

function nextPow2(n: number): number {
  if (n <= 1) return 1;
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function getKnockoutStageLabel(entrants: number): string {
  // entrants = liczba drużyn w etapie KO (np. 8 => ćwierćfinał, 4 => półfinał)
  if (entrants <= 2) return "Finał";
  if (entrants === 4) return "Półfinał";
  if (entrants === 8) return "Ćwierćfinał";

  // 16 drużyn => 1/8 finału (bo 8 meczów)
  const denom = entrants / 2;
  return `1/${denom} finału`;
}

function stageTypeLabel(t: MatchScheduleDTO["stage_type"]): string {
  if (t === "LEAGUE") return "Liga";
  if (t === "GROUP") return "Faza grupowa";
  return "Puchar (KO)";
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

    // turniej ma więcej pól, ale my używamy tylko tych trzech
    const tData = await tRes.json();
    setTournament({
      id: tData.id,
      start_date: tData.start_date ?? null,
      end_date: tData.end_date ?? null,
      location: tData.location ?? null,
    });

    const mData: MatchScheduleDTO[] = await mRes.json();
    setMatches(mData);
  };

  useEffect(() => {
    loadData().catch((e: any) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const visibleMatches = useMemo(() => {
    if (showBye) return matches;
    return matches.filter((m) => !isByeMatch(m));
  }, [matches, showBye]);

  // liczba REALNYCH drużyn (bez BYE) — użyte do policzenia rozmiaru drabinki KO
  const realTeamsCount = useMemo(() => {
    const s = new Set<string>();
    for (const m of matches) {
      if (!isByeTeamName(m.home_team_name)) s.add(m.home_team_name);
      if (!isByeTeamName(m.away_team_name)) s.add(m.away_team_name);
    }
    return s.size;
  }, [matches]);

  const bracketSize = useMemo(() => nextPow2(realTeamsCount), [realTeamsCount]);

  const koSections = useMemo(() => {
    const ko = matches.filter((m) => m.stage_type === "KNOCKOUT");
    if (!ko.length) return [];

    const byStage = new Map<number, MatchScheduleDTO[]>();
    for (const m of ko) {
      const arr = byStage.get(m.stage_id) ?? [];
      arr.push(m);
      byStage.set(m.stage_id, arr);
    }

    const stageIds = Array.from(byStage.keys()).sort((a, b) => a - b);

    return stageIds.map((stageId, koIndex) => {
      const allStageMatches = (byStage.get(stageId) ?? []).slice().sort((a, b) => a.id - b.id);
      const stageMatchesForDisplay = showBye
        ? allStageMatches
        : allStageMatches.filter((m) => !isByeMatch(m));

      // entrants: 8 -> ćwierćfinał, 4 -> półfinał, 2 -> finał
      const entrants = Math.max(2, Math.floor(bracketSize / Math.pow(2, koIndex)));
      const title = getKnockoutStageLabel(entrants);

      return {
        key: `ko-${stageId}`,
        title,
        matches: stageMatchesForDisplay,
        stageId,
      };
    });
  }, [matches, showBye, bracketSize]);

  const otherSections = useMemo(() => {
    const others = matches.filter((m) => m.stage_type !== "KNOCKOUT");
    if (!others.length) return [];

    // Grupujemy po (stage_type + round_number) żeby w lidze mieć „kolejki”
    const byKey = new Map<string, { title: string; matches: MatchScheduleDTO[] }>();

    for (const m of others) {
      const r = typeof m.round_number === "number" ? m.round_number : 1;
      const key = `${m.stage_type}-${r}`;
      const title =
        m.stage_type === "LEAGUE"
          ? `Liga – kolejka ${r}`
          : `Faza grupowa – kolejka ${r}`;

      const bucket = byKey.get(key) ?? { title, matches: [] };
      bucket.matches.push(m);
      byKey.set(key, bucket);
    }

    const keysSorted = Array.from(byKey.keys()).sort((a, b) => a.localeCompare(b));

    return keysSorted.map((k) => {
      const bucket = byKey.get(k)!;
      const ms = bucket.matches
        .slice()
        .sort((a, b) => (a.round_number ?? 0) - (b.round_number ?? 0) || a.id - b.id);

      const display = showBye ? ms : ms.filter((m) => !isByeMatch(m));

      return {
        key: `other-${k}`,
        title: bucket.title,
        matches: display,
      };
    });
  }, [matches, showBye]);

  /* =========================
     Render
     ========================= */

  if (!tournament) return <p>Ładowanie…</p>;

  return (
    <div style={{ padding: "2rem", maxWidth: 900 }}>
      <h1>Harmonogram i lokalizacja</h1>

      <p style={{ opacity: 0.8 }}>
        Wszystkie pola są opcjonalne. Możesz uzupełnić dane ogólne turnieju
        lub ustawić szczegóły tylko dla wybranych meczów.
      </p>

      {error && <p style={{ color: "crimson" }}>{error}</p>}
      {message && <p style={{ opacity: 0.9 }}>{message}</p>}

      {/* =========================
         TURNIEJ
         ========================= */}

      <h2>Turniej</h2>

      <div style={{ display: "grid", gap: "0.5rem", maxWidth: 400 }}>
        <label>Data rozpoczęcia</label>
        <input
          type="date"
          value={tournament.start_date ?? ""}
          onChange={(e) =>
            setTournament({ ...tournament, start_date: e.target.value || null })
          }
        />

        <label>Data zakończenia</label>
        <input
          type="date"
          value={tournament.end_date ?? ""}
          onChange={(e) =>
            setTournament({ ...tournament, end_date: e.target.value || null })
          }
        />

        <label>Lokalizacja</label>
        <input
          type="text"
          value={tournament.location ?? ""}
          onChange={(e) =>
            setTournament({ ...tournament, location: e.target.value || null })
          }
        />

        <button
          onClick={() => saveTournament().catch((e: any) => setError(e.message))}
        >
          Zapisz dane turnieju
        </button>
      </div>

      <hr />

      {/* =========================
         MECZE
         ========================= */}

      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginTop: "1rem" }}>
        <h2 style={{ margin: 0 }}>Mecze</h2>

        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", opacity: 0.85 }}>
          <input
            type="checkbox"
            checked={showBye}
            onChange={(e) => setShowBye(e.target.checked)}
          />
          Pokaż mecze techniczne (BYE)
        </label>
      </div>

      {/* Pozostałe formaty (liga/grupy) */}
      {otherSections.map((section) => (
        <section key={section.key} style={{ marginTop: "1.25rem" }}>
          <h3 style={{ marginBottom: "0.5rem" }}>{section.title}</h3>

          {section.matches.length === 0 ? (
            <p style={{ opacity: 0.7 }}>Brak meczów do wyświetlenia.</p>
          ) : (
            section.matches.map((m) => (
              <div
                key={m.id}
                style={{
                  borderBottom: "1px solid #333",
                  padding: "0.75rem 0",
                }}
              >
                <strong>
                  {m.home_team_name} vs {m.away_team_name}
                </strong>

                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                  <input
                    type="date"
                    value={m.scheduled_date ?? ""}
                    onChange={(e) =>
                      setMatches((prev) =>
                        prev.map((x) =>
                          x.id === m.id
                            ? { ...x, scheduled_date: e.target.value || null }
                            : x
                        )
                      )
                    }
                  />

                  <input
                    type="time"
                    value={m.scheduled_time ?? ""}
                    onChange={(e) =>
                      setMatches((prev) =>
                        prev.map((x) =>
                          x.id === m.id
                            ? { ...x, scheduled_time: e.target.value || null }
                            : x
                        )
                      )
                    }
                  />

                  <input
                    type="text"
                    placeholder="Lokalizacja"
                    value={m.location ?? ""}
                    onChange={(e) =>
                      setMatches((prev) =>
                        prev.map((x) =>
                          x.id === m.id
                            ? { ...x, location: e.target.value || null }
                            : x
                        )
                      )
                    }
                  />

                  <button
                    onClick={() => saveMatch(m).catch((e: any) => setError(e.message))}
                  >
                    Zapisz
                  </button>
                </div>
              </div>
            ))
          )}
        </section>
      ))}

      {/* KO po etapach */}
      {koSections.map((section) => (
        <section key={section.key} style={{ marginTop: "1.25rem" }}>
          <h3 style={{ marginBottom: "0.5rem" }}>{section.title}</h3>

          {section.matches.length === 0 ? (
            <p style={{ opacity: 0.7 }}>
              Brak meczów do wyświetlenia (etap zawiera tylko BYE).
            </p>
          ) : (
            section.matches.map((m) => (
              <div
                key={m.id}
                style={{
                  borderBottom: "1px solid #333",
                  padding: "0.75rem 0",
                }}
              >
                <strong>
                  {m.home_team_name} vs {m.away_team_name}
                </strong>

                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                  <input
                    type="date"
                    value={m.scheduled_date ?? ""}
                    onChange={(e) =>
                      setMatches((prev) =>
                        prev.map((x) =>
                          x.id === m.id
                            ? { ...x, scheduled_date: e.target.value || null }
                            : x
                        )
                      )
                    }
                  />

                  <input
                    type="time"
                    value={m.scheduled_time ?? ""}
                    onChange={(e) =>
                      setMatches((prev) =>
                        prev.map((x) =>
                          x.id === m.id
                            ? { ...x, scheduled_time: e.target.value || null }
                            : x
                        )
                      )
                    }
                  />

                  <input
                    type="text"
                    placeholder="Lokalizacja"
                    value={m.location ?? ""}
                    onChange={(e) =>
                      setMatches((prev) =>
                        prev.map((x) =>
                          x.id === m.id
                            ? { ...x, location: e.target.value || null }
                            : x
                        )
                      )
                    }
                  />

                  <button
                    onClick={() => saveMatch(m).catch((e: any) => setError(e.message))}
                  >
                    Zapisz
                  </button>
                </div>
              </div>
            ))
          )}
        </section>
      ))}

      <div style={{ marginTop: "2rem", display: "flex", gap: "1rem" }}>
        <button onClick={() => navigate(-1)}>← Wróć</button>

        <button
          onClick={() => navigate(`/tournaments/${id}/results`)}
          style={{
            background: "#1e90ff",
            color: "#fff",
            padding: "0.5rem 1rem",
            borderRadius: 6,
            border: "none",
          }}
        >
          Przejdź do wprowadzania wyników →
        </button>
      </div>

      <p style={{ marginTop: "1rem", opacity: 0.7 }}>
        {matches.length > 0 && (
          <>
            <span>
              Wykryty format etapów:{" "}
              <strong>{Array.from(new Set(matches.map((m) => stageTypeLabel(m.stage_type)))).join(", ")}</strong>
            </span>
            <br />
            <span>
              Liczba drużyn (bez BYE): <strong>{realTeamsCount}</strong>, rozmiar drabinki KO: <strong>{bracketSize}</strong>
            </span>
          </>
        )}
      </p>
    </div>
  );
}
