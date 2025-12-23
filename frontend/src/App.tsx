import { useEffect, useState } from "react";

type Tournament = {
  id: number;
  name: string;
  discipline: string;
};

function App() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("http://localhost:8000/api/tournaments/")
      .then((res) => {
        if (!res.ok) {
          throw new Error("Błąd pobierania danych");
        }
        return res.json();
      })
      .then((data) => {
        setTournaments(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) return <p>Ładowanie...</p>;
  if (error) return <p>Błąd: {error}</p>;

  return (
    <div style={{ padding: "2rem" }}>
      <h1>Turnieje</h1>

      {tournaments.length === 0 ? (
        <p>Brak turniejów</p>
      ) : (
        <ul>
          {tournaments.map((t) => (
            <li key={t.id}>
              <strong>{t.name}</strong> — {t.discipline}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default App;
