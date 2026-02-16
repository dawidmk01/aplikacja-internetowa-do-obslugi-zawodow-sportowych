// frontend/src/pages/TournamentBasicsSetup.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  BadgeCheck,
  Brackets,
  Cog,
  Info,
  Layers3,
  Users,
} from "lucide-react";

import { apiFetch } from "../api";
import { useTournamentFlowGuard } from "../flow/TournamentFlowGuardContext";
import TournamentFlowNav from "../components/TournamentFlowNav";
import TournamentStepFooter from "../components/TournamentStepFooter";

import { Card } from "../ui/Card";
import { Input } from "../ui/Input";
import { cn } from "../lib/cn";

/* ====== typy ====== */
type Discipline =
  | "football"
  | "volleyball"
  | "basketball"
  | "handball"
  | "tennis"
  | "wrestling";

type TournamentFormat = "LEAGUE" | "CUP" | "MIXED";

/* --- Handball --- */
type HandballTableDrawMode = "ALLOW_DRAW" | "PENALTIES" | "OVERTIME_PENALTIES";
type HandballKnockoutTiebreak = "OVERTIME_PENALTIES" | "PENALTIES";
type HandballPointsMode = "2_1_0" | "3_1_0" | "3_2_1_0";

/* --- Tennis --- */
type TennisBestOf = 3 | 5;
type TennisPointsMode = "NONE" | "PLT";

/* DTO */
type TournamentDTO = {
  id: number;
  name: string;
  discipline: Discipline;
  tournament_format: TournamentFormat;
  format_config: Record<string, any>;
  status?: "DRAFT" | "CONFIGURED" | "RUNNING" | "FINISHED";
  my_role?: "ORGANIZER" | "ASSISTANT" | null;
  my_permissions?: Record<string, boolean>;
};

type TeamDTO = { id: number; name: string };

/* --- Stałe opcje --- */
const HB_POINTS_OPTIONS: { value: HandballPointsMode; label: string }[] = [
  { value: "2_1_0", label: "2-1-0 (W-R-P)" },
  { value: "3_1_0", label: "3-1-0 (W-R-P)" },
  { value: "3_2_1_0", label: "3-2-1-0 (karne: W=2, P=1)" },
];

const TENNIS_BEST_OF_OPTIONS: { value: TennisBestOf; label: string }[] = [
  { value: 3, label: "Best of 3 (do 2 wygranych setów)" },
  { value: 5, label: "Best of 5 (do 3 wygranych setów)" },
];

const TENNIS_POINTS_MODE_OPTIONS: {
  value: TennisPointsMode;
  label: string;
  hint?: string;
}[] = [
  {
    value: "NONE",
    label: "Bez punktów (ranking: zwycięstwa, RS, RG, H2H)",
    hint: "Klasyczny wariant grup tenisowych: tabela bez kolumny Pkt.",
  },
  {
    value: "PLT",
    label: "Punktacja PLT (np. 10/8/4/2/0)",
    hint: "Jeśli Twoja liga używa punktów – backend liczy i zwraca Pkt.",
  },
];

function disciplineLabel(code?: Discipline) {
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
    case "wrestling":
      return "Zapasy";
    default:
      return code ?? "-";
  }
}

function formatLabel(v?: TournamentFormat) {
  if (v === "LEAGUE") return "Liga";
  if (v === "CUP") return "Puchar (KO)";
  if (v === "MIXED") return "Grupy + puchar";
  return "-";
}

function clampInt(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function defaultGroupsCountFor4PerGroup(participants: number) {
  const p = Math.max(2, Math.trunc(participants));
  return Math.max(1, Math.ceil(p / 4));
}

function splitIntoGroups(participants: number, groupsCount: number): number[] {
  const p = Math.max(0, Math.trunc(participants));
  const g = clampInt(groupsCount, 1, Math.max(1, p));
  const base = Math.floor(p / g);
  const extra = p % g;

  const sizes: number[] = [];
  for (let i = 0; i < g; i++) sizes.push(i < extra ? base + 1 : base);
  return sizes;
}

function roundRobinMatches(size: number, matchesPerPair: 1 | 2) {
  if (size < 2) return 0;
  return ((size * (size - 1)) / 2) * matchesPerPair;
}

function isPowerOfTwo(n: number) {
  if (n < 1) return false;
  return (n & (n - 1)) === 0;
}

/* ===== UI helpers ===== */

function Select({
  value,
  onChange,
  disabled,
  children,
}: {
  value: string | number;
  onChange: (v: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <select
      value={String(value)}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={cn(
        "select-dark w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-slate-100",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/10 focus-visible:border-white/20",
        "disabled:opacity-60 disabled:pointer-events-none"
      )}
      style={{ colorScheme: "dark" }} // <--- pomaga na natywnych selectach
    >
      {children}
    </select>
  );
}

function Badge({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "info" | "warn" | "ok";
}) {
  const cls =
    tone === "warn"
      ? "border-amber-400/20 bg-amber-400/10 text-amber-100"
      : tone === "ok"
      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
      : tone === "info"
      ? "border-indigo-400/20 bg-indigo-400/10 text-indigo-100"
      : "border-white/10 bg-white/[0.06] text-slate-200";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold",
        cls
      )}
    >
      {children}
    </span>
  );
}

