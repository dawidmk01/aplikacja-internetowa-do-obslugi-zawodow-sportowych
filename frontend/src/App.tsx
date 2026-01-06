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

/* ===== LAYOUTY ===== */
// Dodajemy nowy import layoutu zgodnie ze screenem
import TournamentLayout from "./layouts/TournamentLayout";

/* ===== FLOW TURNIEJU ===== */
import TournamentSetup from "./pages/TournamentSetup";          // krok 2
import TournamentTeams from "./pages/TournamentTeams";          // krok 3
import TournamentMatches from "./pages/TournamentMatches";      // krok 4
import TournamentSchedule from "./pages/TournamentSchedule";    // krok 5
import TournamentResults from "./pages/TournamentResults.tsx";

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
            TWORZENIE NOWEGO TURNIEJU (KROK 1)
            To zostaje osobno, bo nie ma jeszcze ID
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
            ZAGNIEŻDŻONY ROUTING TURNIEJU (MANAGEMENT)
            Tutaj wszystkie podstrony dziedziczą TournamentLayout
           ========================= */}
        <Route
          path="/tournaments/:id"
          element={
            <ProtectedRoute>
              <TournamentLayout />
            </ProtectedRoute>
          }
        >
          {/* Domyślny widok: /tournaments/123 -> Szczegóły turnieju */}
          {/* UWAGA: Teraz ten widok jest chroniony i ma layout.
              Jeśli ma być publiczny, trzeba by zmienić strukturę. */}
          <Route index element={<TournamentDetail />} />

          {/* KROK 1 (EDYCJA) */}
          <Route path="edit" element={<CreateTournament />} />

          {/* KROK 2 – KONFIGURACJA */}
          <Route path="setup" element={<TournamentSetup />} />

          {/* KROK 3 – UCZESTNICY */}
          <Route path="teams" element={<TournamentTeams />} />

          {/* KROK 4 – GENEROWANIE MECZÓW */}
          <Route path="matches" element={<TournamentMatches />} />

          {/* KROK 5 – HARMONOGRAM */}
          <Route path="schedule" element={<TournamentSchedule />} />

          {/* KROK 6 – WYNIKI */}
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