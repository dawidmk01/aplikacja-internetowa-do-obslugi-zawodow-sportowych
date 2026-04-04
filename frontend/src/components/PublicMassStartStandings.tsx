// frontend/src/components/PublicMassStartStandings.tsx
// Komponent renderuje publiczny, tylko do odczytu, ranking etapów MASS_START z wyborem etapu i nowoczesnym widokiem tabeli.

import { useEffect, useMemo, useState } from "react";
import { Gauge, Sparkles, TimerReset, Users } from "lucide-react";

import { apiFetch } from "../api";
import { cn } from "../lib/cn";

import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { InlineAlert } from "../ui/InlineAlert";

type CustomResultValueKind = "NUMBER" | "TIME" | "PLACE";
type CustomTimeFormat = "HH:MM:SS" | "MM:SS" | "MM:SS.hh" | "SS.hh";
type TournamentResultConfigDTO = {
  value_kind?: CustomResultValueKind;
  measured_value_kind?: CustomResultValueKind;
  mass_start_value_kind?: CustomResultValueKind;
  unit?: string;
  unit_label?: string;
  decimal_places?: number | null;
  time_format?: CustomTimeFormat | null;
  better_result?: "HIGHER" | "LOWER";
  allow_ties?: boolean;
};

type MassStartRoundResultDTO = {
  round_number: number;
  result_id: number | null;
  numeric_value?: string | null;
  time_ms?: number | null;
  place_value?: number | null;
  display_value?: string | null;
  rank?: number | null;
  is_active: boolean;
};

type MassStartEntryDTO = {
  team_id: number;
  team_name: string;
  group_id: number | null;
  rank?: number | null;
  aggregate_value?: string | number | null;
  aggregate_display?: string | null;
  rounds: MassStartRoundResultDTO[];
};

type MassStartGroupDTO = {
  group_id: number;
  group_name: string;
  entries: MassStartEntryDTO[];
};

type MassStartStageDTO = {
  stage_id: number;
  stage_order: number;
  stage_name: string;
  stage_status?: string;
  groups_count: number;
  participants_count?: number | null;
  advance_count?: number | null;
  rounds_count: number;
  aggregation_mode: string;
  groups: MassStartGroupDTO[];
};

type TournamentMassStartResultsResponseDTO = {
  tournament_id: number;
  competition_model: string;
  value_kind?: CustomResultValueKind;
  unit_label?: string;
  allow_ties?: boolean;
  stages: MassStartStageDTO[];
};

type Props = {
  tournamentId: number;
  accessCode?: string;
  refreshKey?: number;
  resultConfig?: TournamentResultConfigDTO;
};

function getResolvedValueKind(resultConfig?: TournamentResultConfigDTO): CustomResultValueKind {
  const direct = String(resultConfig?.value_kind ?? "").toUpperCase();
  if (direct === "NUMBER" || direct === "TIME" || direct === "PLACE") {
    return direct as CustomResultValueKind;
  }

  const massStart = String(resultConfig?.mass_start_value_kind ?? "").toUpperCase();
  if (massStart === "NUMBER" || massStart === "TIME" || massStart === "PLACE") {
    return massStart as CustomResultValueKind;
  }

  return "NUMBER";
}

function stageSummary(stage: MassStartStageDTO) {
  return [
    `grupy: ${stage.groups_count}`,
    `uczestnicy: ${stage.participants_count ?? "-"}`,
    `awans: ${stage.advance_count ?? "-"}`,
    `rundy: ${stage.rounds_count}`,
  ].join(" • ");
}

function stageStatusLabel(stage: MassStartStageDTO) {
  const status = String(stage.stage_status ?? "").toUpperCase();
  if (status === "CLOSED") return "Zamknięty";
  if (status === "PLANNED") return "Zaplanowany";
  return "Otwarty";
}

