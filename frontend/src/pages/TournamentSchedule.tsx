import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { Calendar, Clock, Eraser, MapPin } from "lucide-react";

import { apiFetch } from "../api";
import { useTournamentWs } from "../hooks/useTournamentWs";
import { cn } from "../lib/cn";

import { Card } from "../ui/Card";
import { Input } from "../ui/Input";
import { toast } from "../ui/Toast";

import AutosaveIndicator from "../components/AutosaveIndicator";
import { useAutosave } from "../hooks/useAutosave";

import {
  bucketForStatus,
  sectionCardClasses,
  TournamentMatchesScaffold,
  type MatchLikeBase,
  type MatchStatusBucket,
  type StageType,
} from "./_shared/TournamentMatchesScaffold";

// ===== Typy domenowe (harmonogram) =====

type TournamentScheduleDTO = {
  id: number;
  start_date: string | null;
  end_date: string | null;
  location: string | null;
  tournament_format?: string | null;
};

type MatchScheduleDTO = MatchLikeBase & {
  stage_type: StageType;

  round_number: number | null;

  scheduled_date: string | null;
  scheduled_time: string | null;
  location: string | null;
};

type MatchDraft = {
  scheduled_date: string | null;
  scheduled_time: string | null;
  location: string | null;
};

// ===== Walidacja i mapowania =====

function isIsoDateBetween(value: string, min: string | null, max: string | null) {
  if (!value) return { ok: true as const };
  if (min && value < min) return { ok: false as const, message: "Data meczu przed startem turnieju." };
  if (max && value > max) return { ok: false as const, message: "Data meczu po zakończeniu turnieju." };
  return { ok: true as const };
}

function validateTournamentDates(start_date: string | null, end_date: string | null) {
  if (!start_date || !end_date) return { ok: true as const };
  if (start_date > end_date) return { ok: false as const, message: "Start po zakończeniu." };
  return { ok: true as const };
}

function toDraft(m: MatchScheduleDTO): MatchDraft {
  return {
    scheduled_date: m.scheduled_date ?? null,
    scheduled_time: m.scheduled_time ?? null,
    location: m.location ?? null,
  };
}

function normalizeMatches(raw: any): MatchScheduleDTO[] {
  if (Array.isArray(raw)) return raw as MatchScheduleDTO[];
  if (Array.isArray(raw?.results)) return raw.results as MatchScheduleDTO[];
  return [];
}

// ===== Strona =====

