import { toast } from "./ui/Toast";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");

// ===== Tokeny =====

export function getAccess(): string | null {
  return localStorage.getItem("access");
}

export function getRefresh(): string | null {
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

// ===== Odświeżanie JWT =====

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

function isFormData(body: unknown): body is FormData {
  return typeof FormData !== "undefined" && body instanceof FormData;
}

// ===== Mapowanie błędów =====

export type ApiFetchInit = RequestInit & {
  toastOnError?: boolean;
  errorToastMessage?: string;
  errorToastTitle?: string;
};

function pickFirstString(x: unknown): string | null {
  if (!x) return null;
  if (typeof x === "string" && x.trim()) return x.trim();
  if (Array.isArray(x)) {
    for (const v of x) {
      const s = pickFirstString(v);
      if (s) return s;
    }
  }
  if (typeof x === "object") {
    const obj = x as Record<string, unknown>;
    const direct =
      pickFirstString(obj.detail) ||
      pickFirstString(obj.message) ||
      pickFirstString(obj.error) ||
      pickFirstString(obj.non_field_errors);
    if (direct) return direct;

    for (const k of Object.keys(obj)) {
      const s = pickFirstString(obj[k]);
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

// ===== apiFetch =====

/** apiFetch centralizuje autoryzację, refresh JWT i globalne toasty dla błędów sieci/systemu. */
export async function apiFetch(path: string, init: ApiFetchInit = {}): Promise<Response> {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const method = (init.method || "GET").toUpperCase();
  const body = (init as RequestInit).body;

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
    const msg = "Brak połączenia z serwerem. Sprawdź internet i spróbuj ponownie.";

    if (toastOnError) {
      toast.error(msg, { title: "Sieć" });
    }

    // Nie rzucamy wyjątku, żeby nie generować drugiego toastu z unhandled error.
    return new Response(JSON.stringify({ detail: msg, code: "NETWORK_ERROR" }), {
      status: 599,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// ===== Helpery JSON =====

export async function apiGet<T>(path: string, init: ApiFetchInit = {}): Promise<T> {
  const res = await apiFetch(path, init);
  if (!res.ok) {
    const msg = await getResponseErrorMessage(res.clone());
    throw new Error(msg);
  }
  return res.json();
}

// ===== Assistants API =====

export async function addAssistant(tournamentId: number, email: string): Promise<void> {
  const res = await apiFetch(`/api/tournaments/${tournamentId}/assistants/add/`, {
    method: "POST",
    body: JSON.stringify({ email }),
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