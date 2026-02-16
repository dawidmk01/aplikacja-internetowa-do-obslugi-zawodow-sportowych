import * as React from "react";
import { cn } from "../lib/cn";

type Props = React.InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...props }: Props) {
  return (
    <input
      className={cn(
        "w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-slate-100",
        "placeholder:text-slate-400",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/10 focus-visible:border-white/20",
        className
      )}
      {...props}
    />
  );
}
