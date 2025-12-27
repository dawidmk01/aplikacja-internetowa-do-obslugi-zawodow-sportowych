import { Link, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { apiFetch, clearTokens } from "../api";

type Me = {
  id: number;
  username: string;
  email: string;
};

export default function Navbar() {
  const [me, setMe] = useState<Me | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    apiFetch("/api/auth/me/")
      .then((res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => {
        if (data) setMe(data);
      })
      .catch(() => {
        setMe(null);
      });
  }, []);

  const logout = () => {
    clearTokens();
    setMe(null);
    navigate("/login");
  };

  return (
    <nav
      style={{
        padding: "1rem 2rem",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        borderBottom: "1px solid #444",
        marginBottom: "2rem",
      }}
    >
      <strong>
        <Link to="/" style={{ textDecoration: "none" }}>
          Organizer Turniejów
        </Link>
      </strong>

      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        {me ? (
          <>
            <span>Zalogowany jako <strong>{me.username}</strong></span>

            <Link to="/dashboard">Panel</Link>
            <Link to="/my-tournaments">Moje turnieje</Link>

            <button onClick={logout}>Wyloguj</button>
          </>
        ) : (
          <>
            <Link to="/login">Zaloguj</Link>
            <Link to="/login">Zarejestruj</Link>
          </>
        )}
      </div>
    </nav>
  );
}
