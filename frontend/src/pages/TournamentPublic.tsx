// frontend/src/pages/TournamentPublic.tsx
// Komponent renderuje publiczny widok turnieju z obsługą dostępu, rejestracji i odświeżania WebSocket.

import type { ReactNode } from "react";
import { useEffect, useCallback, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { BarChart3, Calendar, KeyRound, MapPin, QrCode, Swords, UserCheck, Users } from "lucide-react";

import { apiFetch, hasAuthTokens } from "../api";
import { useTournamentWs } from "../hooks/useTournamentWs";
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

  // Kompatybilność: backend może zwracać różne nazwy pól dla polityki zmiany nazwy.
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
  return hasAuthTokens();
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

function normalizePublicMatches(payload: any): MatchPublicDTO[] {
  return extractList(payload).filter(Boolean) as MatchPublicDTO[];
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


type RevealProps = {
  children: ReactNode;
  delay?: number;
  className?: string;
};

// Reveal ujednolica animację wejścia sekcji dla spójnego rytmu treści.
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

/** HoverLift standaryzuje mikroruch na elementach klikalnych, aby nie powstawały różne wzorce interakcji. */
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
      <Card className="h-full bg-white/[0.04] px-4 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.06]">
            {icon}
          </div>

          <div className="min-w-0">
            <div className="text-xs text-slate-400 break-words">{label}</div>
            <div className="mt-1 text-sm font-semibold text-white break-words">{title}</div>
          </div>
        </div>

        <div className="mt-3 text-sm text-slate-300 leading-relaxed break-words">{desc}</div>
      </Card>
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
      <span className="grid h-8 w-8 place-items-center rounded-xl border border-white/10 bg-white/[0.06]">{icon}</span>
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
  const base = "h-10 px-4 rounded-xl border text-sm font-semibold";
  const active = "border-white/15 bg-white/10 text-slate-100";
  const idle = "border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.07]";

  return (
    <div className={cn("flex flex-wrap items-center gap-2", disabled && "opacity-60")}>
      <Button
        type="button"
        variant="ghost"
        onClick={() => onChange("MATCHES")}
        disabled={disabled}
        className={cn(base, value === "MATCHES" ? active : idle)}
      >
        Mecze
      </Button>

      <Button
        type="button"
        variant="ghost"
        onClick={() => onChange("STANDINGS")}
        disabled={disabled}
        className={cn(base, value === "STANDINGS" ? active : idle)}
      >
        Tabela / Drabinka
      </Button>
    </div>
  );
}


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

export default function TournamentPublic({ initialView = "MATCHES" }: { initialView?: ViewTab } = {}) {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const tournamentId = id ?? null;

  const urlAccessCode = searchParams.get("code") ?? "";
  const [code, setCode] = useState("");

  useEffect(() => {
    if (!urlAccessCode) return;
    setCode((prev) => (prev ? prev : urlAccessCode));
  }, [urlAccessCode]);

  const joinFlag = searchParams.get("join") === "1";
  const urlJoinCode = searchParams.get("join_code") ?? searchParams.get("joinCode") ?? "";

  const [tournament, setTournament] = useState<TournamentPublicDTO | null>(null);
  const [tournamentLoaded, setTournamentLoaded] = useState(false);
  const [matches, setMatches] = useState<MatchPublicDTO[]>([]);
  const [myMatches, setMyMatches] = useState<MatchPublicDTO[]>([]);

  const showManagerNav = tournament?.my_role === "ORGANIZER" || tournament?.my_role === "ASSISTANT";
  const showParticipantJoin = !showManagerNav;

  const [error, setError] = useState<string | null>(null);
  const [needsCode, setNeedsCode] = useState(false);
  const [view, setView] = useState<ViewTab>(initialView);

  const isLogged = hasAccessToken();
  const [regMe, setRegMe] = useState<RegistrationMeDTO | null>(null);
  const [regBusy, setRegBusy] = useState(false);
  const [regInfo, setRegInfo] = useState<string | null>(null);
  const [regError, setRegError] = useState<string | null>(null);

  const [regCode, setRegCode] = useState("");
  const [verified, setVerified] = useState(false);

  const [displayName, setDisplayName] = useState("");

  const [joinDisabledByServer, setJoinDisabledByServer] = useState(false);

  const [pendingNameReq, setPendingNameReq] = useState<NameChangeRequestDTO | null>(null);

  useEffect(() => {
    if (!joinFlag || !urlJoinCode) return;
    setRegCode((prev) => (prev ? prev : urlJoinCode));
  }, [joinFlag, urlJoinCode]);

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
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [selectedMatchId]);

  const loadIncidentsForMatch = async (matchId: number) => {
    if (!id) return;
    setIncError(null);
    setIncBusy(true);

    try {
      const res = await apiFetch(`/api/matches/${matchId}/incidents/${qs}`, { toastOnError: false });
      if (!res.ok) throw new Error("Nie udało się pobrać incydentów.");
      const data = (await res.json().catch(() => null)) as IncidentPublicDTO[] | null;

      const sorted = Array.isArray(data)
        ? [...data].sort((a, b) => {
            const ma = incidentMinute(a) ?? 1e9;
            const mb = incidentMinute(b) ?? 1e9;
            if (ma !== mb) return ma - mb;
            return (a.id ?? 0) - (b.id ?? 0);
          })
        : [];

      setIncidentsByMatch((prev) => ({ ...prev, [matchId]: sorted }));
    } catch (e: any) {
      setIncError(e?.message ?? "Błąd pobierania incydentów.");
    } finally {
      setIncBusy(false);
    }
  };

  const loadCommentaryForMatch = async (matchId: number) => {
    if (!id) return;
    setComError(null);
    setComBusy(true);

    try {
      const res = await apiFetch(`/api/matches/${matchId}/commentary/${qs}`, { toastOnError: false });
      if (!res.ok) throw new Error("Nie udało się pobrać komentarza.");
      const data = (await res.json().catch(() => null)) as CommentaryEntryPublicDTO[] | null;

      const sorted = Array.isArray(data)
        ? [...data].sort((a, b) => {
            const ma = a.minute ?? 1e9;
            const mb = b.minute ?? 1e9;
            if (ma !== mb) return ma - mb;
            return (a.id ?? 0) - (b.id ?? 0);
          })
        : [];

      setCommentaryByMatch((prev) => ({ ...prev, [matchId]: sorted }));
    } catch (e: any) {
      setComError(e?.message ?? "Błąd pobierania komentarza.");
    } finally {
      setComBusy(false);
    }
  };

  const onPublicMatchClick = async (match: MatchPublicDTO) => {
    if (!match) return;

    const isExpandable = match.status === "IN_PROGRESS" || match.status === "FINISHED";
    if (!isExpandable) return;

    const matchId = match.id;

    if (selectedMatchId === matchId) {
      setSelectedMatchId(null);
      setSelectedSection(null);
      return;
    }

    setSelectedMatchId(matchId);
    setSelectedSection(null);

    if (!incidentsByMatch[matchId]) {
      await loadIncidentsForMatch(matchId);
    }
    if (!commentaryByMatch[matchId]) {
      await loadCommentaryForMatch(matchId);
    }
  };

  const [scorers, setScorers] = useState<ScorerRow[]>([]);
  const [scorerBusy, setScorerBusy] = useState(false);
  const [scorerError, setScorerError] = useState<string | null>(null);

  const isGoalSport = useMemo(() => {
    const d = (tournament?.discipline ?? "").toLowerCase();
    return d.includes("piłka") || d.includes("football") || d.includes("ręczna") || d.includes("handball");
  }, [tournament?.discipline]);

  const showTopScorers = Boolean(isGoalSport && tournament?.participants_public_preview_enabled);

  const computeTopScorers = async () => {
    if (!showTopScorers) return;
    setScorerError(null);
    setScorerBusy(true);

    try {
      const list = publicMatches;

      const perMatch: Record<number, IncidentPublicDTO[]> = {};
      for (const m of list) {
        if (incidentsByMatch[m.id]) {
          perMatch[m.id] = incidentsByMatch[m.id];
          continue;
        }
        const res = await apiFetch(`/api/matches/${m.id}/incidents/${qs}`, { toastOnError: false });
        if (!res.ok) continue;
        const data = (await res.json().catch(() => null)) as IncidentPublicDTO[] | null;
        perMatch[m.id] = Array.isArray(data) ? data : [];
      }

      const counts = new Map<string, number>();
      for (const ids of Object.values(perMatch)) {
        for (const inc of ids) {
          const kind = ((inc as any).type ?? (inc as any).kind ?? "").toString().toUpperCase();
          if (kind !== "GOAL") continue;

          const name = normalizeName(((inc as any).player_name ?? (inc as any).player ?? "").toString());
          if (!name) continue;

          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
      }

      const rows: ScorerRow[] = Array.from(counts.entries())
        .map(([player_name, goals]) => ({ player_name, goals }))
        .sort((a, b) => {
          if (b.goals !== a.goals) return b.goals - a.goals;
          return a.player_name.localeCompare(b.player_name);
        });

      setScorers(rows);
    } catch (e: any) {
      setScorerError(e?.message ?? "Błąd liczenia strzelców.");
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
    return false;
  }, [tournament]);

  const loadMyMatches = useCallback(async () => {
    if (!id || !isLogged) return;
    try {
      const res = await apiFetch(`/api/tournaments/${id}/registrations/my/matches/`, { toastOnError: false });
      if (!res.ok) return;

      const data = await res.json().catch(() => []);
      const list: MatchPublicDTO[] = Array.isArray(data) ? data : [];
      setMyMatches(list.filter((m) => !isByePublic(m)));
    } catch {
      return;
    }
  }, [id, isLogged]);

  const loadMyPendingNameChange = useCallback(
    async (teamId: number | null) => {
      if (!id || !teamId) {
        setPendingNameReq(null);
        return;
      }

      try {
        const res = await apiFetch(
          `/api/tournaments/${id}/teams/name-change-requests/?status=PENDING&team_id=${teamId}`,
          { toastOnError: false }
        );

        if (!res.ok) return;

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
        return;
      }
    },
    [id]
  );

  const loadTournamentAndMatches = useCallback(async () => {
    if (!id) return;

    try {

      setTournamentLoaded(false);
      setError(null);

      const tRes = await apiFetch(`/api/tournaments/${id}/${qs}`, { toastOnError: false });
      if (tRes.status === 403) {
        const data = await tRes.json().catch(() => null);
        const msg = data?.detail || "Brak dostępu.";

        if (String(msg).toLowerCase().includes("kod")) setNeedsCode(true);
        else setNeedsCode(false);

        setTournament(null);
        setMatches([]);
        setError(msg);
        setTournamentLoaded(false);
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

        participants_public_preview_enabled: Object.prototype.hasOwnProperty.call(
          tData,
          "participants_public_preview_enabled"
        )
          ? Boolean(tData.participants_public_preview_enabled)
          : undefined,

        participants_self_rename_enabled: Object.prototype.hasOwnProperty.call(tData, "participants_self_rename_enabled")
          ? Boolean(tData.participants_self_rename_enabled)
          : undefined,

        participants_self_rename_requires_approval: Object.prototype.hasOwnProperty.call(
          tData,
          "participants_self_rename_requires_approval"
        )
          ? Boolean(tData.participants_self_rename_requires_approval)
          : undefined,

        participants_self_rename_approval_required: Object.prototype.hasOwnProperty.call(
          tData,
          "participants_self_rename_approval_required"
        )
          ? Boolean(tData.participants_self_rename_approval_required)
          : undefined,
      };

      setTournament(t);
      setTournamentLoaded(true);

      const mRes = await apiFetch(`/api/tournaments/${id}/public/matches/${qs}`, { toastOnError: false });
      if (mRes.status === 403) {
        const data = await mRes.json().catch(() => null);
        const msg = data?.detail || "Brak dostępu.";
        if (String(msg).toLowerCase().includes("kod")) setNeedsCode(true);
        setMatches([]);
        setError((prev) => prev ?? msg);
        setTournamentLoaded(false);
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


    } catch (e) {
      const msg = e instanceof Error ? e.message : "Wystąpił błąd.";
      setTournament(null);
      setMatches([]);
      setTournamentLoaded(false);
      setError(msg);
    }}, [id, qs]);

  const loadRegistrationMe = useCallback(async () => {
    if (!id || !isLogged) {
      setRegMe(null);
      setPendingNameReq(null);
      return;
    }

    if (!tournamentLoaded) return;

    // Rejestracja dotyczy uczestników. Dla organizatora/asystenta nie ma sensu odpalać tego requestu.
    if (!showParticipantJoin && !joinFlag) {
      setRegMe(null);
      setPendingNameReq(null);
      return;
    }

    const res = await apiFetch(`/api/tournaments/${id}/registrations/me/`, { toastOnError: false });
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
      await loadMyPendingNameChange(data.team_id ?? null);
    } else {
      setRegMe(null);
      setPendingNameReq(null);
    }
  }, [id, isLogged, joinFlag, loadMyMatches, loadMyPendingNameChange, showParticipantJoin, tournamentLoaded]);

  useEffect(() => {
    loadTournamentAndMatches().catch((e: any) => setError(e.message));
  }, [loadTournamentAndMatches]);

  const wsReloadTimerRef = useRef<number | null>(null);

  const reloadMatchesOnly = useCallback(async () => {
    if (!id) return;

    try {
      const matchesRes = await apiFetch(`/api/tournaments/${id}/public/matches/${qs}`);

      if (matchesRes.status === 403) {
        setNeedsCode(true);
        return;
      }

      if (!matchesRes.ok) return;

      const raw = await matchesRes.json();
      const list = normalizePublicMatches(raw);
      setMatches(list);
    } catch {
      // brak
    }
  }, [id, qs]);

  const requestMatchesReload = useCallback(() => {
    if (wsReloadTimerRef.current) return;
    wsReloadTimerRef.current = window.setTimeout(() => {
      wsReloadTimerRef.current = null;
      void reloadMatchesOnly();
    }, 250);
  }, [reloadMatchesOnly]);

  useTournamentWs({
    tournamentId,
    enabled: Boolean(tournamentId),
    onEvent: ({ event, payload }) => {
        const normalized = String(event).replaceAll(".", "_");

        if (
          normalized === "matches_changed" ||
          normalized === "incidents_changed" ||
          normalized === "clock_changed" ||
          normalized === "commentary_changed"
        ) {
          requestMatchesReload();
          return;
        }

        if (payload && typeof payload === "object" && "match_id" in (payload as any)) {
          requestMatchesReload();
        }
      },
  });

  useEffect(() => {
    return () => {
      if (wsReloadTimerRef.current) window.clearTimeout(wsReloadTimerRef.current);
      wsReloadTimerRef.current = null;
    };
  }, []);

  useEffect(() => {
    loadRegistrationMe();
  }, [loadRegistrationMe]);

  const dateRange = formatDateRange(tournament?.start_date ?? null, tournament?.end_date ?? null);

  const verifyRegistrationCode = async () => {
    if (!id) return;
    const c = regCode.trim();
    if (!c) {
      setRegError("Wpisz kod dołączania.");
      return;
    }

    setRegBusy(true);
    setRegError(null);
    setRegInfo(null);

    try {
      const res = await apiFetch(`/api/tournaments/${id}/registrations/verify/`, {
        toastOnError: false,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: c }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = data?.detail ?? "Nieprawidłowy kod.";
        if (looksLikeJoinDisabledMessage(String(msg))) setJoinDisabledByServer(true);
        setRegError(msg);
        return;
      }

      setVerified(true);
      setRegInfo("Kod poprawny. Uzupełnij nazwę i dołącz.");
    } catch (e: any) {
      setRegError(e?.message ?? "Błąd weryfikacji kodu.");
    } finally {
      setRegBusy(false);
    }
  };

  const joinTournament = async () => {
    if (!id) return;
    const c = regCode.trim();
    const dn = normalizeName(displayName);

    if (!c) {
      setRegError("Wpisz kod dołączania.");
      return;
    }
    if (!dn) {
      setRegError("Wpisz nazwę.");
      return;
    }

    setRegBusy(true);
    setRegError(null);
    setRegInfo(null);

    try {
      const res = await apiFetch(`/api/tournaments/${id}/registrations/join/`, {
        toastOnError: false,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: c, display_name: dn }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = data?.detail ?? "Nie udało się dołączyć.";
        if (looksLikeJoinDisabledMessage(String(msg))) setJoinDisabledByServer(true);
        setRegError(msg);
        return;
      }

      setRegInfo("Dołączono do turnieju.");
      setVerified(false);
      setJoinDisabledByServer(false);

      const keepAccess = code.trim() ? `?code=${encodeURIComponent(code.trim())}` : "";
      navigate(location.pathname + keepAccess, { replace: true });

      await loadTournamentAndMatches();
      await loadRegistrationMe();
    } catch (e: any) {
      setRegError(e?.message ?? "Błąd dołączania.");
    } finally {
      setRegBusy(false);
    }
  };

  const renameRegistrationImmediate = async (dn: string) => {
    if (!id) return;

    const res = await apiFetch(`/api/tournaments/${id}/registrations/me/`, {
      toastOnError: false,
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ display_name: dn }),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = data?.detail ?? "Nie udało się zmienić nazwy.";
      throw new Error(msg);
    }

    setRegInfo("Zmieniono nazwę.");
    await loadRegistrationMe();
  };

  const requestNameChangeApproval = async (dn: string) => {
    if (!id) return;

    const payload = {
      team_id: regMe?.team_id,
      requested_name: dn,
    };

    const res = await apiFetch(`/api/tournaments/${id}/teams/name-change-requests/`, {
      toastOnError: false,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = data?.detail ?? "Nie udało się wysłać prośby.";
      throw new Error(msg);
    }

    setRegInfo("Wysłano prośbę o zmianę nazwy.");
    await loadMyPendingNameChange(regMe?.team_id ?? null);
  };

  const handleRenameOrRequest = async () => {
    if (!id || !isLogged) return;

    const dn = normalizeName(displayName);
    if (!dn) {
      setRegError("Wpisz nazwę.");
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

      await renameRegistrationImmediate(dn);
    } catch (e: any) {
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

  const shouldShowJoinPanel = showParticipantJoin && (joinFlag || !!regMe || Boolean(tournament?.allow_join_by_code));

  const joinIsDisabledKnown =
    !regMe && (joinDisabledByServer || (tournament ? tournament.allow_join_by_code === false : false));

  const heroJoinLabel = useMemo(() => {
    if (joinIsDisabledKnown) return "Wyłączone";
    if (tournament?.allow_join_by_code) return "Włączone";
    if (regMe) return "Zapisany";
    return "Sprawdź";
  }, [joinIsDisabledKnown, regMe, tournament?.allow_join_by_code]);

  return (
    <div
      className={cn(
        "mx-auto w-full pb-24",
        "max-w-7xl",
        "2xl:max-w-[96rem]",
        "[min-width:1920px]:max-w-[110rem]",
        "[min-width:2560px]:max-w-[128rem]"
      )}
    >
      {view === "MATCHES" && !needsCode ? <PublicMatchesBar matches={publicMatches} /> : null}

      <section className="grid gap-10 lg:grid-cols-2 lg:items-stretch">
        <div className="flex h-full flex-col min-w-0">
          <Reveal>
            <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl break-words">
              {tournament?.name ?? "Turniej"}
            </h1>
          </Reveal>

          <Reveal delay={0.05}>
            {tournament?.description ? (
              <p className="mt-4 text-base text-slate-300 leading-relaxed break-words">{tournament.description}</p>
            ) : (
              <p className="mt-4 text-base text-slate-300 leading-relaxed break-words">Publiczny podgląd turnieju.</p>
            )}
          </Reveal>

          <Reveal delay={0.1}>
            <div className="mt-6 flex flex-wrap gap-3">
              {dateRange ? <Pill icon={<Calendar className="h-4 w-4 text-white/90" />} label="Termin" value={dateRange} /> : null}

              {tournament?.location ? (
                <Pill icon={<MapPin className="h-4 w-4 text-white/90" />} label="Miejsce" value={tournament.location} />
              ) : null}

              <Pill icon={<UserCheck className="h-4 w-4 text-white/90" />} label="Rola" value={formatRoleLabel(tournament?.my_role ?? null)} />
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

        <Reveal className="h-full lg:justify-self-end min-w-0">
          <HoverLift scale={1.01} className="h-full">
            <Card className="relative h-full overflow-hidden p-6 sm:p-7">
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute -top-24 left-1/2 h-48 w-[28rem] -translate-x-1/2 rounded-full bg-indigo-500/15 blur-3xl" />
                <div className="absolute -bottom-24 left-1/2 h-48 w-[28rem] -translate-x-1/2 rounded-full bg-sky-500/10 blur-3xl" />
              </div>

              <div className="relative flex h-full flex-col min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm text-slate-300">Widok publiczny</div>
                    <div className="mt-1 text-lg font-semibold text-white break-words">Mecze i tabela w jednym miejscu</div>
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
                    <Card className="bg-white/[0.04] px-4 py-3">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[0.06]">
                          <BarChart3 className="h-4 w-4 text-white/90" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-white">Incydenty meczu</div>
                          <div className="mt-1 text-sm text-slate-300 leading-relaxed break-words">
                            Kliknij mecz w trakcie lub zakończony, aby rozwinąć szczegóły.
                          </div>
                        </div>
                      </div>
                    </Card>

                    {!isLogged ? (
                      <Card className="bg-white/[0.04] px-4 py-3">
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[0.06]">
                            <Users className="h-4 w-4 text-white/90" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-white">Dołączanie</div>
                            <div className="mt-1 text-sm text-slate-300 leading-relaxed break-words">
                              Aby zapisać się do turnieju, zaloguj się i użyj kodu dołączania.
                            </div>
                          </div>
                        </div>
                      </Card>
                    ) : null}
                  </div>
                )}

                <div className="mt-auto pt-6">
                  <div className="text-xs text-slate-400 break-words">
                    Jeśli jesteś organizatorem lub asystentem, po zalogowaniu zobaczysz na dole nawigację panelu.
                  </div>
                </div>
              </div>
            </Card>
          </HoverLift>
        </Reveal>
      </section>

      {needsCode ? (
        <div className="mt-6">
          <SectionCard
            title="Kod dostępu"
            hint="Ten turniej wymaga kodu. Wpisz go i odśwież dane."
            right={
              <Button
                variant="secondary"
                onClick={() => loadTournamentAndMatches().catch((e: any) => setError(e.message))}
              >
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
                  <Button type="button" variant="secondary" onClick={() => navigate(`/login?next=${nextParam}`)}>
                    Zaloguj
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => navigate(`/login?mode=register&next=${nextParam}`)}
                  >
                    Zarejestruj konto
                  </Button>
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
                {regMe ? (
                  <>
                    <Card className="bg-black/10 p-4">
                      <div className="text-sm text-slate-200 break-words">
                        Jesteś zapisany jako: <span className="font-semibold text-slate-100">{regMe.display_name}</span>
                      </div>
                      <div className="mt-1 text-xs text-slate-400 break-words">
                        Kod dołączania służy tylko do pierwszego dołączenia.
                      </div>

                      {pendingNameReq?.status === "PENDING" ? (
                        <div className="mt-3 rounded-2xl border border-amber-400/20 bg-amber-500/10 p-3 text-sm text-amber-200">
                          <div className="font-semibold">Oczekująca prośba o zmianę nazwy</div>
                          <div className="mt-1 break-words">
                            {pendingNameReq.old_name ? (
                              <>
                                {pendingNameReq.old_name} →{" "}
                                <span className="font-semibold">{pendingNameReq.requested_name ?? "…"}</span>
                              </>
                            ) : (
                              <>
                                Nowa nazwa: <span className="font-semibold">{pendingNameReq.requested_name ?? "…"}</span>
                              </>
                            )}
                          </div>
                          <div className="mt-1 text-xs text-amber-200/80 break-words">
                            Nie możesz wysłać kolejnej prośby, dopóki organizator nie podejmie decyzji.
                          </div>
                        </div>
                      ) : null}

                      {nameChangeApprovalRequired ? (
                        <div className="mt-3 text-sm text-slate-300 break-words">
                          Zmiana nazwy wymaga akceptacji organizatora - zostanie wysłana prośba.
                        </div>
                      ) : null}
                    </Card>

                    <div className="flex flex-wrap gap-2">
                      <div className="w-full sm:min-w-[260px] sm:flex-1">
                        <Input
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          placeholder={
                            tournament?.competition_type === "INDIVIDUAL"
                              ? "Imię i nazwisko"
                              : "Nazwa drużyny / imię i nazwisko"
                          }
                        />
                      </div>
                      <Button onClick={handleRenameOrRequest} disabled={regBusy || pendingNameReq?.status === "PENDING"}>
                        {regBusy ? "…" : nameChangeApprovalRequired ? "Wyślij prośbę" : "Zmień nazwę"}
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="w-full sm:min-w-[220px] sm:flex-1">
                        <Input value={regCode} onChange={(e) => setRegCode(e.target.value)} placeholder="Kod dołączania" />
                      </div>
                      <Button variant="secondary" onClick={verifyRegistrationCode} disabled={regBusy}>
                        {regBusy ? "…" : "Sprawdź kod"}
                      </Button>
                    </div>

                    {verified || joinFlag ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="w-full sm:min-w-[220px] sm:flex-1">
                          <Input
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            placeholder={
                              tournament?.competition_type === "INDIVIDUAL"
                                ? "Imię i nazwisko"
                                : "Nazwa drużyny / imię i nazwisko"
                            }
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

      <div className="mt-6 space-y-6">
        {view === "MATCHES" ? (
          <>
            {regMe && tournament?.is_published ? (
              <SectionCard title="Moje mecze" hint="Widoczne tylko dla zapisanych uczestników">
                {myMatches.length === 0 ? (
                  <div className="text-sm text-slate-300">Brak meczów do wyświetlenia.</div>
                ) : (
                  <Card className="bg-black/10 p-4">
                    <div className="divide-y divide-white/10">
                      {myMatches.map((m) => (
                        <div key={m.id} className="py-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-semibold text-slate-100 break-words">
                                {m.home_team_name} <span className="font-normal text-slate-400">vs</span> {m.away_team_name}
                              </div>
                              <div className="mt-1 text-xs text-slate-400 break-words">
                                {[m.scheduled_date, m.scheduled_time, m.location].filter(Boolean).join(" • ")}
                              </div>
                            </div>

                            <div className="min-w-0 w-full sm:w-auto sm:text-right">
                              {typeof m.home_score === "number" && typeof m.away_score === "number" ? (
                                <div className="text-sm font-semibold text-slate-100">
                                  {m.home_score} : {m.away_score}
                                </div>
                              ) : (
                                <div className="text-sm text-slate-500">&nbsp;</div>
                              )}
                              <div className="mt-1 text-xs text-slate-400 break-words">{m.status ?? ""}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                )}
              </SectionCard>
            ) : null}

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
                    <Card className="bg-black/10 p-4">
                      <div className="divide-y divide-white/10">
                        {scorers.map((r) => (
                          <div key={r.player_name} className="flex items-center justify-between gap-3 py-2">
                            <div className="text-sm font-semibold text-slate-100 break-words">{r.player_name}</div>
                            <div className="text-sm font-semibold text-slate-100">{r.goals}</div>
                          </div>
                        ))}
                      </div>
                    </Card>
                  )}
                </div>
              </SectionCard>
            ) : null}

            <SectionCard
              title="Mecze"
              hint="Kliknij mecz (w trakcie / zakończony), aby rozwinąć relację live (incydenty i komentarze)."
            >
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