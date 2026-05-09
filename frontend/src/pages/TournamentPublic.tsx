// frontend/src/pages/TournamentPublic.tsx
// Plik renderuje publiczny widok wydarzenia z układem nastawionym na widza i obsługą trybów meczowych oraz etapowych.

import type { ReactNode } from "react";
import { useEffect, useCallback, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BarChart3,
  Calendar,
  ChevronRight,
  Gauge,
  LayoutGrid,
  MapPin,
  Medal,
} from "lucide-react";

import { apiFetch, hasAuthTokens } from "../api";
import { useTournamentWs } from "../hooks/useTournamentWs";
import { cn } from "../lib/cn";
import {
  BETTER_RESULT_LABELS,
  DISCIPLINE_LABELS,
  MATCH_STATUS_LABELS,
  RESULT_VALUE_KIND_LABELS,
  TIME_FORMAT_LABELS,
  getLabel,
} from "../lib/sportLabels";

import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { InlineAlert } from "../ui/InlineAlert";
import { Input } from "../ui/Input";
import { Select, type SelectOption } from "../ui/Select";

import PublicMatchesBar from "../components/PublicMatchesBar";
import PublicMatchesPanel from "../components/PublicMatchesPanel";
import type {
  CommentaryEntryPublicDTO,
  IncidentPublicDTO,
  MatchPublicDTO,
} from "../components/PublicMatchesPanel";
import PublicMassStartStandings from "../components/PublicMassStartStandings";
import StandingsBracket from "../components/StandingsBracket";
import TournamentFlowNav from "../components/TournamentFlowNav";
import DivisionSwitcher, {
  type DivisionSwitcherItem,
} from "../components/DivisionSwitcher";

type EntryMode = "MANAGER" | "ORGANIZER_ONLY";
type ResultMode = "SCORE" | "CUSTOM";
type CompetitionModel = "HEAD_TO_HEAD" | "MASS_START";
type CustomResultValueKind = "NUMBER" | "TIME" | "PLACE";
type CustomBetterResult = "HIGHER" | "LOWER";
type CustomTimeFormat = "HH:MM:SS" | "MM:SS" | "MM:SS.hh" | "SS.hh";
type CustomHeadToHeadMode = "HEAD_TO_HEAD_POINTS" | "MASS_START_MEASURED";
type CustomStageStructureMode = "REDUCTION" | "MULTI_EVENT";

type TournamentResultConfigDTO = {
  value_kind?: CustomResultValueKind;
  custom_mode?: CustomHeadToHeadMode;
  measured_value_kind?: CustomResultValueKind;
  mass_start_value_kind?: CustomResultValueKind;
  unit?: string;
  unit_label?: string;
  better_result?: CustomBetterResult;
  decimal_places?: number | null;
  time_format?: CustomTimeFormat | null;
  allow_ties?: boolean;
  stage_structure_mode?: CustomStageStructureMode | string | null;
};

type TournamentPublicDTO = {
  id: number;
  name: string;
  description: string | null;
  discipline?: string | null;
  custom_discipline_name?: string | null;
  result_mode?: ResultMode;
  competition_model?: CompetitionModel | null;
  result_config?: TournamentResultConfigDTO;
  start_date: string | null;
  end_date: string | null;
  location: string | null;
  is_published?: boolean;
  entry_mode?: EntryMode;
  competition_type?: "TEAM" | "INDIVIDUAL";
  allow_join_by_code?: boolean;
  join_code?: string | null;
  participants_public_preview_enabled?: boolean;
  participants_self_rename_enabled?: boolean;
  participants_self_rename_requires_approval?: boolean;
  participants_self_rename_approval_required?: boolean;
  my_role?: "ORGANIZER" | "ASSISTANT" | "PARTICIPANT" | null;
  divisions?: DivisionSwitcherItem[];
  active_division_id?: number | null;
  active_division_name?: string | null;
  stage_structure_mode?: CustomStageStructureMode | string | null;
};

type RegistrationMeDTO = {
  display_name: string;
  team_id: number | null;
  division_id?: number | null;
  division_name?: string | null;
};

type NameChangeRequestDTO = {
  id?: number;
  status?: "PENDING" | "APPROVED" | "REJECTED" | string;
  old_name?: string;
  requested_name?: string;
  created_at?: string;
};

type DivisionChangeRequestDTO = {
  id?: number;
  status?: "PENDING" | "APPROVED" | "REJECTED" | string;
  team_name?: string | null;
  from_division_name?: string | null;
  to_division_id?: number | null;
  to_division_name?: string | null;
  created_at?: string;
};

type ViewTab = "OVERVIEW" | "MATCHES" | "STANDINGS" | "STATS";

function parseDivisionId(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
}

function appendQueryParams(
  url: string,
  params: Record<string, string | number | boolean | null | undefined>
): string {
  const hashIndex = url.indexOf("#");
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : "";
  const urlWithoutHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;

  const queryIndex = urlWithoutHash.indexOf("?");
  const base = queryIndex >= 0 ? urlWithoutHash.slice(0, queryIndex) : urlWithoutHash;
  const rawQuery = queryIndex >= 0 ? urlWithoutHash.slice(queryIndex + 1) : "";
  const search = new URLSearchParams(rawQuery);

  Object.entries(params).forEach(([key, value]) => {
    if (value === null || typeof value === "undefined" || value === "") {
      search.delete(key);
      return;
    }
    search.set(key, String(value));
  });

  const query = search.toString();
  return `${base}${query ? `?${query}` : ""}${hash}`;
}

