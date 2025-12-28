import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiFetch } from "../api";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token) {
    return (
      <div style={{ padding: "2rem" }}>
        <p style={{ color: "crimson" }}>Brak tokenu resetu hasła.</p>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Hasła nie są takie same.");
      return;
    }

    setLoading(true);

    try {
      const res = await apiFetch("/api/auth/password-reset/confirm/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          new_password: password,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "Nie udało się zmienić hasła.");
      }

      alert("Hasło zostało zmienione. Możesz się zalogować.");
      navigate("/login");
    } catch (e: any) {
      setError(e.message || "Błąd połączenia z serwerem.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: "2rem", maxWidth: 420 }}>
      <h1>Ustaw nowe hasło</h1>

      <form onSubmit={submit}>
        <div style={{ marginBottom: 12 }}>
          <label>Nowe hasło</label>
          <input
            type="password"
            style={{ width: "100%", padding: 8 }}
            value={password}
            required
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label>Powtórz hasło</label>
          <input
            type="password"
            style={{ width: "100%", padding: 8 }}
            value={confirmPassword}
            required
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>

        {error && <p style={{ color: "crimson" }}>{error}</p>}

        <button disabled={loading} type="submit">
          {loading ? "Zapisywanie…" : "Zmień hasło"}
        </button>
      </form>
    </div>
  );
}
