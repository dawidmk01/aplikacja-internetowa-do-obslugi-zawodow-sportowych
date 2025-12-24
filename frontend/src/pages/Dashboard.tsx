import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, clearTokens } from "../api";

export default function Dashboard() {
  const [me, setMe] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const logout = () => {
    clearTokens();
    navigate("/login", { replace: true });
  };

  useEffect(() => {
    apiFetch("/api/auth/me/")
      .then((res) => {
        if (res.status === 401) {
          // refresh się nie udał albo brak refresh → wyloguj
          throw new Error("Sesja wygasła. Zaloguj się ponownie.");
        }
        if (!res.ok) {
          throw new Error("Błąd pobierania danych użytkownika.");
        }
        return res.json();
      })
      .then((data) => setMe(data))
      .catch((e) => {
        setError(e.message);
        clearTokens();
        navigate("/login", { replace: true });
      });
  }, [navigate]);

  return (
    <div style={{ padding: "2rem" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Panel</h1>
        <button onClick={logout}>Wyloguj</button>
      </div>

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {me && (
        <pre style={{ background: "#f5f5f5", padding: 12 }}>
          {JSON.stringify(me, null, 2)}
        </pre>
      )}
    </div>
  );
}

