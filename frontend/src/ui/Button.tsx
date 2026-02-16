import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "../lib/cn";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
};

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-white text-slate-950 hover:bg-slate-100",
  secondary:
    "bg-white/10 text-slate-100 border border-white/15 hover:bg-white/15",
  danger:
    "bg-rose-500 text-white hover:bg-rose-400",
  ghost:
    "bg-transparent text-slate-200 hover:bg-white/10",
};

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
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/15",
        "disabled:opacity-50 disabled:pointer-events-none",
        variants[variant],
        className
      )}
      {...props}
    >
      {leftIcon}
      <span>{children}</span>
      {rightIcon}
    </motion.button>
  );
}
