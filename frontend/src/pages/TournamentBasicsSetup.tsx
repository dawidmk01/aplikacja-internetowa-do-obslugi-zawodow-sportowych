import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { apiFetch } from "../api";
import { useTournamentFlowGuard } from "../flow/TournamentFlowGuardContext";
import TournamentFlowNav from "../components/TournamentFlowNav";
import TournamentStepFooter from "../components/TournamentStepFooter";

/* ====== typy ====== */
type Discipline = "football" | "volleyball" | "basketball" | "handball" | "tennis" | "wrestling";
type TournamentFormat = "LEAGUE" | "CUP" | "MIXED";

/* --- Handball --- */
type HandballTableDrawMode = "ALLOW_DRAW" | "PENALTIES" | "OVERTIME_PENALTIES";
type HandballKnockoutTiebreak = "OVERTIME_PENALTIES" | "PENALTIES";
type HandballPointsMode = "2_1_0" | "3_1_0" | "3_2_1_0";

/* --- Tennis --- */
type TennisBestOf = 3 | 5;
type TennisPointsMode = "NONE" | "PLT";

type TournamentDTO = {
  id: number;
  name: string;
  discipline: Discipline;
  tournament_format: TournamentFormat;
  format_config: Record<string, any>;
  status?: "DRAFT" | "CONFIGURED" | "RUNNING" | "FINISHED";
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

const TENNIS_POINTS_MODE_OPTIONS: { value: TennisPointsMode; label: string; hint?: string }[] = [
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
  return (size * (size - 1)) / 2 * matchesPerPair;
}

function isPowerOfTwo(n: number) {
  if (n < 1) return false;
  return (n & (n - 1)) === 0;
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

  /* ====== KROK 1 (dane podstawowe) ====== */
  const [name, setName] = useState("");
  const [discipline, setDiscipline] = useState<Discipline>("football");
  const [initialDiscipline, setInitialDiscipline] = useState<Discipline>("football");
  const [initialName, setInitialName] = useState("");

  /* ====== KROK 2 (format i struktura) ====== */
  const [format, setFormat] = useState<TournamentFormat>("LEAGUE");
  const [participants, setParticipants] = useState(8);
  const initialParticipantsRef = useRef<number>(8);

  /* --- Konfiguracja Ligi / Grup --- */
  const [leagueMatches, setLeagueMatches] = useState<1 | 2>(1);
  const [groupsCount, setGroupsCount] = useState(2);
  const [groupMatches, setGroupMatches] = useState<1 | 2>(1);
  const [advanceFromGroup, setAdvanceFromGroup] = useState(2);

  // Handball: Liga / Grupa
  const [hbTableDrawMode, setHbTableDrawMode] = useState<HandballTableDrawMode>("ALLOW_DRAW");
  const [hbPointsMode, setHbPointsMode] = useState<HandballPointsMode>("2_1_0");

  /* --- Konfiguracja Pucharu (KO) --- */
  const [cupMatches, setCupMatches] = useState<1 | 2>(1);
  const [finalMatches, setFinalMatches] = useState<1 | 2>(1);
  const [thirdPlace, setThirdPlace] = useState(false);
  const [thirdPlaceMatches, setThirdPlaceMatches] = useState<1 | 2>(1);

  // Handball: Puchar
  const [hbKnockoutTiebreak, setHbKnockoutTiebreak] = useState<HandballKnockoutTiebreak>("OVERTIME_PENALTIES");

  // Tennis: best-of
  const [tennisBestOf, setTennisBestOf] = useState<TennisBestOf>(3);

  // Tennis: tabela – punkty lub bez punktów
  const [tennisPointsMode, setTennisPointsMode] = useState<TennisPointsMode>("NONE");

  const isHandball = discipline === "handball";
  const isTennis = discipline === "tennis";

  /* ====== Logika spójności Handball ====== */
  useEffect(() => {
    if (hbPointsMode === "3_2_1_0" && hbTableDrawMode === "ALLOW_DRAW") {
      setHbTableDrawMode("PENALTIES");
    }
  }, [hbPointsMode, hbTableDrawMode]);

  /* ====== Logika spójności TENIS ======
     - brak dwumeczu w KO (zgodnie z TournamentResults)
  */
  useEffect(() => {
    if (!isTennis) return;

    // KO: wymuszamy 1 mecz (w tym finał i ewentualne 3. miejsce)
    if (cupMatches !== 1) setCupMatches(1);
    if (finalMatches !== 1) setFinalMatches(1);
    if (thirdPlaceMatches !== 1) setThirdPlaceMatches(1);
    // thirdPlace zostawiamy jako opcję, ale zawsze 1 mecz
  }, [isTennis, cupMatches, finalMatches, thirdPlaceMatches]);

  /* ====== MIXED: pilnowanie spójności grup ====== */
  const maxGroupsForMin2PerGroup = useMemo(() => {
    // wymuszamy minimum 2 zespoły w grupie: groupsCount <= floor(participants/2)
    return Math.max(1, Math.floor(Math.max(2, participants) / 2));
  }, [participants]);

  useEffect(() => {
    if (format !== "MIXED") return;

    // clamp liczby grup (żeby nie było grup 1-osobowych)
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

    // clamp awansu, żeby nie przekraczał najmniejszej grupy
    setAdvanceFromGroup((prev) => clampInt(prev, 1, minGroupSize));
  }, [format, minGroupSize]);

  const advanceOptions = useMemo(() => {
    if (format !== "MIXED" || minGroupSize < 2) return [1, 2].filter((x) => x <= Math.max(1, minGroupSize));
    const maxOpt = Math.min(minGroupSize, 8); // sensowny limit UI
    return Array.from({ length: maxOpt }, (_, i) => i + 1);
  }, [format, minGroupSize]);

  /* ====== Obsługa Flash Error ====== */
  useEffect(() => {
    const flash = (location.state as any)?.flashError as string | undefined;
    if (flash) {
      setError(flash);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, navigate, location.pathname]);

  /* ====== Load existing data ====== */
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
        if (!teamsRes.ok) throw new Error("Nie udało się pobrać listy uczestników.");

        const t: TournamentDTO = await tRes.json();
        const teams: TeamDTO[] = await teamsRes.json();

        setName(t.name);
        setInitialName(t.name);
        setDiscipline(t.discipline);
        setInitialDiscipline(t.discipline);
        setFormat(t.tournament_format);

        const currentCount = Math.max(2, teams.length);
        setParticipants(currentCount);
        initialParticipantsRef.current = currentCount;

        const cfg = t.format_config || {};

        // Liga / Grupy
        setLeagueMatches(cfg.league_matches === 2 ? 2 : 1);

        const savedGroups = cfg.groups_count;
        if (typeof savedGroups === "number" && savedGroups >= 1) {
          setGroupsCount(savedGroups);
        } else {
          setGroupsCount(defaultGroupsCountFor4PerGroup(currentCount));
        }

        setGroupMatches(cfg.group_matches === 2 ? 2 : 1);

        // awans
        const savedAdvance = Number(cfg.advance_from_group ?? 2);
        setAdvanceFromGroup(Number.isFinite(savedAdvance) ? savedAdvance : 2);

        // Puchar
        setCupMatches(cfg.cup_matches === 2 ? 2 : 1);
        setFinalMatches(cfg.final_matches === 2 ? 2 : 1);
        setThirdPlace(!!cfg.third_place);
        setThirdPlaceMatches(cfg.third_place_matches === 2 ? 2 : 1);

        // Handball
        setHbTableDrawMode(cfg.handball_table_draw_mode ?? "ALLOW_DRAW");
        setHbKnockoutTiebreak(cfg.handball_knockout_tiebreak ?? "OVERTIME_PENALTIES");
        setHbPointsMode(cfg.handball_points_mode ?? "2_1_0");

        // Tennis
        setTennisBestOf(cfg.tennis_best_of === 5 ? 5 : 3);

        const tpm = (cfg.tennis_points_mode ?? "NONE").toString().toUpperCase();
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
      const matches = (p * (p - 1)) / 2 * leagueMatches;
      return { matches };
    }

    if (format === "CUP") {
      // liczba "tie" = p-1, ale finał liczymy osobno: (p-2) + finał
      const roundsMatches = Math.max(0, (p - 2) * cupMatches);
      const finalCount = finalMatches;
      const thirdCount = thirdPlace ? thirdPlaceMatches : 0;
      return { matches: roundsMatches + finalCount + thirdCount };
    }

    if (format === "MIXED") {
      const safeGroups = clampInt(groupsCount, 1, Math.max(1, Math.floor(p / 2)));
      const sizes = splitIntoGroups(p, safeGroups);

      const groupTotal = sizes.reduce((sum, size) => sum + roundRobinMatches(size, groupMatches), 0);

      // uwaga: awans nie może przekroczyć wielkości najmniejszej grupy
      const minSize = sizes.length ? Math.min(...sizes) : 2;
      const adv = clampInt(advanceFromGroup, 1, Math.max(1, minSize));
      const advancing = sizes.length * adv;

      if (advancing < 2) {
        return { matches: groupTotal, groupMatches: groupTotal, koMatches: 0, groups: sizes.length };
      }

      const koRoundsMatches = Math.max(0, (advancing - 2) * cupMatches);
      const finalCount = finalMatches;
      const thirdCount = thirdPlace ? thirdPlaceMatches : 0;
      const koTotal = koRoundsMatches + finalCount + thirdCount;

      return {
        matches: groupTotal + koTotal,
        groupMatches: groupTotal,
        koMatches: koTotal,
        groups: sizes.length,
        advancing,
      };
    }

    return null;
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
    if (!trimmedName) return "Wpisz nazwę turnieju — bez tego nie da się przejść dalej.";

    const p = clampInt(participants, 2, 10_000);

    if (format === "MIXED") {
      const gMax = Math.max(1, Math.floor(p / 2));
      const g = clampInt(groupsCount, 1, gMax);
      const sizes = splitIntoGroups(p, g);
      const minSize = sizes.length ? Math.min(...sizes) : 2;

      if (minSize < 2) return "W MIXED każda grupa musi mieć co najmniej 2 zespoły (zmniejsz liczbę grup).";

      const adv = clampInt(advanceFromGroup, 1, minSize);
      if (adv !== advanceFromGroup) {
        return `Awans z grupy nie może być większy niż liczba zespołów w najmniejszej grupie (min: ${minSize}).`;
      }

      const advancing = g * adv;

      // to nie musi być błąd, bo backend może robić BYE,
      // ale UX-owo ostrzegamy – w praktyce drabinka jest najczytelniejsza dla 2^k
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

    // MIXED: pilnujemy min. 2 na grupę
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
      // Dotyczy tabeli (LEAGUE/MIXED). W CUP i tak wyczyścimy.
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
      // w LEAGUE handball_table_draw_mode / points_mode zostają (mają sens)
      // tenis_best_of zostaje (dotyczy meczu), tennis_points_mode zostaje (dotyczy tabeli)
    }

    if (format === "CUP") {
      delete finalConfig.league_matches;
      delete finalConfig.groups_count;
      delete finalConfig.teams_per_group;
      delete finalConfig.group_matches;
      delete finalConfig.advance_from_group;
      delete finalConfig.handball_table_draw_mode;
      delete finalConfig.handball_points_mode;

      // CUP nie ma tabeli – usuń tryb punktów tenisowych, żeby config był czysty
      delete finalConfig.tennis_points_mode;
    }

    if (format === "MIXED") {
      delete finalConfig.league_matches;
      // tenis_points_mode zostaje (tabela grup)
    }

    return finalConfig;
  };

  /* ====== SAVE ACTION ====== */
  const saveAll = useCallback(async (): Promise<{ tournamentId: number }> => {
    const localMsg = validateLocalBeforeSave();
    if (localMsg) {
      // jeżeli to ostrzeżenie o potędze 2 – pozwól kontynuować po potwierdzeniu
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

      // 1) CREATE
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
        // 2) EDIT DISCIPLINE
        if (discipline !== initialDiscipline) {
          if (!confirmDisciplineChange()) {
            setDiscipline(initialDiscipline);
          } else {
            const res = await apiFetch(`/api/tournaments/${tournamentId}/change-discipline/`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ discipline }),
            });
            if (!res.ok) throw new Error("Nie udało się zmienić dyscypliny.");
            setInitialDiscipline(discipline);
          }
        }

        // 3) EDIT NAME
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

      // 4) SETUP CHANGE (dry-run)
      const format_config = buildFormatConfig();

      const dry = await apiFetch(`/api/tournaments/${tournamentId}/change-setup/?dry_run=true`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tournament_format: format, format_config }),
      });
      if (!dry.ok) throw new Error("Błąd walidacji konfiguracji.");

      const dryData = await dry.json().catch(() => ({}));
      const resetNeeded = Boolean((dryData as any)?.reset_needed);

      if (!isCreateMode && resetNeeded) {
        if (!window.confirm("Zmiana konfiguracji usunie istniejące mecze. Kontynuować?")) {
          throw new Error("Anulowano zapis konfiguracji.");
        }
      }

      const res = await apiFetch(`/api/tournaments/${tournamentId}/change-setup/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tournament_format: format, format_config }),
      });
      if (!res.ok) throw new Error("Błąd zapisu konfiguracji.");

      // 5) TEAMS COUNT
      const safeParticipants = clampInt(participants, 2, 10_000);
      const participantsChanged = safeParticipants !== initialParticipantsRef.current;

      if (!isCreateMode && participantsChanged && !resetNeeded) {
        if (!window.confirm("Zmiana liczby uczestników spowoduje reset rozgrywek. Kontynuować?")) {
          throw new Error("Anulowano zmianę liczby uczestników.");
        }
      }

      const teamsRes = await apiFetch(`/api/tournaments/${tournamentId}/teams/setup/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teams_count: safeParticipants }),
      });
      if (!teamsRes.ok) throw new Error("Nie udało się ustawić liczby uczestników.");

      initialParticipantsRef.current = safeParticipants;

      return { tournamentId };
    } catch (e: any) {
      const msg = e?.message || "Nie udało się zapisać.";
      if (isCreateMode && createdId) {
        navigate(`/tournaments/${createdId}/setup`, { replace: true, state: { flashError: msg } });
        return { tournamentId: createdId };
      }
      throw e;
    } finally {
      setSaving(false);
    }
  }, [
    isCreateMode,
    id,
    dirty,
    name,
    discipline,
    initialDiscipline,
    initialName,
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
    hbTableDrawMode,
    hbKnockoutTiebreak,
    hbPointsMode,
    tennisBestOf,
    tennisPointsMode,
    isHandball,
    isTennis,
    navigate,
  ]);

  useEffect(() => {
    registerSave(async () => {
      const { tournamentId } = await saveAll();
      createdIdRef.current = String(tournamentId);
    });
    return () => registerSave(null);
  }, [registerSave, saveAll]);

  if (loading) return <p style={{ padding: "2rem" }}>Ładowanie…</p>;

  const showLeagueOrGroupConfig = format === "LEAGUE" || format === "MIXED";
  const showKnockoutConfig = format === "CUP" || format === "MIXED";

  return (
    <div style={{ padding: "2rem", maxWidth: 900 }}>
      {isCreateMode && <TournamentFlowNav getCreatedId={() => createdIdRef.current} />}

      <h1>Konfiguracja turnieju</h1>
      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {/* ===== 1. DANE TURNIEJU ===== */}
      <section style={{ marginTop: "1.5rem" }}>
        <h3>Dane turnieju</h3>

        <div style={{ marginBottom: 12 }}>
          <label>Nazwa</label>
          <input
            style={{ width: "100%", padding: 8 }}
            value={name}
            required
            onChange={(e) => {
              setName(e.target.value);
              markDirty();
              if (error) setError(null);
            }}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label>Dyscyplina</label>
          <select
            style={{ width: "100%", padding: 8 }}
            value={discipline}
            onChange={(e) => {
              setDiscipline(e.target.value as Discipline);
              markDirty();
            }}
          >
            <option value="football">Piłka nożna</option>
            <option value="volleyball">Siatkówka</option>
            <option value="basketball">Koszykówka</option>
            <option value="handball">Piłka ręczna</option>
            <option value="tennis">Tenis</option>
            <option value="wrestling">Zapasy</option>
          </select>
        </div>

        {/* TENNIS: best-of */}
        {isTennis && (
          <div style={{ marginBottom: 12 }}>
            <label>Tenis – format meczu</label>
            <select
              style={{ width: "100%", padding: 8 }}
              value={tennisBestOf}
              disabled={saving}
              onChange={(e) => {
                setTennisBestOf(Number(e.target.value) as TennisBestOf);
                markDirty();
              }}
            >
              {TENNIS_BEST_OF_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            <div style={{ marginTop: 6, fontSize: "0.9em", color: "#666" }}>
              Wyniki będziesz wpisywać w <strong>gemach per set</strong> w ekranie „Wprowadzanie wyników”.
            </div>
          </div>
        )}
      </section>

      {/* ===== 2. RODZAJ TURNIEJU (MASTER SWITCH) ===== */}
      <section style={{ marginTop: "2rem" }}>
        <h3>Rodzaj turnieju</h3>

        <select
          style={{ width: "100%", padding: 8 }}
          value={format}
          onChange={(e) => {
            setFormat(e.target.value as TournamentFormat);
            markDirty();
          }}
          disabled={saving}
        >
          <option value="LEAGUE">Liga</option>
          <option value="CUP">Puchar (KO)</option>
          <option value="MIXED">Grupy + puchar</option>
        </select>

        <p style={{ marginTop: 8, fontSize: "0.9em", color: "#666" }}>
          Liczba uczestników:{" "}
          <input
            type="number"
            min={2}
            style={{ width: 80, marginLeft: 8 }}
            value={participants}
            disabled={saving}
            onChange={(e) => {
              const p = clampInt(Number(e.target.value), 2, 10_000);
              setParticipants(p);
              markDirty();

              // jeśli MIXED: automatycznie popraw groupsCount, żeby nie było grup 1-osobowych
              if (format === "MIXED") {
                const gMax = Math.max(1, Math.floor(p / 2));
                setGroupsCount((prev) => clampInt(prev, 1, gMax));
              }
            }}
          />
        </p>
      </section>

      {/* ===== 3. FAZA LIGOWA / GRUPOWA ===== */}
      {showLeagueOrGroupConfig && (
        <section style={{ marginTop: "1.5rem" }}>
          <h3>Faza {format === "LEAGUE" ? "ligowa" : "grupowa"}</h3>

          {/* TENNIS: tryb punktów w tabeli */}
          {isTennis && (
            <div style={{ marginBottom: "1rem" }}>
              <strong>Tenis – tabela</strong>
              <div style={{ marginTop: 8 }}>
                <label style={{ display: "block", marginBottom: 8 }}>
                  System klasyfikacji:
                  <select
                    style={{ marginLeft: 8 }}
                    value={tennisPointsMode}
                    disabled={saving}
                    onChange={(e) => {
                      setTennisPointsMode(e.target.value as TennisPointsMode);
                      markDirty();
                    }}
                  >
                    {TENNIS_POINTS_MODE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>

                <div style={{ fontSize: "0.9em", color: "#666" }}>
                  {tennisPointsMode === "PLT"
                    ? "Tabela pokaże kolumnę Pkt (liczone wg ustawień w backendzie)."
                    : "Tabela będzie bez punktów – o kolejności decydują: zwycięstwa, RS, RG i H2H (gdy etap zakończony)."}
                </div>
              </div>
            </div>
          )}

          {/* A) Handball – tabela */}
          {isHandball && (
            <div style={{ marginBottom: "1rem" }}>
              <strong>Ustawienia punktacji (Piłka ręczna)</strong>

              <div style={{ marginTop: 8 }}>
                <label style={{ display: "block", marginBottom: 8 }}>
                  Punktacja (tabela):
                  <select
                    style={{ marginLeft: 8 }}
                    value={hbPointsMode}
                    disabled={saving}
                    onChange={(e) => {
                      setHbPointsMode(e.target.value as HandballPointsMode);
                      markDirty();
                    }}
                  >
                    {HB_POINTS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={{ display: "block", marginBottom: 8 }}>
                  Rozstrzyganie meczów:
                  <select
                    style={{ marginLeft: 8 }}
                    value={hbTableDrawMode}
                    disabled={saving || hbPointsMode === "3_2_1_0"}
                    onChange={(e) => {
                      setHbTableDrawMode(e.target.value as HandballTableDrawMode);
                      markDirty();
                    }}
                  >
                    <option value="ALLOW_DRAW">Remis dopuszczalny</option>
                    <option value="PENALTIES">Remis → karne</option>
                    <option value="OVERTIME_PENALTIES">Remis → dogrywka + karne</option>
                  </select>
                  {hbPointsMode === "3_2_1_0" && (
                    <span style={{ fontSize: "0.8em", color: "orange", marginLeft: 8 }}>
                      (Wymagane przy 3-2-1-0)
                    </span>
                  )}
                </label>
              </div>
            </div>
          )}

          {/* B) Liga */}
          {format === "LEAGUE" && (
            <div>
              <label>
                Mecze każdy z każdym:
                <select
                  style={{ marginLeft: 8 }}
                  value={leagueMatches}
                  disabled={saving}
                  onChange={(e) => {
                    setLeagueMatches(Number(e.target.value) as 1 | 2);
                    markDirty();
                  }}
                >
                  <option value={1}>1 mecz (bez rewanżu)</option>
                  <option value={2}>2 mecze (rewanż)</option>
                </select>
              </label>
            </div>
          )}

          {/* C) Grupy (MIXED) */}
          {format === "MIXED" && (
            <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
              <label>
                Liczba grup:
                <input
                  type="number"
                  min={1}
                  max={maxGroupsForMin2PerGroup}
                  style={{ width: 70, marginLeft: 8 }}
                  value={groupsCount}
                  disabled={saving}
                  onChange={(e) => {
                    setGroupsCount(clampInt(Number(e.target.value), 1, maxGroupsForMin2PerGroup));
                    markDirty();
                  }}
                />
              </label>

              <label>
                Mecze w grupach:
                <select
                  style={{ marginLeft: 8 }}
                  value={groupMatches}
                  disabled={saving}
                  onChange={(e) => {
                    setGroupMatches(Number(e.target.value) as 1 | 2);
                    markDirty();
                  }}
                >
                  <option value={1}>1 mecz</option>
                  <option value={2}>2 mecze</option>
                </select>
              </label>

              <label>
                Awans z grupy:
                <select
                  style={{ marginLeft: 8 }}
                  value={advanceFromGroup}
                  disabled={saving || minGroupSize < 2}
                  onChange={(e) => {
                    setAdvanceFromGroup(Number(e.target.value));
                    markDirty();
                  }}
                >
                  {advanceOptions.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>

              {groupSizes.length > 0 && (
                <div style={{ fontSize: "0.9em", color: "#666", alignSelf: "center" }}>
                  Rozmiary grup: {groupSizes.join(", ")} (min: {minGroupSize})
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* ===== 4. FAZA PUCHAROWA ===== */}
      {showKnockoutConfig && (
        <section style={{ marginTop: "1.5rem" }}>
          <h3>Faza pucharowa</h3>

          {/* A) Handball KO */}
          {isHandball && (
            <div style={{ marginBottom: "1rem" }}>
              <strong>Dogrywki i karne (Puchar)</strong>
              <div style={{ marginTop: 8 }}>
                <label>
                  Sposób rozstrzygania remisów:
                  <select
                    style={{ marginLeft: 8 }}
                    value={hbKnockoutTiebreak}
                    disabled={saving}
                    onChange={(e) => {
                      setHbKnockoutTiebreak(e.target.value as HandballKnockoutTiebreak);
                      markDirty();
                    }}
                  >
                    <option value="OVERTIME_PENALTIES">Dogrywka + karne</option>
                    <option value="PENALTIES">Od razu karne</option>
                  </select>
                </label>
              </div>
            </div>
          )}

          {/* B) Struktura KO */}
          <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
            <label>
              Rundy (mecze):
              <select
                style={{ marginLeft: 8 }}
                value={cupMatches}
                disabled={saving || isTennis}
                onChange={(e) => {
                  setCupMatches(Number(e.target.value) as 1 | 2);
                  markDirty();
                }}
              >
                <option value={1}>1 mecz</option>
                <option value={2}>2 mecze (dwumecz)</option>
              </select>
              {isTennis && (
                <span style={{ fontSize: "0.8em", color: "orange", marginLeft: 8 }}>
                  (Tenis: brak dwumeczu)
                </span>
              )}
            </label>

            <label>
              Finał:
              <select
                style={{ marginLeft: 8 }}
                value={finalMatches}
                disabled={saving || isTennis}
                onChange={(e) => {
                  setFinalMatches(Number(e.target.value) as 1 | 2);
                  markDirty();
                }}
              >
                <option value={1}>1 mecz</option>
                <option value={2}>2 mecze</option>
              </select>
              {isTennis && (
                <span style={{ fontSize: "0.8em", color: "orange", marginLeft: 8 }}>
                  (Tenis: zawsze 1)
                </span>
              )}
            </label>

            <label style={{ display: "flex", alignItems: "center" }}>
              <input
                type="checkbox"
                checked={thirdPlace}
                disabled={saving}
                onChange={(e) => {
                  setThirdPlace(e.target.checked);
                  markDirty();
                }}
                style={{ marginRight: 8 }}
              />
              Mecz o 3. miejsce
            </label>

            {thirdPlace && (
              <label>
                Mecz o 3. msc:
                <select
                  style={{ marginLeft: 8 }}
                  value={thirdPlaceMatches}
                  disabled={saving || isTennis}
                  onChange={(e) => {
                    setThirdPlaceMatches(Number(e.target.value) as 1 | 2);
                    markDirty();
                  }}
                >
                  <option value={1}>1 mecz</option>
                  <option value={2}>2 mecze</option>
                </select>
                {isTennis && (
                  <span style={{ fontSize: "0.8em", color: "orange", marginLeft: 8 }}>
                    (Tenis: zawsze 1)
                  </span>
                )}
              </label>
            )}
          </div>
        </section>
      )}

      {/* ===== PODGLĄD ===== */}
      {preview && (
        <section style={{ marginTop: "2rem" }}>
          <h4 style={{ margin: "0 0 10px 0" }}>Podsumowanie struktury</h4>

          {"groups" in preview && <div>Liczba grup: <strong>{preview.groups}</strong></div>}
          {"advancing" in preview && <div>Awansujących do KO: <strong>{(preview as any).advancing}</strong></div>}
          {"groupMatches" in preview && <div>Mecze w grupach: <strong>{preview.groupMatches}</strong></div>}
          {"koMatches" in preview && <div>Mecze fazy pucharowej: <strong>{preview.koMatches}</strong></div>}
          <div style={{ marginTop: 8 }}>Szacowana łączna liczba meczów: <strong>{preview.matches}</strong></div>
        </section>
      )}

      {isCreateMode ? <TournamentStepFooter getCreatedId={() => createdIdRef.current} /> : null}
    </div>
  );
}
