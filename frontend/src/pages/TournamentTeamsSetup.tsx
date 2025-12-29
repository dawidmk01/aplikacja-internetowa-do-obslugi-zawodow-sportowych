import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apiFetch } from "../api";

/* =========================
   Typy domenowe
   ========================= */

type Team = {
  id: number;
  name: string;
  status: string;
};

type EntryMode = "ORGANIZER_ONLY" | "OPEN_APPROVAL" | "ACCOUNT_BASED";
type CompetitionType = "TEAM" | "INDIVIDUAL";
type TournamentFormat = "CUP" | "LEAGUE" | "MIXED";

type TournamentDTO = {
  id: number;
  discipline: string;
  status: "DRAFT" | "CONFIGURED" | "RUNNING" | "FINISHED";
  entry_mode?: EntryMode;
  competition_type?: CompetitionType;
  tournament_format?: TournamentFormat;
  participants_count?: number;
};

/* =========================
   Komponent
   ========================= */

export default function TournamentTeamsSetup() {
  const { id } = useParams<{ id: string }>();

  const [tournament, setTournament] = useState<TournamentDTO | null>(null);

  const [competitionType, setCompetitionType] = useState<CompetitionType>("TEAM");
  const [tournamentFormat, setTournamentFormat] = useState<TournamentFormat>("LEAGUE");
  const [entryMode, setEntryMode] = useState<EntryMode>("ORGANIZER_ONLY");

  const [participantsCountInput, setParticipantsCountInput] = useState("2");
  const [teams, setTeams] = useState<Team[]>([]);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /* =========================
     Inicjalizacja
     ========================= */

  const loadTournament = async () => {
    if (!id) return;

    const res = await apiFetch(`/api/tournaments/${id}/`);
    if (!res.ok) throw new Error("Nie udało się pobrać danych turnieju.");

    const data: TournamentDTO = await res.json();
    setTournament(data);

    if (data.entry_mode) setEntryMode(data.entry_mode);
    if (data.competition_type) setCompetitionType(data.competition_type);
    if (data.tournament_format) setTournamentFormat(data.tournament_format);
    if (typeof data.participants_count === "number") {
      setParticipantsCountInput(String(data.participants_count));
    }
  };

  const loadTeams = async () => {
    if (!id) return;

    const res = await apiFetch(`/api/tournaments/${id}/teams/`);
    if (!res.ok) throw new Error("Nie udało się pobrać listy uczestników.");

    const data: Team[] = await res.json();
    setTeams(data);
  };

  useEffect(() => {
    loadTournament().then(loadTeams).catch((e) => setMessage(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /* =========================
     BLOKADA PO KONFIGURACJI
     ========================= */

  if (tournament && tournament.status !== "DRAFT") {
    return (
      <div style={{ padding: "2rem" }}>
        <h2>Konfiguracja zamknięta</h2>
        <p>
          Rozgrywki zostały już wygenerowane.
          Edycja struktury uczestników nie jest możliwa.
        </p>
      </div>
    );
  }

  /* =========================
     Zapis konfiguracji
     ========================= */

  const setupTeams = async () => {
    if (!id) return;

    setLoading(true);
    setMessage(null);

    try {
      const count = parseInt(participantsCountInput, 10);
      if (count < 2) throw new Error("Liczba uczestników musi być ≥ 2.");

      const res = await apiFetch(`/api/tournaments/${id}/teams/setup/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entry_mode: entryMode,
          competition_type: competitionType,
          tournament_format: tournamentFormat,
          participants_count: count,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail || "Nie udało się zapisać konfiguracji.");
      }

      await loadTeams();
      setMessage("Konfiguracja zapisana.");
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setLoading(false);
    }
  };

  /* =========================
     Aktualizacja nazw
     ========================= */

  const updateTeamName = async (teamId: number, name: string) => {
    if (!id) return;

    await apiFetch(`/api/tournaments/${id}/teams/${teamId}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  };

  return (
    <div style={{ padding: "2rem", maxWidth: 700 }}>
      <h1>Konfiguracja uczestników</h1>

      <label>Format</label>
      <select
        value={tournamentFormat}
        onChange={(e) => setTournamentFormat(e.target.value as TournamentFormat)}
      >
        <option value="LEAGUE">Liga</option>
        <option value="CUP">Puchar</option>
        <option value="MIXED">Mieszany</option>
      </select>

      <label>Liczba uczestników</label>
      <input
        type="number"
        value={participantsCountInput}
        onChange={(e) => setParticipantsCountInput(e.target.value)}
      />

      <button onClick={setupTeams} disabled={loading}>
        Zapisz konfigurację
      </button>

      {message && <p>{message}</p>}

      <hr />

      <h2>Uczestnicy</h2>

      {teams.map((team) => (
        <input
          key={team.id}
          value={team.name}
          onChange={(e) =>
            setTeams((prev) =>
              prev.map((t) => (t.id === team.id ? { ...t, name: e.target.value } : t))
            )
          }
          onBlur={(e) => updateTeamName(team.id, e.target.value)}
        />
      ))}
    </div>
  );
}
