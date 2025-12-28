import { useEffect, useState } from "react";
import { getAssistants, removeAssistant } from "../api";

type Assistant = {
  user_id: number; // 🔑 klucz do usuwania
  email: string;
  username: string;
  role: "ASSISTANT";
};

type Props = {
  tournamentId: number;
  canManage: boolean;
};

export default function AssistantsList({
  tournamentId,
  canManage,
}: Props) {
  const [items, setItems] = useState<Assistant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ✅ komunikat czasowy
  const [message, setMessage] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);

    getAssistants(tournamentId)
      .then(setItems)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [tournamentId]);

  const remove = async (userId: number) => {
    try {
      await removeAssistant(tournamentId, userId);
      setMessage("Współorganizator został usunięty.");

      load();

      // ⏱️ automatyczne ukrycie komunikatu
      setTimeout(() => {
        setMessage(null);
      }, 3000);
    } catch (e: any) {
      setError(e.message || "Błąd usuwania współorganizatora");
    }
  };

  if (loading) return <p>Ładowanie współorganizatorów…</p>;
  if (error) return <p style={{ color: "crimson" }}>{error}</p>;

  return (
    <div style={{ marginTop: "2rem" }}>
      <h3>Współorganizatorzy</h3>

      {/* ✅ komunikat sukcesu */}
      {message && (
        <p style={{ color: "green", marginBottom: "0.5rem" }}>
          {message}
        </p>
      )}

      {items.length === 0 ? (
        <p>Brak współorganizatorów</p>
      ) : (
        <ul>
          {items.map((a) => (
            <li key={a.user_id} style={{ marginBottom: 8 }}>
              {a.email} ({a.username})
              {canManage && (
                <button
                  style={{ marginLeft: 8 }}
                  onClick={() => remove(a.user_id)}
                >
                  Usuń
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
