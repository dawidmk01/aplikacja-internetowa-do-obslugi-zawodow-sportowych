import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";

// --- TYPY ---

type StandingRow = {
  team_id: number;
  team_name: string;

  played?: number;
  wins?: number;
  draws?: number;
  losses?: number;

  goals_for?: number;
  goals_against?: number;
  goal_difference?: number;

  points?: number;

  [k: string]: any;
};

type StandingsGroup = {
  group_id?: number | string;
  group_name: string;
  table: StandingRow[];
};

type BracketMatch = {
  id: number;
  home_team_name?: string | null;
  away_team_name?: string | null;
  home_score?: number | null;
  away_score?: number | null;
  status?: string | null;

  // opcjonalnie: opis (np. "Dwumecz / Σ")
  note?: string | null;
};

type BracketRound = {
  name?: string | null;
  round_number?: number | null;
  matches: BracketMatch[];
};

type StandingsResponse = {
  table?: StandingRow[];
  groups?: StandingsGroup[];
  bracket?: { rounds?: BracketRound[]; third_place?: BracketMatch | null };
  meta?: any;
};

type ViewTab = "TABLE" | "BRACKET";

// --- POMOCNIKI ---

function isObj(v: any): v is Record<string, any> {
  return v != null && typeof v === "object";
}

