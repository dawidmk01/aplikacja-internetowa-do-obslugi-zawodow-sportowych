// frontend/src/ui/Select.tsx
// Komponent udostępnia kontrolkę wyboru o spójnym stylu i dostępności.

import type { CSSProperties, ReactNode, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Search, X } from "lucide-react";

import { cn } from "../lib/cn";

import { Input } from "./Input";
import { Portal } from "./Portal";

export type SelectOption<T extends string | number = string> = {
  value: T;
  label: string;
  description?: string;
  disabled?: boolean;
  leftIcon?: ReactNode;
};

type SelectSize = "sm" | "md";
type SelectAlign = "start" | "end";

type Props<T extends string | number = string> = {
  value: T | null;
  onChange: (value: T) => void;
  options: SelectOption<T>[];

  placeholder?: string;
  disabled?: boolean;

  searchable?: boolean;
  searchPlaceholder?: string;

  size?: SelectSize;
  align?: SelectAlign;

  className?: string;
  buttonClassName?: string;
  menuClassName?: string;

  ariaLabel?: string;
};

type Placement = "bottom" | "top";

function norm(s: string) {
  return (s || "").toLowerCase().trim();
}

export function Select<T extends string | number = string>({
  value,
  onChange,
  options,
  placeholder = "Wybierz...",
  disabled,
  searchable,
  searchPlaceholder = "Szukaj...",
  size = "md",
  align = "start",
  className,
  buttonClassName,
  menuClassName,
  ariaLabel,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);

  const [placement, setPlacement] = useState<Placement>("bottom");
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const [maxMenuH, setMaxMenuH] = useState<number>(320);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selected = useMemo(() => options.find((o) => o.value === value) ?? null, [options, value]);

  const filtered = useMemo(() => {
    if (!searchable) return options;
    const q = norm(query);
    if (!q) return options;
    return options.filter((o) => norm(o.label).includes(q) || norm(o.description ?? "").includes(q));
  }, [options, query, searchable]);

  const selectedIndexInFiltered = useMemo(() => {
    if (value === null) return -1;
    return filtered.findIndex((o) => o.value === value);
  }, [filtered, value]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveIndex(-1);
  }, []);

  const openMenu = useCallback(() => {
    if (disabled) return;
    setOpen(true);
  }, [disabled]);

  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const margin = 12;
    const offset = 8;

    const width = Math.min(rect.width, Math.max(0, vw - margin * 2));
    const rawLeft = align === "end" ? rect.right - width : rect.left;
    const left = Math.max(margin, Math.min(rawLeft, vw - width - margin));

    const roomBelow = vh - rect.bottom - margin - offset;
    const roomAbove = rect.top - margin - offset;

    const shouldOpenTop = roomBelow < 240 && roomAbove > roomBelow;
    setPlacement(shouldOpenTop ? "top" : "bottom");
    const available = shouldOpenTop ? roomAbove : roomBelow;
    const chromeH = (searchable ? 64 : 0) + 16;
    setMaxMenuH(Math.max(0, Math.floor(available - chromeH)));

    const top = shouldOpenTop ? rect.top - offset : rect.bottom + offset;

    setMenuStyle({
      position: "fixed",
      left,
      top,
      width,
    });
  }, [align, searchable]);

  useEffect(() => {
    if (!open) return;

    updatePosition();
    const onResize = () => updatePosition();
    const onScroll = () => updatePosition();

    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;

    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node | null;
      if (!t) return;

      if (triggerRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;

      close();
    };

    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("touchstart", onDown, true);

    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("touchstart", onDown, true);
    };
  }, [open, close]);

  useEffect(() => {
    if (!open) return;

    const initial = selectedIndexInFiltered >= 0 ? selectedIndexInFiltered : 0;
    setActiveIndex(filtered.length ? Math.min(initial, filtered.length - 1) : -1);

    queueMicrotask(() => {
      if (searchable) return;
      optionRefs.current[initial]?.focus();
    });
  }, [open, filtered.length, searchable, selectedIndexInFiltered]);

  useEffect(() => {
    if (!open) return;
    if (activeIndex < 0) return;
    optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  const sizes = {
    sm: "h-9 px-3 text-sm rounded-xl",
    md: "h-10 px-3.5 text-sm rounded-xl",
  } satisfies Record<SelectSize, string>;

  const onTriggerKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;

    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open ? close() : openMenu();
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) openMenu();
      else setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) openMenu();
      else setActiveIndex((i) => Math.max(i - 1, 0));
    }
  };

  const onMenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(filtered.length ? 0 : -1);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      setActiveIndex(filtered.length ? filtered.length - 1 : -1);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const o = filtered[activeIndex];
      if (!o || o.disabled) return;
      onChange(o.value);
      close();
      triggerRef.current?.focus();
    }
  };

  return (
    <div className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        className={cn(
          "w-full inline-flex items-center justify-between gap-3",
          "border border-white/10 bg-white/[0.06] text-slate-100",
          "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/10 focus-visible:border-white/20",
          "disabled:pointer-events-none disabled:opacity-50",
          sizes[size],
          buttonClassName
        )}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onTriggerKeyDown}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={cn("min-w-0 flex-1 text-left", !selected && "text-slate-400")}>
          <span className="block truncate">{selected ? selected.label : placeholder}</span>
        </span>

        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-slate-300 transition", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>

      <AnimatePresence>
        {open ? (
          <Portal>
            <motion.div
              initial={{ opacity: 0, y: placement === "top" ? -8 : 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: placement === "top" ? -6 : 6, scale: 0.98 }}
              transition={{ duration: 0.14 }}
              style={menuStyle}
              className={cn(placement === "top" && "-translate-y-full")}
            >
              <div
                ref={menuRef}
                className={cn(
                  "rounded-2xl border border-white/10 bg-slate-950/90 backdrop-blur",
                  "shadow-[0_18px_50px_rgba(0,0,0,0.55)]",
                  "overflow-hidden",
                  menuClassName
                )}
                onKeyDown={onMenuKeyDown}
              >
                {searchable ? (
                  <div className="p-2 border-b border-white/10">
                    <div className="relative">
                      <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={searchPlaceholder}
                        className="pr-9"
                        autoFocus
                      />
                      {query ? (
                        <button
                          type="button"
                          className={cn(
                            "absolute right-2 top-1/2 -translate-y-1/2",
                            "rounded-lg p-1 text-slate-300 hover:bg-white/[0.06]"
                          )}
                          onClick={() => setQuery("")}
                          aria-label="Wyczyść"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      ) : (
                        <span
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400"
                          aria-hidden="true"
                        >
                          <Search className="h-4 w-4" />
                        </span>
                      )}
                    </div>
                  </div>
                ) : null}

                <div role="listbox" className="p-1 overflow-auto" style={{ maxHeight: maxMenuH }}>
                  {filtered.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-slate-400">Brak wyników.</div>
                  ) : (
                    filtered.map((o, idx) => {
                      const isSelected = value !== null && o.value === value;
                      const isActive = idx === activeIndex;

                      return (
                        <button
                          key={String(o.value)}
                          ref={(el) => {
                            optionRefs.current[idx] = el;
                          }}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          disabled={!!o.disabled}
                          className={cn(
                            "w-full text-left rounded-xl px-3 py-2",
                            "text-sm text-slate-100",
                            "flex items-start gap-3",
                            "transition",
                            isActive && "bg-white/10",
                            !isActive && "hover:bg-white/[0.06]",
                            o.disabled && "opacity-50 pointer-events-none"
                          )}
                          onMouseEnter={() => setActiveIndex(idx)}
                          onClick={() => {
                            if (o.disabled) return;
                            onChange(o.value);
                            close();
                            triggerRef.current?.focus();
                          }}
                        >
                          <div className="mt-0.5">
                            {o.leftIcon ? (
                              <span className="text-slate-200">{o.leftIcon}</span>
                            ) : (
                              <span className="inline-flex h-5 w-5 items-center justify-center rounded-md border border-white/10 bg-white/[0.04]">
                                {isSelected ? <Check className="h-3.5 w-3.5 text-white" /> : null}
                              </span>
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <div className="truncate">{o.label}</div>
                              {isSelected && o.leftIcon ? <Check className="h-4 w-4 text-white/90" /> : null}
                            </div>
                            {o.description ? (
                              <div className="mt-0.5 text-xs text-slate-300/90">{o.description}</div>
                            ) : null}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </motion.div>
          </Portal>
        ) : null}
      </AnimatePresence>
    </div>
  );
}