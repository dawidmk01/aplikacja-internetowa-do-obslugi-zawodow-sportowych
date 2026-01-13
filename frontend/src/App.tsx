import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import NavBar from "./components/NavBar";
import BackButton from "./components/BackButton";
import { apiFetch, clearTokens } from "./api";

/* ===== STRONY PUBLICZNE ===== */
import Home from "./pages/Home";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import FindTournament from "./pages/FindTournament";
import TournamentPublic from "./pages/TournamentPublic";

/* ===== STREFA ZALOGOWANA ===== */
import ProtectedRoute from "./ProtectedRoute";
import MyTournaments from "./pages/MyTournaments";
import TournamentBasicsSetup from "./pages/TournamentBasicsSetup";

/* ===== LAYOUTY ===== */
import TournamentLayout from "./layouts/TournamentLayout";

/* ===== FLOW CONTEXT ===== */
import { TournamentFlowGuardProvider } from "./flow/TournamentFlowGuardContext";

/* ===== FLOW TURNIEJU (ZALOGOWANI) ===== */
import TournamentTeams from "./pages/TournamentTeams";
import TournamentSchedule from "./pages/TournamentSchedule";
import TournamentResults from "./pages/TournamentResults";

/* ===== WIDOKI POZA FLOW (ZALOGOWANI) ===== */
import TournamentDetail from "./pages/TournamentDetail";

/* (jeśli dalej używasz strony standings w panelu zalogowanym) */
import TournamentStandings from "./pages/TournamentStandings";

export default function App() {
  const [username, setUsername] = useState<string | null>(null);

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
      <BackButton />

      <Routes>
        {/* PUBLICZNE */}
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login onLogin={loadMe} />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/find-tournament" element={<FindTournament />} />

        {/* PUBLICZNY TURNIEJ */}
        <Route path="/tournaments/:id" element={<TournamentPublic />} />

        {/* Ten sam widok, tylko startowo na “Tabela/Drabinka” */}
        <Route path="/tournaments/:id/standings" element={<TournamentPublic initialView="STANDINGS" />} />

        {/* STREFA ZALOGOWANA */}
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
              <TournamentFlowGuardProvider>
                <TournamentBasicsSetup />
              </TournamentFlowGuardProvider>
            </ProtectedRoute>
          }
        />

        {/* MANAGEMENT */}
        <Route
          path="/tournaments/:id/detail/*"
          element={
            <ProtectedRoute>
              <TournamentLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<TournamentDetail />} />
          <Route path="edit" element={<Navigate to="setup" replace />} />

          <Route path="setup" element={<TournamentBasicsSetup />} />
          <Route path="teams" element={<TournamentTeams />} />
          <Route path="schedule" element={<TournamentSchedule />} />
          <Route path="results" element={<TournamentResults />} />
          <Route path="standings" element={<TournamentStandings />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
