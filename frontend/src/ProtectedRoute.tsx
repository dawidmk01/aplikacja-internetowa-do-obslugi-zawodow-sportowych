// frontend/src/ProtectedRoute.tsx
// Plik chroni trasy panelu i wymaga aktywnego access tokena w pamięci aplikacji.

import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { hasAuthTokens } from "./api";

type Props = {
  children: ReactNode;
};

export default function ProtectedRoute({ children }: Props) {
  const location = useLocation();

  if (!hasAuthTokens()) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  return <>{children}</>;
}