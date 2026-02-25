// frontend/src/ui/InlineAlert.tsx
// Komponent wyświetla komunikaty kontekstowe w obrębie widoku bez użycia toastów.

import type { ReactNode } from "react";
import { CheckCircle2, Info, XCircle } from "lucide-react";

import { cn } from "../lib/cn";

export type InlineAlertVariant = "info" | "success" | "error";

type Props = {
  variant?: InlineAlertVariant;
  title?: string;
  children: ReactNode;
  className?: string;
};

export function InlineAlert({ variant = "info", title, children, className }: Props) {
  // Konfiguracja wariantu zapewnia spójne kolory i ikonę komunikatu.
  const cfg = getVariantConfig(variant);

  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-2xl border px-3 py-2 sm:px-4 sm:py-3",
        "bg-white/[0.04] backdrop-blur",
        "shadow-[0_1px_0_rgba(255,255,255,0.06)_inset]",
        cfg.border,
        className
      )}
      role="status"
    >
      <div className="flex items-start gap-3">
        <cfg.Icon className={cn("mt-0.5 h-5 w-5 shrink-0", cfg.iconColor)} aria-hidden="true" />
        <div className="min-w-0">
          {title ? <div className="break-words text-sm font-semibold text-slate-100">{title}</div> : null}
          <div className="break-words text-sm leading-5 text-slate-200/90">{children}</div>
        </div>
      </div>
    </div>
  );
}

function getVariantConfig(variant: InlineAlertVariant) {
  switch (variant) {
    case "success":
      return { Icon: CheckCircle2, border: "border-emerald-400/20", iconColor: "text-emerald-300" };
    case "error":
      return { Icon: XCircle, border: "border-rose-400/20", iconColor: "text-rose-300" };
    default:
      return { Icon: Info, border: "border-white/10", iconColor: "text-sky-300" };
  }
}