import { Navigate, useLocation } from "react-router-dom";

type Props = {
  children: JSX.Element;
};

/** Ochrona tras panelu - wymusza obecność tokenów i zachowuje docelowy adres w parametrze next. */
export default function ProtectedRoute({ children }: Props) {
  const access = localStorage.getItem("access");
  const refresh = localStorage.getItem("refresh");
  const location = useLocation();

  if (!access && !refresh) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  return children;
}