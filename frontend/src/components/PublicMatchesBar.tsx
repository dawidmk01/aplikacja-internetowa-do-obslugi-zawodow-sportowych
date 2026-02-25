import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { CalendarClock, Radio } from "lucide-react";

import { cn } from "../lib/cn";

import { StickyBar } from "../ui/StickyBar";

import type { MatchPublicDTO } from "./PublicMatchesPanel";
import { getUpcomingMatchesPreview } from "./PublicMatchesPanel";

type BarKey = "live" | "upcoming";

type Props = {
  matches: MatchPublicDTO[];
  className?: string;

  // Gdy pasek ma być pod TournamentFlowNav (dla organizatora/asystenta).
  underFlowNav?: boolean;

  // Domyślnie: top. Dla publicznej strony to najczytelniejsze.
  side?: "top" | "bottom";

  // ID sekcji w PublicMatchesPanel
  liveTargetId?: string;
  upcomingTargetId?: string;

  // Dla top: dodatkowa przerwa pod NavBarem.
  topGapPx?: number;

  // Spacer w DOM, żeby fixed bar nie przykrywał treści.
  spacerHeightClassName?: string;
};

// Odczyt CSS var z fallbackiem, bezpieczny dla środowisk bez DOM.
function readCssVarPx(name: string, fallbackPx: number): number {
  if (typeof window === "undefined" || typeof document === "undefined") return fallbackPx;

  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const n = Number.parseFloat(raw);
    if (Number.isFinite(n)) return n;
  } catch {
    // brak
  }

  return fallbackPx;
}

export default function PublicMatchesBar({
  matches,
  className,
  underFlowNav = false,
  side = "top",
  liveTargetId = "public-matches-live",
  upcomingTargetId = "public-matches-upcoming",
  topGapPx = 12,
  spacerHeightClassName,
}: Props) {
  const navRef = useRef<HTMLElement | null>(null);

  const liveCount = useMemo(
    () => (Array.isArray(matches) ? matches.filter((m) => m.status === "IN_PROGRESS").length : 0),
    [matches]
  );

  const upcomingCount = useMemo(
    () => (Array.isArray(matches) ? getUpcomingMatchesPreview(matches).length : 0),
    [matches]
  );

  const [active, setActive] = useState<BarKey>("live");

  const isTop = side === "top";

  const flowH = useMemo(() => {
    if (!underFlowNav) return 0;
    return readCssVarPx("--app-flowbar-h", 0);
  }, [underFlowNav]);

  useEffect(() => {
    // Preferuj "Na żywo" jeśli są mecze w trakcie, w przeciwnym razie "Najbliższe" jeśli istnieją.
    setActive((prev) => {
      if (prev === "live" && liveCount === 0 && upcomingCount > 0) return "upcoming";
      if (prev === "upcoming" && upcomingCount === 0 && liveCount > 0) return "live";
      if (liveCount > 0) return "live";
      if (upcomingCount > 0) return "upcoming";
      return prev;
    });
  }, [liveCount, upcomingCount]);

  const scrollTo = useCallback(
    (id: string) => {
      if (typeof window === "undefined" || typeof document === "undefined") return;

      const el = document.getElementById(id);
      if (!el) return;

      if (!isTop) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }

      const navbarH = readCssVarPx("--app-navbar-h", 84);
      const barH = navRef.current?.getBoundingClientRect().height ?? 62;
      const extra = 12;

      const top =
        el.getBoundingClientRect().top +
        window.scrollY -
        (navbarH + flowH + topGapPx + barH + extra);

      window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    },
    [flowH, isTop, topGapPx]
  );

  const handleClick = useCallback(
    (key: BarKey) => {
      setActive(key);
      scrollTo(key === "live" ? liveTargetId : upcomingTargetId);
    },
    [liveTargetId, scrollTo, upcomingTargetId]
  );

  if (!Array.isArray(matches) || matches.length === 0) return null;

  const pillBase = cn(
    "relative inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold transition",
    "border border-white/10 bg-white/[0.06] text-slate-200 hover:bg-white/[0.10]",
    "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/15"
  );

  const badgeBase = cn(
    "relative z-10 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full",
    "border border-white/10 bg-white/5 px-1.5 text-xs font-bold text-slate-100"
  );

  const topOffsetCss =
    isTop && underFlowNav
      ? "calc(var(--app-navbar-h, 84px) + var(--app-flowbar-h, 0px))"
      : undefined;

  const isLiveActive = active === "live";
  const isUpcomingActive = active === "upcoming";

  return (
    <StickyBar
      side={side}
      className={className}
      zIndexClassName={isTop ? (underFlowNav ? "z-30" : "z-40") : "z-50"}
      maxWidthClassName="max-w-[1400px]"
      topGapPx={topGapPx}
      topOffsetCss={topOffsetCss}
      spacerHeightClassName={spacerHeightClassName ?? "h-16 sm:h-[72px]"}
      contentClassName="p-2 sm:p-2.5"
    >
      <nav ref={navRef} aria-label="Szybka nawigacja meczów">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => handleClick("live")}
            className={cn(pillBase, liveCount > 0 ? "border-emerald-500/25" : "opacity-80")}
            aria-pressed={isLiveActive}
            aria-controls={liveTargetId}
          >
            {isLiveActive ? (
              <motion.div
                layoutId="public-matches-bar-active"
                className="absolute inset-0 rounded-full bg-white/10"
                transition={{ type: "spring", bounce: 0.18, duration: 0.55 }}
              />
            ) : null}

            <Radio className="relative z-10 h-4 w-4 text-white/80" />
            <span className="relative z-10">Na żywo</span>
            <span className={badgeBase} title="Mecze w trakcie">
              {liveCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleClick("upcoming")}
            className={cn(pillBase, upcomingCount > 0 ? "border-sky-500/25" : "opacity-80")}
            aria-pressed={isUpcomingActive}
            aria-controls={upcomingTargetId}
          >
            {isUpcomingActive ? (
              <motion.div
                layoutId="public-matches-bar-active"
                className="absolute inset-0 rounded-full bg-white/10"
                transition={{ type: "spring", bounce: 0.18, duration: 0.55 }}
              />
            ) : null}

            <CalendarClock className="relative z-10 h-4 w-4 text-white/80" />
            <span className="relative z-10">Najbliższe</span>
            <span className={badgeBase} title="Najbliższe zaplanowane mecze">
              {upcomingCount}
            </span>
          </button>
        </div>
      </nav>
    </StickyBar>
  );
}