// frontend/src/components/MatchRow.tsx

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../api";
import ConfirmIncidentDeleteModal from "./ConfirmIncidentDeleteModal";
import ConfirmScoreSyncModal from "./ConfirmScoreSyncModal";
import MatchLivePanel from "./MatchLivePanel";
import type { MatchDTO, MatchStatus, TennisSetDTO, TournamentDTO } from "../types/results";

type ToastKind = "saved" | "success" | "error" | "info";

type Props = {
  tournamentId: string; // z useParams
  tournament: TournamentDTO;
  match: MatchDTO;

  // Rodzic trzyma fetch + układ stron. Row może poprosić o odświeżenie listy.
  onReload: () => Promise<void> | void;

  // Opcjonalnie: toast w rodzicu (jeśli podasz) – w przeciwnym razie row użyje alert().
  onToast?: (text: string, kind?: ToastKind) => void;
};

type MatchDraft = Partial<
  Pick<
    MatchDTO,
    | "home_score"
    | "away_score"
    | "tennis_sets"
    | "went_to_extra_time"
    | "home_extra_time_score"
    | "away_extra_time_score"
    | "decided_by_penalties"
    | "home_penalty_score"
    | "away_penalty_score"
  >
>;

type ConfirmScoreSyncOp = "SAVE" | "FINISH";

type ConfirmScoreSyncState = {
  op: ConfirmScoreSyncOp;
  message: string;
  code?: string;
  deleteCount: number;
  deleteIds: number[];
};

type ConfirmIncidentDeleteState = {
  matchId: number;
  incidentId: number;
  incidentType?: string;
  teamLabel?: string;
  minute?: number | null;
  playerLabel?: string | null;
};

function lower(s: string | null | undefined) {
  return (s ?? "").toLowerCase();
}

function isTennis(t: TournamentDTO | null) {
  return lower(t?.discipline) === "tennis";
}

function isHandball(t: TournamentDTO | null) {
  return lower(t?.discipline) === "handball";
}

function scoreToInputValue(score: number | null | undefined): string {
  if (score == null) return "0";
  return String(score);
}

