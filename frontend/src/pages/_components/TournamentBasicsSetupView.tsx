// frontend/src/pages/_components/TournamentBasicsSetupView.tsx
// Komponent renderuje widok konfiguracji podstawowej turnieju i podsumowanie zmian.

import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BadgeCheck,
  Brackets,
  Cog,
  Info,
  Layers3,
  Text,
} from "lucide-react";

import { cn } from "../../lib/cn";

import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";
import { InlineAlert } from "../../ui/InlineAlert";
import { Input } from "../../ui/Input";
import { Textarea } from "../../ui/Textarea";
import { Portal } from "../../ui/Portal";
import { Select, type SelectOption } from "../../ui/Select";

export type Discipline = "football" | "volleyball" | "basketball" | "handball" | "tennis";
export type TournamentFormat = "LEAGUE" | "CUP" | "MIXED";

export type HandballTableDrawMode = "ALLOW_DRAW" | "PENALTIES" | "OVERTIME_PENALTIES";
export type HandballKnockoutTiebreak = "OVERTIME_PENALTIES" | "PENALTIES";
export type HandballPointsMode = "2_1_0" | "3_1_0" | "3_2_1_0";

export type TennisBestOf = 3 | 5;
export type TennisPointsMode = "NONE" | "PLT";

export type MatchesPreview = {
  total: number;
  groupTotal: number;
  koTotal: number;
  groups: number;
  advancing: number;
};

export const HB_POINTS_OPTIONS: SelectOption<HandballPointsMode>[] = [
  { value: "2_1_0", label: "2-1-0 (W-R-P)" },
  { value: "3_1_0", label: "3-1-0 (W-R-P)" },
  { value: "3_2_1_0", label: "3-2-1-0 (karne: W=2, P=1)" },
];

export const TENNIS_BEST_OF_OPTIONS: SelectOption<TennisBestOf>[] = [
  { value: 3, label: "Best of 3 (do 2 wygranych setów)" },
  { value: 5, label: "Best of 5 (do 3 wygranych setów)" },
];

export const TENNIS_POINTS_MODE_OPTIONS: SelectOption<TennisPointsMode>[] = [
  {
    value: "NONE",
    label: "Bez punktów (ranking: zwycięstwa, RS, RG, H2H)",
    description: "Tabela bez kolumny Pkt.",
  },
  {
    value: "PLT",
    label: "Punktacja PLT (np. 10/8/4/2/0)",
    description: "Backend liczy i zwraca Pkt.",
  },
];

export const DISCIPLINE_OPTIONS: SelectOption<Discipline>[] = [
  { value: "football", label: "Piłka nożna" },
  { value: "handball", label: "Piłka ręczna" },
  { value: "basketball", label: "Koszykówka" },
  { value: "volleyball", label: "Siatkówka" },
  { value: "tennis", label: "Tenis" },
];

export const FORMAT_OPTIONS: SelectOption<TournamentFormat>[] = [
  { value: "LEAGUE", label: "Liga" },
  { value: "CUP", label: "Puchar (KO)" },
  { value: "MIXED", label: "Grupy + puchar" },
];

export const MATCHES_COUNT_OPTIONS: SelectOption<1 | 2>[] = [
  { value: 1, label: "1 mecz" },
  { value: 2, label: "2 mecze (rewanż)" },
];

export const MATCHES_COUNT_ROUNDS_OPTIONS: SelectOption<1 | 2>[] = [
  { value: 1, label: "1 mecz" },
  { value: 2, label: "2 mecze (dwumecz)" },
];

export const HB_TABLE_DRAW_OPTIONS: SelectOption<HandballTableDrawMode>[] = [
  { value: "ALLOW_DRAW", label: "Remis dopuszczalny" },
  { value: "PENALTIES", label: "Remis - karne" },
  { value: "OVERTIME_PENALTIES", label: "Remis - dogrywka + karne" },
];

export const HB_KNOCKOUT_TIEBREAK_OPTIONS: SelectOption<HandballKnockoutTiebreak>[] = [
  { value: "OVERTIME_PENALTIES", label: "Dogrywka + karne" },
  { value: "PENALTIES", label: "Od razu karne" },
];

