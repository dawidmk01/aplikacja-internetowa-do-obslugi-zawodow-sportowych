import { useState } from "react";
import { addAssistant } from "../api";

type Props = {
  tournamentId: number;
  onAdded?: () => void; // <-- NOWE: callback po udanym dodaniu
};

export default function AddAssistantForm({ tournamentId, onAdded }: Props) {
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
      await addAssistant(tournamentId, email);

      setMessage("Współorganizator został dodany.");
      setEmail("");

      // <-- NOWE: odśwież listę w rodzicu
      onAdded?.();
    } catch (e: any) {
      setError(e?.message || "Błąd połączenia z serwerem.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ marginTop: "1.5rem" }}>
      <h3>Dodaj współorganizatora</h3>

      <form onSubmit={submit}>
        <input
          type="email"
          placeholder="Email użytkownika"
          value={email}
          required
          onChange={(e) => setEmail(e.target.value)}
        />

        <button disabled={loading}>
          {loading ? "Dodawanie…" : "Dodaj"}
        </button>
      </form>

      {message && <p style={{ color: "green" }}>{message}</p>}
      {error && <p style={{ color: "crimson" }}>{error}</p>}
    </div>
  );
}