function inputValueToScore(v: string): number {
  const s = v.trim();
  if (s === "") return 0;
  if (!/^\d+$/.test(s)) return 0;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function teamLabel(s: string | null | undefined): string {
  const v = (s ?? "").trim();
  return v ? v : "—";
}

function comparableResult(m: MatchDraft) {
  return {
    home_score: m.home_score ?? 0,
    away_score: m.away_score ?? 0,
    tennis_sets: m.tennis_sets ?? null,
    went_to_extra_time: !!m.went_to_extra_time,
    home_extra_time_score: m.home_extra_time_score ?? null,
    away_extra_time_score: m.away_extra_time_score ?? null,
    decided_by_penalties: !!m.decided_by_penalties,
    home_penalty_score: m.home_penalty_score ?? null,
    away_penalty_score: m.away_penalty_score ?? null,
  };
}

function sameComparableDraft(a: MatchDraft, b: MatchDraft): boolean {
  return JSON.stringify(comparableResult(a)) === JSON.stringify(comparableResult(b));
}

function draftFromMatch(m: MatchDTO): MatchDraft {
  return {
    home_score: m.home_score ?? 0,
    away_score: m.away_score ?? 0,
    tennis_sets: Array.isArray(m.tennis_sets) ? m.tennis_sets : null,
    went_to_extra_time: !!m.went_to_extra_time,
    home_extra_time_score: m.home_extra_time_score ?? null,
    away_extra_time_score: m.away_extra_time_score ?? null,
    decided_by_penalties: !!m.decided_by_penalties,
    home_penalty_score: m.home_penalty_score ?? null,
    away_penalty_score: m.away_penalty_score ?? null,
  };
}

function uiStatusLabelFromBackend(status: MatchStatus | string) {
  if (status === "FINISHED") return "Zakończony";
  if (status === "IN_PROGRESS" || status === "RUNNING") return "W trakcie";
  return "Zaplanowany";
}

async function parseApiError(res: Response): Promise<{ message: string; code?: string; data?: any }> {
  const fallback = res.statusText || "Błąd.";
  try {
    const data = await res.json().catch(() => null);
    const message = String(data?.detail || data?.message || data?.error || fallback);
    const code = typeof data?.code === "string" ? data.code : undefined;
    return { message, code, data };
  } catch {
    return { message: fallback };
  }
}

function normalizeTennisSet(s: any): TennisSetDTO {
  return {
    home_games: Math.max(0, Number(s?.home_games ?? 0) || 0),
    away_games: Math.max(0, Number(s?.away_games ?? 0) || 0),
    home_tiebreak: s?.home_tiebreak == null ? null : Math.max(0, Number(s.home_tiebreak) || 0),
    away_tiebreak: s?.away_tiebreak == null ? null : Math.max(0, Number(s.away_tiebreak) || 0),
  };
}

function tennisSetsWon(sets: TennisSetDTO[]): { home: number; away: number } {
  let home = 0;
  let away = 0;
  for (const s of sets) {
    if (Number(s.home_games) > Number(s.away_games)) home += 1;
    else if (Number(s.away_games) > Number(s.home_games)) away += 1;
  }
  return { home, away };
}

function bgForStatus(status: MatchStatus): { background: string; border: string } {
  if (status === "IN_PROGRESS" || status === "RUNNING") {
    return { background: "rgba(255, 193, 7, 0.14)", border: "1px solid rgba(255, 193, 7, 0.40)" };
  }
  if (status === "FINISHED") {
    return { background: "rgba(52, 152, 219, 0.14)", border: "1px solid rgba(52, 152, 219, 0.40)" };
  }
  return { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" };
}

export default function MatchRow(props: Props) {
  const { tournamentId, tournament, match, onReload, onToast } = props;

  const toast = useCallback(
    (text: string, kind: ToastKind = "info") => {
      if (onToast) return onToast(text, kind);
      // fallback (żeby nie zgubić informacji w UI, jeśli rodzic nie podaje toasta)
      if (kind === "error") window.alert(text);
    },
    [onToast]
  );

  const [draft, setDraft] = useState<MatchDraft>(() => draftFromMatch(match));
  const openLiveKey = useMemo(() => `results:match:${match.id}:openLive`, [match.id]);
  const [openLive, setOpenLive] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(openLiveKey) === "1";
    } catch {
      return false;
    }
  });
  const [busy, setBusy] = useState(false);
  const [edited, setEdited] = useState(false);
  const [editFinished, setEditFinished] = useState(false);

  // potwierdzenie synchronizacji: "szybki wynik" -> LIVE (usunięcie GOAL)
  const [confirmScoreSync, setConfirmScoreSync] = useState<ConfirmScoreSyncState | null>(null);

  // potwierdzenie usunięcia incydentu w LIVE
  const [confirmIncidentDelete, setConfirmIncidentDelete] = useState<ConfirmIncidentDeleteState | null>(null);
  const incidentDeleteProceedRef = useRef<(() => void) | null>(null);

  const scoreSyncPrefKey = useMemo(() => `tournament:${tournamentId}:prefs:skipScoreSyncConfirm`, [tournamentId]);

  const readLocalBool = (key: string) => {
    try {
      return window.localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  };
  const writeLocalBool = (key: string, v: boolean) => {
    try {
      window.localStorage.setItem(key, v ? "1" : "0");
    } catch {
      // ignore
    }
  };

  const [skipScoreSyncConfirm, setSkipScoreSyncConfirm] = useState<boolean>(() => readLocalBool(scoreSyncPrefKey));
  // Potwierdzenie usuwania incydentu ma pokazywać się zawsze (bez trybu "nie pytaj więcej").

  useEffect(() => {
    writeLocalBool(scoreSyncPrefKey, skipScoreSyncConfirm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoreSyncPrefKey, skipScoreSyncConfirm]);


  useEffect(() => {
    try {
      window.localStorage.setItem(openLiveKey, openLive ? "1" : "0");
    } catch {
      // ignore
    }
  }, [openLiveKey, openLive]);

  // (celowo brak zapisu do localStorage)

  // Synchronizuj draft z zewnętrznym stanem meczu, o ile user nie ma lokalnych zmian.
  const originalDraft = useMemo(() => draftFromMatch(match), [match]);
  const isDirty = useMemo(() => !sameComparableDraft(draft, originalDraft), [draft, originalDraft]);

  useEffect(() => {
    if (!isDirty) {
      setDraft(originalDraft);
      setEdited(false);
      // nie zamykamy LIVE automatycznie
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.id, match.status, match.home_score, match.away_score, JSON.stringify(match.tennis_sets), match.went_to_extra_time, match.decided_by_penalties]);

  const lockByFinished = match.status === "FINISHED" && !editFinished;
  const canEditResult = !busy && !lockByFinished;

  const statusStyle = useMemo(() => bgForStatus(match.status), [match.status]);

  const homeName = teamLabel(match.home_team_name);
  const awayName = teamLabel(match.away_team_name);

  const tn = isTennis(tournament);
  const hb = isHandball(tournament);

  const updateMatchScore = useCallback(
    async (opts?: { force?: boolean }) => {
      const forceQ = opts?.force ? "?force=1" : "";
      let payload: any;

      if (tn) {
        const sets = Array.isArray(draft.tennis_sets) ? draft.tennis_sets.map(normalizeTennisSet) : [];
        const won = tennisSetsWon(sets);
        payload = {
          tennis_sets: sets,
          home_score: won.home,
          away_score: won.away,
          went_to_extra_time: false,
          home_extra_time_score: null,
          away_extra_time_score: null,
          decided_by_penalties: false,
          home_penalty_score: null,
          away_penalty_score: null,
        };
      } else {
        payload = {
          home_score: draft.home_score ?? 0,
          away_score: draft.away_score ?? 0,
          went_to_extra_time: !!draft.went_to_extra_time,
          home_extra_time_score: draft.went_to_extra_time ? (draft.home_extra_time_score ?? 0) : null,
          away_extra_time_score: draft.went_to_extra_time ? (draft.away_extra_time_score ?? 0) : null,
          decided_by_penalties: !!draft.decided_by_penalties,
          home_penalty_score: draft.decided_by_penalties ? (draft.home_penalty_score ?? 0) : null,
          away_penalty_score: draft.decided_by_penalties ? (draft.away_penalty_score ?? 0) : null,
        };
      }

      const res = await apiFetch(`/api/matches/${match.id}/result/${forceQ}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await parseApiError(res);
        const code = err.code;
        if (res.status === 409 && code === "SCORE_SYNC_CONFIRM_REQUIRED") {
          const delCount = Number(err.data?.delete_count || 0) || 0;
          const delIds = Array.isArray(err.data?.delete_ids) ? err.data.delete_ids.map((x: any) => Number(x)).filter((n: any) => Number.isFinite(n)) : [];
          setConfirmScoreSync({
            op: "SAVE",
            message: err.message,
            code,
            deleteCount: delCount,
            deleteIds: delIds,
          });
          throw Object.assign(new Error("SCORE_SYNC_CONFIRM_REQUIRED"), { __syncConfirm__: true });
        }
        throw new Error(err.message);
      }
    },
    [draft, match.id, tn]
  );

  const finishMatch = useCallback(async () => {
    const res = await apiFetch(`/api/matches/${match.id}/finish/`, { method: "POST" });
    if (!res.ok) {
      const err = await parseApiError(res);
      throw new Error(err.message);
    }
  }, [match.id]);

  const continueMatch = useCallback(async () => {
    const res = await apiFetch(`/api/matches/${match.id}/continue/`, { method: "POST" });
    if (!res.ok) {
      const err = await parseApiError(res);
      throw new Error(err.message);
    }
  }, [match.id]);

  const startMatch = useCallback(async () => {
    const res = await apiFetch(`/api/matches/${match.id}/clock/start/`, { method: "POST" });
    if (!res.ok) {
      const err = await parseApiError(res);
      throw new Error(err.message);
    }
  }, [match.id]);

  const setScheduled = useCallback(async () => {
    const res = await apiFetch(`/api/matches/${match.id}/set-scheduled/`, { method: "POST" });
    if (!res.ok) {
      const err = await parseApiError(res);
      throw new Error(err.message);
    }
  }, [match.id]);

  const doReload = useCallback(async () => {
    try {
      await onReload();
    } catch {
      // ignore
    }
  }, [onReload]);

  const onSaveClick = useCallback(async () => {
    if (!isDirty) {
      toast("Brak zmian do zapisania.", "info");
      return;
    }

    setBusy(true);
    try {
      await updateMatchScore();
      await doReload();
      setEdited(true);
      toast("Zapisano.", "saved");
    } catch (e: any) {
      // 409 handled by modal
      if (!String(e?.message || "").includes("SCORE_SYNC_CONFIRM_REQUIRED")) {
        toast(e?.message ?? "Błąd.", "error");
      }
    } finally {
      setBusy(false);
    }
  }, [doReload, isDirty, toast, updateMatchScore]);

  const onDynamicStatusButton = useCallback(async () => {
    setBusy(true);
    try {
      if (match.status === "SCHEDULED") {
        await startMatch();
        await doReload();
        toast("Mecz rozpoczęty.", "success");
        return;
      }

      if (match.status === "IN_PROGRESS" || match.status === "RUNNING") {
        // przed finishem zawsze zapisujemy wynik
        try {
          await updateMatchScore();
        } catch (e: any) {
          // 409 → modal
          throw e;
        }
        await finishMatch();
        await doReload();
        toast("Mecz zakończony.", "success");
        return;
      }

      if (match.status === "FINISHED") {
        await continueMatch();
        await doReload();
        toast("Mecz wznowiony.", "success");
        return;
      }
    } catch (e: any) {
      if (!String(e?.message || "").includes("SCORE_SYNC_CONFIRM_REQUIRED")) {
        toast(e?.message ?? "Błąd.", "error");
      }
    } finally {
      setBusy(false);
    }
  }, [continueMatch, doReload, finishMatch, match.status, startMatch, toast, updateMatchScore]);

  const dynamicLabel = useMemo(() => {
    if (match.status === "SCHEDULED") return "Rozpocznij mecz";
    if (match.status === "IN_PROGRESS" || match.status === "RUNNING") return "Zakończ mecz";
    if (match.status === "FINISHED") return "Wznów mecz";
    return "Akcja";
  }, [match.status]);

  const canAttemptSetScheduled = useMemo(() => {
    const h = Number(draft.home_score ?? 0) || 0;
    const a = Number(draft.away_score ?? 0) || 0;
    if (h !== 0 || a !== 0) return false;

    // jeżeli user ma ustawione dogrywka/kary/tenis, to nie pozwalamy „cofnąć” statusu
    if (draft.went_to_extra_time) return false;
    if (draft.decided_by_penalties) return false;
    if ((Number(draft.home_extra_time_score ?? 0) || 0) !== 0) return false;
    if ((Number(draft.away_extra_time_score ?? 0) || 0) !== 0) return false;
    if ((Number(draft.home_penalty_score ?? 0) || 0) !== 0) return false;
    if ((Number(draft.away_penalty_score ?? 0) || 0) !== 0) return false;
    if (Array.isArray(draft.tennis_sets) && draft.tennis_sets.length > 0) return false;

    return true;
  }, [draft]);

  const onSetScheduledClick = useCallback(async () => {
    if (match.status === "SCHEDULED") {
      toast("Mecz jest już zaplanowany.", "info");
      return;
    }

    if (!canAttemptSetScheduled) {
      toast("Możesz ustawić mecz jako zaplanowany tylko przy wyniku 0:0 (bez dogrywki/karnych/setów) i braku incydentów.", "error");
      return;
    }

    setBusy(true);
    try {
      // warunek „brak incydentów” weryfikujemy przed akcją (żeby użytkownik dostał natychmiastowy komunikat)
      const incRes = await apiFetch(`/api/matches/${match.id}/incidents/`, { method: "GET" });
      if (incRes.ok) {
        const list = await incRes.json().catch(() => []);
        if (Array.isArray(list) && list.length > 0) {
          toast("Nie można ustawić jako zaplanowany: mecz ma już zarejestrowane incydenty. Usuń incydenty i spróbuj ponownie.", "error");
          return;
        }
      }

      setEditFinished(false);
      await setScheduled();
      await doReload();
      toast("Status ustawiony: Zaplanowany.", "success");
    } catch (e: any) {
      toast(e?.message ?? "Błąd.", "error");
    } finally {
      setBusy(false);
    }
  }, [canAttemptSetScheduled, doReload, match.id, match.status, setScheduled, toast]);

  // ----- LIVE: delete confirm integration
  const onRequestConfirmIncidentDelete = useCallback(
    (req: any, proceed: () => void) => {
      incidentDeleteProceedRef.current = proceed;
      setConfirmIncidentDelete({
        matchId: Number(req?.matchId ?? match.id) || match.id,
        incidentId: Number(req?.incidentId ?? 0) || 0,
        incidentType: typeof req?.incidentType === "string" ? req.incidentType : undefined,
        teamLabel: typeof req?.teamLabel === "string" ? req.teamLabel : undefined,
        minute: req?.minute == null ? null : Number(req.minute),
        playerLabel: typeof req?.playerLabel === "string" ? req.playerLabel : null,
      });
    },
    [match.id]
  );

  // ----- SCORE SYNC modal actions
  const forceSync = useCallback(
    async (op: ConfirmScoreSyncOp, deleteCount: number, deleteIds: number[]) => {
      setBusy(true);
      try {
        await updateMatchScore({ force: true });
        if (op === "FINISH") {
          await finishMatch();
        }
        await doReload();
        setConfirmScoreSync(null);
        setEdited(true);
        toast(op === "FINISH" ? "Mecz zakończony." : "Zapisano.", op === "FINISH" ? "success" : "saved");
      } catch (e: any) {
        toast(e?.message ?? "Błąd.", "error");
      } finally {
        setBusy(false);
      }
    },
    [doReload, finishMatch, toast, updateMatchScore]
  );

  const goalScope = draft.went_to_extra_time ? "EXTRA_TIME" : "REGULAR";

  return (
    <div
      style={{
        marginBottom: "1.15rem",
        borderRadius: 12,
        padding: "0.95rem 1rem",
        ...statusStyle,
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "1rem" }}>
        <div style={{ fontWeight: 800, color: "#eee" }}>
          {homeName} <span style={{ opacity: 0.7, fontWeight: 600 }}>vs</span> {awayName}
        </div>
        <div style={{ opacity: 0.8, fontSize: "0.9em" }}>{uiStatusLabelFromBackend(match.status)}</div>
      </div>

      {/* Quick result row */}
      <div style={{ display: "flex", gap: "0.8rem", alignItems: "center", flexWrap: "wrap", marginTop: "0.65rem" }}>
        <input
          type="number"
          min={0}
          value={scoreToInputValue(draft.home_score ?? 0)}
          disabled={!canEditResult || tn}
          onChange={(e) => setDraft((d) => ({ ...d, home_score: inputValueToScore(e.target.value) }))}
          style={{ width: 72, textAlign: "center", padding: "0.35rem" }}
        />
        <span style={{ fontWeight: 900 }}>:</span>
        <input
          type="number"
          min={0}
          value={scoreToInputValue(draft.away_score ?? 0)}
          disabled={!canEditResult || tn}
          onChange={(e) => setDraft((d) => ({ ...d, away_score: inputValueToScore(e.target.value) }))}
          style={{ width: 72, textAlign: "center", padding: "0.35rem" }}
        />

        <button
          type="button"
          onClick={() => setOpenLive((v) => !v)}
          style={{
            padding: "0.45rem 0.75rem",
            borderRadius: 8,
            border: "1px solid rgba(46, 204, 113, 0.45)",
            background: "rgba(46, 204, 113, 0.14)",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          {openLive ? "Ukryj LIVE (zegar + incydenty)" : "Pokaż LIVE (zegar + incydenty)"}
        </button>

        <button
          type="button"
          onClick={onDynamicStatusButton}
          disabled={busy}
          style={{
            padding: "0.45rem 0.75rem",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.18)",
            background: "rgba(255,255,255,0.06)",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          {dynamicLabel}
        </button>

        {match.status !== "SCHEDULED" ? (

        <button
          type="button"
          onClick={onSetScheduledClick}
          disabled={busy || !canAttemptSetScheduled}
          title={
            canAttemptSetScheduled
              ? "Ustawia status meczu na „Zaplanowany” oraz resetuje zegar. Działa tylko, gdy wynik jest 0:0 oraz nie ma żadnych incydentów."
              : "Dostępne tylko przy wyniku 0:0 (bez dogrywki/karnych/setów). Dodatkowo mecz musi nie mieć żadnych incydentów."
          }
          style={{
            padding: "0.45rem 0.75rem",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.18)",
            background: "rgba(255,255,255,0.06)",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          Ustaw jako zaplanowany
        </button>
        ) : null}


        <button
          type="button"
          onClick={onSaveClick}
          disabled={busy || !isDirty || lockByFinished}
          style={{
            padding: "0.45rem 0.75rem",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.18)",
            background: edited ? "rgba(52, 152, 219, 0.18)" : "rgba(255,255,255,0.06)",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          {match.status === "FINISHED" ? (editFinished ? "Zapisz zmiany" : "Zapisz wynik") : "Zapisz wynik"}
        </button>

        {match.status === "FINISHED" && !editFinished ? (
          <button
            type="button"
            onClick={() => setEditFinished(true)}
            disabled={busy}
            style={{
              padding: "0.45rem 0.75rem",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.18)",
              background: "rgba(255,255,255,0.06)",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Wprowadź zmiany
          </button>
        ) : null}

        {match.status === "FINISHED" && editFinished ? (
          <button
            type="button"
            onClick={() => setEditFinished(false)}
            disabled={busy}
            style={{
              padding: "0.45rem 0.75rem",
              borderRadius: 8,
              border: "1px solid rgba(231,76,60,0.35)",
              background: "rgba(231,76,60,0.12)",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Anuluj edycję
          </button>
        ) : null}
      </div>

      {/* Extra time / penalties (poza tenisem) */}
      {!tn && (
        <div style={{ marginTop: "0.75rem", display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", opacity: 0.9 }}>
            <input
              type="checkbox"
              checked={!!draft.went_to_extra_time}
              disabled={!canEditResult}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  went_to_extra_time: e.target.checked,
                  home_extra_time_score: e.target.checked ? (d.home_extra_time_score ?? 0) : null,
                  away_extra_time_score: e.target.checked ? (d.away_extra_time_score ?? 0) : null,
                }))
              }
            />
            Dogrywka
          </label>

          {draft.went_to_extra_time && (
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <span style={{ opacity: 0.75, fontSize: "0.9em" }}>Wynik dogrywki:</span>
              <input
                type="number"
                min={0}
                value={scoreToInputValue(draft.home_extra_time_score ?? 0)}
                disabled={!canEditResult}
                onChange={(e) => setDraft((d) => ({ ...d, home_extra_time_score: inputValueToScore(e.target.value) }))}
                style={{ width: 70, textAlign: "center", padding: "0.35rem" }}
              />
              <span style={{ fontWeight: "bold" }}>:</span>
              <input
                type="number"
                min={0}
                value={scoreToInputValue(draft.away_extra_time_score ?? 0)}
                disabled={!canEditResult}
                onChange={(e) => setDraft((d) => ({ ...d, away_extra_time_score: inputValueToScore(e.target.value) }))}
                style={{ width: 70, textAlign: "center", padding: "0.35rem" }}
              />
            </div>
          )}

          <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", opacity: 0.9 }}>
            <input
              type="checkbox"
              checked={!!draft.decided_by_penalties}
              disabled={!canEditResult || hb}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  decided_by_penalties: e.target.checked,
                  home_penalty_score: e.target.checked ? (d.home_penalty_score ?? 0) : null,
                  away_penalty_score: e.target.checked ? (d.away_penalty_score ?? 0) : null,
                }))
              }
            />
            Rozstrzygnięcie w rzutach karnych
          </label>

          {draft.decided_by_penalties && (
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <span style={{ opacity: 0.75, fontSize: "0.9em" }}>Karne:</span>
              <input
                type="number"
                min={0}
                value={scoreToInputValue(draft.home_penalty_score ?? 0)}
                disabled={!canEditResult}
                onChange={(e) => setDraft((d) => ({ ...d, home_penalty_score: inputValueToScore(e.target.value) }))}
                style={{ width: 70, textAlign: "center", padding: "0.35rem" }}
              />
              <span style={{ fontWeight: "bold" }}>:</span>
              <input
                type="number"
                min={0}
                value={scoreToInputValue(draft.away_penalty_score ?? 0)}
                disabled={!canEditResult}
                onChange={(e) => setDraft((d) => ({ ...d, away_penalty_score: inputValueToScore(e.target.value) }))}
                style={{ width: 70, textAlign: "center", padding: "0.35rem" }}
              />
            </div>
          )}
        </div>
      )}

      {/* Tenis: prosta edycja setów w gemach */}
      {tn && (
        <div style={{ marginTop: "0.9rem" }}>
          <div style={{ opacity: 0.85, fontSize: "0.9em" }}>
            Tenis: wpisz sety w gemach (np. 6:4, 7:6). Tie-break (liczba punktów) podaj tylko dla setu 7:6.
          </div>

          <div style={{ marginTop: "0.65rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {(Array.isArray(draft.tennis_sets) ? draft.tennis_sets : []).map((s, idx) => (
              <div key={idx} style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ width: 46, opacity: 0.75 }}>Set {idx + 1}</span>

                <input
                  type="number"
                  min={0}
                  value={scoreToInputValue(s.home_games)}
                  disabled={!canEditResult}
                  onChange={(e) => {
                    const v = inputValueToScore(e.target.value);
                    setDraft((d) => {
                      const sets = Array.isArray(d.tennis_sets) ? [...d.tennis_sets] : [];
                      const cur = normalizeTennisSet(sets[idx]);
                      sets[idx] = { ...cur, home_games: v };
                      return { ...d, tennis_sets: sets };
                    });
                  }}
                  style={{ width: 70, textAlign: "center", padding: "0.35rem" }}
                />
                <span style={{ fontWeight: 900 }}>:</span>
                <input
                  type="number"
                  min={0}
                  value={scoreToInputValue(s.away_games)}
                  disabled={!canEditResult}
                  onChange={(e) => {
                    const v = inputValueToScore(e.target.value);
                    setDraft((d) => {
                      const sets = Array.isArray(d.tennis_sets) ? [...d.tennis_sets] : [];
                      const cur = normalizeTennisSet(sets[idx]);
                      sets[idx] = { ...cur, away_games: v };
                      return { ...d, tennis_sets: sets };
                    });
                  }}
                  style={{ width: 70, textAlign: "center", padding: "0.35rem" }}
                />

                <span style={{ opacity: 0.6, marginLeft: 8 }}>TB:</span>
                <input
                  type="number"
                  min={0}
                  value={s.home_tiebreak == null ? "" : String(s.home_tiebreak)}
                  disabled={!canEditResult}
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    const v = raw === "" ? null : inputValueToScore(raw);
                    setDraft((d) => {
                      const sets = Array.isArray(d.tennis_sets) ? [...d.tennis_sets] : [];
                      const cur = normalizeTennisSet(sets[idx]);
                      sets[idx] = { ...cur, home_tiebreak: v };
                      return { ...d, tennis_sets: sets };
                    });
                  }}
                  style={{ width: 60, textAlign: "center", padding: "0.35rem" }}
                />
                <span style={{ fontWeight: 900 }}>:</span>
                <input
                  type="number"
                  min={0}
                  value={s.away_tiebreak == null ? "" : String(s.away_tiebreak)}
                  disabled={!canEditResult}
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    const v = raw === "" ? null : inputValueToScore(raw);
                    setDraft((d) => {
                      const sets = Array.isArray(d.tennis_sets) ? [...d.tennis_sets] : [];
                      const cur = normalizeTennisSet(sets[idx]);
                      sets[idx] = { ...cur, away_tiebreak: v };
                      return { ...d, tennis_sets: sets };
                    });
                  }}
                  style={{ width: 60, textAlign: "center", padding: "0.35rem" }}
                />

                <button
                  type="button"
                  disabled={!canEditResult}
                  onClick={() => {
                    setDraft((d) => {
                      const sets = Array.isArray(d.tennis_sets) ? [...d.tennis_sets] : [];
                      sets.splice(idx, 1);
                      return { ...d, tennis_sets: sets };
                    });
                  }}
                  style={{
                    marginLeft: 8,
                    padding: "0.25rem 0.55rem",
                    borderRadius: 8,
                    border: "1px solid rgba(231,76,60,0.35)",
                    background: "rgba(231,76,60,0.12)",
                    color: "#fff",
                    cursor: "pointer",
                  }}
                >
                  Usuń set
                </button>
              </div>
            ))}

            <div>
              <button
                type="button"
                disabled={!canEditResult}
                onClick={() => {
                  setDraft((d) => {
                    const sets = Array.isArray(d.tennis_sets) ? [...d.tennis_sets] : [];
                    sets.push({ home_games: 0, away_games: 0, home_tiebreak: null, away_tiebreak: null });
                    return { ...d, tennis_sets: sets };
                  });
                }}
                style={{
                  padding: "0.35rem 0.65rem",
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.18)",
                  background: "rgba(255,255,255,0.06)",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                Dodaj set
              </button>
            </div>
          </div>
        </div>
      )}

      {/* LIVE */}
      {openLive && (
        <div style={{ marginTop: "0.85rem", paddingTop: "0.85rem", borderTop: "1px solid rgba(255,255,255,0.10)" }}>
          <MatchLivePanel
            tournamentId={tournamentId}
            discipline={tournament.discipline}
            goalScope={goalScope as any}
            canEdit={!lockByFinished}
            onRequestConfirmIncidentDelete={onRequestConfirmIncidentDelete}
            scoreContext={{
              home: Number(draft.home_score ?? 0) || 0,
              away: Number(draft.away_score ?? 0) || 0,
              stageType: match.stage_type,
              wentToExtraTime: !!draft.went_to_extra_time,
            }}
            match={{
              id: match.id,
              status: match.status,
              homeTeamId: match.home_team_id,
              awayTeamId: match.away_team_id,
              homeTeamName: homeName,
              awayTeamName: awayName,
            }}
            onEnterExtraTime={() => {
              // natychmiast pokaż dogrywkę w karcie (bez odświeżania strony)
              setDraft((d) => ({
                ...d,
                went_to_extra_time: true,
                home_extra_time_score: d.home_extra_time_score ?? 0,
                away_extra_time_score: d.away_extra_time_score ?? 0,
              }));
              setEdited(true);
            }}
            onAfterRecompute={doReload}
          />
        </div>
      )}

      {/* SCORE SYNC confirm */}
      <ConfirmScoreSyncModal
        open={!!confirmScoreSync}
        title="Synchronizacja LIVE z wynikiem"
        message={confirmScoreSync?.message ?? ""}
        code={confirmScoreSync?.code}
        deleteCount={confirmScoreSync?.deleteCount ?? 0}
        deleteIds={confirmScoreSync?.deleteIds ?? []}
        autoForceInSession={skipScoreSyncConfirm}
        onToggleAutoForceInSession={setSkipScoreSyncConfirm}
        confirmLabel="Kontynuuj"
        cancelLabel="Anuluj"
        onConfirm={() => {
          const st = confirmScoreSync;
          if (!st) return;
          // jeśli konflikt pojawił się przy finiszu, włącz FINISH
          const op: ConfirmScoreSyncOp = st.op;
          forceSync(op, st.deleteCount, st.deleteIds);
        }}
        onCancel={() => setConfirmScoreSync(null)}
      />

      {/* INCIDENT DELETE confirm */}
      <ConfirmIncidentDeleteModal
        open={!!confirmIncidentDelete}
        incident={confirmIncidentDelete}
        onConfirm={() => {
          const proceed = incidentDeleteProceedRef.current;
          incidentDeleteProceedRef.current = null;
          setConfirmIncidentDelete(null);
          if (proceed) proceed();
        }}
        onCancel={() => {
          incidentDeleteProceedRef.current = null;
          setConfirmIncidentDelete(null);
        }}
      />
    </div>
  );
}
