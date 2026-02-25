import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

type SaveHandler = () => Promise<void> | void;

type TournamentFlowGuardCtx = {
  dirty: boolean;
  setDirty: (v: boolean) => void;
  markDirty: () => void;

  registerSave: (fn: SaveHandler | null) => void;
  saveIfDirty: () => Promise<boolean>;

  saving: boolean;
  lastError: string | null;
  clearError: () => void;

  createdId: string | null;
  setCreatedId: (id: string | null) => void;
};

const Ctx = createContext<TournamentFlowGuardCtx | null>(null);

/** Guard flow utrzymuje wspólny kontrakt "dirty + save handler" dla kroków panelu turnieju. */
export function TournamentFlowGuardProvider({ children }: { children: ReactNode }) {
  const saveRef = useRef<SaveHandler | null>(null);

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  /** Id nowo utworzonego turnieju jest dostępne w krokach flow bez odświeżania i bez zależności od routingu. */
  const [createdId, setCreatedId] = useState<string | null>(null);

  const registerSave = useCallback((fn: SaveHandler | null) => {
    saveRef.current = fn;
  }, []);

  const markDirty = useCallback(() => setDirty(true), []);
  const clearError = useCallback(() => setLastError(null), []);

  const saveIfDirty = useCallback(async (): Promise<boolean> => {
    if (!dirty) {
      // Dla widoków z walidacją: jeśli handler istnieje, może zostać wywołany także bez zmian w stanie "dirty".
      if (saveRef.current) {
        await Promise.resolve(saveRef.current());
      }
      return true;
    }

    if (!saveRef.current) {
      setLastError("Brak obsługi zapisu na tej stronie.");
      return true;
    }

    if (saving) return false;

    setSaving(true);
    setLastError(null);

    try {
      await Promise.resolve(saveRef.current());
      setDirty(false);
      return true;
    } catch (e: unknown) {
      const msg =
        typeof e === "object" && e && "message" in e && typeof (e as any).message === "string"
          ? (e as any).message
          : "Nie udało się zapisać zmian.";

      setLastError(msg);
      throw e;
    } finally {
      setSaving(false);
    }
  }, [dirty, saving]);

  const value = useMemo(
    () => ({
      dirty,
      setDirty,
      markDirty,
      registerSave,
      saveIfDirty,
      saving,
      lastError,
      clearError,
      createdId,
      setCreatedId,
    }),
    [dirty, markDirty, registerSave, saveIfDirty, saving, lastError, clearError, createdId]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTournamentFlowGuard() {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useTournamentFlowGuard musi być użyty wewnątrz TournamentFlowGuardProvider.");
  }
  return ctx;
}