function OptionCard({
  title,
  desc,
  icon,
  active,
  disabled,
  onClick,
}: {
  title: string;
  desc: string;
  icon: React.ReactNode;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileHover={!disabled ? { y: -2 } : undefined}
      whileTap={!disabled ? { scale: 0.99 } : undefined}
      className={cn(
        "text-left w-full h-full",
        "rounded-2xl border p-4 transition",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/10",
        disabled && "opacity-60 pointer-events-none",
        active
          ? "border-white/20 bg-white/[0.10] shadow-[0_1px_0_rgba(255,255,255,0.06)_inset]"
          : "border-white/10 bg-white/[0.06] hover:bg-white/[0.08]"
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "grid h-10 w-10 place-items-center rounded-xl border border-white/10",
            active
              ? "bg-gradient-to-br from-indigo-500/25 to-purple-600/25"
              : "bg-white/[0.06]"
          )}
        >
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white">{title}</div>
          <div className="mt-1 text-sm text-slate-300 leading-relaxed">
            {desc}
          </div>
        </div>
      </div>
    </motion.button>
  );
}

export default function TournamentBasicsSetup() {
  const { id } = useParams<{ id: string }>();
  const isCreateMode = !id;

  const navigate = useNavigate();
  const location = useLocation();

  const { dirty, markDirty, registerSave } = useTournamentFlowGuard();
  const createdIdRef = useRef<string | null>(null);

  const [loading, setLoading] = useState(!isCreateMode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* rola + perms */
  const [myRole, setMyRole] = useState<"ORGANIZER" | "ASSISTANT" | null>(null);
  const [myPerms, setMyPerms] = useState<Record<string, boolean>>({});

  const canEditTournament =
    myRole === "ORGANIZER" || Boolean(myPerms?.tournament_edit);
  const isAssistantReadOnly = !isCreateMode && !canEditTournament;

  /* ====== KROK 1 ====== */
  const [name, setName] = useState("");
  const [discipline, setDiscipline] = useState<Discipline>("football");
  const [initialDiscipline, setInitialDiscipline] =
    useState<Discipline>("football");
  const [initialName, setInitialName] = useState("");

  /* ====== KROK 2 ====== */
  const [format, setFormat] = useState<TournamentFormat>("LEAGUE");
  const [participants, setParticipants] = useState(8);
  const initialParticipantsRef = useRef<number>(8);

  /* Liga / Grupy */
  const [leagueMatches, setLeagueMatches] = useState<1 | 2>(1);
  const [groupsCount, setGroupsCount] = useState(2);
  const [groupMatches, setGroupMatches] = useState<1 | 2>(1);
  const [advanceFromGroup, setAdvanceFromGroup] = useState(2);

  /* Handball */
  const [hbTableDrawMode, setHbTableDrawMode] =
    useState<HandballTableDrawMode>("ALLOW_DRAW");
  const [hbPointsMode, setHbPointsMode] =
    useState<HandballPointsMode>("2_1_0");
  const [hbKnockoutTiebreak, setHbKnockoutTiebreak] =
    useState<HandballKnockoutTiebreak>("OVERTIME_PENALTIES");

  /* KO */
  const [cupMatches, setCupMatches] = useState<1 | 2>(1);
  const [finalMatches, setFinalMatches] = useState<1 | 2>(1);
  const [thirdPlace, setThirdPlace] = useState(false);
  const [thirdPlaceMatches, setThirdPlaceMatches] = useState<1 | 2>(1);

  /* Tennis */
  const [tennisBestOf, setTennisBestOf] = useState<TennisBestOf>(3);
  const [tennisPointsMode, setTennisPointsMode] =
    useState<TennisPointsMode>("NONE");

  const isHandball = discipline === "handball";
  const isTennis = discipline === "tennis";

  /* ====== Flash Error ====== */
  useEffect(() => {
    const flash = (location.state as any)?.flashError as string | undefined;
    if (flash) {
      setError(flash);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, navigate, location.pathname]);

  /* ====== Spójność Handball ====== */
  useEffect(() => {
    if (hbPointsMode === "3_2_1_0" && hbTableDrawMode === "ALLOW_DRAW") {
      setHbTableDrawMode("PENALTIES");
    }
  }, [hbPointsMode, hbTableDrawMode]);

  /* ====== Spójność Tenis (KO zawsze single) ====== */
  useEffect(() => {
    if (!isTennis) return;
    if (cupMatches !== 1) setCupMatches(1);
    if (finalMatches !== 1) setFinalMatches(1);
    if (thirdPlaceMatches !== 1) setThirdPlaceMatches(1);
  }, [isTennis, cupMatches, finalMatches, thirdPlaceMatches]);

  /* ====== MIXED: min 2 w grupie ====== */
  const maxGroupsForMin2PerGroup = useMemo(() => {
    return Math.max(1, Math.floor(Math.max(2, participants) / 2));
  }, [participants]);

  useEffect(() => {
    if (format !== "MIXED") return;
    setGroupsCount((prev) => clampInt(prev, 1, maxGroupsForMin2PerGroup));
  }, [format, maxGroupsForMin2PerGroup]);

  const groupSizes = useMemo(() => {
    if (format !== "MIXED") return [];
    const safeParticipants = clampInt(participants, 2, 10_000);
    const safeGroups = clampInt(groupsCount, 1, Math.max(1, safeParticipants));
    return splitIntoGroups(safeParticipants, safeGroups);
  }, [format, participants, groupsCount]);

  const minGroupSize = useMemo(() => {
    if (!groupSizes.length) return 0;
    return Math.min(...groupSizes);
  }, [groupSizes]);

  useEffect(() => {
    if (format !== "MIXED") return;
    if (minGroupSize < 2) return;
    setAdvanceFromGroup((prev) => clampInt(prev, 1, minGroupSize));
  }, [format, minGroupSize]);

  const advanceOptions = useMemo(() => {
    if (format !== "MIXED" || minGroupSize < 2)
      return [1, 2].filter((x) => x <= Math.max(1, minGroupSize));
    const maxOpt = Math.min(minGroupSize, 8);
    return Array.from({ length: maxOpt }, (_, i) => i + 1);
  }, [format, minGroupSize]);

  /* ====== Load existing ====== */
  useEffect(() => {
    if (isCreateMode) return;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [tRes, teamsRes] = await Promise.all([
          apiFetch(`/api/tournaments/${id}/`),
          apiFetch(`/api/tournaments/${id}/teams/`),
        ]);

        if (!tRes.ok) throw new Error("Nie udało się pobrać danych turnieju.");
        if (!teamsRes.ok)
          throw new Error("Nie udało się pobrać listy uczestników.");

        const t: TournamentDTO = await tRes.json();
        const teams: TeamDTO[] = await teamsRes.json();

        setMyRole(t.my_role ?? null);
        setMyPerms(t.my_permissions ?? {});

        setName(t.name);
        setInitialName(t.name);
        setDiscipline(t.discipline);
        setInitialDiscipline(t.discipline);
        setFormat(t.tournament_format);

        const currentCount = Math.max(2, teams.length);
        setParticipants(currentCount);
        initialParticipantsRef.current = currentCount;

        const cfg = t.format_config || {};

        setLeagueMatches(cfg.league_matches === 2 ? 2 : 1);

        const savedGroups = cfg.groups_count;
        if (typeof savedGroups === "number" && savedGroups >= 1) {
          setGroupsCount(savedGroups);
        } else {
          setGroupsCount(defaultGroupsCountFor4PerGroup(currentCount));
        }

        setGroupMatches(cfg.group_matches === 2 ? 2 : 1);

        const savedAdvance = Number(cfg.advance_from_group ?? 2);
        setAdvanceFromGroup(Number.isFinite(savedAdvance) ? savedAdvance : 2);

        setCupMatches(cfg.cup_matches === 2 ? 2 : 1);
        setFinalMatches(cfg.final_matches === 2 ? 2 : 1);
        setThirdPlace(!!cfg.third_place);
        setThirdPlaceMatches(cfg.third_place_matches === 2 ? 2 : 1);

        setHbTableDrawMode(cfg.handball_table_draw_mode ?? "ALLOW_DRAW");
        setHbKnockoutTiebreak(
          cfg.handball_knockout_tiebreak ?? "OVERTIME_PENALTIES"
        );
        setHbPointsMode(cfg.handball_points_mode ?? "2_1_0");

        setTennisBestOf(cfg.tennis_best_of === 5 ? 5 : 3);
        const tpm = (cfg.tennis_points_mode ?? "NONE")
          .toString()
          .toUpperCase();
        setTennisPointsMode(tpm === "PLT" ? "PLT" : "NONE");
      } catch (e: any) {
        setError(e.message || "Błąd ładowania.");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [id, isCreateMode]);

  /* ====== Preview ====== */
  const preview = useMemo(() => {
    const p = clampInt(participants, 2, 10_000);

    if (format === "LEAGUE") {
      const matches = ((p * (p - 1)) / 2) * leagueMatches;
      return {
        total: matches,
        groupTotal: 0,
        koTotal: 0,
        groups: 0,
        advancing: 0,
      };
    }

    if (format === "CUP") {
      const roundsMatches = Math.max(0, (p - 2) * cupMatches);
      const finalCount = finalMatches;
      const thirdCount = thirdPlace ? thirdPlaceMatches : 0;
      const koTotal = roundsMatches + finalCount + thirdCount;

      return {
        total: koTotal,
        groupTotal: 0,
        koTotal,
        groups: 0,
        advancing: 0,
      };
    }

    // MIXED
    const safeGroups = clampInt(groupsCount, 1, Math.max(1, Math.floor(p / 2)));
    const sizes = splitIntoGroups(p, safeGroups);
    const groupTotal = sizes.reduce(
      (sum, size) => sum + roundRobinMatches(size, groupMatches),
      0
    );
    const minSize = sizes.length ? Math.min(...sizes) : 2;
    const adv = clampInt(advanceFromGroup, 1, Math.max(1, minSize));
    const advancing = sizes.length * adv;

    if (advancing < 2) {
      return { total: groupTotal, groupTotal, koTotal: 0, groups: sizes.length, advancing };
    }

    const koRoundsMatches = Math.max(0, (advancing - 2) * cupMatches);
    const finalCount = finalMatches;
    const thirdCount = thirdPlace ? thirdPlaceMatches : 0;
    const koTotal = koRoundsMatches + finalCount + thirdCount;

    return {
      total: groupTotal + koTotal,
      groupTotal,
      koTotal,
      groups: sizes.length,
      advancing,
    };
  }, [
    format,
    participants,
    leagueMatches,
    cupMatches,
    finalMatches,
    thirdPlace,
    thirdPlaceMatches,
    groupsCount,
    groupMatches,
    advanceFromGroup,
  ]);

  /* ====== Helpers ====== */
  const confirmDisciplineChange = () => {
    return window.confirm(
      "Zmiana dyscypliny spowoduje usunięcie wprowadzonych wyników oraz danych pochodnych.\n\nCzy na pewno chcesz kontynuować?"
    );
  };

  const validateLocalBeforeSave = (): string | null => {
    const trimmedName = name.trim();
    if (!trimmedName)
      return "Wpisz nazwę turnieju — bez tego nie da się przejść dalej.";

    const p = clampInt(participants, 2, 10_000);

    if (format === "MIXED") {
      const gMax = Math.max(1, Math.floor(p / 2));
      const g = clampInt(groupsCount, 1, gMax);
      const sizes = splitIntoGroups(p, g);
      const minSize = sizes.length ? Math.min(...sizes) : 2;

      if (minSize < 2)
        return "W MIXED każda grupa musi mieć co najmniej 2 zespoły (zmniejsz liczbę grup).";

      const adv = clampInt(advanceFromGroup, 1, minSize);
      if (adv !== advanceFromGroup) {
        return `Awans z grupy nie może być większy niż liczba zespołów w najmniejszej grupie (min: ${minSize}).`;
      }

      const advancing = g * adv;
      if (advancing >= 2 && !isPowerOfTwo(advancing)) {
        return `Uwaga: awansujących jest ${advancing}. To nie jest potęga 2, więc w drabince mogą pojawić się wolne losy (BYE).`;
      }
    }

    if (isTennis) {
      if (cupMatches !== 1 || finalMatches !== 1 || thirdPlaceMatches !== 1) {
        return "Tenis: KO nie wspiera dwumeczów — ustaw rundy/finał/3. miejsce na 1 mecz.";
      }
    }

    return null;
  };

  const buildFormatConfig = () => {
    const safeParticipants = clampInt(participants, 2, 10_000);
    const maxGroups = Math.max(1, Math.floor(safeParticipants / 2));
    const safeGroups = clampInt(groupsCount, 1, Math.max(1, maxGroups));
    const sizes = splitIntoGroups(safeParticipants, safeGroups);
    const computedTeamsPerGroup = Math.max(2, ...(sizes.length ? sizes : [2]));
    const minSize = sizes.length ? Math.min(...sizes) : 2;
    const safeAdvance = clampInt(advanceFromGroup, 1, Math.max(1, minSize));

    const rawConfig: Record<string, any> = {
      league_matches: leagueMatches,
      groups_count: safeGroups,
      teams_per_group: computedTeamsPerGroup,
      group_matches: groupMatches,
      advance_from_group: safeAdvance,
      cup_matches: isTennis ? 1 : cupMatches,
      final_matches: isTennis ? 1 : finalMatches,
      third_place: thirdPlace,
      third_place_matches: isTennis ? 1 : thirdPlaceMatches,
    };

    if (isHandball) {
      rawConfig.handball_table_draw_mode = hbTableDrawMode;
      rawConfig.handball_knockout_tiebreak = hbKnockoutTiebreak;
      rawConfig.handball_points_mode = hbPointsMode;
    }

    if (isTennis) {
      rawConfig.tennis_best_of = tennisBestOf;
      rawConfig.tennis_points_mode = tennisPointsMode;
    }

    const finalConfig = { ...rawConfig };

    if (format === "LEAGUE") {
      delete finalConfig.cup_matches;
      delete finalConfig.final_matches;
      delete finalConfig.third_place;
      delete finalConfig.third_place_matches;
      delete finalConfig.advance_from_group;
      delete finalConfig.groups_count;
      delete finalConfig.teams_per_group;
      delete finalConfig.group_matches;
      delete finalConfig.handball_knockout_tiebreak;
      // tenis points mode i handball table settings zostają (tabela)
    }

    if (format === "CUP") {
      delete finalConfig.league_matches;
      delete finalConfig.groups_count;
      delete finalConfig.teams_per_group;
      delete finalConfig.group_matches;
      delete finalConfig.advance_from_group;
      delete finalConfig.handball_table_draw_mode;
      delete finalConfig.handball_points_mode;
      delete finalConfig.tennis_points_mode; // tylko liga/grupy
    }

    if (format === "MIXED") {
      delete finalConfig.league_matches;
    }

    return finalConfig;
  };

  /* ====== SAVE ====== */
  const saveAll = useCallback(async (): Promise<{ tournamentId: number }> => {
    if (isAssistantReadOnly) {
      const msg = "Tryb podglądu: brak uprawnień do zmiany konfiguracji.";
      setError(msg);
      throw new Error(msg);
    }

    const localMsg = validateLocalBeforeSave();
    if (localMsg) {
      if (localMsg.startsWith("Uwaga:")) {
        if (!window.confirm(`${localMsg}\n\nKontynuować zapis?`)) {
          setError("Anulowano zapis konfiguracji.");
          throw new Error("Anulowano zapis konfiguracji.");
        }
      } else {
        setError(localMsg);
        throw new Error(localMsg);
      }
    }

    if (!isCreateMode && !dirty) return { tournamentId: Number(id) };

    setSaving(true);
    setError(null);

    let createdId: number | null = null;

    try {
      const trimmedName = name.trim();
      let tournamentId = Number(id);

      // 1) create / basic updates
      if (isCreateMode) {
        const createRes = await apiFetch("/api/tournaments/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmedName, discipline }),
        });

        if (!createRes.ok) {
          const data = await createRes.json().catch(() => ({}));
          throw new Error(data?.detail || "Nie udało się utworzyć turnieju.");
        }

        const created = await createRes.json();
        createdId = created.id;
        tournamentId = created.id;

        setInitialName(trimmedName);
        setInitialDiscipline(discipline);
      } else {
        // discipline change = endpoint (jak w oryginale)
        if (discipline !== initialDiscipline) {
          if (!confirmDisciplineChange()) {
            setDiscipline(initialDiscipline);
          } else {
            const res = await apiFetch(
              `/api/tournaments/${tournamentId}/change-discipline/`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ discipline }),
              }
            );
            if (!res.ok) throw new Error("Nie udało się zmienić dyscypliny.");
            setInitialDiscipline(discipline);
          }
        }

        if (trimmedName !== initialName) {
          const res = await apiFetch(`/api/tournaments/${tournamentId}/`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: trimmedName }),
          });
          if (!res.ok) throw new Error("Nie udało się zapisać nazwy.");
          setInitialName(trimmedName);
        }
      }

      // 2) dry-run (czy reset)
      const format_config = buildFormatConfig();

      const dry = await apiFetch(
        `/api/tournaments/${tournamentId}/setup/?dry_run=true`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tournament_format: format, format_config }),
        }
      );
      if (!dry.ok) throw new Error("Błąd walidacji konfiguracji.");

      const dryData = await dry.json().catch(() => ({}));
      const resetNeeded = Boolean((dryData as any)?.reset_needed);

      if (!isCreateMode && resetNeeded) {
        if (
          !window.confirm("Zmiana konfiguracji usunie istniejące mecze. Kontynuować?")
        ) {
          throw new Error("Anulowano zapis konfiguracji.");
        }
      }

      // 3) apply setup
      const res = await apiFetch(`/api/tournaments/${tournamentId}/setup/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tournament_format: format, format_config }),
      });
      if (!res.ok) throw new Error("Błąd zapisu konfiguracji.");

      // 4) participants placeholders
      const safeParticipants = clampInt(participants, 2, 10_000);
      const participantsChanged = safeParticipants !== initialParticipantsRef.current;

      if (!isCreateMode && participantsChanged && !resetNeeded) {
        if (
          !window.confirm(
            "Zmiana liczby uczestników spowoduje reset rozgrywek. Kontynuować?"
          )
        ) {
          throw new Error("Anulowano zmianę liczby uczestników.");
        }
      }

      // kompatybilność: część backendów używa teams_count, część participants_count
      const teamsRes = await apiFetch(
        `/api/tournaments/${tournamentId}/teams/setup/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            teams_count: safeParticipants,
            participants_count: safeParticipants,
          }),
        }
      );
      if (!teamsRes.ok)
        throw new Error("Nie udało się ustawić liczby uczestników.");

      initialParticipantsRef.current = safeParticipants;

      createdIdRef.current = String(tournamentId);
      return { tournamentId };
    } catch (e: any) {
      const msg = e?.message || "Nie udało się zapisać.";
      if (isCreateMode && createdId) {
        navigate(`/tournaments/${createdId}/setup`, {
          replace: true,
          state: { flashError: msg },
        });
        return { tournamentId: createdId };
      }
      throw e;
    } finally {
      setSaving(false);
    }
  }, [
    isAssistantReadOnly,
    isCreateMode,
    dirty,
    id,
    name,
    discipline,
    initialDiscipline,
    initialName,
    format,
    participants,
    leagueMatches,
    groupsCount,
    groupMatches,
    advanceFromGroup,
    cupMatches,
    finalMatches,
    thirdPlace,
    thirdPlaceMatches,
    hbTableDrawMode,
    hbKnockoutTiebreak,
    hbPointsMode,
    tennisBestOf,
    tennisPointsMode,
    isTennis,
    navigate,
  ]);

  const goNext = useCallback(async () => {
    try {
      const { tournamentId } = await saveAll();
      navigate(`/tournaments/${tournamentId}/detail`, { replace: true });
    } catch (e: any) {
      setError(e?.message || "Nie udało się zapisać.");
    }
  }, [saveAll, navigate]);

  useEffect(() => {
    if (isAssistantReadOnly) {
      registerSave(null);
      return () => registerSave(null);
    }
    registerSave(async () => {
      const { tournamentId } = await saveAll();
      createdIdRef.current = String(tournamentId);
    });
    return () => registerSave(null);
  }, [registerSave, saveAll, isAssistantReadOnly]);

  /* ====== UI flags ====== */
  const disableForm = loading || saving || isAssistantReadOnly;
  const showLeagueOrGroupConfig = format === "LEAGUE" || format === "MIXED";
  const showKnockoutConfig = format === "CUP" || format === "MIXED";

  /* ===== Render ===== */
  if (loading) {
    return (
      <div className="max-w-6xl">
        <Card className="p-6">
          <div className="text-sm text-slate-300">Ładowanie...</div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Fix: białe dropdowny w select (menu opcji) */}
      <style>{`
        .select-dark { color-scheme: dark; }
        .select-dark option,
        .select-dark optgroup {
          background: rgb(8 12 20);
          color: rgb(226 232 240);
        }
      `}</style>

      {isCreateMode && (
        <div className="mb-2">
          <TournamentFlowNav />
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
              {isCreateMode ? "Utwórz turniej" : "Ustawienia turnieju"}
            </h1>

            {isAssistantReadOnly ? (
              <Badge tone="warn">
                <AlertTriangle className="h-3.5 w-3.5" />
                Podgląd (asystent)
              </Badge>
            ) : (
              <Badge tone="info">
                <Info className="h-3.5 w-3.5" />
                Konfiguracja
              </Badge>
            )}

            {!isCreateMode && (
              <Badge tone="default">
                <BadgeCheck className="h-3.5 w-3.5 opacity-80" />
                ID: {id}
              </Badge>
            )}
          </div>

          <div className="mt-2 text-sm text-slate-300 leading-relaxed">
            {isCreateMode
              ? "Ustal podstawy i konfigurację rozgrywek. W kolejnym kroku uzupełnisz uczestników."
              : "Zmień parametry rozgrywek. Uwaga: część zmian może wymagać resetu."}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="default">
            <Layers3 className="h-3.5 w-3.5 opacity-80" />
            {formatLabel(format)}
          </Badge>
          <Badge tone="default">
            <Users className="h-3.5 w-3.5 opacity-80" />
            {participants} uczestników
          </Badge>
        </div>
      </div>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
          >
            <Card className="p-4 border border-rose-400/20 bg-rose-400/5">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 grid h-9 w-9 place-items-center rounded-xl border border-rose-400/20 bg-rose-400/10">
                  <AlertTriangle className="h-5 w-5 text-rose-200" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white">
                    Nie udało się zapisać
                  </div>
                  <div className="mt-1 text-sm text-slate-200">{error}</div>
                </div>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        {/* LEFT */}
        <div className="space-y-6">
          {/* Basics */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <Card className="p-6">
              <div className="flex items-center gap-2">
                <div className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.06]">
                  <Cog className="h-5 w-5 text-white/90" />
                </div>
                <div>
                  <div className="text-base font-semibold text-white">
                    Podstawowe informacje
                  </div>
                  <div className="text-sm text-slate-300">
                    Nazwa, dyscyplina i uczestnicy.
                  </div>
                </div>
              </div>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-300">
                    Nazwa turnieju
                  </div>
                  <Input
                    value={name}
                    disabled={disableForm}
                    onChange={(e) => {
                      setName(e.target.value);
                      markDirty();
                      if (error) setError(null);
                    }}
                    placeholder="np. Turniej Miejski 2026"
                  />
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-300">
                    Dyscyplina
                  </div>
                  <Select
                    value={discipline}
                    disabled={disableForm}
                    onChange={(v) => {
                      setDiscipline(v as Discipline);
                      markDirty();
                    }}
                  >
                    <option value="football">Piłka nożna</option>
                    <option value="handball">Piłka ręczna</option>
                    <option value="basketball">Koszykówka</option>
                    <option value="volleyball">Siatkówka</option>
                    <option value="tennis">Tenis</option>
                    <option value="wrestling">Zapasy</option>
                  </Select>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-300">
                    Liczba uczestników
                  </div>
                  <Input
                    type="number"
                    min={2}
                    max={10000}
                    disabled={disableForm}
                    value={participants}
                    onChange={(e) => {
                      const p = clampInt(Number(e.target.value), 2, 10_000);
                      setParticipants(p);
                      markDirty();
                      if (format === "MIXED") {
                        const gMax = Math.max(1, Math.floor(p / 2));
                        setGroupsCount((prev) => clampInt(prev, 1, gMax));
                      }
                    }}
                  />
                  <div className="text-xs text-slate-400">
                    Tworzy placeholdery drużyn/zawodników - nazwy uzupełnisz w kolejnym kroku.
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-300">
                    Format turnieju
                  </div>
                  <Select
                    value={format}
                    disabled={disableForm}
                    onChange={(v) => {
                      setFormat(v as TournamentFormat);
                      markDirty();
                    }}
                  >
                    <option value="LEAGUE">Liga</option>
                    <option value="CUP">Puchar (KO)</option>
                    <option value="MIXED">Grupy + puchar</option>
                  </Select>
                  <div className="text-xs text-slate-400">
                    Format wpływa na strukturę etapów i generowanie meczów.
                  </div>
                </div>
              </div>

              {/* Tennis extra (best-of) */}
              {isTennis && (
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-300">
                      Tenis – format meczu
                    </div>
                    <Select
                      value={tennisBestOf}
                      disabled={disableForm}
                      onChange={(v) => {
                        setTennisBestOf(Number(v) as TennisBestOf);
                        markDirty();
                      }}
                    >
                      {TENNIS_BEST_OF_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                    <div className="text-xs text-slate-400">
                      Wyniki będziesz wpisywać jako <b>gemy w setach</b> w ekranie wyników / Live.
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm text-slate-300">
                    Tenis: KO nie obsługuje dwumeczu – rundy/finał/3 miejsce zawsze jako pojedyncze mecze.
                  </div>
                </div>
              )}
            </Card>
          </motion.div>

          {/* Struktura rozgrywek (karty) */}
          <Card className="p-6">
            <div className="flex items-center gap-2">
              <div className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.06]">
                <Brackets className="h-5 w-5 text-white/90" />
              </div>
              <div>
                <div className="text-base font-semibold text-white">
                  Struktura rozgrywek
                </div>
                <div className="text-sm text-slate-300">
                  Dobierz parametry ligi / grup / KO.
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <OptionCard
                title="Liga"
                desc="Tabela i mecze każdy z każdym (1 lub 2 mecze w parze)."
                icon={<Layers3 className="h-5 w-5 text-indigo-200" />}
                active={format === "LEAGUE"}
                disabled={disableForm}
                onClick={() => {
                  setFormat("LEAGUE");
                  markDirty();
                }}
              />
              <OptionCard
                title="Puchar (KO)"
                desc="Drabinka pucharowa. Opcja 1 mecz lub dwumecz (poza tenisem)."
                icon={<Brackets className="h-5 w-5 text-indigo-200" />}
                active={format === "CUP"}
                disabled={disableForm}
                onClick={() => {
                  setFormat("CUP");
                  markDirty();
                }}
              />
              <OptionCard
                title="Grupy + puchar"
                desc="Faza grupowa (tabela) + awans do drabinki KO."
                icon={<Users className="h-5 w-5 text-indigo-200" />}
                active={format === "MIXED"}
                disabled={disableForm}
                onClick={() => {
                  setFormat("MIXED");
                  markDirty();
                }}
              />
            </div>

            <AnimatePresence mode="popLayout">
              {showLeagueOrGroupConfig && (
                <motion.div
                  key="leagueOrMixed"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  className="mt-6 space-y-4"
                >
                  {/* Tennis points mode (only league/mixed) */}
                  {isTennis && (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                      <div className="text-sm font-semibold text-white">
                        Tenis – tabela
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div className="space-y-2">
                          <div className="text-xs font-semibold text-slate-300">
                            System klasyfikacji
                          </div>
                          <Select
                            value={tennisPointsMode}
                            disabled={disableForm}
                            onChange={(v) => {
                              setTennisPointsMode(v as TennisPointsMode);
                              markDirty();
                            }}
                          >
                            {TENNIS_POINTS_MODE_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </Select>
                          <div className="text-xs text-slate-400">
                            {
                              TENNIS_POINTS_MODE_OPTIONS.find(
                                (x) => x.value === tennisPointsMode
                              )?.hint
                            }
                          </div>
                        </div>
                        <div className="text-sm text-slate-300 leading-relaxed">
                          {tennisPointsMode === "PLT"
                            ? "Tabela pokaże kolumnę Pkt (liczone wg ustawień w backendzie)."
                            : "Tabela będzie bez punktów – o kolejności decydują: zwycięstwa, RS, RG i H2H (gdy etap zakończony)."}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Handball table settings (league/mixed) */}
                  {isHandball && (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                      <div className="text-sm font-semibold text-white">
                        Piłka ręczna – tabela
                      </div>

                      <div className="mt-3 grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <div className="text-xs font-semibold text-slate-300">
                            Punktacja (tabela)
                          </div>
                          <Select
                            value={hbPointsMode}
                            disabled={disableForm}
                            onChange={(v) => {
                              setHbPointsMode(v as HandballPointsMode);
                              markDirty();
                            }}
                          >
                            {HB_POINTS_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <div className="text-xs font-semibold text-slate-300">
                            Rozstrzyganie meczów (liga/grupy)
                          </div>
                          <Select
                            value={hbTableDrawMode}
                            disabled={
                              disableForm || hbPointsMode === "3_2_1_0"
                            }
                            onChange={(v) => {
                              setHbTableDrawMode(v as HandballTableDrawMode);
                              markDirty();
                            }}
                          >
                            <option value="ALLOW_DRAW">Remis dopuszczalny</option>
                            <option value="PENALTIES">Remis → karne</option>
                            <option value="OVERTIME_PENALTIES">
                              Remis → dogrywka + karne
                            </option>
                          </Select>
                          {hbPointsMode === "3_2_1_0" && (
                            <div className="text-xs text-amber-200">
                              Wymagane przy 3-2-1-0 (system wymusza rozstrzygnięcie).
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* LEAGUE */}
                  {format === "LEAGUE" && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-slate-300">
                          Mecze każdy z każdym
                        </div>
                        <Select
                          value={leagueMatches}
                          disabled={disableForm}
                          onChange={(v) => {
                            setLeagueMatches(Number(v) as 1 | 2);
                            markDirty();
                          }}
                        >
                          <option value={1}>1 mecz (bez rewanżu)</option>
                          <option value={2}>2 mecze (rewanż)</option>
                        </Select>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm text-slate-300">
                        System wylicza pary na podstawie liczby uczestników.
                      </div>
                    </div>
                  )}

                  {/* MIXED */}
                  {format === "MIXED" && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-slate-300">
                          Liczba grup
                        </div>
                        <Input
                          type="number"
                          min={1}
                          max={maxGroupsForMin2PerGroup}
                          disabled={disableForm}
                          value={groupsCount}
                          onChange={(e) => {
                            setGroupsCount(
                              clampInt(
                                Number(e.target.value),
                                1,
                                maxGroupsForMin2PerGroup
                              )
                            );
                            markDirty();
                          }}
                        />
                        {groupSizes.length > 0 && (
                          <div className="text-xs text-slate-400">
                            Rozmiary grup: {groupSizes.join(", ")} (min:{" "}
                            {minGroupSize})
                          </div>
                        )}
                      </div>

                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-slate-300">
                          Mecze w grupach
                        </div>
                        <Select
                          value={groupMatches}
                          disabled={disableForm}
                          onChange={(v) => {
                            setGroupMatches(Number(v) as 1 | 2);
                            markDirty();
                          }}
                        >
                          <option value={1}>1 mecz</option>
                          <option value={2}>2 mecze (rewanż)</option>
                        </Select>
                      </div>

                      <div className="space-y-2 sm:col-span-2">
                        <div className="text-xs font-semibold text-slate-300">
                          Awans z grupy
                        </div>
                        <Select
                          value={advanceFromGroup}
                          disabled={disableForm || minGroupSize < 2}
                          onChange={(v) => {
                            setAdvanceFromGroup(Number(v));
                            markDirty();
                          }}
                        >
                          {advanceOptions.map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </Select>
                        {minGroupSize < 2 && (
                          <div className="text-xs text-amber-200">
                            Najmniejsza grupa ma mniej niż 2 uczestników – zmniejsz liczbę grup.
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}

              {showKnockoutConfig && (
                <motion.div
                  key="knockout"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  className="mt-6 space-y-4"
                >
                  {/* Handball KO tiebreak */}
                  {isHandball && (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                      <div className="text-sm font-semibold text-white">
                        Piłka ręczna – KO (dogrywka/karne)
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div className="space-y-2">
                          <div className="text-xs font-semibold text-slate-300">
                            Rozstrzyganie remisów (KO)
                          </div>
                          <Select
                            value={hbKnockoutTiebreak}
                            disabled={disableForm}
                            onChange={(v) => {
                              setHbKnockoutTiebreak(
                                v as HandballKnockoutTiebreak
                              );
                              markDirty();
                            }}
                          >
                            <option value="OVERTIME_PENALTIES">
                              Dogrywka + karne
                            </option>
                            <option value="PENALTIES">Od razu karne</option>
                          </Select>
                        </div>
                        <div className="text-sm text-slate-300 leading-relaxed">
                          Ustawia sposób rozstrzygnięcia, gdy mecz KO kończy się remisem.
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <div className="text-xs font-semibold text-slate-300">
                        Rundy (mecze)
                      </div>
                      <Select
                        value={cupMatches}
                        disabled={disableForm || isTennis}
                        onChange={(v) => {
                          setCupMatches(Number(v) as 1 | 2);
                          markDirty();
                        }}
                      >
                        <option value={1}>1 mecz</option>
                        <option value={2}>2 mecze (dwumecz)</option>
                      </Select>
                      {isTennis && (
                        <div className="text-xs text-amber-200">
                          Tenis: brak dwumeczu w KO (zawsze 1).
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-semibold text-slate-300">
                        Finał
                      </div>
                      <Select
                        value={finalMatches}
                        disabled={disableForm || isTennis}
                        onChange={(v) => {
                          setFinalMatches(Number(v) as 1 | 2);
                          markDirty();
                        }}
                      >
                        <option value={1}>1 mecz</option>
                        <option value={2}>2 mecze</option>
                      </Select>
                      {isTennis && (
                        <div className="text-xs text-amber-200">
                          Tenis: finał zawsze 1 mecz.
                        </div>
                      )}
                    </div>

                    <div className="sm:col-span-2">
                      <button
                        type="button"
                        disabled={disableForm}
                        onClick={() => {
                          setThirdPlace((v) => !v);
                          markDirty();
                        }}
                        className={cn(
                          "w-full rounded-2xl border px-4 py-3 text-left transition",
                          "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/10",
                          thirdPlace
                            ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
                            : "border-white/10 bg-white/[0.06] text-slate-200 hover:bg-white/[0.08]"
                        )}
                      >
                        <div className="text-sm font-semibold">
                          {thirdPlace ? "Mecz o 3. miejsce: Włączony" : "Mecz o 3. miejsce: Wyłączony"}
                        </div>
                        <div className="mt-1 text-sm text-slate-300">
                          Dodaje mecz o 3 miejsce (jeśli format to wspiera).
                        </div>
                      </button>
                    </div>

                    {thirdPlace && (
                      <div className="space-y-2 sm:col-span-2">
                        <div className="text-xs font-semibold text-slate-300">
                          Mecz o 3. miejsce
                        </div>
                        <Select
                          value={thirdPlaceMatches}
                          disabled={disableForm || isTennis}
                          onChange={(v) => {
                            setThirdPlaceMatches(Number(v) as 1 | 2);
                            markDirty();
                          }}
                        >
                          <option value={1}>1 mecz</option>
                          <option value={2}>2 mecze</option>
                        </Select>
                        {isTennis && (
                          <div className="text-xs text-amber-200">
                            Tenis: 3. miejsce zawsze 1 mecz.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </Card>

          {/* create mode footer */}
          {isCreateMode && (
            <div className="pt-2">
              <TournamentStepFooter
                nextLabel={saving ? "Zapisywanie..." : "Utwórz turniej"}
                onNext={goNext}
                disabledNext={saving || disableForm || !name.trim()}
                saving={saving}
                getCreatedId={() => createdIdRef.current}
              />
            </div>
          )}
        </div>

        {/* RIGHT: summary */}
        <div className="space-y-6">
          <Card className="p-6 sticky top-[92px]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-base font-semibold text-white">
                  Podsumowanie
                </div>
                <div className="mt-1 text-sm text-slate-300">
                  Szacunkowa struktura (orientacyjnie).
                </div>
              </div>
              <Badge tone="info">
                <Info className="h-3.5 w-3.5" />
                {disciplineLabel(discipline)}
              </Badge>
            </div>

            <div className="mt-4 grid gap-2">
              <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                <div className="text-xs font-semibold text-slate-300">Format</div>
                <div className="text-sm font-semibold text-white">
                  {formatLabel(format)}
                </div>
              </div>

              {format === "MIXED" && (
                <>
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                    <div className="text-xs font-semibold text-slate-300">
                      Liczba grup
                    </div>
                    <div className="text-sm font-semibold text-white">
                      {preview.groups}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                    <div className="text-xs font-semibold text-slate-300">
                      Awansujących do KO
                    </div>
                    <div className="text-sm font-semibold text-white">
                      {preview.advancing}
                    </div>
                  </div>
                </>
              )}

              {format !== "CUP" && (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                  <div className="text-xs font-semibold text-slate-300">
                    Mecze fazy tabeli
                  </div>
                  <div className="text-sm font-semibold text-white">
                    {preview.groupTotal}
                  </div>
                </div>
              )}

              {format !== "LEAGUE" && (
                <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                  <div className="text-xs font-semibold text-slate-300">
                    Mecze fazy KO
                  </div>
                  <div className="text-sm font-semibold text-white">
                    {preview.koTotal}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                <div className="text-xs font-semibold text-slate-300">
                  Szac. łączna liczba meczów
                </div>
                <div className="text-sm font-semibold text-white">
                  {preview.total}
                </div>
              </div>
            </div>

            <div className="mt-4 text-xs text-slate-400">
              Tip: Zmiana formatu / grup / awansu może wymagać resetu rozgrywek.
            </div>
          </Card>

          {isAssistantReadOnly && (
            <Card className="p-4 border border-amber-400/20 bg-amber-400/5">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 grid h-9 w-9 place-items-center rounded-xl border border-amber-400/20 bg-amber-400/10">
                  <AlertTriangle className="h-5 w-5 text-amber-100" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white">
                    Tryb podglądu
                  </div>
                  <div className="mt-1 text-sm text-slate-200">
                    Jako asystent nie możesz zmieniać konfiguracji bez uprawnienia
                    <b> „tournament_edit”</b>.
                  </div>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
