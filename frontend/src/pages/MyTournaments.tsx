// frontend/src/pages/MyTournaments.tsx
// Strona prezentuje listę turniejów użytkownika oraz obsługuje filtrowanie, publikację i archiwum.

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Archive,
  ChevronDown,
  ChevronUp,
  Clipboard,
  Eye,
  EyeOff,
  KeyRound,
  LayoutDashboard,
  RefreshCw,
  RotateCcw,
  Search,
  Share2,
  Trophy,
} from "lucide-react";

import { acceptAssistantInvite, apiFetch, apiGet, declineAssistantInvite, getAccess } from "../api";
import { cn } from "../lib/cn";

import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Input } from "../ui/Input";
import { toast } from "../ui/Toast";

type Tournament = {
  id: number;
  name: string;
  discipline: string;
  tournament_format?: "LEAGUE" | "CUP" | "MIXED";
  participants_count?: number;
  status?: "DRAFT" | "CONFIGURED" | "RUNNING" | "FINISHED";
  is_published?: boolean;

  access_code?: string | null;
  is_archived?: boolean;

  entry_mode?: "MANAGER" | "ORGANIZER_ONLY";

  join_enabled?: boolean;
  registration_code?: string | null;

  my_role: "ORGANIZER" | "ASSISTANT" | "PARTICIPANT" | null;
  assistant_invite_pending?: boolean;
  assistant_membership_status?: "PENDING" | "ACCEPTED" | "DECLINED" | null;
};

type FilterTab = "all" | "unpublished" | "published" | "archived";

type VisibleSections = {
  pending: boolean;
  draft: boolean;
  ready: boolean;
  published: boolean;
  archived: boolean;
};

const LS_KEY = "turniejepro.my_tournaments.v1";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "http://localhost:8000");

function getApiOrigin() {
  try {
    return new URL(String(API_BASE), window.location.origin).origin;
  } catch {
    return window.location.origin;
  }
}

function getWsOrigin() {
  const origin = getApiOrigin();
  try {
    const u = new URL(origin);
    const wsProtocol = u.protocol === "https:" ? "wss:" : "ws:";
    return `${wsProtocol}//${u.host}`;
  } catch {
    return String(origin).replace(/^http:/, "ws:").replace(/^https:/, "wss:");
  }
}

function buildMeWsUrl() {
  const token = getAccess();
  const wsOrigin = getWsOrigin();
  const u = new URL(`${wsOrigin}/ws/me/`);
  if (token) u.searchParams.set("token", token);
  return u.toString();
}

function disciplineLabel(code: string | undefined) {
  switch (code) {
    case "football":
      return "Piłka nożna";
    case "volleyball":
      return "Siatkówka";
    case "basketball":
      return "Koszykówka";
    case "handball":
      return "Piłka ręczna";
    case "tennis":
      return "Tenis";
    case "wrestling":
      return "Zapasy";
    default:
      return code ?? "-";
  }
}

function formatLabel(v?: Tournament["tournament_format"]) {
  if (v === "LEAGUE") return "Liga";
  if (v === "CUP") return "Puchar";
  if (v === "MIXED") return "Mieszany";
  return "-";
}

function statusLabel(v?: Tournament["status"]) {
  if (v === "DRAFT") return "Szkic";
  if (v === "CONFIGURED") return "Skonfigurowany";
  if (v === "RUNNING") return "W trakcie";
  if (v === "FINISHED") return "Zakończony";
  return "-";
}

function roleLabel(v: Tournament["my_role"]) {
  if (v === "ORGANIZER") return "Organizator";
  if (v === "ASSISTANT") return "Asystent";
  if (v === "PARTICIPANT") return "Zawodnik";
  return "-";
}

function normalizePL(s: string) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}


function isHtmlErrorMessage(value: string) {
  return (
    /^<!doctype html/i.test(value) ||
    /<html[\s>]/i.test(value) ||
    /<head[\s>]/i.test(value) ||
    /<title>/i.test(value)
  );
}

