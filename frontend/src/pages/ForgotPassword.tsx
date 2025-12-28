import { useState } from "react";
import { apiFetch } from "../api";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const res = await apiFetch("/api/auth/password-reset/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        throw new Error("Nie udało się wysłać żądania resetu hasła.");
      }

      // zawsze ten sam komunikat (bezpieczne)
      setMessage(
        "Jeśli konto istnieje, na podany adres e-mail wysłano link do resetu hasła."
      );
      setEmail("");
    } catch (e: any) {
      setError(e.message || "Błąd połączenia z serwerem.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: "2rem", maxWidth: 420 }}>
      <h1>Reset hasła</h1>

      <p>
        Podaj adres e-mail powiązany z kontem. Jeśli konto istnieje, otrzymasz
        wiadomość z linkiem do resetu hasła.
      </p>

      <form onSubmit={submit}>
        <div style={{ marginBottom: 12 }}>
          <label>E-mail</label>
          <input
            type="email"
            style={{ width: "100%", padding: 8 }}
            value={email}
            required
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        {message && <p style={{ color: "green" }}>{message}</p>}
        {error && <p style={{ color: "crimson" }}>{error}</p>}

        <button disabled={loading} type="submit">
          {loading ? "Wysyłanie…" : "Wyślij link resetu"}
        </button>
      </form>
    </div>
  );
}