function stageTone(stage: MassStartStageDTO) {
  const status = String(stage.stage_status ?? "").toUpperCase();

  if (status === "OPEN") {
    return {
      card: "border-emerald-400/20 bg-emerald-500/[0.05]",
      badge: "border-emerald-400/30 bg-emerald-500/[0.10] text-emerald-100",
      dot: "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.5)]",
      glow: "from-emerald-500/10 via-transparent to-transparent",
    };
  }

  if (status === "CLOSED") {
    return {
      card: "border-sky-400/15 bg-sky-500/[0.04]",
      badge: "border-sky-400/25 bg-sky-500/[0.08] text-sky-100",
      dot: "bg-sky-300 shadow-[0_0_10px_rgba(125,211,252,0.35)]",
      glow: "from-sky-500/10 via-transparent to-transparent",
    };
  }

  return {
    card: "border-white/10 bg-white/[0.03]",
    badge: "border-white/15 bg-white/[0.06] text-slate-100",
    dot: "bg-white/60",
    glow: "from-white/5 via-transparent to-transparent",
  };
}

function entrySort(left: MassStartEntryDTO, right: MassStartEntryDTO) {
  const leftRank = typeof left.rank === "number" ? left.rank : Number.MAX_SAFE_INTEGER;
  const rightRank = typeof right.rank === "number" ? right.rank : Number.MAX_SAFE_INTEGER;
  if (leftRank !== rightRank) return leftRank - rightRank;
  return left.team_name.localeCompare(right.team_name, "pl");
}

function roundValueLabel(round: MassStartRoundResultDTO) {
  const display = String(round.display_value ?? "").trim();
  if (display) return display;

  if (round.numeric_value != null) return String(round.numeric_value);
  if (round.time_ms != null) return `${round.time_ms} ms`;
  if (round.place_value != null) return String(round.place_value);

  return "-";
}

function groupName(group: MassStartGroupDTO, index: number) {
  const raw = String(group.group_name ?? "").trim();
  if (!raw) return `Grupa ${index + 1}`;

  const lower = raw.toLowerCase();
  if (lower.startsWith("grupa ")) return raw;
  return raw;
}

function valueKindLabel(valueKind: CustomResultValueKind, unitLabel: string) {
  if (valueKind === "TIME") return "Wynik czasowy";
  if (valueKind === "PLACE") return "Wynik miejscowy";
  return unitLabel ? `Wynik liczbowy (${unitLabel})` : "Wynik liczbowy";
}

function isFinalStage(stage: MassStartStageDTO, stages: MassStartStageDTO[]) {
  const lastOrder = Math.max(...stages.map((item) => item.stage_order));
  const name = String(stage.stage_name ?? "").toLowerCase();
  return stage.stage_order === lastOrder || name.includes("finał") || name.includes("final");
}

function placeBadgeClass(rank: number | null | undefined) {
  if (rank === 1) return "border-amber-300/25 bg-amber-400/10 text-amber-100";
  if (rank === 2) return "border-slate-200/15 bg-white/[0.06] text-slate-100";
  if (rank === 3) return "border-orange-300/20 bg-orange-400/10 text-orange-100";
  return "border-white/10 bg-white/[0.04] text-slate-200";
}

function rowTone(rank: number | null | undefined) {
  if (rank === 1) return "bg-white/[0.06]";
  if (rank === 2 || rank === 3) return "bg-white/[0.035]";
  return "bg-transparent";
}

function resultMetaText(valueKind: CustomResultValueKind, unitLabel: string) {
  if (valueKind === "TIME") return "Prezentacja według czasu.";
  if (valueKind === "PLACE") return "Prezentacja według miejsc.";
  return unitLabel ? `Prezentacja w jednostce ${unitLabel}.` : "Prezentacja wyników liczbowych.";
}

