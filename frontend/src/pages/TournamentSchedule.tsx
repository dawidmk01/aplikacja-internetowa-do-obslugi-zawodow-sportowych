// frontend/src/pages/TournamentSchedule.tsx
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
import { Calendar, Clock, Eraser, MapPin, X } from "lucide-react";

/* =========================
   Typy
   ========================= */

type TournamentScheduleDTO = {
  id: number;
  start_date: string | null; // "YYYY-MM-DD"
  end_date: string | null; // "YYYY-MM-DD"
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
   Toast (zawsze widoczny + pozycja)
   ========================= */

type ToastKind = "success" | "error" | "info";
type ToastPos = "br" | "bl" | "tr" | "tl";

function toastPosClass(pos: ToastPos): string {
  switch (pos) {
    case "br":
      return "bottom-6 right-6";
    case "bl":
      return "bottom-6 left-6";
    case "tr":
      return "top-6 right-6";
    case "tl":
      return "top-6 left-6";
  }
}

function toastRingClass(kind: ToastKind): string {
  if (kind === "success") return "ring-1 ring-emerald-400/30";
  if (kind === "error") return "ring-1 ring-rose-400/30";
  return "ring-1 ring-slate-400/25";
}

/* =========================
   Komponent
   ========================= */

export default function TournamentSchedule() {
  const { id } = useParams<{ id: string }>();

  const [tournament, setTournament] = useState<TournamentScheduleDTO | null>(null);
  const [matches, setMatches] = useState<MatchScheduleDTO[]>([]);
  const [showBye, setShowBye] = useState(false);

  const [savingTournament, setSavingTournament] = useState(false);

  // Autosave: draft + status per mecz
  const [draftMap, setDraftMap] = useState<Record<number, MatchDraft>>({});
  const [savingById, setSavingById] = useState<Record<number, boolean>>({});
  const [saveErrorById, setSaveErrorById] = useState<Record<number, string>>({});

  // Toast state (zawsze renderowany)
  const [toastText, setToastText] = useState<string>("");
  const [toastKind, setToastKind] = useState<ToastKind>("info");
  const [toastPos, setToastPos] = useState<ToastPos>("br");

  const pushToast = (kind: ToastKind, text: string) => {
    setToastKind(kind);
    setToastText(text);
  };

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
  const SAVE_DEBOUNCE_MS = 1100;
  const saveTimersRef = useRef<Record<number, number | undefined>>({});
  const inFlightRef = useRef<Record<number, boolean | undefined>>({});
  const pendingAfterFlightRef = useRef<Record<number, boolean | undefined>>({});
  const pendingDraftRef = useRef<Record<number, MatchDraft | undefined>>({});

  const storageKey = useMemo(() => {
    return id ? `tournament_schedule_draft_${id}` : "";
  }, [id]);

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

    pushToast("info", "Ładowanie harmonogramu…");

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
      return { ...m, scheduled_date: d.scheduled_date, scheduled_time: d.scheduled_time, location: d.location };
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

    pushToast("info", "Gotowe. Zmiany zapisują się automatycznie.");
  };

  useEffect(() => {
    loadData().catch((e: any) => pushToast("error", e?.message || "Błąd ładowania."));
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

    const datesCheck = validateTournamentDates(next.start_date, next.end_date);
    if (!datesCheck.ok) {
      pushToast("error", datesCheck.message);
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

      pushToast("success", "Dane turnieju zapisane.");
    } catch (e: any) {
      pushToast("error", e?.message || "Błąd zapisu danych turnieju.");
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

    // Jeżeli wróciło do zapisanego – usuń draft
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

    // Walidacja daty w obrębie turnieju
    if (current.scheduled_date) {
      const check = isIsoDateBetween(current.scheduled_date, t.start_date, t.end_date);
      if (!check.ok) {
        setSaveErrorById((prev) => ({ ...prev, [matchId]: check.message }));
        pushToast("error", `Mecz #${matchId}: ${check.message}`);
        return;
      }
    }

    inFlightRef.current[matchId] = true;
    setSavingById((prev) => ({ ...prev, [matchId]: true }));
    setSaveErrorById((prev) => ({ ...prev, [matchId]: "" }));

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

      // sukces
      savedSnapshotRef.current[matchId] = current;
      setDraftMap((prevMap) => {
        const nextMap = { ...prevMap };
        delete nextMap[matchId];
        return nextMap;
      });

      // komunikat globalny
      pushToast("success", `Zapisano: mecz #${matchId}`);
    } catch (e: any) {
      const msg = e?.message || "Błąd zapisu.";
      setSaveErrorById((prev) => ({ ...prev, [matchId]: msg }));
      pushToast("error", `Mecz #${matchId}: ${msg}`);
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
    pushToast("info", `Wyczyszczono pola: mecz #${matchId}`);
  };

  /* =========================
     Widok
     ========================= */

  const stages = useMemo(() => buildStagesForView(matches, { showBye }), [matches, showBye]);

  const inputBase =
    "h-9 w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 text-sm text-slate-100 " +
    "placeholder:text-slate-400 outline-none focus-visible:ring-4 focus-visible:ring-white/10 focus-visible:border-white/20 " +
    // klucz: białe ikonki w Chrome (date/time)
    "[color-scheme:dark]";

  const iconWrap =
    "relative flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 h-9";

  const icon =
    "h-4 w-4 text-slate-200/90 shrink-0";

  const renderMatchRow = (m: MatchScheduleDTO) => {
    const matchId = m.id;
    const isSaving = Boolean(savingById[matchId]);
    const minDate = tournament?.start_date ?? undefined;
    const maxDate = tournament?.end_date ?? undefined;
    const err = (saveErrorById[matchId] ?? "").trim();
    const hasDraft = Boolean(draftMap[matchId]);

    return (
      <div
        key={m.id}
        className={[
          "py-3",
          "border-t border-white/10",
          isSaving ? "opacity-75" : "",
        ].join(" ")}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-[240px]">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <span className="truncate">
                {m.home_team_name} <span className="font-normal text-slate-400">vs</span> {m.away_team_name}
              </span>
              {hasDraft ? (
                <span
                  className="inline-block h-2 w-2 rounded-full bg-amber-300/80"
                  title="Niezapisane zmiany"
                />
              ) : null}
            </div>

            {/* Jeśli chcesz 100% bez tekstu w wierszu: usuń ten blok */}
            {err ? <div className="mt-1 text-xs text-rose-300">{err}</div> : null}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isSaving}
              onClick={() => clearRow(matchId)}
              className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 text-sm text-slate-100 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
              title="Wyczyść datę, godzinę i lokalizację"
            >
              <Eraser className="h-4 w-4 text-slate-100" />
            </button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className={iconWrap}>
            <Calendar className={icon} />
            <input
              className="h-9 w-full bg-transparent text-sm text-slate-100 outline-none [color-scheme:dark]"
              type="date"
              value={m.scheduled_date ?? ""}
              min={minDate}
              max={maxDate}
              disabled={isSaving}
              onChange={(e) => setMatchDraftAndSchedule(matchId, { scheduled_date: e.target.value || null })}
              onBlur={() => flushAutosave(matchId).catch(() => void 0)}
            />
          </div>

          <div className={iconWrap}>
            <Clock className={icon} />
            <input
              className="h-9 w-full bg-transparent text-sm text-slate-100 outline-none [color-scheme:dark]"
              type="time"
              value={m.scheduled_time ?? ""}
              disabled={isSaving}
              onChange={(e) => setMatchDraftAndSchedule(matchId, { scheduled_time: e.target.value || null })}
              onBlur={() => flushAutosave(matchId).catch(() => void 0)}
            />
          </div>

          <div className={iconWrap}>
            <MapPin className={icon} />
            <input
              className="h-9 w-full bg-transparent text-sm text-slate-100 outline-none"
              type="text"
              placeholder="Lokalizacja"
              value={m.location ?? ""}
              disabled={isSaving}
              onChange={(e) => setMatchDraftAndSchedule(matchId, { location: e.target.value || null })}
              onBlur={() => flushAutosave(matchId).catch(() => void 0)}
            />
          </div>
        </div>
      </div>
    );
  };

  if (!tournament) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Toast zawsze */}
        <div
          className={[
            "fixed z-[200] w-[340px] rounded-2xl border border-white/10 bg-slate-950/80 p-4 text-sm text-slate-100 shadow-xl backdrop-blur",
            toastPosClass(toastPos),
            toastRingClass(toastKind),
          ].join(" ")}
          role="status"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="leading-snug">
              {toastText?.trim()?.length ? toastText : "…"}
            </div>
            <div className="flex items-center gap-2">
              <select
                className="h-8 rounded-lg border border-white/10 bg-white/5 px-2 text-xs text-slate-100 outline-none"
                value={toastPos}
                onChange={(e) => setToastPos(e.target.value as ToastPos)}
                title="Pozycja komunikatów"
              >
                <option value="br">Prawy dół</option>
                <option value="bl">Lewy dół</option>
                <option value="tr">Prawy góra</option>
                <option value="tl">Lewy góra</option>
              </select>

              <button
                onClick={() => setToastText("")}
                className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-100 hover:bg-white/10"
                aria-label="Wyczyść komunikat"
                title="Wyczyść komunikat"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-slate-200">Ładowanie…</div>
      </div>
    );
  }

  const startMax = tournament.end_date ?? undefined;
  const endMin = tournament.start_date ?? undefined;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Toast zawsze widoczny */}
      <div
        className={[
          "fixed z-[200] w-[360px] rounded-2xl border border-white/10 bg-slate-950/80 p-4 text-sm text-slate-100 shadow-xl backdrop-blur",
          toastPosClass(toastPos),
          toastRingClass(toastKind),
        ].join(" ")}
        role="status"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="leading-snug">
            {toastText?.trim()?.length ? toastText : "Brak komunikatów"}
          </div>

          <div className="flex items-center gap-2">
            <select
              className="h-8 rounded-lg border border-white/10 bg-white/5 px-2 text-xs text-slate-100 outline-none"
              value={toastPos}
              onChange={(e) => setToastPos(e.target.value as ToastPos)}
              title="Pozycja komunikatów"
            >
              <option value="br">Prawy dół</option>
              <option value="bl">Lewy dół</option>
              <option value="tr">Prawy góra</option>
              <option value="tl">Lewy góra</option>
            </select>

            <button
              onClick={() => setToastText("")}
              className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-100 hover:bg-white/10"
              aria-label="Wyczyść komunikat"
              title="Wyczyść komunikat"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Header */}
      <div className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-100">Harmonogram i lokalizacja</h1>
            <p className="mt-1 text-sm text-slate-300">
              Zmiany zapisują się automatycznie (debounce) oraz po wyjściu z pola.
            </p>
          </div>

          <label className="inline-flex select-none items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200">
            <input
              type="checkbox"
              className="h-4 w-4 accent-slate-200"
              checked={showBye}
              onChange={(e) => setShowBye(e.target.checked)}
            />
            Pokaż mecze techniczne (BYE)
          </label>
        </div>
      </div>

      {/* Card: dane ogólne */}
      <section className="rounded-2xl border border-white/10 bg-white/5 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Dane ogólne turnieju</h2>
            <p className="mt-1 text-sm text-slate-300">Zakres dat oraz domyślna lokalizacja (opcjonalnie).</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => saveTournament().catch((e: any) => pushToast("error", e?.message || "Błąd zapisu."))}
              disabled={savingTournament}
              className="h-9 rounded-xl bg-slate-100 px-3 text-sm font-semibold text-slate-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-70"
            >
              {savingTournament ? "Zapisywanie…" : "Zapisz dane"}
            </button>

            <button
              type="button"
              onClick={() =>
                saveTournament({ start_date: null, end_date: null, location: null }).catch((e: any) =>
                  pushToast("error", e?.message || "Błąd zapisu.")
                )
              }
              disabled={savingTournament}
              className="h-9 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-slate-100 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-70"
              title="Wyczyść datę rozpoczęcia, datę zakończenia i lokalizację"
            >
              Wyczyść
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:max-w-xl sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm text-slate-300">Data rozpoczęcia</label>
            <input
              className={inputBase}
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
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-slate-300">Data zakończenia</label>
            <input
              className={inputBase}
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
            />
          </div>

          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm text-slate-300">Lokalizacja (domyślna)</label>
            <input
              className={inputBase}
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
              placeholder="np. Hala sportowa, boisko, adres…"
            />
          </div>
        </div>
      </section>

      {/* Lista meczów */}
      <div className="mt-6 space-y-6">
        {stages.map((s) => {
          const header = stageHeaderTitle(s.stageType, s.stageOrder, s.allMatches);

          return (
            <section key={s.stageId} className="rounded-2xl border border-white/10 bg-white/5 p-5 sm:p-6">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-base font-semibold text-slate-100">{header}</h3>
                <div className="text-xs text-slate-400">
                  {s.stageType === "GROUP" ? "Faza grupowa" : s.stageType === "LEAGUE" ? "Liga" : "Puchar"}
                </div>
              </div>

              {s.stageType === "GROUP" ? (
                <div className="space-y-6">
                  {groupMatchesByGroup(s.matches).map(([groupName, groupMatches], idx) => (
                    <div key={groupName} className="rounded-2xl border border-white/10 bg-black/10 p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-slate-200">{displayGroupName(groupName, idx)}</h4>
                      </div>

                      <div className="space-y-4">
                        {groupMatchesByRound(groupMatches).map(([round, roundMatches]) => (
                          <div key={round}>
                            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                              Kolejka {round}
                            </div>
                            {roundMatches.map((m) => renderMatchRow(m))}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : s.stageType === "LEAGUE" ? (
                <div className="space-y-5">
                  {groupMatchesByRound(s.matches).map(([round, roundMatches]) => (
                    <div key={round} className="rounded-2xl border border-white/10 bg-black/10 p-4">
                      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Kolejka {round}
                      </div>
                      {roundMatches.map((m) => renderMatchRow(m))}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                  {s.matches.map((m) => renderMatchRow(m))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
