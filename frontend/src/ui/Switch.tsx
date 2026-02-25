// frontend/src/ui/Switch.tsx
// Komponent udostępnia przełącznik o spójnym stylu i dostępności.

import type { InputHTMLAttributes } from "react";
import { forwardRef, useId } from "react";

import { cn } from "../lib/cn";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "checked" | "onChange"> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
};

export const Switch = forwardRef<HTMLInputElement, Props>(function Switch(
  { checked, onCheckedChange, disabled, className, id, name, ...props },
  ref
) {
  const autoId = useId();
  // Auto-id ułatwia powiązanie z label/aria.
  const resolvedId = id ?? `switch-${autoId.replace(/:/g, "")}`;

  return (
    <label
      className={cn(
        "relative inline-flex cursor-pointer select-none items-center",
        disabled ? "opacity-60" : null,
        className
      )}
    >
      <input
        ref={ref}
        id={resolvedId}
        name={name}
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(e) => onCheckedChange(e.target.checked)}
        disabled={disabled}
        {...props}
      />

      <span className="h-6 w-11 rounded-full border border-white/10 bg-white/10 peer-checked:bg-white/25" aria-hidden="true" />
      <span
        className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white/80 transition peer-checked:translate-x-5"
        aria-hidden="true"
      />
    </label>
  );
});
