import { useEffect, useMemo, useState } from "react";

import { apiFetch } from "../../api";
import { cn } from "../../lib/cn";

import {
  BreakMode,
  type BreakMode as BreakModeT,
  clearBreak,
  computeBreakLevel,
  formatClock,
  isKnockoutLike,
  nextPeriodFromIntermission,
  periodBaseOffsetSeconds,
  periodLimitSeconds,
  periodOptions,
  type ClockPeriod,
  type MatchClockDTO,
  type MatchStatus,
} from "./matchLive.utils";

export type ClockMeta = {
  clock: MatchClockDTO | null;
  baseOffsetSeconds: number;
  displaySecondsInPeriod: number;
  matchDisplaySeconds: number;
  commentaryMinute: number;

  breakMode: BreakModeT;
  showBreakTimer: boolean;
  breakSeconds: number;
  breakLevel: "NORMAL" | "WARN" | "DANGER";

  timeLimitSeconds: number | null;
  timeOverLimit: boolean;
};

type PendingConfirm = {
  kind: "FINISH_FORCE";
  title: string;
  detail: string;
  delete_count?: number;
  delete_ids?: number[];
};

type Props = {
  matchId: number;
  matchStatus: MatchStatus;
  discipline: string;
  canEdit: boolean;
  scoreContext?: {
    home: number;
    away: number;
    stageType?: string;
    wentToExtraTime?: boolean;
  };
  reloadToken?: number;
  onMetaChange?: (meta: ClockMeta) => void;
  onEnterExtraTime?: () => void;
  onAfterRecompute?: () => Promise<void> | void;
  onRequestIncidentsReload?: () => void;
};

