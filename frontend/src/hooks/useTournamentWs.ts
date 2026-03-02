// frontend/src/hooks/useTournamentWs.ts
// Plik utrzymuje połączenie WebSocket turnieju i korzysta z access tokena trzymanego w pamięci.

import { useEffect, useMemo, useRef } from "react";

import { getAccess } from "../api";

type ImportMetaEnvLike = {
  DEV?: boolean;
  VITE_API_BASE_URL?: string;
};

type TournamentWsPayload = Record<string, unknown>;

export type TournamentWsEvent = TournamentWsPayload & {
  v: 1;
  type: string;
  event?: string;
  payload?: unknown;
};

type Params = {
  tournamentId: string | number | null;
  enabled?: boolean;
  onEvent?: (msg: TournamentWsEvent) => void;
};

function readEnv(): ImportMetaEnvLike {
  return ((import.meta as ImportMeta & { env?: ImportMetaEnvLike }).env ?? {}) as ImportMetaEnvLike;
}

function isDev() {
  return Boolean(readEnv().DEV);
}

const warnOnceKeys = new Set<string>();

function warnOnce(key: string, message: string) {
  if (!isDev()) return;
  if (warnOnceKeys.has(key)) return;

  warnOnceKeys.add(key);
  console.warn(message);
}

function getApiOrigin(): string {
  const raw = readEnv().VITE_API_BASE_URL;
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
    const url = new URL(origin);
    const protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${url.host}`;
  } catch {
    return String(origin).replace(/^http:/, "ws:").replace(/^https:/, "wss:");
  }
}

function getWsUrl(tournamentId: string | number) {
  return `${getWsOrigin()}/ws/tournaments/${tournamentId}/`;
}

function buildWsUrlWithToken(base: string, token: string | null) {
  if (!token) return base;

  try {
    const url = new URL(base);
    url.searchParams.set("token", token);
    return url.toString();
  } catch {
    const separator = base.includes("?") ? "&" : "?";
    return `${base}${separator}token=${encodeURIComponent(token)}`;
  }
}

function normalizeIncoming(message: unknown): TournamentWsEvent | null {
  if (!message || typeof message !== "object") return null;

  const data = message as Record<string, unknown>;

  if (data.v === 1 && typeof data.type === "string") {
    const event: TournamentWsEvent = { ...(data as TournamentWsPayload), v: 1, type: data.type, event: data.type };

    if (data.payload && typeof data.payload === "object" && data.payload !== null) {
      return { ...event, ...(data.payload as TournamentWsPayload) };
    }

    return event;
  }

  if (typeof data.event === "string") {
    warnOnce(
      "ws.legacy.eventWrapper",
      "[WS] Otrzymano legacy wrapper {event,payload}. Docelowo oczekiwany jest {v:1,type,...}."
    );

    const payload =
      data.payload && typeof data.payload === "object" && data.payload !== null
        ? (data.payload as TournamentWsPayload)
        : {};

    return { v: 1, type: data.event, event: data.event, ...payload };
  }

  return null;
}

function shouldReconnect(closeCode: number) {
  if (closeCode === 1000) return false;
  if (closeCode >= 4400 && closeCode <= 4499) return false;
  return true;
}

function safeCloseWs(socket: WebSocket | null) {
  if (!socket) return;

  if (socket.readyState === WebSocket.CONNECTING) {
    const prevOnOpen = socket.onopen;

    socket.onopen = function onOpen(event) {
      try {
        if (typeof prevOnOpen === "function") {
          prevOnOpen.call(socket, event);
        }
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
  const onEventRef = useRef<Params["onEvent"]>(onEvent);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<number | null>(null);
  const attemptsRef = useRef(0);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const url = useMemo(() => {
    if (tournamentId === null || tournamentId === undefined || tournamentId === "") return null;
    return getWsUrl(tournamentId);
  }, [tournamentId]);

  useEffect(() => {
    if (!enabled || !url) return;

    let cancelled = false;

    const connect = () => {
      if (cancelled) return;

      safeCloseWs(wsRef.current);
      wsRef.current = null;

      const token = getAccess();
      const wsUrl = buildWsUrlWithToken(url, token);

      let socket: WebSocket;

      try {
        socket = new WebSocket(wsUrl);
      } catch {
        return;
      }

      wsRef.current = socket;

      socket.onopen = () => {
        attemptsRef.current = 0;
      };

      socket.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          const normalized = normalizeIncoming(parsed);
          if (!normalized) return;
          onEventRef.current?.(normalized);
        } catch {
          // ignore
        }
      };

      socket.onclose = (event) => {
        if (cancelled) return;
        if (!shouldReconnect(event.code)) return;
        if (!token) return;

        const attempt = Math.min(attemptsRef.current + 1, 10);
        attemptsRef.current = attempt;

        const baseDelay = Math.min(1000 * attempt, 8000);
        const jitter = Math.floor(Math.random() * 200);

        retryRef.current = window.setTimeout(connect, baseDelay + jitter);
      };
    };

    connect();

    return () => {
      cancelled = true;

      if (retryRef.current !== null) {
        window.clearTimeout(retryRef.current);
        retryRef.current = null;
      }

      safeCloseWs(wsRef.current);
      wsRef.current = null;
    };
  }, [enabled, url]);
}