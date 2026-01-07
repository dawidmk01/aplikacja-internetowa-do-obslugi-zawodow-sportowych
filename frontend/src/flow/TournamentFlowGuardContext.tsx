import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

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

  // Dodano dla obsługi ID nowo utworzonego turnieju (wymagane przez TournamentBasicsSetup/Footer)
  createdId: string | null;
  setCreatedId: (id: string | null) => void;
};

const Ctx = createContext<TournamentFlowGuardCtx | null>(null);

export function TournamentFlowGuardProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const saveRef = useRef<SaveHandler | null>(null);

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  // Stan dla ID utworzonego turnieju (aby Footer wiedział o nim bez odświeżania)
  const [createdId, setCreatedId] = useState<string | null>(null);

  const registerSave = useCallback((fn: SaveHandler | null) => {
    saveRef.current = fn;
  }, []);

  const markDirty = useCallback(() => setDirty(true), []);
  const clearError = useCallback(() => setLastError(null), []);

  const saveIfDirty = useCallback(async (): Promise<boolean> => {
    if (!dirty) {
  // jeśli strona ma handler zapisu, wywołujemy go TYLKO DO WALIDACJI
      if (saveRef.current) {
        try {
          await Promise.resolve(saveRef.current());
        } catch (e) {
          throw e; // pokaże komunikat walidacyjny
        }
      }
      return true;
    }


    // Jeśli strona nie zarejestrowała handlera, a jest dirty
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
    } catch (e: any) {
      // Ustawiamy błąd w stanie (do wyświetlenia np. w nawigacji)
      setLastError(e?.message ?? "Nie udało się zapisać zmian.");

      // ⚠️ KLUCZOWA ZMIANA: Rzucamy błąd dalej, aby komponent (np. Setup)
      // mógł zareagować (np. przekierowaniem z flashError)
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
    [
      dirty,
      markDirty,
      registerSave,
      saveIfDirty,
      saving,
      lastError,
      clearError,
      createdId,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTournamentFlowGuard() {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error(
      "useTournamentFlowGuard musi być użyty wewnątrz TournamentFlowGuardProvider."
    );
  }
  return ctx;
}