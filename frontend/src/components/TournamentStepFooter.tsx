import React from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Trophy } from "lucide-react";

import { useTournamentFlowGuard } from "../flow/TournamentFlowGuardContext";
import { FLOW_STEPS, getCurrentStepIndex } from "../flow/flowSteps";
import { Button } from "../ui/Button";
import { cn } from "../lib/cn";

type Props = {
  getCreatedId?: () => string | null;
  className?: string;
};

export default function TournamentStepFooter({ getCreatedId, className }: Props) {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  const { saveIfDirty, saving, createdId } = useTournamentFlowGuard();

  const resolvedId = id ?? createdId ?? getCreatedId?.() ?? null;

  // Standings poza flow
  const isStandings = location.pathname.endsWith("/standings");
  if (isStandings && resolvedId) {
    return (
      <div className={cn("mt-8 flex flex-wrap items-center justify-between gap-3", className)}>
        <Button
          variant="secondary"
          onClick={() => navigate(`/tournaments/${resolvedId}/detail/results`)}
          disabled={saving}
          leftIcon={<ArrowLeft className="h-4 w-4" />}
        >
          Wyniki
        </Button>

        {/* Usunięto powrót do Home */}
        <div />
      </div>
    );
  }

  const idx = getCurrentStepIndex(location.pathname);
  const current = FLOW_STEPS[idx];
  if (!current) return null;

  const isFirst = idx === 0;
  const isLast = idx === FLOW_STEPS.length - 1;

  // USUNIĘTE: cofanie do "/" w pierwszym kroku
  const backLabel = isFirst ? "Wstecz" : FLOW_STEPS[idx - 1].label;
  const backPath =
    !isFirst && resolvedId ? FLOW_STEPS[idx - 1].path(resolvedId) : null;

  const nextLabel = isLast ? "Tabela / Drabinka" : FLOW_STEPS[idx + 1].label;
  const nextPath = isLast
    ? resolvedId
      ? `/tournaments/${resolvedId}/standings`
      : null
    : resolvedId
      ? FLOW_STEPS[idx + 1].path(resolvedId)
      : null;

  const goBack = async () => {
    if (!backPath) return;

    const ok = await saveIfDirty();
    if (!ok) return;

    navigate(backPath);
  };

  const goNext = async () => {
    // CREATE -> zapis i dopiero mamy ID
    if (!resolvedId) {
      const ok = await saveIfDirty();
      if (!ok) return;

      const newId = createdId ?? getCreatedId?.();
      if (!newId) return;

      navigate(FLOW_STEPS[1].path(newId));
      return;
    }

    if (!nextPath) return;

    const ok = await saveIfDirty();
    if (!ok) return;

    navigate(nextPath);
  };

  return (
    <div className={cn("mt-8 flex flex-wrap items-center justify-between gap-3", className)}>
      <Button
        variant="secondary"
        onClick={goBack}
        disabled={saving || !backPath}
        leftIcon={<ArrowLeft className="h-4 w-4" />}
      >
        {backLabel}
      </Button>

      <Button
        variant="primary"
        onClick={goNext}
        disabled={saving || (!nextPath && !!resolvedId)}
        leftIcon={isLast ? <Trophy className="h-4 w-4" /> : undefined}
        rightIcon={<ArrowRight className="h-4 w-4" />}
      >
        {nextLabel}
      </Button>
    </div>
  );
}
