import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import NavBar from "./components/NavBar";
// NOWY IMPORT
import BackButton from "./components/BackButton";
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
import TournamentBasicsSetup from "./pages/TournamentBasicsSetup";

/* ===== LAYOUTY ===== */
import TournamentLayout from "./layouts/TournamentLayout";

/* ===== FLOW CONTEXT ===== */
import { TournamentFlowGuardProvider } from "./flow/TournamentFlowGuardContext";

/* ===== FLOW TURNIEJU ===== */
import TournamentTeams from "./pages/TournamentTeams";
import TournamentMatches from "./pages/TournamentMatches";
import TournamentSchedule from "./pages/TournamentSchedule";
import TournamentResults from "./pages/TournamentResults";

/* ===== WIDOKI POZA FLOW ===== */
import TournamentDetail from "./pages/TournamentDetail";
import TournamentStandings from "./pages/TournamentStandings";

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

      {/* GLOBALNY PRZYCISK POWROTU (Poza Routes, widoczny wszędzie oprócz Home) */}
      <BackButton />

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
            TWORZENIE NOWEGO TURNIEJU (NOWY KROK 1)
           ========================= */}
        <Route
          path="/tournaments/new"
          element={
            <ProtectedRoute>
              <TournamentFlowGuardProvider>
                <TournamentBasicsSetup />
              </TournamentFlowGuardProvider>
            </ProtectedRoute>
          }
        />

        {/* =========================
            ZAGNIEŻDŻONY ROUTING TURNIEJU (MANAGEMENT)
           ========================= */}
        <Route
          path="/tournaments/:id"
          element={
            <ProtectedRoute>
              <TournamentLayout />
            </ProtectedRoute>
          }
        >
          {/* Domyślny widok: Szczegóły turnieju */}
          <Route index element={<TournamentDetail />} />

          {/* edit -> setup (Redirect) */}
          <Route path="edit" element={<Navigate to="setup" replace />} />

          {/* POŁĄCZONY KROK (Konfiguracja + Dane) */}
          <Route path="setup" element={<TournamentBasicsSetup />} />

          {/* POZOSTAŁE KROKI */}
          <Route path="teams" element={<TournamentTeams />} />
          <Route path="matches" element={<TournamentMatches />} />
          <Route path="schedule" element={<TournamentSchedule />} />
          <Route path="results" element={<TournamentResults />} />

          {/* TABELA / STANDINGS */}
          <Route path="standings" element={<TournamentStandings />} />
        </Route>

        {/* =========================
            FALLBACK
           ========================= */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}