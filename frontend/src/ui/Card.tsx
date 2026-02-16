import * as React from "react";
import { cn } from "../lib/cn";

type Props = React.HTMLAttributes<HTMLDivElement>;

export function Card({ className, ...props }: Props) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/10 bg-white/[0.06] backdrop-blur",
        "shadow-[0_1px_0_rgba(255,255,255,0.06)_inset]",
        className
      )}
      {...props}
    />
  );
}
