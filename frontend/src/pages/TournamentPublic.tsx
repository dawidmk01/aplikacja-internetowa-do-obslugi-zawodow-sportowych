import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { apiFetch } from "../api";
import PublicMatchesPanel from "../components/PublicMatchesPanel";
import type { MatchPublicDTO } from "../components/PublicMatchesPanel";
import StandingsBracket from "../components/StandingsBracket";

type TournamentPublicDTO = {
  id: number;
  name: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  location: string | null;
  is_published?: boolean;
};

function formatDateRange(start: string | null, end: string | null) {
  if (!start && !end) return null;
  if (start && end) return `${start} - ${end}`; // bez "—"
  return start ?? end;
}

function isByePublic(m: MatchPublicDTO): boolean {
  const h = (m.home_team_name ?? "").toUpperCase();
  const a = (m.away_team_name ?? "").toUpperCase();
  const needles = ["BYE", "__SYSTEM_BYE__", "WOLNY LOS"];
  return needles.some((n) => h.includes(n) || a.includes(n));
}

type ViewTab = "MATCHES" | "STANDINGS";

export default function TournamentPublic({ initialView = "MATCHES" }: { initialView?: ViewTab } = {}) {
  const { id } = useParams<{ id: string }>();

  const [tournament, setTournament] = useState<TournamentPublicDTO | null>(null);
  const [matches, setMatches] = useState<MatchPublicDTO[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState("");

  const [view, setView] = useState<ViewTab>(initialView);

  const qs = useMemo(() => {
    const c = code.trim();
    return c ? `?code=${encodeURIComponent(c)}` : "";
  }, [code]);

  const load = async () => {
    if (!id) return;

    setError(null);

    const [tRes, mRes] = await Promise.all([
      apiFetch(`/api/tournaments/${id}/${qs}`),
      apiFetch(`/api/tournaments/${id}/public/matches/${qs}`),
    ]);

    const handle403 = async (res: Response) => {
      const data = await res.json().catch(() => null);
      const msg = data?.detail || "Brak dostępu.";
      if (String(msg).toLowerCase().includes("kod")) setNeedsCode(true);
      throw new Error(msg);
    };

    if (tRes.status === 403) await handle403(tRes);
    if (mRes.status === 403) await handle403(mRes);

    if (!tRes.ok) throw new Error("Nie udało się pobrać danych turnieju.");
    if (!mRes.ok) throw new Error("Nie udało się pobrać meczów.");

    setNeedsCode(false);

    const tData = await tRes.json();
    setTournament({
      id: tData.id,
      name: tData.name,
      description: tData.description ?? null,
      start_date: tData.start_date ?? null,
      end_date: tData.end_date ?? null,
      location: tData.location ?? null,
      is_published: tData.is_published,
    });

    const raw = await mRes.json();
    const list: MatchPublicDTO[] = Array.isArray(raw) ? raw : Array.isArray(raw?.results) ? raw.results : [];
    setMatches(list);
  };

  useEffect(() => {
    load().catch((e: any) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const publicMatches = useMemo(() => matches.filter((m) => !isByePublic(m)), [matches]);
  const dateRange = formatDateRange(tournament?.start_date ?? null, tournament?.end_date ?? null);

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
        <section style={{ marginBottom: "1.25rem", padding: "1rem", border: "1px solid #333", borderRadius: 10, maxWidth: 420 }}>
          <h3 style={{ marginTop: 0 }}>Kod dostępu</h3>
          <p style={{ opacity: 0.8, marginTop: 0 }}>Ten turniej wymaga kodu. Wpisz kod i odśwież dane.</p>

          <div style={{ display: "flex", gap: 8 }}>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Wpisz kod" style={{ flex: 1, padding: "0.5rem" }} />
            <button onClick={() => load().catch((e: any) => setError(e.message))} style={{ padding: "0.5rem 0.9rem" }}>
              Otwórz
            </button>
          </div>
        </section>
      )}

      {view === "MATCHES" ? (
        <PublicMatchesPanel matches={publicMatches} />
      ) : id ? (
        <StandingsBracket tournamentId={Number(id)} accessCode={code.trim() || undefined} />
      ) : null}
    </div>
  );
}
