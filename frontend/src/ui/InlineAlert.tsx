import * as React from "react";
import { cn } from "../lib/cn";
import { CheckCircle2, Info, XCircle } from "lucide-react";

type Variant = "info" | "success" | "error";

export function InlineAlert({
  variant,
  title,
  children,
  className,
}: {
  variant: Variant;
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const cfg = getVariantConfig(variant);

  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-3",
        "bg-white/[0.04] backdrop-blur",
        "shadow-[0_1px_0_rgba(255,255,255,0.06)_inset]",
        cfg.border,
        className
      )}
      role="status"
    >
      <div className="flex items-start gap-3">
        <cfg.Icon className={cn("mt-0.5 h-5 w-5", cfg.iconColor)} aria-hidden="true" />
        <div className="min-w-0">
          {title ? <div className="text-sm font-semibold text-slate-100">{title}</div> : null}
          <div className="text-sm text-slate-200/90 leading-5">{children}</div>
        </div>
      </div>
    </div>
  );
}

function getVariantConfig(variant: Variant) {
  switch (variant) {
    case "success":
      return { Icon: CheckCircle2, border: "border-emerald-400/20", iconColor: "text-emerald-300" };
    case "error":
      return { Icon: XCircle, border: "border-rose-400/20", iconColor: "text-rose-300" };
    default:
      return { Icon: Info, border: "border-white/10", iconColor: "text-sky-300" };
  }
}
