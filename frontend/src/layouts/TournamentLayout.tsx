import { useEffect, useState } from "react";
import { Link, Outlet, useParams, useLocation } from "react-router-dom";
import TournamentFlowNav from "../components/TournamentFlowNav";
import { TournamentFlowGuardProvider } from "../flow/TournamentFlowGuardContext";
import TournamentStepFooter from "../components/TournamentStepFooter";
import { apiGet } from "../api";

type TournamentLite = {
  id: number;
  my_role: "ORGANIZER" | "ASSISTANT" | "PARTICIPANT" | null;
  name?: string;
};

function canOpenPanel(t: TournamentLite) {
  // Nowa strategia: asystent wchodzi do panelu (podgląd),
  // blokujemy dopiero konkretne akcje per-permission.
  return t.my_role === "ORGANIZER" || t.my_role === "ASSISTANT";
}

function isAuthError(message: string) {
  const m = (message || "").toLowerCase();
  return m.includes("401") || m.includes("403") || m.includes("unauthorized") || m.includes("forbidden");
}

export default function TournamentLayout() {
  const { id } = useParams<{ id: string }>();
  const loc = useLocation();

  const [tournament, setTournament] = useState<TournamentLite | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    setLoading(true);
    setErr(null);
    setTournament(null);

    apiGet<TournamentLite>(`/api/tournaments/${id}/`)
      .then(setTournament)
      .catch((e) => setErr(e?.message ?? "Błąd pobierania turnieju."))
      .finally(() => setLoading(false));
  }, [id]);

  if (!id) return null;

  // Stan: ładowanie / błąd
  if (loading) {
    return (
      <TournamentFlowGuardProvider>
        <div style={{ padding: "2rem", maxWidth: 900 }}>
          <p>Ładowanie…</p>
        </div>
      </TournamentFlowGuardProvider>
    );
  }

  if (err) {
    const next = encodeURIComponent(loc.pathname + loc.search);

    return (
      <TournamentFlowGuardProvider>
        <div style={{ padding: "2rem", maxWidth: 900 }}>
          <div
            style={{
              border: "1px solid #333",
              borderRadius: 10,
              padding: "1rem",
              display: "grid",
              gap: 10,
            }}
          >
            <div style={{ fontWeight: 800, fontSize: "1.05rem" }}>Nie można otworzyć panelu</div>

            <div style={{ opacity: 0.9 }}>{err}</div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link
                to={`/tournaments/${id}`}
                style={{
                  border: "1px solid #444",
                  padding: "0.45rem 0.75rem",
                  borderRadius: 8,
                  textDecoration: "none",
                  display: "inline-block",
                }}
              >
                Przejdź do podglądu
              </Link>

              {isAuthError(err) && (
                <Link
                  to={`/login?next=${next}`}
                  style={{
                    border: "1px solid #444",
                    padding: "0.45rem 0.75rem",
                    borderRadius: 8,
                    textDecoration: "none",
                    display: "inline-block",
                  }}
                >
                  Zaloguj się
                </Link>
              )}

              <Link
                to="/my-tournaments"
                style={{
                  border: "1px solid #444",
                  padding: "0.45rem 0.75rem",
                  borderRadius: 8,
                  textDecoration: "none",
                  display: "inline-block",
                }}
              >
                Wróć do moich turniejów
              </Link>
            </div>
          </div>
        </div>
      </TournamentFlowGuardProvider>
    );
  }

  // Stan: pobrano turniej, ale rola nie daje dostępu do panelu
  if (tournament && !canOpenPanel(tournament)) {
    return (
      <TournamentFlowGuardProvider>
        <div style={{ padding: "2rem", maxWidth: 900 }}>
          <div
            style={{
              border: "1px solid #333",
              borderRadius: 10,
              padding: "1rem",
              display: "grid",
              gap: 10,
            }}
          >
            <div style={{ fontWeight: 800, fontSize: "1.05rem" }}>Brak dostępu do panelu</div>

            <div style={{ opacity: 0.9 }}>
              Turniej: <b>{tournament.name ?? `#${tournament.id}`}</b>
            </div>

            <div style={{ opacity: 0.9 }}>Ta część jest dostępna tylko dla organizatora i asystentów.</div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link
                to={`/tournaments/${id}`}
                style={{
                  border: "1px solid #444",
                  padding: "0.45rem 0.75rem",
                  borderRadius: 8,
                  textDecoration: "none",
                  display: "inline-block",
                }}
              >
                Przejdź do podglądu
              </Link>

              <Link
                to="/my-tournaments"
                style={{
                  border: "1px solid #444",
                  padding: "0.45rem 0.75rem",
                  borderRadius: 8,
                  textDecoration: "none",
                  display: "inline-block",
                }}
              >
                Wróć do moich turniejów
              </Link>
            </div>
          </div>
        </div>
      </TournamentFlowGuardProvider>
    );
  }

  // Stan: panel dostępny
  return (
    <TournamentFlowGuardProvider>
      <div style={{ padding: "2rem", maxWidth: 900 }}>
        <TournamentFlowNav />
        <Outlet />
        <TournamentStepFooter />
      </div>
    </TournamentFlowGuardProvider>
  );
}

