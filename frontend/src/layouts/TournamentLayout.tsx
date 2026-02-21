import { useEffect, useState } from "react";
import { Link, Outlet, useLocation, useParams } from "react-router-dom";

import { apiGet } from "../api";

import TournamentFlowNav from "../components/TournamentFlowNav";
import TournamentStepFooter from "../components/TournamentStepFooter";
import { TournamentFlowGuardProvider } from "../flow/TournamentFlowGuardContext";

import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

// ===== Typy lokalne =====

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
  return (
    m.includes("401") ||
    m.includes("403") ||
    m.includes("unauthorized") ||
    m.includes("forbidden")
  );
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

  // Brak ID = brak panelu (route /tournaments/new obsługiwany osobno)
  if (!id) return null;

  // ===== Stany: ładowanie / błąd / brak roli =====

  if (loading) {
    return (
      <TournamentFlowGuardProvider>
        <div className="w-full py-8">
          <Card className="p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <div className="h-2 w-2 rounded-full bg-white/40 animate-pulse" />
              <div className="text-sm text-slate-300">Ładowanie panelu...</div>
            </div>
          </Card>
        </div>
      </TournamentFlowGuardProvider>
    );
  }

  if (err) {
    const next = encodeURIComponent(loc.pathname + loc.search);

    return (
      <TournamentFlowGuardProvider>
        <div className="w-full py-8">
          <Card className="p-5 sm:p-6">
            <div className="text-base font-semibold text-white">
              Nie można otworzyć panelu
            </div>
            <div className="mt-2 text-sm text-slate-300">{err}</div>

            <div className="mt-5 flex flex-wrap gap-2">
              <Link to={`/tournaments/${id}`}>
                <Button variant="secondary">Przejdź do podglądu</Button>
              </Link>

              {isAuthError(err) && (
                <Link to={`/login?next=${next}`}>
                  <Button>Zaloguj się</Button>
                </Link>
              )}

              <Link to="/my-tournaments">
                <Button variant="ghost">Wróć do moich turniejów</Button>
              </Link>
            </div>
          </Card>
        </div>
      </TournamentFlowGuardProvider>
    );
  }

  if (tournament && !canOpenPanel(tournament)) {
    return (
      <TournamentFlowGuardProvider>
        <div className="w-full py-8">
          <Card className="p-5 sm:p-6">
            <div className="text-base font-semibold text-white">
              Brak dostępu do panelu
            </div>

            <div className="mt-2 text-sm text-slate-300">
              Turniej:{" "}
              <span className="font-semibold text-white">
                {tournament.name ?? `#${tournament.id}`}
              </span>
            </div>

            <div className="mt-2 text-sm text-slate-300">
              Ta część jest dostępna tylko dla organizatora i asystentów.
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <Link to={`/tournaments/${id}`}>
                <Button variant="secondary">Przejdź do podglądu</Button>
              </Link>

              <Link to="/my-tournaments">
                <Button variant="ghost">Wróć do moich turniejów</Button>
              </Link>
            </div>
          </Card>
        </div>
      </TournamentFlowGuardProvider>
    );
  }

  // ===== Stan: panel dostępny =====
  return (
    <TournamentFlowGuardProvider>
      <div className="w-full py-6">
        <div className="mb-4">
          <TournamentFlowNav />
        </div>

        {/*
          Outlet nie jest opakowywany w dodatkową Card.
          Strony panelu same budują układ i tła, a Layout nie może zmieniać stylu widoku.
        */}
        <Outlet />

        <div className="mt-6">
          <TournamentStepFooter />
        </div>
      </div>
    </TournamentFlowGuardProvider>
  );
}

