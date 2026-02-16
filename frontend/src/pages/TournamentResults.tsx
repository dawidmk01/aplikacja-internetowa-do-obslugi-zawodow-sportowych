import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

function ToastPortal({ children }: { children: React.ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

export default function TournamentResults() {
  const { id } = useParams<{ id: string }>();

  const [tournament, setTournament] = useState<TournamentDTO | null>(null);
  const [matches, setMatches] = useState<MatchDTO[]>([]);
  const [loading, setLoading] = useState(true);

  const [busyGenerate, setBusyGenerate] = useState(false);

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastSeq = useRef(1);
  const toastTimersRef = useRef<Record<number, number>>({});

  useEffect(() => {
    return () => {
      for (const t of Object.values(toastTimersRef.current)) window.clearTimeout(t);
      toastTimersRef.current = {};
    };
  }, []);

  const dismissToast = useCallback((tid: number) => {
    const h = toastTimersRef.current[tid];
    if (h) window.clearTimeout(h);
    delete toastTimersRef.current[tid];
    setToasts((prev) => prev.filter((t) => t.id !== tid));
  }, []);

  const pushToast = useCallback(
    (text: string, kind: ToastKind = "info") => {
      const durationMs = kind === "saved" ? TOAST_DURATION_SAVED_MS : TOAST_DURATION_STANDARD_MS;
      const tid = toastSeq.current++;
      const item: ToastItem = { id: tid, text, kind, durationMs };
      setToasts((prev) => [...prev, item]);

      const h = window.setTimeout(() => dismissToast(tid), durationMs);
      toastTimersRef.current[tid] = h;
    },
    [dismissToast]
  );

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
    const list = Array.isArray(data) ? data : [];
    setMatches(list);
    return list;
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

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-slate-200">Ładowanie…</div>
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-slate-200">
          Brak danych turnieju.
        </div>
      </div>
    );
  }

  if (!matches.length) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-slate-200">
          <h1 className="text-2xl font-semibold text-slate-100">Wprowadzanie wyników</h1>
          <p className="mt-2 text-sm text-slate-300">Brak meczów.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      {/* TOASTS (portal do body -> zawsze widoczne, niezależnie od transform/overflow) */}
      {toasts.length > 0 && (
        <ToastPortal>
          <div className="fixed inset-x-4 bottom-4 z-[99999] flex flex-col gap-2 sm:inset-auto sm:bottom-6 sm:right-6 sm:w-[420px]">
            {toasts.map((t) => {
              const ring =
                t.kind === "error"
                  ? "ring-1 ring-rose-400/30"
                  : t.kind === "success"
                  ? "ring-1 ring-emerald-400/30"
                  : t.kind === "saved"
                  ? "ring-1 ring-sky-400/30"
                  : "ring-1 ring-white/10";

              const bg =
                t.kind === "error"
                  ? "bg-rose-500/10"
                  : t.kind === "success"
                  ? "bg-emerald-500/10"
                  : t.kind === "saved"
                  ? "bg-sky-500/10"
                  : "bg-white/5";

              return (
                <div
                  key={t.id}
                  className={`rounded-xl border border-white/10 ${bg} p-4 text-sm text-slate-100 shadow-xl backdrop-blur ${ring}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="leading-snug">{t.text}</div>
                    <button
                      onClick={() => dismissToast(t.id)}
                      aria-label="Zamknij"
                      className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-100 hover:bg-white/10"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </ToastPortal>
      )}

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-100">Wprowadzanie wyników</h1>
        <p className="mt-1 text-sm text-slate-300">
          Wyniki zapisują się dopiero po kliknięciu <span className="font-semibold">„Zapisz wynik / Zapisz zmiany”</span>{" "}
          lub <span className="font-semibold">„Zakończ mecz”</span>. Zmiany w checkboxach (dogrywka/karne) również wymagają zapisu.
        </p>
        <div className="mt-2 text-sm text-slate-300">
          <span className="text-slate-400">Turniej:</span> <span className="font-semibold text-slate-100">{tournament.name}</span>
        </div>
      </div>

      {/* Stage list */}
      <div className="space-y-6">
        {stages.map((s: any) => {
          const headerTitle = stageHeaderTitle(s.stageType, s.stageOrder, s.allMatches);
          const isLastStage = s.stageId === lastStageId;

          const canAdvanceFromGroups =
            tournament?.tournament_format === "MIXED" &&
            isLastStage &&
            s.stageType === "GROUP" &&
            allMatchesInLastStageFinished;

          const showGenerateNext =
            typeof s.stageId === "number" &&
            s.stageType !== "LEAGUE" &&
            s.stageType !== "GROUP" &&
            headerTitle !== "Finał" &&
            headerTitle !== "Mecz o 3. miejsce";

          return (
            <section key={s.stageId} className="rounded-2xl border border-white/10 bg-white/5 p-5 sm:p-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-100">{headerTitle}</h2>
                  <div className="mt-1 text-xs text-slate-400">
                    {s.stageType === "GROUP" ? "Faza grupowa" : s.stageType === "LEAGUE" ? "Liga" : "Puchar"}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {showGenerateNext ? (
                    <button
                      disabled={busyGenerate}
                      onClick={() => generateNextStage(s.stageId)}
                      className="h-9 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-slate-100 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {busyGenerate ? "Generowanie…" : "Generuj następny etap"}
                    </button>
                  ) : null}

                  {canAdvanceFromGroups ? (
                    <button
                      disabled={busyGenerate}
                      onClick={advanceFromGroups}
                      className="h-9 rounded-lg bg-slate-100 px-3 text-sm font-semibold text-slate-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {busyGenerate ? "Generowanie…" : "Generuj fazę pucharową"}
                    </button>
                  ) : null}
                </div>
              </div>

              {s.stageType === "GROUP" ? (
                <div className="space-y-6">
                  {groupMatchesByGroup(s.matches).map(([groupName, gm], idx) => (
                    <div key={groupName} className="rounded-xl border border-white/10 bg-black/10 p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-slate-200">{displayGroupName(groupName, idx)}</h3>
                      </div>

                      <div className="space-y-5">
                        {groupMatchesByRound(gm).map(([round, roundMatches]) => (
                          <div key={round}>
                            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                              Kolejka {round}
                            </div>
                            <div className="space-y-3">
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
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : s.stageType === "LEAGUE" ? (
                <div className="space-y-5">
                  {groupMatchesByRound(s.matches).map(([round, roundMatches]) => (
                    <div key={round} className="rounded-xl border border-white/10 bg-black/10 p-4">
                      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Kolejka {round}
                      </div>
                      <div className="space-y-3">
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
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-white/10 bg-black/10 p-4">
                  <div className="space-y-3">
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
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
