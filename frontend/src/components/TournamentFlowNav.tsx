import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useTournamentFlowGuard } from "../flow/TournamentFlowGuardContext";
import { FLOW_STEPS, getCurrentStepIndex } from "../flow/flowSteps";
import { apiFetch } from "../api";

type Props = {
  getCreatedId?: () => string | null; // dla /tournaments/new
};

type MyRole = "ORGANIZER" | "ASSISTANT" | "PARTICIPANT" | null;

type TournamentDTO = {
  id: number;
  my_role?: MyRole;
  [key: string]: any;
};

function toIntSafe(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function extractCount(payload: any): number | null {
  // 1) { count: number }
  const c = toIntSafe(payload?.count);
  if (c !== null) return c;

  // 2) { results: [] }
  if (Array.isArray(payload?.results)) return payload.results.length;

  // 3) []
  if (Array.isArray(payload)) return payload.length;

  return null;
}

export default function TournamentFlowNav({ getCreatedId }: Props) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const { saveIfDirty, saving, lastError, clearError } = useTournamentFlowGuard();

  const currentIdx = getCurrentStepIndex(location.pathname);
  const currentLabel = FLOW_STEPS[currentIdx]?.label ?? "Konfiguracja";

  const resolveIdAfterSave = () => id ?? getCreatedId?.() ?? null;

  // =========================
  // Badge: kolejka próśb o zmianę nazwy
  // =========================
  const [myRole, setMyRole] = useState<MyRole>(null);
  const [pendingNameReqCount, setPendingNameReqCount] = useState<number>(0);

  const canSeeQueue = useMemo(
    () => myRole === "ORGANIZER" || myRole === "ASSISTANT",
    [myRole]
  );

  // 1) załaduj my_role
  useEffect(() => {
    const rid = resolveIdAfterSave();
    if (!rid) return;

    let cancelled = false;

    const loadRole = async () => {
      try {
        const tRes = await apiFetch(`/api/tournaments/${rid}/`);
        if (!tRes.ok) {
          if (!cancelled) setMyRole(null);
          return;
        }
        const t: TournamentDTO = await tRes.json().catch(() => ({} as any));
        if (!cancelled) setMyRole((t?.my_role as MyRole) ?? null);
      } catch {
        if (!cancelled) setMyRole(null);
      }
    };

    loadRole();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // 2) załaduj liczbę pending (i odświeżaj na focus)
  useEffect(() => {
    const rid = resolveIdAfterSave();
    if (!rid) return;

    if (!canSeeQueue) {
      setPendingNameReqCount(0);
      return;
    }

    let cancelled = false;

    const loadPendingCount = async () => {
      try {
        const res = await apiFetch(`/api/tournaments/${rid}/teams/name-change-requests/`);

        // 403/404 traktujemy jak "brak funkcji / brak dostępu"
        if (!res.ok) {
          if (!cancelled) setPendingNameReqCount(0);
          return;
        }

        const data = await res.json().catch(() => null);
        const cnt = extractCount(data);
        if (!cancelled) setPendingNameReqCount(cnt ?? 0);
      } catch {
        if (!cancelled) setPendingNameReqCount(0);
      }
    };

    const onFocus = () => loadPendingCount();

    loadPendingCount();
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSeeQueue, id]);

  const handleClick = (stepIndex: number) => async () => {
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

          const isTeamsStep = step.key === "teams";
          const showPending = isTeamsStep && canSeeQueue && pendingNameReqCount > 0;

          const style: React.CSSProperties = {
            padding: "0.35rem 0.6rem",
            borderRadius: 6,
            border: showPending ? "1px solid #b36b00" : "1px solid #333",
            background: isActive
              ? "#2a2a2a"
              : showPending
                ? "rgba(255, 165, 0, 0.08)"
                : "transparent",
            fontWeight: isActive ? 700 : 400,
            color: "inherit",
            opacity: saving ? 0.7 : 1,
            cursor: "pointer",
            transition: "opacity 0.2s, background 0.2s, border-color 0.2s",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          };

          const badgeStyle: React.CSSProperties = {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: 18,
            height: 18,
            padding: "0 6px",
            borderRadius: 999,
            border: "1px solid #b36b00",
            fontSize: 12,
            lineHeight: "18px",
            fontWeight: 700,
            background: "rgba(255, 165, 0, 0.12)",
          };

          return (
            <li key={step.key}>
              <button type="button" onClick={handleClick(index)} style={style}>
                {index + 1}. {step.label}
                {showPending && <span style={badgeStyle}>{pendingNameReqCount}</span>}
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
