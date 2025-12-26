import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apiFetch } from "../api";
import AddAssistantForm from "../components/AddAssistantForm";
import AssistantsList from "../components/AssistantsList";

type Tournament = {
  id: number;
  name: string;
  discipline: string;
  is_private: boolean;
  start_date: string | null;
  end_date: string | null;
  my_role: "ORGANIZER" | "ASSISTANT" | null;
};

export default function TournamentDetail() {
  const { id } = useParams<{ id: string }>();
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // <-- NOWE: zmiana tej wartości wymusza „przeładowanie” AssistantsList
  const [assistantsVersion, setAssistantsVersion] = useState(0);

  useEffect(() => {
    if (!id) return;

    setLoading(true);
    setError(null);

    apiFetch(`/api/tournaments/${id}/`)
      .then((res) => {
        if (!res.ok) {
          throw new Error("Nie udało się pobrać danych turnieju.");
        }
        return res.json();
      })
      .then((data: Tournament) => {
        setTournament(data);
      })
      .catch((e) => {
        setError(e.message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [id]);

  if (loading) return <p>Ładowanie…</p>;
  if (error) return <p style={{ color: "crimson" }}>{error}</p>;
  if (!tournament) return <p>Brak danych turnieju.</p>;

  const handleAssistantAdded = () => {
    // Wymusza ponowne zamontowanie AssistantsList → ponowny fetch
    setAssistantsVersion((v) => v + 1);
  };

  return (
    <div style={{ padding: "2rem" }}>
      <h1>{tournament.name}</h1>

      <p>
        <strong>Dyscyplina:</strong> {tournament.discipline}
      </p>

      <p>
        <strong>Twoja rola:</strong> {tournament.my_role ?? "brak uprawnień"}
      </p>

      <p>
        <strong>Prywatny:</strong> {tournament.is_private ? "tak" : "nie"}
      </p>

      {tournament.start_date && (
        <p>
          <strong>Data rozpoczęcia:</strong> {tournament.start_date}
        </p>
      )}

      {tournament.end_date && (
        <p>
          <strong>Data zakończenia:</strong> {tournament.end_date}
        </p>
      )}

      {/* 🔐 RBAC — tylko ORGANIZER */}
      {tournament.my_role === "ORGANIZER" && (
        <>
          <AddAssistantForm
            tournamentId={tournament.id}
            onAdded={handleAssistantAdded}
          />

          <AssistantsList
            key={`${tournament.id}:${assistantsVersion}`} // <-- KLUCZ: wymusza refresh listy
            tournamentId={tournament.id}
            canManage={true}
          />
        </>
      )}
    </div>
  );
}
