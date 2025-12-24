import { BrowserRouter, Routes, Route } from "react-router-dom";
import TournamentList from "./pages/TournamentList";
import TournamentDetail from "./pages/TournamentDetail";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import ProtectedRoute from "./ProtectedRoute";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<TournamentList />} />
        <Route path="/tournaments/:id" element={<TournamentDetail />} />

        <Route path="/login" element={<Login />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
