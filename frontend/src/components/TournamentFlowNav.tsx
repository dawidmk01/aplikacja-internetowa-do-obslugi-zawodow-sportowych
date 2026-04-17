// frontend/src/components/TournamentFlowNav.tsx
// Komponent renderuje dolną nawigację kroków turnieju z obsługą aktywnej dywizji i układu mobilnego.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ChevronUp, Eye } from "lucide-react";

import { apiFetch } from "../api";
import { cn } from "../lib/cn";
import { FLOW_STEPS, getCurrentStepIndex } from "../flow/flowSteps";

import { Select, type SelectOption } from "../ui/Select";
import { StickyBar } from "../ui/StickyBar";

type Props = {
  getCreatedId?: () => string | null;
  className?: string;
  side?: "top" | "bottom";
};

type MyRole = "ORGANIZER" | "ASSISTANT" | "PARTICIPANT" | null;
type DivisionStatus = "DRAFT" | "CONFIGURED" | "RUNNING" | "FINISHED";

type DivisionSummaryDTO = {
  id: number;
  name: string;
  slug: string;
  order: number;
  is_default?: boolean;
  is_archived?: boolean;
  status?: DivisionStatus;
};

type TournamentDTO = {
  id: number;
  my_role?: MyRole;
  divisions?: DivisionSummaryDTO[];
  active_division_id?: number | null;
  [key: string]: any;
};

