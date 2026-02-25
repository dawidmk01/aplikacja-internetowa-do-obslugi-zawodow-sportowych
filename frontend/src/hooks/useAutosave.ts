import { useCallback, useEffect, useRef, useState } from "react";

import { toast } from "../ui/Toast";

// Kontrakt: autosave z debounce i kolejką per id, z toastem na błąd (throttling).

export type AutosaveStatus = "idle" | "draft" | "saving" | "success" | "error";
export type AutosaveKey = string | number;

export type UseAutosaveOptions<T> = {
  onSave: (id: AutosaveKey, data: T) => Promise<void>;

  debounceMs?: number;
  successResetMs?: number;

  // Jeśli true, hook pokaże toast przy błędzie autosave (domyślnie: true).
  toastOnError?: boolean;

  // Minimalny odstęp między toastami dla danego id.
  toastThrottleMs?: number;

  // Opcjonalna integracja z logowaniem/telemetrią na warstwie widoku.
  onError?: (id: AutosaveKey, error: unknown, message: string) => void;

  getErrorMessage?: (error: unknown) => string;
};

type Timer = ReturnType<typeof window.setTimeout>;

function defaultErrorMessage(error: unknown): string {
  const e = error as any;
  const msg = typeof e?.message === "string" ? e.message : "";
  return msg.trim() ? msg : "Błąd zapisu";
}

function omitKey<T extends Record<string, any>>(obj: T, key: string): T {
  const next = { ...obj };
  delete next[key];
  return next;
}

export function useAutosave<T>({
  onSave,
  debounceMs = 1200,
  successResetMs = 2000,
  toastOnError = true,
  toastThrottleMs = 2500,
  onError,
  getErrorMessage,
}: UseAutosaveOptions<T>) {
  const [drafts, setDrafts] = useState<Record<string, T>>({});
  const [statuses, setStatuses] = useState<Record<string, AutosaveStatus>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const saveTimersRef = useRef<Record<string, Timer | undefined>>({});
  const successTimersRef = useRef<Record<string, Timer | undefined>>({});
  const inFlightRef = useRef<Record<string, boolean>>({});
  const pendingAfterFlightRef = useRef<Record<string, T | undefined>>({});
  const lastToastAtRef = useRef<Record<string, number>>({});

  const keyOf = useCallback((id: AutosaveKey) => String(id), []);

  useEffect(() => {
    return () => {
      Object.values(saveTimersRef.current).forEach((t) => t && window.clearTimeout(t));
      Object.values(successTimersRef.current).forEach((t) => t && window.clearTimeout(t));
    };
  }, []);

  const clearTimers = useCallback(
    (key: string) => {
      const st = saveTimersRef.current[key];
      if (st) window.clearTimeout(st);
      saveTimersRef.current[key] = undefined;

      const xt = successTimersRef.current[key];
      if (xt) window.clearTimeout(xt);
      successTimersRef.current[key] = undefined;
    },
    []
  );

  const setStatus = useCallback(
    (key: string, status: AutosaveStatus) => {
      setStatuses((prev) => ({ ...prev, [key]: status }));

      if (status === "success") {
        const old = successTimersRef.current[key];
        if (old) window.clearTimeout(old);

        successTimersRef.current[key] = window.setTimeout(() => {
          setStatuses((prev) => omitKey(prev, key));
          successTimersRef.current[key] = undefined;
        }, successResetMs);
      }
    },
    [successResetMs]
  );

  const maybeToastError = useCallback(
    (key: string, message: string) => {
      if (!toastOnError) return;

      const now = Date.now();
      const last = lastToastAtRef.current[key] ?? 0;
      if (now - last < toastThrottleMs) return;

      lastToastAtRef.current[key] = now;
      toast.error(message);
    },
    [toastOnError, toastThrottleMs]
  );

  const flushSave = useCallback(
    async (id: AutosaveKey, dataToSave?: T) => {
      const key = keyOf(id);
      if (dataToSave === undefined) return;

      if (inFlightRef.current[key]) {
        pendingAfterFlightRef.current[key] = dataToSave;
        return;
      }

      inFlightRef.current[key] = true;
      setStatus(key, "saving");
      setErrors((prev) => omitKey(prev, key));

      try {
        await onSave(id, dataToSave);

        setDrafts((prev) => omitKey(prev, key));
        setErrors((prev) => omitKey(prev, key));
        pendingAfterFlightRef.current[key] = undefined;

        setStatus(key, "success");
      } catch (e) {
        const msg = (getErrorMessage ?? defaultErrorMessage)(e);

        setErrors((prev) => ({ ...prev, [key]: msg }));
        setStatus(key, "error");

        onError?.(id, e, msg);
        maybeToastError(key, msg);
      } finally {
        inFlightRef.current[key] = false;

        const next = pendingAfterFlightRef.current[key];
        if (next !== undefined) {
          pendingAfterFlightRef.current[key] = undefined;
          window.setTimeout(() => {
            void flushSave(id, next);
          }, 0);
        }
      }
    },
    [getErrorMessage, keyOf, maybeToastError, onError, onSave, setStatus]
  );

  const update = useCallback(
    (id: AutosaveKey, data: T) => {
      const key = keyOf(id);

      setDrafts((prev) => ({ ...prev, [key]: data }));

      if (!inFlightRef.current[key]) setStatus(key, "draft");

      const old = saveTimersRef.current[key];
      if (old) window.clearTimeout(old);

      saveTimersRef.current[key] = window.setTimeout(() => {
        void flushSave(id, data);
      }, debounceMs);
    },
    [debounceMs, flushSave, keyOf, setStatus]
  );

  const forceSave = useCallback(
    (id: AutosaveKey, data: T) => {
      const key = keyOf(id);
      clearTimers(key);
      void flushSave(id, data);
    },
    [clearTimers, flushSave, keyOf]
  );

  const clearDraft = useCallback(
    (id: AutosaveKey) => {
      const key = keyOf(id);

      clearTimers(key);

      setDrafts((prev) => omitKey(prev, key));
      setErrors((prev) => omitKey(prev, key));
      setStatuses((prev) => omitKey(prev, key));

      pendingAfterFlightRef.current[key] = undefined;
      inFlightRef.current[key] = false;
    },
    [clearTimers, keyOf]
  );

  return {
    drafts: drafts as any as Record<AutosaveKey, T>,
    statuses: statuses as any as Record<AutosaveKey, AutosaveStatus>,
    errors: errors as any as Record<AutosaveKey, string>,
    update,
    forceSave,
    clearDraft,
  };
}