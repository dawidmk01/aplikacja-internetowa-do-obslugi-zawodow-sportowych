import { useEffect, useState, useRef } from "react";
import { useParams } from "react-router-dom";
import { apiFetch } from "../api";
import { QRCodeCanvas } from "qrcode.react";
import AddAssistantForm from "../components/AddAssistantForm";
import AssistantsList from "../components/AssistantsList";

type Tournament = {
  id: number;
  name: string;
  discipline: string;
  is_published: boolean;
  access_code: string | null;
  start_date: string | null;
  end_date: string | null;
  my_role: "ORGANIZER" | "ASSISTANT" | null;
};

export default function TournamentDetail() {
  const { id } = useParams<{ id: string }>();

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 🔐 dostęp przez kod
  const [accessCode, setAccessCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);

  // 👥 asystenci
  const [assistantsVersion, setAssistantsVersion] = useState(0);

  // 🛠 ustawienia organizatora
  const [isPublished, setIsPublished] = useState(false);
  const [newAccessCode, setNewAccessCode] = useState("");

  // 📱 QR canvas ref
  const qrRef = useRef<HTMLCanvasElement | null>(null);

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
            throw new Error("Wymagany kod dostępu.");
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
      .catch((e) => {
        setError(e.message);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchTournament();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /* 🔐 FORMULARZ KODU DOSTĘPU */
  if (needsCode) {
    return (
      <div style={{ padding: "2rem" }}>
        <h2>🔐 Dostęp do turnieju</h2>
        <p>Ten turniej jest zabezpieczony kodem dostępu.</p>

        <input
          type="text"
          placeholder="Wpisz kod dostępu"
          value={accessCode}
          onChange={(e) => setAccessCode(e.target.value)}
        />

        <button style={{ marginLeft: "1rem" }} onClick={fetchTournament}>
          Wejdź
        </button>

        {error && <p style={{ color: "crimson" }}>{error}</p>}
      </div>
    );
  }

  if (loading) return <p>Ładowanie…</p>;
  if (error) return <p style={{ color: "crimson" }}>{error}</p>;
  if (!tournament) return <p>Brak danych turnieju.</p>;

  const handleAssistantAdded = () => {
    setAssistantsVersion((v) => v + 1);
  };

  /* 🔗 LINK TURNIEJU (ŹRÓDŁO PRAWDY DLA QR) */
  const tournamentLink =
    `${window.location.origin}/tournaments/${tournament.id}` +
    (tournament.access_code ? `?code=${tournament.access_code}` : "");

  /* 📥 POBIERANIE QR JAKO PNG */
  const downloadQrCode = () => {
    if (!qrRef.current) return;

    const pngUrl = qrRef.current.toDataURL("image/png");
    const link = document.createElement("a");
    link.href = pngUrl;
    link.download = `turniej-${tournament.id}-qr.png`;
    link.click();
  };

  /* 📡 ZAPIS USTAWIEŃ ORGANIZATORA */
  const saveVisibilitySettings = () => {
    apiFetch(`/api/tournaments/${tournament.id}/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        is_published: isPublished,
        access_code: newAccessCode || null,
      }),
    })
      .then((res) => {
        if (!res.ok) {
          throw new Error("Nie udało się zapisać ustawień.");
        }
        return res.json();
      })
      .then((data: Tournament) => {
        setTournament(data);
        alert("Ustawienia zapisane.");
      })
      .catch((e) => {
        alert(e.message);
      });
  };

  return (
    <div style={{ padding: "2rem" }}>
      <h1>{tournament.name}</h1>

      <p>
        <strong>Dyscyplina:</strong> {tournament.discipline}
      </p>

      <p>
        <strong>Twoja rola:</strong>{" "}
        {tournament.my_role ?? "brak uprawnień"}
      </p>

      {/* 👁️ USTAWIENIA ORGANIZATORA */}
      {tournament.my_role === "ORGANIZER" && (
        <div
          style={{
            border: "1px solid #ccc",
            padding: "1rem",
            marginBottom: "1.5rem",
          }}
        >
          <h3>Widoczność turnieju</h3>

          <label>
            <input
              type="checkbox"
              checked={isPublished}
              onChange={(e) => setIsPublished(e.target.checked)}
            />{" "}
            Opublikuj turniej
          </label>

          <div style={{ marginTop: "0.5rem" }}>
            <label>
              Kod dostępu (opcjonalny):{" "}
              <input
                type="text"
                value={newAccessCode}
                onChange={(e) => setNewAccessCode(e.target.value)}
              />
            </label>
          </div>

          <button
            style={{ marginTop: "0.5rem" }}
            onClick={saveVisibilitySettings}
          >
            Zapisz
          </button>
        </div>
      )}

      {/* 📱 QR CODE + LINK */}
      {tournament.my_role === "ORGANIZER" && (
        <div
          style={{
            border: "1px solid #ccc",
            padding: "1rem",
            marginBottom: "1.5rem",
            maxWidth: "320px",
          }}
        >
          <h3>QR code turnieju</h3>

          <QRCodeCanvas
            ref={qrRef}
            value={tournamentLink}
            size={200}
            bgColor="#ffffff"
            fgColor="#000000"
          />

          <p style={{ marginTop: "0.5rem", wordBreak: "break-all" }}>
            {tournamentLink}
          </p>

          <button
            style={{ marginTop: "0.5rem" }}
            onClick={() => {
              navigator.clipboard.writeText(tournamentLink);
              alert("Link skopiowany do schowka");
            }}
          >
            Kopiuj link
          </button>

          <button
            style={{ marginTop: "0.5rem", marginLeft: "0.5rem" }}
            onClick={downloadQrCode}
          >
            Pobierz QR
          </button>
        </div>
      )}

      {/* 👥 ASYSTENCI */}
      {tournament.my_role === "ORGANIZER" && (
        <>
          <AddAssistantForm
            tournamentId={tournament.id}
            onAdded={handleAssistantAdded}
          />

          <AssistantsList
            key={`${tournament.id}:${assistantsVersion}`}
            tournamentId={tournament.id}
            canManage={true}
          />
        </>
      )}
    </div>
  );
}
