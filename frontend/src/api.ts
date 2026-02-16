// frontend/src/api.ts
import { toast } from "./ui/Toast";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");

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

export function setRefresh(token: string) {
  localStorage.setItem("refresh", token);
}

export function clearTokens() {
  localStorage.removeItem("access");
  localStorage.removeItem("refresh");
}

export function hasAuthTokens() {
  return Boolean(getAccess() || getRefresh());
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

  const data = await res.json().catch(() => ({}));
  if (!data?.access) return null;

  setAccess(data.access);
  return data.access;
}

function isFormData(body: any): body is FormData {
  return typeof FormData !== "undefined" && body instanceof FormData;
}

/* =====================
   TOAST / ERROR MAPPING
===================== */

type ApiFetchInit = RequestInit & {
  /** Domyślnie: true. Ustaw na false, jeśli dany ekran sam obsługuje błąd. */
  toastOnError?: boolean;

  /** Nadpisuje komunikat błędu, jeśli chcesz zawsze stały tekst. */
  errorToastMessage?: string;

  /** Nadpisuje tytuł (opcjonalnie) */
  errorToastTitle?: string;
};

function pickFirstString(x: any): string | null {
  if (!x) return null;
  if (typeof x === "string" && x.trim()) return x.trim();
  if (Array.isArray(x)) {
    for (const v of x) {
      const s = pickFirstString(v);
      if (s) return s;
    }
  }
  if (typeof x === "object") {
    // typowe: { detail }, { message }, { non_field_errors: [] }, { field: [] }
    const direct =
      pickFirstString((x as any).detail) ||
      pickFirstString((x as any).message) ||
      pickFirstString((x as any).error) ||
      pickFirstString((x as any).non_field_errors);
    if (direct) return direct;

    for (const k of Object.keys(x)) {
      const s = pickFirstString((x as any)[k]);
      if (s) return s;
    }
  }
  return null;
}

async function getResponseErrorMessage(res: Response): Promise<string> {
  const fallback = `Błąd (${res.status})`;

  try {
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const data = await res.json().catch(() => null);
      return pickFirstString(data) || fallback;
    }

    const text = await res.text().catch(() => "");
    const t = (text || "").trim();
    return t ? t.slice(0, 240) : fallback;
  } catch {
    return fallback;
  }
}

function defaultTitleForStatus(status: number): string | undefined {
  if (status === 401) return "Sesja";
  if (status === 403) return "Brak uprawnień";
  if (status === 404) return "Nie znaleziono";
  if (status >= 500) return "Serwer";
  return undefined;
}

function defaultMessageForStatus(status: number): string | undefined {
  if (status === 401) return "Sesja wygasła. Zaloguj się ponownie.";
  if (status === 403) return "Nie masz uprawnień do wykonania tej operacji.";
  if (status >= 500) return "Wystąpił błąd serwera. Spróbuj ponownie za chwilę.";
  return undefined;
}

/* =====================
   CORE API FETCH
===================== */

export async function apiFetch(path: string, init: ApiFetchInit = {}): Promise<Response> {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const method = (init.method || "GET").toUpperCase();
  const body: any = (init as any).body;

  const makeHeaders = (token?: string) => {
    const h = new Headers(init.headers || undefined);

    const hasBody = body !== undefined && body !== null;
    if (hasBody && !h.has("Content-Type") && !isFormData(body)) {
      h.set("Content-Type", "application/json");
    }

    if (token) h.set("Authorization", `Bearer ${token}`);
    return h;
  };

  const doFetch = (token?: string) =>
    fetch(url, {
      ...init,
      method,
      headers: makeHeaders(token),
    });

  const toastOnError = init.toastOnError !== false;

  try {
    let res = await doFetch(getAccess() ?? undefined);

    // 401 → spróbuj refresh
    if (res.status === 401) {
      const newAccess = await refreshAccessToken();
      if (!newAccess) {
        clearTokens();
        if (toastOnError) {
          toast.error(init.errorToastMessage || defaultMessageForStatus(401) || "Brak autoryzacji", {
            title: init.errorToastTitle || defaultTitleForStatus(401),
          });
        }
        return res;
      }
      res = await doFetch(newAccess);
    }

    // Inne błędy → toast (bez konsumowania body)
    if (!res.ok && toastOnError) {
      const msg =
        init.errorToastMessage ||
        defaultMessageForStatus(res.status) ||
        (await getResponseErrorMessage(res.clone()));
      const title = init.errorToastTitle || defaultTitleForStatus(res.status);

      toast.error(msg, { title });
    }

    return res;
  } catch {
    // network / CORS / offline
    if (toastOnError) {
      toast.error("Brak połączenia z serwerem. Sprawdź internet i spróbuj ponownie.", {
        title: "Sieć",
      });
    }
    // “udajemy” Response? Nie — zachowujemy kontrakt: rzucamy dalej (łatwiej debugować)
    throw new Error("Network error");
  }
}

/* =====================
   HELPERS
===================== */

export async function apiGet<T>(path: string, init: ApiFetchInit = {}): Promise<T> {
  const res = await apiFetch(path, init);
  if (!res.ok) {
    const msg = await getResponseErrorMessage(res.clone());
    throw new Error(msg);
  }
  return res.json();
}

/* =====================
   ASSISTANTS API
===================== */

export async function addAssistant(tournamentId: number, email: string): Promise<void> {
  const res = await apiFetch(`/api/tournaments/${tournamentId}/assistants/add/`, {
    method: "POST",
    body: JSON.stringify({ email }),
    // tu toast może zostać włączony globalnie, ale zostawiamy też sensowny wyjątek:
    toastOnError: false,
  });

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
  const res = await apiFetch(`/api/tournaments/${tournamentId}/assistants/`);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

export async function removeAssistant(tournamentId: number, userId: number) {
  const res = await apiFetch(`/api/tournaments/${tournamentId}/assistants/${userId}/remove/`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.detail || `API error ${res.status}`);
  }
}
