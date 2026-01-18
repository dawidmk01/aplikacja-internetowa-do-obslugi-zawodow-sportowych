// frontend/src/pages/FindTournament.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function FindTournament() {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleSearch = () => {
    setError(null);

    const raw = input.trim();
    if (!raw) {
      setError("Wpisz link lub ID turnieju.");
      return;
    }

    // 1) pełny link
    try {
      const url = new URL(raw);
      const match = url.pathname.match(/\/tournaments\/(\d+)/);
      if (match) {
        navigate(`/tournaments/${match[1]}${url.search}`);
        return;
      }
    } catch {
      // nie URL
    }

    // 2) samo ID
    if (/^\d+$/.test(raw)) {
      navigate(`/tournaments/${raw}`);
      return;
    }

    setError("Nieprawidłowy link lub ID turnieju.");
  };

  return (
    <div style={{ padding: "2rem", maxWidth: "600px" }}>
      <h1>Wyszukaj turniej</h1>

      <p>Wklej link do turnieju (np. z QR code) lub wpisz jego ID.</p>

      <input
        type="text"
        placeholder="https://example.com/tournaments/12 lub 12"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        style={{ width: "100%" }}
      />

      <button style={{ marginTop: "1rem" }} onClick={handleSearch}>
        Przejdź do turnieju
      </button>

      {error && (
        <p style={{ color: "crimson", marginTop: "0.5rem" }}>
          {error}
        </p>
      )}
    </div>
  );
}
