// frontend/src/components/MatchRow.tsx
// Komponent renderuje wiersz meczu z edycją wyniku, sterowaniem statusem i obsługą trybu custom.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Gauge, TimerReset } from "lucide-react";

import { apiFetch } from "../api";
import { cn } from "../lib/cn";
import type {
  MatchCustomResultDTO,
  MatchCustomResultWriteResponseDTO,
  MatchDTO,
  MatchStatus,
  TennisSetDTO,
  TournamentDTO,
  TournamentResultConfigDTO,
} from "../types/results";

import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Checkbox } from "../ui/Checkbox";
import { Input } from "../ui/Input";
import { toast } from "../ui/Toast";

import ConfirmIncidentDeleteModal from "./ConfirmIncidentDeleteModal";
import ConfirmScoreSyncModal from "./ConfirmScoreSyncModal";
import MatchLivePanel from "./MatchLivePanel";

type ToastKind = "saved" | "success" | "error" | "info";

type Props = {
  tournamentId: string;
  tournament: TournamentDTO;
  match: MatchDTO;

  onReload: () => Promise<void> | void;
  onToast?: (text: string, kind?: ToastKind) => void;
};

type WrestlingFields = {
  wrestling_result_method?: string | null;
  winner_id?: number | null;
  home_classification_points?: number | null;
  away_classification_points?: number | null;
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
> & {
  wrestling_result_method?: string | null;
  winner_id?: number | null;
};

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

type MatchPermissions = {
  results_edit?: boolean;
  live_edit?: boolean;
  finish_match?: boolean;
  start_match?: boolean;
  set_scheduled?: boolean;
};

type CustomResultDraft = {
  team_id: number;
  numeric_value: string;
  time_ms: string;
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

function isBasketball(t: TournamentDTO | null) {
  return lower(t?.discipline) === "basketball";
}

function isWrestling(t: TournamentDTO | null) {
  return lower(t?.discipline) === "wrestling";
}

function usesCustomResults(t: TournamentDTO | null) {
  return String(t?.result_mode ?? "SCORE").toUpperCase() === "CUSTOM";
}

function getCompetitionModel(t: TournamentDTO | null) {
  return String(
    ((t as (TournamentDTO & { competition_model?: string }) | null)?.competition_model) ?? ""
  ).toUpperCase();
}

function getResultConfig(tournament: TournamentDTO | null): TournamentResultConfigDTO {
  return tournament?.result_config ?? {};
}

function isCustomTime(config: TournamentResultConfigDTO) {
  return String(config.value_kind ?? "").toUpperCase() === "TIME";
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
  return v ? v : "-";
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
    wrestling_result_method: (m.wrestling_result_method ?? "").trim().toUpperCase(),
    winner_id: m.winner_id ?? null,
  };
}

function sameComparableDraft(a: MatchDraft, b: MatchDraft): boolean {
  const aa = comparableResult(a);
  const bb = comparableResult(b);

  if (aa.home_score !== bb.home_score) return false;
  if (aa.away_score !== bb.away_score) return false;
  if (aa.went_to_extra_time !== bb.went_to_extra_time) return false;
  if (aa.home_extra_time_score !== bb.home_extra_time_score) return false;
  if (aa.away_extra_time_score !== bb.away_extra_time_score) return false;
  if (aa.decided_by_penalties !== bb.decided_by_penalties) return false;
  if (aa.home_penalty_score !== bb.home_penalty_score) return false;
  if (aa.away_penalty_score !== bb.away_penalty_score) return false;
  if (aa.wrestling_result_method !== bb.wrestling_result_method) return false;
  if (aa.winner_id !== bb.winner_id) return false;

  const aset = Array.isArray(aa.tennis_sets) ? aa.tennis_sets : null;
  const bset = Array.isArray(bb.tennis_sets) ? bb.tennis_sets : null;

  if (!aset && !bset) return true;
  if (!aset || !bset) return false;
  if (aset.length !== bset.length) return false;

  for (let i = 0; i < aset.length; i++) {
    const x = aset[i];
    const y = bset[i];
    if (x.home_games !== y.home_games) return false;
    if (x.away_games !== y.away_games) return false;
    if ((x.home_tiebreak ?? null) !== (y.home_tiebreak ?? null)) return false;
    if ((x.away_tiebreak ?? null) !== (y.away_tiebreak ?? null)) return false;
  }

  return true;
}

function normalizeTennisSet(s: TennisSetDTO | null | undefined): TennisSetDTO {
  const home_games = Number(s?.home_games ?? 0) || 0;
  const away_games = Number(s?.away_games ?? 0) || 0;
  const home_tiebreak = s?.home_tiebreak == null ? null : Number(s.home_tiebreak) || 0;
  const away_tiebreak = s?.away_tiebreak == null ? null : Number(s.away_tiebreak) || 0;

  return { home_games, away_games, home_tiebreak, away_tiebreak };
}

function uiStatusLabelFromBackend(status: MatchStatus | string): string {
  if (status === "FINISHED") return "Zakończony";
  if (status === "IN_PROGRESS" || status === "RUNNING") return "W trakcie";
  if (status === "CANCELLED") return "Anulowany";
  return "Zaplanowany";
}

function getTone(status: MatchStatus | string) {
  if (status === "IN_PROGRESS" || status === "RUNNING") {
    return {
      card: "border-emerald-400/20 bg-emerald-500/[0.05]",
      badge: "border-emerald-400/30 bg-emerald-500/[0.10] text-emerald-100",
      dot: "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.5)]",
    };
  }

  if (status === "FINISHED") {
    return {
      card: "border-sky-400/15 bg-sky-500/[0.04]",
      badge: "border-sky-400/25 bg-sky-500/[0.08] text-sky-100",
      dot: "bg-sky-300 shadow-[0_0_10px_rgba(125,211,252,0.35)]",
    };
  }

  if (status === "CANCELLED") {
    return {
      card: "border-rose-400/15 bg-rose-500/[0.04]",
      badge: "border-rose-400/25 bg-rose-500/[0.08] text-rose-100",
      dot: "bg-rose-400 shadow-[0_0_10px_rgba(244,63,94,0.35)]",
    };
  }

  return {
    card: "border-white/10 bg-white/[0.03]",
    badge: "border-white/15 bg-white/[0.06] text-slate-100",
    dot: "bg-white/60",
  };
}

function initialCustomDraft(match: MatchDTO): Record<number, CustomResultDraft> {
  const map: Record<number, CustomResultDraft> = {};

  const teamIds = [match.home_team_id, match.away_team_id].filter(
    (value): value is number => typeof value === "number"
  );

  for (const teamId of teamIds) {
    const existing = (match.custom_results ?? []).find((item) => item.team_id === teamId);
    map[teamId] = {
      team_id: teamId,
      numeric_value: existing?.numeric_value != null ? String(existing.numeric_value) : "",
      time_ms: existing?.time_ms != null ? String(existing.time_ms) : "",
    };
  }

  return map;
}

function sameCustomDraft(
  a: Record<number, CustomResultDraft>,
  b: Record<number, CustomResultDraft>
) {
  const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).sort();
  for (const key of keys) {
    const aa = a[Number(key)];
    const bb = b[Number(key)];
    if (!aa && !bb) continue;
    if (!aa || !bb) return false;
    if (aa.team_id !== bb.team_id) return false;
    if ((aa.numeric_value ?? "") !== (bb.numeric_value ?? "")) return false;
    if ((aa.time_ms ?? "") !== (bb.time_ms ?? "")) return false;
  }
  return true;
}

