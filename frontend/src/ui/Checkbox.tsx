// frontend/src/ui/Checkbox.tsx
// Komponent udostępnia checkbox o spójnym stylu i dostępności.

import type { ReactNode } from "react";
import type { InputHTMLAttributes } from "react";
import { forwardRef, useId } from "react";
import { Check } from "lucide-react";

import { cn } from "../lib/cn";

type Props = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;

  label?: ReactNode;
  description?: ReactNode;

  disabled?: boolean;
  className?: string;
  boxClassName?: string;

  id?: string;
  name?: string;
  inputProps?: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "checked" | "onChange" | "disabled" | "id" | "name">;
};

export const Checkbox = forwardRef<HTMLInputElement, Props>(function Checkbox(
  { checked, onCheckedChange, label, description, disabled, className, boxClassName, id, name, inputProps },
  ref
) {
  const autoId = useId();
  // Auto-id ułatwia powiązanie z label/aria.
  const resolvedId = id ?? `checkbox-${autoId.replace(/:/g, "")}`;

  return (
    <label
      className={cn(
        "inline-flex items-start gap-3",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
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
        {...inputProps}
      />

      <span
        className={cn(
          "mt-0.5 grid h-5 w-5 place-items-center rounded-md border border-white/15 bg-white/[0.04]",
          "shadow-[0_1px_0_rgba(255,255,255,0.05)_inset]",
          "peer-focus-visible:outline-none peer-focus-visible:ring-4 peer-focus-visible:ring-white/15",
          "peer-checked:border-white/25 peer-checked:bg-white",
          boxClassName
        )}
        aria-hidden="true"
      >
        <Check className={cn("h-3.5 w-3.5 text-slate-950 transition-opacity", checked ? "opacity-100" : "opacity-0")} />
      </span>

      {label || description ? (
        <span className="min-w-0">
          {label ? <span className="block text-sm font-medium text-slate-100">{label}</span> : null}
          {description ? <span className="mt-0.5 block text-xs text-slate-300/90">{description}</span> : null}
        </span>
      ) : null}
    </label>
  );
});
