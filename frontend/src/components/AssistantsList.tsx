import { useEffect, useState } from "react";
import { getAssistants, removeAssistant } from "../api";

type Assistant = {
  user_id: number; // 🔴 TO JEST KLUCZ
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

  const load = () => {
    setLoading(true);
    getAssistants(tournamentId)
      .then(setItems)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [tournamentId]);

  const remove = async (userId: number) => {
    if (!confirm("Usunąć współorganizatora?")) return;

    try {
      await removeAssistant(tournamentId, userId);
      load();
    } catch (e: any) {
      alert(e.message);
    }
  };

  if (loading) return <p>Ładowanie współorganizatorów…</p>;
  if (error) return <p style={{ color: "crimson" }}>{error}</p>;
  if (items.length === 0) return <p>Brak współorganizatorów</p>;

  return (
    <div style={{ marginTop: "2rem" }}>
      <h3>Współorganizatorzy</h3>

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
    </div>
  );
}