export function disciplineLabel(code?: Discipline) {
  switch (code) {
    case "football":
      return "Piłka nożna";
    case "volleyball":
      return "Siatkówka";
    case "basketball":
      return "Koszykówka";
    case "handball":
      return "Piłka ręczna";
    case "tennis":
      return "Tenis";
    default:
      return code ?? "-";
  }
}

export function formatLabel(v?: TournamentFormat) {
  if (v === "LEAGUE") return "Liga";
  if (v === "CUP") return "Puchar (KO)";
  if (v === "MIXED") return "Grupy + puchar";
  return "-";
}

function StatRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
      <div className="text-xs font-semibold text-slate-300">{label}</div>
      <div className="text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

function ToggleRow({
  checked,
  disabled,
  title,
  desc,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  title: string;
  desc: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "w-full rounded-2xl border px-4 py-3 text-left transition",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/10",
        "disabled:opacity-60 disabled:pointer-events-none",
        checked
          ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
          : "border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.06]"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold">
            {title}: {checked ? "Włączony" : "Wyłączony"}
          </div>
          <div className="mt-1 text-sm text-slate-300">{desc}</div>
        </div>
        <span
          className={cn(
            "mt-0.5 inline-flex h-6 w-11 items-center rounded-full border p-0.5 transition",
            checked ? "border-emerald-400/30 bg-emerald-400/20" : "border-white/10 bg-white/[0.06]"
          )}
          aria-hidden
        >
          <span
            className={cn(
              "block h-5 w-5 rounded-full transition",
              checked ? "translate-x-5 bg-white" : "translate-x-0 bg-white/80"
            )}
          />
        </span>
      </div>
    </button>
  );
}

/** Modal potwierdzeń zastępuje confirm() i utrzymuje spójny UX w obrębie widoku. */
export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <Portal>
          <motion.div
            key="confirm-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={onCancel}
          >
            <div className="absolute inset-0 bg-black/60" />

            <motion.div
              key="confirm-modal"
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              transition={{ duration: 0.18 }}
              className="relative w-full max-w-md"
              onClick={(e) => e.stopPropagation()}
            >
              <Card className="p-5">
                <div className="space-y-2">
                  <div className="text-base font-semibold text-slate-100">{title}</div>
                  <div className="whitespace-pre-wrap text-sm text-slate-300">{message}</div>
                </div>

                <div className="mt-5 flex items-center justify-end gap-2">
                  <Button variant="secondary" onClick={onCancel}>
                    {cancelLabel}
                  </Button>
                  <Button onClick={onConfirm}>{confirmLabel}</Button>
                </div>
              </Card>
            </motion.div>
          </motion.div>
        </Portal>
      )}
    </AnimatePresence>
  );
}

