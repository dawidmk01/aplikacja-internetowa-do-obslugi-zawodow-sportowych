// frontend/src/components/TournamentStepFooter.tsx
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

  // 1) Wykrycie strony Standings (poza flow managementu)
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
          onClick={() => navigate(`/tournaments/${resolvedId}/detail/results`)}
          disabled={saving}
        >
          ← Wyniki
        </button>

        <button onClick={() => navigate("/")} disabled={saving}>
          Home →
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
  const backLabel = isFirst ? "Home" : FLOW_STEPS[idx - 1].label;

  const backPath = isFirst
    ? "/"
    : resolvedId
      ? FLOW_STEPS[idx - 1].path(resolvedId)
      : null;

  /* --- NASTĘPNA STRONA --- */
  const nextLabel = isLast ? "Tabela / Drabinka" : FLOW_STEPS[idx + 1].label;

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

    // Wyjście do Home → bez zapisu
    if (isFirst) {
      navigate(backPath);
      return;
    }

    const ok = await saveIfDirty();
    if (!ok) return;

    navigate(backPath);
  };

  const goNext = async () => {
    // CREATE → musimy zapisać i uzyskać ID
    if (!resolvedId) {
      const ok = await saveIfDirty();
      if (!ok) return;

      const newId = getCreatedId?.();
      if (!newId) return;

      // Przechodzimy do kroku 2 (czyli FLOW_STEPS[1]) zgodnie z Twoją kolejnością w flowSteps.ts
      navigate(FLOW_STEPS[1].path(newId));
      return;
    }

    // Pozostałe kroki flow (gdy mamy już ID)
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
        ← {backLabel}
      </button>

      <button onClick={goNext} disabled={saving}>
        {nextLabel} →
      </button>
    </div>
  );
}
