import type { CSSProperties, ReactNode } from "react";

import { cn } from "../lib/cn";

type StickyBarSide = "top" | "bottom";

type StickyBarProps = {
  side: StickyBarSide;
  children: ReactNode;

  className?: string;
  contentClassName?: string;

  maxWidthClassName?: string;
  outerPaddingClassName?: string;
  zIndexClassName?: string;

  spacerHeightClassName?: string;

  topGapPx?: number;
  topOffsetCss?: string;
};

/** StickyBar ujednolica stałe paski akcji (top/bottom) i ich nakładanie z nawigacją aplikacji. */
export function StickyBar({
  side,
  children,
  className,
  contentClassName,
  maxWidthClassName = "max-w-none",
  outerPaddingClassName = "px-3 sm:px-4 md:px-6 lg:px-8 xl:px-10 2xl:px-12",
  zIndexClassName = "z-40",
  spacerHeightClassName = side === "bottom" ? "h-14 sm:h-16" : "h-16 sm:h-20",
  topGapPx = 10,
  topOffsetCss = "var(--app-navbar-h, 84px)",
}: StickyBarProps) {
  const isTop = side === "top";

  const style: CSSProperties = {};
  if (isTop) {
    style.top = `calc(${topOffsetCss} + ${topGapPx}px)`;
  } else {
    style.bottom = 0;
  }

  return (
    <>
      <div className={spacerHeightClassName} />

      <div
        style={style}
        className={cn(
          "fixed inset-x-0",
          outerPaddingClassName,
          zIndexClassName,
          "max-w-[100vw]",
          !isTop && "pb-[calc(env(safe-area-inset-bottom)+10px)]",
          className
        )}
      >
        <div className={cn("mx-auto w-full min-w-0", maxWidthClassName)}>
          <div
            className={cn(
              "min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-slate-950/80 backdrop-blur",
              "shadow-[0_10px_30px_rgba(0,0,0,0.35)]",
              "p-2 sm:p-2.5",
              contentClassName
            )}
          >
            {children}
          </div>
        </div>
      </div>
    </>
  );
}