function toNumberOrNull(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeRow(raw: any, idx: number): StandingRow {
  const teamIdRaw =
    raw?.team_id ??
    raw?.teamId ??
    raw?.team ??
    raw?.team?.id ??
    raw?.participant_id ??
    raw?.player_id ??
    raw?.id;

  let team_id = Number(teamIdRaw);
  if (!Number.isFinite(team_id)) team_id = -(idx + 1);

  const team_name =
    String(
      raw?.team_name ??
        raw?.teamName ??
        (isObj(raw?.team) ? raw.team.name : null) ??
        raw?.name ??
        raw?.display_name ??
        raw?.participant_name ??
        raw?.player_name ??
        ""
    ) || "";

  return { ...raw, team_id, team_name };
}

/**
 * Backend KO: zwykle masz:
 * - score_leg1_home/away
 * - score_leg2_home/away
 * - aggregate_home/away
 * - is_two_legged
 *
 * A NIE home_score/away_score
 */
function duelToBracketMatch(raw: any, fallbackId: number): BracketMatch {
  const idRaw = raw?.id ?? raw?.match_id ?? raw?.matchId ?? raw?.pk;
  const id = Number.isFinite(Number(idRaw)) ? Number(idRaw) : fallbackId;

  const home_team_name =
    (raw?.home_team_name ?? raw?.homeTeamName ?? raw?.home_name ?? raw?.home ?? "") || "";
  const away_team_name =
    (raw?.away_team_name ?? raw?.awayTeamName ?? raw?.away_name ?? raw?.away ?? "") || "";

  const isTwoLegged = !!(raw?.is_two_legged ?? raw?.isTwoLegged);

  const aH = toNumberOrNull(raw?.aggregate_home);
  const aA = toNumberOrNull(raw?.aggregate_away);

  const l1H = toNumberOrNull(raw?.score_leg1_home ?? raw?.home_score ?? raw?.homeScore);
  const l1A = toNumberOrNull(raw?.score_leg1_away ?? raw?.away_score ?? raw?.awayScore);

  const l2H = toNumberOrNull(raw?.score_leg2_home);
  const l2A = toNumberOrNull(raw?.score_leg2_away);

  // preferuj agregat jeśli jest
  let home_score: number | null = null;
  let away_score: number | null = null;
  let note: string | null = null;

  if (aH != null && aA != null) {
    home_score = aH;
    away_score = aA;
    note = isTwoLegged ? "Σ" : null;
  } else if (isTwoLegged) {
    // jeśli brak aggregate, policz z legów
    const sumH = (l1H ?? 0) + (l2H ?? 0);
    const sumA = (l1A ?? 0) + (l2A ?? 0);

    if (l1H != null || l2H != null || l1A != null || l2A != null) {
      home_score = sumH;
      away_score = sumA;
      note = "Σ";
    } else {
      home_score = null;
      away_score = null;
    }
  } else {
    // single-leg
    home_score = l1H;
    away_score = l1A;
  }

  const status = (raw?.status ?? raw?.state ?? null) as any;

  return { id, home_team_name, away_team_name, home_score, away_score, status, note };
}

function normalizeBracket(raw: any): { rounds?: BracketRound[]; third_place?: BracketMatch | null } | undefined {
  // Źródło rund: bracket.rounds
  const roundsRaw =
    (Array.isArray(raw?.bracket?.rounds) ? raw.bracket.rounds : null) ??
    (Array.isArray(raw?.rounds) ? raw.rounds : null) ??
    null;

  const thirdPlaceRaw = raw?.bracket?.third_place ?? raw?.third_place ?? null;

  const rounds: BracketRound[] = (roundsRaw ?? []).map((r: any, ri: number) => {
    // backend: items[]
    const itemsRaw =
      (Array.isArray(r?.items) ? r.items : null) ??
      (Array.isArray(r?.matches) ? r.matches : null) ??
      (Array.isArray(r?.games) ? r.games : null) ??
      [];

    const matches: BracketMatch[] = itemsRaw.map((m: any, mi: number) =>
      duelToBracketMatch(m, -(ri * 1000 + mi + 1))
    );

    return {
      name: (r?.label ?? r?.name ?? r?.round_name ?? null) as any,
      round_number: toNumberOrNull(r?.round_number ?? r?.roundNumber ?? r?.number),
      matches,
    };
  });

  const third_place = thirdPlaceRaw ? duelToBracketMatch(thirdPlaceRaw, -999999) : null;

  // jeśli nie ma nic w ogóle, zwróć undefined
  const hasAny = rounds.some((x) => (x.matches?.length ?? 0) > 0) || !!third_place;
  if (!hasAny) return undefined;

  return { rounds, third_place };
}

function normalizeStandings(raw: any): StandingsResponse {
  const out: StandingsResponse = { ...raw };

  // table
  if (Array.isArray(raw?.table)) {
    out.table = raw.table.map((r: any, i: number) => normalizeRow(r, i));
  } else {
    out.table = out.table ?? [];
  }

  // groups
  if (Array.isArray(raw?.groups)) {
    out.groups = raw.groups.map((g: any, gi: number) => {
      const tableRaw = Array.isArray(g?.table) ? g.table : [];
      return {
        group_id: g?.group_id ?? g?.id ?? `${g?.group_name ?? "group"}-${gi}`,
        group_name: g?.group_name ?? g?.name ?? `Grupa ${gi + 1}`,
        table: tableRaw.map((r: any, i: number) => normalizeRow(r, gi * 1000 + i)),
      };
    });
  } else {
    out.groups = out.groups ?? [];
  }

  // bracket
  const bracketNormalized = normalizeBracket(raw);
  if (bracketNormalized) out.bracket = bracketNormalized;

  return out;
}

// --- KOMPONENT GŁÓWNY ---

export default function StandingsBracket({
  tournamentId,
  accessCode,
  defaultTab = "TABLE",
}: {
  tournamentId?: number;
  accessCode?: string;
  defaultTab?: ViewTab;
}) {
  const [tab, setTab] = useState<ViewTab>(defaultTab);

  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState(accessCode ?? "");

  const [data, setData] = useState<StandingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // sync z rodzicem (jak wpiszesz kod na stronie publicznej)
  useEffect(() => {
    setCode(accessCode ?? "");
  }, [accessCode]);

  // solidny turniejId (fallback: wyciągnij z URL)
  const tid = useMemo(() => {
    const n = Number(tournamentId);
    if (Number.isFinite(n) && n > 0) return n;

    // fallback: /tournaments/119
    const m = window.location.pathname.match(/\/tournaments\/(\d+)/);
    if (m?.[1]) {
      const x = Number(m[1]);
      if (Number.isFinite(x) && x > 0) return x;
    }

    return NaN;
  }, [tournamentId]);

  const qs = useMemo(() => {
    const c = (code || "").trim();
    return c ? `?code=${encodeURIComponent(c)}` : "";
  }, [code]);

  useEffect(() => {
    if (!Number.isFinite(tid)) {
      setLoading(false);
      setError("Brak poprawnego ID turnieju (tournamentId).");
      setData(null);
      return;
    }

    const load = async () => {
      setLoading(true);
      setError(null);

      const res = await apiFetch(`/api/tournaments/${tid}/standings/${qs}`);

      if (res.status === 403) {
        const payload = await res.json().catch(() => null);
        const msg = payload?.detail || "Brak dostępu.";
        if (String(msg).toLowerCase().includes("kod")) setNeedsCode(true);
        setError(msg);
        setData(null);
        setLoading(false);
        return;
      }

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.detail || "Nie udało się pobrać tabeli/drabinki.");
      }

      setNeedsCode(false);

      const raw = await res.json().catch(() => ({}));
      setData(normalizeStandings(raw));
      setLoading(false);
    };

    load().catch((e: any) => {
      setError(e?.message || "Wystąpił błąd");
      setLoading(false);
    });
  }, [tid, qs]);

  const hasTable = (data?.groups?.length ?? 0) > 0 || (data?.table?.length ?? 0) > 0;

  const hasBracket =
    (data?.bracket?.rounds ?? []).some((r) => (r.matches?.length ?? 0) > 0) || !!data?.bracket?.third_place;

  useEffect(() => {
    if (!loading && !hasTable && hasBracket) setTab("BRACKET");
  }, [loading, hasTable, hasBracket]);

  if (needsCode) {
    return (
      <section style={{ marginTop: "1rem", padding: "1rem", border: "1px solid #333", borderRadius: 10, maxWidth: 420 }}>
        <h3 style={{ marginTop: 0 }}>Kod dostępu</h3>
        <p style={{ opacity: 0.8, marginTop: 0 }}>Ten turniej wymaga kodu, aby wyświetlić tabelę/drabinkę.</p>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Wpisz kod" style={{ flexflex: 1, padding: "0.5rem" } as any} />
          <button onClick={() => setCode((c) => c.trim())} style={{ padding: "0.5rem 0.9rem", cursor: "pointer" }}>
            Zastosuj
          </button>
        </div>
        {error && <div style={{ marginTop: 10, color: "crimson" }}>{error}</div>}
      </section>
    );
  }

  if (loading) return <div style={{ opacity: 0.75 }}>Ładowanie tabeli/drabinki…</div>;
  if (error) return <div style={{ color: "crimson" }}>{error}</div>;
  if (!data) return <div style={{ opacity: 0.75 }}>Brak danych z API.</div>;

  return (
    <div style={{ marginTop: "1rem" }}>
      {hasTable && hasBracket && (
        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          <button
            onClick={() => setTab("TABLE")}
            style={{
              padding: "0.45rem 0.8rem",
              borderRadius: 10,
              border: "1px solid #444",
              background: tab === "TABLE" ? "rgba(255,255,255,0.10)" : "transparent",
              color: "#fff",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Tabela
          </button>
          <button
            onClick={() => setTab("BRACKET")}
            style={{
              padding: "0.45rem 0.8rem",
              borderRadius: 10,
              border: "1px solid #444",
              background: tab === "BRACKET" ? "rgba(255,255,255,0.10)" : "transparent",
              color: "#fff",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Drabinka
          </button>
        </div>
      )}

      {tab === "TABLE" ? (
        hasTable ? (
          (data.groups?.length ?? 0) > 0 ? (
            <div>
              {data.groups!.map((g, idx) => (
                <div key={String(g.group_id ?? idx)} style={{ marginBottom: "1.5rem" }}>
                  <h3 style={{ margin: "0 0 0.6rem 0", opacity: 0.9 }}>{g.group_name || `Grupa ${idx + 1}`}</h3>
                  <StandingsTable rows={g.table} />
                </div>
              ))}
            </div>
          ) : (
            <StandingsTable rows={data.table ?? []} />
          )
        ) : (
          <div style={{ opacity: 0.75 }}>Brak danych tabeli.</div>
        )
      ) : hasBracket ? (
        <BracketView rounds={data.bracket?.rounds ?? []} thirdPlace={data.bracket?.third_place ?? null} />
      ) : (
        <div style={{ opacity: 0.75 }}>Brak danych drabinki.</div>
      )}
    </div>
  );
}

// --- SUBKOMPONENTY ---

function StandingsTable({ rows }: { rows: StandingRow[] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680, color: "#ddd" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #444", textAlign: "left" }}>
            <th style={{ padding: "10px" }}>LP</th>
            <th style={{ padding: "10px" }}>Drużyna</th>
            <th>M</th>
            <th>W</th>
            <th>R</th>
            <th>P</th>
            <th>Br</th>
            <th>+/-</th>
            <th>Pkt</th>
          </tr>
        </thead>
        <tbody>
          {(rows ?? []).map((r, i) => {
            const gf = Number(r.goals_for ?? 0);
            const ga = Number(r.goals_against ?? 0);
            const gd = Number.isFinite(Number(r.goal_difference)) ? Number(r.goal_difference) : gf - ga;

            return (
              <tr key={String(r.team_id)} style={{ borderBottom: "1px solid #333" }}>
                <td style={{ padding: "10px" }}>{i + 1}</td>
                <td style={{ padding: "10px", fontWeight: 800 }}>{r.team_name}</td>
                <td>{r.played ?? ""}</td>
                <td>{r.wins ?? ""}</td>
                <td>{r.draws ?? ""}</td>
                <td>{r.losses ?? ""}</td>
                <td>{`${gf}:${ga}`}</td>
                <td>{gd}</td>
                <td>{r.points ?? ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BracketView({ rounds, thirdPlace }: { rounds: BracketRound[]; thirdPlace: BracketMatch | null }) {
  return (
    <div style={{ display: "flex", gap: 16, overflowX: "auto", paddingBottom: 10 }}>
      {(rounds ?? []).map((r, idx) => (
        <div key={idx} style={{ minWidth: 260, border: "1px solid #333", borderRadius: 12, padding: 10 }}>
          <div style={{ fontWeight: 900, marginBottom: 10, opacity: 0.9 }}>
            {r.name || (r.round_number ? `Runda ${r.round_number}` : `Runda ${idx + 1}`)}
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            {(r.matches ?? []).map((m) => (
              <div key={m.id} style={{ border: "1px solid #333", borderRadius: 10, padding: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{m.home_team_name || ""}</div>
                    <div style={{ fontWeight: 700 }}>{m.away_team_name || ""}</div>
                    {m.note ? <div style={{ opacity: 0.7, fontSize: "0.8rem", marginTop: 4 }}>Wynik: {m.note}</div> : null}
                  </div>
                  <div style={{ textAlign: "right", minWidth: 60 }}>
                    <div style={{ fontWeight: 900 }}>{m.home_score ?? ""}</div>
                    <div style={{ fontWeight: 900 }}>{m.away_score ?? ""}</div>
                  </div>
                </div>
                {m.status ? <div style={{ marginTop: 6, opacity: 0.75, fontSize: "0.85rem" }}>{m.status}</div> : null}
              </div>
            ))}
          </div>
        </div>
      ))}

      {thirdPlace ? (
        <div style={{ minWidth: 260, border: "1px dashed #555", borderRadius: 12, padding: 10 }}>
          <div style={{ fontWeight: 900, marginBottom: 10, opacity: 0.9 }}>Mecz o 3. miejsce</div>
          <div style={{ border: "1px solid #333", borderRadius: 10, padding: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <div>
                <div style={{ fontWeight: 700 }}>{thirdPlace.home_team_name || ""}</div>
                <div style={{ fontWeight: 700 }}>{thirdPlace.away_team_name || ""}</div>
                {thirdPlace.note ? <div style={{ opacity: 0.7, fontSize: "0.8rem", marginTop: 4 }}>Wynik: {thirdPlace.note}</div> : null}
              </div>
              <div style={{ textAlign: "right", minWidth: 60 }}>
                <div style={{ fontWeight: 900 }}>{thirdPlace.home_score ?? ""}</div>
                <div style={{ fontWeight: 900 }}>{thirdPlace.away_score ?? ""}</div>
              </div>
            </div>
            {thirdPlace.status ? <div style={{ marginTop: 6, opacity: 0.75, fontSize: "0.85rem" }}>{thirdPlace.status}</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
