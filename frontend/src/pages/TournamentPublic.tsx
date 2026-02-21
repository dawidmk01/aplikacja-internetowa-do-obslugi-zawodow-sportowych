// frontend/src/pages/TournamentPublic.tsx
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { BarChart3, Calendar, KeyRound, MapPin, QrCode, Swords, UserCheck, Users } from "lucide-react";

import { apiFetch } from "../api";
import { cn } from "../lib/cn";

import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { InlineAlert } from "../ui/InlineAlert";
import { Input } from "../ui/Input";

import PublicMatchesBar from "../components/PublicMatchesBar";
import PublicMatchesPanel from "../components/PublicMatchesPanel";
import type { CommentaryEntryPublicDTO, IncidentPublicDTO, MatchPublicDTO } from "../components/PublicMatchesPanel";
import StandingsBracket from "../components/StandingsBracket";
import TournamentFlowNav from "../components/TournamentFlowNav";

type EntryMode = "MANAGER" | "ORGANIZER_ONLY";

type TournamentPublicDTO = {
  id: number;
  name: string;
  description: string | null;
  discipline?: string | null;
  start_date: string | null;
  end_date: string | null;
  location: string | null;
  is_published?: boolean;

  entry_mode?: EntryMode;
  competition_type?: "TEAM" | "INDIVIDUAL";

  allow_join_by_code?: boolean;
  join_code?: string | null;

  participants_public_preview_enabled?: boolean;

  // Polityka zmiany nazwy (różne warianty nazwy pola - frontend wykrywa)
  participants_self_rename_enabled?: boolean;
  participants_self_rename_requires_approval?: boolean;
  participants_self_rename_approval_required?: boolean;

  my_role?: "ORGANIZER" | "ASSISTANT" | "PARTICIPANT" | null;
};

type RegistrationMeDTO = {
  display_name: string;
  team_id: number | null;
};

type NameChangeRequestDTO = {
  id?: number;
  status?: "PENDING" | "APPROVED" | "REJECTED" | string;
  old_name?: string;
  requested_name?: string;
  created_at?: string;
};

type ViewTab = "MATCHES" | "STANDINGS";

// ==========================
// Helpers
// ==========================

function formatDateRange(start: string | null, end: string | null) {
  if (!start && !end) return null;
  if (start && end) return `${start} - ${end}`;
  return start ?? end;
}

function isByePublic(m: MatchPublicDTO): boolean {
  const h = (m.home_team_name ?? "").toUpperCase();
  const a = (m.away_team_name ?? "").toUpperCase();
  const needles = ["BYE", "__SYSTEM_BYE__", "WOLNY LOS"];
  return needles.some((n) => h.includes(n) || a.includes(n));
}

function hasAccessToken(): boolean {
  try {
    const keys = ["access", "accessToken", "access_token", "jwt_access", "token"];
    for (const k of keys) {
      const v = localStorage.getItem(k);
      if (v && v.trim()) return true;
    }
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      const lk = k.toLowerCase();
      if (lk.includes("access") && !lk.includes("refresh")) {
        const v = localStorage.getItem(k);
        if (v && v.trim()) return true;
      }
    }
  } catch {
    // ignore
  }
  return false;
}

function normalizeName(s: string) {
  return (s ?? "").trim().replace(/\s+/g, " ");
}

function looksLikeJoinDisabledMessage(msg: string) {
  const t = (msg ?? "").toLowerCase();
  return t.includes("dołącz") && (t.includes("wyłącz") || t.includes("disabled"));
}

function looksLikeRenameRequiresApprovalMessage(msg: string) {
  const t = (msg ?? "").toLowerCase();
  const approval =
    t.includes("akcept") ||
    t.includes("zatwier") ||
    t.includes("approval") ||
    t.includes("request") ||
    t.includes("prośb");
  const rename = t.includes("zmian") && (t.includes("nazw") || t.includes("name"));
  return approval && rename;
}

