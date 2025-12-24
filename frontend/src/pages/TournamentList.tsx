import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

type Tournament = {
  id: number;
  name: string;
  discipline: string;
};

export default function TournamentList() {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);

  useEffect(() => {
    fetch("http://localhost:8000/api/tournaments/")
      .then((res) => res.json())
      .then((data) => setTournaments(data));
  }, []);

  return (
    <div>
      <h1>Turnieje</h1>

      {tournaments.length === 0 ? (
        <p>Brak turniejów</p>
      ) : (
        <ul>
          {tournaments.map((t) => (
            <li key={t.id}>
              <Link to={`/tournaments/${t.id}`}>
                {t.name} — {t.discipline}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
