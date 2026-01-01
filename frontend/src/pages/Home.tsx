import { Link } from "react-router-dom";

export default function Home() {
  return (
    <div style={{ padding: "3rem", maxWidth: "900px" }}>
      {/* HERO */}
      <h1>System do organizacji turniejów sportowych</h1>

      <p style={{ marginTop: "1rem", fontSize: "1.1rem" }}>
        Aplikacja umożliwia tworzenie, konfigurację oraz prowadzenie turniejów
        sportowych z kontrolą dostępu dla uczestników i widzów.
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
          <p>
            Masz link, identyfikator turnieju, kod dostępu lub zeskanowałeś QR?
          </p>
          <Link to="/find-tournament">Znajdź turniej</Link>
        </div>

        <div style={{ border: "1px solid #444", padding: "1.5rem", flex: "1" }}>
          <h3>🏆 Jestem organizatorem</h3>
          <p>Zarządzaj swoimi turniejami i ich konfiguracją.</p>
          <Link to="/my-tournaments">Moje turnieje</Link>
        </div>

        <div style={{ border: "1px solid #444", padding: "1.5rem", flex: "1" }}>
          <h3>➕ Nowy turniej</h3>
          <p>Rozpocznij proces tworzenia nowego turnieju.</p>
          <Link to="/tournaments/new">Utwórz turniej</Link>
        </div>
      </div>

      {/* JAK TO DZIAŁA */}
      <div style={{ marginTop: "3rem" }}>
        <h2>Jak to działa?</h2>
        <ol>
          <li>Organizator tworzy i konfiguruje turniej.</li>
          <li>Po publikacji system generuje link, identyfikator oraz kod QR.</li>
          <li>
            Dostęp do turnieju odbywa się przez link, QR lub kod – zgodnie z
            ustawieniami organizatora.
          </li>
        </ol>
      </div>
    </div>
  );
}
