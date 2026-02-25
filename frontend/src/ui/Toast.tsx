// frontend/src/ui/Toast.tsx
// Komponent zapewnia globalne powiadomienia systemowe w spójnym stylu.

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Info, Settings2, X, XCircle } from "lucide-react";

import { cn } from "../lib/cn";

import { Button } from "./Button";
import { Portal } from "./Portal";

type ToastVariant = "info" | "success" | "error";
type ToastCorner = "bottom-center" | "bottom-left" | "bottom-right" | "top-left" | "top-right";

type ToastItem = {
  id: string;
  title?: string;
  message: string;
  variant: ToastVariant;
  durationMs: number;
  createdAt: number;
  expiresAt: number;
};

type ToastInput = {
  title?: string;
  message: string;
  variant?: ToastVariant;
  durationMs?: number;
};

type ToastListener = (items: ToastItem[]) => void;
type PauseListener = (paused: boolean) => void;

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

const CORNER_KEY = "turnieje.toast.corner";

// ===== Konfiguracja klienta =====

function readCorner(): ToastCorner {
  try {
    const v = window.localStorage.getItem(CORNER_KEY) as ToastCorner | null;
    if (v && ["bottom-center", "bottom-left", "bottom-right", "top-left", "top-right"].includes(v)) {
      return v;
    }
  } catch {
    // Odczyt może być zablokowany przez ustawienia przeglądarki.
  }
  return "bottom-center";
}

function writeCorner(corner: ToastCorner) {
  try {
    window.localStorage.setItem(CORNER_KEY, corner);
  } catch {
    // Zapis może być zablokowany przez ustawienia przeglądarki.
  }
}

// ===== Magazyn toastów =====

const store = {
  items: [] as ToastItem[],
  listeners: new Set<ToastListener>(),
  pauseListeners: new Set<PauseListener>(),
  max: 3,
  paused: false,
  gcHandle: 0 as number | 0,

  emit() {
    const snapshot = [...this.items];
    for (const l of this.listeners) l(snapshot);
  },

  emitPaused() {
    for (const l of this.pauseListeners) l(this.paused);
  },

  ensureGc() {
    if (this.gcHandle) return;
    this.gcHandle = window.setInterval(() => {
      if (this.paused) return;

      const now = Date.now();
      const next = this.items.filter((t) => t.expiresAt > now);
      if (next.length !== this.items.length) {
        this.items = next;
        this.emit();
      }

      if (this.items.length === 0 && !this.paused) {
        window.clearInterval(this.gcHandle);
        this.gcHandle = 0;
      }
    }, 250);
  },

  setPaused(paused: boolean) {
    if (this.paused === paused) return;
    this.paused = paused;
    if (!paused) this.ensureGc();
    this.emitPaused();
  },

  subscribe(l: ToastListener) {
    this.listeners.add(l);
    l([...this.items]);
    return () => this.listeners.delete(l);
  },

  subscribePaused(l: PauseListener) {
    this.pauseListeners.add(l);
    l(this.paused);
    return () => this.pauseListeners.delete(l);
  },

  push(input: ToastInput) {
    const durationMs = input.durationMs ?? 3200;
    const now = Date.now();

    const item: ToastItem = {
      id: uid(),
      title: input.title,
      message: input.message,
      variant: input.variant ?? "info",
      durationMs,
      createdAt: now,
      expiresAt: now + durationMs,
    };

    this.items = [item, ...this.items].slice(0, this.max);
    this.emit();
    this.ensureGc();
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

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const [corner, setCorner] = useState<ToastCorner>(() => readCorner());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => store.subscribe(setItems), []);
  useEffect(() => store.subscribePaused(setPaused), []);

  useEffect(() => {
    store.setPaused(settingsOpen);
  }, [settingsOpen]);

  const dock = useMemo(() => getDockClasses(corner), [corner]);

  const canShow = items.length > 0 || settingsOpen;
  if (!canShow) return null;

  return (
    <>
      <div className={cn("fixed z-[9999] pointer-events-none", dock.container)} aria-live="polite">
        <div className="pointer-events-auto w-[min(560px,calc(100vw-2rem))] sm:w-[min(620px,calc(100vw-2rem))] 2xl:w-[min(960px,calc(100vw-2rem))]">
          <div className="relative z-10 mb-2 flex items-center justify-end gap-2 text-xs text-slate-300/80 select-none">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setSettingsOpen(true)}
              className={cn(
                "h-8 px-2 rounded-xl border border-white/10 bg-white/[0.04]",
                "hover:bg-white/[0.06] transition"
              )}
              leftIcon={<Settings2 className="h-3.5 w-3.5" />}
              aria-label="Ustawienia powiadomień"
              title="Ustawienia"
            >
              Ustaw
            </Button>
          </div>

          <div
            className={cn(
              "relative z-0 gap-2",
              "grid grid-cols-1",
              "2xl:grid-cols-2 2xl:grid-flow-row",
              "[min-width:1920px]:grid-cols-3",
              "[min-width:2560px]:grid-cols-4"
            )}
          >
            <AnimatePresence initial={false}>
              {items.map((t) => (
                <ToastCard key={t.id} item={t} onClose={() => toast.dismiss(t.id)} />
              ))}
            </AnimatePresence>
          </div>

          {paused ? (
            <div className="mt-2 text-[11px] text-slate-400">Tryb ustawień - czas powiadomień wstrzymany.</div>
          ) : null}
        </div>
      </div>

      {settingsOpen ? (
        <Portal>
          <div className="fixed inset-0 z-[10000]">
            <button
              type="button"
              className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
              aria-label="Zamknij ustawienia"
              onClick={() => setSettingsOpen(false)}
            />

            <div className="absolute inset-x-4 top-[calc(env(safe-area-inset-top)+88px)] mx-auto max-w-md">
              <div className="rounded-2xl border border-white/10 bg-slate-950/85 p-4 shadow-2xl backdrop-blur">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white break-words">Pozycja powiadomień</div>
                    <div className="mt-1 text-xs text-slate-300 break-words">Wybór zapisywany lokalnie w przeglądarce.</div>
                  </div>

                  <Button
                    variant="ghost"
                    className="h-9 w-9 p-0 rounded-xl shrink-0"
                    onClick={() => setSettingsOpen(false)}
                    aria-label="Zamknij"
                    leftIcon={<X className="h-4 w-4" />}
                  />
                </div>

                <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <CornerButton
                    active={corner === "top-left"}
                    onClick={() => setCornerAndPersist("top-left", setCorner)}
                    label="Góra - lewy"
                  />
                  <CornerButton
                    active={corner === "top-right"}
                    onClick={() => setCornerAndPersist("top-right", setCorner)}
                    label="Góra - prawy"
                  />
                  <CornerButton
                    active={corner === "bottom-left"}
                    onClick={() => setCornerAndPersist("bottom-left", setCorner)}
                    label="Dół - lewy"
                  />
                  <CornerButton
                    active={corner === "bottom-right"}
                    onClick={() => setCornerAndPersist("bottom-right", setCorner)}
                    label="Dół - prawy"
                  />

                  <CornerButton
                    active={corner === "bottom-center"}
                    onClick={() => setCornerAndPersist("bottom-center", setCorner)}
                    label="Dół - środek"
                    full
                  />
                </div>
              </div>
            </div>
          </div>
        </Portal>
      ) : null}
    </>
  );
}

