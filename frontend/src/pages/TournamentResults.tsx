// frontend/src/pages/TournamentResults.tsx

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { apiFetch } from "../api";
import MatchRow from "../components/MatchRow";
import {
  buildStagesForView,
  displayGroupName,
  groupMatchesByGroup,
  groupMatchesByRound,
  stageHeaderTitle,
} from "../flow/stagePresentation";
import type { MatchDTO, TournamentDTO } from "../types/results";

type ToastKind = "saved" | "success" | "error" | "info";
type ToastItem = { id: number; text: string; kind: ToastKind; durationMs: number };

const TOAST_DURATION_STANDARD_MS = 4800;
const TOAST_DURATION_SAVED_MS = 2000;

async function parseApiError(res: Response): Promise<string> {
  try {
    const data = await res.json().catch(() => null);
    return String(data?.detail || data?.message || data?.error || res.statusText || "Błąd.");
  } catch {
    return res.statusText || "Błąd.";
  }
}

export default function TournamentResults() {
  const { id } = useParams<{ id: string }>();

  const [tournament, setTournament] = useState<TournamentDTO | null>(null);
  const [matches, setMatches] = useState<MatchDTO[]>([]);
  const [loading, setLoading] = useState(true);

  // Stage actions (np. generowanie kolejnego etapu)
  const [busyGenerate, setBusyGenerate] = useState(false);

  // Toasty globalne (page-level)
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastSeq = useRef(1);

  const pushToast = useCallback((text: string, kind: ToastKind = "info") => {
    const durationMs = kind === "saved" ? TOAST_DURATION_SAVED_MS : TOAST_DURATION_STANDARD_MS;
    const tid = toastSeq.current++;
    const item: ToastItem = { id: tid, text, kind, durationMs };
    setToasts((prev) => [...prev, item]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== tid));
    }, durationMs);
  }, []);

  const loadTournament = useCallback(async (): Promise<TournamentDTO> => {
    if (!id) throw new Error("Brak ID turnieju.");
    const res = await apiFetch(`/api/tournaments/${id}/`);
    if (!res.ok) throw new Error(await parseApiError(res));
    const data = (await res.json()) as TournamentDTO;
    setTournament(data);
    return data;
  }, [id]);

  const loadMatches = useCallback(async (): Promise<MatchDTO[]> => {
    if (!id) throw new Error("Brak ID turnieju.");
    const res = await apiFetch(`/api/tournaments/${id}/matches/`);
    if (!res.ok) throw new Error(await parseApiError(res));
    const data = (await res.json()) as MatchDTO[];
    setMatches(Array.isArray(data) ? data : []);
    return Array.isArray(data) ? data : [];
  }, [id]);

  const reloadAll = useCallback(async () => {
    if (!id) return;
    const t = await loadTournament().catch(() => null);
    await loadMatches().catch(() => null);
    if (t) setTournament(t);
  }, [id, loadTournament, loadMatches]);

  useEffect(() => {
    if (!id) return;
    let mounted = true;

    const init = async () => {
      try {
        setLoading(true);
        await reloadAll();
      } catch (e: any) {
        if (mounted) pushToast(e?.message ?? "Błąd.", "error");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    init();
    return () => {
      mounted = false;
    };
  }, [id, reloadAll, pushToast]);

  const stages = useMemo(() => buildStagesForView(matches, { showBye: false }), [matches]);

  const lastStageId = useMemo(() => {
    if (!stages.length) return null;
    return stages[stages.length - 1].stageId;
  }, [stages]);

  const allMatchesInLastStageFinished = useMemo(() => {
    if (!lastStageId) return false;
    const last = stages.find((s: any) => s.stageId === lastStageId);
    if (!last || !last.matches?.length) return false;
    return last.matches.every((m: MatchDTO) => m.status === "FINISHED");
  }, [stages, lastStageId]);

  const generateNextStage = useCallback(
    async (stageId: number) => {
      if (!id) return;
      setBusyGenerate(true);
      try {
        const res = await apiFetch(`/api/stages/${stageId}/confirm/`, { method: "POST" });
        if (!res.ok) throw new Error(await parseApiError(res));
        await reloadAll();
        pushToast("Następny etap wygenerowany.", "success");
      } catch (e: any) {
        pushToast(e?.message ?? "Błąd.", "error");
      } finally {
        setBusyGenerate(false);
      }
    },
    [id, pushToast, reloadAll]
  );

  const advanceFromGroups = useCallback(async () => {
    if (!id) return;
    setBusyGenerate(true);
    try {
      const res = await apiFetch(`/api/tournaments/${id}/advance-from-groups/`, { method: "POST" });
      if (!res.ok) throw new Error(await parseApiError(res));
      await reloadAll();
      pushToast("Faza pucharowa wygenerowana.", "success");
    } catch (e: any) {
      pushToast(e?.message ?? "Błąd.", "error");
    } finally {
      setBusyGenerate(false);
    }
  }, [id, pushToast, reloadAll]);

  if (loading) return <p style={{ padding: "2rem" }}>Ładowanie…</p>;
  if (!tournament) return <p style={{ padding: "2rem" }}>Brak danych turnieju.</p>;

  if (!matches.length) {
    return (
      <div style={{ padding: "2rem" }}>
        <h1>Wprowadzanie wyników</h1>
        <p>Brak meczów.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: "2rem", maxWidth: 980 }}>
      <h1>Wprowadzanie wyników</h1>

      <section
        style={{
          opacity: 0.85,
          marginBottom: "2rem",
          fontSize: "0.9em",
          borderLeft: "4px solid #555",
          paddingLeft: "1rem",
        }}
      >
        {tournament.name && (
          <div style={{ marginBottom: "0.25rem" }}>
            <strong>Turniej:</strong> {tournament.name}
          </div>
        )}

        <div>
          Wyniki zapisują się dopiero po kliknięciu <strong>„Zapisz wynik / Zapisz zmiany”</strong> (lub{" "}
          <strong>„Zakończ mecz”</strong>). Zmiany w checkboxach (dogrywka/karne) również wymagają zapisu.
        </div>
      </section>

      {stages.map((s: any) => {
        const headerTitle = stageHeaderTitle(s.stageType, s.stageOrder, s.allMatches);

        const isLastStage = s.stageId === lastStageId;
        const canAdvanceFromGroups =
          tournament?.tournament_format === "MIXED" && isLastStage && s.stageType === "GROUP" && allMatchesInLastStageFinished;

        return (
          <section key={s.stageId} style={{ marginTop: "3rem", paddingTop: "1rem", borderTop: "1px solid #333" }}>
            <h2 style={{ marginBottom: "1.5rem", color: "#eee" }}>{headerTitle}</h2>

            {s.stageType === "GROUP" ? (
              groupMatchesByGroup(s.matches).map(([groupName, gm], idx) => (
                <div key={groupName} style={{ marginBottom: "2rem", paddingLeft: "1rem", borderLeft: "2px solid #333" }}>
                  <h3 style={{ color: "#aaa", marginBottom: "1rem" }}>{displayGroupName(groupName, idx)}</h3>

                  {groupMatchesByRound(gm).map(([round, roundMatches]) => (
                    <div key={round} style={{ marginBottom: "1.5rem" }}>
                      <h4
                        style={{
                          margin: "0.5rem 0",
                          fontSize: "0.85rem",
                          textTransform: "uppercase",
                          opacity: 0.6,
                          letterSpacing: "1px",
                        }}
                      >
                        Kolejka {round}
                      </h4>
                      {roundMatches.map((m: MatchDTO) => (
                        <MatchRow
                          key={m.id}
                          tournamentId={String(tournament.id)}
                          tournament={tournament}
                          match={m}
                          onReload={reloadAll}
                          onToast={pushToast}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              ))
            ) : s.stageType === "LEAGUE" ? (
              groupMatchesByRound(s.matches).map(([round, roundMatches]) => (
                <div key={round} style={{ marginBottom: "2rem" }}>
                  <h4
                    style={{
                      margin: "0.5rem 0",
                      fontSize: "0.85rem",
                      textTransform: "uppercase",
                      opacity: 0.6,
                      letterSpacing: "1px",
                    }}
                  >
                    Kolejka {round}
                  </h4>

                  {roundMatches.map((m: MatchDTO) => (
                    <MatchRow
                      key={m.id}
                      tournamentId={String(tournament.id)}
                      tournament={tournament}
                      match={m}
                      onReload={reloadAll}
                      onToast={pushToast}
                    />
                  ))}
                </div>
              ))
            ) : (
              <div style={{ marginBottom: "2rem" }}>
                {s.matches.map((m: MatchDTO) => (
                  <MatchRow
                    key={m.id}
                    tournamentId={String(tournament.id)}
                    tournament={tournament}
                    match={m}
                    onReload={reloadAll}
                    onToast={pushToast}
                  />
                ))}
              </div>
            )}

            {/* Stage-level actions */}
            {typeof s.stageId === "number" && s.stageType !== "LEAGUE" && s.stageType !== "GROUP" && headerTitle !== "Finał" && headerTitle !== "Mecz o 3. miejsce" ? (
              <div style={{ marginTop: "1.25rem" }}>
                <button
                  disabled={busyGenerate}
                  onClick={() => generateNextStage(s.stageId)}
                  style={{
                    padding: "0.55rem 0.95rem",
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.14)",
                    background: "rgba(255,255,255,0.06)",
                    color: "#fff",
                    cursor: busyGenerate ? "not-allowed" : "pointer",
                    opacity: busyGenerate ? 0.6 : 0.95,
                  }}
                >
                  Generuj następny etap
                </button>
              </div>
            ) : null}

            {canAdvanceFromGroups ? (
              <div style={{ marginTop: "1.25rem" }}>
                <button
                  disabled={busyGenerate}
                  onClick={advanceFromGroups}
                  style={{
                    padding: "0.55rem 0.95rem",
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.14)",
                    background: "rgba(255,255,255,0.06)",
                    color: "#fff",
                    cursor: busyGenerate ? "not-allowed" : "pointer",
                    opacity: busyGenerate ? 0.6 : 0.95,
                  }}
                >
                  Generuj fazę pucharową
                </button>
              </div>
            ) : null}
          </section>
        );
      })}

      {/* Toasts */}
      {toasts.length > 0 && (
        <div style={{ position: "fixed", right: 16, bottom: 16, display: "flex", flexDirection: "column", gap: 10, zIndex: 12000 }}>
          {toasts.map((t) => (
            <div
              key={t.id}
              style={{
                padding: "0.75rem 0.95rem",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.12)",
                background:
                  t.kind === "error"
                    ? "rgba(231, 76, 60, 0.18)"
                    : t.kind === "success"
                    ? "rgba(46, 204, 113, 0.16)"
                    : t.kind === "saved"
                    ? "rgba(52, 152, 219, 0.16)"
                    : "rgba(255,255,255,0.10)",
                color: "#fff",
                maxWidth: 420,
                boxShadow: "0 10px 24px rgba(0,0,0,0.45)",
              }}
            >
              {t.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
