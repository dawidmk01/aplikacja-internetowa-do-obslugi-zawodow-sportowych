import { Link, useNavigate } from "react-router-dom";
import { clearTokens } from "../api";

type Props = {
  username: string | null;
};

export default function NavBar({ username }: Props) {
  const navigate = useNavigate();

  const logout = () => {
    clearTokens();
    navigate("/login", { replace: true });
  };

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "1rem 2rem",
        borderBottom: "1px solid #333",
        marginBottom: "1.5rem",
      }}
    >
      {/* LEWA STRONA – NAWIGACJA */}
      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        {username && (
          <>
            <Link to="/my-tournaments">Moje turnieje</Link>
            <Link to="/find-tournament">Wyszukaj turniej</Link>
            <Link to="/tournaments/new">Utwórz turniej</Link>
          </>
        )}
      </div>

      {/* PRAWA STRONA – SESJA */}
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        {!username ? (
          <>
            <Link to="/login">Zaloguj</Link>
            <Link to="/login">Zarejestruj</Link>
          </>
        ) : (
          <>
            <span style={{ opacity: 0.9 }}>
              Zalogowany: <strong>{username}</strong>
            </span>
            <button onClick={logout}>Wyloguj</button>
          </>
        )}
      </div>
    </header>
  );
}
