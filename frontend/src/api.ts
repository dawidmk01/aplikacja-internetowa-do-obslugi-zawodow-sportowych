const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

export function getAccess() {
  return localStorage.getItem("access");
}

export function getRefresh() {
  return localStorage.getItem("refresh");
}

export function setAccess(token: string) {
  localStorage.setItem("access", token);
}

export function clearTokens() {
  localStorage.removeItem("access");
  localStorage.removeItem("refresh");
}

async function refreshAccessToken(): Promise<string | null> {
  const refresh = getRefresh();
  if (!refresh) return null;

  const res = await fetch(`${API_BASE}/api/auth/refresh/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh }),
  });

  if (!res.ok) return null;

  const data = await res.json();
  if (!data?.access) return null;

  setAccess(data.access);
  return data.access as string;
}

/**
 * Używaj do endpointów wymagających JWT.
 * Jeśli access wygaśnie i API zwróci 401, automatycznie robi refresh i ponawia request.
 */
export async function apiFetch(path: string, init: RequestInit = {}) {
  const doFetch = (token?: string) =>
    fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        ...(init.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

  let res = await doFetch(getAccess() ?? undefined);

  if (res.status === 401) {
    const newAccess = await refreshAccessToken();
    if (!newAccess) {
      clearTokens();
      return res; // zwracamy 401 – komponent zdecyduje co dalej
    }
    res = await doFetch(newAccess);
  }

  return res;
}