export default function PublicMassStartStandings({
  tournamentId,
  accessCode,
  refreshKey = 0,
  resultConfig,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<TournamentMassStartResultsResponseDTO | null>(null);
  const [selectedStageId, setSelectedStageId] = useState<number | null>(null);

  const qs = useMemo(() => {
    const code = String(accessCode ?? "").trim();
    return code ? `?code=${encodeURIComponent(code)}` : "";
  }, [accessCode]);

  const valueKind = useMemo(() => getResolvedValueKind(resultConfig), [resultConfig]);
  const unitLabel = useMemo(
    () => String(resultConfig?.unit_label ?? resultConfig?.unit ?? "").trim(),
    [resultConfig]
  );

  useEffect(() => {
    let alive = true;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const res = await apiFetch(
          `/api/tournaments/${tournamentId}/public/mass-start-results/${qs}`,
          { toastOnError: false } as any
        );

        const data = (await res.json().catch(() => null)) as
          | TournamentMassStartResultsResponseDTO
          | { detail?: string }
          | null;

        if (!res.ok) {
          throw new Error(String(data?.detail || "Nie udało się pobrać rankingu etapowego."));
        }

        if (!alive) return;
        setPayload(data as TournamentMassStartResultsResponseDTO);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message ?? "Nie udało się pobrać rankingu etapowego.");
      } finally {
        if (alive) setLoading(false);
      }
    };

    void load();

    return () => {
      alive = false;
    };
  }, [qs, refreshKey, tournamentId]);

  const stages = useMemo(() => {
    return Array.isArray(payload?.stages)
      ? [...payload.stages]
          .filter((stage) => String(stage.stage_status ?? "").toUpperCase() !== "PLANNED")
          .sort((a, b) => a.stage_order - b.stage_order)
      : [];
  }, [payload]);

  useEffect(() => {
    if (stages.length === 0) {
      setSelectedStageId(null);
      return;
    }

    setSelectedStageId((current) => {
      if (current && stages.some((stage) => stage.stage_id === current)) {
        return current;
      }
      return stages[stages.length - 1]?.stage_id ?? stages[0]?.stage_id ?? null;
    });
  }, [stages]);

  const selectedStage = useMemo(() => {
    if (!selectedStageId) return stages[0] ?? null;
    return stages.find((stage) => stage.stage_id === selectedStageId) ?? stages[0] ?? null;
  }, [selectedStageId, stages]);

  if (loading) {
    return <div className="text-sm text-slate-300">Ładowanie rankingu etapowego...</div>;
  }

  if (error) {
    return <InlineAlert variant="error">{error}</InlineAlert>;
  }

  if (!payload || stages.length === 0 || !selectedStage) {
    return <InlineAlert variant="info">Brak danych rankingu etapowego.</InlineAlert>;
  }

  const tone = stageTone(selectedStage);
  const finalStage = isFinalStage(selectedStage, stages);

  return (
    <div className="space-y-5">
      <Card className="relative overflow-hidden p-5 sm:p-6">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-indigo-500/10 via-transparent to-sky-500/10" />

        <div className="relative flex flex-col gap-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-300">
                <Sparkles className="h-3.5 w-3.5" />
                Klasyfikacja etapowa
              </div>
              <div className="mt-3 text-xl font-bold text-white">Publiczny ranking MASS_START</div>
              <div className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-300">
                Wybierz etap, aby zobaczyć miejsca, sumę wyników i rezultaty rund bez przeładowywania całej strony.
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-300">
                {valueKindLabel(valueKind, unitLabel)}
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-400">
                {resultMetaText(valueKind, unitLabel)}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {stages.map((stage) => {
              const active = stage.stage_id === selectedStage.stage_id;
              return (
                <Button
                  key={stage.stage_id}
                  type="button"
                  variant="secondary"
                  onClick={() => setSelectedStageId(stage.stage_id)}
                  className={cn(
                    "h-auto rounded-2xl px-4 py-3 text-left",
                    active
                      ? "border-white/15 bg-white/[0.11] text-white shadow-[0_0_0_1px_rgba(255,255,255,0.03)]"
                      : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.07]"
                  )}
                >
                  <div className="text-sm font-semibold">Etap {stage.stage_order}</div>
                  <div className="mt-0.5 text-xs opacity-80">{stage.stage_name}</div>
                </Button>
              );
            })}
          </div>
        </div>
      </Card>

      <Card className={cn("relative overflow-hidden border p-4 sm:p-5", tone.card)}>
        <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br", tone.glow)} />

        <div className="relative">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="text-lg font-extrabold text-white">{selectedStage.stage_name}</div>
              <div className="mt-1 text-xs text-slate-400">{stageSummary(selectedStage)}</div>
            </div>

            <div
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs",
                tone.badge
              )}
            >
              <span className={cn("h-2 w-2 rounded-full", tone.dot)} />
              {stageStatusLabel(selectedStage)}
            </div>
          </div>

          <div className="mt-5 space-y-4">
            {selectedStage.groups.map((group, groupIndex) => {
              const entries = [...group.entries].sort(entrySort);

              return (
                <div
                  key={group.group_id}
                  className="overflow-hidden rounded-[26px] border border-white/10 bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
                    <div className="text-base font-bold text-white">
                      {groupName(group, groupIndex)}
                    </div>
                    <div className="inline-flex items-center gap-2 text-xs text-slate-400">
                      <Users className="h-3.5 w-3.5" />
                      {entries.length} uczestników
                    </div>
                  </div>

                  {entries.length === 0 ? (
                    <div className="px-5 py-4 text-sm text-slate-300">
                      Brak uczestników w tej grupie.
                    </div>
                  ) : (
                    <>
                      <div className="hidden overflow-x-auto lg:block">
                        <table className="min-w-full border-separate border-spacing-0">
                          <thead>
                            <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                              <th className="px-5 py-4">Miejsce</th>
                              <th className="px-5 py-4">Uczestnik</th>
                              <th className="px-5 py-4">Suma / wynik</th>
                              {Array.from({ length: selectedStage.rounds_count }, (_, index) => (
                                <th key={index} className="px-5 py-4">
                                  Runda {index + 1}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {entries.map((entry) => {
                              const firstInFinal = finalStage && entry.rank === 1;
                              return (
                                <tr
                                  key={entry.team_id}
                                  className={cn(
                                    "text-sm text-slate-100",
                                    rowTone(entry.rank)
                                  )}
                                >
                                  <td className="border-t border-white/10 px-5 py-4 align-middle">
                                    <span
                                      className={cn(
                                        "inline-flex min-w-[52px] items-center justify-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold",
                                        placeBadgeClass(entry.rank)
                                      )}
                                    >
                                      {firstInFinal ? <Sparkles className="h-3.5 w-3.5" /> : null}
                                      {entry.rank ?? "-"}
                                    </span>
                                  </td>
                                  <td className="border-t border-white/10 px-5 py-4 font-semibold">
                                    {entry.team_name}
                                  </td>
                                  <td className="border-t border-white/10 px-5 py-4">
                                    <span className="font-semibold text-white">{entry.aggregate_display ?? "-"}</span>
                                  </td>
                                  {entry.rounds.map((round) => (
                                    <td key={round.round_number} className="border-t border-white/10 px-5 py-4 text-slate-200">
                                      {roundValueLabel(round)}
                                    </td>
                                  ))}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      <div className="grid gap-0 lg:hidden">
                        {entries.map((entry, index) => {
                          const firstInFinal = finalStage && entry.rank === 1;
                          return (
                            <div
                              key={entry.team_id}
                              className={cn(
                                "px-4 py-4",
                                index > 0 && "border-t border-white/10",
                                rowTone(entry.rank)
                              )}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold text-white">{entry.team_name}</div>
                                  <div className="mt-1 text-xs text-slate-400">
                                    Suma / wynik: {entry.aggregate_display ?? "-"}
                                  </div>
                                </div>

                                <span
                                  className={cn(
                                    "inline-flex min-w-[52px] items-center justify-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold",
                                    placeBadgeClass(entry.rank)
                                  )}
                                >
                                  {firstInFinal ? <Sparkles className="h-3.5 w-3.5" /> : null}
                                  {entry.rank ?? "-"}
                                </span>
                              </div>

                              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                {entry.rounds.map((round) => (
                                  <div
                                    key={round.round_number}
                                    className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2"
                                  >
                                    <div className="text-[11px] uppercase tracking-wide text-slate-400">
                                      Runda {round.round_number}
                                    </div>
                                    <div className="mt-1 text-sm font-semibold text-white">
                                      {roundValueLabel(round)}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Card>
    </div>
  );
}
