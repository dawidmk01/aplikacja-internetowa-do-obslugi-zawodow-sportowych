import { useCallback, useEffect, useMemo, useState } from "react";

import { apiFetch } from "../../api";
import { cn } from "../../lib/cn";

import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";
import { InlineAlert } from "../../ui/InlineAlert";
import { Portal } from "../../ui/Portal";
import { Select, type SelectOption } from "../../ui/Select";

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
  readBreakMode,
  readBreakStartedAt,
  writeBreakMode,
  writeBreakStartedAt,
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

type PendingConfirm =
  | {
      kind: "FINISH_FORCE";
      title: string;
      detail: string;
      confirmLabel: string;
      delete_count?: number;
      delete_ids?: number[];
    }
  | {
      kind: "RESET_CLOCK";
      title: string;
      detail: string;
      confirmLabel: string;
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

/** ClockPanel odpowiada za sterowanie zegarem i publikuje `ClockMeta` jako kontrakt dla reszty widoku live. */
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

  const [breakMode, setBreakMode] = useState<BreakModeT>(() => readBreakMode(matchId));

  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [pendingConfirmBusy, setPendingConfirmBusy] = useState(false);

  useEffect(() => {
    setBreakMode(readBreakMode(matchId));
    setPendingConfirm(null);
    setError(null);
  }, [matchId]);

  const clockUrl = useCallback((suffix: string) => `/api/matches/${matchId}/clock/${suffix}`, [matchId]);

  const loadClock = useCallback(async () => {
    setError(null);
    setLoading(true);

    try {
      const res = await apiFetch(`/api/matches/${matchId}/clock/`, { toastOnError: false } as any);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || "Nie udało się pobrać zegara.");

      setClock(data);

      if (data?.clock_state === "RUNNING") {
        clearBreak(matchId);
        setBreakMode(BreakMode.NONE);
      }
    } catch (e: any) {
      setError(e?.message ?? "Błąd pobierania zegara.");
      setClock(null);
    } finally {
      setLoading(false);
    }
  }, [matchId]);

  const postClock = useCallback(
    async (suffix: string, body?: any) => {
      setError(null);
      setLoading(true);

      try {
        const method = body ? (suffix === "period/" || suffix === "added-seconds/" ? "PATCH" : "POST") : "POST";
        const res = await apiFetch(clockUrl(suffix), {
          method,
          headers: body ? { "Content-Type": "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
          toastOnError: false,
        } as any);

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
    },
    [clockUrl]
  );

  useEffect(() => {
    loadClock();
  }, [loadClock, reloadToken]);

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

    const snapInPeriod =
      typeof clock.seconds_in_period === "number" ? Math.max(0, Number(clock.seconds_in_period || 0)) : snapTotal;

    if (clock.clock_state !== "RUNNING") return snapInPeriod;
    if (!clock.server_time) return snapInPeriod;

    const serverMs = new Date(clock.server_time).getTime();
    if (!Number.isFinite(serverMs)) return snapInPeriod;

    const delta = Math.max(0, (Date.now() - serverMs) / 1000);
    return snapInPeriod + delta;
  }, [clock, clockTick]);

  const baseOffsetSeconds = useMemo(() => {
    const p = (clock?.clock_period || "NONE") as ClockPeriod;
    return periodBaseOffsetSeconds(discipline, p);
  }, [clock?.clock_period, discipline]);

  const matchDisplaySeconds = useMemo(() => {
    return Math.max(0, Number(baseOffsetSeconds || 0) + Number(displaySecondsInPeriod || 0));
  }, [baseOffsetSeconds, displaySecondsInPeriod]);

  const commentaryMinute = useMemo(() => Math.max(0, Math.floor(matchDisplaySeconds / 60)), [matchDisplaySeconds]);

  const isBreakFromBackend = Boolean(clock?.is_break || clock?.write_locked);
  const localStartedAt = readBreakStartedAt(matchId);
  const localBreakSeconds =
    breakMode !== BreakMode.NONE && localStartedAt ? Math.max(0, Math.floor((Date.now() - localStartedAt) / 1000)) : 0;

  const breakSeconds = typeof clock?.break_seconds === "number" ? clock.break_seconds : localBreakSeconds;
  const breakLevel = clock?.break_level ? clock.break_level : computeBreakLevel(breakSeconds);

  const showBreakTimer =
    (isBreakFromBackend && clock?.clock_state === "PAUSED") || (breakMode !== BreakMode.NONE && !!localStartedAt);

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
      if (next === "Q2") return "Rozpocznij 2 kwartę";
      if (next === "Q3") return "Rozpocznij 3 kwartę";
      if (next === "Q4") return "Rozpocznij 4 kwartę";
      if (next === "ET1" || next === "OT1") return "Rozpocznij dogrywkę";
      if (next === "ET2") return "Rozpocznij 2 połowę dogrywki";
      if (next === "OT2") return "Rozpocznij 2 dogrywkę";
      if (next === "OT3") return "Rozpocznij 3 dogrywkę";
      if (next === "OT4") return "Rozpocznij 4 dogrywkę";
      return "Rozpocznij kolejny etap";
    }

    if (clock.clock_state === "PAUSED") return "Wznów grę";
    return "W trakcie";
  }, [clock, breakMode, discipline, scoreContext]);

  const handlePrimary = useCallback(async () => {
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
  }, [breakMode, canEdit, clock, discipline, loadClock, matchId, onEnterExtraTime, postClock, scoreContext]);

  const setLocalBreak = useCallback(
    (mode: BreakModeT) => {
      writeBreakMode(matchId, mode);
      writeBreakStartedAt(matchId, Date.now());
      setBreakMode(mode);
    },
    [matchId]
  );

  const handleIntermissionBreak = useCallback(async () => {
    if (!canEdit) return;
    setLocalBreak(BreakMode.INTERMISSION);
    await postClock("pause/", { break: true });
  }, [canEdit, postClock, setLocalBreak]);

  const handleTechPause = useCallback(async () => {
    if (!canEdit) return;
    setLocalBreak(BreakMode.TECH);
    await postClock("pause/", { break: false });
  }, [canEdit, postClock, setLocalBreak]);

  // Potwierdzenia muszą być realizowane w UI, bez zależności od confirm().
  const openResetConfirm = useCallback(() => {
    if (!clock) return;
    setPendingConfirm({
      kind: "RESET_CLOCK",
      title: "Reset zegara",
      detail:
        "Reset zresetuje zegar bieżącego okresu do jego początku (bez ingerencji w incydenty i wynik). Kontynuować?",
      confirmLabel: "Resetuj",
    });
  }, [clock]);

  const runReset = useCallback(async () => {
    if (!clock) return;

    setResetting(true);
    try {
      clearBreak(matchId);
      setBreakMode(BreakMode.NONE);

      const periodFallback = periodOptions(discipline)[0]?.value || "NONE";
      const currentPeriod = clock.clock_period && clock.clock_period !== "NONE" ? clock.clock_period : periodFallback;

      await postClock("period/", { period: currentPeriod });
      await loadClock();
    } catch (e: any) {
      setError(e?.message || "Nie udało się zresetować zegara.");
    } finally {
      setResetting(false);
    }
  }, [clock, discipline, loadClock, matchId, postClock]);

  const runFinish = useCallback(
    async (force: boolean) => {
      setLoading(true);
      setError(null);

      try {
        const url = force ? `/api/matches/${matchId}/finish/?force=1` : `/api/matches/${matchId}/finish/`;
        const res = await apiFetch(url, { method: "POST", toastOnError: false } as any);
        const data: any = await res.json().catch(() => ({}));

        if (res.status === 409 && !force && data?.code === "SCORE_SYNC_CONFIRM_REQUIRED") {
          setPendingConfirm({
            kind: "FINISH_FORCE",
            title: "Potwierdź zakończenie meczu",
            detail: String(data?.detail || "Zmiana wyniku wymaga usunięcia części istniejących incydentów GOAL."),
            confirmLabel: "Skoryguj i zakończ",
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
    },
    [loadClock, matchId, onAfterRecompute, onRequestIncidentsReload]
  );

  const handleFinish = useCallback(async () => {
    await runFinish(false);
  }, [runFinish]);

  const headerBg =
    matchStatus === "FINISHED" ? "bg-sky-500/10" : inProgress ? "bg-emerald-500/10" : "bg-white/[0.02]";

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
  const periodSelectOptions = useMemo<SelectOption<ClockPeriod>[]>(() => {
    return periodOpts.map((o) => ({ value: o.value as ClockPeriod, label: o.label }));
  }, [periodOpts]);

  const canShowPeriodSelect = periodSelectOptions.length > 0;
  const disableActions = !canEdit || loading;

  const selectedPeriod = (clock?.clock_period || periodSelectOptions[0]?.value || "NONE") as ClockPeriod;

  const handlePeriodChange = useCallback(
    async (p: ClockPeriod) => {
      if (!canEdit) return;
      try {
        await postClock("period/", { period: p });
        await loadClock();
      } catch {
        // Błąd jest obsłużony w postClock.
      }
    },
    [canEdit, loadClock, postClock]
  );

  return (
    <Card className={cn("p-4", headerBg)}>
      {pendingConfirm ? (
        <Portal>
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-[560px]">
              <Card className="p-4 shadow-2xl">
                <div className="text-base font-extrabold text-white">{pendingConfirm.title}</div>
                <div className="mt-2 text-sm leading-6 text-slate-200">{pendingConfirm.detail}</div>

                {"delete_count" in pendingConfirm && typeof pendingConfirm.delete_count === "number" ? (
                  <div className="mt-3 text-sm text-slate-200">
                    Do usunięcia: <span className="font-bold text-white">{pendingConfirm.delete_count}</span> incydentów GOAL.
                  </div>
                ) : null}

                <div className="mt-4 flex items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => (pendingConfirmBusy ? null : setPendingConfirm(null))}
                    disabled={pendingConfirmBusy}
                  >
                    Anuluj
                  </Button>

                  <Button
                    type="button"
                    variant="primary"
                    onClick={async () => {
                      if (pendingConfirmBusy) return;

                      setPendingConfirmBusy(true);
                      try {
                        if (pendingConfirm.kind === "FINISH_FORCE") {
                          await runFinish(true);
                        }
                        if (pendingConfirm.kind === "RESET_CLOCK") {
                          await runReset();
                        }
                        setPendingConfirm(null);
                      } finally {
                        setPendingConfirmBusy(false);
                      }
                    }}
                    disabled={pendingConfirmBusy}
                  >
                    {pendingConfirm.confirmLabel}
                  </Button>
                </div>
              </Card>
            </div>
          </div>
        </Portal>
      ) : null}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-base font-extrabold text-white">Zegar</div>

          <div className="flex flex-wrap items-center gap-2">
            {showBreakTimer ? (
              <span
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-white",
                  breakBadgeClasses
                )}
              >
                Przerwa: <span className="font-bold">{formatClock(breakSeconds)}</span>
              </span>
            ) : null}

            <span className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-white", timeBadgeClasses)}>
              Czas meczu: <span className="font-bold">{formatClock(matchDisplaySeconds)}</span>
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="primary" onClick={handlePrimary} disabled={disableActions}>
            {primaryLabel}
          </Button>

          <Button
            type="button"
            variant="secondary"
            onClick={handleIntermissionBreak}
            disabled={disableActions || !clock || clock.clock_state !== "RUNNING"}
          >
            Przerwa
          </Button>

          <Button
            type="button"
            variant="secondary"
            onClick={handleTechPause}
            disabled={disableActions || !clock || clock.clock_state !== "RUNNING"}
          >
            Pauza techniczna
          </Button>

          <Button
            type="button"
            variant="secondary"
            onClick={openResetConfirm}
            disabled={disableActions || resetting || !clock}
          >
            Resetuj zegar
          </Button>

          <Button type="button" variant="danger" onClick={handleFinish} disabled={disableActions}>
            Zakończ mecz
          </Button>

          <Button type="button" variant="ghost" onClick={loadClock} disabled={loading}>
            Odśwież
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {canShowPeriodSelect ? (
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm text-slate-200">Okres gry:</div>
              <div className="min-w-[220px]">
                <Select<ClockPeriod>
                  value={selectedPeriod}
                  onChange={handlePeriodChange}
                  options={periodSelectOptions}
                  disabled={!canEdit || loading}
                  ariaLabel="Okres gry"
                />
              </div>
            </div>
          ) : null}

          <div className="min-w-0 text-xs text-slate-300">
            {clock ? (
              <>
                Stan: <span className="font-semibold text-white">{clock.clock_state}</span>
                {clock.clock_period && clock.clock_period !== "NONE" ? (
                  <>
                    {" "} - okres: <span className="font-semibold text-white">{clock.clock_period}</span>
                  </>
                ) : null}
              </>
            ) : (
              "Ładowanie zegara..."
            )}
          </div>
        </div>

        {error ? (
          <div className="mt-1 space-y-2">
            <InlineAlert variant="error" title="Błąd">
              {error}
            </InlineAlert>
            <div className="flex justify-end">
              <Button type="button" variant="ghost" onClick={() => setError(null)}>
                Zamknij
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}