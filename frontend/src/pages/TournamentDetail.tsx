import { useEffect, useState, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { apiFetch } from "../api";
import { QRCodeCanvas } from "qrcode.react";
import AddAssistantForm from "../components/AddAssistantForm";
import AssistantsList from "../components/AssistantsList";

/* =========================
   Typy danych
   ========================= */

type Tournament = {
  id: number;
  name: string;
  discipline: string;
  tournament_format: "LEAGUE" | "CUP" | "MIXED";
  status: "DRAFT" | "CONFIGURED" | "RUNNING" | "FINISHED";
  is_published: boolean;
  access_code: string | null;
  my_role: "ORGANIZER" | "ASSISTANT" | null;
};

/* =========================
   Komponent
   ========================= */

export default function TournamentDetail() {
  const { id } = useParams<{ id: string }>();

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [accessCode, setAccessCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);

  const [assistantsVersion, setAssistantsVersion] = useState(0);

  const [isPublished, setIsPublished] = useState(false);
  const [newAccessCode, setNewAccessCode] = useState("");

  const qrRef = useRef<HTMLCanvasElement | null>(null);

  /* =========================
     Pobieranie turnieju
     ========================= */

  const fetchTournament = () => {
    if (!id) return;

    setLoading(true);
    setError(null);

    const url =
      `/api/tournaments/${id}/` +
      (accessCode ? `?code=${accessCode}` : "");

    apiFetch(url)
      .then(async (res) => {
        if (res.status === 403) {
          const data = await res.json();
          if (data.detail?.includes("kod")) {
            setNeedsCode(true);
            throw new Error("Wymagany poprawny kod dostępu.");
          }
        }

        if (!res.ok) {
          throw new Error("Brak dostępu do turnieju.");
        }

        return res.json();
      })
      .then((data: Tournament) => {
        setTournament(data);
        setIsPublished(data.is_published);
        setNewAccessCode(data.access_code ?? "");
        setNeedsCode(false);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchTournament();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /* =========================
     Generowanie rozgrywek
     ========================= */

  const generateTournament = () => {
    if (!tournament) return;

    apiFetch(`/api/tournaments/${tournament.id}/generate/`, {
      method: "POST",
    })
      .then((res) => {
        if (!res.ok) {
          throw new Error("Nie udało się wygenerować rozgrywek.");
        }
        return res.json();
      })
      .then(() => {
        fetchTournament(); // 🔴 MOMENT TESTU BACKENDU
        alert("Rozgrywki zostały wygenerowane.");
      })
      .catch((e) => alert(e.message));
  };

  /* =========================
     Widoki dostępu
     ========================= */

  if (needsCode) {
    return (
      <div style={{ padding: "2rem" }}>
        <h2>Dostęp do turnieju</h2>

        <input
          type="text"
          placeholder="Kod dostępu"
          value={accessCode}
          onChange={(e) => setAccessCode(e.target.value)}
        />

        <button onClick={fetchTournament}>Potwierdź</button>
        {error && <p style={{ color: "crimson" }}>{error}</p>}
      </div>
    );
  }

  if (loading) return <p>Ładowanie…</p>;
  if (error) return <p style={{ color: "crimson" }}>{error}</p>;
  if (!tournament) return null;

  /* =========================
     Widok główny
     ========================= */

  return (
    <div style={{ padding: "2rem" }}>
      <h1>{tournament.name}</h1>

      <p><strong>Dyscyplina:</strong> {tournament.discipline}</p>
      <p><strong>Status:</strong> {tournament.status}</p>

      {tournament.my_role && tournament.status === "DRAFT" && (
        <>
          <Link to={`/tournaments/${tournament.id}/teams`}>
            Konfiguruj uczestników
          </Link>

          <div style={{ marginTop: "1rem" }}>
            <button onClick={generateTournament}>
              Generuj rozgrywki
            </button>
          </div>
        </>
      )}

      {tournament.status !== "DRAFT" && (
        <div style={{ marginTop: "1rem" }}>
          <Link to={`/tournaments/${tournament.id}/matches`}>
            Zobacz mecze
          </Link>
        </div>
      )}

      {tournament.my_role === "ORGANIZER" && (
        <>
          <AddAssistantForm
            tournamentId={tournament.id}
            onAdded={() => setAssistantsVersion((v) => v + 1)}
          />

          <AssistantsList
            key={assistantsVersion}
            tournamentId={tournament.id}
            canManage
          />
        </>
      )}
    </div>
  );
}
