import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Trophy,
  Search,
  RefreshCw,
  Share2,
  LayoutDashboard,
  Eye,
  EyeOff,
  Archive,
  RotateCcw,
  Clipboard,
  Link as LinkIcon,
  KeyRound,
  UserPlus,
  AlertTriangle,
  CheckCircle2,
  Info,
} from "lucide-react";

import { apiFetch, apiGet } from "../api";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { cn } from "../lib/cn";

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
};

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
      return code ?? "—";
  }
}

function formatLabel(v?: Tournament["tournament_format"]) {
  if (v === "LEAGUE") return "Liga";
  if (v === "CUP") return "Puchar";
  if (v === "MIXED") return "Mieszany";
  return "—";
}

function statusLabel(v?: Tournament["status"]) {
  if (v === "DRAFT") return "Szkic";
  if (v === "CONFIGURED") return "Skonfigurowany";
  if (v === "RUNNING") return "W trakcie";
  if (v === "FINISHED") return "Zakończony";
  return "—";
}

function entryModeLabel(v?: Tournament["entry_mode"]) {
  const m = v ?? "MANAGER";
  if (m === "MANAGER") return "Organizator + asystenci";
  if (m === "ORGANIZER_ONLY") return "Tylko organizator";
  return "—";
}

function roleLabel(v: Tournament["my_role"]) {
  if (v === "ORGANIZER") return "Organizator";
  if (v === "ASSISTANT") return "Asystent";
  if (v === "PARTICIPANT") return "Zawodnik";
  return "—";
}

function normalizePL(s: string) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
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

