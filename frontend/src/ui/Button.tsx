import type { ButtonHTMLAttributes, ReactNode } from "react";
import { motion } from "framer-motion";

import { cn } from "../lib/cn";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
};

/** Warianty definiują semantykę akcji, aby utrzymać spójne znaczenie kolorów w całej aplikacji. */
const variants: Record<ButtonVariant, string> = {
  primary: "bg-white text-slate-950 hover:bg-slate-100",
  secondary: "bg-white/10 text-slate-100 border border-white/15 hover:bg-white/15",
  danger: "bg-rose-500 text-white hover:bg-rose-400",
  ghost: "bg-transparent text-slate-200 hover:bg-white/10",
};

/** Button centralizuje style interakcji (focus/disabled) i ogranicza rozproszenie klas w widokach. */
export function Button({
  className,
  variant = "primary",
  leftIcon,
  rightIcon,
  children,
  ...props
}: Props) {
  return (
    <motion.button
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.98 }}
      className={cn(
        "inline-flex min-w-0 items-center justify-center gap-2 rounded-xl px-4 py-2",
        "text-sm font-semibold transition-colors",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/15",
        "disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        className
      )}
      {...props}
    >
      {leftIcon ? <span className="shrink-0">{leftIcon}</span> : null}
      <span className="min-w-0 truncate">{children}</span>
      {rightIcon ? <span className="shrink-0">{rightIcon}</span> : null}
    </motion.button>
  );
}