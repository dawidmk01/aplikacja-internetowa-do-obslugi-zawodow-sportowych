import { Link } from "react-router-dom";

export default function Home() {
  return (
    <div style={{ padding: "3rem", maxWidth: "900px" }}>
      {/* HERO */}
      <h1>Aplikacja do obsługi turniejów sportowych</h1>

      <p style={{ marginTop: "1rem", fontSize: "1.1rem" }}>
        System umożliwia organizację i obsługę turniejów sportowych
        z kontrolą dostępu dla uczestników i widzów.
      </p>

      {/* AKCJE */}
      <div
        style={{
          display: "flex",
          gap: "1.5rem",
          marginTop: "2.5rem",
          flexWrap: "wrap",
        }}
      >
        <div style={{ border: "1px solid #444", padding: "1.5rem", flex: "1" }}>
          <h3>🎟️ Jestem widzem</h3>
          <p>Masz link lub kod do turnieju?</p>
          <Link to="/find-tournament">Znajdź turniej</Link>
        </div>

        <div style={{ border: "1px solid #444", padding: "1.5rem", flex: "1" }}>
          <h3>🏆 Jestem organizatorem</h3>
          <p>Twórz i zarządzaj turniejami.</p>
          <Link to="/my-tournaments">Moje turnieje</Link>
        </div>

        <div style={{ border: "1px solid #444", padding: "1.5rem", flex: "1" }}>
          <h3>➕ Nowy turniej</h3>
          <p>Rozpocznij organizację zawodów.</p>
          <Link to="/tournaments/new">Utwórz turniej</Link>
        </div>
      </div>

      {/* JAK TO DZIAŁA */}
      <div style={{ marginTop: "3rem" }}>
        <h2>Jak to działa?</h2>
        <ol>
          <li>Organizator tworzy turniej i publikuje go.</li>
          <li>System generuje link lub QR code.</li>
          <li>Widzowie uzyskują dostęp przez link lub kod.</li>
        </ol>
      </div>
    </div>
  );
}
