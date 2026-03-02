// frontend/src/ui/Button.tsx
// Komponent udostępnia spójny przycisk akcji w całej aplikacji.

import { forwardRef } from "react";
import type { ReactNode } from "react";
import { motion } from "framer-motion";
import type { HTMLMotionProps } from "framer-motion";

import { cn } from "../lib/cn";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

type Props = Omit<HTMLMotionProps<"button">, "children"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  children?: ReactNode;
};

const variants: Record<ButtonVariant, string> = {
  primary: "bg-white text-slate-950 hover:bg-slate-100",
  secondary: "bg-white/10 text-slate-100 border border-white/15 hover:bg-white/15",
  danger: "bg-rose-500 text-white hover:bg-rose-400",
  ghost: "bg-transparent text-slate-200 hover:bg-white/10",
};

const sizes: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
  lg: "px-5 py-2.5 text-base",
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  {
    className,
    variant = "primary",
    size = "md",
    leftIcon,
    rightIcon,
    children,
    disabled,
    type = "button",
    ...props
  },
  ref
) {
  return (
    <motion.button
      ref={ref}
      type={type}
      disabled={disabled}
      whileHover={disabled ? undefined : { y: -1 }}
      whileTap={disabled ? undefined : { scale: 0.98 }}
      className={cn(
        "inline-flex min-w-0 items-center justify-center gap-2 rounded-xl",
        "font-semibold transition-colors",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/15",
        "disabled:pointer-events-none disabled:opacity-50",
        sizes[size],
        variants[variant],
        className
      )}
      {...props}
    >
      {leftIcon ? <span className="shrink-0">{leftIcon}</span> : null}
      {children !== undefined && children !== null ? <span className="min-w-0 truncate">{children}</span> : null}
      {rightIcon ? <span className="shrink-0">{rightIcon}</span> : null}
    </motion.button>
  );
});