function sanitizeApiErrorMessage(error: unknown, fallback: string) {
  const raw =
    typeof error === "string"
      ? error
      : typeof (error as any)?.message === "string"
      ? (error as any).message
      : "";

  const trimmed = raw.trim();
  if (!trimmed) return fallback;

  // Odrzucenie technicznej odpowiedzi HTML utrzymuje komunikat czytelny dla użytkownika.
  if (isHtmlErrorMessage(trimmed)) {
    return fallback;
  }

  return trimmed;
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

function canUsePanel(t: Tournament) {
  return t.my_role === "ORGANIZER" || t.my_role === "ASSISTANT";
}

function panelNote(t: Tournament) {
  if (t.my_role !== "ASSISTANT") return null;
  const mode = t.entry_mode ?? "MANAGER";
  if (mode === "ORGANIZER_ONLY") {
    return "Tryb: tylko organizator. Masz podgląd w panelu, elementy edycji mogą być ograniczone.";
  }
  return null;
}

function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-xs font-semibold text-slate-200",
        className
      )}
    >
      {children}
    </span>
  );
}

function TabPill({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-semibold transition border",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/15",
        active
          ? "bg-white/10 text-white border-white/15 shadow-[0_1px_0_rgba(255,255,255,0.06)_inset]"
          : "bg-white/[0.04] text-slate-300 border-white/10 hover:bg-white/[0.07] hover:text-white"
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          "grid min-w-[1.5rem] place-items-center rounded-full px-2 py-0.5 text-xs font-bold border",
          active
            ? "border-white/15 bg-white/[0.06] text-white"
            : "border-white/10 bg-white/[0.04] text-slate-200"
        )}
      >
        {count}
      </span>
    </button>
  );
}

function safeReadState(): { query: string; activeTab: FilterTab; visible: VisibleSections } | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);

    const query = typeof parsed?.query === "string" ? parsed.query : "";
    const activeTab: FilterTab =
      parsed?.activeTab === "all" ||
      parsed?.activeTab === "unpublished" ||
      parsed?.activeTab === "published" ||
      parsed?.activeTab === "archived"
        ? parsed.activeTab
        : "all";

    const visible: VisibleSections = {
      pending: typeof parsed?.visible?.pending === "boolean" ? parsed.visible.pending : true,
      draft: typeof parsed?.visible?.draft === "boolean" ? parsed.visible.draft : true,
      ready: typeof parsed?.visible?.ready === "boolean" ? parsed.visible.ready : true,
      published: typeof parsed?.visible?.published === "boolean" ? parsed.visible.published : true,
      archived: typeof parsed?.visible?.archived === "boolean" ? parsed.visible.archived : false,
    };

    return { query, activeTab, visible };
  } catch {
    return null;
  }
}

function safeWriteState(next: { query: string; activeTab: FilterTab; visible: VisibleSections }) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(next));
  } catch {
    // brak
  }
}

