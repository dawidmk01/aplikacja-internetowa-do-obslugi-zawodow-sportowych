import { Navigate } from "react-router-dom";

export default function ProtectedRoute({ children }: { children: JSX.Element }) {
  const access = localStorage.getItem("access");
  const refresh = localStorage.getItem("refresh");

  if (!access && !refresh) return <Navigate to="/login" replace />;
  return children;
}
