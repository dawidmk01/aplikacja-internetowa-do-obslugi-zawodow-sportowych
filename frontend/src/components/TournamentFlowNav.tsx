import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Eye } from "lucide-react";

import { apiFetch } from "../api";
import { cn } from "../lib/cn";

import { FLOW_STEPS, getCurrentStepIndex } from "../flow/flowSteps";

import { StickyBar } from "../ui/StickyBar";

type Props = {
  getCreatedId?: () => string | null; // dla /tournaments/new
  className?: string;
  side?: "top" | "bottom";
};

type MyRole = "ORGANIZER" | "ASSISTANT" | "PARTICIPANT" | null;

type TournamentDTO = {
  id: number;
  my_role?: MyRole;
  [key: string]: any;
};

function toIntSafe(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function extractCount(payload: any): number | null {
  const c = toIntSafe(payload?.count);
  if (c !== null) return c;
  if (Array.isArray(payload?.results)) return payload.results.length;
  if (Array.isArray(payload)) return payload.length;
  return null;
}

export default function TournamentFlowNav({ getCreatedId, className, side = "top" }: Props) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const isTop = side === "top";

  const currentIdx = getCurrentStepIndex(location.pathname);
  const currentLabel = FLOW_STEPS[currentIdx]?.label ?? "Konfiguracja";

  const resolvedId = id ?? getCreatedId?.() ?? null;

  const [myRole, setMyRole] = useState<MyRole>(null);
  const [pendingNameReqCount, setPendingNameReqCount] = useState<number>(0);

  const navRef = useRef<HTMLElement | null>(null);

  const canSeeQueue = useMemo(
    () => myRole === "ORGANIZER" || myRole === "ASSISTANT",
    [myRole]
  );

  useEffect(() => {
    if (!resolvedId) return;

    let cancelled = false;

    (async () => {
      try {
        const tRes = await apiFetch(`/api/tournaments/${resolvedId}/`);
        if (!tRes.ok) {
          if (!cancelled) setMyRole(null);
          return;
        }
        const t: TournamentDTO = await tRes.json().catch(() => ({} as any));
        if (!cancelled) setMyRole((t?.my_role as MyRole) ?? null);
      } catch {
        if (!cancelled) setMyRole(null);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedId]);

  useEffect(() => {
    if (!resolvedId) return;

    if (!canSeeQueue) {
      setPendingNameReqCount(0);
      return;
    }

    let cancelled = false;

    const loadPendingCount = async () => {
      try {
        const res = await apiFetch(
          `/api/tournaments/${resolvedId}/teams/name-change-requests/`
        );

        if (!res.ok) {
          if (!cancelled) setPendingNameReqCount(0);
          return;
        }

        const data = await res.json().catch(() => null);
        const cnt = extractCount(data);
        if (!cancelled) setPendingNameReqCount(cnt ?? 0);
      } catch {
        if (!cancelled) setPendingNameReqCount(0);
      }
    };

    const onFocus = () => loadPendingCount();

    loadPendingCount();
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [canSeeQueue, resolvedId]);

  useEffect(() => {
    if (!isTop) {
      // FlowNav na dole nie powinien wpływać na offset kolejnych top-barów.
      document.documentElement.style.setProperty("--app-flowbar-h", "0px");
      return () => {
        document.documentElement.style.removeProperty("--app-flowbar-h");
      };
    }

    const topGapPx = 12;

    const update = () => {
      const inner = navRef.current?.parentElement;
      const h = inner?.getBoundingClientRect().height ?? 0;
      const occupiedPx = Math.max(0, Math.ceil(h + topGapPx));
      document.documentElement.style.setProperty("--app-flowbar-h", `${occupiedPx}px`);
    };

    update();

    const inner = navRef.current?.parentElement;
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => update()) : null;
    if (inner && ro) ro.observe(inner);

    window.addEventListener("resize", update);

    return () => {
      window.removeEventListener("resize", update);
      ro?.disconnect();
      document.documentElement.style.removeProperty("--app-flowbar-h");
    };
  }, [isTop]);

  const handleClick = (stepIndex: number) => () => {
    if (!resolvedId) return;

    const target = FLOW_STEPS[stepIndex];
    navigate(target.path(resolvedId), {
      state: {
        fromPath: location.pathname,
        fromLabel: currentLabel,
      },
    });
  };

  return (
    <StickyBar
      side={side}
      className={className}
      zIndexClassName={isTop ? "z-40" : "z-50"}
      maxWidthClassName="max-w-none"
      topGapPx={12}
      spacerHeightClassName="h-16 sm:h-[72px]"
    >
      <nav ref={navRef} aria-label="Nawigacja kroków turnieju">
        <div className="flex flex-wrap gap-2">
          {FLOW_STEPS.map((step, index) => {
            const isActive = index === currentIdx;
            const isPublicPreview = step.key === "public_preview";

            const isTeamsStep = step.key === "teams";
            const showPending = isTeamsStep && canSeeQueue && pendingNameReqCount > 0;

            return (
              <button
                key={step.key}
                type="button"
                onClick={handleClick(index)}
                disabled={!resolvedId}
                className={cn(
                  "relative inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold transition",
                  "border border-white/10 bg-white/[0.06] text-slate-200 hover:bg-white/[0.10]",
                  "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/15",
                  "disabled:opacity-60 disabled:pointer-events-none",
                  showPending && "border-amber-500/30"
                )}
              >
                {isActive && (
                  <motion.div
                    layoutId={isTop ? "flow-step-active" : "flow-step-active-bottom"}
                    className="absolute inset-0 rounded-full bg-white/10"
                    transition={{ type: "spring", bounce: 0.18, duration: 0.55 }}
                  />
                )}

                {isPublicPreview ? (
                  <Eye className="relative z-10 h-4 w-4 text-white/80" />
                ) : (
                  <span className="relative z-10 opacity-80">{index + 1}.</span>
                )}

                <span className="relative z-10">{step.label}</span>

                {showPending && (
                  <span
                    className={cn(
                      "relative z-10 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full",
                      "border border-amber-500/40 bg-amber-500/10 px-1.5 text-xs font-bold text-amber-200"
                    )}
                    title="Oczekujące prośby o zmianę nazwy"
                  >
                    {pendingNameReqCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </StickyBar>
  );
}

/*
Co zmieniono:
- Dodano obsługę trybu bottom (przydatne w widoku publicznym dla organizatora).
- Pomiar wysokości i CSS var --app-flowbar-h działa tylko w trybie top (stackowanie top-barów).
- Ujednolicono konfigurację StickyBar (spacer i z-index zależnie od trybu).
*/
