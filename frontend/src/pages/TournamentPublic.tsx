// frontend/src/pages/TournamentPublic.tsx
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams, useSearchParams, useNavigate } from "react-router-dom";
import { apiFetch } from "../api";
import PublicMatchesPanel from "../components/PublicMatchesPanel";
import type { MatchPublicDTO } from "../components/PublicMatchesPanel";
import StandingsBracket from "../components/StandingsBracket";

type EntryMode = "MANAGER" | "ORGANIZER_ONLY";

type TournamentPublicDTO = {
  id: number;
  name: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  location: string | null;
  is_published?: boolean;

  // zarządzanie uczestnikami (bez SELF_REGISTER)
  entry_mode?: EntryMode;
  competition_type?: "TEAM" | "INDIVIDUAL";

  // ✅ toggle dołączania przez konto + kod
  allow_join_by_code?: boolean;
  // opcjonalnie – jeśli backend zwraca (nie jest wymagane do działania UI)
  join_code?: string | null;

  my_role?: "ORGANIZER" | "ASSISTANT" | "PARTICIPANT" | null;
};

type RegistrationMeDTO = {
  display_name: string;
  team_id: number | null;
};

function formatDateRange(start: string | null, end: string | null) {
  if (!start && !end) return null;
  if (start && end) return `${start} - ${end}`;
  return start ?? end;
}

function isByePublic(m: MatchPublicDTO): boolean {
  const h = (m.home_team_name ?? "").toUpperCase();
  const a = (m.away_team_name ?? "").toUpperCase();
  const needles = ["BYE", "__SYSTEM_BYE__", "WOLNY LOS"];
  return needles.some((n) => h.includes(n) || a.includes(n));
}

type ViewTab = "MATCHES" | "STANDINGS";

function hasAccessToken(): boolean {
  try {
    const keys = ["access", "accessToken", "access_token", "jwt_access", "token"];
    for (const k of keys) {
      const v = localStorage.getItem(k);
      if (v && v.trim()) return true;
    }
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      const lk = k.toLowerCase();
      if (lk.includes("access") && !lk.includes("refresh")) {
        const v = localStorage.getItem(k);
        if (v && v.trim()) return true;
      }
    }
  } catch {
    // ignore
  }
  return false;
}

function normalizeName(s: string) {
  return (s ?? "").trim().replace(/\s+/g, " ");
}

