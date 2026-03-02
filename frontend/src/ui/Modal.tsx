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

  initialFocusRef?: RefObject<HTMLElement | null>;
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

    const timer = window.setTimeout(() => {
      initialFocusRef?.current?.focus?.();
    }, 0);

    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, [open, initialFocusRef]);

  // Escape zamyka modal, jeśli zachowanie jest włączone.
  useEffect(() => {
    if (!open || !closeOnEscape) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, closeOnEscape, onClose]);

  if (!open) return null;

  return (
    <Portal>
      <div
        className={cn("fixed inset-0", zIndexClassName, className)}
        onMouseDown={(event) => {
          if (!closeOnBackdrop) return;
          if (event.target === event.currentTarget) onClose();
        }}
      >
        {children}
      </div>
    </Portal>
  );
}