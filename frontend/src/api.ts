// frontend/src/api.ts
// Plik centralizuje tokeny in-memory, wywołania HTTP oraz obsługę globalnych błędów API.

import { toast } from "./ui/Toast";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");
const API_ORIGIN = getOrigin(API_BASE);

const LEGACY_ACCESS_KEYS = ["access", "accessToken", "access_token", "jwt_access", "token"];
const LEGACY_REFRESH_KEYS = ["refresh", "refreshToken", "refresh_token", "jwt_refresh"];

let accessToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;
let bootstrapPromise: Promise<string | null> | null = null;

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

function readLegacyToken(keys: string[]): string | null {
  const storage = getStorage();
  if (!storage) return null;

  for (const key of keys) {
    const value = storage.getItem(key);
    if (value && value.trim()) return value.trim();
  }

  return null;
}

function readLegacyAccessToken(): string | null {
  const direct = readLegacyToken(LEGACY_ACCESS_KEYS);
  if (direct) return direct;

  const storage = getStorage();
  if (!storage) return null;

  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key) continue;

    const lower = key.toLowerCase();
    if (!lower.includes("access") || lower.includes("refresh")) continue;

    const value = storage.getItem(key);
    if (value && value.trim()) return value.trim();
  }

  return null;
}

function clearLegacyAuthStorage() {
  const storage = getStorage();
  if (!storage) return;

  for (const key of [...LEGACY_ACCESS_KEYS, ...LEGACY_REFRESH_KEYS]) {
    storage.removeItem(key);
  }

  const dynamicKeys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key) continue;

    const lower = key.toLowerCase();
    if (lower.includes("access") || lower.includes("refresh")) {
      dynamicKeys.push(key);
    }
  }

  for (const key of dynamicKeys) {
    storage.removeItem(key);
  }
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
    try {
      const res = await fetch(`${API_BASE}/api/auth/refresh/`, {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
        },
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

export async function bootstrapSession(): Promise<string | null> {
  if (accessToken) return accessToken;
  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = (async () => {
    const refreshed = await refreshAccessToken();
    if (refreshed) return refreshed;

    // Tymczasowy fallback utrzymuje stare sesje do czasu pełnego wdrożenia backendu.
    const legacy = readLegacyAccessToken();
    if (legacy) {
      accessToken = legacy;
      return legacy;
    }

    return null;
  })();

  try {
    return await bootstrapPromise;
  } finally {
    bootstrapPromise = null;
  }
}

export function getAccess(): string | null {
  return accessToken;
}

export function setAccess(token: string | null) {
  accessToken = token && token.trim() ? token.trim() : null;
}

export function clearTokens() {
  accessToken = null;
  clearLegacyAuthStorage();
}

export function hasAuthTokens() {
  return Boolean(accessToken);
}

export async function apiFetch(path: string, init: ApiFetchInit = {}): Promise<Response> {
  const url = resolveUrl(path);
  const method = (init.method || "GET").toUpperCase();
  const body = init.body;
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
      credentials: init.credentials ?? "include",
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

export type AssistantInvitePermissions = {
  teams_edit?: boolean;
  roster_edit?: boolean;
  schedule_edit?: boolean;
  results_edit?: boolean;
  bracket_edit?: boolean;
  tournament_edit?: boolean;
  name_change_approve?: boolean;
};

export async function addAssistant(
  tournamentId: number,
  email: string,
  permissions: AssistantInvitePermissions = {}
): Promise<string> {
  const res = await apiFetch(`/api/tournaments/${tournamentId}/assistants/add/`, {
    method: "POST",
    body: JSON.stringify({ email, permissions }),
    toastOnError: false,
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, any>;

  if (!res.ok) {
    throw new Error(
      data?.detail ||
        data?.non_field_errors?.[0] ||
        data?.email?.[0] ||
        "Nie udało się zapisać zaproszenia asystenta."
    );
  }

  return (
    data?.detail ||
    "Zaproszenie zostało zapisane. Jeśli konto z tym adresem istnieje albo zostanie utworzone później, użytkownik zobaczy je na liście swoich turniejów."
  );
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

export async function cancelAssistantInvite(tournamentId: number, inviteId: number): Promise<string> {
  const res = await apiFetch(`/api/tournaments/${tournamentId}/assistant-invites/${inviteId}/cancel/`, {
    method: "POST",
    toastOnError: false,
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok) {
    throw new Error(data?.detail || "Nie udało się cofnąć zaproszenia.");
  }

  return data?.detail || "Zaproszenie zostało cofnięte.";
}

export async function acceptAssistantInvite(tournamentId: number): Promise<string> {
  const res = await apiFetch(`/api/tournaments/${tournamentId}/assistant-invite/accept/`, {
    method: "POST",
    toastOnError: false,
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok) {
    throw new Error(data?.detail || "Nie udało się zaakceptować zaproszenia.");
  }

  return data?.detail || "Zaproszenie zostało zaakceptowane.";
}

export async function declineAssistantInvite(tournamentId: number): Promise<string> {
  const res = await apiFetch(`/api/tournaments/${tournamentId}/assistant-invite/decline/`, {
    method: "POST",
    toastOnError: false,
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok) {
    throw new Error(data?.detail || "Nie udało się odrzucić zaproszenia.");
  }

  return data?.detail || "Zaproszenie zostało odrzucone.";
}
