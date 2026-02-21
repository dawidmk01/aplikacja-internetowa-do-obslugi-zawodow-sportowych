import { useCallback, useRef, useState, useEffect } from "react";
import { toast } from "../ui/Toast";

export type AutosaveStatus = "idle" | "draft" | "saving" | "success" | "error";

interface UseAutosaveOptions<T> {
  onSave: (id: number | string, data: T) => Promise<void>;
  debounceMs?: number;
}

export function useAutosave<T>({ onSave, debounceMs = 1200 }: UseAutosaveOptions<T>) {
  const [drafts, setDrafts] = useState<Record<string | number, T>>({});
  const [statuses, setStatuses] = useState<Record<string | number, AutosaveStatus>>({});
  const [errors, setErrors] = useState<Record<string | number, string>>({});

  const saveTimersRef = useRef<Record<string | number, number>>({});
  const inFlightRef = useRef<Record<string | number, boolean>>({});
  const pendingAfterFlightRef = useRef<Record<string | number, T | undefined>>({});
  const pulseTimersRef = useRef<Record<string | number, number>>({});

  useEffect(() => {
    return () => {
      Object.values(saveTimersRef.current).forEach(clearTimeout);
      Object.values(pulseTimersRef.current).forEach(clearTimeout);
    };
  }, []);

  const setStatus = useCallback((id: string | number, status: AutosaveStatus) => {
    setStatuses((prev) => ({ ...prev, [id]: status }));
    if (status === "success") {
      if (pulseTimersRef.current[id]) clearTimeout(pulseTimersRef.current[id]);
      pulseTimersRef.current[id] = window.setTimeout(() => {
        setStatuses((prev) => { const next = { ...prev }; delete next[id]; return next; });
      }, 2000);
    }
  }, []);

  const flushSave = useCallback(async (id: string | number, dataToSave?: T) => {
    if (inFlightRef.current[id]) {
      if (dataToSave) pendingAfterFlightRef.current[id] = dataToSave;
      return;
    }
    if (!dataToSave) return;

    inFlightRef.current[id] = true;
    setStatus(id, "saving");
    setErrors((prev) => { const n = { ...prev }; delete n[id]; return n; });

    try {
      await onSave(id, dataToSave);
      setStatus(id, "success");
      setDrafts((prev) => { const next = { ...prev }; delete next[id]; return next; });
      pendingAfterFlightRef.current[id] = undefined;
    } catch (e: any) {
      const msg = e?.message || "Błąd zapisu";
      setErrors((prev) => ({ ...prev, [id]: msg }));
      setStatus(id, "error");
      toast.error(msg, { title: "Autosave" });
    } finally {
      inFlightRef.current[id] = false;
      const nextPending = pendingAfterFlightRef.current[id];
      if (nextPending) {
        pendingAfterFlightRef.current[id] = undefined;
        setTimeout(() => flushSave(id, nextPending), 0);
      }
    }
  }, [onSave, setStatus]);

  const update = useCallback((id: string | number, newData: T) => {
    setDrafts((prev) => ({ ...prev, [id]: newData }));

    if (!inFlightRef.current[id]) setStatus(id, "draft");

    if (saveTimersRef.current[id]) clearTimeout(saveTimersRef.current[id]);
    saveTimersRef.current[id] = window.setTimeout(() => {
      flushSave(id, newData);
    }, debounceMs);
  }, [debounceMs, flushSave, setStatus]);

  const forceSave = useCallback((id: string | number, data: T) => {
      if (saveTimersRef.current[id]) clearTimeout(saveTimersRef.current[id]);
      flushSave(id, data);
  }, [flushSave]);

  const clearDraft = useCallback((id: string | number) => {
      setDrafts(prev => { const n = {...prev}; delete n[id]; return n; });
      setStatus(id, 'idle');
  }, [setStatus]);

  return { drafts, statuses, errors, update, forceSave, clearDraft };
}