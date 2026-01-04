import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiGet, apiFetch } from "../api";

type Tournament = {
  id: number;
  name: string;
  tournament_format: "LEAGUE" | "CUP" | "MIXED";
  participants_count: number;
  format_config: Record<string, any>;
};

function clampInt(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

/**
 * Domyślna liczba grup tak, aby w grupie było ok. 4 drużyny.
 * participants=4 -> 1 grupa
 * participants=5..8 -> 2 grupy
 * participants=9..12 -> 3 grupy itd.
 */
function defaultGroupsCountFor4PerGroup(participants: number) {
  const p = Math.max(2, Math.trunc(participants));
  return Math.max(1, Math.ceil(p / 4));
}

/**
 * Dzieli N drużyn na G grup możliwie równomiernie.
 * Zwraca listę rozmiarów grup, np. N=11, G=3 => [4,4,3]
 */
function splitIntoGroups(participants: number, groupsCount: number): number[] {
  const p = Math.max(0, Math.trunc(participants));
  const g = clampInt(groupsCount, 1, Math.max(1, p));
  const base = Math.floor(p / g);
  const extra = p % g; // tyle grup ma +1

  const sizes: number[] = [];
  for (let i = 0; i < g; i++) {
    sizes.push(i < extra ? base + 1 : base);
  }
  return sizes;
}

/**
 * Liczba meczów w grupie o rozmiarze `size` (każdy z każdym),
 * pomnożona przez liczbę spotkań (1 lub 2).
 */
function roundRobinMatches(size: number, matchesPerPair: 1 | 2) {
  if (size < 2) return 0;
  return (size * (size - 1)) / 2 * matchesPerPair;
}

export default function TournamentSetup() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [loading, setLoading] = useState(true);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* =========================
     KONFIGURACJA
     ========================= */

  const [format, setFormat] = useState<"LEAGUE" | "CUP" | "MIXED">("LEAGUE");

  // planowana liczba miejsc (u Ciebie: do wygenerowania pól na stronie teams)
  const [participants, setParticipants] = useState(8);

  // LIGA
  const [leagueMatches, setLeagueMatches] = useState<1 | 2>(1);

  // PUCHAR (także w MIXED)
  const [cupMatches, setCupMatches] = useState<1 | 2>(1);
  const [finalMatches, setFinalMatches] = useState<1 | 2>(1);
  const [thirdPlace, setThirdPlace] = useState(false);
  const [thirdPlaceMatches, setThirdPlaceMatches] = useState<1 | 2>(1);

  // MIXED – GRUPY
  const [groupsCount, setGroupsCount] = useState(2);
  const [groupMatches, setGroupMatches] = useState<1 | 2>(1);
  const [advanceFromGroup, setAdvanceFromGroup] = useState(2);

  /* =========================
     INIT
     ========================= */

  useEffect(() => {
    setLoading(true);
    setError(null);

    apiGet<Tournament>(`/api/tournaments/${id}/`)
      .then((t) => {
        setTournament(t);

        setFormat(t.tournament_format);
        setParticipants(t.participants_count);

        const cfg = t.format_config || {};
        setLeagueMatches(cfg.league_matches ?? 1);
        setCupMatches(cfg.cup_matches ?? 1);
        setFinalMatches(cfg.final_matches ?? 1);
        setThirdPlace(!!cfg.third_place);
        setThirdPlaceMatches(cfg.third_place_matches ?? 1);

        // groups_count:
        // - jeśli zapisane -> użyj
        // - jeśli nie -> ustaw domyślnie tak, aby było ~4 na grupę
        const savedGroups = cfg.groups_count;
        if (typeof savedGroups === "number" && savedGroups >= 1) {
          setGroupsCount(savedGroups);
        } else {
          setGroupsCount(defaultGroupsCountFor4PerGroup(t.participants_count));
        }

        setGroupMatches(cfg.group_matches ?? 1);
        setAdvanceFromGroup(cfg.advance_from_group ?? 2);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  // Gdy user zmieni participants, a format to MIXED, to dopasuj domyślną liczbę grup,
  // ALE tylko wtedy, gdy user nie “ustawił świadomie” (czyli mamy stan domyślny).
  // Najprościej: jeśli aktualne groupsCount wygląda jak wyliczone “4 na grupę”, to aktualizuj.
  useEffect(() => {
    if (format !== "MIXED") return;

    const desired = defaultGroupsCountFor4PerGroup(participants);
    // Jeżeli groupsCount jest poza sensownym zakresem (np. po zmianie participants), to koryguj.
    if (groupsCount > Math.max(1, participants)) {
      setGroupsCount(Math.max(1, participants));
      return;
    }
    // Jeżeli użytkownik nie zmieniał ręcznie (często będzie równe desired), to dostosuj.
    if (groupsCount === desired) return;
    // Delikatna korekta tylko gdy groupsCount jest "starym domyślnym" dla poprzedniego participants.
    // Bez dodatkowego state "userTouchedGroups" nie mamy 100%, więc robimy bezpiecznie:
    // jeśli różnica jest duża, ustawiamy nowe domyślne.
    if (Math.abs(groupsCount - desired) >= 2) {
      setGroupsCount(desired);
    }
  }, [participants, format]); // eslint-disable-line react-hooks/exhaustive-deps

  /* =========================
     PODGLĄD WYPEŁNIENIA GRUP
     ========================= */

  const groupSizes = useMemo(() => {
    if (format !== "MIXED") return [];
    if (participants < 2) return [];
    const g = clampInt(groupsCount, 1, Math.max(1, participants));
    return splitIntoGroups(participants, g);
  }, [format, participants, groupsCount]);

  const groupFillPreviewLines = useMemo(() => {
    if (format !== "MIXED") return [];
    if (!groupSizes.length) return [];
    return groupSizes.map((size, idx) => `Grupa ${idx + 1}: ${size}`);
  }, [format, groupSizes]);

  /* =========================
     PODGLĄD – LICZENIE MECZÓW
     ========================= */

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

      // KO: jeśli awansujących < 2, to KO nie ma sensu
      if (advancing < 2) {
        return {
          matches: groupTotal,
          groupMatches: groupTotal,
          koMatches: 0,
          groups: sizes.length,
        };
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

  /* =========================
     ZAPIS
     ========================= */

  const save = async () => {
  if (!id) return;

  setSaving(true);
  setError(null);

  const safeGroups = clampInt(groupsCount, 1, Math.max(1, participants));
  const sizes = splitIntoGroups(participants, safeGroups);
  const computedTeamsPerGroup = Math.max(2, ...(sizes.length ? sizes : [2]));

  const format_config = {
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

  try {
    // 1) DRY RUN – czy reset będzie potrzebny?
    const dry = await apiFetch(`/api/tournaments/${id}/change-setup/?dry_run=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tournament_format: format,
        participants_count: participants,
        format_config,
      }),
    });

    if (!dry.ok) {
      const data = await dry.json().catch(() => ({}));
      throw new Error(data?.detail || "Błąd walidacji konfiguracji.");
    }

    const dryData = await dry.json();
    const resetNeeded = Boolean(dryData?.reset_needed);

    // 2) Confirm tylko gdy to naprawdę skasuje mecze/etapy
    if (resetNeeded) {
      const ok = window.confirm(
        "Zmieniasz konfigurację po wygenerowaniu rozgrywek. To usunie etapy i mecze, ale drużyny zostaną. Kontynuować?"
      );
      if (!ok) {
        setSaving(false);
        return;
      }
    }

    // 3) REAL SAVE
    const res = await apiFetch(`/api/tournaments/${id}/change-setup/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tournament_format: format,
        participants_count: participants,
        format_config,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.detail || "Błąd zapisu konfiguracji.");
    }

    setTournament((prev) =>
      prev
        ? {
            ...prev,
            tournament_format: format,
            participants_count: participants,
            format_config,
          }
        : prev
    );

    navigate(`/tournaments/${id}/teams`);
  } catch (e: any) {
    setError(e.message || "Błąd połączenia z serwerem.");
  } finally {
    setSaving(false);
  }
};

  /* =========================
     NAWIGACJA WSTECZ
     ========================= */

  const goBackToStep1 = () => {
    if (!id) return;
    navigate(`/tournaments/${id}/edit`);
  };

  /* =========================
     RENDER
     ========================= */

  if (loading) return <p>Ładowanie…</p>;
  if (error) return <p style={{ color: "crimson" }}>{error}</p>;
  if (!tournament) return null;

  return (
    <div style={{ padding: "2rem", maxWidth: 900 }}>
      <h1>Konfiguracja turnieju</h1>

      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <button type="button" onClick={goBackToStep1} disabled={saving}>
          ← Wróć do danych turnieju
        </button>
      </div>

      <section>
        <h3>Rodzaj turnieju</h3>
        <select
          value={format}
          onChange={(e) => setFormat(e.target.value as any)}
          disabled={saving}
        >
          <option value="LEAGUE">Liga</option>
          <option value="CUP">Puchar (KO)</option>
          <option value="MIXED">Grupy + puchar</option>
        </select>
      </section>

      <section>
        <h3>Liczba drużyn / zawodników</h3>
        <input
          type="number"
          min={2}
          value={participants}
          disabled={saving}
          onChange={(e) => setParticipants(Number(e.target.value))}
        />
        {participants % 2 !== 0 && format === "LEAGUE" && (
          <p>
            Przy nieparzystej liczbie drużyn jedna z nich pauzuje w każdej kolejce.
            Jest to standardowy mechanizm ligowy.
          </p>
        )}
      </section>

      {format === "LEAGUE" && (
        <section>
          <h3>Liga – mecze</h3>
          <label>
            <input
              type="radio"
              checked={leagueMatches === 1}
              disabled={saving}
              onChange={() => setLeagueMatches(1)}
            />{" "}
            1 mecz
          </label>
          <label style={{ marginLeft: 12 }}>
            <input
              type="radio"
              checked={leagueMatches === 2}
              disabled={saving}
              onChange={() => setLeagueMatches(2)}
            />{" "}
            2 mecze
          </label>
        </section>
      )}

      {(format === "CUP" || format === "MIXED") && (
        <section>
          <h3>Puchar – mecze</h3>

          <label>
            Rundy:{" "}
            <select
              value={cupMatches}
              disabled={saving}
              onChange={(e) => setCupMatches(Number(e.target.value) as 1 | 2)}
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
              onChange={(e) => setFinalMatches(Number(e.target.value) as 1 | 2)}
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
              onChange={(e) => setThirdPlace(e.target.checked)}
            />{" "}
            Mecz o 3. miejsce
          </label>

          {thirdPlace && (
            <label style={{ marginLeft: 12 }}>
              Mecz o 3. miejsce:{" "}
              <select
                value={thirdPlaceMatches}
                disabled={saving}
                onChange={(e) =>
                  setThirdPlaceMatches(Number(e.target.value) as 1 | 2)
                }
              >
                <option value={1}>1 mecz</option>
                <option value={2}>2 mecze</option>
              </select>
            </label>
          )}
        </section>
      )}

      {format === "MIXED" && (
        <section>
          <h3>Faza grupowa</h3>

          <label>
            Liczba grup:{" "}
            <input
              type="number"
              min={1}
              max={participants}
              value={groupsCount}
              disabled={saving}
              onChange={(e) =>
                setGroupsCount(
                  clampInt(Number(e.target.value), 1, Math.max(1, participants))
                )
              }
            />
          </label>

          {/* PODGLĄD REALNEGO WYPEŁNIENIA GRUP */}
          <div style={{ marginTop: 10 }}>
            <strong>Podgląd grup:</strong>
            {groupFillPreviewLines.length > 0 ? (
              <ul style={{ marginTop: 8 }}>
                {groupFillPreviewLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : (
              <p style={{ marginTop: 8 }}>Ustaw liczbę drużyn i liczbę grup.</p>
            )}
          </div>

          <label style={{ marginTop: 10, display: "inline-block" }}>
            Mecze w grupach:{" "}
            <select
              value={groupMatches}
              disabled={saving}
              onChange={(e) => setGroupMatches(Number(e.target.value) as 1 | 2)}
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
              onChange={(e) => setAdvanceFromGroup(Number(e.target.value))}
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={4}>4</option>
            </select>
          </label>
        </section>
      )}

      {/* JEDEN WSPÓLNY PODGLĄD DLA MIXED */}
      {preview && (
        <section style={{ marginTop: "1.5rem" }}>
          <h3>Podgląd turnieju</h3>

          {format === "MIXED" ? (
            <>
              {"groups" in preview && <p>Grupy: {preview.groups}</p>}
              {"groupMatches" in preview && (
                <p>Mecze w grupach: {preview.groupMatches}</p>
              )}
              {"koMatches" in preview && (
                <p>Mecze fazy pucharowej: {preview.koMatches}</p>
              )}
              <strong>Łącznie meczów: {preview.matches}</strong>
            </>
          ) : (
            <strong>Łącznie meczów: {preview.matches}</strong>
          )}
        </section>
      )}

      <button style={{ marginTop: "2rem" }} onClick={save} disabled={saving}>
        {saving ? "Zapisywanie…" : "Zapisz i przejdź dalej"}
      </button>
    </div>
  );
}
