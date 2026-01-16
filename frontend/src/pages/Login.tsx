import { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";

// Pobranie bazy API z env lub fallback na localhost
const API_BASE = (import.meta.env.VITE_API_BASE_URL || "http://localhost:8000").replace(/\/+$/, "");

type Props = {
  onLogin?: () => Promise<void>;
};

export default function Login({ onLogin }: Props) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const urlMode = searchParams.get("mode");

  const [mode, setMode] = useState<"login" | "register">(
    urlMode === "register" ? "register" : "login"
  );

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMode(urlMode === "register" ? "register" : "login");
  }, [urlMode]);

  const translateLoginError = (msg?: string) => {
    if (!msg) return "Błąd logowania.";
    if (msg.includes("No active account")) {
      return "Nieprawidłowy login lub hasło.";
    }
    return msg;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === "login") {
        // ZMIANA: Użycie dynamicznego API_BASE
        const res = await fetch(`${API_BASE}/api/auth/login/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(translateLoginError(data.detail));
        }

        localStorage.setItem("access", data.access);
        localStorage.setItem("refresh", data.refresh);

        await onLogin?.();

        const next = searchParams.get("next");
        if (next && next.startsWith("/")) {
          navigate(next, { replace: true });
        } else {
          navigate("/my-tournaments");
        }

      } else {
        // ZMIANA: Użycie dynamicznego API_BASE
        const res = await fetch(`${API_BASE}/api/auth/register/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, email, password }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.detail || "Błąd rejestracji");
        }

        alert("Konto utworzone. Możesz się zalogować.");

        const next = searchParams.get("next");
        const qs = next ? `?next=${encodeURIComponent(next)}` : "";
        navigate(`/login${qs}`);

        setPassword("");
      }
    } catch (e: any) {
      setError(e.message || "Błąd połączenia z serwerem");
    } finally {
      setLoading(false);
    }
  };

  const switchToRegister = () => {
    const next = searchParams.get("next");
    const qs = next ? `&next=${encodeURIComponent(next)}` : "";
    navigate(`/login?mode=register${qs}`);
  };

  const switchToLogin = () => {
    const next = searchParams.get("next");
    const qs = next ? `?next=${encodeURIComponent(next)}` : "";
    navigate(`/login${qs}`);
  };

  return (
    <div style={{ padding: "2rem", maxWidth: 420 }}>
      <h1>{mode === "login" ? "Logowanie" : "Rejestracja"}</h1>

      <form onSubmit={submit}>
        <div style={{ marginBottom: 12 }}>
          <label>Login</label>
          <input
            style={{ width: "100%", padding: 8 }}
            value={username}
            required
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>

        {mode === "register" && (
          <div style={{ marginBottom: 12 }}>
            <label>Email</label>
            <input
              type="email"
              style={{ width: "100%", padding: 8 }}
              value={email}
              required
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        )}

        <div style={{ marginBottom: 12 }}>
          <label>Hasło</label>
          <input
            type="password"
            style={{ width: "100%", padding: 8 }}
            value={password}
            required
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && <p style={{ color: "crimson" }}>{error}</p>}

        <button disabled={loading} type="submit" style={{ padding: "8px 16px", cursor: loading ? "not-allowed" : "pointer" }}>
          {loading
            ? "Przetwarzanie…"
            : mode === "login"
            ? "Zaloguj"
            : "Zarejestruj"}
        </button>
      </form>

      {mode === "login" && (
        <p style={{ marginTop: 12 }}>
          <Link to="/forgot-password">Nie pamiętasz hasła?</Link>
        </p>
      )}

      <hr style={{ margin: "1.5rem 0" }} />

      {mode === "login" ? (
        <p>
          Nie masz konta?{" "}
          <button
            onClick={switchToRegister}
            style={{ background: "none", border: "none", color: "#007bff", cursor: "pointer", textDecoration: "underline", padding: 0 }}
          >
            Zarejestruj się
          </button>
        </p>
      ) : (
        <p>
          Masz już konto?{" "}
          <button
            onClick={switchToLogin}
            style={{ background: "none", border: "none", color: "#007bff", cursor: "pointer", textDecoration: "underline", padding: 0 }}
          >
            Zaloguj się
          </button>
        </p>
      )}
    </div>
  );
}