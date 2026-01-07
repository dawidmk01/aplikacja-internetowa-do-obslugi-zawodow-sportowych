import { useLocation, useNavigate } from "react-router-dom";

export default function BackButton() {
  const navigate = useNavigate();
  const location = useLocation();

  // Nie pokazujemy przycisku na stronie głównej
  if (location.pathname === "/") {
    return null;
  }

  return (
    <button
      type="button"
      onClick={() => navigate(-1)}
      style={{
        position: "absolute",
        top: "1rem",
        left: "1rem",
        padding: "0.4rem 0.75rem",
        borderRadius: 6,
        border: "1px solid #333",
        background: "transparent",
        color: "inherit",
        cursor: "pointer",
        fontSize: "0.9rem",
      }}
      aria-label="Wróć"
    >
      ← Wróć
    </button>
  );
}
