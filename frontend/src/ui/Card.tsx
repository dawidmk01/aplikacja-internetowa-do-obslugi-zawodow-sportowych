import type { HTMLAttributes } from "react";

import { cn } from "../lib/cn";

type Props = HTMLAttributes<HTMLDivElement>;

/** Card jest bazowym prymitywem powierzchni, aby utrzymać spójne tło i obramowanie w dark mode. */
export function Card({ className, ...props }: Props) {
  return (
    <div
      className={cn(
        "w-full min-w-0 overflow-hidden",
        "rounded-2xl border border-white/10 bg-white/[0.06] backdrop-blur",
        "shadow-[0_1px_0_rgba(255,255,255,0.06)_inset]",
        className
      )}
      {...props}
    />
  );
}