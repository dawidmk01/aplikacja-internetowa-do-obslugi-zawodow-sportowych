import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import NavBar from "./components/NavBar";
import { apiFetch, clearTokens } from "./api";

import TournamentDetail from "./pages/TournamentDetail";
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

  // 🔄 sprawdzenie aktualnego użytkownika
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

  // 🔓 WYLOGOWANIE – jedyne źródło prawdy
  const handleLogout = () => {
    clearTokens();
    setUsername(null);
  };

  // ⏱️ pierwsze załadowanie użytkownika
  useEffect(() => {
    loadMe();
  }, []);

  return (
    <BrowserRouter>
      <NavBar username={username} onLogout={handleLogout} />

      <Routes>
        {/* 🌐 Publiczne */}
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login onLogin={loadMe} />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/find-tournament" element={<FindTournament />} />
        <Route path="/tournaments/:id" element={<TournamentDetail />} />

        {/* 🔁 Alias – zgodność wsteczna */}
        <Route
          path="/dashboard"
          element={<Navigate to="/my-tournaments" replace />}
        />

        {/* 🔐 Tylko dla zalogowanych */}
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

        {/* 🚫 Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
