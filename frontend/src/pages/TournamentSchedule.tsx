import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { apiFetch } from "../api";
import {
  buildStagesForView,
  displayGroupName,
  groupMatchesByGroup,
  groupMatchesByRound,
  stageHeaderTitle,
} from "../flow/stagePresentation";

/* =========================
   Typy
   ========================= */

type TournamentScheduleDTO = {
  id: number;
  start_date: string | null; // "YYYY-MM-DD"
  end_date: string | null;   // "YYYY-MM-DD"
  location: string | null;
  participants_count?: number;
};

type MatchScheduleDTO = {
  id: number;
  stage_id: number;
  stage_order: number;
  stage_type: "LEAGUE" | "KNOCKOUT" | "GROUP" | "THIRD_PLACE";
  group_name?: string | null;
  round_number: number | null;

  home_team_name: string;
  away_team_name: string;

  scheduled_date: string | null; // "YYYY-MM-DD"
  scheduled_time: string | null; // "HH:mm"
  location: string | null;
};

type MatchDraft = {
  scheduled_date: string | null;
  scheduled_time: string | null;
  location: string | null;
};

/* =========================
   Helpers (daty)
   ========================= */

// Porównanie ISO date stringów (YYYY-MM-DD) działa leksykograficznie.
function isIsoDateBetween(
  value: string,
  min: string | null,
  max: string | null
): { ok: true } | { ok: false; message: string } {
  if (!value) return { ok: true };

  if (min && value < min) {
    return { ok: false, message: "Data meczu nie może być wcześniejsza niż data rozpoczęcia turnieju." };
  }
  if (max && value > max) {
    return { ok: false, message: "Data meczu nie może być późniejsza niż data zakończenia turnieju." };
  }
  return { ok: true };
}

function validateTournamentDates(
  start: string | null,
  end: string | null
): { ok: true } | { ok: false; message: string } {
  if (start && end && end < start) {
    return { ok: false, message: "Data zakończenia nie może być wcześniejsza niż data rozpoczęcia." };
  }
  return { ok: true };
}

function toDraft(m: MatchScheduleDTO): MatchDraft {
  return {
    scheduled_date: m.scheduled_date ?? null,
    scheduled_time: m.scheduled_time ?? null,
    location: m.location ?? null,
  };
}

function sameDraft(a: MatchDraft, b: MatchDraft): boolean {
  return (
    (a.scheduled_date ?? null) === (b.scheduled_date ?? null) &&
    (a.scheduled_time ?? null) === (b.scheduled_time ?? null) &&
    (a.location ?? null) === (b.location ?? null)
  );
}

/* =========================
   Komponent
   ========================= */

