// frontend/src/App.tsx
// Plik buduje główny routing aplikacji i bootstrapuje sesję użytkownika po starcie.

import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { apiFetch, bootstrapSession, clearTokens } from "./api";

import { Toaster } from "./ui/Toast";

import NavBar from "./components/NavBar";
import ProtectedRoute from "./ProtectedRoute";
import { TournamentFlowGuardProvider } from "./flow/TournamentFlowGuardContext";
import TournamentLayout from "./layouts/TournamentLayout";

import Account from "./pages/Account";
import FindTournament from "./pages/FindTournament";
import ForgotPassword from "./pages/ForgotPassword";
import Home from "./pages/Home";
import Login from "./pages/Login";
import MyTournaments from "./pages/MyTournaments";
import ResetPassword from "./pages/ResetPassword";
import TournamentBasicsSetup from "./pages/TournamentBasicsSetup";
import TournamentDetail from "./pages/TournamentDetail";
import TournamentPublic from "./pages/TournamentPublic";
import TournamentResults from "./pages/TournamentResults";
import TournamentSchedule from "./pages/TournamentSchedule";
import TournamentStandings from "./pages/TournamentStandings";
import TournamentTeams from "./pages/TournamentTeams";

export default function App() {
  const [username, setUsername] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const loadMe = useCallback(async () => {
    setAuthReady(false);

    const token = await bootstrapSession();
    if (!token) {
      setUsername(null);
      setAuthReady(true);
      return;
    }

    try {
      const res = await apiFetch("/api/auth/me/", {
        method: "GET",
        toastOnError: false,
      });

      if (!res.ok) {
        clearTokens();
        setUsername(null);
        setAuthReady(true);
        return;
      }

      const data = await res.json().catch(() => null);
      setUsername(data?.username ?? null);
    } catch {
      setUsername(null);
    } finally {
      setAuthReady(true);
    }
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await apiFetch("/api/auth/logout/", {
        method: "POST",
        toastOnError: false,
      });
    } catch {
      // Logout UI ma się domknąć nawet przy błędzie sieci.
    }

    clearTokens();
    setUsername(null);
  }, []);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

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
          {!authReady ? (
            <div className="mx-auto flex min-h-[40vh] max-w-3xl items-center justify-center">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-300">
                Przywracanie sesji...
              </div>
            </div>
          ) : (
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
                path="/account"
                element={
                  <ProtectedRoute>
                    <Account />
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
          )}
        </main>
      </div>
    </BrowserRouter>
  );
}