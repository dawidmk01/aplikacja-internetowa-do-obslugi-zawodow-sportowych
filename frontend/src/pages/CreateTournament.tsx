import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../api";

type Discipline =
  | "football"
  | "volleyball"
  | "basketball"
  | "tennis"
  | "wrestling";

export default function CreateTournament() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const isEditMode = Boolean(id);

  const [name, setName] = useState("");
  const [discipline, setDiscipline] = useState<Discipline>("football");

  // stan pierwotny – do wykrycia zmiany dyscypliny
  const [initialDiscipline, setInitialDiscipline] =
    useState<Discipline>("football");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ======================================================
  // POBIERANIE DANYCH TURNIEJU (TRYB EDYCJI)
  // ======================================================
  useEffect(() => {
    if (!isEditMode) return;

    const fetchTournament = async () => {
      setLoading(true);
      setError(null);

      try {
        const res = await apiFetch(`/api/tournaments/${id}/`);
        if (!res.ok) {
          throw new Error("Nie udało się pobrać danych turnieju");
        }

        const data = await res.json();
        setName(data.name);
        setDiscipline(data.discipline);
        setInitialDiscipline(data.discipline);
      } catch (e: any) {
        setError(e.message || "Błąd pobierania danych");
      } finally {
        setLoading(false);
      }
    };

    fetchTournament();
  }, [id, isEditMode]);

  // ======================================================
  // POMOCNICZE – POTWIERDZENIE ZMIANY DYSCYPLINY
  // ======================================================
  const confirmDisciplineChange = () => {
    return window.confirm(
      "Zmiana dyscypliny spowoduje usunięcie wprowadzonych wyników oraz danych pochodnych (np. tabela/klasyfikacja).\n\n" +
        "Nie zostaną usunięte:\n" +
        "- nazwy drużyn / zawodników\n" +
        "- konfiguracja turnieju (jeśli format pozostaje zgodny)\n\n" +
        "Czy na pewno chcesz kontynuować?"
    );
  };

  // ======================================================
  // ZAPIS
  // ======================================================
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // ----------------------------------
      // TRYB EDYCJI
      // ----------------------------------
      if (isEditMode) {
        // 1) jeśli dyscyplina się zmienia — najpierw potwierdzenie
        if (discipline !== initialDiscipline) {
          const ok = confirmDisciplineChange();
          if (!ok) {
            setLoading(false);
            return; // przerwij zapis
          }

          const res = await apiFetch(
            `/api/tournaments/${id}/change-discipline/`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ discipline }),
            }
          );

          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(
              data?.detail || "Nie udało się zmienić dyscypliny"
            );
          }

          // po udanej zmianie aktualizujemy stan bazowy
          setInitialDiscipline(discipline);
        }

        // 2) zmiana nazwy (zawsze)
        const res = await apiFetch(`/api/tournaments/${id}/`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.detail || "Nie udało się zapisać turnieju");
        }

        navigate(`/tournaments/${id}/setup`);
        return;
      }

      // ----------------------------------
      // TRYB CREATE
      // ----------------------------------
      const res = await apiFetch("/api/tournaments/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, discipline }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.detail || "Nie udało się utworzyć turnieju");
      }

      const tournament = await res.json();
      navigate(`/tournaments/${tournament.id}/setup`);
    } catch (e: any) {
      setError(e.message || "Błąd połączenia z serwerem");
    } finally {
      setLoading(false);
    }
  };

  // ======================================================
  // RENDER
  // ======================================================
  return (
    <div style={{ padding: "2rem", maxWidth: 520 }}>
      <h1>{isEditMode ? "Edytuj turniej" : "Utwórz turniej"}</h1>

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

        {error && (
          <p style={{ color: "crimson", marginBottom: 12 }}>{error}</p>
        )}

        <button disabled={loading} type="submit">
          {loading ? "Zapisywanie…" : "Zapisz i przejdź dalej"}
        </button>
      </form>
    </div>
  );
}
