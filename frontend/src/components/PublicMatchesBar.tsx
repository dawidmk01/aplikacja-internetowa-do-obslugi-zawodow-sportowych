// frontend/src/components/PublicMatchesBar.tsx
import { useEffect, useMemo, useRef, useState } from "react";
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

function readCssVarPx(name: string, fallbackPx: number): number {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const n = Number.parseFloat(raw);
    if (Number.isFinite(n)) return n;
  } catch {
    // ignore
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
  const barRef = useRef<HTMLDivElement | null>(null);

  const liveCount = useMemo(
    () => matches.filter((m) => m.status === "IN_PROGRESS").length,
    [matches]
  );
  const upcomingCount = useMemo(
    () => getUpcomingMatchesPreview(matches).length,
    [matches]
  );

  const [active, setActive] = useState<BarKey>("live");

  useEffect(() => {
    if (liveCount > 0) setActive("live");
    else setActive("upcoming");
  }, [liveCount]);

  if (!matches || matches.length === 0) return null;

  const isTop = side === "top";
  const flowH = underFlowNav ? readCssVarPx("--app-flowbar-h", 0) : 0;

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;

    if (!isTop) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    const navbarH = readCssVarPx("--app-navbar-h", 84);
    const barH = barRef.current?.getBoundingClientRect().height ?? 62;
    const extra = 12;

    const top =
      el.getBoundingClientRect().top +
      window.scrollY -
      (navbarH + flowH + topGapPx + barH + extra);

    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  };

  const handleClick = (key: BarKey) => {
    setActive(key);
    scrollTo(key === "live" ? liveTargetId : upcomingTargetId);
  };

  const pillBase =
    "relative inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold transition " +
    "border border-white/10 bg-white/[0.06] text-slate-200 hover:bg-white/[0.10] " +
    "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/15";

  const badgeBase =
    "relative z-10 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full " +
    "border border-white/10 bg-white/5 px-1.5 text-xs font-bold text-slate-100";

  const topOffsetCss =
    isTop && underFlowNav
      ? "calc(var(--app-navbar-h, 84px) + var(--app-flowbar-h, 0px))"
      : undefined;

  return (
    <StickyBar
      side={side}
      className={className}
      zIndexClassName={isTop ? (underFlowNav ? "z-30" : "z-40") : "z-50"}
      maxWidthClassName="max-w-none"
      topGapPx={topGapPx}
      topOffsetCss={topOffsetCss}
      spacerHeightClassName={spacerHeightClassName ?? "h-16 sm:h-[72px]"}
      contentClassName="p-2 sm:p-2.5"
    >
      <nav ref={barRef} aria-label="Szybka nawigacja meczów">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => handleClick("live")}
            className={cn(
              pillBase,
              liveCount > 0 ? "border-emerald-500/25" : "opacity-80"
            )}
            aria-current={active === "live" ? "page" : undefined}
          >
            {active === "live" ? (
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
            className={cn(
              pillBase,
              upcomingCount > 0 ? "border-sky-500/25" : "opacity-80"
            )}
            aria-current={active === "upcoming" ? "page" : undefined}
          >
            {active === "upcoming" ? (
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

/*
Co zmieniono:
- Dodano stały pasek nawigacji meczów (Na żywo, Najbliższe) w stylu pill jak w TournamentFlowNav.
- Pasek skroluje do sekcji PublicMatchesPanel z poprawnym offsetem (NavBar + opcjonalnie FlowNav).
- Liczniki bazują na tej samej logice co panel (preview najbliższych meczów).
*/