export default function TournamentSchedule() {
  const { id } = useParams<{ id: string }>();

  const [tournament, setTournament] = useState<TournamentScheduleDTO | null>(null);
  const [matches, setMatches] = useState<MatchScheduleDTO[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showBye, setShowBye] = useState(false);

  const [savingTournament, setSavingTournament] = useState(false);

  // Autosave: draft + status per mecz
  const [draftMap, setDraftMap] = useState<Record<number, MatchDraft>>({});
  const [savingById, setSavingById] = useState<Record<number, boolean>>({});
  const [saveOkAt, setSaveOkAt] = useState<Record<number, number>>({});
  const [saveErrorById, setSaveErrorById] = useState<Record<number, string>>({});

  // Refs, żeby timery nie łapały starych wartości
  const matchesRef = useRef<MatchScheduleDTO[]>([]);
  const tournamentRef = useRef<TournamentScheduleDTO | null>(null);

  useEffect(() => {
    matchesRef.current = matches;
  }, [matches]);

  useEffect(() => {
    tournamentRef.current = tournament;
  }, [tournament]);

  // Snapshot ostatnio zapisanych wartości (z serwera / po sukcesie autosave)
  const savedSnapshotRef = useRef<Record<number, MatchDraft>>({});

  // Debounce per mecz + kontrola równoległych zapisów
  const SAVE_DEBOUNCE_MS = 2000; // czas
  const saveTimersRef = useRef<Record<number, number | undefined>>({});
  const inFlightRef = useRef<Record<number, boolean | undefined>>({});
  const pendingAfterFlightRef = useRef<Record<number, boolean | undefined>>({});
  const pendingDraftRef = useRef<Record<number, MatchDraft | undefined>>({});

  const storageKey = useMemo(() => {
    return id ? `tournament_schedule_draft_${id}` : "";
  }, [id]);

  /* =========================
     TOAST (auto-hide) – tylko komunikaty globalne
     ========================= */

  const toastText = error ?? message;
  const toastKind: "error" | "success" | null = error ? "error" : message ? "success" : null;

  useEffect(() => {
    if (!toastText) return;

    const t = window.setTimeout(() => {
      setError(null);
      setMessage(null);
    }, 2200);

    return () => window.clearTimeout(t);
  }, [toastText]);

  const closeToast = () => {
    setError(null);
    setMessage(null);
  };

  /* =========================
     LocalStorage draft
     ========================= */

  const readDraftFromStorage = (): Record<number, MatchDraft> => {
    if (!storageKey) return {};
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw) as Record<string, MatchDraft>;
      const out: Record<number, MatchDraft> = {};
      for (const [k, v] of Object.entries(parsed || {})) {
        const idNum = Number(k);
        if (!Number.isFinite(idNum)) continue;
        out[idNum] = {
          scheduled_date: v?.scheduled_date ?? null,
          scheduled_time: v?.scheduled_time ?? null,
          location: v?.location ?? null,
        };
      }
      return out;
    } catch {
      return {};
    }
  };

  useEffect(() => {
    if (!storageKey) return;

    const keys = Object.keys(draftMap);
    if (keys.length === 0) {
      localStorage.removeItem(storageKey);
      return;
    }

    try {
      localStorage.setItem(storageKey, JSON.stringify(draftMap));
    } catch {
      // ignorujemy błędy storage
    }
  }, [draftMap, storageKey]);

  /* =========================
     API – load
     ========================= */

  const loadData = async () => {
    if (!id) return;

    setError(null);
    setMessage(null);

    const [tRes, mRes] = await Promise.all([
      apiFetch(`/api/tournaments/${id}/`),
      apiFetch(`/api/tournaments/${id}/matches/`),
    ]);

    if (!tRes.ok) throw new Error("Nie udało się pobrać danych turnieju.");
    if (!mRes.ok) throw new Error("Nie udało się pobrać meczów.");

    const tData = await tRes.json();
    const tournamentObj: TournamentScheduleDTO = {
      id: tData.id,
      start_date: tData.start_date ?? null,
      end_date: tData.end_date ?? null,
      location: tData.location ?? null,
      participants_count: tData.participants_count,
    };
    setTournament(tournamentObj);
    tournamentRef.current = tournamentObj;

    const raw = await mRes.json();
    const list: MatchScheduleDTO[] = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.results)
        ? raw.results
        : [];

    // Snapshot serwera
    const snap: Record<number, MatchDraft> = {};
    for (const m of list) snap[m.id] = toDraft(m);
    savedSnapshotRef.current = snap;

    // Wczytanie draftów z localStorage i nałożenie na UI
    const storedDrafts = readDraftFromStorage();

    const merged = list.map((m) => {
      const d = storedDrafts[m.id];
      if (!d) return m;
      return {
        ...m,
        scheduled_date: d.scheduled_date,
        scheduled_time: d.scheduled_time,
        location: d.location,
      };
    });

    setMatches(merged);
    matchesRef.current = merged;

    // draftMap tylko dla tych rekordów, które faktycznie różnią się od snapshotu serwera
    const initialDraft: Record<number, MatchDraft> = {};
    for (const m of merged) {
      const base = snap[m.id] ?? { scheduled_date: null, scheduled_time: null, location: null };
      const cur = toDraft(m);
      if (!sameDraft(base, cur)) initialDraft[m.id] = cur;
    }
    setDraftMap(initialDraft);

    setSavingById({});
    setSaveErrorById({});
    setSaveOkAt({});
  };

  useEffect(() => {
    loadData().catch((e: any) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /* =========================
     API – save tournament meta
     ========================= */

  const saveTournament = async (override?: Partial<TournamentScheduleDTO>) => {
    if (!id) return;
    const base = tournamentRef.current;
    if (!base) return;

    const next: TournamentScheduleDTO = { ...base, ...(override ?? {}) };

    if (override) {
      setTournament(next);
      tournamentRef.current = next;
    }

    setError(null);
    setMessage(null);

    const datesCheck = validateTournamentDates(next.start_date, next.end_date);
    if (!datesCheck.ok) {
      setError(datesCheck.message);
      return;
    }

    setSavingTournament(true);
    try {
      const res = await apiFetch(`/api/tournaments/${id}/meta/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_date: next.start_date,
          end_date: next.end_date,
          location: next.location,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.end_date?.[0] || data?.detail || "Nie udało się zapisać danych turnieju.");
      }

      setMessage("Dane turnieju zapisane.");
    } finally {
      setSavingTournament(false);
    }
  };

  /* =========================
     Autosave – core
     ========================= */

  const scheduleAutosave = (matchId: number) => {
    const prev = saveTimersRef.current[matchId];
    if (prev) window.clearTimeout(prev);

    saveTimersRef.current[matchId] = window.setTimeout(() => {
      flushAutosave(matchId).catch(() => void 0);
    }, SAVE_DEBOUNCE_MS);
  };

  const flushAutosave = async (matchId: number, overrideDraft?: MatchDraft) => {
    const prev = saveTimersRef.current[matchId];
    if (prev) window.clearTimeout(prev);

    if (inFlightRef.current[matchId]) {
      pendingAfterFlightRef.current[matchId] = true;
      if (overrideDraft) pendingDraftRef.current[matchId] = overrideDraft;
      return;
    }

    await saveMatchNow(matchId, overrideDraft);

    if (pendingAfterFlightRef.current[matchId]) {
      pendingAfterFlightRef.current[matchId] = false;
      const pendingDraft = pendingDraftRef.current[matchId];
      pendingDraftRef.current[matchId] = undefined;
      await saveMatchNow(matchId, pendingDraft);
    }
  };

  const saveMatchNow = async (matchId: number, overrideDraft?: MatchDraft) => {
    const t = tournamentRef.current;
    const m = matchesRef.current.find((x) => x.id === matchId);
    if (!t || !m) return;

    const current = overrideDraft ?? toDraft(m);
    const base = savedSnapshotRef.current[matchId] ?? { scheduled_date: null, scheduled_time: null, location: null };

    // Jeżeli wartości wróciły do stanu zapisanego
    if (sameDraft(current, base)) {
      setDraftMap((prevMap) => {
        if (!prevMap[matchId]) return prevMap;
        const nextMap = { ...prevMap };
        delete nextMap[matchId];
        return nextMap;
      });
      setSaveErrorById((prev) => ({ ...prev, [matchId]: "" }));
      return;
    }

    // Walidacja
    if (current.scheduled_date) {
      const check = isIsoDateBetween(current.scheduled_date, t.start_date, t.end_date);
      if (!check.ok) {
        setSaveErrorById((prev) => ({ ...prev, [matchId]: check.message }));
        return;
      }
    }

    inFlightRef.current[matchId] = true;
    setSavingById((prev) => ({ ...prev, [matchId]: true }));
    setSaveErrorById((prev) => ({ ...prev, [matchId]: "" })); // czyścimy błąd przed próbą

    try {
      const res = await apiFetch(`/api/matches/${matchId}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduled_date: current.scheduled_date,
          scheduled_time: current.scheduled_time,
          location: current.location,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail || "Nie udało się zapisać danych meczu.");
      }

      // Sukces
      savedSnapshotRef.current[matchId] = current;

      setDraftMap((prevMap) => {
        const nextMap = { ...prevMap };
        delete nextMap[matchId];
        return nextMap;
      });

      // Ustaw "Zapisano"
      setSaveOkAt((prev) => ({ ...prev, [matchId]: Date.now() }));
      setSaveErrorById((prev) => ({ ...prev, [matchId]: "" }));

      // NOWOŚĆ: Usuń status "Zapisano" po 2 sekundach (wymusi re-render)
      setTimeout(() => {
        setSaveOkAt((prev) => {
          // Jeśli w międzyczasie pojawił się inny zapis, sprawdźmy timestamp (opcjonalne, ale tutaj bezpieczne po prostu usunąć)
          const next = { ...prev };
          delete next[matchId];
          return next;
        });
      }, 2000);

    } catch (e: any) {
      setSaveErrorById((prev) => ({ ...prev, [matchId]: e?.message || "Błąd zapisu." }));
    } finally {
      inFlightRef.current[matchId] = false;
      setSavingById((prev) => ({ ...prev, [matchId]: false }));
    }
  };

  useEffect(() => {
    return () => {
      const timers = saveTimersRef.current;
      for (const k of Object.keys(timers)) {
        const idNum = Number(k);
        const t = timers[idNum];
        if (t) window.clearTimeout(t);
      }
    };
  }, []);

  /* =========================
     Edycja pól meczu
     ========================= */

  const setMatchDraftAndSchedule = (matchId: number, patch: Partial<MatchDraft>): MatchDraft => {
    const currentMatch = matchesRef.current.find((x) => x.id === matchId);
    const baseDraft: MatchDraft = currentMatch
      ? toDraft(currentMatch)
      : { scheduled_date: null, scheduled_time: null, location: null };

    const nextDraft: MatchDraft = {
      scheduled_date: patch.scheduled_date !== undefined ? patch.scheduled_date : baseDraft.scheduled_date,
      scheduled_time: patch.scheduled_time !== undefined ? patch.scheduled_time : baseDraft.scheduled_time,
      location: patch.location !== undefined ? patch.location : baseDraft.location,
    };

    setMatches((prev) => {
      const next = prev.map((x) =>
        x.id === matchId
          ? {
              ...x,
              scheduled_date: nextDraft.scheduled_date,
              scheduled_time: nextDraft.scheduled_time,
              location: nextDraft.location,
            }
          : x
      );
      matchesRef.current = next;
      return next;
    });

    const snap = savedSnapshotRef.current[matchId] ?? { scheduled_date: null, scheduled_time: null, location: null };
    setDraftMap((prev) => {
      const differs = !sameDraft(nextDraft, snap);
      if (!differs) {
        if (!prev[matchId]) return prev;
        const copy = { ...prev };
        delete copy[matchId];
        return copy;
      }
      return { ...prev, [matchId]: nextDraft };
    });

    setSaveErrorById((prev) => ({ ...prev, [matchId]: "" }));
    scheduleAutosave(matchId);
    return nextDraft;
  };

  const clearRow = (matchId: number) => {
    const cleared = setMatchDraftAndSchedule(matchId, {
      scheduled_date: null,
      scheduled_time: null,
      location: null,
    });
    flushAutosave(matchId, cleared).catch(() => void 0);
  };

  /* =========================
     Widok
     ========================= */

  const stages = useMemo(() => buildStagesForView(matches, { showBye }), [matches, showBye]);

  const renderRowStatus = (matchId: number) => {
    const isSaving = Boolean(savingById[matchId]);
    const err = (saveErrorById[matchId] ?? "").trim();
    const okAt = saveOkAt[matchId]; // Jeśli timestamp istnieje, to znaczy że pokazujemy (bo setTimeout go usunie)
    const hasDraft = Boolean(draftMap[matchId]);

    if (isSaving) {
      return <span style={{ opacity: 0.85 }}>Zapisywanie…</span>;
    }
    // Jeśli błąd -> pokaż komunikat + przycisk Retry
    if (err) {
      return (
        <span style={{ color: "#e74c3c", display: "inline-flex", alignItems: "center" }}>
          Błąd zapisu
          <button
            type="button"
            onClick={() => flushAutosave(matchId).catch(() => void 0)}
            style={{
              marginLeft: 8,
              border: "1px solid #c0392b",
              background: "rgba(231, 76, 60, 0.15)",
              color: "#e74c3c",
              borderRadius: 6,
              padding: "0.15rem 0.5rem",
              cursor: "pointer",
              fontSize: "0.75rem",
              fontWeight: "bold"
            }}
            title="Spróbuj zapisać ponownie"
          >
            PONÓW
          </button>
        </span>
      );
    }
    if (okAt) {
      return <span style={{ color: "#2ecc71", fontWeight: "bold" }}>Zapisano</span>;
    }
    if (hasDraft) {
      return <span style={{ opacity: 0.7 }}>Oczekuje na zapis…</span>;
    }

    return <span style={{ opacity: 0.55 }} />;
  };

  const renderMatchRow = (m: MatchScheduleDTO) => {
    const matchId = m.id;
    const isSaving = Boolean(savingById[matchId]);
    const minDate = tournament?.start_date ?? undefined;
    const maxDate = tournament?.end_date ?? undefined;
    const err = (saveErrorById[matchId] ?? "").trim();

    return (
      <div
        key={m.id}
        style={{
          borderBottom: "1px solid #333",
          padding: "0.75rem 0",
          marginBottom: "0.25rem",
          opacity: isSaving ? 0.82 : 1,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ marginBottom: "0.5rem" }}>
            <strong>{m.home_team_name}</strong> <span style={{ opacity: 0.6 }}>vs</span>{" "}
            <strong>{m.away_team_name}</strong>
          </div>

          <div style={{ fontSize: "0.85rem", display: "flex", alignItems: "center", gap: 10 }}>
            {renderRowStatus(matchId)}
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          <input
            type="date"
            value={m.scheduled_date ?? ""}
            min={minDate}
            max={maxDate}
            disabled={isSaving}
            onChange={(e) => setMatchDraftAndSchedule(matchId, { scheduled_date: e.target.value || null })}
            onBlur={() => flushAutosave(matchId).catch(() => void 0)}
            style={{ padding: "0.3rem" }}
          />

          <input
            type="time"
            value={m.scheduled_time ?? ""}
            disabled={isSaving}
            onChange={(e) => setMatchDraftAndSchedule(matchId, { scheduled_time: e.target.value || null })}
            onBlur={() => flushAutosave(matchId).catch(() => void 0)}
            style={{ padding: "0.3rem" }}
          />

          <input
            type="text"
            placeholder="Lokalizacja"
            value={m.location ?? ""}
            disabled={isSaving}
            onChange={(e) => setMatchDraftAndSchedule(matchId, { location: e.target.value || null })}
            onBlur={() => flushAutosave(matchId).catch(() => void 0)}
            style={{ padding: "0.3rem", width: "180px" }}
          />

          <button
            type="button"
            disabled={isSaving}
            onClick={() => clearRow(matchId)}
            style={{
              padding: "0.3rem 0.8rem",
              border: "1px solid #555",
              background: "rgba(255,255,255,0.06)",
              color: "#fff",
              cursor: isSaving ? "not-allowed" : "pointer",
              borderRadius: "6px",
            }}
            title="Wyczyść datę, godzinę i lokalizację"
          >
            Wyczyść
          </button>
        </div>

        {err ? <div style={{ marginTop: 8, color: "#e74c3c", fontSize: "0.9rem" }}>{err}</div> : null}
      </div>
    );
  };

  if (!tournament) return <p style={{ padding: "2rem" }}>Ładowanie…</p>;

  const startMax = tournament.end_date ?? undefined;
  const endMin = tournament.start_date ?? undefined;

  return (
    <div style={{ padding: "2rem", maxWidth: 900 }}>
      <h1>Harmonogram i lokalizacja</h1>

      <p style={{ opacity: 0.8, marginBottom: "2rem" }}>
        Edycja meczów zapisuje się automatycznie po krótkiej przerwie lub po wyjściu z pola.
        Zmiany są przechowywane lokalnie do czasu poprawnego zapisu.
      </p>

      {/* TOAST: komunikaty globalne */}
      {toastKind && toastText && (
        <div
          role="status"
          style={{
            position: "fixed",
            bottom: "2rem",
            right: "2rem",
            background: "#333",
            color: "#fff",
            padding: "0.9rem 1.2rem",
            borderRadius: "10px",
            borderLeft: `5px solid ${toastKind === "success" ? "#2ecc71" : "#e74c3c"}`,
            zIndex: 100,
            minWidth: 320,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ lineHeight: 1.25 }}>{toastText}</div>
          <button
            onClick={closeToast}
            aria-label="Zamknij"
            style={{
              border: "1px solid #555",
              background: "transparent",
              color: "#fff",
              borderRadius: 8,
              padding: "0.25rem 0.5rem",
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* --- DANE OGÓLNE --- */}
      <section
        style={{
          marginBottom: "2rem",
          padding: "1rem",
          background: "rgba(255,255,255,0.02)",
          borderRadius: "8px",
        }}
      >
        <h2 style={{ marginTop: 0 }}>Dane ogólne turnieju</h2>

        <div style={{ display: "grid", gap: "1rem", maxWidth: 420 }}>
          <div>
            <label style={{ display: "block", marginBottom: "0.25rem" }}>Data rozpoczęcia</label>
            <input
              type="date"
              value={tournament.start_date ?? ""}
              max={startMax}
              disabled={savingTournament}
              onChange={(e) =>
                setTournament((prev) => {
                  if (!prev) return prev;
                  const next = { ...prev, start_date: e.target.value || null };
                  tournamentRef.current = next;
                  return next;
                })
              }
              style={{ width: "100%", padding: "0.4rem" }}
            />
          </div>

          <div>
            <label style={{ display: "block", marginBottom: "0.25rem" }}>Data zakończenia</label>
            <input
              type="date"
              value={tournament.end_date ?? ""}
              min={endMin}
              disabled={savingTournament}
              onChange={(e) =>
                setTournament((prev) => {
                  if (!prev) return prev;
                  const next = { ...prev, end_date: e.target.value || null };
                  tournamentRef.current = next;
                  return next;
                })
              }
              style={{ width: "100%", padding: "0.4rem" }}
            />
          </div>

          <div>
            <label style={{ display: "block", marginBottom: "0.25rem" }}>Lokalizacja (domyślna)</label>
            <input
              type="text"
              value={tournament.location ?? ""}
              disabled={savingTournament}
              onChange={(e) =>
                setTournament((prev) => {
                  if (!prev) return prev;
                  const next = { ...prev, location: e.target.value || null };
                  tournamentRef.current = next;
                  return next;
                })
              }
              style={{ width: "100%", padding: "0.4rem" }}
            />
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={() => saveTournament().catch((e: any) => setError(e.message))}
              disabled={savingTournament}
              style={{
                padding: "0.6rem",
                cursor: savingTournament ? "not-allowed" : "pointer",
                marginTop: "0.5rem",
                fontWeight: "bold",
                opacity: savingTournament ? 0.75 : 1,
              }}
            >
              {savingTournament ? "Zapisywanie…" : "Zapisz dane turnieju"}
            </button>

            <button
              type="button"
              onClick={() =>
                saveTournament({ start_date: null, end_date: null, location: null }).catch((e: any) =>
                  setError(e.message)
                )
              }
              disabled={savingTournament}
              style={{
                padding: "0.6rem",
                cursor: savingTournament ? "not-allowed" : "pointer",
                marginTop: "0.5rem",
                border: "1px solid #555",
                background: "rgba(255,255,255,0.06)",
                color: "#fff",
                borderRadius: 8,
                opacity: savingTournament ? 0.75 : 1,
              }}
              title="Wyczyść datę rozpoczęcia, datę zakończenia i lokalizację"
            >
              Wyczyść dane
            </button>
          </div>
        </div>
      </section>

      <hr style={{ borderColor: "#444", margin: "2rem 0" }} />

      {/* --- LISTA MECZÓW --- */}
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1rem" }}>
        <h2 style={{ margin: 0 }}>Harmonogram meczów</h2>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            opacity: 0.85,
            cursor: "pointer",
            fontSize: "0.9em",
          }}
        >
          <input type="checkbox" checked={showBye} onChange={(e) => setShowBye(e.target.checked)} />
          Pokaż mecze techniczne (BYE)
        </label>
      </div>

      {stages.map((s) => {
        const header = stageHeaderTitle(s.stageType, s.stageOrder, s.allMatches);

        return (
          <section key={s.stageId} style={{ marginTop: "2rem" }}>
            <h3
              style={{
                borderBottom: "2px solid #444",
                paddingBottom: "0.5rem",
                marginBottom: "1rem",
                color: "#eee",
              }}
            >
              {header}
            </h3>

            {s.stageType === "GROUP" ? (
              groupMatchesByGroup(s.matches).map(([groupName, groupMatches], idx) => (
                <div
                  key={groupName}
                  style={{ marginBottom: "1.5rem", paddingLeft: "1rem", borderLeft: "2px solid #333" }}
                >
                  <h4 style={{ color: "#aaa", margin: "0.5rem 0" }}>{displayGroupName(groupName, idx)}</h4>

                  {groupMatchesByRound(groupMatches).map(([round, roundMatches]) => (
                    <div key={round} style={{ marginBottom: "1rem" }}>
                      <div
                        style={{
                          fontSize: "0.8rem",
                          textTransform: "uppercase",
                          opacity: 0.6,
                          letterSpacing: "1px",
                          marginBottom: "0.25rem",
                        }}
                      >
                        Kolejka {round}
                      </div>
                      {roundMatches.map((m) => renderMatchRow(m))}
                    </div>
                  ))}
                </div>
              ))
            ) : s.stageType === "LEAGUE" ? (
              groupMatchesByRound(s.matches).map(([round, roundMatches]) => (
                <div key={round} style={{ marginBottom: "1.5rem" }}>
                  <h4
                    style={{
                      margin: "0.5rem 0",
                      fontSize: "0.9rem",
                      textTransform: "uppercase",
                      opacity: 0.6,
                      letterSpacing: "1px",
                      borderBottom: "1px solid #333",
                      paddingBottom: "0.25rem",
                    }}
                  >
                    Kolejka {round}
                  </h4>
                  {roundMatches.map((m) => renderMatchRow(m))}
                </div>
              ))
            ) : (
              <div>{s.matches.map((m) => renderMatchRow(m))}</div>
            )}
          </section>
        );
      })}
    </div>
  );
}