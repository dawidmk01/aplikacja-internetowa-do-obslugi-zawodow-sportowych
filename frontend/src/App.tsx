import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { apiFetch, clearTokens, setAccess } from "./api";

import NavBar from "./components/NavBar";
import ProtectedRoute from "./ProtectedRoute";

import TournamentLayout from "./layouts/TournamentLayout";

import { TournamentFlowGuardProvider } from "./flow/TournamentFlowGuardContext";

import Home from "./pages/Home";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import FindTournament from "./pages/FindTournament";
import TournamentPublic from "./pages/TournamentPublic";
import MyTournaments from "./pages/MyTournaments";
import TournamentBasicsSetup from "./pages/TournamentBasicsSetup";
import TournamentTeams from "./pages/TournamentTeams";
import TournamentSchedule from "./pages/TournamentSchedule";
import TournamentResults from "./pages/TournamentResults";
import TournamentDetail from "./pages/TournamentDetail";
import TournamentStandings from "./pages/TournamentStandings";

import { Toaster } from "./ui/Toast";

/** Próbuje znaleźć token dostępu w legacy kluczach localStorage. */
function findAccessToken(): string | null {
  try {
    const directKeys = ["access", "accessToken", "access_token", "jwt_access", "token"];
    for (const k of directKeys) {
      const v = localStorage.getItem(k);
      if (v && v.trim()) return v.trim();
    }

    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;

      const lk = k.toLowerCase();
      if (lk.includes("access") && !lk.includes("refresh")) {
        const v = localStorage.getItem(k);
        if (v && v.trim()) return v.trim();
      }
    }
  } catch {
    // brak
  }
  return null;
}

export default function App() {
  const [username, setUsername] = useState<string | null>(null);

  const loadMe = async () => {
    const token = findAccessToken();
    if (!token) {
      setUsername(null);
      return;
    }

    // Ujednolicenie klucza dla apiFetch.
    setAccess(token);

    try {
      const res = await apiFetch("/api/auth/me/", { method: "GET" });

      if (!res.ok) {
        clearTokens();
        setUsername(null);
        return;
      }

      const data = await res.json().catch(() => null);
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
      <div className="min-h-dvh bg-slate-950 text-slate-100">
        <div className="pointer-events-none fixed inset-0 -z-10">
          <div className="absolute -top-28 left-1/2 h-72 w-[44rem] -translate-x-1/2 rounded-full bg-indigo-500/15 blur-3xl" />
          <div className="absolute top-40 left-1/3 h-72 w-[44rem] -translate-x-1/2 rounded-full bg-purple-500/10 blur-3xl" />
          <div className="absolute -bottom-28 left-1/2 h-72 w-[44rem] -translate-x-1/2 rounded-full bg-sky-500/10 blur-3xl" />
        </div>

        <NavBar username={username} onLogout={handleLogout} />
        <Toaster />

        <main className="w-full px-4 py-6 sm:px-6 lg:px-8 xl:px-10 2xl:px-12">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login onLogin={loadMe} />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/find-tournament" element={<FindTournament />} />

            <Route path="/tournaments/:id" element={<TournamentPublic />} />
            <Route path="/tournaments/:id/standings" element={<TournamentPublic initialView="STANDINGS" />} />

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
        </main>
      </div>
    </BrowserRouter>
  );
}
