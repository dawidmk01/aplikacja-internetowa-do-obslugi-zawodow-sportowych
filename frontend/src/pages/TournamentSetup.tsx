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

export default function TournamentSetup() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* =========================
     KONFIGURACJA
     ========================= */

  const [format, setFormat] = useState<"LEAGUE" | "CUP" | "MIXED">("LEAGUE");
  const [participants, setParticipants] = useState(8);

  // LIGA
  const [leagueMatches, setLeagueMatches] = useState<1 | 2>(1);

  // PUCHAR (także w MIXED)
  const [cupMatches, setCupMatches] = useState<1 | 2>(1);
  const [finalMatches, setFinalMatches] = useState<1 | 2>(1);
  const [thirdPlace, setThirdPlace] = useState(false);
  const [thirdPlaceMatches, setThirdPlaceMatches] = useState<1 | 2>(1);

  // MIXED – GRUPY
  const [teamsPerGroup, setTeamsPerGroup] = useState(4);
  const [groupMatches, setGroupMatches] = useState<1 | 2>(1);
  const [advanceFromGroup, setAdvanceFromGroup] = useState(2);

  /* =========================
     INIT
     ========================= */

  useEffect(() => {
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
        setTeamsPerGroup(cfg.teams_per_group ?? 4);
        setGroupMatches(cfg.group_matches ?? 1);
        setAdvanceFromGroup(cfg.advance_from_group ?? 2);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  /* =========================
     PODGLĄD – LICZENIE MECZÓW
     ========================= */

  const preview = useMemo(() => {
    if (participants < 2) return null;

    /* ----- LIGA ----- */
    if (format === "LEAGUE") {
      const matches =
        (participants * (participants - 1)) / 2 * leagueMatches;

      return { matches };
    }

    /* ----- PUCHAR ----- */
    if (format === "CUP") {
      const roundsMatches = (participants - 2) * cupMatches;
      const finalCount = finalMatches;
      const thirdCount = thirdPlace ? thirdPlaceMatches : 0;

      return {
        matches: roundsMatches + finalCount + thirdCount,
      };
    }

    /* ----- MIXED ----- */
    if (format === "MIXED") {
      const groups = Math.ceil(participants / teamsPerGroup);
      let groupTotal = 0;

      for (let i = 0; i < groups; i++) {
        const size =
          i === groups - 1
            ? participants - teamsPerGroup * (groups - 1)
            : teamsPerGroup;

        groupTotal += (size * (size - 1)) / 2 * groupMatches;
      }

      const advancing = groups * advanceFromGroup;

      const koRoundsMatches = (advancing - 2) * cupMatches;
      const finalCount = finalMatches;
      const thirdCount = thirdPlace ? thirdPlaceMatches : 0;

      const koTotal = koRoundsMatches + finalCount + thirdCount;

      return {
        groups,
        groupMatches: groupTotal,
        koMatches: koTotal,
        matches: groupTotal + koTotal,
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
    teamsPerGroup,
    groupMatches,
    advanceFromGroup,
  ]);

  /* =========================
     ZAPIS
     ========================= */

  const save = async () => {
    if (!id) return;

    const format_config = {
      league_matches: leagueMatches,
      cup_matches: cupMatches,
      final_matches: finalMatches,
      third_place: thirdPlace,
      third_place_matches: thirdPlaceMatches,
      teams_per_group: teamsPerGroup,
      group_matches: groupMatches,
      advance_from_group: advanceFromGroup,
    };

    try {
      const res = await apiFetch(`/api/tournaments/${id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tournament_format: format,
          participants_count: participants,
          format_config,
        }),
      });

      if (!res.ok) throw new Error("Błąd zapisu konfiguracji.");

      navigate(`/tournaments/${id}/teams`);
    } catch (e: any) {
      setError(e.message);
    }
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

      <section>
        <h3>Rodzaj turnieju</h3>
        <select value={format} onChange={(e) => setFormat(e.target.value as any)}>
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
              onChange={() => setLeagueMatches(1)}
            />{" "}
            1 mecz
          </label>
          <label>
            <input
              type="radio"
              checked={leagueMatches === 2}
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
            Rundy:
            <select
              value={cupMatches}
              onChange={(e) => setCupMatches(Number(e.target.value) as 1 | 2)}
            >
              <option value={1}>1 mecz</option>
              <option value={2}>2 mecze</option>
            </select>
          </label>

          <label>
            Finał:
            <select
              value={finalMatches}
              onChange={(e) => setFinalMatches(Number(e.target.value) as 1 | 2)}
            >
              <option value={1}>1 mecz</option>
              <option value={2}>2 mecze</option>
            </select>
          </label>

          <label>
            <input
              type="checkbox"
              checked={thirdPlace}
              onChange={(e) => setThirdPlace(e.target.checked)}
            />{" "}
            Mecz o 3. miejsce
          </label>

          {thirdPlace && (
            <label>
              Mecz o 3. miejsce:
              <select
                value={thirdPlaceMatches}
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
            Drużyny w grupie:
            <input
              type="number"
              min={3}
              value={teamsPerGroup}
              onChange={(e) => setTeamsPerGroup(Number(e.target.value))}
            />
          </label>

          <label>
            Mecze w grupach:
            <select
              value={groupMatches}
              onChange={(e) =>
                setGroupMatches(Number(e.target.value) as 1 | 2)
              }
            >
              <option value={1}>1 mecz</option>
              <option value={2}>2 mecze</option>
            </select>
          </label>

          <label>
            Awans z grupy:
            <select
              value={advanceFromGroup}
              onChange={(e) => setAdvanceFromGroup(Number(e.target.value))}
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
          {"groupMatches" in preview && (
            <p>Mecze w grupach: {preview.groupMatches}</p>
          )}
          {"koMatches" in preview && (
            <p>Mecze pucharowe: {preview.koMatches}</p>
          )}
          <strong>Łącznie meczów: {preview.matches}</strong>
        </section>
      )}

      <button style={{ marginTop: "2rem" }} onClick={save}>
        Zapisz i przejdź dalej
      </button>
    </div>
  );
}
