// frontend/src/ui/LinkButton.tsx
// Komponent ujednolica wygląd linku-akcji w stylu Button.

import type { ReactNode } from "react";
import type { LinkProps } from "react-router-dom";
import { Link } from "react-router-dom";

import { cn } from "../lib/cn";

export type LinkButtonVariant = "primary" | "secondary" | "danger" | "ghost";

type Props = LinkProps & {
  variant?: LinkButtonVariant;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
};

const variants: Record<LinkButtonVariant, string> = {
  primary: "bg-white text-slate-950 hover:bg-slate-100",
  secondary: "bg-white/10 text-slate-100 border border-white/15 hover:bg-white/15",
  danger: "bg-rose-500 text-white hover:bg-rose-400",
  ghost: "bg-transparent text-slate-200 hover:bg-white/10",
};

export function LinkButton({ className, variant = "primary", leftIcon, rightIcon, children, ...props }: Props) {
  return (
    <Link
      className={cn(
        "inline-flex min-w-0 items-center justify-center gap-2 rounded-xl px-4 py-2",
        "text-sm font-semibold transition-colors",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/15",
        variants[variant],
        className
      )}
      {...props}
    >
      {leftIcon ? <span className="shrink-0">{leftIcon}</span> : null}
      <span className="min-w-0 truncate">{children}</span>
      {rightIcon ? <span className="shrink-0">{rightIcon}</span> : null}
    </Link>
  );
}
