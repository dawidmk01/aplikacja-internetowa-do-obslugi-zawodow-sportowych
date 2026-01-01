import { Link } from "react-router-dom";

type Props = {
  username: string | null;
  onLogout: () => void;
};

export default function NavBar({ username, onLogout }: Props) {
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
      <nav style={{ display: "flex", gap: 16 }}>
        <Link to="/">Strona główna</Link>

        {username && (
          <>
            <Link to="/find-tournament">Wyszukaj turniej</Link>
            <Link to="/my-tournaments">Moje turnieje</Link>
            <Link to="/tournaments/new">Utwórz turniej</Link>
          </>
        )}
      </nav>

      {/* PRAWA STRONA – SESJA */}
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        {!username ? (
          <>
            <Link to="/login">Zaloguj</Link>
            <Link to="/login?mode=register">Zarejestruj</Link>
          </>
        ) : (
          <>
            <span>
              Zalogowany: <strong>{username}</strong>
            </span>
            <button onClick={onLogout}>Wyloguj</button>
          </>
        )}
      </div>
    </header>
  );
}
