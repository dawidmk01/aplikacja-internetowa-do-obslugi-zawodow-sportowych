import React from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useTournamentFlowGuard } from "../flow/TournamentFlowGuardContext";
import { FLOW_STEPS, getCurrentStepIndex } from "../flow/flowSteps";

type Props = {
  getCreatedId?: () => string | null; // dla /tournaments/new
};

export default function TournamentFlowNav({ getCreatedId }: Props) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const { saveIfDirty, saving, lastError, clearError } =
    useTournamentFlowGuard();

  const currentIdx = getCurrentStepIndex(location.pathname);
  const currentLabel = FLOW_STEPS[currentIdx]?.label ?? "Konfiguracja";

  const resolveIdAfterSave = () => id ?? getCreatedId?.() ?? null;

  const handleClick = (stepIndex: number) => async () => {
    // Logiczne zabezpieczenie przed wielokrotnym klikiem, ale bez blokady wizualnej
    if (saving) return;

    clearError();

    const ok = await saveIfDirty();
    if (!ok) return;

    const rid = resolveIdAfterSave();
    if (!rid) return;

    const target = FLOW_STEPS[stepIndex];
    navigate(target.path(rid), {
      state: {
        fromPath: location.pathname,
        fromLabel: currentLabel,
      },
    });
  };

  return (
    <nav style={{ margin: "1.5rem 0" }}>
      <ol
        style={{
          display: "flex",
          gap: "1rem",
          listStyle: "none",
          padding: 0,
          flexWrap: "wrap",
        }}
      >
        {FLOW_STEPS.map((step, index) => {
          const isActive = index === currentIdx;

          // ✅ CZYSTY STYL BEZ BLOKAD
          const style: React.CSSProperties = {
            padding: "0.35rem 0.6rem",
            borderRadius: 6,
            border: "1px solid #333",
            background: isActive ? "#2a2a2a" : "transparent",
            fontWeight: isActive ? 700 : 400,
            color: "inherit",
            // Lekkie przygaszenie przy zapisie, ale kursor pozostaje aktywny
            opacity: saving ? 0.7 : 1,
            cursor: "pointer",
            transition: "opacity 0.2s, background 0.2s",
          };

          return (
            <li key={step.key}>
              <button
                type="button"
                onClick={handleClick(index)}
                style={style}
              >
                {index + 1}. {step.label}
              </button>
            </li>
          );
        })}
      </ol>

      {lastError && (
        <div style={{ marginTop: 8, color: "crimson", fontSize: "0.9em" }}>
          Błąd zapisu: {lastError}
        </div>
      )}
    </nav>
  );
}