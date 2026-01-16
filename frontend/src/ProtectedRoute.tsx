import { Navigate, useLocation } from "react-router-dom";

export default function ProtectedRoute({ children }: { children: JSX.Element }) {
  const access = localStorage.getItem("access");
  const refresh = localStorage.getItem("refresh");
  const loc = useLocation();

  if (!access && !refresh) {
    // Zachowujemy pełną ścieżkę wraz z query params (search)
    const next = encodeURIComponent(loc.pathname + loc.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  return children;
}