export default function TournamentPublic({ initialView = "MATCHES" }: { initialView?: ViewTab } = {}) {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // kod dostępu do podglądu (public access code)
  const urlAccessCode = searchParams.get("code") ?? "";
  const [code, setCode] = useState("");

  useEffect(() => {
    if (urlAccessCode && !code) setCode(urlAccessCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlAccessCode]);

  // flaga wejścia "z linku do dołączania"
  const joinFlag = searchParams.get("join") === "1";

  // opcjonalnie: prefill kodu dołączania z URL (jeśli kiedyś dodasz do linku)
  const urlJoinCode = searchParams.get("join_code") ?? searchParams.get("joinCode") ?? "";

  const [tournament, setTournament] = useState<TournamentPublicDTO | null>(null);
  const [matches, setMatches] = useState<MatchPublicDTO[]>([]);
  const [myMatches, setMyMatches] = useState<MatchPublicDTO[]>([]);

  const [error, setError] = useState<string | null>(null);
  const [needsCode, setNeedsCode] = useState(false);
  const [view, setView] = useState<ViewTab>(initialView);

  // rejestracja
  const isLogged = hasAccessToken();
  const [regMe, setRegMe] = useState<RegistrationMeDTO | null>(null);
  const [regBusy, setRegBusy] = useState(false);
  const [regInfo, setRegInfo] = useState<string | null>(null);
  const [regError, setRegError] = useState<string | null>(null);

  const [regCode, setRegCode] = useState("");
  const [verified, setVerified] = useState(false);
  const [displayName, setDisplayName] = useState("");

  // prefill kodu dołączania z URL (jeśli join=1)
  useEffect(() => {
    if (joinFlag && urlJoinCode && !regCode) setRegCode(urlJoinCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinFlag, urlJoinCode]);

  // po zmianie kodu resetujemy weryfikację
  useEffect(() => {
    setVerified(false);
    setRegInfo(null);
    setRegError(null);
  }, [regCode]);

  const nextParam = encodeURIComponent(location.pathname + location.search);

  const qs = useMemo(() => {
    const c = code.trim();
    return c ? `?code=${encodeURIComponent(c)}` : "";
  }, [code]);

  const publicMatches = useMemo(() => matches.filter((m) => !isByePublic(m)), [matches]);

  const loadMyMatches = async () => {
    if (!id || !isLogged) return;
    try {
      const res = await apiFetch(`/api/tournaments/${id}/registrations/my/matches/`);
      if (!res.ok) return;

      const data = await res.json().catch(() => []);
      const list: MatchPublicDTO[] = Array.isArray(data) ? data : [];
      setMyMatches(list.filter((m) => !isByePublic(m)));
    } catch {
      // nie blokujemy całej strony
    }
  };

  const loadTournamentAndMatches = async () => {
    if (!id) return;

    setError(null);

    // 1) turniej publiczny
    const tRes = await apiFetch(`/api/tournaments/${id}/${qs}`);
    if (tRes.status === 403) {
      const data = await tRes.json().catch(() => null);
      const msg = data?.detail || "Brak dostępu.";
      if (String(msg).toLowerCase().includes("kod")) setNeedsCode(true);
      throw new Error(msg);
    }
    if (!tRes.ok) throw new Error("Nie udało się pobrać danych turnieju.");

    setNeedsCode(false);

    const tData = await tRes.json();
    const t: TournamentPublicDTO = {
      id: tData.id,
      name: tData.name,
      description: tData.description ?? null,
      start_date: tData.start_date ?? null,
      end_date: tData.end_date ?? null,
      location: tData.location ?? null,
      is_published: tData.is_published,

      entry_mode: tData.entry_mode,
      competition_type: tData.competition_type,
      my_role: tData.my_role ?? null,

      // ✅ toggle dołączania przez konto + kod (NOWY KONTRAKT)
      allow_join_by_code: Boolean(tData.allow_join_by_code),
      join_code: tData.join_code ?? null,
    };
    setTournament(t);

    // 2) mecze publiczne
    const mRes = await apiFetch(`/api/tournaments/${id}/public/matches/${qs}`);
    if (mRes.status === 403) {
      const data = await mRes.json().catch(() => null);
      const msg = data?.detail || "Brak dostępu.";
      if (String(msg).toLowerCase().includes("kod")) setNeedsCode(true);
      setMatches([]);
      return;
    }
    if (!mRes.ok) throw new Error("Nie udało się pobrać meczów.");

    const raw = await mRes.json();
    const list: MatchPublicDTO[] = Array.isArray(raw) ? raw : Array.isArray(raw?.results) ? raw.results : [];
    setMatches(list);
  };

  const loadRegistrationMe = async () => {
    if (!id || !isLogged) {
      setRegMe(null);
      return;
    }

    const res = await apiFetch(`/api/tournaments/${id}/registrations/me/`);
    if (res.status === 404) {
      setRegMe(null);
      return;
    }
    if (!res.ok) {
      setRegMe(null);
      return;
    }

    const data = (await res.json().catch(() => null)) as RegistrationMeDTO | null;
    if (data?.display_name) {
      setRegMe({ display_name: data.display_name, team_id: data.team_id ?? null });
      setDisplayName(data.display_name);
      loadMyMatches();
    } else {
      setRegMe(null);
    }
  };

  useEffect(() => {
    loadTournamentAndMatches().catch((e: any) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, qs]);

  useEffect(() => {
    loadRegistrationMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const dateRange = formatDateRange(tournament?.start_date ?? null, tournament?.end_date ?? null);

  const verifyRegistrationCode = async () => {
    if (!id) return;

    setRegError(null);
    setRegInfo(null);

    const c = regCode.trim();
    if (!c) {
      setRegError("Wpisz kod dołączania.");
      return;
    }

    setRegBusy(true);
    try {
      const res = await apiFetch(`/api/tournaments/${id}/registrations/verify/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: c }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || "Nie udało się zweryfikować kodu.");

      setVerified(true);
      setRegInfo("Kod poprawny. Uzupełnij nazwę i zapisz się do turnieju.");
    } catch (e: any) {
      setVerified(false);
      setRegError(e?.message ?? "Błąd weryfikacji kodu.");
    } finally {
      setRegBusy(false);
    }
  };

  const joinOrRename = async () => {
    if (!id) return;

    setRegError(null);
    setRegInfo(null);

    const c = regCode.trim();
    const dn = normalizeName(displayName);

    if (!c) {
      setRegError("Wpisz kod dołączania.");
      return;
    }
    if (!dn) {
      setRegError("Podaj nazwę drużyny / imię i nazwisko.");
      return;
    }

    const wasRegistered = !!regMe;

    setRegBusy(true);
    try {
      const res = await apiFetch(`/api/tournaments/${id}/registrations/join/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: c, display_name: dn }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || "Nie udało się zapisać do turnieju.");

      await loadRegistrationMe();

      setRegInfo(wasRegistered ? "Zmieniono nazwę." : "Zapisano do turnieju.");
      setRegError(null);

      // jeśli weszliśmy przez join=1, czyścimy tylko flagę (zostawiamy ewentualny code= do podglądu)
      if (joinFlag) {
        const keepAccess = code.trim() ? `?code=${encodeURIComponent(code.trim())}` : "";
        navigate(location.pathname + keepAccess, { replace: true });
      }
    } catch (e: any) {
      setRegError(e?.message ?? "Błąd rejestracji.");
    } finally {
      setRegBusy(false);
    }
  };

  const showJoinPanel = Boolean(tournament?.allow_join_by_code) && (joinFlag || !!regMe);

  return (
    <div style={{ padding: "2rem", maxWidth: 980 }}>
      <div style={{ marginBottom: "1.25rem" }}>
        <h1 style={{ marginBottom: 6 }}>{tournament?.name ?? "Turniej"}</h1>

        {tournament?.description ? (
          <p style={{ opacity: 0.85, marginTop: 0, maxWidth: 820 }}>{tournament.description}</p>
        ) : (
          <p style={{ opacity: 0.7, marginTop: 0, maxWidth: 820 }}>Strona publiczna turnieju.</p>
        )}

        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", opacity: 0.85 }}>
          {dateRange ? (
            <div>
              <strong>Termin:</strong> {dateRange}
            </div>
          ) : null}
          {tournament?.location ? (
            <div>
              <strong>Miejsce:</strong> {tournament.location}
            </div>
          ) : null}
        </div>

        {showJoinPanel && (
          <section
            style={{
              marginTop: "1.25rem",
              padding: "1rem",
              border: "1px solid #333",
              borderRadius: 12,
              maxWidth: 560,
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: 6 }}>Dołącz do turnieju</h3>

            {!isLogged ? (
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ opacity: 0.85 }}>
                  Aby dołączyć, musisz się zalogować lub utworzyć konto.
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <Link
                    to={`/login?next=${nextParam}`}
                    style={{
                      border: "1px solid #444",
                      padding: "0.45rem 0.75rem",
                      borderRadius: 10,
                      textDecoration: "none",
                      display: "inline-block",
                    }}
                  >
                    Zaloguj
                  </Link>
                  <Link
                    to={`/login?mode=register&next=${nextParam}`}
                    style={{
                      border: "1px solid #444",
                      padding: "0.45rem 0.75rem",
                      borderRadius: 10,
                      textDecoration: "none",
                      display: "inline-block",
                    }}
                  >
                    Zarejestruj konto
                  </Link>
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {regMe ? (
                  <div style={{ opacity: 0.9 }}>
                    Jesteś zapisany jako: <strong>{regMe.display_name}</strong>
                    {!tournament?.is_published && (
                      <div style={{ marginTop: 6, opacity: 0.75 }}>
                        Turniej nie jest opublikowany — widok publiczny może być ograniczony.
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ opacity: 0.9 }}>
                    Wpisz kod dołączania i uzupełnij nazwę uczestnika.
                  </div>
                )}

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input
                    value={regCode}
                    onChange={(e) => setRegCode(e.target.value)}
                    placeholder="Kod dołączania"
                    style={{ flex: 1, minWidth: 220, padding: "0.55rem" }}
                  />
                  <button onClick={verifyRegistrationCode} disabled={regBusy} style={{ padding: "0.55rem 0.9rem" }}>
                    {regBusy ? "…" : "Sprawdź kod"}
                  </button>
                </div>

                {(verified || !!regMe) && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <input
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder={tournament?.competition_type === "INDIVIDUAL" ? "Imię i nazwisko" : "Nazwa drużyny"}
                      style={{ flex: 1, minWidth: 220, padding: "0.55rem" }}
                    />
                    <button onClick={joinOrRename} disabled={regBusy} style={{ padding: "0.55rem 0.9rem" }}>
                      {regBusy ? "…" : regMe ? "Zmień nazwę" : "Dołącz"}
                    </button>
                  </div>
                )}

                {regError && <div style={{ color: "crimson" }}>{regError}</div>}
                {regInfo && <div style={{ opacity: 0.85 }}>{regInfo}</div>}
              </div>
            )}
          </section>
        )}

        {(joinFlag || !!regMe) && !tournament?.allow_join_by_code && (
          <section
            style={{
              marginTop: "1.25rem",
              padding: "1rem",
              border: "1px solid #333",
              borderRadius: 12,
              maxWidth: 560,
              opacity: 0.9,
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: 6 }}>Dołączanie do turnieju</h3>
            <div>Dołączanie przez konto i kod nie jest włączone dla tego turnieju.</div>
          </section>
        )}

        <div style={{ marginTop: "1rem", display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={() => setView("MATCHES")}
            style={{
              padding: "0.55rem 0.9rem",
              borderRadius: 10,
              border: "1px solid #444",
              background: view === "MATCHES" ? "rgba(255,255,255,0.10)" : "transparent",
              color: "#fff",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Mecze
          </button>

          <button
            onClick={() => setView("STANDINGS")}
            style={{
              padding: "0.55rem 0.9rem",
              borderRadius: 10,
              border: "1px solid #444",
              background: view === "STANDINGS" ? "rgba(255,255,255,0.10)" : "transparent",
              color: "#fff",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Tabela / Drabinka
          </button>
        </div>
      </div>

      {error && <div style={{ marginBottom: "1rem", color: "crimson" }}>{error}</div>}

      {needsCode && (
        <section
          style={{
            marginBottom: "1.25rem",
            padding: "1rem",
            border: "1px solid #333",
            borderRadius: 10,
            maxWidth: 420,
          }}
        >
          <h3 style={{ marginTop: 0 }}>Kod dostępu</h3>
          <p style={{ opacity: 0.8, marginTop: 0 }}>Ten turniej wymaga kodu. Wpisz kod i odśwież dane.</p>

          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Wpisz kod"
              style={{ flex: 1, padding: "0.5rem" }}
            />
            <button
              onClick={() => loadTournamentAndMatches().catch((e: any) => setError(e.message))}
              style={{ padding: "0.5rem 0.9rem" }}
            >
              Otwórz
            </button>
          </div>
        </section>
      )}

      {view === "MATCHES" ? (
        <div>
          {regMe && tournament?.is_published && (
            <section style={{ marginBottom: "1.5rem" }}>
              <h2 style={{ margin: "0 0 0.5rem 0" }}>Moje mecze</h2>

              {myMatches.length === 0 ? (
                <div style={{ opacity: 0.75 }}>Brak meczów do wyświetlenia (albo nie ma jeszcze przypisanych spotkań).</div>
              ) : (
                <div style={{ border: "1px solid #333", borderRadius: 12, padding: "0.75rem 1rem" }}>
                  {myMatches.map((m) => (
                    <div
                      key={m.id}
                      style={{
                        borderBottom: "1px solid #333",
                        padding: "0.75rem 0",
                        display: "flex",
                        gap: "1rem",
                        justifyContent: "space-between",
                        flexWrap: "wrap",
                      }}
                    >
                      <div style={{ minWidth: 260 }}>
                        <div style={{ fontWeight: 700 }}>
                          {m.home_team_name} <span style={{ opacity: 0.6 }}>vs</span> {m.away_team_name}
                        </div>
                        <div style={{ opacity: 0.75, fontSize: "0.9rem", marginTop: 4 }}>
                          {[m.scheduled_date, m.scheduled_time, m.location].filter(Boolean).join(" • ")}
                        </div>
                      </div>

                      <div style={{ textAlign: "right", minWidth: 140 }}>
                        {typeof m.home_score === "number" && typeof m.away_score === "number" ? (
                          <div style={{ fontWeight: 800 }}>
                            {m.home_score} : {m.away_score}
                          </div>
                        ) : (
                          <div style={{ opacity: 0.55 }} />
                        )}
                        <div style={{ opacity: 0.75, fontSize: "0.85rem" }}>{m.status ?? ""}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          <PublicMatchesPanel matches={publicMatches} />
        </div>
      ) : id ? (
        <StandingsBracket tournamentId={Number(id)} accessCode={code.trim() || undefined} />
      ) : null}
    </div>
  );
}
