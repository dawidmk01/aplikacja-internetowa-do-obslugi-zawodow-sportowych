import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { apiFetch } from "../api";
import { useTournamentFlowGuard } from "../flow/TournamentFlowGuardContext";
import TournamentFlowNav from "../components/TournamentFlowNav";
import TournamentStepFooter from "../components/TournamentStepFooter";

/* ====== typy ====== */
type Discipline = "football" | "volleyball" | "basketball" | "tennis" | "wrestling";
type TournamentFormat = "LEAGUE" | "CUP" | "MIXED";

type TournamentDTO = {
  id: number;
  name: string;
  discipline: Discipline;
  tournament_format: TournamentFormat;
  format_config: Record<string, any>;
  status?: "DRAFT" | "CONFIGURED" | "RUNNING" | "FINISHED";
};

type TeamDTO = { id: number; name: string };

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
  const isCreateMode = !id; // /tournaments/new
  const navigate = useNavigate();
  const location = useLocation();

  /* ====== INTEGRACJA Z FLOW GUARD ====== */
  const { dirty, markDirty, registerSave } = useTournamentFlowGuard();
  const createdIdRef = useRef<string | null>(null);

  const [loading, setLoading] = useState(!isCreateMode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ====== KROK 1 (dane) ====== */
  const [name, setName] = useState("");
  const [discipline, setDiscipline] = useState<Discipline>("football");
  const [initialDiscipline, setInitialDiscipline] = useState<Discipline>("football");
  const [initialName, setInitialName] = useState("");

  /* ====== KROK 2 (setup) ====== */
  const [format, setFormat] = useState<TournamentFormat>("LEAGUE");

  // UWAGA: to NIE jest już pole turnieju — to „docelowa liczba aktywnych Team”
  const [participants, setParticipants] = useState(8);
  const initialParticipantsRef = useRef<number>(8);

  const [leagueMatches, setLeagueMatches] = useState<1 | 2>(1);

  const [cupMatches, setCupMatches] = useState<1 | 2>(1);
  const [finalMatches, setFinalMatches] = useState<1 | 2>(1);
  const [thirdPlace, setThirdPlace] = useState(false);
  const [thirdPlaceMatches, setThirdPlaceMatches] = useState<1 | 2>(1);

  const [groupsCount, setGroupsCount] = useState(2);
  const [groupMatches, setGroupMatches] = useState<1 | 2>(1);
  const [advanceFromGroup, setAdvanceFromGroup] = useState(2);

  /* ====== Obsługa Flash Error ====== */
  useEffect(() => {
    const flash = (location.state as any)?.flashError as string | undefined;
    if (flash) {
      setError(flash);
      navigate(location.pathname, { replace: true, state: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  /* ====== load existing tournament + teams ====== */
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

        // participants = liczba aktywnych Team
        const currentCount = Math.max(2, teams.length);
        setParticipants(currentCount);
        initialParticipantsRef.current = currentCount;

        const cfg = t.format_config || {};
        setLeagueMatches(cfg.league_matches ?? 1);

        setCupMatches(cfg.cup_matches ?? 1);
        setFinalMatches(cfg.final_matches ?? 1);
        setThirdPlace(!!cfg.third_place);
        setThirdPlaceMatches(cfg.third_place_matches ?? 1);

        const savedGroups = cfg.groups_count;
        if (typeof savedGroups === "number" && savedGroups >= 1) {
          setGroupsCount(savedGroups);
        } else {
          setGroupsCount(defaultGroupsCountFor4PerGroup(currentCount));
        }
        setGroupMatches(cfg.group_matches ?? 1);
        setAdvanceFromGroup(cfg.advance_from_group ?? 2);

      } catch (e: any) {
        setError(e.message || "Błąd ładowania.");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [id, isCreateMode]);

  /* ====== preview ====== */
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

    return {
      league_matches: leagueMatches,
      cup_matches: cupMatches,
      final_matches: finalMatches,
      third_place: thirdPlace,
      third_place_matches: thirdPlaceMatches,

      groups_count: safeGroups,
      teams_per_group: computedTeamsPerGroup,
      group_matches: groupMatches,
      advance_from_group: advanceFromGroup,
    };
  };

  /**
   * GŁÓWNY zapis:
   * - create/patch name + discipline
   * - change-setup (format + format_config)
   * - teams/setup (participants_count) => generuje/regeneruje mecze
   */
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

        // po create traktuj to jako „początkowe”
        setInitialName(trimmedName);
        setInitialDiscipline(discipline);

      } else {
        // 2) EDIT: dyscyplina
        if (discipline !== initialDiscipline) {
          const ok = confirmDisciplineChange();
          if (!ok) {
            setDiscipline(initialDiscipline);
          } else {
            const res = await apiFetch(`/api/tournaments/${tournamentId}/change-discipline/`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ discipline }),
            });
            if (!res.ok) {
              const data = await res.json().catch(() => ({}));
              throw new Error(data?.detail || "Nie udało się zmienić dyscypliny.");
            }
            setInitialDiscipline(discipline);
          }
        }

        // 3) EDIT: nazwa
        if (trimmedName !== initialName) {
          const res = await apiFetch(`/api/tournaments/${tournamentId}/`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: trimmedName }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data?.detail || "Nie udało się zapisać nazwy turnieju.");
          }
          setInitialName(trimmedName);
        }
      }

      // 4) SETUP: change-setup (bez participants_count)
      const format_config = buildFormatConfig();

      const dry = await apiFetch(`/api/tournaments/${tournamentId}/change-setup/?dry_run=true`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tournament_format: format,
          format_config,
        }),
      });

      if (!dry.ok) {
        const data = await dry.json().catch(() => ({}));
        throw new Error(data?.detail || "Błąd walidacji konfiguracji.");
      }

      const dryData = await dry.json();
      const resetNeeded = Boolean(dryData?.reset_needed);

      // Uwaga: w create-mode reset jest normalny (backend mógł utworzyć startową strukturę)
      if (!isCreateMode && resetNeeded) {
        const ok = window.confirm(
          "Zmieniasz konfigurację po wygenerowaniu rozgrywek. To usunie etapy i mecze (uczestnicy zostaną). Kontynuować?"
        );
        if (!ok) throw new Error("Anulowano zapis konfiguracji.");
      }

      const res = await apiFetch(`/api/tournaments/${tournamentId}/change-setup/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tournament_format: format,
          format_config,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.detail || "Błąd zapisu konfiguracji.");
      }

      // 5) TEAMS: ustaw docelową liczbę aktywnych uczestników + regeneruj mecze
      const safeParticipants = clampInt(participants, 2, 10_000);
      const participantsChanged = safeParticipants !== initialParticipantsRef.current;

      // Jeśli zmieniłeś liczbę i turniej nie jest w „pustym” stanie, backend i tak zresetuje.
      // Potwierdzenie zostawiamy jako jedno (wyżej) dla resetNeeded; tu tylko „dodatkowe” przy zmianie liczby.
      if (!isCreateMode && participantsChanged && !resetNeeded) {
        const ok = window.confirm(
          "Zmiana liczby uczestników spowoduje reset rozgrywek. Kontynuować?"
        );
        if (!ok) throw new Error("Anulowano zmianę liczby uczestników.");
      }

      const teamsRes = await apiFetch(`/api/tournaments/${tournamentId}/teams/setup/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participants_count: safeParticipants }),
      });

      if (!teamsRes.ok) {
        const data = await teamsRes.json().catch(() => ({}));
        throw new Error(data?.detail || "Nie udało się ustawić liczby uczestników.");
      }

      // aktualizacja initial participants po udanym zapisie
      initialParticipantsRef.current = safeParticipants;

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
    isCreateMode, id, dirty,
    name, discipline, initialDiscipline, initialName,
    format, participants,
    leagueMatches, cupMatches, finalMatches, thirdPlace, thirdPlaceMatches,
    groupsCount, groupMatches, advanceFromGroup,
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

  return (
    <div style={{ padding: "2rem", maxWidth: 900 }}>
      {isCreateMode && <TournamentFlowNav getCreatedId={() => createdIdRef.current} />}

      <h1>Konfiguracja turnieju</h1>
      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {/* ===== Dane turnieju ===== */}
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
            onChange={(e) => { setDiscipline(e.target.value as Discipline); markDirty(); }}
          >
            <option value="football">Piłka nożna</option>
            <option value="volleyball">Siatkówka</option>
            <option value="basketball">Koszykówka</option>
            <option value="tennis">Tenis</option>
            <option value="wrestling">Zapasy</option>
          </select>
        </div>
      </section>

      {/* ===== Setup turnieju ===== */}
      <section style={{ marginTop: "2rem" }}>
        <h3>Rodzaj turnieju</h3>
        <select
          value={format}
          onChange={(e) => { setFormat(e.target.value as TournamentFormat); markDirty(); }}
          disabled={saving}
        >
          <option value="LEAGUE">Liga</option>
          <option value="CUP">Puchar (KO)</option>
          <option value="MIXED">Grupy + puchar</option>
        </select>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <h3>Liczba drużyn / zawodników</h3>
        <input
          type="number"
          min={2}
          value={participants}
          disabled={saving}
          onChange={(e) => {
            setParticipants(clampInt(Number(e.target.value), 2, 10_000));
            markDirty();
          }}
        />
      </section>

      {format === "LEAGUE" && (
        <section style={{ marginTop: "1.5rem" }}>
          <h3>Liga – mecze</h3>
          <label>
            <input
              type="radio"
              checked={leagueMatches === 1}
              disabled={saving}
              onChange={() => { setLeagueMatches(1); markDirty(); }}
            />{" "}
            1 mecz
          </label>
          <label style={{ marginLeft: 12 }}>
            <input
              type="radio"
              checked={leagueMatches === 2}
              disabled={saving}
              onChange={() => { setLeagueMatches(2); markDirty(); }}
            />{" "}
            2 mecze
          </label>
        </section>
      )}

      {(format === "CUP" || format === "MIXED") && (
        <section style={{ marginTop: "1.5rem" }}>
          <h3>Puchar – mecze</h3>

          <label>
            Rundy:{" "}
            <select
              value={cupMatches}
              disabled={saving}
              onChange={(e) => { setCupMatches(Number(e.target.value) as 1 | 2); markDirty(); }}
            >
              <option value={1}>1 mecz</option>
              <option value={2}>2 mecze</option>
            </select>
          </label>

          <label style={{ marginLeft: 12 }}>
            Finał:{" "}
            <select
              value={finalMatches}
              disabled={saving}
              onChange={(e) => { setFinalMatches(Number(e.target.value) as 1 | 2); markDirty(); }}
            >
              <option value={1}>1 mecz</option>
              <option value={2}>2 mecze</option>
            </select>
          </label>

          <label style={{ marginLeft: 12 }}>
            <input
              type="checkbox"
              checked={thirdPlace}
              disabled={saving}
              onChange={(e) => { setThirdPlace(e.target.checked); markDirty(); }}
            />{" "}
            Mecz o 3. miejsce
          </label>

          {thirdPlace && (
            <label style={{ marginLeft: 12 }}>
              Mecz o 3. miejsce:{" "}
              <select
                value={thirdPlaceMatches}
                disabled={saving}
                onChange={(e) => { setThirdPlaceMatches(Number(e.target.value) as 1 | 2); markDirty(); }}
              >
                <option value={1}>1 mecz</option>
                <option value={2}>2 mecze</option>
              </select>
            </label>
          )}
        </section>
      )}

      {format === "MIXED" && (
        <section style={{ marginTop: "1.5rem" }}>
          <h3>Faza grupowa</h3>

          <label>
            Liczba grup:{" "}
            <input
              type="number"
              min={1}
              max={participants}
              value={groupsCount}
              disabled={saving}
              onChange={(e) => {
                setGroupsCount(clampInt(Number(e.target.value), 1, Math.max(1, participants)));
                markDirty();
              }}
            />
          </label>

          <label style={{ marginLeft: 12 }}>
            Mecze w grupach:{" "}
            <select
              value={groupMatches}
              disabled={saving}
              onChange={(e) => { setGroupMatches(Number(e.target.value) as 1 | 2); markDirty(); }}
            >
              <option value={1}>1 mecz</option>
              <option value={2}>2 mecze</option>
            </select>
          </label>

          <label style={{ marginLeft: 12 }}>
            Awans z grupy:{" "}
            <select
              value={advanceFromGroup}
              disabled={saving}
              onChange={(e) => { setAdvanceFromGroup(Number(e.target.value)); markDirty(); }}
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={4}>4</option>
            </select>
          </label>
        </section>
      )}

      {preview && (
        <section style={{ marginTop: "1.5rem" }}>
          <h3>Podgląd turnieju</h3>
          {"groups" in preview && <p>Grupy: {preview.groups}</p>}
          {"groupMatches" in preview && <p>Mecze w grupach: {preview.groupMatches}</p>}
          {"koMatches" in preview && <p>Mecze fazy pucharowej: {preview.koMatches}</p>}
          <strong>Łącznie meczów: {preview.matches}</strong>
        </section>
      )}

      {isCreateMode ? (
        <TournamentStepFooter getCreatedId={() => createdIdRef.current} />
      ) : null}
    </div>
  );
}