function SectionHeader({
  title,
  count,
  visible,
  onToggle,
}: {
  title: string;
  count: number;
  visible: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <div className="text-base font-semibold text-white">{title}</div>
        <Badge className="bg-white/[0.04]">{count}</Badge>
      </div>

      <button
        type="button"
        onClick={() => onToggle(!visible)}
        className={cn(
          "inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-200",
          "hover:bg-white/[0.07] hover:text-white transition",
          "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/15"
        )}
        aria-label={visible ? "Zwiń sekcję" : "Rozwiń sekcję"}
      >
        {visible ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        {visible ? "Zwiń" : "Rozwiń"}
      </button>
    </div>
  );
}

export default function MyTournaments() {
  const saved = useMemo(() => safeReadState(), []);

  const [items, setItems] = useState<Tournament[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState(saved?.query ?? "");
  const [shareOpenId, setShareOpenId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const [activeTab, setActiveTab] = useState<FilterTab>(saved?.activeTab ?? "all");

  const [visibleSections, setVisibleSections] = useState<VisibleSections>(
    saved?.visible ?? { pending: true, draft: true, ready: true, published: true, archived: false }
  );

  // ===== Persistencja ustawień widoku =====
  useEffect(() => {
    safeWriteState({ query, activeTab, visible: visibleSections });
  }, [query, activeTab, visibleSections]);

  // ===== Pobieranie listy turniejów =====
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await apiGet<Tournament[]>("/api/tournaments/my/");
      setItems(Array.isArray(data) ? data : []);
    } catch (e: any) {
      const msg = sanitizeApiErrorMessage(
        e,
        "Nie udało się wczytać listy turniejów. Spróbuj ponownie."
      );
      setError(msg);
      toast.error(msg, { title: "System" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const token = getAccess();
    if (!token) return;

    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let reloadTimer: number | null = null;
    let closedByEffect = false;
    let backoffMs = 400;

    const safeClose = () => {
      if (!ws) return;
      if (ws.readyState === WebSocket.CONNECTING) {
        const prevOnOpen = ws.onopen;
        ws.onopen = (ev) => {
          try {
            (prevOnOpen as any)?.(ev);
          } finally {
            try {
              ws?.close();
            } catch {
              // ignoruj
            }
          }
        };
        return;
      }
      try {
        ws.close();
      } catch {
        // ignoruj
      }
    };

    const scheduleReload = () => {
      if (reloadTimer) return;

      reloadTimer = window.setTimeout(() => {
        reloadTimer = null;
        void load();
      }, 200);
    };

    const scheduleReconnect = () => {
      if (closedByEffect) return;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, backoffMs);
      backoffMs = Math.min(backoffMs * 2, 4000);
    };

    const connect = () => {
      try {
        ws = new WebSocket(buildMeWsUrl());
      } catch {
        scheduleReconnect();
        return;
      }

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg?.type === "membership.changed") scheduleReload();
        } catch {
          // ignoruj
        }
      };

      ws.onclose = () => {
        ws = null;
        scheduleReconnect();
      };


      ws.onerror = () => {
        // onclose obsłuży reconnect; nie wymuszamy close w CONNECTING, aby nie generować błędów w konsoli.
      };
    };

    connect();

    return () => {
      closedByEffect = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (reloadTimer) window.clearTimeout(reloadTimer);
      safeClose();
    };
  }, [load]);

  const filtered = useMemo(() => {
    const q = normalizePL(query.trim());
    if (!q) return items;

    return items
      .map((t) => {
        const name = normalizePL(t.name);
        const discipline = normalizePL(disciplineLabel(t.discipline));
        const format = normalizePL(formatLabel(t.tournament_format));
        const st = normalizePL(statusLabel(t.status));
        const pub = normalizePL(t.is_published ? "opublikowany" : "nieopublikowany");
        const arch = normalizePL(t.is_archived ? "archiwum" : "");
        const role = normalizePL(roleLabel(t.my_role));
        const join = normalizePL(t.join_enabled ? "dolaczanie" : "");
        const invite = normalizePL(t.assistant_invite_pending ? "zaproszenie asystenta" : "");

        let score = 0;

        if (name === q) score += 200;
        else if (name.startsWith(q)) score += 140;
        else if (name.includes(q)) score += 90;

        if (discipline.startsWith(q)) score += 60;
        else if (discipline.includes(q)) score += 40;

        if (format.includes(q)) score += 15;
        if (st.includes(q)) score += 10;
        if (pub.includes(q)) score += 8;
        if (arch.includes(q)) score += 6;
        if (role.includes(q)) score += 6;
        if (join.includes(q)) score += 4;
        if (invite.includes(q)) score += 12;

        const hay = [name, discipline, format, st, pub, arch, role, join, invite].join(" ");
        if (score === 0 && hay.includes(q)) score = 1;

        return { t, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.t);
  }, [items, query]);

  const grouped = useMemo(() => {
    const pending = filtered.filter((t) => !!t.assistant_invite_pending);
    const archived = filtered.filter((t) => !!t.is_archived && !t.assistant_invite_pending);
    const notArchived = filtered.filter((t) => !t.is_archived && !t.assistant_invite_pending);

    const draft = notArchived.filter((t) => (t.status ?? "DRAFT") === "DRAFT");
    const ready = notArchived.filter(
      (t) => (t.status ?? "DRAFT") !== "DRAFT" && !t.is_published
    );
    const published = notArchived.filter(
      (t) => (t.status ?? "DRAFT") !== "DRAFT" && !!t.is_published
    );

    return { pending, draft, ready, published, archived };
  }, [filtered]);

  const counts = useMemo(() => {
    return {
      all: filtered.length,
      unpublished: grouped.pending.length + grouped.draft.length + grouped.ready.length,
      published: grouped.published.length,
      archived: grouped.archived.length,
    };
  }, [filtered.length, grouped]);

  const togglePublish = useCallback(
    async (t: Tournament) => {
      if (t.my_role !== "ORGANIZER") return;

      if ((t.status ?? "DRAFT") === "DRAFT") {
        toast.error("Najpierw skonfiguruj turniej i wygeneruj rozgrywki.", {
          title: "Wymagane",
        });
        return;
      }

      setBusyId(t.id);
      setError(null);

      try {
        const res = await apiFetch(`/api/tournaments/${t.id}/`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_published: !t.is_published }),
        });

        if (!res.ok) {
          toast.error("Nie udało się zmienić publikacji turnieju.", { title: "System" });
          return;
        }

        await load();
        toast.success(!t.is_published ? "Turniej opublikowany." : "Turniej ukryty.");
      } catch {
        toast.error("Brak połączenia z serwerem. Spróbuj ponownie.", { title: "Sieć" });
      } finally {
        setBusyId(null);
      }
    },
    [load]
  );

  const toggleArchive = useCallback(
    async (t: Tournament) => {
      if (t.my_role !== "ORGANIZER") return;

      setBusyId(t.id);
      setError(null);

      try {
        const res = await apiFetch(`/api/tournaments/${t.id}/`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_archived: !t.is_archived }),
        });

        if (!res.ok) {
          toast.error("Błąd archiwizacji.", { title: "System" });
          return;
        }

        await load();
        toast.success(!t.is_archived ? "Przeniesiono do archiwum." : "Przywrócono z archiwum.");
      } catch {
        toast.error("Brak połączenia z serwerem. Spróbuj ponownie.", { title: "Sieć" });
      } finally {
        setBusyId(null);
      }
    },
    [load]
  );

  const acceptInvite = useCallback(
    async (t: Tournament) => {
      setBusyId(t.id);
      setError(null);

      try {
        const message = await acceptAssistantInvite(t.id);
        await load();
        toast.success(message);
      } catch (e: any) {
        toast.error(e?.message ?? "Nie udało się zaakceptować zaproszenia.", { title: "Zaproszenie" });
      } finally {
        setBusyId(null);
      }
    },
    [load]
  );

  const declineInvite = useCallback(
    async (t: Tournament) => {
      setBusyId(t.id);
      setError(null);

      try {
        const message = await declineAssistantInvite(t.id);
        await load();
        toast.success(message);
      } catch (e: any) {
        toast.error(e?.message ?? "Nie udało się odrzucić zaproszenia.", { title: "Zaproszenie" });
      } finally {
        setBusyId(null);
      }
    },
    [load]
  );


  const SharePanel = ({ t }: { t: Tournament }) => {
    const isOrganizer = t.my_role === "ORGANIZER";
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const baseLink = `${origin}/tournaments/${t.id}`;
    const joinLink = `${baseLink}?join=1`;

    const viewLinkWithCode =
      t.access_code && t.access_code.trim()
        ? `${baseLink}?code=${encodeURIComponent(t.access_code)}`
        : baseLink;

    return (
      <div className="mt-4 rounded-3xl border border-white/10 bg-white/[0.04] p-4">
        {!t.is_published && (
          <div className="mb-3 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
            Uwaga: turniej jest nieopublikowany - dostęp dla widzów będzie możliwy dopiero po publikacji.
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
            <div className="text-[11px] text-slate-400">Link do turnieju</div>
            <div className="mt-1 flex items-center gap-2">
              <div className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{baseLink}</div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                leftIcon={<Clipboard className="h-4 w-4" />}
                onClick={() => {
                  void (async () => {
                    const ok = await copyToClipboard(baseLink);
                    if (ok) toast.success("Skopiowano link.");
                    else toast.error("Nie udało się skopiować.", { title: "System" });
                  })();
                }}
              >
                Kopiuj
              </Button>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
            <div className="text-[11px] text-slate-400">Kod dostępu</div>
            <div className="mt-1 flex items-center gap-2">
              <div className="min-w-0 flex-1 truncate text-sm font-semibold text-white">
                {t.access_code?.trim() ? t.access_code : "-"}
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                leftIcon={<KeyRound className="h-4 w-4" />}
                disabled={!t.access_code?.trim()}
                onClick={() => {
                  void (async () => {
                    const ok = await copyToClipboard(t.access_code ?? "");
                    if (ok) toast.success("Skopiowano kod dostępu.");
                    else toast.error("Nie udało się skopiować.", { title: "System" });
                  })();
                }}
              >
                Kopiuj
              </Button>
            </div>
          </div>

          {t.access_code?.trim() && (
            <div className="sm:col-span-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
              <div className="text-[11px] text-slate-400">Link z kodem (podgląd)</div>
              <div className="mt-1 flex items-center gap-2">
                <div className="min-w-0 flex-1 truncate text-sm font-semibold text-white">
                  {viewLinkWithCode}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  leftIcon={<Clipboard className="h-4 w-4" />}
                  onClick={() => {
                    void (async () => {
                      const ok = await copyToClipboard(viewLinkWithCode);
                      if (ok) toast.success("Skopiowano link z kodem.");
                      else toast.error("Nie udało się skopiować.", { title: "System" });
                    })();
                  }}
                >
                  Kopiuj
                </Button>
              </div>
            </div>
          )}
        </div>

        {isOrganizer && t.join_enabled && (
          <div className="mt-4 rounded-2xl border border-sky-400/15 bg-sky-400/5 px-4 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-white">Dołączanie uczestników</div>
                <div className="mt-1 text-xs text-slate-300">
                  Uczestnik wchodzi przez link i podaje kod.
                </div>
              </div>
              <Badge className="border-sky-400/20 bg-sky-400/10 text-sky-100">Włączone</Badge>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                <div className="text-[11px] text-slate-400">Link do dołączenia</div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{joinLink}</div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    leftIcon={<Clipboard className="h-4 w-4" />}
                    onClick={() => {
                      void (async () => {
                        const ok = await copyToClipboard(joinLink);
                        if (ok) toast.success("Skopiowano link do dołączenia.");
                        else toast.error("Nie udało się skopiować.", { title: "System" });
                      })();
                    }}
                  >
                    Kopiuj
                  </Button>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                <div className="text-[11px] text-slate-400">Kod dołączania</div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="min-w-0 flex-1 truncate text-sm font-semibold text-white">
                    {t.registration_code?.trim() ? t.registration_code : "-"}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    leftIcon={<Clipboard className="h-4 w-4" />}
                    disabled={!t.registration_code?.trim()}
                    onClick={() => {
                      void (async () => {
                        const ok = await copyToClipboard(t.registration_code ?? "");
                        if (ok) toast.success("Skopiowano kod dołączania.");
                        else toast.error("Nie udało się skopiować.", { title: "System" });
                      })();
                    }}
                  >
                    Kopiuj
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const TournamentCard = ({ t }: { t: Tournament }) => {
    const isOrganizer = t.my_role === "ORGANIZER";
    const isDraft = (t.status ?? "DRAFT") === "DRAFT";
    const isShareOpen = shareOpenId === t.id;
    const sharePanelId = `share-panel-${t.id}`;

    const note = panelNote(t);
    const publicationLabel = t.is_archived
      ? "Archiwum"
      : t.is_published
      ? "Opublikowany"
      : "Nieopublikowany";
    const hasPendingInvite = Boolean(t.assistant_invite_pending);

    if (hasPendingInvite) {
      return (
        <motion.div
          whileHover={{ y: -3, scale: 1.01 }}
          transition={{ type: "spring", stiffness: 260, damping: 18 }}
          className="h-full"
        >
          <Card className="relative h-full overflow-hidden border border-sky-400/20 bg-sky-500/[0.05] p-5">
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute -right-14 -top-14 h-28 w-28 rounded-full bg-sky-400/10 blur-2xl" />
            </div>

            <div className="relative flex h-full flex-col">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-baseline gap-2">
                    <span className="shrink-0 text-xs text-slate-400">Nazwa turnieju:</span>
                    <span className="min-w-0 truncate text-base font-semibold text-white">{t.name}</span>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge>{disciplineLabel(t.discipline)}</Badge>
                    <Badge>{formatLabel(t.tournament_format)}</Badge>
                    <Badge className="border-sky-400/20 bg-sky-400/10 text-sky-100">Zaproszenie asystenta</Badge>
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-200">
                Organizator zaprosił Cię do tego turnieju jako asystenta. Po akceptacji turniej pojawi się z dostępem do panelu zgodnym z nadanymi uprawnieniami.
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
                  <div className="text-[11px] text-slate-400">Twoja rola</div>
                  <div className="mt-0.5 truncate text-sm font-semibold text-white">Zaproszony asystent</div>
                </div>

                <div className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
                  <div className="text-[11px] text-slate-400">Status turnieju</div>
                  <div className="mt-0.5 truncate text-sm font-semibold text-white">{statusLabel(t.status)}</div>
                </div>

                <div className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
                  <div className="text-[11px] text-slate-400">Status zaproszenia</div>
                  <div className="mt-0.5 truncate text-sm font-semibold text-sky-100">Oczekuje na decyzję</div>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Button
                  type="button"
                  variant="primary"
                  disabled={busyId === t.id}
                  onClick={() => void acceptInvite(t)}
                  className="w-full justify-center"
                >
                  Akceptuj
                </Button>

                <Button
                  type="button"
                  variant="secondary"
                  disabled={busyId === t.id}
                  onClick={() => void declineInvite(t)}
                  className="w-full justify-center"
                >
                  Odrzuć
                </Button>

                <Link to={`/tournaments/${t.id}`} className="w-full">
                  <Button
                    variant="ghost"
                    leftIcon={<Trophy className="h-4 w-4" />}
                    className="w-full justify-center"
                  >
                    Podgląd
                  </Button>
                </Link>
              </div>
            </div>
          </Card>
        </motion.div>
      );
    }

    return (
      <motion.div
        whileHover={{ y: -3, scale: 1.01 }}
        transition={{ type: "spring", stiffness: 260, damping: 18 }}
        className="h-full"
      >
        <Card className="relative h-full overflow-hidden p-5">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -right-14 -top-14 h-28 w-28 rounded-full bg-white/[0.06] blur-2xl" />
          </div>

          <div className="relative flex h-full flex-col">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="shrink-0 text-xs text-slate-400">Nazwa turnieju:</span>
                  <span className="min-w-0 truncate text-base font-semibold text-white">{t.name}</span>
                </div>

                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge>{disciplineLabel(t.discipline)}</Badge>
                  <Badge>{formatLabel(t.tournament_format)}</Badge>
                  {t.join_enabled && (
                    <Badge className="border-sky-400/20 bg-sky-400/10 text-sky-100">Dołączanie</Badge>
                  )}
                  {t.is_archived && (
                    <Badge className="border-white/10 bg-white/[0.04] text-slate-200">Archiwum</Badge>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (!isOrganizer) return;
                  void toggleArchive(t);
                }}
                disabled={!isOrganizer || busyId === t.id}
                className={cn(
                  "grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.06] text-slate-200 transition",
                  "hover:bg-white/[0.09] hover:text-white",
                  (!isOrganizer || busyId === t.id) &&
                    "cursor-not-allowed opacity-60 hover:bg-white/[0.06]"
                )}
                title={t.is_archived ? "Przywróć z archiwum" : "Archiwizuj"}
                aria-label={t.is_archived ? "Przywróć z archiwum" : "Archiwizuj"}
              >
                {t.is_archived ? <RotateCcw className="h-5 w-5" /> : <Archive className="h-5 w-5" />}
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
                <div className="text-[11px] text-slate-400">Twój status</div>
                <div className="mt-0.5 truncate text-sm font-semibold text-white">{roleLabel(t.my_role)}</div>
              </div>

              <div className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
                <div className="text-[11px] text-slate-400">Status turnieju</div>
                <div className="mt-0.5 truncate text-sm font-semibold text-white">{statusLabel(t.status)}</div>
              </div>

              <div className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
                <div className="text-[11px] text-slate-400">Status publikacji</div>
                <div className="mt-0.5 truncate text-sm font-semibold text-white">{publicationLabel}</div>
              </div>
            </div>

            {note && (
              <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-300">
                {note}
              </div>
            )}

            <div className="mt-5 grid grid-cols-2 gap-2">
              {t.my_role === "ORGANIZER" || t.my_role === "ASSISTANT" ? (
                <Link to={`/tournaments/${t.id}/detail`} className="w-full">
                  <Button
                    variant="secondary"
                    leftIcon={<LayoutDashboard className="h-4 w-4" />}
                    disabled={!canUsePanel(t)}
                    title="Panel zarządzania (uprawnienia do edycji zależą od roli i ustawień organizatora)."
                    className="w-full justify-center"
                  >
                    Panel
                  </Button>
                </Link>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  leftIcon={<LayoutDashboard className="h-4 w-4" />}
                  disabled
                  className="w-full justify-center opacity-60"
                >
                  Panel
                </Button>
              )}

              <Link to={`/tournaments/${t.id}`} className="w-full">
                <Button
                  variant="ghost"
                  leftIcon={<Trophy className="h-4 w-4" />}
                  className="w-full justify-center"
                >
                  Podgląd
                </Button>
              </Link>

              {isOrganizer && !t.is_archived ? (
                <Button
                  type="button"
                  variant="ghost"
                  leftIcon={t.is_published ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  disabled={busyId === t.id}
                  onClick={() => void togglePublish(t)}
                  title={isDraft ? "Publikacja jest dostępna po wygenerowaniu rozgrywek." : undefined}
                  className={cn("w-full justify-center", isDraft && "opacity-80")}
                >
                  {t.is_published ? "Ukryj" : "Publikuj"}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  leftIcon={<Eye className="h-4 w-4" />}
                  disabled
                  className="w-full justify-center opacity-60"
                >
                  Publikuj
                </Button>
              )}

              {!t.is_archived ? (
                <Button
                  type="button"
                  variant="ghost"
                  leftIcon={<Share2 className="h-4 w-4" />}
                  onClick={() => setShareOpenId(isShareOpen ? null : t.id)}
                  className="w-full justify-center"
                  aria-expanded={isShareOpen}
                  aria-controls={sharePanelId}
                >
                  Udostępnij
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  leftIcon={<Share2 className="h-4 w-4" />}
                  disabled
                  className="w-full justify-center opacity-60"
                >
                  Udostępnij
                </Button>
              )}
            </div>

            <AnimatePresence initial={false}>
              {isShareOpen && !t.is_archived && (
                <motion.div
                  id={sharePanelId}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                >
                  <SharePanel t={t} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </Card>
      </motion.div>
    );
  };

  const renderSection = useCallback(
    (title: string, list: Tournament[], key: keyof VisibleSections, enabled: boolean) => {
      if (!enabled) return null;
      if (list.length === 0) return null;

      const visible = visibleSections[key];

      return (
        <section className="space-y-4">
          <SectionHeader
            title={title}
            count={list.length}
            visible={visible}
            onToggle={(v) => setVisibleSections((s) => ({ ...s, [key]: v }))}
          />

          <AnimatePresence initial={false}>
            {visible && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.2 }}
                className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
              >
                {list.map((t, idx) => (
                  <motion.div
                    key={t.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, delay: Math.min(idx * 0.03, 0.18) }}
                  >
                    <TournamentCard t={t} />
                  </motion.div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      );
    },
    [visibleSections]
  );

  const sectionsEnabled = useMemo(() => {
    if (activeTab === "published") {
      return { pending: false, draft: false, ready: false, published: true, archived: false };
    }
    if (activeTab === "archived") {
      return { pending: false, draft: false, ready: false, published: false, archived: true };
    }
    if (activeTab === "unpublished") {
      return { pending: true, draft: true, ready: true, published: false, archived: false };
    }
    return { pending: true, draft: true, ready: true, published: true, archived: true };
  }, [activeTab]);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 sm:px-6 xl:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white sm:text-3xl">Moje turnieje</h1>
          <div className="mt-2 text-sm text-slate-300">
            Zarządzaj publikacją, udostępnianiem oraz archiwum. Szybko filtruj i przechodź do panelu.
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link to="/tournaments/new">
            <Button variant="primary">Utwórz turniej</Button>
          </Link>

          <Button
            variant="secondary"
            leftIcon={<RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />}
            onClick={() => void load()}
            disabled={loading}
          >
            Odśwież
          </Button>
        </div>
      </div>

      <Card className="relative overflow-hidden p-4 sm:p-5">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -top-24 left-1/2 h-48 w-[28rem] -translate-x-1/2 rounded-full bg-indigo-500/15 blur-3xl" />
          <div className="absolute -bottom-24 left-1/2 h-48 w-[28rem] -translate-x-1/2 rounded-full bg-sky-500/10 blur-3xl" />
        </div>

        <div className="relative">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-2xl border border-white/10 bg-white/[0.06]">
                <Search className="h-5 w-5 text-white/90" />
              </div>
              <div>
                <div className="text-sm font-semibold text-white">Szukaj</div>
                <div className="text-xs text-slate-300">Nazwa, dyscyplina, typ, status, publikacja, rola.</div>
              </div>
            </div>

            <div className="w-full md:w-[28rem]">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Szukaj..."
                rightIcon={
                  query ? (
                    <button
                      type="button"
                      onClick={() => setQuery("")}
                      className="rounded-xl p-1 text-slate-300 transition hover:bg-white/[0.06] hover:text-white"
                      aria-label="Wyczyść"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                  ) : null
                }
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <TabPill active={activeTab === "all"} label="Wszystkie" count={counts.all} onClick={() => setActiveTab("all")} />
            <TabPill
              active={activeTab === "unpublished"}
              label="Nieopublikowane"
              count={counts.unpublished}
              onClick={() => setActiveTab("unpublished")}
            />
            <TabPill
              active={activeTab === "published"}
              label="Opublikowane"
              count={counts.published}
              onClick={() => setActiveTab("published")}
            />
            <TabPill
              active={activeTab === "archived"}
              label="Archiwum"
              count={counts.archived}
              onClick={() => setActiveTab("archived")}
            />
          </div>

          {!!error && (
            <div className="mt-4 rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          )}
        </div>
      </Card>

      {loading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="p-5">
              <div className="h-4 w-2/3 rounded bg-white/10" />
              <div className="mt-3 h-3 w-1/2 rounded bg-white/10" />
              <div className="mt-4 flex gap-2">
                <div className="h-6 w-20 rounded-full bg-white/10" />
                <div className="h-6 w-24 rounded-full bg-white/10" />
              </div>
              <div className="mt-5 h-9 w-full rounded-xl bg-white/10" />
            </Card>
          ))}
        </div>
      )}

      {!loading && items.length === 0 && !error && (
        <Card className="p-6">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.06]">
              <AlertTriangle className="h-5 w-5 text-white/90" />
            </div>
            <div className="flex-1">
              <div className="text-base font-semibold text-white">Brak turniejów</div>
              <div className="mt-1 text-sm text-slate-300">
                Utwórz pierwszy turniej lub dołącz do istniejącego przez link i kod.
              </div>
              <div className="mt-4">
                <Link to="/tournaments/new">
                  <Button variant="secondary">Utwórz turniej</Button>
                </Link>
              </div>
            </div>
          </div>
        </Card>
      )}

      {!loading && items.length > 0 && (
        <div className="space-y-10">
          {renderSection("Zaproszenia asystenta", grouped.pending, "pending", sectionsEnabled.pending)}
          {renderSection("Szkice", grouped.draft, "draft", sectionsEnabled.draft)}
          {renderSection("Gotowe do publikacji", grouped.ready, "ready", sectionsEnabled.ready)}
          {renderSection("Opublikowane", grouped.published, "published", sectionsEnabled.published)}
          {renderSection("Archiwum", grouped.archived, "archived", sectionsEnabled.archived)}
        </div>
      )}
    </div>
  );
}