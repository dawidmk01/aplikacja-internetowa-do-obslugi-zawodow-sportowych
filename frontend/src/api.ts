// frontend/src/api.ts
// Plik centralizuje tokeny, wywołania HTTP oraz obsługę globalnych błędów API.

import { toast } from "./ui/Toast";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");
const API_ORIGIN = getOrigin(API_BASE);
const ACCESS_TOKEN_KEY = "access";
const REFRESH_TOKEN_KEY = "refresh";

let refreshPromise: Promise<string | null> | null = null;

export type ApiFetchInit = RequestInit & {
  toastOnError?: boolean;
  errorToastMessage?: string;
  errorToastTitle?: string;
};

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

function getToken(key: string): string | null {
  return getStorage()?.getItem(key) ?? null;
}

function setToken(key: string, token: string) {
  getStorage()?.setItem(key, token);
}

function removeToken(key: string) {
  getStorage()?.removeItem(key);
}

function resolveUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

function shouldAttachAuthHeader(url: string): boolean {
  const targetOrigin = getOrigin(url);
  return Boolean(API_ORIGIN) && targetOrigin === API_ORIGIN;
}

function isFormData(body: unknown): body is FormData {
  return typeof FormData !== "undefined" && body instanceof FormData;
}

function pickFirstString(value: unknown): string | null {
  if (!value) return null;

  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const result = pickFirstString(item);
      if (result) return result;
    }
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const direct =
      pickFirstString(record.detail) ||
      pickFirstString(record.message) ||
      pickFirstString(record.error) ||
      pickFirstString(record.non_field_errors);

    if (direct) return direct;

    for (const key of Object.keys(record)) {
      const result = pickFirstString(record[key]);
      if (result) return result;
    }
  }

  return null;
}

async function getResponseErrorMessage(res: Response): Promise<string> {
  const fallback = `Błąd (${res.status})`;

  try {
    const contentType = res.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const data = await res.json().catch(() => null);
      return pickFirstString(data) || fallback;
    }

    const text = await res.text().catch(() => "");
    const normalized = text.trim();

    return normalized ? normalized.slice(0, 240) : fallback;
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

async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const refresh = getRefresh();
    if (!refresh) return null;

    try {
      const res = await fetch(`${API_BASE}/api/auth/refresh/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh }),
      });

      if (!res.ok) return null;

      const data = await res.json().catch(() => ({}));
      if (!data?.access || typeof data.access !== "string") return null;

      setAccess(data.access);
      return data.access;
    } catch {
      return null;
    }
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

export function getAccess(): string | null {
  return getToken(ACCESS_TOKEN_KEY);
}

export function getRefresh(): string | null {
  return getToken(REFRESH_TOKEN_KEY);
}

export function setAccess(token: string) {
  setToken(ACCESS_TOKEN_KEY, token);
}

export function setRefresh(token: string) {
  setToken(REFRESH_TOKEN_KEY, token);
}

export function clearTokens() {
  removeToken(ACCESS_TOKEN_KEY);
  removeToken(REFRESH_TOKEN_KEY);
}

export function hasAuthTokens() {
  return Boolean(getAccess() || getRefresh());
}

export async function apiFetch(path: string, init: ApiFetchInit = {}): Promise<Response> {
  const url = resolveUrl(path);
  const method = (init.method || "GET").toUpperCase();
  const body = (init as RequestInit).body;
  const toastOnError = init.toastOnError !== false;

  const makeHeaders = (token?: string) => {
    const headers = new Headers(init.headers || undefined);
    const hasBody = body !== undefined && body !== null;

    if (hasBody && !headers.has("Content-Type") && !isFormData(body)) {
      headers.set("Content-Type", "application/json");
    }

    if (token && shouldAttachAuthHeader(url)) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    return headers;
  };

  const doFetch = (token?: string) =>
    fetch(url, {
      ...init,
      method,
      headers: makeHeaders(token),
    });

  try {
    let res = await doFetch(getAccess() ?? undefined);

    if (res.status === 401 && shouldAttachAuthHeader(url)) {
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

      if (res.status === 401) {
        clearTokens();
      }
    }

    if (!res.ok && toastOnError) {
      const message =
        init.errorToastMessage ||
        defaultMessageForStatus(res.status) ||
        (await getResponseErrorMessage(res.clone()));
      const title = init.errorToastTitle || defaultTitleForStatus(res.status);

      toast.error(message, { title });
    }

    return res;
  } catch {
    const message = "Brak połączenia z serwerem. Sprawdź internet i spróbuj ponownie.";

    if (toastOnError) {
      toast.error(message, { title: "Sieć" });
    }

    return new Response(JSON.stringify({ detail: message, code: "NETWORK_ERROR" }), {
      status: 599,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function apiGet<T>(path: string, init: ApiFetchInit = {}): Promise<T> {
  const res = await apiFetch(path, init);

  if (!res.ok) {
    const message = await getResponseErrorMessage(res.clone());
    throw new Error(message);
  }

  return (await res.json()) as T;
}

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

  if (!res.ok) {
    throw new Error(await getResponseErrorMessage(res.clone()));
  }

  return res.json();
}

export async function removeAssistant(tournamentId: number, userId: number) {
  const res = await apiFetch(`/api/tournaments/${tournamentId}/assistants/${userId}/remove/`, {
    method: "DELETE",
  });

  if (!res.ok) {
    throw new Error(await getResponseErrorMessage(res.clone()));
  }
}
