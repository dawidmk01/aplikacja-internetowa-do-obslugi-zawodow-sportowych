// frontend/src/pages/TournamentResults.tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

import { Brackets, Calendar, Clock } from "lucide-react";

import { apiFetch } from "../api";

import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { toast } from "../ui/Toast";

import MatchRow from "../components/MatchRow";
import type { MatchDTO, TournamentDTO } from "../types/results";

import { isByeMatch, TournamentMatchesScaffold, formatDatePL, type MatchLikeBase } from "./_shared/TournamentMatchesScaffold";

type ToastKind = "saved" | "success" | "error" | "info";

type MatchLike = MatchDTO & MatchLikeBase;

export default function TournamentResults() {
  const { id } = useParams<{ id: string }>();

  const [tournament, setTournament] = useState<TournamentDTO | null>(null);
  const [matches, setMatches] = useState<MatchLike[]>([]);
  const [loading, setLoading] = useState(true);

  const pushToast = useCallback((message: string, kind: ToastKind = "info") => {
    if (kind === "success" || kind === "saved") {
      toast.success(message);
      return;
    }
    if (kind === "error") {
      toast.error(message);
      return;
    }
    toast.info(message);
  }, []);

  const reloadAll = useCallback(async () => {
    if (!id) return;

    try {
      setLoading(true);

      const [tRes, mRes] = await Promise.all([apiFetch(`/api/tournaments/${id}/`), apiFetch(`/api/tournaments/${id}/matches/`)]);

      if (!tRes.ok) throw new Error("Nie udało się pobrać danych turnieju.");
      if (!mRes.ok) throw new Error("Nie udało się pobrać meczów.");

      const tData = (await tRes.json()) as TournamentDTO;
      setTournament(tData);

      const raw = await mRes.json();
      const list = (Array.isArray(raw) ? raw : raw.results) as MatchLike[];
      setMatches(list);
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "Wystąpił błąd podczas ładowania.", "error");
    } finally {
      setLoading(false);
    }
  }, [id, pushToast]);

  useEffect(() => {
    if (!id) return;
    reloadAll();
  }, [id, reloadAll]);

  const tournamentFormat = useMemo(() => String((tournament as any)?.tournament_format ?? ""), [tournament]);

  const canManageTournament = useMemo(() => {
    const role = String((tournament as any)?.my_role ?? "");
    return role === "ORGANIZER" || role === "ASSISTANT";
  }, [tournament]);

  const hasGroupStage = useMemo(
    () => matches.some((m) => String((m as any).stage_type ?? "").toUpperCase() === "GROUP"),
    [matches]
  );

  const hasKnockoutStage = useMemo(
    () => matches.some((m) => String((m as any).stage_type ?? "").toUpperCase() === "KNOCKOUT"),
    [matches]
  );

  const groupsFinished = useMemo(() => {
    const groupMatches = matches.filter((m) => String((m as any).stage_type ?? "").toUpperCase() === "GROUP");
    const relevant = groupMatches.filter((m) => !isByeMatch(m));
    if (!relevant.length) return false;
    return relevant.every((m) => String(m.status ?? "") === "FINISHED");
  }, [matches]);

  const showAdvanceFromGroups = useMemo(() => {
    const fmt = String(tournamentFormat ?? "").toUpperCase();
    const isMixed = fmt === "MIXED";

    // UI jest defensywne: jeśli backend zwraca GROUP, a KO jeszcze nie istnieje, pokaż akcję.
    return canManageTournament && (isMixed || hasGroupStage) && !hasKnockoutStage;
  }, [canManageTournament, hasGroupStage, hasKnockoutStage, tournamentFormat]);

  const [advanceBusy, setAdvanceBusy] = useState(false);

  const onAdvanceFromGroups = useCallback(async () => {
    if (!id) return;

    setAdvanceBusy(true);
    try {
      const res = await apiFetch(`/api/tournaments/${id}/advance-from-groups/`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(String(data?.detail || "Nie udało się wygenerować następnego etapu."));
      }

      pushToast("Wygenerowano fazę pucharową.", "success");
      await reloadAll();
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "Wystąpił błąd podczas generowania etapu.", "error");
    } finally {
      setAdvanceBusy(false);
    }
  }, [id, pushToast, reloadAll]);

  const stageAdvanceCard = useMemo(() => {
    if (!showAdvanceFromGroups) return null;

    const disabled = advanceBusy || !groupsFinished;

    return (
      <Card className="relative mb-6 overflow-hidden p-5 sm:p-6">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-20 left-1/2 h-44 w-[28rem] -translate-x-1/2 rounded-full bg-indigo-500/15 blur-3xl" />
          <div className="absolute -bottom-20 left-1/2 h-44 w-[28rem] -translate-x-1/2 rounded-full bg-sky-500/10 blur-3xl" />
        </div>

        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-[240px]">
            <div className="flex items-center gap-2">
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
                <Brackets className="h-4 w-4 text-slate-200" />
              </div>
              <div>
                <div className="text-sm font-semibold text-white">Następny etap</div>
                <div className="mt-1 text-xs text-slate-400">
                  Faza pucharowa po grupach - generowanie na podstawie tabel.
                </div>
              </div>
            </div>

            {!groupsFinished ? (
              <div className="mt-3 text-xs text-amber-200">
                Aby wygenerować fazę pucharową, zakończ wszystkie mecze w fazie grupowej.
              </div>
            ) : null}
          </div>

          <Button
            variant="secondary"
            onClick={onAdvanceFromGroups}
            disabled={disabled}
            leftIcon={<Brackets className="h-4 w-4" />}
          >
            {advanceBusy ? "Generowanie..." : "Wygeneruj fazę pucharową"}
          </Button>
        </div>
      </Card>
    );
  }, [advanceBusy, groupsFinished, onAdvanceFromGroups, showAdvanceFromGroups]);

  const renderMatch = useCallback(
    (m: MatchLike) => {
      const d = (m as any).scheduled_date ?? null;
      const t = (m as any).scheduled_time ?? null;

      const dateLabel = d ? formatDatePL(String(d)) : null;
      const timeLabel = t ? String(t).slice(0, 5) : null;

      return (
        <div key={m.id} className="space-y-2">
          {dateLabel || timeLabel ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
              {dateLabel ? (
                <span className="inline-flex items-center gap-2">
                  <Calendar className="h-3.5 w-3.5" />
                  {dateLabel}
                </span>
              ) : null}
              {timeLabel ? (
                <span className="inline-flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5" />
                  {timeLabel}
                </span>
              ) : null}
            </div>
          ) : null}

          {/* MatchRow ma własną kartę - nie dokładamy drugiej */}
          <MatchRow
            tournamentId={String(id ?? "")}
            tournament={tournament as TournamentDTO}
            match={m as unknown as MatchDTO}
            onReload={reloadAll}
            onToast={(text, kind) => pushToast(text, (kind ?? "info") as ToastKind)}
          />
        </div>
      );
    },
    [id, pushToast, reloadAll, tournament]
  );

  if (!id) {
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
      tournamentId={id}
      tournamentFormat={tournamentFormat}
      title="Wyniki"
      description="Wprowadzaj wyniki meczów i kontroluj postęp rozgrywek."
      loading={loading}
      matches={matches}
      headerSlot={stageAdvanceCard}
      storageScope="results"
      renderMatch={renderMatch}
    />
  );
}

/*
Co zmieniono:
1) Usunięto z Wyników kartę "Dane turnieju" (start/koniec/lokalizacja) - te dane są edytowane w Harmonogramie.
2) Dodano generowanie następnego etapu dla formatu z fazą grupową -> puchar (POST /advance-from-groups/) z walidacją ukończenia grup.
3) Zachowano wspólny scaffold (filtry, podziały, zwijanie) identyczny jak w Harmonogramie.
*/