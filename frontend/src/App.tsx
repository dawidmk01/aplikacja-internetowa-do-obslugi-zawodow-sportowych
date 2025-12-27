import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import NavBar from "./components/NavBar";
import { apiFetch } from "./api";

import TournamentList from "./pages/TournamentList";
import TournamentDetail from "./pages/TournamentDetail";
import Login from "./pages/Login";
import MyTournaments from "./pages/MyTournaments";
import ProtectedRoute from "./ProtectedRoute";

export default function App() {
  const [username, setUsername] = useState<string | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);

  useEffect(() => {
    apiFetch("/api/auth/me/")
      .then((res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => {
        setUsername(data?.username ?? null);
      })
      .catch(() => {
        setUsername(null);
      })
      .finally(() => {
        setLoadingUser(false);
      });
  }, []);

  if (loadingUser) {
    return <p style={{ padding: "2rem" }}>Ładowanie aplikacji…</p>;
  }

  return (
    <BrowserRouter>
      <NavBar username={username} />

      <Routes>
        <Route path="/" element={<TournamentList />} />
        <Route path="/login" element={<Login />} />

        <Route
          path="/my-tournaments"
          element={
            <ProtectedRoute>
              <MyTournaments />
            </ProtectedRoute>
          }
        />

        <Route
          path="/tournaments/:id"
          element={
            <ProtectedRoute>
              <TournamentDetail />
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
