import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import NavBar from "./components/NavBar";
import { apiFetch, clearTokens } from "./api";

import TournamentDetail from "./pages/TournamentDetail";
import TournamentTeamsSetup from "./pages/TournamentTeamsSetup";
import TournamentMatches from "./pages/TournamentMatches";

import Login from "./pages/Login";
import MyTournaments from "./pages/MyTournaments";
import ProtectedRoute from "./ProtectedRoute";
import CreateTournament from "./pages/CreateTournament";
import FindTournament from "./pages/FindTournament";
import Home from "./pages/Home";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";

export default function App() {
  const [username, setUsername] = useState<string | null>(null);

  /**
   * Pobranie informacji o aktualnie zalogowanym użytkowniku.
   * Stan ten stanowi centralne źródło informacji o sesji użytkownika
   * w aplikacji klienckiej.
   */
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

  /**
   * Wylogowanie użytkownika.
   * Operacja usuwa tokeny uwierzytelniające oraz resetuje
   * stan sesji po stronie aplikacji.
   */
  const handleLogout = () => {
    clearTokens();
    setUsername(null);
  };

  /**
   * Inicjalne sprawdzenie stanu sesji po uruchomieniu aplikacji.
   */
  useEffect(() => {
    loadMe();
  }, []);

  return (
    <BrowserRouter>
      <NavBar username={username} onLogout={handleLogout} />

      <Routes>
        {/* Widoki publiczne */}
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login onLogin={loadMe} />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/find-tournament" element={<FindTournament />} />
        <Route path="/tournaments/:id" element={<TournamentDetail />} />

        {/* Zgodność wsteczna */}
        <Route
          path="/dashboard"
          element={<Navigate to="/my-tournaments" replace />}
        />

        {/* Widoki dostępne wyłącznie dla użytkowników zalogowanych */}
        <Route
          path="/my-tournaments"
          element={
            <ProtectedRoute>
              <MyTournaments />
            </ProtectedRoute>
          }
        />

        <Route
          path="/tournaments/new"
          element={
            <ProtectedRoute>
              <CreateTournament />
            </ProtectedRoute>
          }
        />

        {/* Drugi etap kreatora – konfiguracja uczestników */}
        <Route
          path="/tournaments/:id/teams"
          element={
            <ProtectedRoute>
              <TournamentTeamsSetup />
            </ProtectedRoute>
          }
        />

        {/* === WARIANT A: MECZE TURNIEJU === */}
        <Route
          path="/tournaments/:id/matches"
          element={
            <ProtectedRoute>
              <TournamentMatches />
            </ProtectedRoute>
          }
        />

        {/* Przekierowanie dla nieobsługiwanych tras */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
