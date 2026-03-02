// frontend/src/components/ConfirmScoreSyncModal.tsx
// Komponent obsługuje potwierdzenie wymuszonej synchronizacji wyniku z danymi LIVE.

import { useMemo, useState } from "react";

import { ChevronDown, ChevronUp } from "lucide-react";

import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { Dialog } from "../ui/Dialog";

type Props = {
  open: boolean;
  title: string;
  message: string;
  code?: string;

  deleteCount: number;
  deleteIds: number[];

  autoForceInSession: boolean;
  onToggleAutoForceInSession: (v: boolean) => void;

  confirmLabel?: string;
  cancelLabel?: string;

  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmScoreSyncModal({
  open,
  title,
  message,
  code,
  deleteCount,
  deleteIds,
  autoForceInSession,
  onToggleAutoForceInSession,
  confirmLabel = "Kontynuuj",
  cancelLabel = "Anuluj",
  onConfirm,
  onCancel,
}: Props) {
  const [showDetails, setShowDetails] = useState(false);

  const safeDeleteCount = Number.isFinite(deleteCount) ? Math.max(0, deleteCount) : 0;

  const idsPreview = useMemo(() => {
    if (!Array.isArray(deleteIds) || deleteIds.length === 0) return "";

    const list = deleteIds.slice(0, 12).join(", ");
    if (deleteIds.length <= 12) return list;

    return `${list}... (+${deleteIds.length - 12})`;
  }, [deleteIds]);

  const handleCancel = () => {
    setShowDetails(false);
    onCancel();
  };

  const handleConfirm = () => {
    setShowDetails(false);
    onConfirm();
  };

  const handleEnterConfirm = (ev: React.KeyboardEvent<HTMLDivElement>) => {
    if (ev.key !== "Enter" || ev.ctrlKey || ev.metaKey || ev.altKey) return;

    const target = ev.target as HTMLElement | null;
    const tag = (target?.tagName || "").toLowerCase();

    // Enter poza polami formularza ma zatwierdzać modal.
    if (tag === "button" || tag === "input" || tag === "textarea" || tag === "select") {
      return;
    }

    ev.preventDefault();
    handleConfirm();
  };

  return (
    <Dialog
      open={open}
      title={title}
      onClose={handleCancel}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={handleCancel} className="h-9 rounded-xl px-4">
            {cancelLabel}
          </Button>

          <Button type="button" variant="danger" onClick={handleConfirm} className="h-9 rounded-xl px-4">
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div onKeyDown={handleEnterConfirm}>
        <div className="text-sm leading-relaxed text-slate-200/90">{message}</div>

        {code ? (
          <div className="mt-2 text-xs text-slate-400">
            Kod: <span className="font-mono text-slate-200">{code}</span>
          </div>
        ) : null}

        <div className="mt-4 rounded-2xl border border-rose-500/35 bg-rose-500/10 p-4">
          <div className="text-sm leading-relaxed text-slate-100/95">
            Kontynuacja spowoduje usunięcie <span className="font-semibold">{safeDeleteCount}</span> istniejących
            incydentów <span className="font-semibold">GOAL</span> w tym meczu, aby dopasować LIVE do "szybkiego
            wyniku".
          </div>

          {Array.isArray(deleteIds) && deleteIds.length > 0 ? (
            <div className="mt-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowDetails((v) => !v)}
                className="h-8 rounded-lg px-3 text-xs"
              >
                {showDetails ? (
                  <>
                    <ChevronUp className="h-4 w-4" />
                    Ukryj szczegóły
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-4 w-4" />
                    Pokaż szczegóły
                  </>
                )}
              </Button>

              {showDetails ? (
                <div className="mt-2 rounded-xl border border-white/10 bg-white/[0.04] p-3 text-xs text-slate-200">
                  <div className="font-mono break-words">ID: {idsPreview}</div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mt-4">
            <Checkbox
              checked={!!autoForceInSession}
              onCheckedChange={onToggleAutoForceInSession}
              label="Zawsze kontynuuj w tej sesji (wymuszaj automatycznie)"
            />
          </div>
        </div>

        <div className="mt-3 text-xs leading-relaxed text-slate-400">
          Uwaga: usunięte incydenty GOAL mogą zawierać uzupełnionego zawodnika i czas, dlatego wymagamy jawnego
          potwierdzenia.
        </div>
      </div>
    </Dialog>
  );
}