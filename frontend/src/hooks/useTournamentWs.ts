import { useEffect, useMemo, useRef } from "react";

import { getAccess } from "../api";

export type TournamentWsEvent = {
  v: 1;
  type: string;
  event?: string;
  payload?: unknown;
  [key: string]: any;
};

type Params = {
  tournamentId: string | number | null;
  enabled?: boolean;
  onEvent?: (msg: TournamentWsEvent) => void;
};

function isDev() {
  return Boolean((import.meta as any).env?.DEV);
}

const warnOnceKeys = new Set<string>();
function warnOnce(key: string, message: string) {
  if (!isDev()) return;
  if (warnOnceKeys.has(key)) return;
  warnOnceKeys.add(key);
  // eslint-disable-next-line no-console
  console.warn(message);
}

function getApiOrigin(): string {
  const raw = (import.meta as any).env?.VITE_API_BASE_URL;
  const fallback = window.location.origin;

  if (!raw) return fallback;

  try {
    return new URL(String(raw), fallback).origin;
  } catch {
    return fallback;
  }
}

function getWsOrigin(): string {
  const origin = getApiOrigin();
  try {
    const u = new URL(origin);
    const wsProtocol = u.protocol === "https:" ? "wss:" : "ws:";
    return `${wsProtocol}//${u.host}`;
  } catch {
    return String(origin).replace(/^http:/, "ws:").replace(/^https:/, "wss:");
  }
}

function getWsUrl(tournamentId: string | number) {
  const wsOrigin = getWsOrigin();
  return `${wsOrigin}/ws/tournaments/${tournamentId}/`;
}

function buildWsUrlWithToken(base: string, token: string | null) {
  if (!token) return base;

  try {
    const u = new URL(base);
    u.searchParams.set("token", token);
    return u.toString();
  } catch {
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}token=${encodeURIComponent(token)}`;
  }
}

function normalizeIncoming(msg: unknown): TournamentWsEvent | null {
  if (!msg || typeof msg !== "object") return null;

  const m = msg as Record<string, unknown>;

  if (m.v === 1 && typeof m.type === "string") {
    const out: TournamentWsEvent = { ...(m as any), event: m.type };

    if (m.payload && typeof m.payload === "object" && m.payload !== null) {
      return { ...out, ...(m.payload as any) };
    }

    return out;
  }

  if (typeof m.event === "string") {
    warnOnce(
      "ws.legacy.eventWrapper",
      "[WS] Otrzymano legacy wrapper {event,payload}. Docelowo oczekiwany jest {v:1,type,...}."
    );
    const payload = m.payload && typeof m.payload === "object" ? (m.payload as any) : {};
    return { v: 1, type: m.event, event: m.event, ...payload };
  }

  return null;
}

function shouldReconnect(closeCode: number): boolean {
  if (closeCode === 1000) return false;
  if (closeCode >= 4400 && closeCode <= 4499) return false;
  return true;
}

function safeCloseWs(socket: WebSocket | null) {
  if (!socket) return;

  if (socket.readyState === WebSocket.CONNECTING) {
    const prevOnOpen = socket.onopen;
    socket.onopen = (ev) => {
      try {
        (prevOnOpen as any)?.(ev);
      } finally {
        try {
          socket.close();
        } catch {
          // ignore
        }
      }
    };
    return;
  }

  try {
    socket.close();
  } catch {
    // ignore
  }
}

export function useTournamentWs({ tournamentId, enabled = true, onEvent }: Params) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const url = useMemo(() => {
    if (tournamentId === null || tournamentId === undefined || tournamentId === "") return null;
    return getWsUrl(tournamentId);
  }, [tournamentId]);

  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<number | null>(null);
  const attemptsRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    if (!url) return;

    let cancelled = false;

    const connect = () => {
      if (cancelled) return;

      safeCloseWs(wsRef.current);
      wsRef.current = null;

      const token = getAccess();
      const wsUrl = buildWsUrlWithToken(url, token);

      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch {
        return;
      }

      wsRef.current = ws;

      ws.onopen = () => {
        attemptsRef.current = 0;
      };

      ws.onmessage = (ev) => {
        try {
          const raw = JSON.parse(ev.data);
          const normalized = normalizeIncoming(raw);
          if (!normalized) return;
          onEventRef.current?.(normalized);
        } catch {
          // ignore
        }
      };

      ws.onclose = (ev) => {
        if (cancelled) return;

        if (!shouldReconnect(ev.code)) return;

        if (!token) return;

        const attempt = Math.min(attemptsRef.current + 1, 10);
        attemptsRef.current = attempt;

        const baseDelay = Math.min(1000 * attempt, 8000);
        const jitter = Math.floor(Math.random() * 200);
        const delay = baseDelay + jitter;

        retryRef.current = window.setTimeout(connect, delay);
      };

      ws.onerror = () => {
        // onclose obsłuży reconnect; nie wymusza się close w CONNECTING, aby nie generować błędów w konsoli.
      };
    };

    connect();

    return () => {
      cancelled = true;

      if (retryRef.current) window.clearTimeout(retryRef.current);
      retryRef.current = null;

      safeCloseWs(wsRef.current);
      wsRef.current = null;
    };
  }, [url, enabled]);
}