/** Karta podstawowa utrzymuje kontrakt wprowadzania danych wymaganych do utworzenia turnieju. */
export function BasicsCard({
  disableForm,
  isCreateMode,
  isTournamentCreated,
  name,
  description,
  onNameChange,
  onDescriptionChange,
  onCreate,
}: {
  disableForm: boolean;
  isCreateMode: boolean;
  isTournamentCreated: boolean;
  name: string;
  description: string;
  onNameChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  onCreate: () => void;
}) {
  return (
    <Card className="flex min-h-[26rem] flex-col p-6">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-2xl border border-white/10 bg-white/[0.04]">
          <Cog className="h-5 w-5 text-white/90" />
        </div>
        <div className="min-w-0">
          <div className="text-base font-semibold text-white">Podstawowe informacje</div>
          <div className="text-sm text-slate-300">Nazwa i opis widoczne w podglądzie turnieju.</div>
        </div>
      </div>

      <div className="mt-5 flex flex-1 flex-col gap-4">
        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-300">Nazwa turnieju</div>
          <Input
            value={name}
            disabled={disableForm}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Wymagane - np. Liga miejska 2026"
          />
        </div>

        <div className="flex flex-1 flex-col space-y-2">
          <div className="text-xs font-semibold text-slate-300">Opis turnieju</div>
          <div className="relative flex-1">
            <Textarea unstyled
              value={description}
              disabled={disableForm}
              onChange={(e) => onDescriptionChange(e.target.value)}
              placeholder="Krótki opis dla uczestników, np. zasady, lokalizacja, terminy."
              className={cn(
                "h-full min-h-[110px] w-full resize-y rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-100",
                "focus-visible:border-white/20 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/10",
                "disabled:pointer-events-none disabled:opacity-60"
              )}
            />
          </div>
          <div className="text-xs text-slate-400">
            Opcjonalnie. Jeśli nie podasz opisu, w podglądzie zostanie pominięty.
          </div>
        </div>

        {isCreateMode && (
          <div className="pt-4">
            <Button
              onClick={onCreate}
              disabled={disableForm || isTournamentCreated || !name.trim()}
              className="w-full"
            >
              Utwórz turniej
            </Button>
            {!isTournamentCreated && (
              <div className="mt-2 text-xs text-slate-400">
                Po utworzeniu turnieju odblokujesz sekcje struktury i podsumowania.
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

/** Karta struktury jest prezentacją parametrów formatu - logika walidacji i zapisu pozostaje w stronie. */
export function StructureCard({
  isTournamentCreated,
  disableForm,
  saving,
  discipline,
  format,
  participants,
  leagueMatches,
  groupsCount,
  groupMatches,
  advanceFromGroup,
  hbTableDrawMode,
  hbPointsMode,
  hbKnockoutTiebreak,
  cupMatches,
  finalMatches,
  thirdPlace,
  thirdPlaceMatches,
  tennisBestOf,
  tennisPointsMode,
  maxGroupsForMin2PerGroup,
  groupSizes,
  minGroupSize,
  advanceOptions,
  showLeagueOrGroupConfig,
  showKnockoutConfig,
  onSave,
  onDisciplineChange,
  onFormatChange,
  onParticipantsChange,
  onLeagueMatchesChange,
  onGroupsCountChange,
  onGroupMatchesChange,
  onAdvanceFromGroupChange,
  onHbTableDrawModeChange,
  onHbPointsModeChange,
  onHbKnockoutTiebreakChange,
  onCupMatchesChange,
  onFinalMatchesChange,
  onThirdPlaceChange,
  onThirdPlaceMatchesChange,
  onTennisBestOfChange,
  onTennisPointsModeChange,
}: {
  isTournamentCreated: boolean;
  disableForm: boolean;
  saving: boolean;

  discipline: Discipline;
  format: TournamentFormat;
  participants: number;

  leagueMatches: 1 | 2;
  groupsCount: number;
  groupMatches: 1 | 2;
  advanceFromGroup: number;

  hbTableDrawMode: HandballTableDrawMode;
  hbPointsMode: HandballPointsMode;
  hbKnockoutTiebreak: HandballKnockoutTiebreak;

  cupMatches: 1 | 2;
  finalMatches: 1 | 2;
  thirdPlace: boolean;
  thirdPlaceMatches: 1 | 2;

  tennisBestOf: TennisBestOf;
  tennisPointsMode: TennisPointsMode;

  maxGroupsForMin2PerGroup: number;
  groupSizes: number[];
  minGroupSize: number;
  advanceOptions: number[];

  showLeagueOrGroupConfig: boolean;
  showKnockoutConfig: boolean;

  onSave: () => void;

  onDisciplineChange: (v: Discipline) => void;
  onFormatChange: (v: TournamentFormat) => void;
  onParticipantsChange: (v: number) => void;

  onLeagueMatchesChange: (v: 1 | 2) => void;
  onGroupsCountChange: (v: number) => void;
  onGroupMatchesChange: (v: 1 | 2) => void;
  onAdvanceFromGroupChange: (v: number) => void;

  onHbTableDrawModeChange: (v: HandballTableDrawMode) => void;
  onHbPointsModeChange: (v: HandballPointsMode) => void;
  onHbKnockoutTiebreakChange: (v: HandballKnockoutTiebreak) => void;

  onCupMatchesChange: (v: 1 | 2) => void;
  onFinalMatchesChange: (v: 1 | 2) => void;
  onThirdPlaceChange: (v: boolean) => void;
  onThirdPlaceMatchesChange: (v: 1 | 2) => void;

  onTennisBestOfChange: (v: TennisBestOf) => void;
  onTennisPointsModeChange: (v: TennisPointsMode) => void;
}) {
  const isHandball = discipline === "handball";
  const isTennis = discipline === "tennis";

  return (
    <Card className={cn("p-6", !isTournamentCreated && "pointer-events-none opacity-60 blur-[1px]")}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl border border-white/10 bg-white/[0.04]">
            <Brackets className="h-5 w-5 text-white/90" />
          </div>
          <div className="min-w-0">
            <div className="text-base font-semibold text-white">Struktura rozgrywek</div>
            <div className="text-sm text-slate-300">Dobierz parametry dyscypliny, formatu i etapów.</div>
          </div>
        </div>

        <Button onClick={onSave} disabled={disableForm} variant="secondary">
          {saving ? "Zapisywanie..." : "Zapisz"}
        </Button>
      </div>

      <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
        <div className="text-xs font-semibold text-slate-300">Parametry ogólne</div>

        <div className="mt-3 grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-300">Dyscyplina</div>
            <Select<Discipline>
              value={discipline}
              disabled={disableForm}
              onChange={onDisciplineChange}
              options={DISCIPLINE_OPTIONS}
              ariaLabel="Dyscyplina"
            />
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-300">Format turnieju</div>
            <Select<TournamentFormat>
              value={format}
              disabled={disableForm}
              onChange={onFormatChange}
              options={FORMAT_OPTIONS}
              ariaLabel="Format turnieju"
            />
            <div className="text-xs text-slate-400">Format wpływa na generowanie etapów i meczów.</div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-300">Liczba uczestników</div>
            <Input
              type="number"
              min={2}
              max={10000}
              disabled={disableForm}
              value={participants}
              onChange={(e) => onParticipantsChange(Number(e.target.value))}
            />
            <div className="text-xs text-slate-400">Placeholdery drużyn/zawodników zostaną utworzone automatycznie.</div>
          </div>
        </div>

        {isTennis && (
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <div className="space-y-2 md:col-span-1">
              <div className="text-xs font-semibold text-slate-300">Tenis - format meczu</div>
              <Select<TennisBestOf>
                value={tennisBestOf}
                disabled={disableForm}
                onChange={onTennisBestOfChange}
                options={TENNIS_BEST_OF_OPTIONS}
                ariaLabel="Tenis - best of"
              />
              <div className="text-xs text-slate-400">Dotyczy tylko tenisa.</div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm text-slate-300 md:col-span-2">
              Tenis: KO nie obsługuje dwumeczu - rundy/finał/3. miejsce zawsze jako pojedyncze mecze.
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 space-y-4">
        {showLeagueOrGroupConfig && (
          <motion.div
            key="leagueOrMixed"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="space-y-4"
          >
            {isTennis && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="flex items-center gap-2">
                  <Text className="h-4 w-4 text-white/80" />
                  <div className="text-sm font-semibold text-white">Tenis - tabela</div>
                </div>

                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-300">System klasyfikacji</div>
                    <Select<TennisPointsMode>
                      value={tennisPointsMode}
                      disabled={disableForm}
                      onChange={onTennisPointsModeChange}
                      options={TENNIS_POINTS_MODE_OPTIONS}
                      ariaLabel="Tenis - system klasyfikacji"
                    />
                    <div className="text-xs text-slate-400">
                      {TENNIS_POINTS_MODE_OPTIONS.find((x) => x.value === tennisPointsMode)?.description}
                    </div>
                  </div>

                  <div className="text-sm leading-relaxed text-slate-300">
                    {tennisPointsMode === "PLT"
                      ? "Tabela pokaże kolumnę Pkt (liczone wg ustawień w backendzie)."
                      : "Tabela będzie bez punktów - o kolejności decydują: zwycięstwa, RS, RG i H2H (gdy etap zakończony)."}
                  </div>
                </div>
              </div>
            )}

            {isHandball && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="flex items-center gap-2">
                  <Info className="h-4 w-4 text-white/80" />
                  <div className="text-sm font-semibold text-white">Piłka ręczna - tabela</div>
                </div>

                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-300">Punktacja (tabela)</div>
                    <Select<HandballPointsMode>
                      value={hbPointsMode}
                      disabled={disableForm}
                      onChange={onHbPointsModeChange}
                      options={HB_POINTS_OPTIONS}
                      ariaLabel="Piłka ręczna - punktacja"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-300">Rozstrzyganie meczów (liga/grupy)</div>
                    <Select<HandballTableDrawMode>
                      value={hbTableDrawMode}
                      disabled={disableForm || hbPointsMode === "3_2_1_0"}
                      onChange={onHbTableDrawModeChange}
                      options={HB_TABLE_DRAW_OPTIONS}
                      ariaLabel="Piłka ręczna - remisy"
                    />
                    {hbPointsMode === "3_2_1_0" && (
                      <div className="text-xs text-amber-200">
                        Wymagane przy 3-2-1-0 (system wymusza rozstrzygnięcie).
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {format === "LEAGUE" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-300">Mecze każdy z każdym</div>
                  <Select<1 | 2>
                    value={leagueMatches}
                    disabled={disableForm}
                    onChange={onLeagueMatchesChange}
                    options={[
                      { value: 1, label: "1 mecz (bez rewanżu)" },
                      { value: 2, label: "2 mecze (rewanż)" },
                    ]}
                    ariaLabel="Liga - liczba meczów"
                  />
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm text-slate-300">
                  System wylicza pary na podstawie liczby uczestników.
                </div>
              </div>
            )}

            {format === "MIXED" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-300">Liczba grup</div>
                  <Input
                    type="number"
                    min={1}
                    max={maxGroupsForMin2PerGroup}
                    disabled={disableForm}
                    value={groupsCount}
                    onChange={(e) => onGroupsCountChange(Number(e.target.value))}
                  />
                  {groupSizes.length > 0 && (
                    <div className="text-xs text-slate-400">
                      Rozmiary grup: {groupSizes.join(", ")} (min: {minGroupSize})
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-300">Mecze w grupach</div>
                  <Select<1 | 2>
                    value={groupMatches}
                    disabled={disableForm}
                    onChange={onGroupMatchesChange}
                    options={MATCHES_COUNT_OPTIONS}
                    ariaLabel="Grupy - mecze"
                  />
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <div className="text-xs font-semibold text-slate-300">Awans z grupy</div>
                  <Select<number>
                    value={advanceFromGroup}
                    disabled={disableForm || minGroupSize < 2}
                    onChange={onAdvanceFromGroupChange}
                    options={advanceOptions.map((v) => ({ value: v, label: String(v) }))}
                    ariaLabel="Awans z grupy"
                  />
                  {minGroupSize < 2 && (
                    <div className="text-xs text-amber-200">
                      Najmniejsza grupa ma mniej niż 2 uczestników - zmniejsz liczbę grup.
                    </div>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        )}

        {showKnockoutConfig && (
          <motion.div
            key="ko"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="space-y-4"
          >
            {isHandball && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="flex items-center gap-2">
                  <Layers3 className="h-4 w-4 text-white/80" />
                  <div className="text-sm font-semibold text-white">Piłka ręczna - KO</div>
                </div>

                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-300">Rozstrzyganie remisów (KO)</div>
                    <Select<HandballKnockoutTiebreak>
                      value={hbKnockoutTiebreak}
                      disabled={disableForm}
                      onChange={onHbKnockoutTiebreakChange}
                      options={HB_KNOCKOUT_TIEBREAK_OPTIONS}
                      ariaLabel="KO - rozstrzyganie remisów"
                    />
                  </div>
                  <div className="text-sm leading-relaxed text-slate-300">
                    Ustawia sposób rozstrzygnięcia, gdy mecz KO kończy się remisem.
                  </div>
                </div>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-300">Rundy (mecze)</div>
                <Select<1 | 2>
                  value={cupMatches}
                  disabled={disableForm || isTennis}
                  onChange={onCupMatchesChange}
                  options={MATCHES_COUNT_ROUNDS_OPTIONS}
                  ariaLabel="KO - rundy"
                />
                {isTennis && <div className="text-xs text-amber-200">Tenis: brak dwumeczu w KO (zawsze 1).</div>}
              </div>

              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-300">Finał</div>
                <Select<1 | 2>
                  value={finalMatches}
                  disabled={disableForm || isTennis}
                  onChange={onFinalMatchesChange}
                  options={[
                    { value: 1, label: "1 mecz" },
                    { value: 2, label: "2 mecze" },
                  ]}
                  ariaLabel="KO - finał"
                />
                {isTennis && <div className="text-xs text-amber-200">Tenis: finał zawsze 1 mecz.</div>}
              </div>

              <div className="sm:col-span-2">
                <ToggleRow
                  checked={thirdPlace}
                  disabled={disableForm}
                  title="Mecz o 3. miejsce"
                  desc="Dodaje mecz o 3 miejsce (jeśli format to wspiera)."
                  onChange={onThirdPlaceChange}
                />
              </div>

              {thirdPlace && (
                <div className="space-y-2 sm:col-span-2">
                  <div className="text-xs font-semibold text-slate-300">Mecz o 3. miejsce - liczba spotkań</div>
                  <Select<1 | 2>
                    value={thirdPlaceMatches}
                    disabled={disableForm || isTennis}
                    onChange={onThirdPlaceMatchesChange}
                    options={[
                      { value: 1, label: "1 mecz" },
                      { value: 2, label: "2 mecze" },
                    ]}
                    ariaLabel="KO - 3. miejsce"
                  />
                  {isTennis && <div className="text-xs text-amber-200">Tenis: 3. miejsce zawsze 1 mecz.</div>}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </div>
    </Card>
  );
}

/** Karta podsumowania prezentuje wyliczenia pomocnicze, bez wpływu na zapis. */
export function SummaryCard({
  isTournamentCreated,
  discipline,
  format,
  participants,
  preview,
  isAssistantReadOnly,
}: {
  isTournamentCreated: boolean;
  discipline: Discipline;
  format: TournamentFormat;
  participants: number;
  preview: MatchesPreview;
  isAssistantReadOnly: boolean;
}) {
  return (
    <Card
      className={cn(
        "relative min-h-[26rem] overflow-hidden p-6",
        !isTournamentCreated && "pointer-events-none opacity-60 blur-[1px]"
      )}
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 left-1/2 h-48 w-[28rem] -translate-x-1/2 rounded-full bg-indigo-500/15 blur-3xl" />
        <div className="absolute -bottom-24 left-1/2 h-48 w-[28rem] -translate-x-1/2 rounded-full bg-sky-500/10 blur-3xl" />
      </div>

      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-semibold text-white">Podsumowanie</div>
            <div className="mt-1 text-sm text-slate-300">Szacunkowa struktura (orientacyjnie).</div>
          </div>

          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-slate-200">
            <BadgeCheck className="h-3.5 w-3.5 opacity-80" />
            {disciplineLabel(discipline)}
          </span>
        </div>

        <div className="mt-4 grid gap-2">
          <StatRow label="Format" value={formatLabel(format)} />
          <StatRow label="Uczestnicy" value={participants} />

          {format === "MIXED" && (
            <>
              <StatRow label="Liczba grup" value={preview.groups} />
              <StatRow label="Awansujących do KO" value={preview.advancing} />
            </>
          )}

          {format !== "CUP" && <StatRow label="Mecze fazy tabeli" value={preview.groupTotal} />}
          {format !== "LEAGUE" && <StatRow label="Mecze fazy KO" value={preview.koTotal} />}

          <StatRow label="Szac. łączna liczba meczów" value={preview.total} />
        </div>

        <div className="mt-4 text-xs text-slate-400">
          Tip: zmiana formatu, grup lub awansu może wymagać resetu rozgrywek.
        </div>

        {isAssistantReadOnly && (
          <div className="mt-4">
            <InlineAlert variant="info" title="Tryb podglądu">
              Jako asystent nie możesz zmieniać konfiguracji bez uprawnienia "tournament_edit".
            </InlineAlert>
          </div>
        )}
      </div>
    </Card>
  );
}
