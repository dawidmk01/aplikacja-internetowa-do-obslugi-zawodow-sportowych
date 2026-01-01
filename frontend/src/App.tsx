import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import NavBar from "./components/NavBar";
import { apiFetch, clearTokens } from "./api";

/* ===== STRONY PUBLICZNE ===== */
import Home from "./pages/Home";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import FindTournament from "./pages/FindTournament";

/* ===== STREFA ZALOGOWANA ===== */
import ProtectedRoute from "./ProtectedRoute";
import MyTournaments from "./pages/MyTournaments";
import CreateTournament from "./pages/CreateTournament";

/* ===== NOWY FLOW TURNIEJU ===== */
import TournamentSetup from "./pages/TournamentSetup";     // krok 2
import TournamentTeams from "./pages/TournamentTeams";     // krok 3
import TournamentDetail from "./pages/TournamentDetail";   // podgląd
import TournamentMatches from "./pages/TournamentMatches"; // mecze

/**
 * ARCHITEKTURA ROUTINGU
 * ====================
 *
 * NOWY PRZEPŁYW:
 * 1️⃣ /tournaments/new
 * 2️⃣ /tournaments/:id/setup
 * 3️⃣ /tournaments/:id/teams
 * 4️⃣ /tournaments/:id
 * 5️⃣ /tournaments/:id/matches
 *
 * Stare widoki są USUNIĘTE z routingu.
 */

export default function App() {
  const [username, setUsername] = useState<string | null>(null);

  /* =========================
     SESJA UŻYTKOWNIKA
     ========================= */

  const loadMe = async () => {
    try {
      const res = await apiFetch("/api/auth/me/");
      if (!res.ok) {
        setUsername(null);
        return;
      }
      const data = await res.json();
      setUsername(data?.username ?? null);
    } catch {
      setUsername(null);
    }
  };

  const handleLogout = () => {
    clearTokens();
    setUsername(null);
  };

  useEffect(() => {
    loadMe();
  }, []);

  return (
    <BrowserRouter>
      <NavBar username={username} onLogout={handleLogout} />

      <Routes>
        {/* =========================
            PUBLICZNE
           ========================= */}
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login onLogin={loadMe} />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/find-tournament" element={<FindTournament />} />

        {/* =========================
            STREFA ZALOGOWANA
           ========================= */}
        <Route
          path="/my-tournaments"
          element={
            <ProtectedRoute>
              <MyTournaments />
            </ProtectedRoute>
          }
        />

        {/* =========================
            KROK 1 – UTWORZENIE
           ========================= */}
        <Route
          path="/tournaments/new"
          element={
            <ProtectedRoute>
              <CreateTournament />
            </ProtectedRoute>
          }
        />

        {/* =========================
            KROK 2 – KONFIGURACJA
           ========================= */}
        <Route
          path="/tournaments/:id/setup"
          element={
            <ProtectedRoute>
              <TournamentSetup />
            </ProtectedRoute>
          }
        />

        {/* =========================
            KROK 3 – DRUŻYNY
           ========================= */}
        <Route
          path="/tournaments/:id/teams"
          element={
            <ProtectedRoute>
              <TournamentTeams />
            </ProtectedRoute>
          }
        />

        {/* =========================
            PODGLĄD TURNIEJU
           ========================= */}
        <Route path="/tournaments/:id" element={<TournamentDetail />} />

        {/* =========================
            MECZE
           ========================= */}
        <Route
          path="/tournaments/:id/matches"
          element={
            <ProtectedRoute>
              <TournamentMatches />
            </ProtectedRoute>
          }
        />

        {/* =========================
            FALLBACK
           ========================= */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