function CornerButton({
  active,
  onClick,
  label,
  full,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  full?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "h-auto justify-start px-3 py-2 rounded-xl border text-left text-sm transition",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/15",
        active ? "border-white/20 bg-white/10 text-white" : "border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.06]",
        full ? "w-full sm:col-span-2" : "w-full"
      )}
    >
      {label}
    </Button>
  );
}

function setCornerAndPersist(c: ToastCorner, setCorner: (c: ToastCorner) => void) {
  setCorner(c);
  writeCorner(c);
}

function ToastCard({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const cfg = getVariantConfig(item.variant);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.98 }}
      transition={{ duration: 0.18 }}
      className={cn(
        "rounded-2xl border bg-white/[0.06] backdrop-blur",
        "shadow-[0_1px_0_rgba(255,255,255,0.06)_inset]",
        "px-4 py-3",
        "min-w-0",
        cfg.border
      )}
      role="status"
    >
      <div className="flex items-start gap-3 min-w-0">
        <div className={cn("mt-0.5 shrink-0", cfg.iconColor)} aria-hidden="true">
          <cfg.Icon className="h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1">
          {item.title ? (
            <div className="text-sm font-semibold text-slate-100 leading-5 break-words">{item.title}</div>
          ) : null}
          <div className="text-sm text-slate-200/90 leading-5 break-words">{item.message}</div>
        </div>

        <Button
          variant="ghost"
          className="h-8 w-8 p-0 rounded-xl shrink-0"
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
      return { Icon: CheckCircle2, border: "border-emerald-400/20", iconColor: "text-emerald-300" };
    case "error":
      return { Icon: XCircle, border: "border-rose-400/20", iconColor: "text-rose-300" };
    default:
      return { Icon: Info, border: "border-white/10", iconColor: "text-sky-300" };
  }
}

function getDockClasses(corner: ToastCorner) {
  const bottom = "bottom-[calc(env(safe-area-inset-bottom)+16px)]";
  const top = "top-[calc(env(safe-area-inset-top)+88px)]";

  switch (corner) {
    case "top-left":
      return { container: cn(top, "left-4") };
    case "top-right":
      return { container: cn(top, "right-4") };
    case "bottom-left":
      return { container: cn(bottom, "left-4") };
    case "bottom-right":
      return { container: cn(bottom, "right-4") };
    default:
      return { container: cn(bottom, "left-1/2 -translate-x-1/2") };
  }
}