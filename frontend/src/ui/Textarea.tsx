// frontend/src/ui/Textarea.tsx
// Komponent ujednolica styl pól wieloliniowych i zapewnia stabilne id.

import type { TextareaHTMLAttributes } from "react";
import { forwardRef, useId } from "react";

import { cn } from "../lib/cn";

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "size"> & {
  unstyled?: boolean;
};

export const Textarea = forwardRef<HTMLTextAreaElement, Props>(function Textarea(
  { className, id, unstyled, ...props },
  ref
) {
  const autoId = useId();
  // Auto-id ułatwia powiązanie z label/aria.
  const resolvedId = id ?? `textarea-${autoId.replace(/:/g, "")}`;

  // Tryb unstyled pozwala zachować zewnętrzne klasy bez narzucania stylu.
  if (unstyled) {
    return <textarea ref={ref} id={resolvedId} className={className} {...props} />;
  }

  const baseClassName = cn(
    "w-full min-w-0 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5",
    "text-sm text-slate-100 placeholder:text-slate-500",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60",
    "disabled:pointer-events-none disabled:opacity-50",
    "resize-y min-h-[96px]",
    className
  );

  return <textarea ref={ref} id={resolvedId} className={baseClassName} {...props} />;
});
