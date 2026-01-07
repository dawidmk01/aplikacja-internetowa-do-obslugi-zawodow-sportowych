import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useTournamentFlowGuard } from "../flow/TournamentFlowGuardContext";
import { FLOW_STEPS, getCurrentStepIndex } from "../flow/flowSteps";

type Props = {
  getCreatedId?: () => string | null;
};

export default function TournamentStepFooter({ getCreatedId }: Props) {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  const { saveIfDirty, saving } = useTournamentFlowGuard();

  const resolvedId = id ?? getCreatedId?.() ?? null;

  // 1. Wykrycie strony Standings
  const isStandings = location.pathname.endsWith("/standings");

  // =========================
  // SPECJALNY PRZYPADEK: TABELA / DRABINKA
  // =========================
  if (isStandings && resolvedId) {
    return (
      <div
        style={{
          marginTop: "2rem",
          display: "flex",
          justifyContent: "space-between",
          gap: "1rem",
        }}
      >
        <button
          // Wróć do wyników (ostatni krok flow)
          onClick={() => navigate(`/tournaments/${resolvedId}/results`)}
        >
          Wyniki
        </button>

        <button onClick={() => navigate("/")}>
          Home
        </button>
      </div>
    );
  }

  // =========================
  // STANDARDOWY FLOW
  // =========================
  const idx = getCurrentStepIndex(location.pathname);
  const current = FLOW_STEPS[idx];

  // Jeśli nie jesteśmy na standings i nie ma nas w flow steps -> null
  if (!current) return null;

  const isFirst = idx === 0;
  const isLast = idx === FLOW_STEPS.length - 1;

  /* --- POPRZEDNIA STRONA --- */
  const backLabel = isFirst
    ? "Home"
    : FLOW_STEPS[idx - 1].label;

  const backPath = isFirst
    ? "/"
    : resolvedId
      ? FLOW_STEPS[idx - 1].path(resolvedId)
      : null;

  /* --- NASTĘPNA STRONA --- */
  const nextLabel = isLast
    ? "Tabela / Drabinka"
    : FLOW_STEPS[idx + 1].label;

  const nextPath = isLast
    ? resolvedId
      ? `/tournaments/${resolvedId}/standings`
      : null
    : resolvedId
      ? FLOW_STEPS[idx + 1].path(resolvedId)
      : null;

  /* --- HANDLERY --- */
  const goBack = async () => {
    if (!backPath) return;

    // WYJŚCIE DO HOME → BEZ ZAPISU
    if (isFirst) {
      navigate(backPath);
      return;
    }

    const ok = await saveIfDirty();
    if (!ok) return;

    navigate(backPath);
  };

  const goNext = async () => {
    // KROK 1: CREATE → MUSIMY NAJPIERW ZAPISAĆ I UZYSKAĆ ID
    // (W tym momencie resolvedId jest jeszcze null, więc nextPath też jest null)
    if (!resolvedId) {
      const ok = await saveIfDirty();
      if (!ok) return;

      const newId = getCreatedId?.();
      if (!newId) return;

      // Przechodzimy do kroku 2 (Teams) z nowym ID
      navigate(FLOW_STEPS[1].path(newId));
      return;
    }

    // POZOSTAŁE KROKI FLOW (Gdy mamy już ID)
    if (!nextPath) return;

    const ok = await saveIfDirty();
    if (!ok) return;

    navigate(nextPath);
  };

  return (
    <div
      style={{
        marginTop: "2rem",
        display: "flex",
        justifyContent: "space-between",
        gap: "1rem",
      }}
    >
      <button onClick={goBack} disabled={saving}>
        {backLabel}
      </button>

      <button onClick={goNext} disabled={saving}>
        {nextLabel}
      </button>
    </div>
  );
}