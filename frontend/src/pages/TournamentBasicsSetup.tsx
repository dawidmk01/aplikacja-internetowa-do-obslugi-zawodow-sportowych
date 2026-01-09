import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { apiFetch } from "../api";
import { useTournamentFlowGuard } from "../flow/TournamentFlowGuardContext";
import TournamentFlowNav from "../components/TournamentFlowNav";
import TournamentStepFooter from "../components/TournamentStepFooter";

/* ====== typy ====== */
type Discipline = "football" | "volleyball" | "basketball" | "handball" | "tennis" | "wrestling";
type TournamentFormat = "LEAGUE" | "CUP" | "MIXED";

/* --- Typy specyficzne dla Handball --- */
type HandballTableDrawMode = "ALLOW_DRAW" | "PENALTIES" | "OVERTIME_PENALTIES";
type HandballKnockoutTiebreak = "OVERTIME_PENALTIES" | "PENALTIES";
type HandballPointsMode = "2_1_0" | "3_1_0" | "3_2_1_0";

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

  /* ====== Logika spójności Handball ====== */
  useEffect(() => {
    if (hbPointsMode === "3_2_1_0" && hbTableDrawMode === "ALLOW_DRAW") {
      setHbTableDrawMode("PENALTIES");
    }
  }, [hbPointsMode, hbTableDrawMode]);

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
        setLeagueMatches(cfg.league_matches ?? 1);
        const savedGroups = cfg.groups_count;
        if (typeof savedGroups === "number" && savedGroups >= 1) {
          setGroupsCount(savedGroups);
        } else {
          setGroupsCount(defaultGroupsCountFor4PerGroup(currentCount));
        }
        setGroupMatches(cfg.group_matches ?? 1);
        setAdvanceFromGroup(cfg.advance_from_group ?? 2);

        // Puchar
        setCupMatches(cfg.cup_matches ?? 1);
        setFinalMatches(cfg.final_matches ?? 1);
        setThirdPlace(!!cfg.third_place);
        setThirdPlaceMatches(cfg.third_place_matches ?? 1);

        // Handball
        setHbTableDrawMode(cfg.handball_table_draw_mode ?? "ALLOW_DRAW");
        setHbKnockoutTiebreak(cfg.handball_knockout_tiebreak ?? "OVERTIME_PENALTIES");
        setHbPointsMode(cfg.handball_points_mode ?? "2_1_0");

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
    if (participants < 2) return null;

    if (format === "LEAGUE") {
      const matches = (participants * (participants - 1)) / 2 * leagueMatches;
      return { matches };
    }

    if (format === "CUP") {
      const roundsMatches = (participants - 2) * cupMatches;
      const finalCount = finalMatches;
      const thirdCount = thirdPlace ? thirdPlaceMatches : 0;
      return { matches: roundsMatches + finalCount + thirdCount };
    }

    if (format === "MIXED") {
      const sizes = splitIntoGroups(participants, groupsCount);
      const groupTotal = sizes.reduce(
        (sum, size) => sum + roundRobinMatches(size, groupMatches),
        0
      );
      const advancing = sizes.length * advanceFromGroup;
      if (advancing < 2) {
        return { matches: groupTotal, groupMatches: groupTotal, koMatches: 0, groups: sizes.length };
      }
      const koRoundsMatches = Math.max(0, (advancing - 2) * cupMatches);
      const finalCount = finalMatches;
      const thirdCount = thirdPlace ? thirdPlaceMatches : 0;
      const koTotal = koRoundsMatches + finalCount + thirdCount;
      return { matches: groupTotal + koTotal, groupMatches: groupTotal, koMatches: koTotal, groups: sizes.length };
    }
    return null;
  }, [
    format, participants,
    leagueMatches,
    cupMatches, finalMatches, thirdPlace, thirdPlaceMatches,
    groupsCount, groupMatches, advanceFromGroup,
  ]);

  /* ====== Helpers ====== */
  const confirmDisciplineChange = () => {
    return window.confirm(
      "Zmiana dyscypliny spowoduje usunięcie wprowadzonych wyników oraz danych pochodnych.\n\nCzy na pewno chcesz kontynuować?"
    );
  };

  const buildFormatConfig = () => {
    const safeParticipants = clampInt(participants, 2, 10_000);
    const safeGroups = clampInt(groupsCount, 1, Math.max(1, safeParticipants));
    const sizes = splitIntoGroups(safeParticipants, safeGroups);
    const computedTeamsPerGroup = Math.max(2, ...(sizes.length ? sizes : [2]));

    const rawConfig: Record<string, any> = {
      league_matches: leagueMatches,
      groups_count: safeGroups,
      teams_per_group: computedTeamsPerGroup,
      group_matches: groupMatches,
      advance_from_group: advanceFromGroup,
      cup_matches: cupMatches,
      final_matches: finalMatches,
      third_place: thirdPlace,
      third_place_matches: thirdPlaceMatches,
    };

    if (discipline === "handball") {
      rawConfig.handball_table_draw_mode = hbTableDrawMode;
      rawConfig.handball_knockout_tiebreak = hbKnockoutTiebreak;
      rawConfig.handball_points_mode = hbPointsMode;
    }

    const finalConfig = { ...rawConfig };

    if (format === "LEAGUE") {
      delete finalConfig.cup_matches;
      delete finalConfig.final_matches;
      delete finalConfig.third_place;
      delete finalConfig.third_place_matches;
      delete finalConfig.advance_from_group;
      delete finalConfig.handball_knockout_tiebreak;
    }

    if (format === "CUP") {
      delete finalConfig.league_matches;
      delete finalConfig.groups_count;
      delete finalConfig.teams_per_group;
      delete finalConfig.group_matches;
      delete finalConfig.advance_from_group;
      delete finalConfig.handball_table_draw_mode;
      delete finalConfig.handball_points_mode;
    }

    if (format === "MIXED") {
       delete finalConfig.league_matches;
    }

    return finalConfig;
  };

  /* ====== SAVE ACTION ====== */
  const saveAll = useCallback(async (): Promise<{ tournamentId: number }> => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      const msg = "Wpisz nazwę turnieju — bez tego nie da się przejść dalej.";
      setError(msg);
      throw new Error(msg);
    }

    if (!isCreateMode && !dirty) return { tournamentId: Number(id) };

    setSaving(true);
    setError(null);
    let createdId: number | null = null;

    try {
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

      // 4) SETUP CHANGE
      const format_config = buildFormatConfig();
      const dry = await apiFetch(`/api/tournaments/${tournamentId}/change-setup/?dry_run=true`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tournament_format: format, format_config }),
      });
      if (!dry.ok) throw new Error("Błąd walidacji konfiguracji.");

      const dryData = await dry.json();
      const resetNeeded = Boolean(dryData?.reset_needed);

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
        body: JSON.stringify({ participants_count: safeParticipants }),
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
    isCreateMode, id, dirty,
    name, discipline, initialDiscipline, initialName,
    format, participants,
    leagueMatches, cupMatches, finalMatches, thirdPlace, thirdPlaceMatches,
    groupsCount, groupMatches, advanceFromGroup,
    hbTableDrawMode, hbKnockoutTiebreak, hbPointsMode,
    navigate
  ]);

  useEffect(() => {
    registerSave(async () => {
      const { tournamentId } = await saveAll();
      createdIdRef.current = String(tournamentId);
    });
    return () => registerSave(null);
  }, [registerSave, saveAll]);

  if (loading) return <p style={{ padding: "2rem" }}>Ładowanie…</p>;

  /* ====== RENDER HELPERS ====== */
  const showLeagueOrGroupConfig = format === "LEAGUE" || format === "MIXED";
  const showKnockoutConfig = format === "CUP" || format === "MIXED";
  const isHandball = discipline === "handball";

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
            onChange={(e) => { setName(e.target.value); markDirty(); if (error) setError(null); }}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label>Dyscyplina</label>
          <select
            style={{ width: "100%", padding: 8 }}
            value={discipline}
            onChange={(e) => { setDiscipline(e.target.value as Discipline); markDirty(); }}
          >
            <option value="football">Piłka nożna</option>
            <option value="volleyball">Siatkówka</option>
            <option value="basketball">Koszykówka</option>
            <option value="handball">Piłka ręczna</option>
            <option value="tennis">Tenis</option>
            <option value="wrestling">Zapasy</option>
          </select>
        </div>
      </section>

      {/* ===== 2. RODZAJ TURNIEJU (MASTER SWITCH) ===== */}
      <section style={{ marginTop: "2rem" }}>
        <h3>Rodzaj turnieju</h3>
        <select
          style={{ width: "100%", padding: 8 }}
          value={format}
          onChange={(e) => { setFormat(e.target.value as TournamentFormat); markDirty(); }}
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
              setParticipants(clampInt(Number(e.target.value), 2, 10_000));
              markDirty();
            }}
          />
        </p>
      </section>

      {/* ===== 3. FAZA LIGOWA / GRUPOWA ===== */}
      {showLeagueOrGroupConfig && (
        <section style={{ marginTop: "1.5rem" }}>
          <h3>Faza {format === "LEAGUE" ? "ligowa" : "grupowa"}</h3>

          {/* A) Specyficzne dla Handballa w tabeli */}
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
                      <option key={o.value} value={o.value}>{o.label}</option>
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

          {/* B) Ustawienia strukturalne Ligi */}
          {format === "LEAGUE" && (
            <div>
              <label>
                Mecze każdy z każdym:
                <select
                  style={{ marginLeft: 8 }}
                  value={leagueMatches}
                  onChange={(e) => { setLeagueMatches(Number(e.target.value) as 1 | 2); markDirty(); }}
                >
                  <option value={1}>1 mecz (bez rewanżu)</option>
                  <option value={2}>2 mecze (rewanż)</option>
                </select>
              </label>
            </div>
          )}

          {/* C) Ustawienia strukturalne Grup (MIXED) */}
          {format === "MIXED" && (
            <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
              <label>
                Liczba grup:
                <input
                  type="number"
                  min={1}
                  max={participants}
                  style={{ width: 60, marginLeft: 8 }}
                  value={groupsCount}
                  disabled={saving}
                  onChange={(e) => {
                    setGroupsCount(clampInt(Number(e.target.value), 1, Math.max(1, participants)));
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
                  onChange={(e) => { setGroupMatches(Number(e.target.value) as 1 | 2); markDirty(); }}
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
                  disabled={saving}
                  onChange={(e) => { setAdvanceFromGroup(Number(e.target.value)); markDirty(); }}
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                  <option value={4}>4</option>
                </select>
              </label>
            </div>
          )}
        </section>
      )}

      {/* ===== 4. FAZA PUCHAROWA ===== */}
      {showKnockoutConfig && (
        <section style={{ marginTop: "1.5rem" }}>
          <h3>Faza pucharowa</h3>

          {/* A) Specyficzne dla Handballa w KO */}
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

          {/* B) Struktura Pucharu */}
          <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
            <label>
              Rundy (mecze):
              <select
                style={{ marginLeft: 8 }}
                value={cupMatches}
                disabled={saving}
                onChange={(e) => { setCupMatches(Number(e.target.value) as 1 | 2); markDirty(); }}
              >
                <option value={1}>1 mecz</option>
                <option value={2}>2 mecze (dwumecz)</option>
              </select>
            </label>

            <label>
              Finał:
              <select
                style={{ marginLeft: 8 }}
                value={finalMatches}
                disabled={saving}
                onChange={(e) => { setFinalMatches(Number(e.target.value) as 1 | 2); markDirty(); }}
              >
                <option value={1}>1 mecz</option>
                <option value={2}>2 mecze</option>
              </select>
            </label>

            <label style={{ display: "flex", alignItems: "center" }}>
              <input
                type="checkbox"
                checked={thirdPlace}
                disabled={saving}
                onChange={(e) => { setThirdPlace(e.target.checked); markDirty(); }}
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
                  disabled={saving}
                  onChange={(e) => { setThirdPlaceMatches(Number(e.target.value) as 1 | 2); markDirty(); }}
                >
                  <option value={1}>1 mecz</option>
                  <option value={2}>2 mecze</option>
                </select>
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
          {"groupMatches" in preview && <div>Mecze w grupach: <strong>{preview.groupMatches}</strong></div>}
          {"koMatches" in preview && <div>Mecze fazy pucharowej: <strong>{preview.koMatches}</strong></div>}
          <div style={{ marginTop: 8 }}>Szacowana łączna liczba meczów: <strong>{preview.matches}</strong></div>
        </section>
      )}

      {isCreateMode ? (
        <TournamentStepFooter getCreatedId={() => createdIdRef.current} />
      ) : null}
    </div>
  );
}