export default function TournamentSchedule() {
  const { id } = useParams<{ id: string }>();
  const tournamentId = id ?? "";

  const [tournament, setTournament] = useState<TournamentScheduleDTO | null>(null);
  const [matches, setMatches] = useState<MatchScheduleDTO[]>([]);
  const [loading, setLoading] = useState(true);

  // ===== Autosave (synchronizacja zmian z backendem) =====

  const matchAutosave = useAutosave<MatchDraft>({
    onSave: async (matchId, data) => {
      const res = await apiFetch(`/api/matches/${matchId}/`, {
        method: "PATCH",
        toastOnError: false,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.detail || "Błąd zapisu meczu");
      }

      setMatches((prev) => prev.map((m) => (m.id === matchId ? { ...m, ...data } : m)));
    },
  });

  const tournamentAutosave = useAutosave<TournamentScheduleDTO>({
    onSave: async (_key, data) => {
      const datesCheck = validateTournamentDates(data.start_date, data.end_date);
      if (!datesCheck.ok) throw new Error(datesCheck.message);

      const res = await apiFetch(`/api/tournaments/${tournamentId}/meta/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_date: data.start_date,
          end_date: data.end_date,
          location: data.location,
        }),
      });

      if (!res.ok) throw new Error("Błąd zapisu danych turnieju");

      setTournament((prev) => (prev ? { ...prev, ...data } : prev));
    },
  });

  // ===== Pobieranie danych =====

  useEffect(() => {
    if (!tournamentId) return;

    let alive = true;

    const init = async () => {
      try {
        setLoading(true);

        const [tRes, mRes] = await Promise.all([
          apiFetch(`/api/tournaments/${tournamentId}/`),
          apiFetch(`/api/tournaments/${tournamentId}/matches/`),
        ]);

        if (!tRes.ok || !mRes.ok) throw new Error("Błąd ładowania danych.");

        const tData = (await tRes.json()) as TournamentScheduleDTO;
        const raw = await mRes.json();

        if (!alive) return;

        setTournament(tData);
        setMatches(normalizeMatches(raw));
      } catch {
        toast.error("Wystąpił błąd podczas ładowania.");
      } finally {
        if (alive) setLoading(false);
      }
    };

    void init();
    return () => {
      alive = false;
    };
  }, [tournamentId]);

  const reloadMatches = useCallback(async () => {
    if (!tournamentId) return;
    try {
      const res = await apiFetch(`/api/tournaments/${tournamentId}/matches/`);
      const raw = await res.json();
      setMatches(normalizeMatches(raw));
    } catch (e: any) {
      toast.error(e?.message || "Nie udało się odświeżyć meczów");
    }
  }, [tournamentId]);

  const reloadTimerRef = useRef<number | null>(null);

  const requestMatchesReload = useCallback(() => {
    if (reloadTimerRef.current) return;
    reloadTimerRef.current = window.setTimeout(() => {
      reloadTimerRef.current = null;
      void reloadMatches();
    }, 200);
  }, [reloadMatches]);

  useTournamentWs({
    tournamentId,
    enabled: Boolean(tournamentId),
    onEvent: ({ event }) => {
      const normalized = String(event).replaceAll(".", "_");

      if (normalized === "matches_changed") {
        requestMatchesReload();
      }
    },
  });

  const tournamentFormat = useMemo(
    () => String(tournament?.tournament_format ?? ""),
    [tournament?.tournament_format]
  );

  const currentMeta = (tournamentAutosave.drafts["meta"] ?? tournament) as TournamentScheduleDTO | null;
  const metaStatus = tournamentAutosave.statuses["meta"] ?? "idle";

  const fieldWrap =
    "relative flex min-w-0 items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 h-10";
  const fieldIcon = "h-4 w-4 text-slate-200/90 shrink-0";
  const fieldInput = cn(
    "h-10 w-full min-w-0 bg-transparent text-sm text-slate-100",
    "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/10"
  );

  // ===== Karta meta turnieju =====

  const tournamentMetaCard = tournament ? (
    <Card className="mb-6 w-full max-w-[1400px] p-5 sm:p-6">
      <div className="flex flex-wrap justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold text-white">Dane turnieju</span>
          <AutosaveIndicator status={metaStatus} />
        </div>

        <button
          type="button"
          onClick={() => {
            if (!currentMeta) return;
            void tournamentAutosave.forceSave("meta", {
              ...(currentMeta as TournamentScheduleDTO),
              start_date: null,
              end_date: null,
              location: null,
            });
          }}
          className="inline-flex items-center gap-2 px-2 py-2 text-xs font-medium text-slate-400 transition-colors hover:text-white disabled:opacity-60"
          title="Wyczyść dane turnieju"
          disabled={!currentMeta}
        >
          <Eraser className="h-4 w-4" />
          <span className="hidden sm:inline">Wyczyść</span>
        </button>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className={fieldWrap}>
          <Calendar className={fieldIcon} />
          <Input
            unstyled
            className={cn(fieldInput, "[color-scheme:dark]")}
            type="date"
            name="tournament_start_date"
            aria-label="Data rozpoczęcia turnieju"
            value={currentMeta?.start_date ?? ""}
            max={currentMeta?.end_date ?? undefined}
            onChange={(e) => {
              if (!currentMeta) return;
              tournamentAutosave.update("meta", {
                ...(currentMeta as TournamentScheduleDTO),
                start_date: e.target.value || null,
              });
            }}
            onBlur={() => {
              if (!currentMeta) return;
              void tournamentAutosave.forceSave("meta", currentMeta as TournamentScheduleDTO);
            }}
          />
        </div>

        <div className={fieldWrap}>
          <Calendar className={fieldIcon} />
          <Input
            unstyled
            className={cn(fieldInput, "[color-scheme:dark]")}
            type="date"
            name="tournament_end_date"
            aria-label="Data zakończenia turnieju"
            value={currentMeta?.end_date ?? ""}
            min={currentMeta?.start_date ?? undefined}
            onChange={(e) => {
              if (!currentMeta) return;
              tournamentAutosave.update("meta", {
                ...(currentMeta as TournamentScheduleDTO),
                end_date: e.target.value || null,
              });
            }}
            onBlur={() => {
              if (!currentMeta) return;
              void tournamentAutosave.forceSave("meta", currentMeta as TournamentScheduleDTO);
            }}
          />
        </div>

        <div className={fieldWrap}>
          <MapPin className={fieldIcon} />
          <Input
            unstyled
            className={fieldInput}
            name="tournament_location"
            aria-label="Lokalizacja turnieju"
            placeholder="Lokalizacja"
            value={currentMeta?.location ?? ""}
            onChange={(e) => {
              if (!currentMeta) return;
              tournamentAutosave.update("meta", {
                ...(currentMeta as TournamentScheduleDTO),
                location: e.target.value || null,
              });
            }}
            onBlur={() => {
              if (!currentMeta) return;
              void tournamentAutosave.forceSave("meta", currentMeta as TournamentScheduleDTO);
            }}
          />
        </div>
      </div>

      {tournamentAutosave.errors["meta"] ? (
        <div className="mt-3 text-xs text-rose-300">{tournamentAutosave.errors["meta"]}</div>
      ) : null}
    </Card>
  ) : null;

  // ===== Render karty meczu =====

  const cardShellForMatch = (bucket: MatchStatusBucket, isOutOfRange: boolean) => {
    const base = sectionCardClasses(bucket);

    if (isOutOfRange) {
      return { shell: cn(base.shell, "border-rose-400/25 bg-rose-500/[0.06]") };
    }

    return { shell: cn(base.shell) };
  };

  const stageTitle = (stageType: StageType, allMatchesForStage: MatchScheduleDTO[]) => {
    if (stageType === "LEAGUE") return "Liga - terminarz";
    if (stageType === "GROUP") return "Faza grupowa - terminarz";
    if (stageType === "THIRD_PLACE") return "Mecz o 3 miejsce";

    const matchesCount = allMatchesForStage.length;
    if (matchesCount === 1) return "Finał";
    if (matchesCount === 2) return "Półfinał";
    if (matchesCount === 4) return "Ćwierćfinał";
    return `1/${matchesCount * 2} Finału`;
  };

  const renderMatchRow = (m: MatchScheduleDTO) => {
    const draft = matchAutosave.drafts[m.id] ?? toDraft(m);
    const saveStatus = matchAutosave.statuses[m.id] ?? "idle";
    const error = matchAutosave.errors[m.id] ?? null;

    const dateCheck = draft.scheduled_date
      ? isIsoDateBetween(draft.scheduled_date, tournament?.start_date ?? null, tournament?.end_date ?? null)
      : { ok: true as const };

    const bucket = bucketForStatus(m.status);
    const shell = cardShellForMatch(bucket, !dateCheck.ok);

    const errId = `match-${m.id}-error`;
    const rangeId = `match-${m.id}-range`;

    return (
      <Card key={m.id} className={cn("p-5 sm:p-6 border", shell.shell)}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <span className="min-w-0 truncate">
                {m.home_team_name} <span className="font-normal text-slate-400">vs</span> {m.away_team_name}
              </span>
              <AutosaveIndicator status={saveStatus} error={error} />
            </div>

            {error ? (
              <div id={errId} className="mt-1 text-xs text-rose-300">
                {error}
              </div>
            ) : null}

            {!dateCheck.ok ? (
              <div id={rangeId} className="mt-1 text-xs text-rose-300">
                {dateCheck.message}
              </div>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => {
              void matchAutosave.forceSave(m.id, {
                scheduled_date: null,
                scheduled_time: null,
                location: null,
              });
            }}
            className="inline-flex items-center gap-2 px-2 py-2 text-xs font-medium text-slate-400 transition-colors hover:text-white"
            title="Wyczyść dane meczu"
          >
            <Eraser className="h-4 w-4" />
            <span className="hidden sm:inline">Wyczyść</span>
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className={fieldWrap}>
            <Calendar className={fieldIcon} />
            <Input
              unstyled
              className={cn(fieldInput, "[color-scheme:dark]")}
              type="date"
              name={`match_${m.id}_scheduled_date`}
              aria-label="Data meczu"
              aria-describedby={cn(error ? errId : "", !dateCheck.ok ? rangeId : "").trim() || undefined}
              value={draft.scheduled_date ?? ""}
              min={tournament?.start_date ?? undefined}
              max={tournament?.end_date ?? undefined}
              onChange={(e) => matchAutosave.update(m.id, { ...draft, scheduled_date: e.target.value || null })}
              onBlur={() => void matchAutosave.forceSave(m.id, draft)}
            />
          </div>

          <div className={fieldWrap}>
            <Clock className={fieldIcon} />
            <Input
              unstyled
              className={cn(fieldInput, "[color-scheme:dark]")}
              type="time"
              name={`match_${m.id}_scheduled_time`}
              aria-label="Godzina meczu"
              aria-describedby={error ? errId : undefined}
              value={draft.scheduled_time ?? ""}
              onChange={(e) => matchAutosave.update(m.id, { ...draft, scheduled_time: e.target.value || null })}
              onBlur={() => void matchAutosave.forceSave(m.id, draft)}
            />
          </div>

          <div className={fieldWrap}>
            <MapPin className={fieldIcon} />
            <Input
              unstyled
              className={fieldInput}
              name={`match_${m.id}_location`}
              aria-label="Miejsce meczu"
              aria-describedby={error ? errId : undefined}
              placeholder="Miejsce"
              value={draft.location ?? ""}
              onChange={(e) => matchAutosave.update(m.id, { ...draft, location: e.target.value || null })}
              onBlur={() => void matchAutosave.forceSave(m.id, draft)}
            />
          </div>
        </div>
      </Card>
    );
  };

  // ===== Widok =====

  if (!tournamentId) {
    return (
      <div className="w-full py-6">
        <Card className="p-6 text-slate-200">Brak ID turnieju.</Card>
      </div>
    );
  }

  if (!loading && !tournament) {
    return (
      <div className="w-full py-6">
        <Card className="p-6 text-slate-200">Nie znaleziono turnieju.</Card>
      </div>
    );
  }

  return (
    <TournamentMatchesScaffold
      tournamentId={tournamentId}
      tournamentFormat={tournamentFormat}
      title="Harmonogram i lokalizacja"
      description="Ustaw termin i lokalizację turnieju, a następnie doprecyzuj datę, godzinę i miejsce dla każdego meczu."
      loading={loading}
      matches={matches}
      headerSlot={tournamentMetaCard}
      storageScope="schedule"
      renderMatch={renderMatchRow}
      stageTitle={stageTitle}
    />
  );
}