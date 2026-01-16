import { useEffect, useMemo, useState } from "react";
import { Link, Outlet, useParams } from "react-router-dom";
import TournamentFlowNav from "../components/TournamentFlowNav";
import { TournamentFlowGuardProvider } from "../flow/TournamentFlowGuardContext";
import TournamentStepFooter from "../components/TournamentStepFooter";
import { apiGet } from "../api";

type TournamentLite = {
  id: number;
  entry_mode?: "MANAGER" | "ORGANIZER_ONLY" | "SELF_REGISTER";
  my_role: "ORGANIZER" | "ASSISTANT" | "PARTICIPANT" | null;
  name?: string;
};

function entryModeLabel(v?: TournamentLite["entry_mode"]) {
  const m = v ?? "MANAGER";
  if (m === "MANAGER") return "Organizator + asystent";
  if (m === "ORGANIZER_ONLY") return "Tylko organizator";
  if (m === "SELF_REGISTER") return "Self-register";
  return "—";
}

function canUsePanel(t: TournamentLite) {
  const mode = t.entry_mode ?? "MANAGER";
  if (t.my_role === "ORGANIZER") return true;
  if (t.my_role === "ASSISTANT") return mode === "MANAGER";
  return false;
}

export default function TournamentLayout() {
  const { id } = useParams<{ id: string }>();
  const [tournament, setTournament] = useState<TournamentLite | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    setLoading(true);
    setErr(null);

    apiGet<TournamentLite>(`/api/tournaments/${id}/`)
      .then(setTournament)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  const panelEnabled = useMemo(() => {
    if (!tournament) return false;
    return canUsePanel(tournament);
  }, [tournament]);

  if (!id) return null;

  return (
    <TournamentFlowGuardProvider>
      <div style={{ padding: "2rem", maxWidth: 900 }}>
        {loading && <p>Ładowanie…</p>}
        {!loading && err && <p style={{ color: "crimson" }}>{err}</p>}

        {!loading && !err && tournament && !panelEnabled ? (
          <div
            style={{
              border: "1px solid #333",
              borderRadius: 10,
              padding: "1rem",
              display: "grid",
              gap: 10,
            }}
          >
            <div style={{ fontWeight: 800, fontSize: "1.05rem" }}>
              Brak uprawnień do panelu zarządzania
            </div>

            <div style={{ opacity: 0.9 }}>
              Turniej: <b>{tournament.name ?? `#${tournament.id}`}</b>
            </div>

            <div style={{ opacity: 0.9 }}>
              Rola: <b>{tournament.my_role ?? "—"}</b>, tryb: <b>{entryModeLabel(tournament.entry_mode)}</b>
            </div>

            <div style={{ opacity: 0.9 }}>
              Masz dostęp do podglądu turnieju, ale ten tryb nie pozwala na używanie panelu przez asystenta.
            </div>

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
        ) : (
          !loading &&
          !err && (
            <>
              <TournamentFlowNav />
              <Outlet />
              <TournamentStepFooter />
            </>
          )
        )}
      </div>
    </TournamentFlowGuardProvider>
  );
}
