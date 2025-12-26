const API_BASE =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

/* =====================
   TOKEN HELPERS
===================== */

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

/* =====================
   JWT REFRESH
===================== */

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
  return data.access;
}

/* =====================
   CORE API FETCH
===================== */

export async function apiFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const doFetch = (token?: string) =>
    fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

  let res = await doFetch(getAccess() ?? undefined);

  if (res.status === 401) {
    const newAccess = await refreshAccessToken();
    if (!newAccess) {
      clearTokens();
      return res;
    }
    res = await doFetch(newAccess);
  }

  return res;
}

/* =====================
   HELPERS
===================== */

export async function apiGet<T>(path: string): Promise<T> {
  const res = await apiFetch(path);
  if (!res.ok) {
    throw new Error(`API error ${res.status}`);
  }
  return res.json();
}

/* =====================
   ASSISTANT API
===================== */

export async function addAssistant(
  tournamentId: number,
  email: string
): Promise<void> {
  const res = await apiFetch(
    `/api/tournaments/${tournamentId}/assistants/`,
    {
      method: "POST",
      body: JSON.stringify({ email }),
    }
  );

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));

    throw new Error(
      data?.detail ||
        data?.non_field_errors?.[0] ||
        data?.email?.[0] ||
        "Nie udało się dodać współorganizatora"
    );
  }
}

export async function getAssistants(tournamentId: number) {
  const res = await apiFetch(
    `/api/tournaments/${tournamentId}/assistants/list/`
  );

  if (!res.ok) {
    throw new Error(`API error ${res.status}`);
  }

  return res.json();
}

export async function removeAssistant(
  tournamentId: number,
  userId: number
) {
  const res = await apiFetch(
    `/api/tournaments/${tournamentId}/assistants/${userId}/`,
    { method: "DELETE" }
  );

  if (!res.ok) {
    throw new Error(`API error ${res.status}`);
  }
}
