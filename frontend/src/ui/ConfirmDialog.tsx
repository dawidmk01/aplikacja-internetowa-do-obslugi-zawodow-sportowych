// frontend/src/ui/ConfirmDialog.tsx
// Komponent zapewnia wspólny modal potwierdzeń dla operacji krytycznych.

import { useEffect } from "react";

import { Button } from "./Button";
import { Dialog } from "./Dialog";

type Props = {
  open: boolean;
  title: string;
  message: string;

  confirmLabel?: string;
  cancelLabel?: string;

  confirmVariant?: "primary" | "secondary" | "danger" | "ghost";

  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Kontynuuj",
  cancelLabel = "Anuluj",
  confirmVariant = "danger",
  onConfirm,
  onCancel,
}: Props) {
  // Enter potwierdza, jeśli fokus nie jest na kontrolce formularza.
  useEffect(() => {
    if (!open) return;

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Enter" && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        const tag = (document.activeElement?.tagName || "").toLowerCase();
        if (tag === "button" || tag === "input" || tag === "textarea" || tag === "select") return;
        ev.preventDefault();
        onConfirm();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onConfirm]);

  return (
    <Dialog
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onCancel} className="h-9 rounded-xl px-4">
            {cancelLabel}
          </Button>

          <Button type="button" variant={confirmVariant} onClick={onConfirm} className="h-9 rounded-xl px-4">
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="whitespace-pre-line text-sm leading-relaxed text-slate-200/90">{message}</div>
    </Dialog>
  );
}