export function ClockPanel({
  matchId,
  matchStatus,
  discipline,
  canEdit,
  scoreContext,
  reloadToken,
  onMetaChange,
  onEnterExtraTime,
  onAfterRecompute,
  onRequestIncidentsReload,
}: Props) {
  const [clock, setClock] = useState<MatchClockDTO | null>(null);
  const [clockTick, setClockTick] = useState(0);
  const [breakTick, setBreakTick] = useState(0);

  const [breakMode, setBreakMode] = useState<BreakModeT>(() => {
    try {
      return (localStorage.getItem(`matchBreak:${matchId}:mode`) as BreakModeT) || BreakMode.NONE;
    } catch {
      return BreakMode.NONE;
    }
  });

  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [pendingConfirmBusy, setPendingConfirmBusy] = useState(false);

  // localStorage helpers
  const readBreakStartedAt = () => {
    try {
      const raw = localStorage.getItem(`matchBreak:${matchId}:startedAt`);
      if (!raw) return null;
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? n : null;
    } catch {
      return null;
    }
  };

  const writeBreakMode = (mode: BreakModeT) => {
    try {
      localStorage.setItem(`matchBreak:${matchId}:mode`, mode);
    } catch {
      // ignore
    }
  };

  const writeBreakStartedAt = (tsMs: number | null) => {
    try {
      if (!tsMs) localStorage.removeItem(`matchBreak:${matchId}:startedAt`);
      else localStorage.setItem(`matchBreak:${matchId}:startedAt`, String(tsMs));
    } catch {
      // ignore
    }
  };

  const clockUrl = (suffix: string) => `/api/matches/${matchId}/clock/${suffix}`;

  const loadClock = async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch(`/api/matches/${matchId}/clock/`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || "Nie udało się pobrać zegara.");
      setClock(data);

      // gdy gra RUNNING, nie chcemy wiszącego stanu przerwy w UI
      if (data?.clock_state === "RUNNING") {
        clearBreak(matchId);
        setBreakMode(BreakMode.NONE);
      }
    } catch (e: any) {
      setError(e?.message ?? "Błąd pobierania zegara.");
    } finally {
      setLoading(false);
    }
  };

  const postClock = async (suffix: string, body?: any) => {
    setError(null);
    setLoading(true);
    try {
      const method = body ? (suffix === "period/" || suffix === "added-seconds/" ? "PATCH" : "POST") : "POST";
      const res = await apiFetch(clockUrl(suffix), {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || "Operacja zegara nie powiodła się.");
      setClock(data);
      return data as MatchClockDTO;
    } catch (e: any) {
      setError(e?.message ?? "Błąd operacji zegara.");
      throw e;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, reloadToken]);

  // lokalny tick tylko do wyświetlania mm:ss
  useEffect(() => {
    if (!clock || clock.clock_state !== "RUNNING") return;
    const t = window.setInterval(() => setClockTick((x) => x + 1), 250);
    return () => window.clearInterval(t);
  }, [clock?.clock_state, clock?.clock_started_at, clock?.server_time]);

  const displaySecondsInPeriod = useMemo(() => {
    if (!clock) return 0;

    const snapTotal =
      typeof clock.seconds_total === "number"
        ? clock.seconds_total
        : Math.max(0, Number(clock.clock_elapsed_seconds || 0) + Number(clock.clock_added_seconds || 0));

    const snapInPeriod = typeof clock.seconds_in_period === "number" ? Math.max(0, Number(clock.seconds_in_period || 0)) : snapTotal;

    if (clock.clock_state !== "RUNNING") return snapInPeriod;
    if (!clock.server_time) return snapInPeriod;

    const serverMs = new Date(clock.server_time).getTime();
    if (!Number.isFinite(serverMs)) return snapInPeriod;

    const delta = Math.max(0, (Date.now() - serverMs) / 1000);
    return snapInPeriod + delta;
  }, [clock, clockTick]);

  const baseOffsetSeconds = useMemo(() => {
    const p = clock?.clock_period || "NONE";
    return periodBaseOffsetSeconds(discipline, p as ClockPeriod);
  }, [clock?.clock_period, discipline]);

  const matchDisplaySeconds = useMemo(() => {
    return Math.max(0, Number(baseOffsetSeconds || 0) + Number(displaySecondsInPeriod || 0));
  }, [baseOffsetSeconds, displaySecondsInPeriod]);

  const commentaryMinute = useMemo(() => Math.max(0, Math.floor(matchDisplaySeconds / 60)), [matchDisplaySeconds]);

  const isBreakFromBackend = Boolean(clock?.is_break || clock?.write_locked);
  const localStarted = readBreakStartedAt();
  const localBreakSeconds = breakMode !== BreakMode.NONE && localStarted ? Math.max(0, Math.floor((Date.now() - localStarted) / 1000)) : 0;

  const breakSeconds = typeof clock?.break_seconds === "number" ? clock.break_seconds : localBreakSeconds;
  const breakLevel = clock?.break_level ? clock.break_level : computeBreakLevel(breakSeconds);

  const showBreakTimer = (isBreakFromBackend && clock?.clock_state === "PAUSED") || (breakMode !== BreakMode.NONE && !!localStarted);

  useEffect(() => {
    if (!showBreakTimer) return;
    const t = window.setInterval(() => setBreakTick((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, [showBreakTimer, matchId]);

  const timeLimitSeconds = useMemo(() => {
    if (!clock) return null;
    return periodLimitSeconds(discipline, clock.clock_period);
  }, [clock, discipline]);

  const timeOverLimit = useMemo(() => {
    if (!timeLimitSeconds) return false;
    const absLimit = Math.max(0, Number(baseOffsetSeconds || 0) + Number(timeLimitSeconds || 0));
    return matchDisplaySeconds >= absLimit;
  }, [baseOffsetSeconds, matchDisplaySeconds, timeLimitSeconds]);

  const meta = useMemo<ClockMeta>(() => {
    return {
      clock,
      baseOffsetSeconds,
      displaySecondsInPeriod,
      matchDisplaySeconds,
      commentaryMinute,
      breakMode,
      showBreakTimer,
      breakSeconds,
      breakLevel,
      timeLimitSeconds,
      timeOverLimit,
    };
  }, [
    clock,
    baseOffsetSeconds,
    displaySecondsInPeriod,
    matchDisplaySeconds,
    commentaryMinute,
    breakMode,
    showBreakTimer,
    breakSeconds,
    breakLevel,
    timeLimitSeconds,
    timeOverLimit,
    breakTick,
  ]);

  useEffect(() => {
    onMetaChange?.(meta);
  }, [meta, onMetaChange]);

  const inProgress = matchStatus === "IN_PROGRESS" || matchStatus === "RUNNING";

  const primaryLabel = useMemo(() => {
    if (!clock) return "Zacznij mecz";
    if (clock.clock_state === "NOT_STARTED" || clock.clock_state === "STOPPED") return "Zacznij mecz";

    if (clock.clock_state === "PAUSED" && breakMode === BreakMode.INTERMISSION) {
      const allowExtraTimeStart =
        !!scoreContext &&
        isKnockoutLike(scoreContext.stageType) &&
        Number(scoreContext.home || 0) === Number(scoreContext.away || 0) &&
        !scoreContext.wentToExtraTime;

      const next = nextPeriodFromIntermission(discipline, clock.clock_period, { allowExtraTimeStart });
      if (next === "SH" || next === "H2") return "Rozpocznij 2 połowę";
      if (next === "ET1") return "Rozpocznij dogrywkę";
      if (next === "ET2") return "Rozpocznij 2 połowę dogrywki";
      return "Rozpocznij kolejny etap";
    }

    if (clock.clock_state === "PAUSED") return "Wznów grę";
    return "W trakcie";
  }, [clock, breakMode, discipline, scoreContext]);

  const handlePrimary = async () => {
    if (!canEdit) return;

    if (!clock) {
      await loadClock();
      return;
    }

    if (clock.clock_state === "NOT_STARTED" || clock.clock_state === "STOPPED") {
      clearBreak(matchId);
      setBreakMode(BreakMode.NONE);
      await postClock("start/");
      return;
    }

    if (clock.clock_state === "PAUSED" && breakMode === BreakMode.INTERMISSION) {
      const allowExtraTimeStart =
        !!scoreContext &&
        isKnockoutLike(scoreContext.stageType) &&
        Number(scoreContext.home || 0) === Number(scoreContext.away || 0) &&
        !scoreContext.wentToExtraTime;

      const next = nextPeriodFromIntermission(discipline, clock.clock_period, { allowExtraTimeStart });
      if (next) {
        await postClock("period/", { period: next });
        if (next === "ET1") onEnterExtraTime?.();
      }

      clearBreak(matchId);
      setBreakMode(BreakMode.NONE);
      await postClock("resume/");
      return;
    }

    if (clock.clock_state === "PAUSED") {
      clearBreak(matchId);
      setBreakMode(BreakMode.NONE);
      await postClock("resume/");
    }
  };

  const handleIntermissionBreak = async () => {
    if (!canEdit) return;

    writeBreakMode(BreakMode.INTERMISSION);
    writeBreakStartedAt(Date.now());
    setBreakMode(BreakMode.INTERMISSION);
    await postClock("pause/", { break: true });
  };

  const handleTechPause = async () => {
    if (!canEdit) return;

    writeBreakMode(BreakMode.TECH);
    writeBreakStartedAt(Date.now());
    setBreakMode(BreakMode.TECH);
    await postClock("pause/", { break: false });
  };

  const handleReset = async () => {
    if (!clock) return;

    const ok = window.confirm(
      "To zresetuje zegar bieżącego okresu do jego początku (bez ingerencji w incydenty i wynik). Kontynuować?"
    );
    if (!ok) return;

    setResetting(true);
    try {
      clearBreak(matchId);
      setBreakMode(BreakMode.NONE);

      const currentPeriod =
        clock.clock_period && clock.clock_period !== "NONE" ? clock.clock_period : periodOptions(discipline)[0]?.value || "NONE";

      await postClock("period/", { period: currentPeriod });
      await loadClock();
    } catch (e: any) {
      setError(e?.message || "Nie udało się zresetować zegara.");
    } finally {
      setResetting(false);
    }
  };

  const runFinish = async (force: boolean) => {
    setLoading(true);
    setError(null);

    try {
      const url = force ? `/api/matches/${matchId}/finish/?force=1` : `/api/matches/${matchId}/finish/`;
      const res = await apiFetch(url, { method: "POST" });
      const data: any = await res.json().catch(() => ({}));

      if (res.status === 409 && !force && data?.code === "SCORE_SYNC_CONFIRM_REQUIRED") {
        setPendingConfirm({
          kind: "FINISH_FORCE",
          title: "Potwierdź zakończenie meczu",
          detail: String(data?.detail || "Zmiana wyniku wymaga usunięcia części istniejących incydentów GOAL."),
          delete_count: Number(data?.delete_count || 0),
          delete_ids: Array.isArray(data?.delete_ids) ? data.delete_ids : undefined,
        });
        return;
      }

      if (!res.ok) throw new Error(String(data?.detail || "Nie udało się zakończyć meczu."));

      clearBreak(matchId);
      setBreakMode(BreakMode.NONE);

      await onAfterRecompute?.();
      await loadClock();
      onRequestIncidentsReload?.();
    } catch (e: any) {
      setError(e?.message ?? "Błąd zakończenia meczu.");
    } finally {
      setLoading(false);
    }
  };

  const handleFinish = async () => {
    await runFinish(false);
  };

  const headerBg =
    matchStatus === "FINISHED"
      ? "bg-sky-500/10"
      : inProgress
      ? "bg-emerald-500/10"
      : "bg-white/[0.02]";

  const breakBadgeClasses = useMemo(() => {
    if (!showBreakTimer) return "";
    if (breakLevel === "DANGER") return "border-red-500/50 bg-red-500/15";
    if (breakLevel === "WARN") return "border-amber-400/50 bg-amber-400/15";
    return "border-white/10 bg-white/[0.04]";
  }, [showBreakTimer, breakLevel, breakTick]);

  const timeBadgeClasses = useMemo(() => {
    const over = timeOverLimit || Boolean(clock?.cap_reached);
    return over ? "border-red-500/50 bg-red-500/15" : "border-white/10 bg-white/[0.04]";
  }, [timeOverLimit, clock?.cap_reached]);

  const periodOpts = useMemo(() => periodOptions(discipline), [discipline]);

  const canShowPeriodSelect = periodOpts.length > 0;

  return (
    <div className={cn("rounded-2xl border border-white/10 p-4", headerBg)}>
      {pendingConfirm && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-[560px] rounded-2xl border border-white/10 bg-slate-950 p-4 shadow-2xl">
            <div className="text-base font-extrabold text-white">{pendingConfirm.title}</div>
            <div className="mt-2 text-sm leading-6 text-slate-200">{pendingConfirm.detail}</div>

            {typeof pendingConfirm.delete_count === "number" && (
              <div className="mt-3 text-sm text-slate-200">
                Do usunięcia: <span className="font-bold text-white">{pendingConfirm.delete_count}</span> incydentów GOAL.
              </div>
            )}

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                className={cn(
                  "rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-white",
                  pendingConfirmBusy && "opacity-60"
                )}
                onClick={() => (pendingConfirmBusy ? null : setPendingConfirm(null))}
                disabled={pendingConfirmBusy}
              >
                Anuluj
              </button>
              <button
                type="button"
                className={cn(
                  "rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-sm font-semibold text-white",
                  pendingConfirmBusy && "opacity-60"
                )}
                onClick={async () => {
                  if (pendingConfirmBusy) return;
                  setPendingConfirmBusy(true);
                  try {
                    if (pendingConfirm.kind === "FINISH_FORCE") await runFinish(true);
                    setPendingConfirm(null);
                  } finally {
                    setPendingConfirmBusy(false);
                  }
                }}
                disabled={pendingConfirmBusy}
              >
                Skoryguj i zakończ
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-base font-extrabold text-white">Zegar</div>

          <div className="flex flex-wrap items-center gap-2">
            {showBreakTimer && (
              <span className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-white", breakBadgeClasses)}>
                Przerwa: <span className="font-bold">{formatClock(breakSeconds)}</span>
              </span>
            )}

            <span className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-white", timeBadgeClasses)}>
              Czas meczu: <span className="font-bold">{formatClock(matchDisplaySeconds)}</span>
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={cn(
              "rounded-xl border border-white/10 bg-emerald-500/15 px-3 py-2 text-sm font-semibold text-white",
              (!canEdit || loading) && "opacity-60"
            )}
            onClick={handlePrimary}
            disabled={!canEdit || loading}
          >
            {primaryLabel}
          </button>

          <button
            type="button"
            className={cn(
              "rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-white",
              (!canEdit || loading) && "opacity-60"
            )}
            onClick={handleIntermissionBreak}
            disabled={!canEdit || loading || !clock || clock.clock_state !== "RUNNING"}
          >
            Przerwa
          </button>

          <button
            type="button"
            className={cn(
              "rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-white",
              (!canEdit || loading) && "opacity-60"
            )}
            onClick={handleTechPause}
            disabled={!canEdit || loading || !clock || clock.clock_state !== "RUNNING"}
          >
            Pauza techniczna
          </button>

          <button
            type="button"
            className={cn(
              "rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-white",
              (!canEdit || resetting || loading) && "opacity-60"
            )}
            onClick={handleReset}
            disabled={!canEdit || resetting || loading || !clock}
          >
            Resetuj zegar
          </button>

          <button
            type="button"
            className={cn(
              "rounded-xl border border-white/10 bg-red-500/15 px-3 py-2 text-sm font-semibold text-white",
              (!canEdit || loading) && "opacity-60"
            )}
            onClick={handleFinish}
            disabled={!canEdit || loading}
          >
            Zakończ mecz
          </button>

          <button
            type="button"
            className={cn("rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-white", loading && "opacity-60")}
            onClick={loadClock}
            disabled={loading}
          >
            Odśwież
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {canShowPeriodSelect && (
            <label className="flex items-center gap-2 text-sm text-slate-200">
              Okres gry:
              <select
                className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none"
                value={clock?.clock_period || periodOpts[0]?.value || "NONE"}
                onChange={async (e) => {
                  if (!canEdit) return;
                  const p = e.target.value as ClockPeriod;
                  try {
                    await postClock("period/", { period: p });
                    await loadClock();
                  } catch {
                    // error handled in postClock
                  }
                }}
                disabled={!canEdit || loading}
              >
                {periodOpts.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="text-xs text-slate-300">
            {clock ? (
              <>
                Stan: <span className="font-semibold text-white">{clock.clock_state}</span>
                {clock.clock_period && clock.clock_period !== "NONE" ? (
                  <>
                    {" "}- okres: <span className="font-semibold text-white">{clock.clock_period}</span>
                  </>
                ) : null}
              </>
            ) : (
              "Ładowanie zegara..."
            )}
          </div>
        </div>

        {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div>}
      </div>
    </div>
  );
}