function toIntSafe(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractCount(payload: any): number | null {
  const count = toIntSafe(payload?.count);
  if (count !== null) return count;
  if (Array.isArray(payload?.results)) return payload.results.length;
  if (Array.isArray(payload)) return payload.length;
  return null;
}

function parseDivisionId(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
}

function withDivisionQuery(url: string, divisionId: number | null | undefined) {
  if (!divisionId) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}division_id=${divisionId}`;
}

function getDivisionStatusLabel(status: DivisionStatus | null | undefined) {
  if (status === "RUNNING") return "W trakcie";
  if (status === "FINISHED") return "Zakończona";
  if (status === "CONFIGURED") return "Skonfigurowana";
  return "Szkic";
}

function buildDivisionOptionLabel(item: DivisionSummaryDTO) {
  const suffixParts = [getDivisionStatusLabel(item.status)];
  if (item.is_default) suffixParts.push("podstawowa");
  return `${item.name} - ${suffixParts.join(" - ")}`;
}

function shortenDivisionLabel(label: string) {
  return label.length > 24 ? `${label.slice(0, 24)}...` : label;
}

export default function TournamentFlowNav({ getCreatedId, className, side = "bottom" }: Props) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const isTop = side === "top";
  const currentIdx = getCurrentStepIndex(location.pathname);
  const resolvedId = id ?? getCreatedId?.() ?? null;
  const requestedDivisionId =
    parseDivisionId(searchParams.get("division_id")) ?? parseDivisionId(searchParams.get("active_division_id"));

  const [myRole, setMyRole] = useState<MyRole>(null);
  const [pendingNameReqCount, setPendingNameReqCount] = useState<number>(0);
  const [divisions, setDivisions] = useState<DivisionSummaryDTO[]>([]);
  const [activeDivisionId, setActiveDivisionId] = useState<number | null>(requestedDivisionId);
  const [mobileDivisionOpen, setMobileDivisionOpen] = useState(false);

  const navRef = useRef<HTMLElement | null>(null);
  const canSeeQueue = useMemo(() => myRole === "ORGANIZER" || myRole === "ASSISTANT", [myRole]);

  const divisionOptions = useMemo<SelectOption<number>[]>(() => {
    return divisions
      .filter((item) => !item.is_archived)
      .sort((left, right) => {
        const orderDiff = (left.order ?? 0) - (right.order ?? 0);
        if (orderDiff !== 0) return orderDiff;
        return left.id - right.id;
      })
      .map((item) => ({
        value: item.id,
        label: buildDivisionOptionLabel(item),
      }));
  }, [divisions]);

  const showDivisionSelect = divisionOptions.length > 1;
  const divisionValue = activeDivisionId ?? divisionOptions[0]?.value ?? 0;
  const currentDivisionLabel = divisionOptions.find((item) => item.value === divisionValue)?.label ?? "Dywizja";

  const loadTournamentContext = useCallback(async () => {
    if (!resolvedId) {
      setMyRole(null);
      setDivisions([]);
      setActiveDivisionId(null);
      return;
    }

    try {
      const response = await apiFetch(withDivisionQuery(`/api/tournaments/${resolvedId}/`, requestedDivisionId));
      if (!response.ok) {
        setMyRole(null);
        setDivisions([]);
        setActiveDivisionId(requestedDivisionId);
        return;
      }

      const payload: TournamentDTO = await response.json().catch(() => ({} as TournamentDTO));
      setMyRole((payload?.my_role as MyRole) ?? null);
      setDivisions(Array.isArray(payload?.divisions) ? payload.divisions : []);
      setActiveDivisionId(payload?.active_division_id ?? requestedDivisionId ?? null);
    } catch {
      setMyRole(null);
      setDivisions([]);
      setActiveDivisionId(requestedDivisionId);
    }
  }, [requestedDivisionId, resolvedId]);

  useEffect(() => {
    void loadTournamentContext();
  }, [loadTournamentContext]);

  const loadPendingCount = useCallback(async () => {
    if (!resolvedId || !canSeeQueue) {
      setPendingNameReqCount(0);
      return;
    }

    try {
      const response = await apiFetch(
        withDivisionQuery(`/api/tournaments/${resolvedId}/teams/name-change-requests/`, requestedDivisionId)
      );
      if (!response.ok) {
        setPendingNameReqCount(0);
        return;
      }

      const payload = await response.json().catch(() => null);
      setPendingNameReqCount(extractCount(payload) ?? 0);
    } catch {
      setPendingNameReqCount(0);
    }
  }, [canSeeQueue, requestedDivisionId, resolvedId]);

  useEffect(() => {
    void loadPendingCount();

    const onFocus = () => {
      void loadPendingCount();
    };

    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadPendingCount]);

  useEffect(() => {
    setMobileDivisionOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!isTop) {
      document.documentElement.style.setProperty("--app-flowbar-h", "0px");
      return () => {
        document.documentElement.style.removeProperty("--app-flowbar-h");
      };
    }

    const topGapPx = 12;

    const update = () => {
      const inner = navRef.current?.parentElement;
      const height = inner?.getBoundingClientRect().height ?? 0;
      const occupiedPx = Math.max(0, Math.ceil(height + topGapPx));
      document.documentElement.style.setProperty("--app-flowbar-h", `${occupiedPx}px`);
    };

    update();

    const inner = navRef.current?.parentElement;
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => update()) : null;
    if (inner && observer) observer.observe(inner);

    window.addEventListener("resize", update);

    return () => {
      window.removeEventListener("resize", update);
      observer?.disconnect();
      document.documentElement.style.removeProperty("--app-flowbar-h");
    };
  }, [isTop]);

  const buildNextSearch = useCallback(
    (nextDivisionId?: number | null) => {
      const nextParams = new URLSearchParams(searchParams);
      const resolvedDivision = nextDivisionId ?? requestedDivisionId ?? activeDivisionId ?? null;

      nextParams.delete("active_division_id");

      if (resolvedDivision) {
        nextParams.set("division_id", String(resolvedDivision));
      } else {
        nextParams.delete("division_id");
      }

      const serialized = nextParams.toString();
      return serialized ? `?${serialized}` : "";
    },
    [activeDivisionId, requestedDivisionId, searchParams]
  );

  const handleStepClick = useCallback(
    (stepIndex: number) => {
      if (!resolvedId) return;
      const target = FLOW_STEPS[stepIndex];
      navigate(`${target.path(resolvedId)}${buildNextSearch()}`);
      setMobileDivisionOpen(false);
    },
    [buildNextSearch, navigate, resolvedId]
  );

  const handleDivisionChange = useCallback(
    (nextDivisionId: number) => {
      if (!nextDivisionId || nextDivisionId === divisionValue) return;
      setActiveDivisionId(nextDivisionId);
      navigate({ pathname: location.pathname, search: buildNextSearch(nextDivisionId) }, { replace: false });
      setMobileDivisionOpen(false);
    },
    [buildNextSearch, divisionValue, location.pathname, navigate]
  );

  return (
    <StickyBar
      side={side}
      className={className}
      zIndexClassName={isTop ? "z-40" : "z-50"}
      maxWidthClassName="max-w-[1100px]"
      topGapPx={12}
      spacerHeightClassName="h-14 sm:h-16"
      contentClassName="w-full max-w-full px-4 py-2 sm:px-6 sm:py-2.5 xl:px-8"
    >
      <nav ref={navRef} aria-label="Nawigacja kroków turnieju" className="relative w-full min-w-0">
        <AnimatePresence>
          {mobileDivisionOpen && showDivisionSelect ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="mb-2 sm:hidden"
            >
              <div className="rounded-2xl border border-white/10 bg-slate-950/95 p-2 shadow-2xl shadow-black/30 backdrop-blur-xl">
                <div className="flex gap-2 overflow-x-auto overscroll-x-contain scroll-smooth pb-1">
                  {divisionOptions.map((option) => {
                    const isActive = option.value === divisionValue;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => handleDivisionChange(option.value)}
                        className={cn(
                          "inline-flex h-10 shrink-0 items-center rounded-full border px-3 text-sm font-semibold transition",
                          "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/15",
                          isActive
                            ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-100 shadow-[0_0_0_1px_rgba(34,211,238,0.08)]"
                            : "border-white/10 bg-white/[0.06] text-slate-200 hover:bg-white/[0.10]"
                        )}
                      >
                        {shortenDivisionLabel(option.label)}
                      </button>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <div className={cn(
          "w-full overflow-x-auto overscroll-x-contain scroll-smooth pb-1",
          "[&::-webkit-scrollbar]:h-1.5",
          "[&::-webkit-scrollbar-track]:bg-transparent",
          "[&::-webkit-scrollbar-thumb]:rounded-full",
          "[&::-webkit-scrollbar-thumb]:bg-white/20",
          "hover:[&::-webkit-scrollbar-thumb]:bg-white/30"
        )}>
          <div className="flex min-w-max items-center gap-2 sm:min-w-full sm:w-max sm:[justify-content:safe_center]">
            {showDivisionSelect ? (
              <>
                <div className="relative z-50 hidden w-[240px] shrink-0 sm:block">
                  <Select<number>
                    value={divisionValue}
                    onChange={handleDivisionChange}
                    options={divisionOptions}
                    ariaLabel="Wybór dywizji"
                    size="md"
                    align="start"
                    buttonClassName={cn(
                      "min-h-[38px] rounded-full border border-cyan-400/40 bg-cyan-400/10 px-3 py-2",
                      "text-left text-sm text-cyan-100 shadow-[0_0_0_1px_rgba(34,211,238,0.08)] transition hover:border-cyan-300/50 hover:bg-cyan-400/12"
                    )}
                    menuClassName="rounded-2xl"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setMobileDivisionOpen((prev) => !prev)}
                  className={cn(
                    "inline-flex h-10 min-w-[180px] shrink-0 items-center justify-between gap-2 rounded-full border px-3 text-sm font-semibold sm:hidden",
                    "border-cyan-400/40 bg-cyan-400/10 text-cyan-100 shadow-[0_0_0_1px_rgba(34,211,238,0.08)] transition hover:border-cyan-300/50 hover:bg-cyan-400/12",
                    "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/15"
                  )}
                  aria-expanded={mobileDivisionOpen}
                  aria-label="Rozwiń listę dywizji"
                >
                  <span className="truncate">{shortenDivisionLabel(currentDivisionLabel)}</span>
                  {mobileDivisionOpen ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
                </button>
              </>
            ) : null}

            {FLOW_STEPS.map((step, index) => {
              const isActive = index === currentIdx;
              const isPublicPreview = step.key === "public_preview";
              const isTeamsStep = step.key === "teams";
              const showPending = isTeamsStep && canSeeQueue && pendingNameReqCount > 0;

              return (
                <button
                  key={step.key}
                  type="button"
                  onClick={() => handleStepClick(index)}
                  disabled={!resolvedId}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "relative inline-flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-3.5 text-sm font-semibold transition",
                    "border border-white/10 bg-white/[0.06] text-slate-200 hover:bg-white/[0.10]",
                    "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/15",
                    "disabled:pointer-events-none disabled:opacity-60",
                    showPending && "border-amber-500/30"
                  )}
                >
                  {isActive ? (
                    <motion.div
                      layoutId={isTop ? "flow-step-active" : "flow-step-active-bottom"}
                      className="absolute inset-0 rounded-full bg-white/10"
                      transition={{ type: "spring", bounce: 0.18, duration: 0.55 }}
                    />
                  ) : null}

                  {isPublicPreview ? (
                    <Eye className="relative z-10 h-4 w-4 text-white/80" />
                  ) : (
                    <span className="relative z-10 opacity-80">{index + 1}.</span>
                  )}

                  <span className="relative z-10">{step.label}</span>

                  {showPending ? (
                    <span
                      className={cn(
                        "relative z-10 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full",
                        "border border-amber-500/40 bg-amber-500/10 px-1.5 text-xs font-bold text-amber-200"
                      )}
                      title="Oczekujące prośby o zmianę nazwy"
                    >
                      {pendingNameReqCount}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </nav>
    </StickyBar>
  );
}
