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

  // Zasada: jak nie ma wstecz/dalej - nie pokazujemy nic.
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
      maxWidthClassName="max-w-none"
      contentClassName="p-2 sm:p-2.5"
    >
      <div className={cn("flex flex-wrap items-center gap-2 sm:gap-3", justify)}>
        {showStandingsBack ? (
          <Button
            variant="secondary"
            className="h-9 px-3 text-sm rounded-xl"
            onClick={() => navigate(`/tournaments/${resolvedId}/detail/results`)}
            leftIcon={<ArrowLeft className="h-4 w-4" />}
          >
            Wyniki
          </Button>
        ) : null}

        {showBack ? (
          <Button
            variant="secondary"
            className="h-9 px-3 text-sm rounded-xl"
            onClick={() => backPath && navigate(backPath)}
            leftIcon={<ArrowLeft className="h-4 w-4" />}
          >
            {prev?.label ?? "Wstecz"}
          </Button>
        ) : null}

        {showNext ? (
          <Button
            variant="primary"
            className="h-9 px-3 text-sm rounded-xl"
            onClick={() => nextPath && navigate(nextPath)}
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

/*
Co zmieniono:
- Footer przeniesiono do stałego, kompaktowego paska (mniejsza wysokość).
- Przyciski mają mniejszą wysokość i padding (h-9, px-3).
- Brak “wyłączonego” Wstecz/Dalej - jeśli brak akcji, nie renderujemy.
- Zostawiono obsługę powrotu ze standings do wyników.
*/