function normalizeDivisionPayload(payload: unknown): DivisionSwitcherItem[] {
  const source = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as any)?.results)
      ? (payload as any).results
      : Array.isArray((payload as any)?.divisions)
        ? (payload as any).divisions
        : [];

  const seen = new Set<number>();

  return source
    .map((item: any) => ({
      id: parseDivisionId(String(item?.id ?? "")) ?? 0,
      name: String(item?.name ?? "").trim(),
      slug: typeof item?.slug === "string" && item.slug.trim() ? item.slug : String(item?.id ?? ""),
      order: typeof item?.order === "number" ? item.order : undefined,
      is_default: Boolean(item?.is_default),
      is_archived: Boolean(item?.is_archived),
      status: typeof item?.status === "string" ? item.status : undefined,
    }))
    .filter((item: DivisionSwitcherItem) => {
      if (!item.id || !item.name || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
}

function buildDivisionFallback(tournament: TournamentPublicDTO, fallback: DivisionSwitcherItem[] = []): DivisionSwitcherItem[] {
  const normalized = normalizeDivisionPayload(fallback);
  if (normalized.length > 0) return normalized;

  const activeId = parseDivisionId(String(tournament.active_division_id ?? ""));
  if (!activeId) return [];

  return [
    {
      id: activeId,
      name: tournament.active_division_name?.trim() || "Dywizja główna",
      slug: String(activeId),
      order: 0,
      is_default: true,
      is_archived: false,
      status: undefined,
    },
  ];
}

function formatDateRange(start: string | null, end: string | null) {
  if (!start && !end) return null;
  if (start && end) return `${start} - ${end}`;
  return start ?? end;
}

function isByePublic(m: MatchPublicDTO): boolean {
  const h = (m.home_team_name ?? "").toUpperCase();
  const a = (m.away_team_name ?? "").toUpperCase();
  const needles = ["BYE", "__SYSTEM_BYE__", "WOLNY LOS"];
  return needles.some((n) => h.includes(n) || a.includes(n));
}

function hasAccessToken(): boolean {
  return hasAuthTokens();
}

function normalizeName(s: string) {
  return (s ?? "").trim().replace(/\s+/g, " ");
}

function looksLikeJoinDisabledMessage(msg: string) {
  const t = (msg ?? "").toLowerCase();
  return t.includes("dołącz") && (t.includes("wyłącz") || t.includes("disabled"));
}

function looksLikeRenameRequiresApprovalMessage(msg: string) {
  const t = (msg ?? "").toLowerCase();
  const approval =
    t.includes("akcept") ||
    t.includes("zatwier") ||
    t.includes("approval") ||
    t.includes("request") ||
    t.includes("prośb");
  const rename = t.includes("zmian") && (t.includes("nazw") || t.includes("name"));
  return approval && rename;
}

function extractList(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

function normalizePublicMatches(payload: any): MatchPublicDTO[] {
  return extractList(payload).filter(Boolean) as MatchPublicDTO[];
}

function usesCustomResults(tournament: TournamentPublicDTO | null): boolean {
  return String(tournament?.result_mode ?? "SCORE").toUpperCase() === "CUSTOM";
}

function getCompetitionModel(tournament: TournamentPublicDTO | null): string {
  return String(tournament?.competition_model ?? "").toUpperCase();
}

function getResultConfig(tournament: TournamentPublicDTO | null): TournamentResultConfigDTO {
  return tournament?.result_config ?? {};
}

function getStageStructureMode(tournament: TournamentPublicDTO | null): CustomStageStructureMode {
  const direct = String(tournament?.stage_structure_mode ?? "").toUpperCase();
  if (direct === "MULTI_EVENT") return "MULTI_EVENT";

  const configValue = String(getResultConfig(tournament).stage_structure_mode ?? "").toUpperCase();
  return configValue === "MULTI_EVENT" ? "MULTI_EVENT" : "REDUCTION";
}

function getResolvedCustomValueKind(tournament: TournamentPublicDTO | null): CustomResultValueKind | "" {
  const config = getResultConfig(tournament);
  const direct = String(config.value_kind ?? "").toUpperCase();
  if (direct === "NUMBER" || direct === "TIME" || direct === "PLACE") {
    return direct as CustomResultValueKind;
  }

  const competitionModel = getCompetitionModel(tournament);
  if (competitionModel === "MASS_START") {
    const massStartKind = String(config.mass_start_value_kind ?? "").toUpperCase();
    if (massStartKind === "NUMBER" || massStartKind === "TIME" || massStartKind === "PLACE") {
      return massStartKind as CustomResultValueKind;
    }
  }

  const headToHeadMode = String(config.custom_mode ?? "").toUpperCase();
  if (headToHeadMode === "MASS_START_MEASURED") {
    const measuredKind = String(config.measured_value_kind ?? "").toUpperCase();
    if (measuredKind === "NUMBER" || measuredKind === "TIME" || measuredKind === "PLACE") {
      return measuredKind as CustomResultValueKind;
    }
  }

  return "";
}

function getPublicDisciplineLabel(tournament: TournamentPublicDTO | null): string | null {
  if (!tournament) return null;

  const customName = String(tournament.custom_discipline_name ?? "").trim();
  if (customName) return customName;

  const raw = String(tournament.discipline ?? "").trim();
  if (!raw) return null;

  return getLabel(DISCIPLINE_LABELS, raw.toLowerCase(), raw);
}

function getPublicResultModeSummary(tournament: TournamentPublicDTO | null): string | null {
  if (!usesCustomResults(tournament)) return null;

  const config = getResultConfig(tournament);
  const competitionModel = getCompetitionModel(tournament);
  const headToHeadMode = String(config.custom_mode ?? "HEAD_TO_HEAD_POINTS").toUpperCase();
  const valueKind = getResolvedCustomValueKind(tournament);
  const unitLabel = String(config.unit_label ?? config.unit ?? "").trim();
  const isMassStartMultiEvent = competitionModel === "MASS_START" && getStageStructureMode(tournament) === "MULTI_EVENT";

  if (competitionModel === "HEAD_TO_HEAD" && headToHeadMode === "HEAD_TO_HEAD_POINTS") {
    return "Klasyfikacja punktowa oparta na wynikach meczów. Relacja na żywo pozostaje dostępna dla pojedynków.";
  }

  if (valueKind === "TIME") {
    const format = getLabel(TIME_FORMAT_LABELS, String(config.time_format ?? "MM:SS.hh"), "minuty:sekundy:setne");
    const valueKindLabel = getLabel(RESULT_VALUE_KIND_LABELS, valueKind, "Wynik czasowy").toLowerCase();
    if (competitionModel === "MASS_START") {
      return isMassStartMultiEvent
        ? `Klasyfikacja konkurencji według czasu. Typ wyniku: ${valueKindLabel}. Format czasu: ${format}. Lepszy jest wynik niższy.`
        : `Ranking etapowy według czasu. Typ wyniku: ${valueKindLabel}. Format czasu: ${format}. Lepszy jest wynik niższy.`;
    }

    return `Wynik meczowy według czasu. Typ wyniku: ${valueKindLabel}. Format czasu: ${format}. Lepszy jest wynik niższy.`;
  }

  if (valueKind === "PLACE") {
    const valueKindLabel = getLabel(RESULT_VALUE_KIND_LABELS, valueKind, "Miejsce").toLowerCase();
    if (competitionModel === "MASS_START") {
      return isMassStartMultiEvent
        ? `Klasyfikacja konkurencji według miejsc. Typ wyniku: ${valueKindLabel}. Niższa wartość oznacza lepszy rezultat.`
        : `Ranking etapowy według miejsc. Typ wyniku: ${valueKindLabel}. Niższa wartość oznacza lepszy rezultat.`;
    }

    return `Wynik meczowy według miejsc. Typ wyniku: ${valueKindLabel}. Niższa wartość oznacza lepszy rezultat.`;
  }

  const better = String(config.better_result ?? "HIGHER").toUpperCase();
  const betterLabel = getLabel(BETTER_RESULT_LABELS, better, "Wyższy wynik jest lepszy").toLowerCase();
  const decimals = typeof config.decimal_places === "number" ? config.decimal_places : 0;
  const unitPart = unitLabel ? ` Jednostka: ${unitLabel}.` : "";
  const valueKindLabel = getLabel(RESULT_VALUE_KIND_LABELS, valueKind || "NUMBER", "Wynik liczbowy").toLowerCase();

  if (competitionModel === "MASS_START") {
    return isMassStartMultiEvent
      ? `Klasyfikacja konkurencji. Typ wyniku: ${valueKindLabel}. ${betterLabel}. Dokładność: ${decimals} miejsc po przecinku.${unitPart}`
      : `Ranking etapowy. Typ wyniku: ${valueKindLabel}. ${betterLabel}. Dokładność: ${decimals} miejsc po przecinku.${unitPart}`;
  }

  return `Wynik meczowy. Typ wyniku: ${valueKindLabel}. ${betterLabel}. Dokładność: ${decimals} miejsc po przecinku.${unitPart}`;
}

function incidentMinute(i: IncidentPublicDTO): number | null {
  if (typeof i.minute === "number") return i.minute;
  const mr = (i as any).minute_raw;
  if (typeof mr === "number" && Number.isFinite(mr)) return mr;
  if (typeof mr === "string") {
    const t = mr.trim();
    if (t && /^\d+$/.test(t)) return Number(t);
  }
  return null;
}

function getMatchTimestamp(match: MatchPublicDTO): number {
  const date = String(match.scheduled_date ?? "").trim();
  const time = String(match.scheduled_time ?? "").trim();
  const iso = [date || null, time || null].filter(Boolean).join("T");
  if (!iso) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function getStatusLabel(status: string | null | undefined): string {
  const raw = String(status ?? "").toUpperCase();
  return getLabel(MATCH_STATUS_LABELS, raw, raw || "Bez statusu");
}

type RevealProps = {
  children: ReactNode;
  delay?: number;
  className?: string;
};

function Reveal({ children, delay = 0, className }: RevealProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14, filter: "blur(2px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.35, ease: "easeOut", delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

type HoverLiftProps = {
  children: ReactNode;
  className?: string;
  scale?: number;
};

function HoverLift({ children, className, scale = 1.01 }: HoverLiftProps) {
  return (
    <motion.div
      whileHover={{ y: -3, scale }}
      transition={{ type: "spring", stiffness: 260, damping: 18 }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function MetaPill({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-2">
      <span className="grid h-8 w-8 place-items-center rounded-xl border border-white/10 bg-white/[0.06] text-white/90">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-[11px] text-slate-400">{label}</div>
        <div className="truncate text-sm font-semibold text-slate-100">{value}</div>
      </div>
    </div>
  );
}

function SectionShell({
  eyebrow,
  title,
  desc,
  right,
  children,
}: {
  eyebrow?: string;
  title: string;
  desc?: string | null;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          {eyebrow ? (
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
              {eyebrow}
            </div>
          ) : null}
          <h2 className="mt-1 text-xl font-semibold text-white">{title}</h2>
          {desc ? (
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-300">{desc}</p>
          ) : null}
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>
      {children}
    </Card>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  desc,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  desc: string;
}) {
  return (
    <HoverLift className="h-full" scale={1.012}>
      <Card className="h-full bg-white/[0.04] p-4">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.06] text-white/90">
            {icon}
          </div>
          <div className="min-w-0">
            <div className="text-xs text-slate-400">{label}</div>
            <div className="mt-1 break-words text-base font-semibold text-white">{value}</div>
            <div className="mt-2 break-words text-sm leading-relaxed text-slate-300">{desc}</div>
          </div>
        </div>
      </Card>
    </HoverLift>
  );
}

function StatusBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-xs font-medium text-slate-200">
      {children}
    </span>
  );
}

function PublicEventMatchCard({
  match,
  isLive,
  isLatest,
}: {
  match: MatchPublicDTO;
  isLive?: boolean;
  isLatest?: boolean;
}) {
  const scoreVisible =
    typeof match.home_score === "number" && typeof match.away_score === "number";
  const meta = [match.scheduled_date, match.scheduled_time, match.location]
    .filter(Boolean)
    .join(" • ");

  return (
    <Card className="bg-white/[0.04] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {isLive ? <StatusBadge>Na żywo</StatusBadge> : null}
            {isLatest ? <StatusBadge>Ostatni wynik</StatusBadge> : null}
            {!isLive && !isLatest ? <StatusBadge>{getStatusLabel(match.status)}</StatusBadge> : null}
          </div>

          <div className="mt-3 break-words text-base font-semibold text-white">
            {match.home_team_name} <span className="text-slate-400">vs</span> {match.away_team_name}
          </div>
          <div className="mt-2 break-words text-sm text-slate-300">
            {meta || "Szczegóły terminu nie zostały podane."}
          </div>
        </div>

        <div className="min-w-[92px] text-right">
          <div className="text-lg font-semibold text-white">
            {scoreVisible ? `${match.home_score} : ${match.away_score}` : "- : -"}
          </div>
          <div className="mt-1 text-xs text-slate-400">{getStatusLabel(match.status)}</div>
        </div>
      </div>
    </Card>
  );
}

function DrawerPanel({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string | null;
  children: ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Zamknij panel"
        className="absolute inset-0 bg-slate-950/75 backdrop-blur-sm"
        onClick={onClose}
      />

      <motion.div
        initial={{ x: 32, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 32, opacity: 0 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className="relative z-10 flex h-full w-full max-w-[32rem] flex-col border-l border-white/10 bg-[#06101d]/95 p-5 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-4">
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
              Uczestnik
            </div>
            <h2 className="mt-1 break-words text-xl font-semibold text-white">{title}</h2>
            {subtitle ? (
              <p className="mt-2 text-sm leading-relaxed text-slate-300">{subtitle}</p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            className="border border-white/10 bg-white/[0.04]"
          >
            Zamknij
          </Button>
        </div>

        <div className="mt-5 flex-1 overflow-y-auto pr-1">{children}</div>
      </motion.div>
    </div>
  );
}

function AccessGate({
  code,
  setCode,
  onSubmit,
  loading,
  error,
}: {
  code: string;
  setCode: (value: string) => void;
  onSubmit: () => void;
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-3xl items-center justify-center px-4">
      <Card className="w-full overflow-hidden p-0">
        <div className="relative overflow-hidden p-6 sm:p-8">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute left-1/2 top-0 h-40 w-[22rem] -translate-x-1/2 rounded-full bg-indigo-500/15 blur-3xl" />
            <div className="absolute bottom-0 left-1/2 h-40 w-[22rem] -translate-x-1/2 rounded-full bg-sky-500/10 blur-3xl" />
          </div>

          <div className="relative">
            <div className="inline-flex rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-xs font-medium text-slate-200">
              Dostęp chroniony
            </div>
            <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Wpisz kod, aby otworzyć wydarzenie
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-slate-300 sm:text-base">
              Organizator zabezpieczył publiczny widok kodem dostępu. Po poprawnym wpisaniu
              zobaczysz wyniki, ranking i aktualny przebieg wydarzenia.
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <div className="flex-1">
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Kod dostępu"
                  aria-label="Kod dostępu"
                />
              </div>
              <Button
                type="button"
                onClick={onSubmit}
                rightIcon={<ArrowRight className="h-4 w-4" />}
                disabled={loading}
              >
                {loading ? "Otwieranie..." : "Otwórz wydarzenie"}
              </Button>
            </div>

            {error ? (
              <div className="mt-4">
                <InlineAlert variant="error" title="Brak dostępu">
                  {error}
                </InlineAlert>
              </div>
            ) : null}
          </div>
        </div>
      </Card>
    </div>
  );
}

type ScorerRow = {
  player_name: string;
  goals: number;
};

export default function TournamentPublic({
  initialView = "OVERVIEW",
}: {
  initialView?: ViewTab;
} = {}) {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const tournamentId = id ?? null;
  const searchParamsKey = searchParams.toString();

  const requestedDivisionId = useMemo(() => {
    const current = new URLSearchParams(searchParamsKey);
    return (
      parseDivisionId(current.get("division_id")) ??
      parseDivisionId(current.get("active_division_id"))
    );
  }, [searchParamsKey]);

  const urlAccessCode = searchParams.get("code") ?? "";
  const joinFlag = searchParams.get("join") === "1";
  const urlJoinCode = searchParams.get("join_code") ?? searchParams.get("joinCode") ?? "";

  const [code, setCode] = useState("");
  const [standingsRefreshKey, setStandingsRefreshKey] = useState(0);
  const [tournament, setTournament] = useState<TournamentPublicDTO | null>(null);
  const [divisions, setDivisions] = useState<DivisionSwitcherItem[]>([]);
  const [activeDivisionId, setActiveDivisionId] = useState<number | null>(requestedDivisionId);
  const [activeDivisionName, setActiveDivisionName] = useState<string | null>(null);
  const effectiveDivisionId = requestedDivisionId ?? activeDivisionId;

  const [tournamentLoaded, setTournamentLoaded] = useState(false);
  const [matches, setMatches] = useState<MatchPublicDTO[]>([]);
  const [myMatches, setMyMatches] = useState<MatchPublicDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [needsCode, setNeedsCode] = useState(false);
  const [loadingGate, setLoadingGate] = useState(false);
  const [view, setView] = useState<ViewTab>(initialView);
  const [participantPanelOpen, setParticipantPanelOpen] = useState(false);

  const isLogged = hasAccessToken();
  const [regMe, setRegMe] = useState<RegistrationMeDTO | null>(null);
  const [regBusy, setRegBusy] = useState(false);
  const [regInfo, setRegInfo] = useState<string | null>(null);
  const [regError, setRegError] = useState<string | null>(null);
  const [regCode, setRegCode] = useState("");
  const [verified, setVerified] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [joinDisabledByServer, setJoinDisabledByServer] = useState(false);
  const [pendingNameReq, setPendingNameReq] = useState<NameChangeRequestDTO | null>(null);
  const [pendingDivisionReq, setPendingDivisionReq] =
    useState<DivisionChangeRequestDTO | null>(null);
  const [targetDivisionId, setTargetDivisionId] = useState<number | null>(null);
  const [joinDivisionId, setJoinDivisionId] = useState<number | null>(requestedDivisionId);
  const [joinDivisions, setJoinDivisions] = useState<DivisionSwitcherItem[]>([]);

  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(null);
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const [incidentsByMatch, setIncidentsByMatch] = useState<Record<number, IncidentPublicDTO[]>>(
    {}
  );
  const [incBusy, setIncBusy] = useState(false);
  const [incError, setIncError] = useState<string | null>(null);
  const [commentaryByMatch, setCommentaryByMatch] = useState<
    Record<number, CommentaryEntryPublicDTO[]>
  >({});
  const [comBusy, setComBusy] = useState(false);
  const [comError, setComError] = useState<string | null>(null);

  const [scorers, setScorers] = useState<ScorerRow[]>([]);
  const [scorerBusy, setScorerBusy] = useState(false);
  const [scorerError, setScorerError] = useState<string | null>(null);

  const matchesPanelRef = useRef<HTMLDivElement | null>(null);
  const wsReloadTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!urlAccessCode) return;
    setCode((prev) => (prev ? prev : urlAccessCode));
  }, [urlAccessCode]);

  useEffect(() => {
    if (!joinFlag || !urlJoinCode) return;
    setRegCode((prev) => (prev ? prev : urlJoinCode));
    setParticipantPanelOpen(true);
  }, [joinFlag, urlJoinCode]);

  useEffect(() => {
    setVerified(false);
    setJoinDivisions([]);
    setRegInfo(null);
    setRegError(null);
    setJoinDisabledByServer(false);
  }, [regCode]);

  useEffect(() => {
    if (regMe) {
      setParticipantPanelOpen((prev) => prev || joinFlag);
    }
  }, [joinFlag, regMe]);

  const nextParam = encodeURIComponent(location.pathname + location.search);

  const showManagerNav =
    tournament?.my_role === "ORGANIZER" || tournament?.my_role === "ASSISTANT";
  const showParticipantJoin = !showManagerNav;

  const withPublicContext = useCallback(
    (url: string) =>
      appendQueryParams(url, {
        code: code.trim() || undefined,
        division_id: effectiveDivisionId ?? undefined,
      }),
    [code, effectiveDivisionId]
  );

  const qs = useMemo(
    () =>
      appendQueryParams("", {
        code: code.trim() || undefined,
        division_id: effectiveDivisionId ?? undefined,
      }),
    [code, effectiveDivisionId]
  );


  const loadPublicDivisions = useCallback(
    async (fallback: DivisionSwitcherItem[] = []) => {
      if (!id) return fallback;

      try {
        const res = await apiFetch(
          appendQueryParams(`/api/tournaments/${id}/divisions/`, {
            code: code.trim() || undefined,
          }),
          { toastOnError: false }
        );

        if (!res.ok) return normalizeDivisionPayload(fallback);

        const payload = await res.json().catch(() => null);
        const publicDivisions = normalizeDivisionPayload(payload);
        const fallbackDivisions = normalizeDivisionPayload(fallback);

        return publicDivisions.length >= fallbackDivisions.length ? publicDivisions : fallbackDivisions;
      } catch {
        return normalizeDivisionPayload(fallback);
      }
    },
    [code, id]
  );

  const publicMatches = useMemo(() => matches.filter((m) => !isByePublic(m)), [matches]);
  const customMode = useMemo(() => usesCustomResults(tournament), [tournament]);
  const competitionModel = useMemo(() => getCompetitionModel(tournament), [tournament]);
  const isCustomMassStartMode = useMemo(
    () => customMode && competitionModel === "MASS_START",
    [competitionModel, customMode]
  );
  const publicLiveEnabled = useMemo(() => !isCustomMassStartMode, [isCustomMassStartMode]);
  const customDisciplineLabel = useMemo(() => getPublicDisciplineLabel(tournament), [tournament]);
  const customResultSummary = useMemo(() => getPublicResultModeSummary(tournament), [tournament]);
  const customResultConfig = useMemo(() => getResultConfig(tournament), [tournament]);
  const stageStructureMode = useMemo(() => getStageStructureMode(tournament), [tournament]);
  const isMassStartMultiEvent = isCustomMassStartMode && stageStructureMode === "MULTI_EVENT";
  const dateRange = formatDateRange(tournament?.start_date ?? null, tournament?.end_date ?? null);

  const activeDivisionOptions = useMemo<SelectOption<number>[]>(() => {
    return divisions
      .filter((division) => !(division as any).is_archived)
      .sort((left, right) => {
        const orderDiff = ((left as any).order ?? 0) - ((right as any).order ?? 0);
        if (orderDiff !== 0) return orderDiff;
        return left.id - right.id;
      })
      .map((division) => ({
        value: division.id,
        label: division.name,
      }));
  }, [divisions]);

  const currentDivisionValue =
    effectiveDivisionId ?? activeDivisionOptions[0]?.value ?? 0;

  const registrationDivisionOptions = useMemo<SelectOption<number>[]>(() => {
    return joinDivisions
      .filter((division) => !(division as any).is_archived)
      .sort((left, right) => {
        const orderDiff = ((left as any).order ?? 0) - ((right as any).order ?? 0);
        if (orderDiff !== 0) return orderDiff;
        return left.id - right.id;
      })
      .map((division) => ({
        value: division.id,
        label: division.name,
      }));
  }, [joinDivisions]);

  const joinDivisionOptions = verified && registrationDivisionOptions.length > 0
    ? registrationDivisionOptions
    : activeDivisionOptions;
  const selectedJoinDivisionId =
    joinDivisionId ?? joinDivisionOptions[0]?.value ?? null;
  const selectedJoinDivisionName = useMemo(() => {
    return joinDivisionOptions.find((option) => option.value === selectedJoinDivisionId)?.label ?? null;
  }, [joinDivisionOptions, selectedJoinDivisionId]);

  const currentParticipantDivisionValue = regMe?.division_id ?? currentDivisionValue;

  const targetDivisionOptions = useMemo<SelectOption<number>[]>(() => {
    return activeDivisionOptions.filter((option) => option.value !== currentParticipantDivisionValue);
  }, [activeDivisionOptions, currentParticipantDivisionValue]);

  useEffect(() => {
    if (joinDivisionOptions.length === 0) {
      setJoinDivisionId(null);
      return;
    }

    setJoinDivisionId((current) => {
      if (current && joinDivisionOptions.some((option) => option.value === current)) return current;
      if (effectiveDivisionId && joinDivisionOptions.some((option) => option.value === effectiveDivisionId)) {
        return effectiveDivisionId;
      }
      return joinDivisionOptions[0]?.value ?? null;
    });
  }, [effectiveDivisionId, joinDivisionOptions]);

  useEffect(() => {
    if (targetDivisionOptions.length === 0) {
      setTargetDivisionId(null);
      return;
    }

    setTargetDivisionId((current) =>
      current && targetDivisionOptions.some((option) => option.value === current)
        ? current
        : targetDivisionOptions[0]?.value ?? null
    );
  }, [targetDivisionOptions]);

  const matchesSectionLabel = isCustomMassStartMode
    ? isMassStartMultiEvent
      ? "Rezultaty konkurencji"
      : "Rezultaty etapowe"
    : customMode
      ? "Rezultaty"
      : "Mecze";

  const standingsSectionLabel = isCustomMassStartMode
    ? isMassStartMultiEvent
      ? "Klasyfikacja konkurencji"
      : "Ranking etapów"
    : customMode
      ? "Ranking / Drabinka"
      : "Tabela / Drabinka";

  const joinIsDisabledKnown =
    !regMe && (joinDisabledByServer || (tournament ? tournament.allow_join_by_code === false : false));

  const heroJoinLabel = useMemo(() => {
    if (joinIsDisabledKnown) return "Dołączanie wyłączone";
    if (regMe) return "Zarządzaj swoją rejestracją";
    if (showParticipantJoin) return "Dołącz do wydarzenia";
    return "Publiczny podgląd";
  }, [joinIsDisabledKnown, regMe, showParticipantJoin]);

  const isGoalSport = useMemo(() => {
    const d = (tournament?.discipline ?? "").toLowerCase();
    return (
      publicLiveEnabled &&
      !customMode &&
      (d.includes("piłka") ||
        d.includes("football") ||
        d.includes("ręczna") ||
        d.includes("handball"))
    );
  }, [customMode, publicLiveEnabled, tournament?.discipline]);

  const showTopScorers = Boolean(
    isGoalSport && tournament?.participants_public_preview_enabled
  );

  const shouldShowMyMatchesSection = Boolean(regMe && tournament?.is_published && publicLiveEnabled);

  const liveMatches = useMemo(
    () =>
      publicMatches.filter((m) => String(m.status ?? "").toUpperCase() === "IN_PROGRESS"),
    [publicMatches]
  );

  const plannedMatches = useMemo(
    () =>
      publicMatches
        .filter((m) => String(m.status ?? "").toUpperCase() === "PLANNED")
        .sort((a, b) => getMatchTimestamp(a) - getMatchTimestamp(b)),
    [publicMatches]
  );

  const finishedMatches = useMemo(
    () =>
      publicMatches
        .filter((m) => String(m.status ?? "").toUpperCase() === "FINISHED")
        .sort((a, b) => getMatchTimestamp(b) - getMatchTimestamp(a)),
    [publicMatches]
  );

  const spotlightLiveMatch = liveMatches[0] ?? null;
  const spotlightUpcomingMatch = plannedMatches[0] ?? null;
  const spotlightLatestMatch = finishedMatches[0] ?? null;

  const dynamicTabs = useMemo(() => {
    const base: Array<{ key: ViewTab; label: string; show: boolean }> = [
      { key: "OVERVIEW", label: "Przegląd", show: true },
      { key: "MATCHES", label: matchesSectionLabel, show: publicLiveEnabled },
      { key: "STANDINGS", label: standingsSectionLabel, show: true },
      {
        key: "STATS",
        label: isCustomMassStartMode ? "Podsumowanie" : "Statystyki",
        show: showTopScorers || Boolean(regMe) || isCustomMassStartMode,
      },
    ];

    return base.filter((item) => item.show);
  }, [isCustomMassStartMode, matchesSectionLabel, publicLiveEnabled, regMe, showTopScorers, standingsSectionLabel]);

  useEffect(() => {
    if (isCustomMassStartMode && view === "MATCHES") {
      setView("STANDINGS");
    }
  }, [isCustomMassStartMode, view]);

  useEffect(() => {
    if (!dynamicTabs.some((tab) => tab.key === view)) {
      setView(isCustomMassStartMode ? "STANDINGS" : "OVERVIEW");
    }
  }, [dynamicTabs, isCustomMassStartMode, view]);

  const handleDivisionSwitch = useCallback(
    (nextDivisionId: number) => {
      if (nextDivisionId === effectiveDivisionId) return;
      const next = new URLSearchParams(searchParamsKey);
      next.set("division_id", String(nextDivisionId));
      setSearchParams(next, { replace: false });
    },
    [effectiveDivisionId, searchParamsKey, setSearchParams]
  );

  useEffect(() => {
    if (selectedMatchId == null) return;

    const onDown = (e: MouseEvent) => {
      const root = matchesPanelRef.current;
      if (!root) return;
      const target = e.target as EventTarget | null;
      if (target instanceof Node && !root.contains(target)) {
        setSelectedMatchId(null);
        setSelectedSection(null);
      }
    };

    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [selectedMatchId]);

  const loadIncidentsForMatch = async (matchId: number) => {
    if (!id || !publicLiveEnabled) return;
    setIncError(null);
    setIncBusy(true);

    try {
      const res = await apiFetch(`/api/matches/${matchId}/incidents/${qs}`, {
        toastOnError: false,
      });
      if (!res.ok) throw new Error("Nie udało się pobrać incydentów.");
      const data = (await res.json().catch(() => null)) as IncidentPublicDTO[] | null;

      const sorted = Array.isArray(data)
        ? [...data].sort((a, b) => {
            const ma = incidentMinute(a) ?? 1e9;
            const mb = incidentMinute(b) ?? 1e9;
            if (ma !== mb) return ma - mb;
            return (a.id ?? 0) - (b.id ?? 0);
          })
        : [];

      setIncidentsByMatch((prev) => ({ ...prev, [matchId]: sorted }));
    } catch (e: any) {
      setIncError(e?.message ?? "Błąd pobierania incydentów.");
    } finally {
      setIncBusy(false);
    }
  };

  const loadCommentaryForMatch = async (matchId: number) => {
    if (!id || !publicLiveEnabled) return;
    setComError(null);
    setComBusy(true);

    try {
      const res = await apiFetch(`/api/matches/${matchId}/commentary/${qs}`, {
        toastOnError: false,
      });
      if (!res.ok) throw new Error("Nie udało się pobrać komentarza.");
      const data = (await res.json().catch(() => null)) as CommentaryEntryPublicDTO[] | null;

      const sorted = Array.isArray(data)
        ? [...data].sort((a, b) => {
            const ma = a.minute ?? 1e9;
            const mb = b.minute ?? 1e9;
            if (ma !== mb) return ma - mb;
            return (a.id ?? 0) - (b.id ?? 0);
          })
        : [];

      setCommentaryByMatch((prev) => ({ ...prev, [matchId]: sorted }));
    } catch (e: any) {
      setComError(e?.message ?? "Błąd pobierania komentarza.");
    } finally {
      setComBusy(false);
    }
  };

  const onPublicMatchClick = async (match: MatchPublicDTO, sectionId: string) => {
    if (!match || !publicLiveEnabled) return;

    const isExpandable = match.status === "IN_PROGRESS" || match.status === "FINISHED";
    if (!isExpandable) return;

    const matchId = match.id;
    const sameTarget = selectedMatchId === matchId && selectedSection === sectionId;

    if (sameTarget) {
      setSelectedMatchId(null);
      setSelectedSection(null);
      return;
    }

    setSelectedMatchId(matchId);
    setSelectedSection(sectionId);

    if (!incidentsByMatch[matchId]) await loadIncidentsForMatch(matchId);
    if (!commentaryByMatch[matchId]) await loadCommentaryForMatch(matchId);
  };

  const computeTopScorers = useCallback(async () => {
    if (!showTopScorers) return;
    setScorerError(null);
    setScorerBusy(true);

    try {
      const perMatch: Record<number, IncidentPublicDTO[]> = {};
      for (const match of publicMatches) {
        if (incidentsByMatch[match.id]) {
          perMatch[match.id] = incidentsByMatch[match.id];
          continue;
        }

        const res = await apiFetch(`/api/matches/${match.id}/incidents/${qs}`, {
          toastOnError: false,
        });
        if (!res.ok) continue;
        const data = (await res.json().catch(() => null)) as IncidentPublicDTO[] | null;
        perMatch[match.id] = Array.isArray(data) ? data : [];
      }

      const counts = new Map<string, number>();
      for (const incidents of Object.values(perMatch)) {
        for (const inc of incidents) {
          const kind = ((inc as any).type ?? (inc as any).kind ?? "").toString().toUpperCase();
          if (kind !== "GOAL") continue;
          const name = normalizeName(
            ((inc as any).player_name ?? (inc as any).player ?? "").toString()
          );
          if (!name) continue;
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
      }

      const rows = Array.from(counts.entries())
        .map(([player_name, goals]) => ({ player_name, goals }))
        .sort((a, b) => {
          if (b.goals !== a.goals) return b.goals - a.goals;
          return a.player_name.localeCompare(b.player_name);
        });

      setScorers(rows);
    } catch (e: any) {
      setScorerError(e?.message ?? "Błąd liczenia strzelców.");
    } finally {
      setScorerBusy(false);
    }
  }, [incidentsByMatch, publicMatches, qs, showTopScorers]);

  useEffect(() => {
    if (view !== "STATS" || !showTopScorers || scorerBusy || scorers.length > 0) return;
    void computeTopScorers();
  }, [computeTopScorers, scorerBusy, scorers.length, showTopScorers, view]);

  const nameChangeApprovalRequired = useMemo(() => {
    const t = tournament as any;
    if (!t) return false;
    if (typeof t.participants_self_rename_enabled === "boolean") return !t.participants_self_rename_enabled;
    if (typeof t.participants_self_rename_requires_approval === "boolean")
      return !!t.participants_self_rename_requires_approval;
    if (typeof t.participants_self_rename_approval_required === "boolean")
      return !!t.participants_self_rename_approval_required;
    return false;
  }, [tournament]);

  const loadMyMatches = useCallback(async () => {
    if (!id || !isLogged || isCustomMassStartMode) {
      setMyMatches([]);
      return;
    }

    try {
      const res = await apiFetch(
        appendQueryParams(`/api/tournaments/${id}/registrations/my/matches/`, {
          division_id: effectiveDivisionId ?? undefined,
        }),
        { toastOnError: false }
      );
      if (!res.ok) return;
      const data = await res.json().catch(() => []);
      const list: MatchPublicDTO[] = Array.isArray(data) ? data : [];
      setMyMatches(list.filter((m) => !isByePublic(m)));
    } catch {
      return;
    }
  }, [effectiveDivisionId, id, isCustomMassStartMode, isLogged]);

  const loadMyPendingNameChange = useCallback(
    async (teamId: number | null, divisionId?: number | null) => {
      if (!id || !teamId) {
        setPendingNameReq(null);
        return;
      }

      try {
        const res = await apiFetch(
          appendQueryParams(`/api/tournaments/${id}/teams/name-change-requests/`, {
            status: "PENDING",
            team_id: teamId,
            division_id: divisionId ?? effectiveDivisionId ?? undefined,
          }),
          { toastOnError: false }
        );

        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        const list = extractList(data) as any[];
        const first = list?.[0] ?? null;

        if (first) {
          setPendingNameReq({
            id: first.id,
            status: first.status,
            old_name: first.old_name,
            requested_name: first.requested_name,
            created_at: first.created_at,
          });
        } else {
          setPendingNameReq(null);
        }
      } catch {
        return;
      }
    },
    [effectiveDivisionId, id]
  );

  const loadMyPendingDivisionChange = useCallback(async (divisionId?: number | null) => {
    if (!id) {
      setPendingDivisionReq(null);
      return;
    }

    try {
      const res = await apiFetch(
        appendQueryParams(`/api/tournaments/${id}/teams/division-change-requests/`, {
          status: "PENDING",
          division_id: divisionId ?? effectiveDivisionId ?? undefined,
        }),
        { toastOnError: false }
      );

      if (!res.ok) {
        setPendingDivisionReq(null);
        return;
      }

      const data = await res.json().catch(() => null);
      const first = extractList(data)?.[0] ?? null;

      if (first) {
        setPendingDivisionReq({
          id: first.id,
          status: first.status,
          team_name: first.team_name ?? null,
          from_division_name: first.from_division_name ?? null,
          to_division_id: first.to_division_id ?? null,
          to_division_name: first.to_division_name ?? null,
          created_at: first.created_at,
        });
      } else {
        setPendingDivisionReq(null);
      }
    } catch {
      setPendingDivisionReq(null);
    }
  }, [effectiveDivisionId, id]);

  const loadTournamentAndMatches = useCallback(async () => {
    if (!id) return;

    try {
      setTournamentLoaded(false);
      setError(null);
      setLoadingGate(true);

      const tRes = await apiFetch(withPublicContext(`/api/tournaments/${id}/`), {
        toastOnError: false,
      });
      if (tRes.status === 403) {
        const data = await tRes.json().catch(() => null);
        const msg = data?.detail || "Brak dostępu.";
        setNeedsCode(String(msg).toLowerCase().includes("kod"));
        setTournament(null);
        setMatches([]);
        setError(msg);
        setTournamentLoaded(false);
        return;
      }

      if (!tRes.ok) throw new Error("Nie udało się pobrać danych turnieju.");
      setNeedsCode(false);

      const tData = await tRes.json().catch(() => ({}));
      const t: TournamentPublicDTO = {
        id: tData.id,
        name: tData.name,
        description: tData.description ?? null,
        discipline: Object.prototype.hasOwnProperty.call(tData, "discipline")
          ? (tData.discipline ?? null)
          : null,
        custom_discipline_name: Object.prototype.hasOwnProperty.call(
          tData,
          "custom_discipline_name"
        )
          ? (tData.custom_discipline_name ?? null)
          : null,
        result_mode: Object.prototype.hasOwnProperty.call(tData, "result_mode")
          ? (tData.result_mode ?? "SCORE")
          : "SCORE",
        competition_model: Object.prototype.hasOwnProperty.call(tData, "competition_model")
          ? (tData.competition_model ?? null)
          : null,
        result_config:
          tData && typeof tData.result_config === "object" && tData.result_config
            ? tData.result_config
            : undefined,
        start_date: tData.start_date ?? null,
        end_date: tData.end_date ?? null,
        location: tData.location ?? null,
        is_published: tData.is_published,
        divisions: Array.isArray(tData.divisions) ? (tData.divisions as DivisionSwitcherItem[]) : [],
        active_division_id: tData.active_division_id ?? null,
        active_division_name: tData.active_division_name ?? null,
        entry_mode: tData.entry_mode,
        competition_type: tData.competition_type,
        my_role: tData.my_role ?? null,
        allow_join_by_code: Object.prototype.hasOwnProperty.call(tData, "allow_join_by_code")
          ? Boolean(tData.allow_join_by_code)
          : undefined,
        join_code: Object.prototype.hasOwnProperty.call(tData, "join_code")
          ? (tData.join_code ?? null)
          : undefined,
        participants_public_preview_enabled: Object.prototype.hasOwnProperty.call(
          tData,
          "participants_public_preview_enabled"
        )
          ? Boolean(tData.participants_public_preview_enabled)
          : undefined,
        participants_self_rename_enabled: Object.prototype.hasOwnProperty.call(
          tData,
          "participants_self_rename_enabled"
        )
          ? Boolean(tData.participants_self_rename_enabled)
          : undefined,
        participants_self_rename_requires_approval:
          Object.prototype.hasOwnProperty.call(
            tData,
            "participants_self_rename_requires_approval"
          )
            ? Boolean(tData.participants_self_rename_requires_approval)
            : undefined,
        participants_self_rename_approval_required:
          Object.prototype.hasOwnProperty.call(
            tData,
            "participants_self_rename_approval_required"
          )
            ? Boolean(tData.participants_self_rename_approval_required)
            : undefined,
      };

      const fallbackDivisions = buildDivisionFallback(t, Array.isArray(t.divisions) ? t.divisions : []);
      const divisionsPayload = await loadPublicDivisions(fallbackDivisions);
      const safeDivisionsPayload = divisionsPayload.length > 0 ? divisionsPayload : fallbackDivisions;
      const tournamentWithDivisions: TournamentPublicDTO = {
        ...t,
        divisions: safeDivisionsPayload,
      };

      setTournament(tournamentWithDivisions);
      setDivisions(safeDivisionsPayload);
      setActiveDivisionId(t.active_division_id ?? effectiveDivisionId ?? null);
      setActiveDivisionName(t.active_division_name ?? null);
      setTournamentLoaded(true);

      if (!requestedDivisionId && t.active_division_id && divisionsPayload.length > 1) {
        const next = new URLSearchParams(searchParamsKey);
        next.set("division_id", String(t.active_division_id));
        setSearchParams(next, { replace: true });
      }

      const isMassStart =
        String(t.result_mode ?? "SCORE").toUpperCase() === "CUSTOM" &&
        String(t.competition_model ?? "").toUpperCase() === "MASS_START";

      if (isMassStart) {
        setMatches([]);
        return;
      }

      const resolvedDivisionId = t.active_division_id ?? effectiveDivisionId ?? null;
      const mRes = await apiFetch(
        appendQueryParams(`/api/tournaments/${id}/public/matches/`, {
          code: code.trim() || undefined,
          division_id: resolvedDivisionId ?? undefined,
        }),
        { toastOnError: false }
      );

      if (mRes.status === 403) {
        const data = await mRes.json().catch(() => null);
        const msg = data?.detail || "Brak dostępu.";
        if (String(msg).toLowerCase().includes("kod")) setNeedsCode(true);
        setMatches([]);
        setError((prev) => prev ?? msg);
        setTournamentLoaded(false);
        return;
      }

      if (!mRes.ok) throw new Error("Nie udało się pobrać meczów.");
      const raw = await mRes.json().catch(() => []);
      const list: MatchPublicDTO[] = Array.isArray(raw)
        ? raw
        : Array.isArray((raw as any)?.results)
          ? (raw as any).results
          : [];
      setMatches(list);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Wystąpił błąd.";
      setTournament(null);
      setMatches([]);
      setTournamentLoaded(false);
      setError(msg);
    } finally {
      setLoadingGate(false);
    }
  }, [
    code,
    effectiveDivisionId,
    id,
    loadPublicDivisions,
    requestedDivisionId,
    searchParamsKey,
    setSearchParams,
    withPublicContext,
  ]);

  const loadRegistrationMe = useCallback(async () => {
    if (!id || !isLogged) {
      setRegMe(null);
      setPendingNameReq(null);
      setPendingDivisionReq(null);
      return;
    }

    if (!tournamentLoaded) return;
    if (!showParticipantJoin && !joinFlag) {
      setRegMe(null);
      setPendingNameReq(null);
      setPendingDivisionReq(null);
      return;
    }

    const candidateDivisionIds = Array.from(
      new Set(
        [
          effectiveDivisionId,
          requestedDivisionId,
          activeDivisionId,
          ...divisions.map((division) => division.id),
          null,
        ].filter((divisionId): divisionId is number | null =>
          divisionId === null || (Number.isInteger(divisionId) && divisionId > 0)
        )
      )
    );

    for (const candidateDivisionId of candidateDivisionIds) {
      const res = await apiFetch(
        appendQueryParams(`/api/tournaments/${id}/registrations/me/`, {
          division_id: candidateDivisionId ?? undefined,
        }),
        { toastOnError: false }
      );

      if (res.status === 404 || !res.ok) continue;

      const data = (await res.json().catch(() => null)) as RegistrationMeDTO | null;
      if (!data?.display_name) continue;

      const resolvedDivisionId = data.division_id ?? candidateDivisionId ?? effectiveDivisionId ?? null;
      const resolvedDivisionName =
        data.division_name ??
        divisions.find((division) => division.id === resolvedDivisionId)?.name ??
        activeDivisionName ??
        null;

      setRegMe({
        display_name: data.display_name,
        team_id: data.team_id ?? null,
        division_id: resolvedDivisionId,
        division_name: resolvedDivisionName,
      });
      setDisplayName(data.display_name);
      await loadMyPendingNameChange(data.team_id ?? null, resolvedDivisionId);
      await loadMyPendingDivisionChange(resolvedDivisionId);

      if (resolvedDivisionId && resolvedDivisionId !== effectiveDivisionId) {
        const next = new URLSearchParams(searchParamsKey);
        next.set("division_id", String(resolvedDivisionId));
        setSearchParams(next, { replace: true });
      } else {
        loadMyMatches();
      }

      return;
    }

    setRegMe(null);
    setPendingNameReq(null);
    setPendingDivisionReq(null);
  }, [
    activeDivisionId,
    activeDivisionName,
    divisions,
    effectiveDivisionId,
    id,
    isLogged,
    joinFlag,
    loadMyMatches,
    loadMyPendingDivisionChange,
    loadMyPendingNameChange,
    requestedDivisionId,
    searchParamsKey,
    setSearchParams,
    showParticipantJoin,
    tournamentLoaded,
  ]);

  useEffect(() => {
    loadTournamentAndMatches().catch((e: any) => setError(e.message));
  }, [loadTournamentAndMatches]);

  const reloadMatchesOnly = useCallback(async () => {
    if (!id || isCustomMassStartMode) return;

    try {
      const matchesRes = await apiFetch(
        appendQueryParams(`/api/tournaments/${id}/public/matches/`, {
          code: code.trim() || undefined,
          division_id: effectiveDivisionId ?? undefined,
        })
      );

      if (matchesRes.status === 403) {
        setNeedsCode(true);
        return;
      }
      if (!matchesRes.ok) return;

      const raw = await matchesRes.json();
      setMatches(normalizePublicMatches(raw));
    } catch {
      return;
    }
  }, [code, effectiveDivisionId, id, isCustomMassStartMode]);

  const requestMatchesReload = useCallback(() => {
    if (wsReloadTimerRef.current) return;
    wsReloadTimerRef.current = window.setTimeout(() => {
      wsReloadTimerRef.current = null;
      void reloadMatchesOnly();
    }, 250);
  }, [reloadMatchesOnly]);

  useTournamentWs({
    tournamentId,
    enabled: Boolean(tournamentId),
    onEvent: ({ event, payload }) => {
      const normalized = String(event).split(".").join("_");

      if (normalized === "mass_start_results_changed") {
        setStandingsRefreshKey((prev) => prev + 1);
        return;
      }

      if (normalized === "matches_changed") {
        requestMatchesReload();
        setStandingsRefreshKey((prev) => prev + 1);
        return;
      }

      if (
        normalized === "incidents_changed" ||
        normalized === "clock_changed" ||
        normalized === "commentary_changed"
      ) {
        requestMatchesReload();
        return;
      }

      if (payload && typeof payload === "object" && "match_id" in (payload as any)) {
        requestMatchesReload();
      }
    },
  });

  useEffect(() => {
    return () => {
      if (wsReloadTimerRef.current) window.clearTimeout(wsReloadTimerRef.current);
      wsReloadTimerRef.current = null;
    };
  }, []);

  useEffect(() => {
    loadRegistrationMe();
  }, [loadRegistrationMe]);

  const verifyRegistrationCode = async () => {
    if (!id) return;
    const c = regCode.trim();
    if (!c) {
      setRegError("Wpisz kod dołączania.");
      return;
    }

    setRegBusy(true);
    setRegError(null);
    setRegInfo(null);

    try {
      const res = await apiFetch(`/api/tournaments/${id}/registrations/verify/`, {
        toastOnError: false,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: c }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = data?.detail ?? "Nieprawidłowy kod.";
        if (looksLikeJoinDisabledMessage(String(msg))) setJoinDisabledByServer(true);
        setRegError(msg);
        return;
      }

      const verifiedDivisions = normalizeDivisionPayload(data?.divisions);
      if (verifiedDivisions.length === 0) {
        setVerified(false);
        setJoinDivisions([]);
        setRegError("Brak dywizji dostępnych do dołączenia.");
        return;
      }

      setDivisions(verifiedDivisions);
      setJoinDivisions(verifiedDivisions);
      setTournament((current) => (current ? { ...current, divisions: verifiedDivisions } : current));
      setJoinDivisionId((current) => {
        if (current && verifiedDivisions.some((division) => division.id === current)) return current;
        const verifiedDivisionId = parseDivisionId(String(data?.division_id ?? ""));
        if (verifiedDivisionId && verifiedDivisions.some((division) => division.id === verifiedDivisionId)) {
          return verifiedDivisionId;
        }
        return verifiedDivisions[0]?.id ?? null;
      });

      setVerified(true);
      setRegInfo(
        verifiedDivisions.length > 1
          ? "Kod poprawny. Wybierz dywizję, uzupełnij nazwę i dołącz."
          : "Kod poprawny. Uzupełnij nazwę i dołącz."
      );
    } catch (e: any) {
      setRegError(e?.message ?? "Błąd weryfikacji kodu.");
    } finally {
      setRegBusy(false);
    }
  };

  const joinTournament = async () => {
    if (!id) return;
    const c = regCode.trim();
    const dn = normalizeName(displayName);

    if (!c) {
      setRegError("Wpisz kod dołączania.");
      return;
    }
    if (!dn) {
      setRegError("Wpisz nazwę.");
      return;
    }

    const divisionIdForJoin = selectedJoinDivisionId;
    if (!verified) {
      setRegError("Najpierw sprawdź kod dołączania.");
      return;
    }
    if (!divisionIdForJoin) {
      setRegError("Wybierz dywizję.");
      return;
    }

    setRegBusy(true);
    setRegError(null);
    setRegInfo(null);

    try {
      const res = await apiFetch(
        appendQueryParams(`/api/tournaments/${id}/registrations/join/`, {
          division_id: divisionIdForJoin ?? undefined,
        }),
        {
          toastOnError: false,
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: c, display_name: dn }),
        }
      );

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = data?.detail ?? "Nie udało się dołączyć.";
        if (looksLikeJoinDisabledMessage(String(msg))) setJoinDisabledByServer(true);
        setRegError(msg);
        return;
      }

      const joinedDivisionId =
        parseDivisionId(String(data?.division_id ?? "")) ?? divisionIdForJoin ?? null;
      const joinedDivisionName =
        joinDivisionOptions.find((option) => option.value === joinedDivisionId)?.label ??
        selectedJoinDivisionName ??
        activeDivisionName ??
        null;

      setRegInfo("Dołączono do turnieju.");
      setVerified(false);
      setJoinDivisions([]);
      setJoinDisabledByServer(false);
      setRegMe({
        display_name: data?.display_name ?? dn,
        team_id: data?.team_id ?? null,
        division_id: joinedDivisionId,
        division_name: joinedDivisionName,
      });
      setDisplayName(data?.display_name ?? dn);

      const next = new URLSearchParams();
      if (code.trim()) next.set("code", code.trim());
      if (joinedDivisionId) next.set("division_id", String(joinedDivisionId));
      const nextQuery = next.toString();
      navigate(`${location.pathname}${nextQuery ? `?${nextQuery}` : ""}`, { replace: true });
    } catch (e: any) {
      setRegError(e?.message ?? "Błąd dołączania.");
    } finally {
      setRegBusy(false);
    }
  };

  const renameRegistrationImmediate = async (dn: string) => {
    if (!id) return;

    const res = await apiFetch(
      appendQueryParams(`/api/tournaments/${id}/registrations/me/`, {
        division_id: effectiveDivisionId ?? undefined,
      }),
      {
        toastOnError: false,
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: dn }),
      }
    );

    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.detail ?? "Nie udało się zmienić nazwy.");

    setRegInfo("Zmieniono nazwę.");
    await loadRegistrationMe();
  };

  const requestNameChangeApproval = async (dn: string) => {
    if (!id) return;

    const res = await apiFetch(
      appendQueryParams(`/api/tournaments/${id}/teams/name-change-requests/`, {
        division_id: regMe?.division_id ?? effectiveDivisionId ?? undefined,
      }),
      {
        toastOnError: false,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ team_id: regMe?.team_id, requested_name: dn }),
      }
    );

    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.detail ?? "Nie udało się wysłać prośby.");

    setRegInfo("Wysłano prośbę o zmianę nazwy.");
    await loadMyPendingNameChange(regMe?.team_id ?? null, regMe?.division_id ?? effectiveDivisionId ?? null);
  };

  const requestDivisionChange = async () => {
    if (!id || !isLogged) return;

    if (!targetDivisionId) {
      setRegError("Wybierz dywizję docelową.");
      return;
    }

    if (pendingDivisionReq?.status === "PENDING") {
      setRegInfo("Masz już oczekującą prośbę o zmianę dywizji. Poczekaj na decyzję organizatora.");
      return;
    }

    setRegBusy(true);
    setRegError(null);
    setRegInfo(null);

    try {
      const res = await apiFetch(
        appendQueryParams(`/api/tournaments/${id}/teams/division-change-requests/`, {
          division_id: regMe?.division_id ?? effectiveDivisionId ?? undefined,
        }),
        {
          toastOnError: false,
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target_division_id: targetDivisionId }),
        }
      );

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.detail ?? "Nie udało się wysłać prośby o zmianę dywizji.");
      }

      setRegInfo("Wysłano prośbę o zmianę dywizji.");
      await loadMyPendingDivisionChange();
    } catch (e: any) {
      setRegError(e?.message ?? "Błąd wysyłania prośby o zmianę dywizji.");
    } finally {
      setRegBusy(false);
    }
  };

  const handleRenameOrRequest = async () => {
    if (!id || !isLogged) return;

    const dn = normalizeName(displayName);
    if (!dn) {
      setRegError("Wpisz nazwę.");
      return;
    }

    if (pendingNameReq?.status === "PENDING") {
      setRegInfo("Masz już oczekującą prośbę o zmianę nazwy. Poczekaj na decyzję organizatora.");
      return;
    }

    setRegBusy(true);
    try {
      if (nameChangeApprovalRequired) {
        await requestNameChangeApproval(dn);
        return;
      }

      await renameRegistrationImmediate(dn);
    } catch (e: any) {
      const msg = e?.message ?? "Błąd zmiany nazwy.";
      if (looksLikeRenameRequiresApprovalMessage(msg)) {
        try {
          await requestNameChangeApproval(dn);
          return;
        } catch (e2: any) {
          setRegError(e2?.message ?? msg);
          return;
        }
      }
      setRegError(msg);
    } finally {
      setRegBusy(false);
    }
  };

  const renderOverview = () => {
    if (isCustomMassStartMode) {
      return (
        <SectionShell
          eyebrow="Przegląd"
          title={isMassStartMultiEvent ? "Klasyfikacja konkurencji" : "Ranking wydarzenia"}
          right={
            <Button
              type="button"
              variant="secondary"
              onClick={() => setView("STANDINGS")}
              rightIcon={<ChevronRight className="h-4 w-4" />}
            >
              Otwórz ranking
            </Button>
          }
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <SummaryCard
              icon={<Medal className="h-5 w-5" />}
              label="Tryb"
              value="Wszyscy razem"
              desc={isMassStartMultiEvent ? "Głównym widokiem jest klasyfikacja uczestników w osobnych konkurencjach wydarzenia." : "Głównym widokiem jest klasyfikacja uczestników i rezultatów etapowych."}
            />
            <SummaryCard
              icon={<Gauge className="h-5 w-5" />}
              label="Model wyniku"
              value={customDisciplineLabel ?? "Niestandardowy"}
              desc={customResultSummary ?? "Wynik i ranking zależą od konfiguracji wydarzenia."}
            />
            <SummaryCard
              icon={<BarChart3 className="h-5 w-5" />}
              label="Widok"
              value="Ranking publiczny"
              desc="Zmieniaj dywizję i śledź klasyfikację bez przechodzenia do panelu organizatora."
            />
          </div>
        </SectionShell>
      );
    }

    return (
      <SectionShell eyebrow="Przegląd" title="Najważniejsze mecze">
        <div className="grid gap-3 xl:grid-cols-3">
          {spotlightLiveMatch ? <PublicEventMatchCard match={spotlightLiveMatch} isLive /> : null}
          {spotlightUpcomingMatch ? <PublicEventMatchCard match={spotlightUpcomingMatch} /> : null}
          {spotlightLatestMatch ? <PublicEventMatchCard match={spotlightLatestMatch} isLatest /> : null}
          {!spotlightLiveMatch && !spotlightUpcomingMatch && !spotlightLatestMatch ? (
            <Card className="bg-white/[0.04] p-5 text-sm text-slate-300">
              Brak spotkań do wyświetlenia.
            </Card>
          ) : null}
        </div>
      </SectionShell>
    );
  };

  const renderMatches = () => {
    if (!publicLiveEnabled) return null;

    return (
      <SectionShell
        eyebrow="Mecze i relacja"
        title={matchesSectionLabel}
      >
        <div ref={matchesPanelRef}>
          <PublicMatchesPanel
            matches={publicMatches}
            selectedMatchId={selectedMatchId}
            selectedSection={selectedSection}
            incidentsByMatch={incidentsByMatch}
            incidentsBusy={incBusy}
            incidentsError={incError}
            commentaryByMatch={commentaryByMatch}
            commentaryBusy={comBusy}
            commentaryError={comError}
            onMatchClick={onPublicMatchClick}
          />
        </div>
      </SectionShell>
    );
  };

  const renderStandings = () => {
    if (!id) return null;

    return (
      <SectionShell
        eyebrow="Klasyfikacja"
        title={standingsSectionLabel}
      >
        {isCustomMassStartMode ? (
          <PublicMassStartStandings
            key={`mass-start-${id}-${code.trim()}-${standingsRefreshKey}`}
            tournamentId={Number(id)}
            divisionId={effectiveDivisionId ?? undefined}
            accessCode={code.trim() || undefined}
            refreshKey={standingsRefreshKey}
            resultConfig={customResultConfig}
            stageStructureMode={stageStructureMode}
          />
        ) : (
          <StandingsBracket
            key={`${id}-${code.trim()}-${standingsRefreshKey}`}
            tournamentId={Number(id)}
            divisionId={effectiveDivisionId ?? undefined}
            accessCode={code.trim() || undefined}
          />
        )}
      </SectionShell>
    );
  };

  const renderStats = () => {
    if (isCustomMassStartMode) {
      return (
        <SectionShell
          eyebrow="Podsumowanie"
          title={isMassStartMultiEvent ? "Jak oglądać wydarzenie z konkurencjami" : "Jak oglądać wydarzenie etapowe"}
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <SummaryCard
              icon={<Medal className="h-5 w-5" />}
              label="Najważniejszy ekran"
              value={isMassStartMultiEvent ? "Klasyfikacja konkurencji" : "Ranking etapów"}
              desc={isMassStartMultiEvent ? "To właśnie klasyfikacja pokazuje aktualną pozycję uczestników w każdej konkurencji wydarzenia." : "To właśnie ranking pokazuje aktualną pozycję uczestników i buduje narrację wydarzenia od startu do finału."}
            />
            <SummaryCard
              icon={<Gauge className="h-5 w-5" />}
              label="Rodzaj wyniku"
              value={customDisciplineLabel ?? "Wynik niestandardowy"}
              desc={customResultSummary ?? "Szczegóły klasyfikacji wynikają z konfiguracji organizatora."}
            />
            <SummaryCard
              icon={<LayoutGrid className="h-5 w-5" />}
              label="Układ wydarzenia"
              value={activeDivisionName ?? "Jedna klasyfikacja"}
              desc="Dywizje mogą porządkować konkurencje, kategorie lub równoległe przebiegi rywalizacji."
            />
          </div>
        </SectionShell>
      );
    }

    return (
      <div className="grid gap-6 xl:grid-cols-[0.98fr_1.02fr]">
        {showTopScorers ? (
          <SectionShell
            eyebrow="Statystyki"
            title="Król strzelców"
            right={
              <Button
                type="button"
                variant="secondary"
                onClick={computeTopScorers}
                disabled={scorerBusy}
              >
                {scorerBusy ? "Liczenie..." : scorers.length > 0 ? "Odśwież" : "Policz ranking"}
              </Button>
            }
          >
            {scorerError ? <InlineAlert variant="error">{scorerError}</InlineAlert> : null}

            {scorers.length === 0 ? (
              <Card className="bg-white/[0.04] p-5 text-sm leading-relaxed text-slate-300">
                Brak danych do rankingu strzelców albo nie zostały jeszcze opublikowane odpowiednie incydenty.
              </Card>
            ) : (
              <Card className="bg-white/[0.04] p-4">
                <div className="divide-y divide-white/10">
                  {scorers.slice(0, 10).map((row, index) => (
                    <div
                      key={row.player_name}
                      className="flex items-center justify-between gap-3 py-3"
                    >
                      <div className="flex items-center gap-3">
                        <div className="grid h-8 w-8 place-items-center rounded-xl border border-white/10 bg-white/[0.06] text-xs font-semibold text-slate-200">
                          {index + 1}
                        </div>
                        <div className="break-words text-sm font-semibold text-slate-100">
                          {row.player_name}
                        </div>
                      </div>
                      <div className="text-sm font-semibold text-slate-100">{row.goals}</div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </SectionShell>
        ) : null}

        {!showTopScorers ? (
          <SectionShell
            eyebrow="Statystyki"
            title="Podsumowanie publicznego widoku"
          >
            <div className="grid gap-3 md:grid-cols-2">
              <SummaryCard
                icon={<LayoutGrid className="h-5 w-5" />}
                label="Przegląd"
                value="Najważniejsze informacje"
                desc="Hero oraz sekcja przeglądu pokazują stan wydarzenia bez potrzeby czytania całego harmonogramu."
              />
              <SummaryCard
                icon={<BarChart3 className="h-5 w-5" />}
                label="Klasyfikacja"
                value={standingsSectionLabel}
                desc="Tabela, drabinka lub ranking są zawsze dostępne w jednej z głównych zakładek widoku publicznego."
              />
            </div>
          </SectionShell>
        ) : null}
      </div>
    );
  };

  const renderParticipantPanel = () => {
    if (!showParticipantJoin && !regMe) return null;

    return (
      <DrawerPanel
        open={participantPanelOpen}
        onClose={() => setParticipantPanelOpen(false)}
        title={regMe ? "Zarządzaj swoją rejestracją" : "Dołącz do wydarzenia"}
        subtitle={
          regMe
            ? "Tutaj sprawdzisz swój status, poprawisz nazwę, zmienisz dywizję i zobaczysz skrót własnych spotkań."
            : "Cała logika dołączania zostaje zachowana, ale nie dominuje głównego widoku dla widza."
        }
      >
        {!isLogged ? (
          <div className="space-y-4">
            <InlineAlert variant="info" title="Wymagane logowanie">
              Aby dołączyć do wydarzenia, musisz się zalogować lub utworzyć konto.
            </InlineAlert>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => navigate(`/login?next=${nextParam}`)}
              >
                Zaloguj
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => navigate(`/login?mode=register&next=${nextParam}`)}
              >
                Zarejestruj konto
              </Button>
            </div>
          </div>
        ) : joinIsDisabledKnown ? (
          <div className="space-y-4">
            <InlineAlert variant="info" title="Dołączanie jest wyłączone">
              Organizator nie włączył opcji dołączania przez konto i kod dla tego wydarzenia.
            </InlineAlert>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => loadTournamentAndMatches().catch(() => null)}
              >
                Odśwież
              </Button>
              <Button type="button" variant="ghost" onClick={() => setParticipantPanelOpen(false)}>
                Wróć do widoku publicznego
              </Button>
            </div>
          </div>
        ) : regMe ? (
          <div className="space-y-4">
            <Card className="bg-white/[0.04] p-4">
              <div className="text-sm text-slate-300">Jesteś zapisany jako</div>
              <div className="mt-1 break-words text-lg font-semibold text-white">
                {regMe.display_name}
              </div>
              {nameChangeApprovalRequired ? (
                <div className="mt-3 text-sm leading-relaxed text-slate-300">
                  Zmiana nazwy wymaga akceptacji organizatora, dlatego zostanie wysłana jako prośba.
                </div>
              ) : null}
            </Card>

            {pendingNameReq?.status === "PENDING" ? (
              <InlineAlert variant="info" title="Oczekująca prośba">
                {pendingNameReq.old_name
                  ? `${pendingNameReq.old_name} → ${pendingNameReq.requested_name ?? "..."}`
                  : `Nowa nazwa: ${pendingNameReq.requested_name ?? "..."}`}
              </InlineAlert>
            ) : null}

            <div className="grid gap-2">
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={
                  tournament?.competition_type === "INDIVIDUAL"
                    ? "Imię i nazwisko"
                    : "Nazwa drużyny / imię i nazwisko"
                }
              />
              <Button
                type="button"
                onClick={handleRenameOrRequest}
                disabled={regBusy || pendingNameReq?.status === "PENDING"}
              >
                {regBusy
                  ? "Zapisywanie..."
                  : nameChangeApprovalRequired
                    ? "Wyślij prośbę o zmianę"
                    : "Zmień nazwę"}
              </Button>
            </div>

            {activeDivisionOptions.length > 1 ? (
              <Card className="bg-white/[0.04] p-4">
                <div className="text-sm font-semibold text-slate-100">Zmiana dywizji</div>
                <div className="mt-1 text-xs leading-relaxed text-slate-400">
                  Obecna dywizja: {regMe.division_name ?? activeDivisionName ?? "aktywna dywizja"}.
                </div>

                {pendingDivisionReq?.status === "PENDING" ? (
                  <div className="mt-3 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-100">
                    Oczekuje prośba o przeniesienie do dywizji: {pendingDivisionReq.to_division_name ?? "wybrana dywizja"}.
                  </div>
                ) : targetDivisionOptions.length > 0 ? (
                  <div className="mt-3 grid gap-2">
                    <Select<number>
                      value={targetDivisionId ?? targetDivisionOptions[0]?.value ?? 0}
                      onChange={(nextId) => setTargetDivisionId(nextId || null)}
                      options={targetDivisionOptions}
                      disabled={regBusy || targetDivisionOptions.length === 0}
                      ariaLabel="Wybierz dywizję docelową"
                      buttonClassName="rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/10"
                      menuClassName="rounded-2xl"
                      size="md"
                      align="start"
                    />
                    <Button type="button" variant="secondary" onClick={requestDivisionChange} disabled={regBusy || !targetDivisionId}>
                      {regBusy ? "Wysyłanie..." : "Poproś o zmianę dywizji"}
                    </Button>
                  </div>
                ) : (
                  <div className="mt-3 text-sm text-slate-400">Brak innej aktywnej dywizji do wyboru.</div>
                )}
              </Card>
            ) : null}

            {shouldShowMyMatchesSection ? (
              <SectionShell
                title="Twoje spotkania"
                desc="Skrót najważniejszych meczów zalogowanego uczestnika."
              >
                {myMatches.length === 0 ? (
                  <Card className="bg-white/[0.04] p-4 text-sm leading-relaxed text-slate-300">
                    Brak danych do wyświetlenia.
                  </Card>
                ) : (
                  <div className="grid gap-3">
                    {myMatches.map((match) => (
                      <PublicEventMatchCard key={match.id} match={match} />
                    ))}
                  </div>
                )}
              </SectionShell>
            ) : null}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-2">
              <Input
                value={regCode}
                onChange={(e) => setRegCode(e.target.value)}
                placeholder="Kod dołączania"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={verifyRegistrationCode}
                disabled={regBusy}
              >
                {regBusy ? "Sprawdzanie..." : "Sprawdź kod"}
              </Button>
            </div>

            {verified ? (
              <div className="grid gap-2">
                {joinDivisionOptions.length > 0 ? (
                  <div className="grid gap-2">
                    <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                      Dywizja
                    </div>
                    {joinDivisionOptions.length > 1 ? (
                      <div className="max-h-64 space-y-2 overflow-y-auto rounded-2xl border border-white/10 bg-white/[0.04] p-2">
                        {joinDivisionOptions.map((option) => {
                          const isSelected = option.value === selectedJoinDivisionId;

                          return (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => setJoinDivisionId(option.value)}
                              disabled={regBusy}
                              aria-pressed={isSelected}
                              className={cn(
                                "flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-sm transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/10",
                                isSelected
                                  ? "border-cyan-400/50 bg-cyan-400/10 text-white"
                                  : "border-white/10 bg-white/[0.04] text-slate-200 hover:border-white/20 hover:bg-white/[0.07]",
                                regBusy ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                              )}
                            >
                              <span className="min-w-0 flex-1 truncate">{option.label}</span>
                              {isSelected ? (
                                <span className="shrink-0 rounded-full bg-cyan-400/15 px-2 py-0.5 text-xs font-semibold text-cyan-200">
                                  Wybrano
                                </span>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-3 text-sm font-semibold text-slate-100">
                        {joinDivisionOptions[0]?.label}
                      </div>
                    )}
                    <div className="text-xs leading-relaxed text-slate-400">
                      {joinDivisionOptions.length > 1
                        ? "Wybierz dywizję, do której chcesz dołączyć."
                        : "Dostępna jest jedna dywizja do dołączenia."}
                    </div>
                  </div>
                ) : (
                  <InlineAlert variant="info">Brak dywizji dostępnych do dołączenia.</InlineAlert>
                )}

                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={
                    tournament?.competition_type === "INDIVIDUAL"
                      ? "Imię i nazwisko"
                      : "Nazwa drużyny / imię i nazwisko"
                  }
                />
                <Button
                  type="button"
                  onClick={joinTournament}
                  disabled={regBusy || !selectedJoinDivisionId}
                >
                  {regBusy ? "Dołączanie..." : "Dołącz do wydarzenia"}
                </Button>
              </div>
            ) : (
              <InlineAlert variant="info">
                Wpisz kod i kliknij „Sprawdź kod”, aby pobrać listę wszystkich dywizji dostępnych do dołączenia.
              </InlineAlert>
            )}
          </div>
        )}

        {regError ? (
          <div className="mt-4">
            <InlineAlert variant="error">{regError}</InlineAlert>
          </div>
        ) : null}
        {regInfo ? (
          <div className="mt-4">
            <InlineAlert variant="success">{regInfo}</InlineAlert>
          </div>
        ) : null}
      </DrawerPanel>
    );
  };

  if (needsCode) {
    return (
      <>
        <AccessGate
          code={code}
          setCode={setCode}
          onSubmit={() => loadTournamentAndMatches().catch((e: any) => setError(e.message))}
          loading={loadingGate}
          error={error}
        />
        {showManagerNav ? <TournamentFlowNav side="bottom" /> : null}
      </>
    );
  }

  return (
    <div
      className={cn(
        "mx-auto w-full pb-24",
        "max-w-7xl",
        "2xl:max-w-[96rem]",
        "[min-width:1920px]:max-w-[110rem]",
        "[min-width:2560px]:max-w-[128rem]"
      )}
    >
      {publicLiveEnabled && (view === "OVERVIEW" || view === "MATCHES") && publicMatches.length > 0 ? (
        <PublicMatchesBar matches={publicMatches} />
      ) : null}

      <section>
        <Reveal>
          <Card className="relative overflow-hidden p-0">
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute left-1/2 top-0 h-44 w-[28rem] -translate-x-1/2 rounded-full bg-indigo-500/15 blur-3xl" />
              <div className="absolute bottom-0 left-1/2 h-44 w-[28rem] -translate-x-1/2 rounded-full bg-sky-500/10 blur-3xl" />
            </div>

            <div className="relative p-6 sm:p-8">
              <h1 className="break-words text-4xl font-semibold tracking-tight text-white sm:text-5xl xl:text-[3.35rem] xl:leading-[1.05]">
                {tournament?.name ?? "Wydarzenie"}
              </h1>

              <p className="mt-4 max-w-4xl text-base leading-relaxed text-slate-300 sm:text-lg">
                {tournament?.description?.trim() ||
                  (isCustomMassStartMode
                    ? isMassStartMultiEvent
                      ? "Publiczny ekran rywalizacji z wieloma konkurencjami."
                      : "Publiczny ekran rywalizacji etapowej."
                    : "Śledź przebieg wydarzenia i aktualne wyniki.")}
              </p>

              <div className="mt-6 flex flex-wrap gap-3">
                {dateRange ? (
                  <MetaPill icon={<Calendar className="h-4 w-4" />} label="Termin" value={dateRange} />
                ) : null}
                {tournament?.location ? (
                  <MetaPill icon={<MapPin className="h-4 w-4" />} label="Miejsce" value={tournament.location} />
                ) : null}
              </div>

              {customMode && customResultSummary ? (
                <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm leading-relaxed text-slate-300">
                  {customResultSummary}
                </div>
              ) : null}

              <div className="mt-7 flex flex-wrap gap-3">
                {showParticipantJoin ? (
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => setParticipantPanelOpen(true)}
                    rightIcon={<ArrowRight className="h-4 w-4" />}
                    disabled={joinIsDisabledKnown && !regMe}
                  >
                    {heroJoinLabel}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setView(isCustomMassStartMode ? "STANDINGS" : "MATCHES")}
                  rightIcon={<ChevronRight className="h-4 w-4" />}
                >
                  {isCustomMassStartMode ? "Przejdź do rankingu" : `Przejdź do sekcji: ${matchesSectionLabel}`}
                </Button>
              </div>
            </div>
          </Card>
        </Reveal>
      </section>

      {divisions.length > 1 ? (
        <div className="mt-8">
          <SectionShell
            eyebrow="Dywizje"
            title="Wybierz część wydarzenia"
            desc="Dywizje mogą reprezentować konkurencje, kategorie albo osobne przebiegi rywalizacji w ramach jednego publicznego wydarzenia."
          >
            <DivisionSwitcher
              divisions={divisions}
              activeDivisionId={effectiveDivisionId}
              onChange={handleDivisionSwitch}
              label="Dywizje"
            />
          </SectionShell>
        </div>
      ) : null}

      <div className="sticky top-0 z-20 mt-8">
        <div className="rounded-3xl border border-white/10 bg-slate-950/80 p-2 shadow-xl backdrop-blur-md">
          <div className="flex flex-wrap gap-2">
            {dynamicTabs.map((tab) => (
              <Button
                key={tab.key}
                type="button"
                variant="ghost"
                onClick={() => setView(tab.key)}
                className={cn(
                  "h-11 rounded-2xl border px-4 text-sm font-semibold",
                  view === tab.key
                    ? "border-white/15 bg-white/10 text-slate-100"
                    : "border-white/10 bg-transparent text-slate-300 hover:bg-white/[0.06]"
                )}
              >
                {tab.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-8 space-y-6">
        {view === "OVERVIEW" ? renderOverview() : null}
        {view === "MATCHES" ? renderMatches() : null}
        {view === "STANDINGS" ? renderStandings() : null}
        {view === "STATS" ? renderStats() : null}
      </div>

      {renderParticipantPanel()}

      {showManagerNav ? <TournamentFlowNav side="bottom" /> : null}
    </div>
  );
}
