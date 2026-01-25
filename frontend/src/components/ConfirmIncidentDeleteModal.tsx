import { useEffect, useMemo } from "react";

type IncidentMeta = {
  matchId: number;
  incidentId: number;
  incidentType?: string;
  teamLabel?: string;
  minute?: number | null;
  playerLabel?: string | null;
};

type Props = {
  open: boolean;
  incident: IncidentMeta | null;

  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;

  onConfirm: () => void;
  onCancel: () => void;
};

function affectsScoreByType(t?: string): boolean {
  const s = (t ?? "").toLowerCase();
  // GOAL / POINT / TENNIS_POINT zwykle wpływają na wynik (w zależności od dyscypliny).
  return s.includes("goal") || s.includes("point");
}

export default function ConfirmIncidentDeleteModal(props: Props) {
  const {
    open,
    incident,
    title = "Potwierdź usunięcie incydentu",
    confirmLabel = "Usuń incydent",
    cancelLabel = "Anuluj",
    onConfirm,
    onCancel,
  } = props;

  const meta = incident;

  const details = useMemo(() => {
    if (!meta) return [];
    const rows: Array<[string, string]> = [];

    rows.push(["ID incydentu", String(meta.incidentId)]);
    if (meta.incidentType) rows.push(["Typ", meta.incidentType]);
    if (meta.teamLabel) rows.push(["Drużyna", meta.teamLabel]);
    if (meta.playerLabel) rows.push(["Zawodnik", meta.playerLabel]);
    if (meta.minute != null && Number.isFinite(Number(meta.minute))) rows.push(["Minuta", String(meta.minute)]);

    return rows;
  }, [meta]);

  const affectsScore = affectsScoreByType(meta?.incidentType);

  useEffect(() => {
    if (!open) return;

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        onCancel();
      }
      if (ev.key === "Enter" && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        const tag = (document.activeElement?.tagName || "").toLowerCase();
        if (tag === "button" || tag === "input" || tag === "textarea" || tag === "select") return;
        ev.preventDefault();
        onConfirm();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel, onConfirm]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10060,
        background: "rgba(0,0,0,0.62)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.25rem",
      }}
      onMouseDown={(e) => {
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
          <div style={{ fontSize: "0.95rem", lineHeight: 1.45, opacity: 0.92 }}>
            Ta operacja jest <strong>nieodwracalna</strong>. Po usunięciu system odświeży listę zdarzeń i przeliczy
            wynik oraz statystyki (jeżeli dany typ incydentu ma na nie wpływ).
            {affectsScore ? (
              <>
                {" "}
                Ten incydent prawdopodobnie <strong>wpływa na wynik</strong> – po usunięciu wynik może się zmniejszyć.
              </>
            ) : null}{" "}
            Czy na pewno chcesz usunąć ten incydent?
          </div>

          {details.length > 0 ? (
            <div
              style={{
                marginTop: "0.9rem",
                padding: "0.85rem",
                borderRadius: 12,
                border: "1px solid rgba(231, 76, 60, 0.55)",
                background: "rgba(231, 76, 60, 0.10)",
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: "0.55rem", opacity: 0.95 }}>Szczegóły incydentu</div>

              <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: "0.35rem 0.75rem" }}>
                {details.map(([k, v]) => (
                  <div key={k} style={{ display: "contents" }}>
                    <div style={{ opacity: 0.75 }}>{k}</div>
                    <div style={{ opacity: 0.95, wordBreak: "break-word" }}>{v}</div>
                  </div>
                ))}
              </div>

            </div>
          ) : null}

          <div style={{ marginTop: "0.75rem", fontSize: "0.85rem", opacity: 0.7 }}>
            Uwaga: jeśli incydent miał uzupełnione dane (zawodnik, czas), po usunięciu nie odzyskasz ich automatycznie.
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
