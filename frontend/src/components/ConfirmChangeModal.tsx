// frontend/src/components/ConfirmChangeModal.tsx
// Komponent zapewnia wspólną strukturę modala potwierdzającego skutki zmian w danych turniejowych.

import { useEffect, useId, useMemo, useRef } from "react";
import { X } from "lucide-react";

import { cn } from "../lib/cn";

import { Button, type ButtonVariant } from "../ui/Button";
import { Card } from "../ui/Card";
import { Checkbox } from "../ui/Checkbox";
import { Modal } from "../ui/Modal";

type SessionCheckboxConfig = {
  checked: boolean;
  label: string;
  description?: string;
  onChange: (value: boolean) => void;
};

export type ConfirmChangeAction = {
  label: string;
  variant?: ButtonVariant;
  disabled?: boolean;
  onClick: () => void;
};

type Props = {
  open: boolean;
  title: string;
  description?: string;
  intro?: string;
  message?: string;

  deleteItems?: string[];
  archiveItems?: string[];
  restoreItems?: string[];
  overwriteItems?: string[];

  destructiveItemsTitle?: string;
  restoreItemsTitle?: string;
  overwriteItemsTitle?: string;

  sessionCheckbox?: SessionCheckboxConfig;
  checkbox?: SessionCheckboxConfig;

  question?: string | null;

  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: ButtonVariant;
  confirmDisabled?: boolean;
  showConfirm?: boolean;

  actions?: ConfirmChangeAction[];

  maxWidthClassName?: string;
  overlayClassName?: string;
  cardClassName?: string;
  closeLabel?: string;

  details?: string[];
  detailsLabel?: string;

  onConfirm: () => void;
  onCancel: () => void;
};

function cleanItems(items?: string[]) {
  return (items ?? []).map((item) => String(item || "").trim()).filter(Boolean);
}

function uniqueItems(items: string[]) {
  return Array.from(new Set(items));
}

function formatListItem(item: string) {
  const trimmed = item.trim();

  if (trimmed.startsWith("-") || trimmed.startsWith("•")) {
    return trimmed;
  }

  return `- ${trimmed}`;
}

function TextSection({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;

  return (
    <div className="space-y-1">
      <p>{title}</p>
      <div className="space-y-0.5 text-slate-100/95">
        {items.map((item) => (
          <p key={item}>{formatListItem(item)}</p>
        ))}
      </div>
    </div>
  );
}

export default function ConfirmChangeModal({
  open,
  title,
  description,
  intro,
  message,

  deleteItems,
  archiveItems,
  restoreItems,
  overwriteItems,

  destructiveItemsTitle,
  restoreItemsTitle = "Możliwe do przywrócenia:",
  overwriteItemsTitle = "Ta zmiana nadpisze:",

  sessionCheckbox,
  checkbox,

  question = "Czy chcesz kontynuować?",

  confirmLabel = "Potwierdź",
  cancelLabel = "Anuluj",
  confirmVariant = "danger",
  confirmDisabled = false,
  showConfirm = true,

  actions = [],

  maxWidthClassName = "max-w-[680px]",
  overlayClassName,
  cardClassName,
  closeLabel = "Zamknij",

  onConfirm,
  onCancel,
}: Props) {
  const uid = useId().replace(/:/g, "");
  const titleId = `confirm-change-${uid}-title`;
  const descId = `confirm-change-${uid}-desc`;
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  const normalizedDeleteItems = useMemo(() => cleanItems(deleteItems), [deleteItems]);
  const normalizedArchiveItems = useMemo(() => cleanItems(archiveItems), [archiveItems]);
  const normalizedRestoreItems = useMemo(() => cleanItems(restoreItems), [restoreItems]);
  const normalizedOverwriteItems = useMemo(() => cleanItems(overwriteItems), [overwriteItems]);

  const destructiveItems = useMemo(
    () => uniqueItems([...normalizedDeleteItems, ...normalizedArchiveItems]),
    [normalizedArchiveItems, normalizedDeleteItems]
  );

  const resolvedDescription = description ?? intro ?? message ?? "";
  const resolvedCheckbox = sessionCheckbox ?? checkbox;

  const resolvedDestructiveTitle =
    destructiveItemsTitle ??
    (normalizedDeleteItems.length > 0 && normalizedArchiveItems.length > 0
      ? "Ta zmiana usunie lub przeniesie do archiwum:"
      : normalizedArchiveItems.length > 0
        ? "Ta zmiana przeniesie do archiwum:"
        : "Ta zmiana usunie:");

  useEffect(() => {
    if (!open || !showConfirm || confirmDisabled) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.ctrlKey || event.metaKey || event.altKey) return;

      const tag = (document.activeElement?.tagName || "").toLowerCase();
      if (tag === "button" || tag === "input" || tag === "textarea" || tag === "select") return;

      event.preventDefault();
      onConfirm();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmDisabled, onConfirm, open, showConfirm]);

  return (
    <Modal
      open={open}
      onClose={onCancel}
      initialFocusRef={closeBtnRef}
      className={cn("flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm", overlayClassName)}
    >
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descId} className="w-full">
        <Card
          className={cn(
            "relative mx-auto max-h-[calc(100vh-2rem)] w-full overflow-y-auto p-5 shadow-2xl",
            maxWidthClassName,
            cardClassName
          )}
        >
          <Button
            ref={closeBtnRef}
            type="button"
            variant="ghost"
            className="absolute right-3 top-3 h-9 w-9 justify-center rounded-xl px-0 text-slate-400 hover:text-white"
            aria-label={closeLabel}
            title={closeLabel}
            onClick={onCancel}
          >
            <X className="h-4 w-4" />
          </Button>

          <div className="space-y-4 pr-10 text-sm leading-relaxed text-slate-300" id={descId}>
            <div className="space-y-2">
              <div id={titleId} className="text-base font-semibold text-slate-100">
                {title}
              </div>

              {resolvedDescription ? <p className="whitespace-pre-wrap">{resolvedDescription}</p> : null}
            </div>

            <TextSection title={resolvedDestructiveTitle} items={destructiveItems} />
            <TextSection title={restoreItemsTitle} items={normalizedRestoreItems} />
            <TextSection title={overwriteItemsTitle} items={normalizedOverwriteItems} />

            {resolvedCheckbox ? (
              <Checkbox
                checked={resolvedCheckbox.checked}
                onCheckedChange={resolvedCheckbox.onChange}
                label={resolvedCheckbox.label}
                description={resolvedCheckbox.description}
              />
            ) : null}

            {question ? <p>{question}</p> : null}
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onCancel}>
              {cancelLabel}
            </Button>

            {actions.map((action) => (
              <Button
                key={action.label}
                type="button"
                variant={action.variant ?? "secondary"}
                disabled={action.disabled}
                onClick={action.onClick}
              >
                {action.label}
              </Button>
            ))}

            {showConfirm ? (
              <Button type="button" variant={confirmVariant} disabled={confirmDisabled} onClick={onConfirm}>
                {confirmLabel}
              </Button>
            ) : null}
          </div>
        </Card>
      </div>
    </Modal>
  );
}