function extractList(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

function formatRoleLabel(role: TournamentPublicDTO["my_role"]): string {
  switch (role) {
    case "ORGANIZER":
      return "Organizator";
    case "ASSISTANT":
      return "Asystent";
    case "PARTICIPANT":
      return "Uczestnik";
    default:
      return "Widz";
  }
}

// ==========================
// UI building blocks
// ==========================

type RevealProps = {
  children: ReactNode;
  delay?: number;
  className?: string;
};

function Reveal({ children, delay = 0, className }: RevealProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14, filter: "blur(2px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, amount: 0.25 }}
      transition={{ duration: 0.35, ease: "easeOut", delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

type HoverLiftProps = {
  children: ReactNode;
  className?: string;
  scale?: number;
};

function HoverLift({ children, className, scale = 1.01 }: HoverLiftProps) {
  return (
    <motion.div
      whileHover={{ y: -3, scale }}
      transition={{ type: "spring", stiffness: 260, damping: 18 }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

type MiniInfoProps = {
  icon: ReactNode;
  label: string;
  title: string;
  desc: string;
};

function MiniInfo({ icon, label, title, desc }: MiniInfoProps) {
  return (
    <HoverLift scale={1.015} className="h-full">
      <div className="h-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
        <div className="flex h-full items-start gap-3">
          <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.06]">
            {icon}
          </div>
          <div className="min-w-0 flex h-full flex-col">
            <div className="text-xs text-slate-400">{label}</div>
            <div className="mt-1 text-sm font-semibold text-white">{title}</div>
            <div className="mt-2 min-h-[3.25rem] text-sm text-slate-300 leading-relaxed">{desc}</div>
          </div>
        </div>
      </div>
    </HoverLift>
  );
}

type PillProps = {
  icon: ReactNode;
  label: string;
  value: string;
};

function Pill({ icon, label, value }: PillProps) {
  return (
    <div className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2">
      <span className="grid h-8 w-8 place-items-center rounded-xl border border-white/10 bg-white/[0.06]">
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-[11px] text-slate-400">{label}</div>
        <div className="truncate text-sm font-semibold text-slate-100">{value}</div>
      </div>
    </div>
  );
}

type SectionCardProps = {
  title: string;
  right?: ReactNode;
  hint?: string;
  children: ReactNode;
  className?: string;
};

function SectionCard({ title, right, hint, children, className }: SectionCardProps) {
  return (
    <Card className={cn("p-5 sm:p-6", className)}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
          {hint ? <div className="mt-1 text-xs text-slate-400">{hint}</div> : null}
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>
      {children}
    </Card>
  );
}

type ViewTabsProps = {
  value: ViewTab;
  onChange: (v: ViewTab) => void;
  disabled?: boolean;
};

function ViewTabs({ value, onChange, disabled }: ViewTabsProps) {
  return (
    <div className={cn("flex items-center gap-2", disabled && "opacity-60")}>
      <button
        type="button"
        onClick={() => onChange("MATCHES")}
        disabled={disabled}
        className={cn(
          "h-10 rounded-xl border px-4 text-sm font-semibold transition",
          "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/10",
          value === "MATCHES"
            ? "border-white/15 bg-white/10 text-slate-100"
            : "border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.07]",
          disabled && "cursor-not-allowed"
        )}
      >
        Mecze
      </button>
      <button
        type="button"
        onClick={() => onChange("STANDINGS")}
        disabled={disabled}
        className={cn(
          "h-10 rounded-xl border px-4 text-sm font-semibold transition",
          "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/10",
          value === "STANDINGS"
            ? "border-white/15 bg-white/10 text-slate-100"
            : "border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.07]",
          disabled && "cursor-not-allowed"
        )}
      >
        Tabela / Drabinka
      </button>
    </div>
  );
}

// ==========================
// PUBLIC: incydenty + król strzelców
// ==========================

type ScorerRow = {
  player_name: string;
  goals: number;
};

function incidentMinute(i: IncidentPublicDTO): number | null {
  if (typeof i.minute === "number") return i.minute;
  const mr = (i as any).minute_raw;
  if (typeof mr === "number" && Number.isFinite(mr)) return mr;
  if (typeof mr === "string") {
    const t = mr.trim();
    if (t && /^\d+$/.test(t)) return Number(t);
  }
  return null;
}

// ==========================
// Page
// ==========================

export default function TournamentPublic({ initialView = "MATCHES" }: { initialView?: ViewTab } = {}) {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // kod dostępu (public access code)
  const urlAccessCode = searchParams.get("code") ?? "";
  const [code, setCode] = useState("");

  useEffect(() => {
    if (urlAccessCode && !code) setCode(urlAccessCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlAccessCode]);

  // tryb "dołączania"
  const joinFlag = searchParams.get("join") === "1";
  const urlJoinCode = searchParams.get("join_code") ?? searchParams.get("joinCode") ?? "";

  const [tournament, setTournament] = useState<TournamentPublicDTO | null>(null);
  const [matches, setMatches] = useState<MatchPublicDTO[]>([]);
  const [myMatches, setMyMatches] = useState<MatchPublicDTO[]>([]);

  const showManagerNav = tournament?.my_role === "ORGANIZER" || tournament?.my_role === "ASSISTANT";

  const [error, setError] = useState<string | null>(null);
  const [needsCode, setNeedsCode] = useState(false);
  const [view, setView] = useState<ViewTab>(initialView);

  // rejestracja
  const isLogged = hasAccessToken();
  const [regMe, setRegMe] = useState<RegistrationMeDTO | null>(null);
  const [regBusy, setRegBusy] = useState(false);
  const [regInfo, setRegInfo] = useState<string | null>(null);
  const [regError, setRegError] = useState<string | null>(null);

  // JOIN (tylko do pierwszego dołączenia)
  const [regCode, setRegCode] = useState("");
  const [verified, setVerified] = useState(false);

  // NAZWA (po dołączeniu)
  const [displayName, setDisplayName] = useState("");

  const [joinDisabledByServer, setJoinDisabledByServer] = useState(false);

  // PENDING prośba o zmianę nazwy (jeśli backend pozwala odczytać)
  const [pendingNameReq, setPendingNameReq] = useState<NameChangeRequestDTO | null>(null);

  // prefill join code z URL
  useEffect(() => {
    if (joinFlag && urlJoinCode && !regCode) setRegCode(urlJoinCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinFlag, urlJoinCode]);

  // po zmianie kodu reset weryfikacji
  useEffect(() => {
    setVerified(false);
    setRegInfo(null);
    setRegError(null);
    setJoinDisabledByServer(false);
  }, [regCode]);

  const nextParam = encodeURIComponent(location.pathname + location.search);

  const qs = useMemo(() => {
    const c = code.trim();
    return c ? `?code=${encodeURIComponent(c)}` : "";
  }, [code]);

  const publicMatches = useMemo(() => matches.filter((m) => !isByePublic(m)), [matches]);

  // ==========================
  // PUBLIC: wybór meczu -> podgląd incydentów
  // ==========================

  const [selectedMatchId, setSelectedMatchId] = useState<number | null>(null);
  const [selectedSection, setSelectedSection] = useState<string | null>(null);
  const [incidentsByMatch, setIncidentsByMatch] = useState<Record<number, IncidentPublicDTO[]>>({});
  const [incBusy, setIncBusy] = useState(false);
  const [incError, setIncError] = useState<string | null>(null);

  const [commentaryByMatch, setCommentaryByMatch] = useState<Record<number, CommentaryEntryPublicDTO[]>>({});
  const [comBusy, setComBusy] = useState(false);
  const [comError, setComError] = useState<string | null>(null);

  const matchesPanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (selectedMatchId == null) return;
    const onDown = (e: MouseEvent) => {
      const root = matchesPanelRef.current;
      if (!root) return;
      const t = e.target as any;
      if (t && t instanceof Node && !root.contains(t)) {
        setSelectedMatchId(null);
        setSelectedSection(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [selectedMatchId]);

  const loadIncidentsForMatch = async (matchId: number) => {
    if (!matchId) return;
    setIncError(null);
    setIncBusy(true);
    try {
      const res = await apiFetch(`/api/matches/${matchId}/incidents/${qs}`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail || "Nie udało się pobrać incydentów.");
      }
      const raw = await res.json().catch(() => []);
      const list = extractList(raw) as IncidentPublicDTO[];

      // public: prezentujemy chronologicznie (minute ASC)
      list.sort((a, b) => {
        const am = incidentMinute(a);
        const bm = incidentMinute(b);
        if (am == null && bm == null) return (a.id ?? 0) - (b.id ?? 0);
        if (am == null) return 1;
        if (bm == null) return -1;
        if (am !== bm) return am - bm;
        return (a.id ?? 0) - (b.id ?? 0);
      });

      setIncidentsByMatch((prev) => ({ ...prev, [matchId]: list }));
    } catch (e: any) {
      setIncError(e?.message ?? "Błąd pobierania incydentów.");
    } finally {
      setIncBusy(false);
    }
  };

  const loadCommentaryForMatch = async (matchId: number) => {
    if (!matchId) return;
    setComError(null);
    setComBusy(true);
    try {
      const res = await apiFetch(`/api/matches/${matchId}/commentary/${qs}`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail || "Nie udało się pobrać komentarzy.");
      }
      const raw = await res.json().catch(() => []);
      const list = extractList(raw) as CommentaryEntryPublicDTO[];
      setCommentaryByMatch((prev) => ({ ...prev, [matchId]: list }));
    } catch (e: any) {
      setComError(e?.message ?? "Błąd pobierania komentarzy.");
    } finally {
      setComBusy(false);
    }
  };

  const onPublicMatchClick = async (m: MatchPublicDTO, sectionId: string) => {
    // public: rozwijamy szczegóły tylko dla meczów w trakcie / zakończonych
    if (m.status !== "IN_PROGRESS" && m.status !== "FINISHED") return;

    const isSame = selectedMatchId === m.id && selectedSection === sectionId;
    const willOpen = !isSame;
    setSelectedMatchId(willOpen ? m.id : null);
    setSelectedSection(willOpen ? sectionId : null);

    // bez przycisku "odśwież" - dociągamy automatycznie przy otwarciu
    if (willOpen) {
      await Promise.all([loadIncidentsForMatch(m.id), loadCommentaryForMatch(m.id)]);
    }
  };

  // ==========================
  // PUBLIC: Król strzelców (tylko piłka nożna / ręczna)
  // ==========================

  const showTopScorers = useMemo(() => {
    const d = (tournament?.discipline ?? "").toLowerCase();
    return d === "football" || d === "handball";
  }, [tournament?.discipline]);

  const [scorers, setScorers] = useState<ScorerRow[]>([]);
  const [scorerBusy, setScorerBusy] = useState(false);
  const [scorerError, setScorerError] = useState<string | null>(null);

  const computeTopScorers = async () => {
    setScorerError(null);
    setScorerBusy(true);
    try {
      const relevant = publicMatches.filter((m) => m.status === "IN_PROGRESS" || m.status === "FINISHED");
      const goalCounts = new Map<string, number>();

      // Pobieramy incydenty per mecz (cache -> incidentsByMatch)
      const lists = await Promise.all(
        relevant.map(async (m) => {
          if (!incidentsByMatch[m.id]) {
            const res = await apiFetch(`/api/matches/${m.id}/incidents/${qs}`);
            if (res.ok) {
              const raw = await res.json().catch(() => []);
              const list = extractList(raw) as IncidentPublicDTO[];
              setIncidentsByMatch((prev) => ({ ...prev, [m.id]: list }));
              return list;
            }
            return [] as IncidentPublicDTO[];
          }
          return incidentsByMatch[m.id];
        })
      );

      for (const list of lists) {
        for (const inc of list) {
          if ((inc.kind ?? "").toUpperCase() !== "GOAL") continue;
          const name = (inc.player_name ?? "").trim();
          if (!name) continue; // wymagamy przypisanego zawodnika
          goalCounts.set(name, (goalCounts.get(name) ?? 0) + 1);
        }
      }

      const rows: ScorerRow[] = Array.from(goalCounts.entries())
        .map(([player_name, goals]) => ({ player_name, goals }))
        .sort((a, b) => (b.goals !== a.goals ? b.goals - a.goals : a.player_name.localeCompare(b.player_name)));

      setScorers(rows);
    } catch (e: any) {
      setScorerError(e?.message ?? "Błąd liczenia rankingu.");
    } finally {
      setScorerBusy(false);
    }
  };

  const nameChangeApprovalRequired = useMemo(() => {
    const t = tournament as any;
    if (!t) return false;

    if (typeof t.participants_self_rename_enabled === "boolean") {
      return !t.participants_self_rename_enabled;
    }
    if (typeof t.participants_self_rename_requires_approval === "boolean") {
      return !!t.participants_self_rename_requires_approval;
    }
    if (typeof t.participants_self_rename_approval_required === "boolean") {
      return !!t.participants_self_rename_approval_required;
    }
    return false; // brak pola -> domyślnie mogą zmieniać
  }, [tournament]);

  const loadMyMatches = async () => {
    if (!id || !isLogged) return;
    try {
      const res = await apiFetch(`/api/tournaments/${id}/registrations/my/matches/`);
      if (!res.ok) return;

      const data = await res.json().catch(() => []);
      const list: MatchPublicDTO[] = Array.isArray(data) ? data : [];
      setMyMatches(list.filter((m) => !isByePublic(m)));
    } catch {
      // ignore
    }
  };

  const loadMyPendingNameChange = async (teamId: number | null) => {
    if (!id || !teamId) {
      setPendingNameReq(null);
      return;
    }

    try {
      const res = await apiFetch(`/api/tournaments/${id}/teams/name-change-requests/?status=PENDING&team_id=${teamId}`);

      if (!res.ok) {
        // 403/404 ignorujemy (np. endpoint tylko dla organizerów)
        return;
      }

      const data = await res.json().catch(() => null);
      const list = extractList(data) as any[];
      const first = list?.[0] ?? null;

      if (first) {
        setPendingNameReq({
          id: first.id,
          status: first.status,
          old_name: first.old_name,
          requested_name: first.requested_name,
          created_at: first.created_at,
        });
      } else {
        setPendingNameReq(null);
      }
    } catch {
      // ignore
    }
  };

  const loadTournamentAndMatches = async () => {
    if (!id) return;

    setError(null);

    const tRes = await apiFetch(`/api/tournaments/${id}/${qs}`);
    if (tRes.status === 403) {
      const data = await tRes.json().catch(() => null);
      const msg = data?.detail || "Brak dostępu.";

      if (String(msg).toLowerCase().includes("kod")) setNeedsCode(true);
      else setNeedsCode(false);

      // ważne: join panel ma działać nawet przy braku dostępu do public view
      setTournament(null);
      setMatches([]);
      setError(msg);
      return;
    }

    if (!tRes.ok) throw new Error("Nie udało się pobrać danych turnieju.");
    setNeedsCode(false);

    const tData = await tRes.json().catch(() => ({}));

    const t: TournamentPublicDTO = {
      id: tData.id,
      name: tData.name,
      description: tData.description ?? null,
      discipline: Object.prototype.hasOwnProperty.call(tData, "discipline") ? (tData.discipline ?? null) : null,
      start_date: tData.start_date ?? null,
      end_date: tData.end_date ?? null,
      location: tData.location ?? null,
      is_published: tData.is_published,

      entry_mode: tData.entry_mode,
      competition_type: tData.competition_type,
      my_role: tData.my_role ?? null,

      allow_join_by_code: Object.prototype.hasOwnProperty.call(tData, "allow_join_by_code")
        ? Boolean(tData.allow_join_by_code)
        : undefined,

      join_code: Object.prototype.hasOwnProperty.call(tData, "join_code") ? (tData.join_code ?? null) : undefined,

      participants_public_preview_enabled: Object.prototype.hasOwnProperty.call(tData, "participants_public_preview_enabled")
        ? Boolean(tData.participants_public_preview_enabled)
        : undefined,

      participants_self_rename_enabled: Object.prototype.hasOwnProperty.call(tData, "participants_self_rename_enabled")
        ? Boolean(tData.participants_self_rename_enabled)
        : undefined,

      participants_self_rename_requires_approval: Object.prototype.hasOwnProperty.call(tData, "participants_self_rename_requires_approval")
        ? Boolean(tData.participants_self_rename_requires_approval)
        : undefined,

      participants_self_rename_approval_required: Object.prototype.hasOwnProperty.call(tData, "participants_self_rename_approval_required")
        ? Boolean(tData.participants_self_rename_approval_required)
        : undefined,
    };

    setTournament(t);

    const mRes = await apiFetch(`/api/tournaments/${id}/public/matches/${qs}`);
    if (mRes.status === 403) {
      const data = await mRes.json().catch(() => null);
      const msg = data?.detail || "Brak dostępu.";
      if (String(msg).toLowerCase().includes("kod")) setNeedsCode(true);
      setMatches([]);
      setError((prev) => prev ?? msg);
      return;
    }
    if (!mRes.ok) throw new Error("Nie udało się pobrać meczów.");

    const raw = await mRes.json().catch(() => []);
    const list: MatchPublicDTO[] = Array.isArray(raw)
      ? raw
      : Array.isArray((raw as any)?.results)
        ? (raw as any).results
        : [];
    setMatches(list);
  };

  const loadRegistrationMe = async () => {
    if (!id || !isLogged) {
      setRegMe(null);
      setPendingNameReq(null);
      return;
    }

    const res = await apiFetch(`/api/tournaments/${id}/registrations/me/`);
    if (res.status === 404) {
      setRegMe(null);
      setPendingNameReq(null);
      return;
    }
    if (!res.ok) {
      setRegMe(null);
      setPendingNameReq(null);
      return;
    }

    const data = (await res.json().catch(() => null)) as RegistrationMeDTO | null;
    if (data?.display_name) {
      setRegMe({ display_name: data.display_name, team_id: data.team_id ?? null });
      setDisplayName(data.display_name);
      loadMyMatches();

      // spróbuj dociągnąć pending request (jeśli endpoint pozwala)
      await loadMyPendingNameChange(data.team_id ?? null);
    } else {
      setRegMe(null);
      setPendingNameReq(null);
    }
  };

  useEffect(() => {
    loadTournamentAndMatches().catch((e: any) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, qs]);

  useEffect(() => {
    loadRegistrationMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const dateRange = formatDateRange(tournament?.start_date ?? null, tournament?.end_date ?? null);

  // --- JOIN: verify code (tylko przed dołączeniem) ---
  const verifyRegistrationCode = async () => {
    if (!id) return;

    setRegError(null);
    setRegInfo(null);

    const c = regCode.trim();
    if (!c) {
      setRegError("Wpisz kod dołączania.");
      return;
    }

    setRegBusy(true);
    try {
      const res = await apiFetch(`/api/tournaments/${id}/registrations/verify/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: c }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = data?.detail || "Nie udało się zweryfikować kodu.";
        if (looksLikeJoinDisabledMessage(msg)) setJoinDisabledByServer(true);
        throw new Error(msg);
      }

      setVerified(true);
      setJoinDisabledByServer(false);
      setRegInfo("Kod poprawny. Uzupełnij nazwę i dołącz do turnieju.");
    } catch (e: any) {
      setVerified(false);
      setRegError(e?.message ?? "Błąd weryfikacji kodu.");
    } finally {
      setRegBusy(false);
    }
  };

  // --- JOIN: dołączenie (wymaga kodu) ---
  const joinTournament = async () => {
    if (!id) return;

    setRegError(null);
    setRegInfo(null);

    const c = regCode.trim();
    const dn = normalizeName(displayName);

    if (!c) {
      setRegError("Wpisz kod dołączania.");
      return;
    }
    if (!dn) {
      setRegError("Podaj nazwę drużyny / imię i nazwisko.");
      return;
    }

    setRegBusy(true);
    try {
      const res = await apiFetch(`/api/tournaments/${id}/registrations/join/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: c, display_name: dn }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = data?.detail || "Nie udało się zapisać do turnieju.";
        if (looksLikeJoinDisabledMessage(msg)) setJoinDisabledByServer(true);
        throw new Error(msg);
      }

      await loadRegistrationMe();
      setRegInfo("Zapisano do turnieju.");
      setRegError(null);

      await loadTournamentAndMatches().catch(() => null);

      // jeżeli weszliśmy przez join=1, czyścimy join flagę (zostawiamy ewentualny code=)
      if (joinFlag) {
        const keepAccess = code.trim() ? `?code=${encodeURIComponent(code.trim())}` : "";
        navigate(location.pathname + keepAccess, { replace: true });
      }
    } catch (e: any) {
      setRegError(e?.message ?? "Błąd rejestracji.");
    } finally {
      setRegBusy(false);
    }
  };

  // --- RENAME (1): bezpośrednia zmiana nazwy (gdy nie ma akceptacji) ---
  const renameRegistrationImmediate = async (dn: string) => {
    if (!id) return;

    const res = await apiFetch(`/api/tournaments/${id}/registrations/me/`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ display_name: dn }),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = data?.detail || "Nie udało się zmienić nazwy.";
      throw new Error(msg);
    }

    await loadRegistrationMe();
    setRegInfo("Zmieniono nazwę.");
  };

  // --- RENAME (2): prośba o zmianę nazwy (gdy wymagana akceptacja) ---
  const requestNameChangeApproval = async (dn: string) => {
    if (!id) return;

    const payload: any = { requested_name: dn };
    if (regMe?.team_id) payload.team_id = regMe.team_id;

    const res = await apiFetch(`/api/tournaments/${id}/teams/name-change-requests/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = data?.detail || "Nie udało się wysłać prośby o zmianę nazwy.";
      throw new Error(msg);
    }

    setRegInfo("Wysłano prośbę o zmianę nazwy. Oczekuje na akceptację organizatora.");
    setRegError(null);

    // spróbuj odświeżyć pending (jeśli endpoint działa dla uczestnika)
    await loadMyPendingNameChange(regMe?.team_id ?? null);
  };

  // --- RENAME: handler (sam dobiera tryb + fallback) ---
  const handleRenameOrRequest = async () => {
    if (!id) return;

    setRegError(null);
    setRegInfo(null);

    if (!regMe) return;

    const dn = normalizeName(displayName);
    if (!dn) {
      setRegError("Podaj nową nazwę.");
      return;
    }

    if (normalizeName(regMe.display_name) === dn) {
      setRegInfo("Nazwa nie uległa zmianie.");
      return;
    }

    if (pendingNameReq?.status === "PENDING") {
      setRegInfo("Masz już oczekującą prośbę o zmianę nazwy. Poczekaj na decyzję organizatora.");
      return;
    }

    setRegBusy(true);
    try {
      if (nameChangeApprovalRequired) {
        await requestNameChangeApproval(dn);
        return;
      }

      // standard: zmiana natychmiastowa
      await renameRegistrationImmediate(dn);
    } catch (e: any) {
      // fallback: backend może wymagać akceptacji nawet jeśli public view nie zwrócił pola
      const msg = e?.message ?? "Błąd zmiany nazwy.";
      if (looksLikeRenameRequiresApprovalMessage(msg)) {
        try {
          await requestNameChangeApproval(dn);
          return;
        } catch (e2: any) {
          setRegError(e2?.message ?? msg);
          return;
        }
      }
      setRegError(msg);
    } finally {
      setRegBusy(false);
    }
  };

  // Panel join pokazujemy gdy:
  // - join=1 lub allow_join_by_code=true lub użytkownik już zapisany
  const shouldShowJoinPanel = joinFlag || !!regMe || Boolean(tournament?.allow_join_by_code);

  // "Join wyłączony" pokazujemy tylko, gdy wiemy to na pewno i użytkownik NIE jest zapisany
  const joinIsDisabledKnown =
    !regMe && (joinDisabledByServer || (tournament ? tournament.allow_join_by_code === false : false));

  const heroJoinLabel = useMemo(() => {
    if (joinIsDisabledKnown) return "Wyłączone";
    if (tournament?.allow_join_by_code) return "Włączone";
    if (regMe) return "Zapisany";
    return "Sprawdź";
  }, [joinIsDisabledKnown, regMe, tournament?.allow_join_by_code]);

  // ==========================
  // View
  // ==========================

  return (
    <div className="w-full pb-24">

      {view === "MATCHES" && !needsCode ? (
        <PublicMatchesBar matches={publicMatches} />
      ) : null}

      {/* ===== HERO ===== */}
      <section className="grid gap-10 lg:grid-cols-2 lg:items-stretch">
        <div className="flex h-full flex-col">
          <Reveal>
            <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              {tournament?.name ?? "Turniej"}
            </h1>
          </Reveal>

          <Reveal delay={0.05}>
            {tournament?.description ? (
              <p className="mt-4 text-base text-slate-300 leading-relaxed">{tournament.description}</p>
            ) : (
              <p className="mt-4 text-base text-slate-300 leading-relaxed">Publiczny podgląd turnieju.</p>
            )}
          </Reveal>

          <Reveal delay={0.1}>
            <div className="mt-6 flex flex-wrap gap-3">
              {dateRange ? (
                <Pill icon={<Calendar className="h-4 w-4 text-white/90" />} label="Termin" value={dateRange} />
              ) : null}

              {tournament?.location ? (
                <Pill icon={<MapPin className="h-4 w-4 text-white/90" />} label="Miejsce" value={tournament.location} />
              ) : null}

              <Pill
                icon={<UserCheck className="h-4 w-4 text-white/90" />}
                label="Rola"
                value={formatRoleLabel(tournament?.my_role ?? null)}
              />
            </div>
          </Reveal>

          <Reveal delay={0.15} className="mt-auto">
            <div className="mt-6 grid items-stretch gap-3 sm:grid-cols-3">
              <MiniInfo
                icon={<Swords className="h-4 w-4 text-white/90" />}
                label="Mecze"
                title={`${publicMatches.length}`}
                desc="Bez wolnych losów (BYE)."
              />
              <MiniInfo
                icon={<KeyRound className="h-4 w-4 text-white/90" />}
                label="Dostęp"
                title={needsCode ? "Wymaga kodu" : "Publiczny"}
                desc={needsCode ? "Wpisz kod, aby zobaczyć dane." : "Widok bez logowania."}
              />
              <MiniInfo
                icon={<Users className="h-4 w-4 text-white/90" />}
                label="Dołączanie"
                title={heroJoinLabel}
                desc={regMe ? "Możesz zmienić nazwę." : "Wpisz kod i zapisz się."}
              />
            </div>
          </Reveal>

          {error ? (
            <Reveal delay={0.2} className="mt-6">
              <InlineAlert variant="error" title="Błąd">
                {error}
              </InlineAlert>
            </Reveal>
          ) : null}
        </div>

        <Reveal className="h-full lg:justify-self-end">
          <HoverLift scale={1.01} className="h-full">
            <Card className="relative h-full overflow-hidden p-6 sm:p-7">
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute -top-24 left-1/2 h-48 w-[28rem] -translate-x-1/2 rounded-full bg-indigo-500/15 blur-3xl" />
                <div className="absolute -bottom-24 left-1/2 h-48 w-[28rem] -translate-x-1/2 rounded-full bg-sky-500/10 blur-3xl" />
              </div>

              <div className="relative flex h-full flex-col">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm text-slate-300">Widok publiczny</div>
                    <div className="mt-1 text-lg font-semibold text-white">Mecze i tabela w jednym miejscu</div>
                  </div>
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.06]">
                    <QrCode className="h-5 w-5 text-white/90" />
                  </div>
                </div>

                <div className="mt-5">
                  <div className="text-sm font-semibold text-slate-100">Sekcja</div>
                  <div className="mt-2">
                    <ViewTabs value={view} onChange={setView} disabled={needsCode} />
                  </div>
                </div>

                {needsCode ? (
                  <div className="mt-5">
                    <InlineAlert variant="info" title="Wymagany kod dostępu">
                      Wpisz kod w panelu poniżej i otwórz dane turnieju.
                    </InlineAlert>
                  </div>
                ) : (
                  <div className="mt-5 grid gap-3">
                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[0.06]">
                          <BarChart3 className="h-4 w-4 text-white/90" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-white">Incydenty meczu</div>
                          <div className="mt-1 text-sm text-slate-300 leading-relaxed">
                            Kliknij mecz w trakcie lub zakończony, aby rozwinąć szczegóły.
                          </div>
                        </div>
                      </div>
                    </div>

                    {!isLogged ? (
                      <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[0.06]">
                            <Users className="h-4 w-4 text-white/90" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-white">Dołączanie</div>
                            <div className="mt-1 text-sm text-slate-300 leading-relaxed">
                              Aby zapisać się do turnieju, zaloguj się i użyj kodu dołączania.
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}

                <div className="mt-auto pt-6">
                  <div className="text-xs text-slate-400">
                    Jeśli jesteś organizatorem lub asystentem, po zalogowaniu zobaczysz na dole nawigację panelu.
                  </div>
                </div>
              </div>
            </Card>
          </HoverLift>
        </Reveal>
      </section>

      {/* ===== ACCESS CODE ===== */}
      {needsCode ? (
        <div className="mt-6">
          <SectionCard
            title="Kod dostępu"
            hint="Ten turniej wymaga kodu. Wpisz go i odśwież dane."
            right={
              <Button variant="secondary" onClick={() => loadTournamentAndMatches().catch((e: any) => setError(e.message))}>
                Odśwież
              </Button>
            }
          >
            <div className="flex flex-wrap items-center gap-3">
              <div className="w-full sm:w-[320px]">
                <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Wpisz kod" aria-label="Kod dostępu" />
              </div>
              <Button onClick={() => loadTournamentAndMatches().catch((e: any) => setError(e.message))}>Otwórz</Button>
            </div>
          </SectionCard>
        </div>
      ) : null}

      {/* ===== JOIN / RENAME ===== */}
      {shouldShowJoinPanel ? (
        <div className="mt-6">
          <SectionCard
            title={regMe ? "Twoje dane w turnieju" : "Dołącz do turnieju"}
            hint={
              regMe
                ? "Możesz zmienić nazwę (lub wysłać prośbę, jeśli wymagana jest akceptacja)."
                : "Wpisz kod dołączania, sprawdź go i uzupełnij nazwę."
            }
          >
            {!isLogged ? (
              <div className="grid gap-3">
                <InlineAlert variant="info" title="Wymagane logowanie">
                  Aby dołączyć do turnieju, musisz się zalogować lub utworzyć konto.
                </InlineAlert>

                <div className="flex flex-wrap gap-2">
                  <Link to={`/login?next=${nextParam}`}>
                    <Button variant="secondary">Zaloguj</Button>
                  </Link>
                  <Link to={`/login?mode=register&next=${nextParam}`}>
                    <Button variant="secondary">Zarejestruj konto</Button>
                  </Link>
                </div>
              </div>
            ) : joinIsDisabledKnown ? (
              <div className="grid gap-3">
                <InlineAlert variant="info" title="Dołączanie jest wyłączone">
                  Organizator nie włączył opcji dołączania przez konto i kod dla tego turnieju.
                </InlineAlert>

                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => loadTournamentAndMatches().catch(() => null)}>
                    Odśwież
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      const keepAccess = code.trim() ? `?code=${encodeURIComponent(code.trim())}` : "";
                      navigate(location.pathname + keepAccess, { replace: true });
                    }}
                  >
                    Przejdź do podglądu
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid gap-3">
                {/* Stan: już zapisany -> zmiana nazwy (lub prośba) */}
                {regMe ? (
                  <>
                    <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                      <div className="text-sm text-slate-200">
                        Jesteś zapisany jako: <span className="font-semibold text-slate-100">{regMe.display_name}</span>
                      </div>
                      <div className="mt-1 text-xs text-slate-400">Kod dołączania służy tylko do pierwszego dołączenia.</div>

                      {pendingNameReq?.status === "PENDING" ? (
                        <div className="mt-3 rounded-2xl border border-amber-400/20 bg-amber-500/10 p-3 text-sm text-amber-200">
                          <div className="font-semibold">Oczekująca prośba o zmianę nazwy</div>
                          <div className="mt-1">
                            {pendingNameReq.old_name ? (
                              <>
                                {pendingNameReq.old_name} → <span className="font-semibold">{pendingNameReq.requested_name ?? "…"}</span>
                              </>
                            ) : (
                              <>
                                Nowa nazwa: <span className="font-semibold">{pendingNameReq.requested_name ?? "…"}</span>
                              </>
                            )}
                          </div>
                          <div className="mt-1 text-xs text-amber-200/80">
                            Nie możesz wysłać kolejnej prośby, dopóki organizator nie podejmie decyzji.
                          </div>
                        </div>
                      ) : null}

                      {nameChangeApprovalRequired ? (
                        <div className="mt-3 text-sm text-slate-300">
                          Zmiana nazwy wymaga akceptacji organizatora - zostanie wysłana prośba.
                        </div>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <div className="min-w-[260px] flex-1">
                        <Input
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          placeholder={tournament?.competition_type === "INDIVIDUAL" ? "Imię i nazwisko" : "Nazwa drużyny / imię i nazwisko"}
                        />
                      </div>
                      <Button onClick={handleRenameOrRequest} disabled={regBusy || pendingNameReq?.status === "PENDING"}>
                        {regBusy ? "…" : nameChangeApprovalRequired ? "Wyślij prośbę" : "Zmień nazwę"}
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Stan: nie zapisany -> join przez kod */}
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="min-w-[220px] flex-1">
                        <Input value={regCode} onChange={(e) => setRegCode(e.target.value)} placeholder="Kod dołączania" />
                      </div>
                      <Button variant="secondary" onClick={verifyRegistrationCode} disabled={regBusy}>
                        {regBusy ? "…" : "Sprawdź kod"}
                      </Button>
                    </div>

                    {verified || joinFlag ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="min-w-[220px] flex-1">
                          <Input
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            placeholder={tournament?.competition_type === "INDIVIDUAL" ? "Imię i nazwisko" : "Nazwa drużyny / imię i nazwisko"}
                          />
                        </div>
                        <Button onClick={joinTournament} disabled={regBusy}>
                          {regBusy ? "…" : "Dołącz"}
                        </Button>
                      </div>
                    ) : null}
                  </>
                )}

                {regError ? <InlineAlert variant="error">{regError}</InlineAlert> : null}
                {regInfo ? <InlineAlert variant="success">{regInfo}</InlineAlert> : null}
              </div>
            )}
          </SectionCard>
        </div>
      ) : null}

      {/* ===== CONTENT ===== */}
      <div className="mt-6 space-y-6">
        {view === "MATCHES" ? (
          <>
            {/* Moje mecze */}
            {regMe && tournament?.is_published ? (
              <SectionCard title="Moje mecze" hint="Widoczne tylko dla zapisanych uczestników">
                {myMatches.length === 0 ? (
                  <div className="text-sm text-slate-300">Brak meczów do wyświetlenia.</div>
                ) : (
                  <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                    <div className="divide-y divide-white/10">
                      {myMatches.map((m) => (
                        <div key={m.id} className="py-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-[260px]">
                              <div className="text-sm font-semibold text-slate-100">
                                {m.home_team_name} <span className="font-normal text-slate-400">vs</span> {m.away_team_name}
                              </div>
                              <div className="mt-1 text-xs text-slate-400">
                                {[m.scheduled_date, m.scheduled_time, m.location].filter(Boolean).join(" • ")}
                              </div>
                            </div>

                            <div className="min-w-[140px] text-right">
                              {typeof m.home_score === "number" && typeof m.away_score === "number" ? (
                                <div className="text-sm font-semibold text-slate-100">
                                  {m.home_score} : {m.away_score}
                                </div>
                              ) : (
                                <div className="text-sm text-slate-600">&nbsp;</div>
                              )}
                              <div className="mt-1 text-xs text-slate-400">{m.status ?? ""}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </SectionCard>
            ) : null}

            {/* Król strzelców */}
            {showTopScorers ? (
              <SectionCard
                title="Król strzelców"
                hint="Liczy gole na podstawie incydentów typu GOAL (zawodnik musi być przypisany)."
                right={
                  <Button variant="secondary" onClick={computeTopScorers} disabled={scorerBusy}>
                    {scorerBusy ? "Liczenie…" : "Policz / odśwież"}
                  </Button>
                }
              >
                {scorerError ? <InlineAlert variant="error">{scorerError}</InlineAlert> : null}

                <div className="mt-4">
                  {scorers.length === 0 ? (
                    <div className="text-sm text-slate-300">Brak danych do rankingu (albo brak zawodników w incydentach).</div>
                  ) : (
                    <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
                      <div className="divide-y divide-white/10">
                        {scorers.map((r) => (
                          <div key={r.player_name} className="flex items-center justify-between gap-3 py-2">
                            <div className="text-sm font-semibold text-slate-100">{r.player_name}</div>
                            <div className="text-sm font-semibold text-slate-100">{r.goals}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </SectionCard>
            ) : null}

            {/* Mecze */}
            <SectionCard title="Mecze" hint="Kliknij mecz (w trakcie / zakończony), aby rozwinąć relację live (incydenty i komentarze).">
              <div ref={matchesPanelRef}>
                <PublicMatchesPanel
                  matches={publicMatches}
                  selectedMatchId={selectedMatchId}
                  selectedSection={selectedSection}
                  incidentsByMatch={incidentsByMatch}
                  incidentsBusy={incBusy}
                  incidentsError={incError}
                  commentaryByMatch={commentaryByMatch}
                  commentaryBusy={comBusy}
                  commentaryError={comError}
                  onMatchClick={onPublicMatchClick}
                />
              </div>
            </SectionCard>
          </>
        ) : id ? (
          <SectionCard title="Tabela / Drabinka" hint="Widok publiczny">
            <StandingsBracket tournamentId={Number(id)} accessCode={code.trim() || undefined} />
          </SectionCard>
        ) : null}
      </div>

      {showManagerNav ? <TournamentFlowNav side="bottom" /> : null}
    </div>
  );
}

// Co zmieniono:
// 1) Przeprojektowano układ strony publicznej w stylu Home (hero, karty, mikro-sekcje z ikonami).
// 2) Zastąpiono ręczne klasy formularzy komponentami UI: Card, Button, Input, InlineAlert.
// 3) Podzielono widok na mniejsze bloki (Reveal, SectionCard, ViewTabs, Pill, MiniInfo) w obrębie pliku.
// 4) Ujednolicono hierarchię nagłówków i spacing, dodano czytelniejsze komunikaty w kartach.
// 5) U góry strony (także dla organizatora) pokazuje się PublicMatchesBar, a TournamentFlowNav przeniesiono na dół.
