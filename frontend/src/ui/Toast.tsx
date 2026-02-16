import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Info, XCircle, X } from "lucide-react";
import { cn } from "../lib/cn";
import { Button } from "./Button";

type ToastVariant = "info" | "success" | "error";

type ToastItem = {
  id: string;
  title?: string;
  message: string;
  variant: ToastVariant;
  durationMs: number;
};

type ToastInput = {
  title?: string;
  message: string;
  variant?: ToastVariant;
  durationMs?: number;
};

type ToastListener = (items: ToastItem[]) => void;

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

/**
 * Minimalny globalny store (bez Contextu), żeby `toast.*` dało się wywołać z dowolnego pliku
 * (np. z apiFetch, utils, stron, itp.).
 */
const store = {
  items: [] as ToastItem[],
  listeners: new Set<ToastListener>(),
  max: 3,

  emit() {
    const snapshot = [...this.items];
    for (const l of this.listeners) l(snapshot);
  },

  subscribe(l: ToastListener) {
    this.listeners.add(l);
    l([...this.items]);
    return () => this.listeners.delete(l);
  },

  push(input: ToastInput) {
    const item: ToastItem = {
      id: uid(),
      title: input.title,
      message: input.message,
      variant: input.variant ?? "info",
      durationMs: input.durationMs ?? 3200,
    };

    this.items = [item, ...this.items].slice(0, this.max);
    this.emit();

    window.setTimeout(() => this.remove(item.id), item.durationMs);
    return item.id;
  },

  remove(id: string) {
    const next = this.items.filter((t) => t.id !== id);
    if (next.length === this.items.length) return;
    this.items = next;
    this.emit();
  },

  clear() {
    this.items = [];
    this.emit();
  },
};

export const toast = {
  info(message: string, opts?: Omit<ToastInput, "message" | "variant">) {
    return store.push({ ...opts, message, variant: "info" });
  },
  success(message: string, opts?: Omit<ToastInput, "message" | "variant">) {
    return store.push({ ...opts, message, variant: "success" });
  },
  error(message: string, opts?: Omit<ToastInput, "message" | "variant">) {
    return store.push({ ...opts, message, variant: "error" });
  },
  dismiss(id: string) {
    store.remove(id);
  },
  clear() {
    store.clear();
  },
};

/**
 * Montujesz RAZ w App.tsx.
 * Pozycja: dół widocznego viewportu (fixed).
 */
export function Toaster() {
  const [items, setItems] = React.useState<ToastItem[]>([]);

  React.useEffect(() => store.subscribe(setItems), []);

  return (
    <div
      className={cn(
        "fixed left-1/2 z-50 -translate-x-1/2",
        "w-[min(560px,calc(100vw-2rem))]",
        "bottom-4 pb-[env(safe-area-inset-bottom)]",
        "pointer-events-none"
      )}
      aria-live="polite"
      aria-relevant="additions"
    >
      <div className="flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {items.map((t) => (
            <ToastCard
              key={t.id}
              item={t}
              onClose={() => toast.dismiss(t.id)}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function ToastCard({
  item,
  onClose,
}: {
  item: ToastItem;
  onClose: () => void;
}) {
  const cfg = getVariantConfig(item.variant);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.98 }}
      transition={{ duration: 0.18 }}
      className={cn(
        "pointer-events-auto",
        // styl spójny z Card.tsx
        "rounded-2xl border bg-white/[0.06] backdrop-blur",
        "shadow-[0_1px_0_rgba(255,255,255,0.06)_inset]",
        "px-4 py-3",
        cfg.border
      )}
      role="status"
    >
      <div className="flex items-start gap-3">
        <div className={cn("mt-0.5", cfg.iconColor)} aria-hidden="true">
          <cfg.Icon className="h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1">
          {item.title ? (
            <div className="text-sm font-semibold text-slate-100 leading-5">
              {item.title}
            </div>
          ) : null}
          <div className="text-sm text-slate-200/90 leading-5">
            {item.message}
          </div>
        </div>

        <Button
          variant="ghost"
          className="h-8 w-8 p-0 rounded-xl"
          onClick={onClose}
          aria-label="Zamknij"
          leftIcon={<X className="h-4 w-4" />}
        />
      </div>
    </motion.div>
  );
}

function getVariantConfig(variant: ToastVariant) {
  switch (variant) {
    case "success":
      return {
        Icon: CheckCircle2,
        border: "border-emerald-400/20",
        iconColor: "text-emerald-300",
      };
    case "error":
      return {
        Icon: XCircle,
        border: "border-rose-400/20",
        iconColor: "text-rose-300",
      };
    default:
      return {
        Icon: Info,
        border: "border-white/10",
        iconColor: "text-sky-300",
      };
  }
}
