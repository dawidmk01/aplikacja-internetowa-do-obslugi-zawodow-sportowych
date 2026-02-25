// frontend/src/ui/Dialog.tsx
// Komponent ujednolica strukturę okna modalnego na bazie Modal.

import type { ReactNode } from "react";
import { useId, useRef } from "react";
import { X } from "lucide-react";

import { cn } from "../lib/cn";

import { Button } from "./Button";
import { Card } from "./Card";
import { Modal } from "./Modal";

type Props = {
  open: boolean;
  title: ReactNode;
  onClose: () => void;

  children: ReactNode;
  footer?: ReactNode;

  maxWidthClassName?: string;
  overlayClassName?: string;
  cardClassName?: string;

  closeLabel?: string;
};

export function Dialog({
  open,
  title,
  onClose,
  children,
  footer,
  maxWidthClassName = "max-w-[680px]",
  overlayClassName,
  cardClassName,
  closeLabel = "Zamknij",
}: Props) {
  const uid = useId().replace(/:/g, "");
  const titleId = `dialog-${uid}-title`;
  const descId = `dialog-${uid}-desc`;

  // Fokus startowy na przycisku zamknięcia dla spójnej nawigacji klawiaturą.
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);

  return (
    <Modal
      open={open}
      onClose={onClose}
      initialFocusRef={closeBtnRef as any}
      className={cn("flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm", overlayClassName)}
    >
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descId} className="w-full">
        <Card className={cn("w-full overflow-hidden p-0", maxWidthClassName, cardClassName)}>
          <div className="flex items-center justify-between gap-3 border-b border-white/10 bg-white/[0.04] px-4 py-3">
            <div id={titleId} className="text-base font-semibold text-white">
              {title}
            </div>

            <Button
              ref={closeBtnRef as any}
              type="button"
              variant="ghost"
              onClick={onClose}
              className="h-9 w-9 justify-center rounded-xl px-0"
              aria-label={closeLabel}
              title={closeLabel}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div id={descId} className="px-4 py-4">
            {children}
          </div>

          {footer ? (
            <div className="flex flex-wrap justify-end gap-2 border-t border-white/10 bg-white/[0.03] px-4 py-3">
              {footer}
            </div>
          ) : null}
        </Card>
      </div>
    </Modal>
  );
}
