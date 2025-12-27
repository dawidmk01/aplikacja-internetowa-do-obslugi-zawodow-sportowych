import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api";

type Discipline = "football" | "volleyball" | "basketball" | "tennis" | "wrestling";

export default function CreateTournament() {
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [discipline, setDiscipline] = useState<Discipline>("football");
  const [isPrivate, setIsPrivate] = useState(true);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await apiFetch("/api/tournaments/", {
        method: "POST",
        body: JSON.stringify({
          name,
          discipline,
          is_private: isPrivate,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          data?.detail || (typeof data === "string" ? data : "Nie udało się utworzyć turnieju.")
        );
      }

      const created = await res.json();
      navigate(`/tournaments/${created.id}`);
    } catch (e: any) {
      setError(e.message || "Błąd połączenia z serwerem.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: "2rem", maxWidth: 520 }}>
      <h1>Utwórz turniej</h1>

      <form onSubmit={submit}>
        <div style={{ marginBottom: 12 }}>
          <label>Nazwa</label>
          <input
            style={{ width: "100%", padding: 8 }}
            value={name}
            required
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label>Dyscyplina</label>
          <select
            style={{ width: "100%", padding: 8 }}
            value={discipline}
            onChange={(e) => setDiscipline(e.target.value as Discipline)}
          >
            <option value="football">Piłka nożna</option>
            <option value="volleyball">Siatkówka</option>
            <option value="basketball">Koszykówka</option>
            <option value="tennis">Tenis</option>
            <option value="wrestling">Zapasy</option>
          </select>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
            />
            Prywatny turniej
          </label>
        </div>

        {error && <p style={{ color: "crimson" }}>{error}</p>}

        <button disabled={loading} type="submit">
          {loading ? "Tworzenie…" : "Utwórz"}
        </button>
      </form>
    </div>
  );
}