function getCustomResultForTeam(
  match: MatchDTO,
  teamId: number | undefined
): MatchCustomResultDTO | null {
  if (!teamId) return null;
  return (match.custom_results ?? []).find((item) => item.team_id === teamId) ?? null;
}

function getCustomValueSummary(
  result: MatchCustomResultDTO | null,
  unitLabel: string
): string {
  if (!result) return "-";
  if (result.display_value) {
    return unitLabel && !result.display_value.includes(unitLabel)
      ? `${result.display_value}${result.value_kind === "NUMBER" ? ` ${unitLabel}` : ""}`
      : result.display_value;
  }
  if (result.numeric_value != null) {
    return unitLabel ? `${result.numeric_value} ${unitLabel}` : String(result.numeric_value);
  }
  if (result.time_ms != null) {
    return `${result.time_ms} ms`;
  }
  return "-";
}

export default function MatchRow({ tournamentId, tournament, match, onReload, onToast }: Props) {
  const tn = isTennis(tournament);
  const hb = isHandball(tournament);
  const bb = isBasketball(tournament);
  const wt = isWrestling(tournament);
  const matchExt = match as MatchDTO & WrestlingFields;
  const customMode = usesCustomResults(tournament);
  const competitionModel = getCompetitionModel(tournament);
  const massStartCustomMode = customMode && competitionModel === "MASS_START";
  const supportsLiveMode = !massStartCustomMode;
  const resultConfig = getResultConfig(tournament);
  const customTimeMode = isCustomTime(resultConfig);

  const homeName = teamLabel(match.home_team_name);
  const awayName = teamLabel(match.away_team_name);

  const tone = getTone(match.status);

  const matchPermissions = (match as MatchDTO & { permissions?: MatchPermissions }).permissions;

  const canEditResult = Boolean(matchPermissions?.results_edit ?? true);
  const canAttemptFinish = Boolean(matchPermissions?.finish_match ?? true);
  const canAttemptStart = Boolean(matchPermissions?.start_match ?? true);
  const canAttemptSetScheduled = Boolean(matchPermissions?.set_scheduled ?? true);

  const [draft, setDraft] = useState<MatchDraft>(() => ({
    home_score: match.home_score ?? 0,
    away_score: match.away_score ?? 0,
    tennis_sets: match.tennis_sets ?? null,
    went_to_extra_time: !!match.went_to_extra_time,
    home_extra_time_score: match.home_extra_time_score ?? null,
    away_extra_time_score: match.away_extra_time_score ?? null,
    decided_by_penalties: !!match.decided_by_penalties,
    home_penalty_score: match.home_penalty_score ?? null,
    away_penalty_score: match.away_penalty_score ?? null,
    wrestling_result_method: matchExt.wrestling_result_method ?? "",
    winner_id: matchExt.winner_id ?? null,
  }));

  const originalDraft = useMemo<MatchDraft>(
    () => ({
      home_score: match.home_score ?? 0,
      away_score: match.away_score ?? 0,
      tennis_sets: match.tennis_sets ?? null,
      went_to_extra_time: !!match.went_to_extra_time,
      home_extra_time_score: match.home_extra_time_score ?? null,
      away_extra_time_score: match.away_extra_time_score ?? null,
      decided_by_penalties: !!match.decided_by_penalties,
      home_penalty_score: match.home_penalty_score ?? null,
      away_penalty_score: match.away_penalty_score ?? null,
      wrestling_result_method: matchExt.wrestling_result_method ?? "",
      winner_id: matchExt.winner_id ?? null,
    }),
    [
      match.away_extra_time_score,
      match.away_penalty_score,
      match.away_score,
      match.decided_by_penalties,
      match.home_extra_time_score,
      match.home_penalty_score,
      match.home_score,
      match.tennis_sets,
      match.went_to_extra_time,
      matchExt.wrestling_result_method,
      matchExt.winner_id,
    ]
  );

  const [customDraft, setCustomDraft] = useState<Record<number, CustomResultDraft>>(
    () => initialCustomDraft(match)
  );

  const originalCustomDraft = useMemo(
    () => initialCustomDraft(match),
    [match.custom_results, match.away_team_id, match.home_team_id]
  );

  const isDirty = useMemo(() => !sameComparableDraft(draft, originalDraft), [draft, originalDraft]);
  const isCustomDirty = useMemo(
    () => !sameCustomDraft(customDraft, originalCustomDraft),
    [customDraft, originalCustomDraft]
  );

  const [busy, setBusy] = useState(false);
  const [edited, setEdited] = useState(false);

  const [openLive, setOpenLive] = useState(false);
  const [editFinished, setEditFinished] = useState(false);

  const [skipScoreSyncConfirm, setSkipScoreSyncConfirm] = useState(false);
  const [confirmScoreSync, setConfirmScoreSync] = useState<ConfirmScoreSyncState | null>(null);
  const [confirmIncidentDelete, setConfirmIncidentDelete] = useState<ConfirmIncidentDeleteState | null>(null);

  const incidentDeleteProceedRef = useRef<null | (() => void)>(null);

  useEffect(() => {
    if (!isDirty) {
      setDraft(originalDraft);
      setEdited(false);
    }
  }, [isDirty, originalDraft]);

  useEffect(() => {
    if (!isCustomDirty) {
      setCustomDraft(originalCustomDraft);
    }
  }, [isCustomDirty, originalCustomDraft]);

  useEffect(() => {
    if (!bb) return;

    setDraft((current) => {
      const regularDraw = Number(current.home_score ?? 0) === Number(current.away_score ?? 0);
      const next: MatchDraft = {
        ...current,
        decided_by_penalties: false,
        home_penalty_score: null,
        away_penalty_score: null,
      };

      if (!regularDraw) {
        next.went_to_extra_time = false;
        next.home_extra_time_score = null;
        next.away_extra_time_score = null;
      }

      return sameComparableDraft(current, next) ? current : next;
    });
  }, [bb, draft.home_score, draft.away_score]);

  useEffect(() => {
    if (!wt) return;

    setDraft((current) => {
      const next: MatchDraft = {
        ...current,
        tennis_sets: null,
        went_to_extra_time: false,
        home_extra_time_score: null,
        away_extra_time_score: null,
        decided_by_penalties: false,
        home_penalty_score: null,
        away_penalty_score: null,
      };

      return sameComparableDraft(current, next) ? current : next;
    });
  }, [wt]);

  const pushToast = useCallback(
    (text: string, kind: ToastKind = "info") => {
      if (onToast) {
        onToast(text, kind);
        return;
      }

      if (kind === "error") toast.error(text);
      else if (kind === "success" || kind === "saved") toast.success(text);
      else toast.info(text);
    },
    [onToast]
  );

  const doReload = useCallback(async () => {
    try {
      await onReload();
    } catch {
      // Rodzic może mieć własną obsługę.
    }
  }, [onReload]);

  const updateMatchScore = useCallback(
    async ({ force, op }: { force?: boolean; op: ConfirmScoreSyncOp }) => {
      let payload: Record<string, unknown>;

      if (tn) {
        const sets = Array.isArray(draft.tennis_sets) ? draft.tennis_sets.map((item) => normalizeTennisSet(item)) : [];
        const home = sets.reduce((sum, item) => sum + (item.home_games > item.away_games ? 1 : 0), 0);
        const away = sets.reduce((sum, item) => sum + (item.away_games > item.home_games ? 1 : 0), 0);

        payload = {
          tennis_sets: sets,
          home_score: home,
          away_score: away,
          went_to_extra_time: false,
          home_extra_time_score: null,
          away_extra_time_score: null,
          decided_by_penalties: false,
          home_penalty_score: null,
          away_penalty_score: null,
        };
      } else if (wt) {
        payload = {
          home_score: Number(draft.home_score ?? 0) || 0,
          away_score: Number(draft.away_score ?? 0) || 0,
          went_to_extra_time: false,
          home_extra_time_score: null,
          away_extra_time_score: null,
          decided_by_penalties: false,
          home_penalty_score: null,
          away_penalty_score: null,
          wrestling_result_method: String(draft.wrestling_result_method ?? "").trim().toUpperCase(),
          winner_id: draft.winner_id ?? null,
        };
      } else {
        const regularHome = Number(draft.home_score ?? 0) || 0;
        const regularAway = Number(draft.away_score ?? 0) || 0;
        const regularDraw = regularHome === regularAway;
        const useExtraTime = bb ? regularDraw && !!draft.went_to_extra_time : !!draft.went_to_extra_time;
        const usePenalties = bb ? false : !!draft.decided_by_penalties;

        payload = {
          home_score: regularHome,
          away_score: regularAway,
          went_to_extra_time: useExtraTime,
          home_extra_time_score: useExtraTime ? Number(draft.home_extra_time_score ?? 0) || 0 : null,
          away_extra_time_score: useExtraTime ? Number(draft.away_extra_time_score ?? 0) || 0 : null,
          decided_by_penalties: usePenalties,
          home_penalty_score: usePenalties ? Number(draft.home_penalty_score ?? 0) || 0 : null,
          away_penalty_score: usePenalties ? Number(draft.away_penalty_score ?? 0) || 0 : null,
        };
      }

      const suffix = force ? "?force=1" : "";
      const res = await apiFetch(`/api/matches/${match.id}/result/${suffix}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        const message = data?.detail || data?.message || "Błąd zapisu.";
        const code = typeof data?.code === "string" ? data.code : undefined;

        if (res.status === 409 && code === "SCORE_SYNC_CONFIRM_REQUIRED") {
          setConfirmScoreSync({
            op,
            message,
            code,
            deleteCount: Number(data?.delete_count ?? 0) || 0,
            deleteIds: Array.isArray(data?.delete_ids)
              ? data.delete_ids.map((item: unknown) => Number(item)).filter((item: number) => Number.isFinite(item))
              : [],
          });
          return { confirmed: false };
        }

        throw new Error(message);
      }

      return { confirmed: true };
    },
    [bb, draft, match.id, tn, wt]
  );

  const saveSingleCustomResult = useCallback(
    async (teamId: number) => {
      const teamDraft = customDraft[teamId];
      if (!teamDraft) return;

      const payload = customTimeMode
        ? {
            team_id: teamId,
            time_ms: Number(teamDraft.time_ms.trim() || 0),
          }
        : {
            team_id: teamId,
            numeric_value: teamDraft.numeric_value.trim(),
          };

      const res = await apiFetch(`/api/matches/${match.id}/custom-result/`, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      const data = (await res.json().catch(() => null)) as MatchCustomResultWriteResponseDTO | null;

      if (!res.ok) {
        const message =
          (data as { detail?: string } | null)?.detail ||
          "Nie udało się zapisać wyniku niestandardowego.";
        throw new Error(message);
      }
    },
    [customDraft, customTimeMode, match.id]
  );

  const saveAllCustomResults = useCallback(async () => {
    const teamIds = [match.home_team_id, match.away_team_id].filter(
      (value): value is number => typeof value === "number"
    );

    for (const teamId of teamIds) {
      const draftForTeam = customDraft[teamId];
      if (!draftForTeam) continue;

      if (customTimeMode) {
        if (draftForTeam.time_ms.trim() === "") continue;
      } else {
        if (draftForTeam.numeric_value.trim() === "") continue;
      }

      await saveSingleCustomResult(teamId);
    }
  }, [customDraft, customTimeMode, match.away_team_id, match.home_team_id, saveSingleCustomResult]);

  const finishMatch = useCallback(async () => {
    const res = await apiFetch(`/api/matches/${match.id}/finish/`, { method: "POST" });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = data?.detail || data?.message || "Nie udało się zakończyć meczu.";
      throw new Error(msg);
    }
  }, [match.id]);

  const continueMatch = useCallback(async () => {
    const res = await apiFetch(`/api/matches/${match.id}/continue/`, { method: "POST" });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = data?.detail || data?.message || "Nie udało się wznowić meczu.";
      throw new Error(msg);
    }
  }, [match.id]);

  const startMatch = useCallback(async () => {
    const res = await apiFetch(`/api/matches/${match.id}/clock/start/`, { method: "POST" });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = data?.detail || data?.message || "Nie udało się rozpocząć meczu.";
      throw new Error(msg);
    }
  }, [match.id]);

  const setScheduled = useCallback(async () => {
    const res = await apiFetch(`/api/matches/${match.id}/set-scheduled/`, { method: "POST" });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = data?.detail || data?.message || "Nie udało się ustawić jako zaplanowany.";
      throw new Error(msg);
    }
  }, [match.id]);

  const onSaveClick = useCallback(async () => {
    if (customMode) {
      if (!isCustomDirty) {
        pushToast("Brak zmian do zapisania.", "info");
        return;
      }

      setBusy(true);
      try {
        await saveAllCustomResults();
        await doReload();
        setEdited(true);
        pushToast("Zapisano rezultaty.", "saved");
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Błąd.";
        pushToast(message, "error");
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!isDirty) {
      pushToast("Brak zmian do zapisania.", "info");
      return;
    }

    setBusy(true);
    try {
      const result = await updateMatchScore({ op: "SAVE" });
      if (result.confirmed) {
        await doReload();
        setEdited(true);
        pushToast("Zapisano.", "saved");
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Błąd.";
      pushToast(message, "error");
    } finally {
      setBusy(false);
    }
  }, [customMode, doReload, isCustomDirty, isDirty, pushToast, saveAllCustomResults, updateMatchScore]);

  const onFinishClick = useCallback(async () => {
    if (customMode) {
      setBusy(true);
      try {
        if (isCustomDirty) {
          await saveAllCustomResults();
        }
        await finishMatch();
        await doReload();
        setEdited(true);
        pushToast("Mecz zakończony.", "success");
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Błąd.";
        pushToast(message, "error");
      } finally {
        setBusy(false);
      }
      return;
    }

    setBusy(true);
    try {
      const result = await updateMatchScore({ op: "FINISH" });
      if (result.confirmed) {
        await finishMatch();
        await doReload();
        setEdited(true);
        pushToast("Mecz zakończony.", "success");
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Błąd.";
      pushToast(message, "error");
    } finally {
      setBusy(false);
    }
  }, [customMode, doReload, finishMatch, isCustomDirty, pushToast, saveAllCustomResults, updateMatchScore]);

  const onStartClick = useCallback(async () => {
    setBusy(true);
    try {
      await startMatch();
      await doReload();
      pushToast("Mecz rozpoczęty.", "success");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Błąd.";
      pushToast(message, "error");
    } finally {
      setBusy(false);
    }
  }, [doReload, pushToast, startMatch]);

  const onContinueClick = useCallback(async () => {
    setBusy(true);
    try {
      await continueMatch();
      await doReload();
      pushToast("Mecz wznowiony.", "success");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Błąd.";
      pushToast(message, "error");
    } finally {
      setBusy(false);
    }
  }, [continueMatch, doReload, pushToast]);

  const canAttemptSetScheduledHint = useMemo(() => {
    if (customMode) {
      return (match.custom_results ?? []).length === 0;
    }

    const draftComparable = comparableResult(draft);
    const noExtra = !draftComparable.went_to_extra_time;
    const noPen = !draftComparable.decided_by_penalties;
    const noTennis = !Array.isArray(draftComparable.tennis_sets) || draftComparable.tennis_sets.length === 0;
    const noWrestlingDecision =
      !String(draftComparable.wrestling_result_method ?? "").trim() && draftComparable.winner_id == null;

    const zeroScore =
      (draftComparable.home_score ?? 0) === 0 && (draftComparable.away_score ?? 0) === 0;
    return noExtra && noPen && noTennis && noWrestlingDecision && zeroScore;
  }, [customMode, draft, match.custom_results]);

  const canAttemptSetScheduledSafe = canAttemptSetScheduled && canAttemptSetScheduledHint;

  const onSetScheduledClick = useCallback(async () => {
    if (match.status === "SCHEDULED") {
      pushToast("Mecz jest już zaplanowany.", "info");
      return;
    }

    if (!canAttemptSetScheduledSafe) {
      pushToast(
        customMode
          ? "Możesz ustawić mecz jako zaplanowany tylko bez zapisanych rezultatów."
          : "Możesz ustawić mecz jako zaplanowany tylko przy wyniku 0:0 i bez dodatkowych rozstrzygnięć.",
        "error"
      );
      return;
    }

    setBusy(true);
    try {
      await setScheduled();
      await doReload();
      setEditFinished(false);
      pushToast("Status ustawiony na zaplanowany.", "success");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Błąd.";
      pushToast(message, "error");
    } finally {
      setBusy(false);
    }
  }, [canAttemptSetScheduledSafe, customMode, doReload, match.status, pushToast, setScheduled]);

  const onDynamicStatusButton = useCallback(async () => {
    if (match.status === "IN_PROGRESS" || match.status === "RUNNING") {
      if (!canAttemptFinish) return;
      await onFinishClick();
      return;
    }

    if (match.status === "SCHEDULED") {
      if (!canAttemptStart) return;
      await onStartClick();
      return;
    }

    if (match.status === "FINISHED" && !editFinished) {
      await onContinueClick();
      return;
    }

    if (match.status === "FINISHED" && editFinished) {
      await onSaveClick();
    }
  }, [
    canAttemptFinish,
    canAttemptStart,
    editFinished,
    match.status,
    onContinueClick,
    onFinishClick,
    onSaveClick,
    onStartClick,
  ]);

  const lockByFinished = match.status === "FINISHED" && !editFinished;

  const dynamicLabel = useMemo(() => {
    if (match.status === "SCHEDULED") return "Rozpocznij mecz";
    if (match.status === "IN_PROGRESS" || match.status === "RUNNING") return "Zakończ mecz";
    if (match.status === "FINISHED") return editFinished ? "Zapisz zmiany" : "Wznów mecz";
    return "Akcja";
  }, [editFinished, match.status]);

  const onRequestConfirmIncidentDelete = useCallback(
    (st: ConfirmIncidentDeleteState, proceed: () => void) => {
      incidentDeleteProceedRef.current = proceed;
      setConfirmIncidentDelete(st);
    },
    []
  );

  const forceSync = useCallback(
    async (op: ConfirmScoreSyncOp) => {
      setBusy(true);
      try {
        await updateMatchScore({ force: true, op });
        if (op === "FINISH") {
          await finishMatch();
        }
        await doReload();
        setConfirmScoreSync(null);
        setEdited(true);
        pushToast(op === "FINISH" ? "Mecz zakończony." : "Zapisano.", op === "FINISH" ? "success" : "saved");
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Błąd.";
        pushToast(message, "error");
      } finally {
        setBusy(false);
      }
    },
    [doReload, finishMatch, pushToast, updateMatchScore]
  );

  const basketballOvertimeAvailable = bb && Number(draft.home_score ?? 0) === Number(draft.away_score ?? 0);
  const goalScope = wt ? "REGULAR" : draft.went_to_extra_time ? "EXTRA_TIME" : "REGULAR";
  const wrestlingMethodLabel = String(draft.wrestling_result_method ?? "").trim().toUpperCase();
  const homeClassificationPoints = matchExt.home_classification_points ?? null;
  const awayClassificationPoints = matchExt.away_classification_points ?? null;

  const scoreInputClass = cn(
    "h-9 w-[72px] rounded-xl border border-white/10 bg-white/[0.04] px-2 text-center text-base font-semibold text-white placeholder:text-slate-500",
    "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/10",
    "disabled:opacity-60",
    "[color-scheme:dark]"
  );

  const miniScoreInputClass = cn(
    "h-8 w-[60px] rounded-lg border border-white/10 bg-white/[0.04] px-2 text-center text-sm font-semibold text-white placeholder:text-slate-500",
    "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/10",
    "disabled:opacity-60",
    "[color-scheme:dark]"
  );

  const customInputClass = cn(
    "h-9 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm font-semibold text-white placeholder:text-slate-500",
    "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/10",
    "disabled:opacity-60",
    "[color-scheme:dark]"
  );

  const saveVariant = customMode ? (isCustomDirty ? "primary" : "secondary") : isDirty ? "primary" : "secondary";

  const customUnitLabel = String(resultConfig.unit_label ?? resultConfig.unit ?? "").trim();
  const homeCustomResult = getCustomResultForTeam(match, match.home_team_id);
  const awayCustomResult = getCustomResultForTeam(match, match.away_team_id);

  return (
    <Card className={cn("mb-4 border p-3 sm:p-4", tone.card)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 truncate text-sm font-semibold text-white sm:text-base">
          {homeName} <span className="font-semibold text-white/70">vs</span> {awayName}
        </div>

        <div className={cn("inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs", tone.badge)}>
          <span className={cn("h-2 w-2 rounded-full", tone.dot)} />
          {uiStatusLabelFromBackend(match.status)}
        </div>
      </div>

      {!customMode ? (
        <div className="mt-3 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Input
              unstyled
              type="number"
              min={0}
              inputMode="numeric"
              name={`match-${match.id}-home_score`}
              aria-label={`Wynik gospodarzy: ${homeName}`}
              value={scoreToInputValue(draft.home_score ?? 0)}
              disabled={!canEditResult || tn}
              onChange={(e) => setDraft((d) => ({ ...d, home_score: inputValueToScore(e.target.value) }))}
              className={scoreInputClass}
            />
            <span className="px-0.5 text-lg font-extrabold text-white/80">:</span>
            <Input
              unstyled
              type="number"
              min={0}
              inputMode="numeric"
              name={`match-${match.id}-away_score`}
              aria-label={`Wynik gości: ${awayName}`}
              value={scoreToInputValue(draft.away_score ?? 0)}
              disabled={!canEditResult || tn}
              onChange={(e) => setDraft((d) => ({ ...d, away_score: inputValueToScore(e.target.value) }))}
              className={scoreInputClass}
            />
          </div>

          {wt ? (
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span>Zapasy - wynik techniczny.</span>
              {wrestlingMethodLabel ? <span>Metoda: {wrestlingMethodLabel}</span> : null}
              {homeClassificationPoints != null && awayClassificationPoints != null ? (
                <span>Punkty klasyfikacyjne: {homeClassificationPoints}:{awayClassificationPoints}</span>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            {supportsLiveMode ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setOpenLive((v) => !v)}
                className={cn(
                  "h-9 rounded-xl",
                  openLive
                    ? "border-emerald-400/25 bg-emerald-500/[0.12] hover:bg-emerald-500/[0.16]"
                    : "border-white/12 bg-white/[0.05] hover:bg-white/[0.08]"
                )}
              >
                <span className="sm:hidden">Na żywo</span>
                <span className="hidden sm:inline">
                  {openLive ? "Ukryj panel na żywo (zegar + incydenty)" : "Pokaż panel na żywo (zegar + incydenty)"}
                </span>
              </Button>
            ) : null}

            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onDynamicStatusButton}
              disabled={busy}
              className="h-9 rounded-xl"
            >
              {dynamicLabel}
            </Button>

            {match.status !== "SCHEDULED" ? (
              <Button
                type="button"
                onClick={onSetScheduledClick}
                disabled={busy || !canAttemptSetScheduledSafe}
                title={
                  canAttemptSetScheduledSafe
                    ? 'Ustawia status meczu na "Zaplanowany" oraz resetuje zegar. Działa tylko, gdy wynik jest 0:0 oraz nie ma żadnych incydentów.'
                    : "Dostępne tylko przy wyniku 0:0 (bez dogrywki, karnych, setów i rozstrzygnięcia walki). Dodatkowo mecz musi nie mieć żadnych incydentów."
                }
                variant="secondary"
                size="sm"
                className="h-9 rounded-xl"
              >
                <span className="sm:hidden">Zaplanowany</span>
                <span className="hidden sm:inline">Ustaw jako zaplanowany</span>
              </Button>
            ) : null}

            <Button
              type="button"
              onClick={onSaveClick}
              disabled={busy || !isDirty || lockByFinished}
              variant={saveVariant}
              size="sm"
              className={cn("h-9 rounded-xl", edited && !isDirty ? "opacity-95" : "")}
            >
              {match.status === "FINISHED" ? (editFinished ? "Zapisz zmiany" : "Zapisz wynik") : "Zapisz wynik"}
            </Button>

            {match.status === "FINISHED" && !editFinished ? (
              <Button
                type="button"
                onClick={() => setEditFinished(true)}
                disabled={busy}
                variant="secondary"
                size="sm"
                className="h-9 rounded-xl"
              >
                Wprowadź zmiany
              </Button>
            ) : null}

            {match.status === "FINISHED" && editFinished ? (
              <Button
                type="button"
                onClick={() => setEditFinished(false)}
                disabled={busy}
                variant="danger"
                size="sm"
                className="h-9 rounded-xl"
              >
                Anuluj edycję
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            {[
              {
                teamId: match.home_team_id,
                teamName: homeName,
                existing: homeCustomResult,
                icon: customTimeMode ? (
                  <TimerReset className="h-4 w-4 text-slate-200" />
                ) : (
                  <Gauge className="h-4 w-4 text-slate-200" />
                ),
              },
              {
                teamId: match.away_team_id,
                teamName: awayName,
                existing: awayCustomResult,
                icon: customTimeMode ? (
                  <TimerReset className="h-4 w-4 text-slate-200" />
                ) : (
                  <Gauge className="h-4 w-4 text-slate-200" />
                ),
              },
            ].map((item) => {
              if (!item.teamId) return null;

              const teamDraft = customDraft[item.teamId] ?? {
                team_id: item.teamId,
                numeric_value: "",
                time_ms: "",
              };

              return (
                <div
                  key={item.teamId}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] p-3"
                >
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {item.icon}
                        <div className="truncate text-sm font-semibold text-white">
                          {item.teamName}
                        </div>
                      </div>
                      <div className="mt-1 text-xs text-slate-400">
                        Aktualny wynik: {getCustomValueSummary(item.existing, customUnitLabel)}
                      </div>
                    </div>

                    {item.existing?.rank ? (
                      <div className="rounded-xl border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-slate-200">
                        Miejsce: {item.existing.rank}
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    {customTimeMode ? (
                      <Input
                        unstyled
                        type="number"
                        min={0}
                        inputMode="numeric"
                        name={`match-${match.id}-custom-time-${item.teamId}`}
                        aria-label={`Wynik czasowy: ${item.teamName}`}
                        value={teamDraft.time_ms}
                        disabled={!canEditResult || lockByFinished}
                        onChange={(e) =>
                          setCustomDraft((prev) => ({
                            ...prev,
                            [item.teamId!]: {
                              ...teamDraft,
                              time_ms: e.target.value,
                            },
                          }))
                        }
                        placeholder="np. 65432"
                        className={customInputClass}
                      />
                    ) : (
                      <Input
                        unstyled
                        type="text"
                        name={`match-${match.id}-custom-number-${item.teamId}`}
                        aria-label={`Wynik liczbowy: ${item.teamName}`}
                        value={teamDraft.numeric_value}
                        disabled={!canEditResult || lockByFinished}
                        onChange={(e) =>
                          setCustomDraft((prev) => ({
                            ...prev,
                            [item.teamId!]: {
                              ...teamDraft,
                              numeric_value: e.target.value,
                            },
                          }))
                        }
                        placeholder={
                          customUnitLabel ? `np. 125.5 ${customUnitLabel}` : "np. 125.5"
                        }
                        className={customInputClass}
                      />
                    )}

                    <div className="text-xs text-slate-400">
                      {customTimeMode
                        ? "Podaj wartość techniczną w milisekundach."
                        : `Podaj wynik liczbowy${customUnitLabel ? ` w jednostce ${customUnitLabel}` : ""}.`}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {supportsLiveMode ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setOpenLive((v) => !v)}
                className={cn(
                  "h-9 rounded-xl",
                  openLive
                    ? "border-emerald-400/25 bg-emerald-500/[0.12] hover:bg-emerald-500/[0.16]"
                    : "border-white/12 bg-white/[0.05] hover:bg-white/[0.08]"
                )}
              >
                <span className="sm:hidden">Na żywo</span>
                <span className="hidden sm:inline">
                  {openLive ? "Ukryj panel na żywo (zegar + incydenty)" : "Pokaż panel na żywo (zegar + incydenty)"}
                </span>
              </Button>
            ) : null}

            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onDynamicStatusButton}
              disabled={busy}
              className="h-9 rounded-xl"
            >
              {dynamicLabel}
            </Button>

            {match.status !== "SCHEDULED" ? (
              <Button
                type="button"
                onClick={onSetScheduledClick}
                disabled={busy || !canAttemptSetScheduledSafe}
                title={
                  canAttemptSetScheduledSafe
                    ? 'Ustawia status meczu na "Zaplanowany" oraz resetuje zegar.'
                    : "Dostępne tylko bez zapisanych rezultatów."
                }
                variant="secondary"
                size="sm"
                className="h-9 rounded-xl"
              >
                <span className="sm:hidden">Zaplanowany</span>
                <span className="hidden sm:inline">Ustaw jako zaplanowany</span>
              </Button>
            ) : null}

            <Button
              type="button"
              onClick={onSaveClick}
              disabled={busy || !isCustomDirty || lockByFinished}
              variant={saveVariant}
              size="sm"
              className="h-9 rounded-xl"
            >
              {match.status === "FINISHED" ? (editFinished ? "Zapisz zmiany" : "Zapisz rezultat") : "Zapisz rezultat"}
            </Button>

            {match.status === "FINISHED" && !editFinished ? (
              <Button
                type="button"
                onClick={() => setEditFinished(true)}
                disabled={busy}
                variant="secondary"
                size="sm"
                className="h-9 rounded-xl"
              >
                Wprowadź zmiany
              </Button>
            ) : null}

            {match.status === "FINISHED" && editFinished ? (
              <Button
                type="button"
                onClick={() => setEditFinished(false)}
                disabled={busy}
                variant="danger"
                size="sm"
                className="h-9 rounded-xl"
              >
                Anuluj edycję
              </Button>
            ) : null}
          </div>
        </div>
      )}

      {!customMode && !tn && !wt ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-200">
          <Checkbox
            checked={!!draft.went_to_extra_time}
            onCheckedChange={(checked) =>
              setDraft((d) => ({
                ...d,
                went_to_extra_time: checked,
                home_extra_time_score: checked ? (d.home_extra_time_score ?? 0) : null,
                away_extra_time_score: checked ? (d.away_extra_time_score ?? 0) : null,
              }))
            }
            disabled={!canEditResult || (bb && !basketballOvertimeAvailable)}
            label={bb ? "Dogrywka po remisie" : "Dogrywka"}
          />

          {draft.went_to_extra_time ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-400">Wynik dogrywki:</span>
              <Input
                unstyled
                type="number"
                min={0}
                inputMode="numeric"
                name={`match-${match.id}-home_extra_time_score`}
                aria-label="Wynik dogrywki - gospodarze"
                value={scoreToInputValue(draft.home_extra_time_score ?? 0)}
                disabled={!canEditResult}
                onChange={(e) => setDraft((d) => ({ ...d, home_extra_time_score: inputValueToScore(e.target.value) }))}
                className={miniScoreInputClass}
              />
              <span className="px-0.5 text-sm font-extrabold text-white/70">:</span>
              <Input
                unstyled
                type="number"
                min={0}
                inputMode="numeric"
                name={`match-${match.id}-away_extra_time_score`}
                aria-label="Wynik dogrywki - goście"
                value={scoreToInputValue(draft.away_extra_time_score ?? 0)}
                disabled={!canEditResult}
                onChange={(e) => setDraft((d) => ({ ...d, away_extra_time_score: inputValueToScore(e.target.value) }))}
                className={miniScoreInputClass}
              />
            </div>
          ) : null}

          {bb && !basketballOvertimeAvailable ? (
            <div className="text-xs text-slate-400">
              Dogrywka jest dostępna tylko przy remisie po czasie podstawowym.
            </div>
          ) : null}

          {bb ? (
            <div className="text-xs text-slate-400">
              Koszykówka nie obsługuje rzutów karnych. Przy remisie po czasie podstawowym wpisz punkty dogrywki.
            </div>
          ) : (
            <div
              className={cn("inline-flex", hb ? "opacity-60" : "")}
              title={hb ? "W piłce ręcznej rozstrzygnięcie zależy od konfiguracji turnieju." : undefined}
            >
              <Checkbox
                checked={!!draft.decided_by_penalties}
                onCheckedChange={(checked) =>
                  setDraft((d) => ({
                    ...d,
                    decided_by_penalties: checked,
                    home_penalty_score: checked ? (d.home_penalty_score ?? 0) : null,
                    away_penalty_score: checked ? (d.away_penalty_score ?? 0) : null,
                  }))
                }
                disabled={!canEditResult || hb}
                label="Rozstrzygnięcie w rzutach karnych"
              />
            </div>
          )}

          {!bb && draft.decided_by_penalties ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-400">Karne:</span>
              <Input
                unstyled
                type="number"
                min={0}
                inputMode="numeric"
                name={`match-${match.id}-home_penalty_score`}
                aria-label="Karne - gospodarze"
                value={scoreToInputValue(draft.home_penalty_score ?? 0)}
                disabled={!canEditResult}
                onChange={(e) => setDraft((d) => ({ ...d, home_penalty_score: inputValueToScore(e.target.value) }))}
                className={miniScoreInputClass}
              />
              <span className="px-0.5 text-sm font-extrabold text-white/70">:</span>
              <Input
                unstyled
                type="number"
                min={0}
                inputMode="numeric"
                name={`match-${match.id}-away_penalty_score`}
                aria-label="Karne - goście"
                value={scoreToInputValue(draft.away_penalty_score ?? 0)}
                disabled={!canEditResult}
                onChange={(e) => setDraft((d) => ({ ...d, away_penalty_score: inputValueToScore(e.target.value) }))}
                className={miniScoreInputClass}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {!customMode && wt ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-3 text-sm text-slate-200">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400">Metoda rozstrzygnięcia:</span>
            <Input
              unstyled
              type="text"
              name={`match-${match.id}-wrestling_result_method`}
              aria-label="Kod metody rozstrzygnięcia walki"
              value={String(draft.wrestling_result_method ?? "")}
              disabled={!canEditResult}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  wrestling_result_method: e.target.value.toUpperCase(),
                }))
              }
              className={cn(
                "h-8 w-[150px] rounded-lg border border-white/10 bg-white/[0.04] px-2 text-center text-sm font-semibold uppercase text-white placeholder:text-slate-500",
                "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/10",
                "disabled:opacity-60",
                "[color-scheme:dark]"
              )}
              placeholder="VPO / VSU / VFA"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400">Zwycięzca:</span>
            <Button
              type="button"
              variant={draft.winner_id === match.home_team_id ? "primary" : "secondary"}
              size="sm"
              disabled={!canEditResult}
              className="h-8 rounded-lg"
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  winner_id: d.winner_id === match.home_team_id ? null : match.home_team_id,
                }))
              }
            >
              {homeName}
            </Button>
            <Button
              type="button"
              variant={draft.winner_id === match.away_team_id ? "primary" : "secondary"}
              size="sm"
              disabled={!canEditResult}
              className="h-8 rounded-lg"
              onClick={() =>
                setDraft((d) => ({
                  ...d,
                  winner_id: d.winner_id === match.away_team_id ? null : match.away_team_id,
                }))
              }
            >
              {awayName}
            </Button>
          </div>

          <div className="text-xs text-slate-400">
            Zapasy nie obsługują dogrywki ani rzutów karnych. Przy remisie technicznym wskaż zwycięzcę i metodę rozstrzygnięcia.
          </div>
        </div>
      ) : null}

      {!customMode && tn ? (
        <div className="mt-3">
          <div className="text-xs text-slate-400">
            Tenis: wpisz sety w gemach (np. 6:4, 7:6). Tie-break (liczba punktów) podaj tylko dla setu 7:6.
          </div>

          <div className="mt-2 flex flex-col gap-2">
            {(Array.isArray(draft.tennis_sets) ? draft.tennis_sets : []).map((s, idx) => (
              <div
                key={idx}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-2"
              >
                <span className="w-[56px] text-xs font-semibold text-slate-300">Set {idx + 1}</span>

                <Input
                  unstyled
                  type="number"
                  min={0}
                  inputMode="numeric"
                  name={`match-${match.id}-tennis-set-${idx}-home_games`}
                  aria-label={`Set ${idx + 1} - gemy gospodarzy`}
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
                  className={miniScoreInputClass}
                />
                <span className="px-0.5 text-sm font-extrabold text-white/70">:</span>
                <Input
                  unstyled
                  type="number"
                  min={0}
                  inputMode="numeric"
                  name={`match-${match.id}-tennis-set-${idx}-away_games`}
                  aria-label={`Set ${idx + 1} - gemy gości`}
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
                  className={miniScoreInputClass}
                />

                <span className="ml-1 text-xs text-slate-400">TB</span>
                <Input
                  unstyled
                  type="number"
                  min={0}
                  inputMode="numeric"
                  name={`match-${match.id}-tennis-set-${idx}-home_tiebreak`}
                  aria-label={`Set ${idx + 1} - tie-break gospodarzy`}
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
                  className={cn(miniScoreInputClass, "w-[54px]")}
                />
                <span className="px-0.5 text-sm font-extrabold text-white/70">:</span>
                <Input
                  unstyled
                  type="number"
                  min={0}
                  inputMode="numeric"
                  name={`match-${match.id}-tennis-set-${idx}-away_tiebreak`}
                  aria-label={`Set ${idx + 1} - tie-break gości`}
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
                  className={cn(miniScoreInputClass, "w-[54px]")}
                />

                <Button
                  type="button"
                  disabled={!canEditResult}
                  onClick={() => {
                    setDraft((d) => {
                      const sets = Array.isArray(d.tennis_sets) ? [...d.tennis_sets] : [];
                      sets.splice(idx, 1);
                      return { ...d, tennis_sets: sets };
                    });
                  }}
                  variant="danger"
                  size="sm"
                  className="h-8 rounded-lg px-2 text-xs"
                >
                  Usuń set
                </Button>
              </div>
            ))}

            <div>
              <Button
                type="button"
                disabled={!canEditResult}
                onClick={() => {
                  setDraft((d) => {
                    const sets = Array.isArray(d.tennis_sets) ? [...d.tennis_sets] : [];
                    sets.push({ home_games: 0, away_games: 0, home_tiebreak: null, away_tiebreak: null });
                    return { ...d, tennis_sets: sets };
                  });
                }}
                variant="secondary"
                size="sm"
                className="h-8 rounded-lg px-2 text-xs"
              >
                Dodaj set
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {supportsLiveMode && openLive ? (
        <div className="mt-3 border-t border-white/10 pt-3">
          <MatchLivePanel
            tournamentId={tournamentId}
            discipline={tournament.discipline}
            goalScope={goalScope as never}
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
      ) : null}

      <ConfirmScoreSyncModal
        open={!!confirmScoreSync}
        title="Synchronizacja panelu na żywo z wynikiem"
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
          forceSync(st.op);
        }}
        onCancel={() => setConfirmScoreSync(null)}
      />

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
    </Card>
  );
}