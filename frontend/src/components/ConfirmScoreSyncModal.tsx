// frontend/src/components/ConfirmScoreSyncModal.tsx

import { useEffect, useMemo, useState } from "react";

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

export default function ConfirmScoreSyncModal(props: Props) {
  const {
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
  } = props;

  const [showDetails, setShowDetails] = useState(false);

  // Minimalna ochrona przed „pustymi” danymi
  const safeDeleteCount = Number.isFinite(deleteCount) ? Math.max(0, deleteCount) : 0;

  const idsPreview = useMemo(() => {
    if (!Array.isArray(deleteIds) || deleteIds.length === 0) return "";
    const list = deleteIds.slice(0, 12).join(", ");
    if (deleteIds.length <= 12) return list;
    return `${list}… (+${deleteIds.length - 12})`;
  }, [deleteIds]);

  useEffect(() => {
    if (!open) return;

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        onCancel();
      }
      // Enter = potwierdź (o ile nie ma wciśniętego meta/ctrl/alt, żeby nie przeszkadzać w skrótach)
      if (ev.key === "Enter" && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        // Nie blokuj Entera w sytuacji, gdy fokus jest na checkboxie lub przycisku.
        const tag = (document.activeElement?.tagName || "").toLowerCase();
        if (tag === "button" || tag === "input") return;
        ev.preventDefault();
        onConfirm();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel, onConfirm]);

  useEffect(() => {
    if (open) setShowDetails(false);
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10050,
        background: "rgba(0,0,0,0.62)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.25rem",
      }}
      onMouseDown={(e) => {
        // klik w tło zamyka (UX: jak modal w większości UI)
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        style={{
          width: "min(680px, 96vw)",
          borderRadius: 14,
          background: "#1f1f1f",
          border: "1px solid rgba(255,255,255,0.10)",
          boxShadow: "0 16px 40px rgba(0,0,0,0.55)",
          color: "#fff",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "1rem 1.15rem",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.75rem",
          }}
        >
          <div style={{ fontWeight: 800, fontSize: "1.05rem", letterSpacing: 0.2 }}>{title}</div>
          <button
            onClick={onCancel}
            style={{
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.05)",
              color: "#fff",
              borderRadius: 8,
              padding: "0.35rem 0.55rem",
              cursor: "pointer",
              opacity: 0.9,
            }}
            aria-label="Zamknij"
            title="Zamknij"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "1.05rem 1.15rem" }}>
          <div style={{ fontSize: "0.95rem", lineHeight: 1.45, opacity: 0.92 }}>{message}</div>

          {code ? (
            <div style={{ marginTop: "0.5rem", fontSize: "0.85rem", opacity: 0.65 }}>
              Kod: <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>{code}</span>
            </div>
          ) : null}

          <div
            style={{
              marginTop: "0.9rem",
              padding: "0.85rem",
              borderRadius: 12,
              border: "1px solid rgba(231, 76, 60, 0.55)",
              background: "rgba(231, 76, 60, 0.10)",
            }}
          >
            <div style={{ fontSize: "0.92rem", lineHeight: 1.45 }}>
              Kontynuacja spowoduje usunięcie <strong>{safeDeleteCount}</strong> istniejących incydentów{" "}
              <strong>GOAL</strong> w tym meczu, aby dopasować LIVE do „szybkiego wyniku”.
            </div>

            {Array.isArray(deleteIds) && deleteIds.length > 0 ? (
              <div style={{ marginTop: "0.6rem", fontSize: "0.86rem", opacity: 0.9 }}>
                <button
                  type="button"
                  onClick={() => setShowDetails((v) => !v)}
                  style={{
                    border: "1px solid rgba(255,255,255,0.14)",
                    background: "rgba(255,255,255,0.06)",
                    color: "#fff",
                    borderRadius: 10,
                    padding: "0.35rem 0.6rem",
                    cursor: "pointer",
                    marginRight: "0.75rem",
                    fontSize: "0.85rem",
                  }}
                >
                  {showDetails ? "Ukryj szczegóły" : "Pokaż szczegóły"}
                </button>

                {showDetails ? (
                  <div
                    style={{
                      marginTop: "0.6rem",
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                      fontSize: "0.82rem",
                      opacity: 0.95,
                      wordBreak: "break-word",
                    }}
                  >
                    ID: {idsPreview}
                  </div>
                ) : null}
              </div>
            ) : null}

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.55rem",
                marginTop: "0.75rem",
                fontSize: "0.9rem",
                opacity: 0.92,
                userSelect: "none",
              }}
            >
              <input
                type="checkbox"
                checked={!!autoForceInSession}
                onChange={(e) => onToggleAutoForceInSession(e.target.checked)}
              />
              Zawsze kontynuuj w tej sesji (wymuszaj automatycznie)
            </label>
          </div>

          <div style={{ marginTop: "0.75rem", fontSize: "0.85rem", opacity: 0.7 }}>
            Uwaga: usunięte incydenty GOAL mogą zawierać uzupełnionego zawodnika i czas, dlatego wymagamy jawnego potwierdzenia.
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "0.95rem 1.15rem",
            borderTop: "1px solid rgba(255,255,255,0.08)",
            display: "flex",
            justifyContent: "flex-end",
            gap: "0.75rem",
          }}
        >
          <button
            onClick={onCancel}
            style={{
              padding: "0.55rem 0.95rem",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.05)",
              color: "#fff",
              cursor: "pointer",
              opacity: 0.95,
            }}
          >
            {cancelLabel}
          </button>

          <button
            onClick={onConfirm}
            style={{
              padding: "0.55rem 0.95rem",
              borderRadius: 10,
              border: "1px solid rgba(231, 76, 60, 0.70)",
              background: "rgba(231, 76, 60, 0.24)",
              color: "#fff",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
