import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";

import { useTournamentFlowGuard } from "../flow/TournamentFlowGuardContext";
import { FLOW_STEPS, getCurrentStepIndex } from "../flow/flowSteps";
import { apiFetch } from "../api";
import { cn } from "../lib/cn";

type Props = {
  getCreatedId?: () => string | null; // dla /tournaments/new
  className?: string;
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

export default function TournamentFlowNav({ getCreatedId, className }: Props) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const { saveIfDirty, saving, lastError, clearError, createdId } = useTournamentFlowGuard();

  const currentIdx = getCurrentStepIndex(location.pathname);
  const currentLabel = FLOW_STEPS[currentIdx]?.label ?? "Konfiguracja";

  const resolvedId = id ?? createdId ?? getCreatedId?.() ?? null;

  // Badge: kolejka próśb o zmianę nazwy
  const [myRole, setMyRole] = useState<MyRole>(null);
  const [pendingNameReqCount, setPendingNameReqCount] = useState<number>(0);

  const canSeeQueue = useMemo(
    () => myRole === "ORGANIZER" || myRole === "ASSISTANT",
    [myRole]
  );

  // 1) my_role
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

  // 2) pending count
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

  const handleClick = (stepIndex: number) => async () => {
    if (saving) return;

    clearError();

    const ok = await saveIfDirty();
    if (!ok) return;

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
    <nav className={cn("my-6", className)} aria-label="Nawigacja kroków turnieju">
      <div className="flex flex-wrap gap-2">
        {FLOW_STEPS.map((step, index) => {
          const isActive = index === currentIdx;

          const isTeamsStep = step.key === "teams";
          const showPending = isTeamsStep && canSeeQueue && pendingNameReqCount > 0;

          return (
            <button
              key={step.key}
              type="button"
              onClick={handleClick(index)}
              disabled={saving}
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
                  layoutId="flow-step-active"
                  className="absolute inset-0 rounded-full bg-white/10"
                  transition={{ type: "spring", bounce: 0.18, duration: 0.55 }}
                />
              )}

              <span className="relative z-10 opacity-80">{index + 1}.</span>
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

      {lastError && (
        <div className="mt-3 text-sm text-rose-300">
          Błąd zapisu: {lastError}
        </div>
      )}
    </nav>
  );
}
