import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Eye } from "lucide-react";

import { FLOW_STEPS, getCurrentStepIndex } from "../flow/flowSteps";
import { cn } from "../lib/cn";

import { Button } from "../ui/Button";
import { StickyBar } from "../ui/StickyBar";

type Props = {
  getCreatedId?: () => string | null;
  className?: string;
};

function cleanPath(pathname: string): string {
  const p = pathname.split("?")[0];
  return p.replace(/\/+$/, "");
}

export default function TournamentStepFooter({ getCreatedId, className }: Props) {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  const resolvedId = id ?? getCreatedId?.() ?? null;

  const isStandings = cleanPath(location.pathname).endsWith("/standings");

  const idx = getCurrentStepIndex(location.pathname);
  const current = FLOW_STEPS[idx];
  if (!current) return null;

  const prev = idx > 0 ? FLOW_STEPS[idx - 1] : null;
  const next = idx < FLOW_STEPS.length - 1 ? FLOW_STEPS[idx + 1] : null;

  const backPath = prev && resolvedId ? prev.path(resolvedId) : null;
  const nextPath = next && resolvedId ? next.path(resolvedId) : null;

  const showStandingsBack = Boolean(isStandings && resolvedId);
  const showBack = Boolean(backPath) && !isStandings;
  const showNext = Boolean(nextPath) && !isStandings;

  if (!showStandingsBack && !showBack && !showNext) return null;

  const justify =
    (showBack || showStandingsBack) && showNext
      ? "justify-between"
      : showBack || showStandingsBack
        ? "justify-start"
        : "justify-end";

  return (
    <StickyBar
      side="bottom"
      className={className}
      spacerHeightClassName="h-16 sm:h-[72px]"
      zIndexClassName="z-50"
      maxWidthClassName="max-w-[1400px]"
      contentClassName="p-2 sm:p-2.5"
    >
      <div
        className={cn("flex flex-wrap items-center gap-2 sm:gap-3", justify)}
        aria-label="Nawigacja kroków turnieju"
      >
        {showStandingsBack ? (
          <Button
            type="button"
            variant="secondary"
            className="h-9 rounded-xl px-3 text-sm"
            onClick={() => navigate(`/tournaments/${resolvedId}/detail/results`)}
            leftIcon={<ArrowLeft className="h-4 w-4" />}
          >
            Wyniki
          </Button>
        ) : null}

        {showBack ? (
          <Button
            type="button"
            variant="secondary"
            className="h-9 rounded-xl px-3 text-sm"
            onClick={() => {
              if (backPath) navigate(backPath);
            }}
            leftIcon={<ArrowLeft className="h-4 w-4" />}
          >
            {prev?.label ?? "Wstecz"}
          </Button>
        ) : null}

        {showNext ? (
          <Button
            type="button"
            variant="primary"
            className="h-9 rounded-xl px-3 text-sm"
            onClick={() => {
              if (nextPath) navigate(nextPath);
            }}
            leftIcon={next?.key === "public_preview" ? <Eye className="h-4 w-4" /> : undefined}
            rightIcon={<ArrowRight className="h-4 w-4" />}
          >
            {next?.label ?? "Dalej"}
          </Button>
        ) : null}
      </div>
    </StickyBar>
  );
}