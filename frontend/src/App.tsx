import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import NavBar from "./components/NavBar";
import { apiFetch } from "./api";

import TournamentList from "./pages/TournamentList";
import TournamentDetail from "./pages/TournamentDetail";
import Login from "./pages/Login";
import MyTournaments from "./pages/MyTournaments";
import ProtectedRoute from "./ProtectedRoute";
import CreateTournament from "./pages/CreateTournament";

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

  useEffect(() => {
    loadMe();
  }, []);

  return (
    <BrowserRouter>
      <NavBar username={username} />

      <Routes>
        {/* Public */}
        <Route path="/" element={<TournamentList />} />
        <Route path="/login" element={<Login />} />

        {/* Alias: jeśli gdzieś jeszcze masz navigate("/dashboard") */}
        <Route path="/dashboard" element={<Navigate to="/my-tournaments" replace />} />

        {/* Auth */}
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

        <Route
          path="/tournaments/:id"
          element={
              <TournamentDetail />
          }
        />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
