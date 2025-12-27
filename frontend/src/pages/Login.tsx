import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function Login() {
  const navigate = useNavigate();

  const [mode, setMode] = useState<"login" | "register">("login");

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === "login") {
        const res = await fetch("http://localhost:8000/api/auth/login/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });

        if (!res.ok) {
          throw new Error("Nieprawidłowy login lub hasło");
        }

        const data = await res.json();
        localStorage.setItem("access", data.access);
        localStorage.setItem("refresh", data.refresh);

        navigate("/my-tournaments");
      } else {
        const res = await fetch("http://localhost:8000/api/auth/register/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, email, password }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.detail || "Błąd rejestracji");
        }

        alert("Konto utworzone. Możesz się zalogować.");
        setMode("login");
        setPassword("");
      }
    } catch (e: any) {
      setError(e.message || "Błąd połączenia z serwerem");
    } finally {
      setLoading(false);
    }
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

        <button disabled={loading} type="submit">
          {loading
            ? "Przetwarzanie…"
            : mode === "login"
            ? "Zaloguj"
            : "Zarejestruj"}
        </button>
      </form>

      <hr style={{ margin: "1.5rem 0" }} />

      {mode === "login" ? (
        <p>
          Nie masz konta?{" "}
          <button onClick={() => setMode("register")}>
            Zarejestruj się
          </button>
        </p>
      ) : (
        <p>
          Masz już konto?{" "}
          <button onClick={() => setMode("login")}>
            Zaloguj się
          </button>
        </p>
      )}
    </div>
  );
}
