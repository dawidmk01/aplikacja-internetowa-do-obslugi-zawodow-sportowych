import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate, useParams } from "react-router-dom";

import { apiGet } from "../api";

import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

import TournamentFlowNav from "../components/TournamentFlowNav";
import TournamentStepFooter from "../components/TournamentStepFooter";
import { TournamentFlowGuardProvider } from "../flow/TournamentFlowGuardContext";

type TournamentLite = {
  id: number;
  my_role: "ORGANIZER" | "ASSISTANT" | "PARTICIPANT" | null;
  name?: string;
};

function canOpenPanel(t: TournamentLite) {
  return t.my_role === "ORGANIZER" || t.my_role === "ASSISTANT";
}

function isAuthError(message: string) {
  const m = (message || "").toLowerCase();
  return m.includes("401") || m.includes("403") || m.includes("unauthorized") || m.includes("forbidden");
}

/** Layout panelu utrzymuje kontrakt dostępu (role) i spójne stany krytyczne przed renderowaniem podstron panelu. */
export default function TournamentLayout() {
  const { id } = useParams<{ id: string }>();
  const loc = useLocation();
  const navigate = useNavigate();

  const [tournament, setTournament] = useState<TournamentLite | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    let alive = true;

    setLoading(true);
    setErr(null);
    setTournament(null);

    apiGet<TournamentLite>(`/api/tournaments/${id}/`)
      .then((data) => {
        if (!alive) return;
        setTournament(data);
      })
      .catch((e) => {
        if (!alive) return;
        setErr(e?.message ?? "Błąd pobierania turnieju.");
      })
      .finally(() => {
        if (!alive) return;
        setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [id]);

  if (!id) return null;

  const next = encodeURIComponent(loc.pathname + loc.search);

  return (
    <TournamentFlowGuardProvider>
      <div className="w-full py-6">
        {loading ? (
          <div className="mx-auto w-full max-w-3xl py-2">
            <Card className="p-5 sm:p-6">
              <div className="flex items-center gap-3">
                <div className="h-2 w-2 animate-pulse rounded-full bg-white/40" />
                <div className="text-sm text-slate-300">Ładowanie panelu...</div>
              </div>
            </Card>
          </div>
        ) : err ? (
          <div className="mx-auto w-full max-w-3xl py-2">
            <Card className="p-5 sm:p-6">
              <div className="text-base font-semibold text-white">Nie można otworzyć panelu</div>
              <div className="mt-2 text-sm text-slate-300">{err}</div>

              <div className="mt-5 flex flex-wrap gap-2">
                <Button type="button" variant="secondary" onClick={() => navigate(`/tournaments/${id}`)}>
                  Przejdź do podglądu
                </Button>

                {isAuthError(err) ? (
                  <Button type="button" onClick={() => navigate(`/login?next=${next}`)}>
                    Zaloguj się
                  </Button>
                ) : null}

                <Button type="button" variant="ghost" onClick={() => navigate("/my-tournaments")}>
                  Wróć do moich turniejów
                </Button>
              </div>
            </Card>
          </div>
        ) : tournament && !canOpenPanel(tournament) ? (
          <div className="mx-auto w-full max-w-3xl py-2">
            <Card className="p-5 sm:p-6">
              <div className="text-base font-semibold text-white">Brak dostępu do panelu</div>

              <div className="mt-2 text-sm text-slate-300">
                Turniej:{" "}
                <span className="font-semibold text-white">{tournament.name ?? `#${tournament.id}`}</span>
              </div>

              <div className="mt-2 text-sm text-slate-300">
                Ta część jest dostępna tylko dla organizatora i asystentów.
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <Button type="button" variant="secondary" onClick={() => navigate(`/tournaments/${id}`)}>
                  Przejdź do podglądu
                </Button>

                <Button type="button" variant="ghost" onClick={() => navigate("/my-tournaments")}>
                  Wróć do moich turniejów
                </Button>
              </div>
            </Card>
          </div>
        ) : (
          <div className="w-full">
            <div className="mb-4">
              <TournamentFlowNav />
            </div>
            <Outlet />
            <div className="mt-6">
              <TournamentStepFooter />
            </div>
          </div>
        )}
      </div>
    </TournamentFlowGuardProvider>
  );
}