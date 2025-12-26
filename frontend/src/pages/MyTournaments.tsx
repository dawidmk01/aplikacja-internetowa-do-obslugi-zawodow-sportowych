import { useEffect, useState } from "react";
import { apiGet } from "../api";
import { Link } from "react-router-dom";

type Tournament = {
  id: number;
  name: string;
  discipline: string;
  my_role: "ORGANIZER" | "ASSISTANT" | null;
};

export default function MyTournaments() {
  const [items, setItems] = useState<Tournament[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<Tournament[]>("/api/tournaments/")
      .then(setItems)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Ładowanie…</p>;
  if (error) return <p style={{ color: "crimson" }}>{error}</p>;

  return (
    <div style={{ padding: "2rem" }}>
      <h1>Moje turnieje</h1>

      {items.length === 0 && <p>Brak turniejów</p>}

      <ul>
        {items.map((t) => (
          <li key={t.id} style={{ marginBottom: 12 }}>
            <strong>{t.name}</strong> – {t.discipline}
            <br />
            <small>Rola: {t.my_role}</small>
            <br />
            <Link to={`/tournaments/${t.id}`}>Szczegóły</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
