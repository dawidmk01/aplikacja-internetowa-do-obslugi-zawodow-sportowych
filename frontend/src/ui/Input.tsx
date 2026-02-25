// frontend/src/ui/Input.tsx
// Komponent ujednolica styl pól tekstowych i zapewnia stabilne id.

import type { InputHTMLAttributes, ReactNode } from "react";
import { forwardRef, useId } from "react";

import { cn } from "../lib/cn";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  wrapperClassName?: string;
  unstyled?: boolean;
};

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { className, leftIcon, rightIcon, wrapperClassName, id, unstyled, ...props },
  ref
) {
  const autoId = useId();
  // Auto-id ułatwia powiązanie z label/aria.
  const resolvedId = id ?? `input-${autoId.replace(/:/g, "")}`;

  // Tryb unstyled pozwala zachować zewnętrzne klasy bez narzucania stylu.
  if (unstyled) {
    return <input ref={ref} id={resolvedId} className={className} {...props} />;
  }

  const baseInputClassName = cn(
    "w-full min-w-0 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5",
    "text-sm text-slate-100 placeholder:text-slate-500",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60",
    "disabled:pointer-events-none disabled:opacity-50",
    leftIcon ? "pl-11" : null,
    rightIcon ? "pr-11" : null,
    className
  );

  if (!leftIcon && !rightIcon) {
    return <input ref={ref} id={resolvedId} className={baseInputClassName} {...props} />;
  }

  return (
    <div className={cn("relative w-full min-w-0", wrapperClassName)}>
      {leftIcon ? (
        <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
          {leftIcon}
        </div>
      ) : null}

      <input ref={ref} id={resolvedId} className={baseInputClassName} {...props} />

      {rightIcon ? (
        <div className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-300">{rightIcon}</div>
      ) : null}
    </div>
  );
});
