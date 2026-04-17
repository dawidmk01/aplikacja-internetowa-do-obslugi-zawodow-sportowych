import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate, useParams } from "react-router-dom";

import { apiGet } from "../api";

import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

import TournamentFlowNav from "../components/TournamentFlowNav";
import { TournamentFlowGuardProvider } from "../flow/TournamentFlowGuardContext";

type TournamentLite = {
  id: number;
  my_role: "ORGANIZER" | "ASSISTANT" | "PARTICIPANT" | null;
  name?: string;
};

function canOpenPanel(tournament: TournamentLite) {
  return tournament.my_role === "ORGANIZER" || tournament.my_role === "ASSISTANT";
}

function isAuthError(message: string) {
  const normalized = (message || "").toLowerCase();
  return (
    normalized.includes("401") ||
    normalized.includes("403") ||
    normalized.includes("unauthorized") ||
    normalized.includes("forbidden")
  );
}

function PanelStateCard({
  title,
  message,
  actions,
  loading = false,
}: {
  title: string;
  message?: string;
  actions?: ReactNode;
  loading?: boolean;
}) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          {loading ? <div className="h-2 w-2 animate-pulse rounded-full bg-white/40" /> : null}
          <div className="text-base font-semibold text-white">{title}</div>
        </div>

        {message ? <div className="text-sm leading-relaxed text-slate-300">{message}</div> : null}

        {actions ? <div className="flex flex-col gap-2 pt-3 sm:flex-row sm:flex-wrap">{actions}</div> : null}
      </div>
    </Card>
  );
}

/** Layout panelu utrzymuje kontrakt dostępu i wspólną dolną nawigację kroków. */
export default function TournamentLayout() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  const [tournament, setTournament] = useState<TournamentLite | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    let alive = true;

    setLoading(true);
    setError(null);
    setTournament(null);

    apiGet<TournamentLite>(`/api/tournaments/${id}/`)
      .then((data) => {
        if (!alive) return;
        setTournament(data);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err?.message ?? "Błąd pobierania turnieju.");
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

  const next = encodeURIComponent(location.pathname + location.search);

  return (
    <TournamentFlowGuardProvider>
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 xl:px-8">
        {loading ? (
          <PanelStateCard title="Ładowanie panelu..." loading />
        ) : error ? (
          <PanelStateCard
            title="Nie można otworzyć panelu"
            message={error}
            actions={
              <>
                <Button type="button" className="w-full sm:w-auto" variant="secondary" onClick={() => navigate(`/tournaments/${id}`)}>
                  Przejdź do podglądu
                </Button>

                {isAuthError(error) ? (
                  <Button type="button" className="w-full sm:w-auto" onClick={() => navigate(`/login?next=${next}`)}>
                    Zaloguj się
                  </Button>
                ) : null}

                <Button type="button" className="w-full sm:w-auto" variant="ghost" onClick={() => navigate("/my-tournaments")}>
                  Wróć do moich turniejów
                </Button>
              </>
            }
          />
        ) : tournament && !canOpenPanel(tournament) ? (
          <PanelStateCard
            title="Brak dostępu do panelu"
            message={`Turniej: ${tournament.name ?? `#${tournament.id}`}. Ta część jest dostępna tylko dla organizatora i asystentów.`}
            actions={
              <>
                <Button type="button" className="w-full sm:w-auto" variant="secondary" onClick={() => navigate(`/tournaments/${id}`)}>
                  Przejdź do podglądu
                </Button>

                <Button type="button" className="w-full sm:w-auto" variant="ghost" onClick={() => navigate("/my-tournaments")}>
                  Wróć do moich turniejów
                </Button>
              </>
            }
          />
        ) : (
          <div className="w-full">
            <Outlet />
            <TournamentFlowNav side="bottom" className="mt-4" />
          </div>
        )}
      </div>
    </TournamentFlowGuardProvider>
  );
}
