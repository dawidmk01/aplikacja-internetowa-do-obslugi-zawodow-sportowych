// frontend/src/ui/Modal.tsx
// Komponent zapewnia warstwę overlay z portalem i obsługą zamykania.

import type { ReactNode, RefObject } from "react";
import { useEffect } from "react";

import { cn } from "../lib/cn";

import { Portal } from "./Portal";

type Props = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;

  className?: string;
  zIndexClassName?: string;

  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;

  initialFocusRef?: RefObject<HTMLElement>;
};

export function Modal({
  open,
  onClose,
  children,
  className,
  zIndexClassName = "z-[10050]",
  closeOnBackdrop = true,
  closeOnEscape = true,
  initialFocusRef,
}: Props) {
  // Blokada scrolla i przywrócenie fokusu po zamknięciu.
  useEffect(() => {
    if (!open) return;

    const prevFocus = (document.activeElement as HTMLElement | null) ?? null;
    const prevOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";

    const t = window.setTimeout(() => {
      const el = initialFocusRef?.current;
      el?.focus?.();
    }, 0);

    return () => {
      window.clearTimeout(t);
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, [open, initialFocusRef]);

  // Zamknięcie modala klawiszem Escape.
  useEffect(() => {
    if (!open || !closeOnEscape) return;

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.preventDefault();
      onClose();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeOnEscape, onClose]);

  if (!open) return null;

  return (
    <Portal>
      <div
        className={cn("fixed inset-0", zIndexClassName, className)}
        onMouseDown={(e) => {
          if (!closeOnBackdrop) return;
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {children}
      </div>
    </Portal>
  );
}