function Badge({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
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

function StatusBadge({ status }: { status?: Tournament["status"] }) {
  const cls =
    status === "RUNNING"
      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
      : status === "FINISHED"
      ? "border-white/10 bg-white/[0.04] text-slate-200"
      : status === "CONFIGURED"
      ? "border-indigo-400/20 bg-indigo-400/10 text-indigo-100"
      : status === "DRAFT"
      ? "border-amber-400/20 bg-amber-400/10 text-amber-100"
      : "border-white/10 bg-white/[0.04] text-slate-200";

  return <Badge className={cls}>{statusLabel(status)}</Badge>;
}

function RoleBadge({ role }: { role: Tournament["my_role"] }) {
  const cls =
    role === "ORGANIZER"
      ? "border-indigo-400/20 bg-indigo-400/10 text-indigo-100"
      : role === "ASSISTANT"
      ? "border-violet-400/20 bg-violet-400/10 text-violet-100"
      : role === "PARTICIPANT"
      ? "border-sky-400/20 bg-sky-400/10 text-sky-100"
      : "border-white/10 bg-white/[0.04] text-slate-200";

  return <Badge className={cls}>{roleLabel(role)}</Badge>;
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
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="text-lg font-semibold text-white">{title}</div>
        <Badge className="border-white/10 bg-white/[0.04] text-slate-200">
          {count}
        </Badge>
      </div>

      <button
        type="button"
        onClick={() => onToggle(!visible)}
        className={cn(
          "rounded-full px-3 py-2 text-sm font-semibold transition",
          "border border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.07]",
          visible && "bg-white/10 border-white/15"
        )}
      >
        {visible ? "Ukryj sekcję" : "Pokaż sekcję"}
      </button>
    </div>
  );
}

export default function MyTournaments() {
  const [items, setItems] = useState<Tournament[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState("");
  const [shareOpenId, setShareOpenId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const [toast, setToast] = useState<{ type: "ok" | "err" | "info"; text: string } | null>(null);

  const [visibleSections, setVisibleSections] = useState({
    draft: true,
    ready: true,
    published: true,
    archived: false,
  });

  const load = () => {
    setLoading(true);
    setError(null);

    apiGet<Tournament[]>("/api/tournaments/my/")
      .then((data) => {
        setItems(Array.isArray(data) ? data : []);
      })
      .catch((e) => setError(e?.message ?? "Błąd pobierania turniejów."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const setToastSafe = (type: "ok" | "err" | "info", text: string) => {
    setToast({ type, text });
    window.setTimeout(() => setToast(null), 2200);
  };

  const filtered = useMemo(() => {
    const q = normalizePL(query.trim());
    if (!q) return items;

    const scored = items
      .map((t) => {
        const name = normalizePL(t.name);
        const discipline = normalizePL(disciplineLabel(t.discipline));
        const format = normalizePL(formatLabel(t.tournament_format));
        const st = normalizePL(statusLabel(t.status));
        const vis = normalizePL(t.is_published ? "opublikowany" : "nieopublikowany");
        const arch = normalizePL(t.is_archived ? "archiwum" : "");
        const mode = normalizePL(entryModeLabel(t.entry_mode));
        const role = normalizePL(t.my_role ?? "");
        const join = normalizePL(t.join_enabled ? "dolaczanie wlaczone join" : "dolaczanie wylaczone");

        let score = 0;

        if (name === q) score += 200;
        else if (name.startsWith(q)) score += 140;
        else if (name.includes(q)) score += 90;

        if (discipline.startsWith(q)) score += 60;
        else if (discipline.includes(q)) score += 40;

        if (format.includes(q)) score += 15;
        if (st.includes(q)) score += 10;
        if (vis.includes(q)) score += 6;
        if (arch.includes(q)) score += 6;
        if (mode.includes(q)) score += 6;
        if (role.includes(q)) score += 6;
        if (join.includes(q)) score += 4;

        const hay = [name, discipline, format, st, vis, arch, mode, role, join].join(" ");
        if (score === 0 && hay.includes(q)) score = 1;

        return { t, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.t);

    return scored;
  }, [items, query]);

  const grouped = useMemo(() => {
    const archived = filtered.filter((t) => !!t.is_archived);
    const notArchived = filtered.filter((t) => !t.is_archived);

    const draft = notArchived.filter((t) => (t.status ?? "DRAFT") === "DRAFT");
    const ready = notArchived.filter((t) => (t.status ?? "DRAFT") !== "DRAFT" && !t.is_published);
    const published = notArchived.filter((t) => (t.status ?? "DRAFT") !== "DRAFT" && !!t.is_published);

    return { draft, ready, published, archived };
  }, [filtered]);

  // Jak lista się przeładuje, a otwarty share nie istnieje – zamknij
  useEffect(() => {
    if (shareOpenId == null) return;
    const exists = items.some((x) => x.id === shareOpenId);
    if (!exists) setShareOpenId(null);
  }, [items, shareOpenId]);

  const togglePublish = async (t: Tournament) => {
    if (t.my_role !== "ORGANIZER") return;

    if ((t.status ?? "DRAFT") === "DRAFT") {
      setToastSafe("info", "Najpierw skonfiguruj turniej i wygeneruj rozgrywki.");
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

      if (!res.ok) throw new Error("Nie udało się zmienić publikacji turnieju.");

      load();
      setToastSafe("ok", !t.is_published ? "Turniej opublikowany." : "Turniej ukryty.");
    } catch (e: any) {
      setError(e?.message ?? "Błąd publikacji turnieju.");
      setToastSafe("err", "Błąd publikacji.");
    } finally {
      setBusyId(null);
    }
  };

  const toggleArchive = async (t: Tournament) => {
    if (t.my_role !== "ORGANIZER") return;

    setBusyId(t.id);
    setError(null);

    try {
      const res = await apiFetch(`/api/tournaments/${t.id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_archived: !t.is_archived }),
      });

      if (!res.ok) throw new Error("Nie udało się zmienić archiwizacji.");

      load();
      setToastSafe("ok", !t.is_archived ? "Przeniesiono do archiwum." : "Przywrócono z archiwum.");
    } catch (e: any) {
      setToastSafe("err", e?.message ?? "Błąd komunikacji z serwerem.");
    } finally {
      setBusyId(null);
    }
  };

  const SharePanel = ({ t }: { t: Tournament }) => {
    const baseLink = `${window.location.origin}/tournaments/${t.id}`;
    const joinLink = `${baseLink}?join=1`;

    const viewLinkWithCode =
      t.access_code && t.access_code.trim()
        ? `${baseLink}?code=${encodeURIComponent(t.access_code)}`
        : baseLink;

    const copyBtn = (text: string, okMsg: string, errMsg: string) => (
      <Button
        type="button"
        variant="ghost"
        className="px-3 py-2 rounded-xl"
        leftIcon={<Clipboard className="h-4 w-4" />}
        onClick={async () => {
          const ok = await copyToClipboard(text);
          setToastSafe(ok ? "ok" : "err", ok ? okMsg : errMsg);
        }}
      >
        Kopiuj
      </Button>
    );

    return (
      <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
        {!t.is_published && (
          <div className="mb-3 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
            Uwaga: turniej jest nieopublikowany. Podgląd dla widzów będzie sensowny dopiero po publikacji.
          </div>
        )}

        <div className="grid gap-3">
          {/* Link */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <LinkIcon className="h-4 w-4 text-white/90" />
              Link do turnieju
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-200 break-all">
                {baseLink}
              </code>
              {copyBtn(baseLink, "Skopiowano link.", "Nie udało się skopiować.")}
            </div>
          </div>

          {/* Kod dostępu */}
          {t.access_code && t.access_code.trim() && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <KeyRound className="h-4 w-4 text-white/90" />
                  Kod dostępu
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <code className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-200">
                    {t.access_code}
                  </code>
                  {copyBtn(t.access_code, "Skopiowano kod.", "Nie udało się skopiować.")}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <LinkIcon className="h-4 w-4 text-white/90" />
                  Link z kodem
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <code className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-200 break-all">
                    {viewLinkWithCode}
                  </code>
                  {copyBtn(viewLinkWithCode, "Skopiowano link z kodem.", "Nie udało się skopiować.")}
                </div>
              </div>
            </div>
          )}

          {/* Dołączanie */}
          {t.my_role === "ORGANIZER" && t.join_enabled && (
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <UserPlus className="h-4 w-4 text-white/90" />
                Dołączanie uczestników (konto + kod)
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="text-sm font-semibold text-white">Link do dołączenia</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <code className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-200 break-all">
                      {joinLink}
                    </code>
                    {copyBtn(joinLink, "Skopiowano link do dołączenia.", "Nie udało się skopiować.")}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="text-sm font-semibold text-white">Kod dołączania</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <code className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-200">
                      {t.registration_code ?? "—"}
                    </code>

                    <Button
                      type="button"
                      variant="ghost"
                      className="px-3 py-2 rounded-xl"
                      leftIcon={<Clipboard className="h-4 w-4" />}
                      disabled={!t.registration_code}
                      onClick={async () => {
                        const ok = await copyToClipboard(t.registration_code ?? "");
                        setToastSafe(ok ? "ok" : "err", ok ? "Skopiowano kod dołączania." : "Nie udało się skopiować.");
                      }}
                    >
                      Kopiuj
                    </Button>
                  </div>
                </div>
              </div>

              <div className="mt-3 text-xs text-slate-300">
                Uczestnik zakłada konto i wchodzi przez link do dołączenia, a następnie podaje kod.
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const TournamentCard = ({ t }: { t: Tournament }) => {
    const isOrganizer = t.my_role === "ORGANIZER";
    const isDraft = (t.status ?? "DRAFT") === "DRAFT";
    const isShareOpen = shareOpenId === t.id;

    const note = panelNote(t);

    return (
      <motion.div whileHover={{ y: -2 }} transition={{ duration: 0.15 }}>
        <Card className="p-5 h-full">
          <div className="flex h-full flex-col">
            {/* Top */}
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <div className="text-lg font-semibold text-white truncate">
                    {t.name}
                  </div>
                  <div className="text-sm text-slate-300">
                    {disciplineLabel(t.discipline)}
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap gap-2">
                  <RoleBadge role={t.my_role} />
                  <StatusBadge status={t.status} />
                  <Badge className="border-white/10 bg-white/[0.04] text-slate-200">
                    {formatLabel(t.tournament_format)}
                  </Badge>

                  {!t.is_archived && (
                    <Badge className="border-white/10 bg-white/[0.04] text-slate-200">
                      {t.is_published ? "Opublikowany" : "Nieopublikowany"}
                    </Badge>
                  )}

                  {t.join_enabled && (
                    <Badge className="border-sky-400/20 bg-sky-400/10 text-sky-100">
                      Dołączanie włączone
                    </Badge>
                  )}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
                    <div className="text-[11px] text-slate-400">Uczestnicy</div>
                    <div className="mt-0.5 text-sm font-semibold text-white">
                      {typeof t.participants_count === "number" ? t.participants_count : "—"}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
                    <div className="text-[11px] text-slate-400">Tryb panelu</div>
                    <div className="mt-0.5 text-sm font-semibold text-white">
                      {entryModeLabel(t.entry_mode)}
                    </div>
                  </div>
                </div>

                {note && (
                  <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-300">
                    <div className="flex items-start gap-2">
                      <Info className="h-4 w-4 mt-0.5 text-slate-200/80" />
                      <div>{note}</div>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.06]">
                <Trophy className="h-5 w-5 text-indigo-200" />
              </div>
            </div>

            {/* Actions */}
            <div className="mt-5 flex flex-wrap gap-2">
              {(t.my_role === "ORGANIZER" || t.my_role === "ASSISTANT") && (
                <Link to={`/tournaments/${t.id}/detail`}>
                  <Button
                    variant="secondary"
                    leftIcon={<LayoutDashboard className="h-4 w-4" />}
                    className="rounded-xl"
                    title="Panel zarządzania (uprawnienia zależą od roli i ustawień organizatora)."
                  >
                    Panel
                  </Button>
                </Link>
              )}

              <Link to={`/tournaments/${t.id}`}>
                <Button variant="ghost" leftIcon={<Eye className="h-4 w-4" />}>
                  Turniej
                </Button>
              </Link>

              {!t.is_archived && (
                <Button
                  type="button"
                  variant="ghost"
                  leftIcon={<Share2 className="h-4 w-4" />}
                  onClick={() => setShareOpenId(isShareOpen ? null : t.id)}
                >
                  Udostępnij
                </Button>
              )}

              {isOrganizer && !t.is_archived && (
                <Button
                  type="button"
                  variant="ghost"
                  leftIcon={t.is_published ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  disabled={busyId === t.id}
                  onClick={() => togglePublish(t)}
                  title={isDraft ? "Publikacja dostępna po wygenerowaniu rozgrywek." : undefined}
                  className={cn(isDraft && "opacity-70")}
                >
                  {t.is_published ? "Ukryj" : "Publikuj"}
                </Button>
              )}

              {isOrganizer && (
                <Button
                  type="button"
                  variant="ghost"
                  leftIcon={
                    t.is_archived ? <RotateCcw className="h-4 w-4" /> : <Archive className="h-4 w-4" />
                  }
                  disabled={busyId === t.id}
                  onClick={() => toggleArchive(t)}
                >
                  {t.is_archived ? "Przywróć" : "Archiwizuj"}
                </Button>
              )}
            </div>

            {/* Share */}
            <AnimatePresence initial={false}>
              {isShareOpen && !t.is_archived && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
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

  const renderSection = (title: string, list: Tournament[], key: keyof typeof visibleSections) => {
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
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-xs font-semibold text-slate-200">
            <Trophy className="h-4 w-4 text-indigo-300" />
            Strefa użytkownika
          </div>

          <h1 className="mt-3 text-2xl sm:text-3xl font-semibold text-white">
            Moje turnieje
          </h1>

          <div className="mt-2 text-sm text-slate-300">
            Zarządzaj turniejami i udostępniaj je widzom oraz uczestnikom.
          </div>
        </div>

        <Link to="/tournaments/new">
          <Button variant="primary">Utwórz turniej</Button>
        </Link>
      </div>

      {/* Controls */}
      <Card className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                className="pl-10"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Szukaj: nazwa, dyscyplina (PL), status, publikacja, archiwum, join…"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              leftIcon={<RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />}
              onClick={load}
              disabled={loading}
            >
              Odśwież
            </Button>
          </div>
        </div>

        {!!error && (
          <div className="mt-4 rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}
      </Card>

      {/* Loading skeleton */}
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

      {/* Empty */}
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

      {/* Sections */}
      {!loading && items.length > 0 && (
        <div className="space-y-10">
          {renderSection("Szkice", grouped.draft, "draft")}
          {renderSection("Gotowe do publikacji", grouped.ready, "ready")}
          {renderSection("Opublikowane", grouped.published, "published")}
          {renderSection("Archiwum", grouped.archived, "archived")}
        </div>
      )}

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-5 right-5 z-50"
          >
            <div
              className={cn(
                "rounded-2xl border px-4 py-3 text-sm shadow-lg backdrop-blur",
                toast.type === "ok" && "border-emerald-400/20 bg-emerald-400/10 text-emerald-100",
                toast.type === "err" && "border-red-500/25 bg-red-500/10 text-red-200",
                toast.type === "info" && "border-white/10 bg-white/[0.06] text-slate-200"
              )}
            >
              <div className="flex items-start gap-2">
                {toast.type === "ok" ? (
                  <CheckCircle2 className="h-4 w-4 mt-0.5" />
                ) : toast.type === "err" ? (
                  <AlertTriangle className="h-4 w-4 mt-0.5" />
                ) : (
                  <Info className="h-4 w-4 mt-0.5" />
                )}
                <div>{toast.text}</div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
