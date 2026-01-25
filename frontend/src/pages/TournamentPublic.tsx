// frontend/src/pages/TournamentPublic.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams, useSearchParams, useNavigate } from "react-router-dom";
import { apiFetch } from "../api";
import PublicMatchesPanel from "../components/PublicMatchesPanel";
import type { MatchPublicDTO } from "../components/PublicMatchesPanel";
import StandingsBracket from "../components/StandingsBracket";

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

  // Polityka zmiany nazwy (różne warianty nazwy pola – frontend wykrywa)
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

type ViewTab = "MATCHES" | "STANDINGS";

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
  // heurystyka: komunikaty typu "wymaga akceptacji", "zatwierdzenia", "prośba o zmianę"
  const approval =
    t.includes("akcept") || t.includes("zatwier") || t.includes("approval") || t.includes("request") || t.includes("prośb");
  const rename = t.includes("zmian") && (t.includes("nazw") || t.includes("name"));
  return approval && rename;
}

function extractList(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

// ==========================
// PUBLIC: incydenty + król strzelców
// ==========================
type IncidentDTO = {
  id: number;
  match_id: number;
  team_id: number | null;
  kind: string;
  kind_display?: string;
  period?: string | null;
  time_source?: string | null;
  minute: number | null;
  minute_raw?: number | null;
  player_id?: number | null;
  player_name?: string | null;
  meta?: Record<string, any>;
  created_at?: string | null;
};

type ScorerRow = {
  player_name: string;
  goals: number;
};

function incidentMinute(i: IncidentDTO): number | null {
  if (typeof i.minute === "number") return i.minute;
  if (typeof i.minute_raw === "number") return i.minute_raw;
  return null;
}

function formatIncidentLine(i: IncidentDTO): string {
  const min = incidentMinute(i);
  const k = (i.kind_display ?? i.kind ?? "").trim();
  const p = (i.player_name ?? "").trim();
  const head = min != null ? `${min}' ${k}` : k;
  return p ? `${head} — ${p}` : head;
}

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
  const [incidentsByMatch, setIncidentsByMatch] = useState<Record<number, IncidentDTO[]>>({});
  const [incBusy, setIncBusy] = useState(false);
  const [incError, setIncError] = useState<string | null>(null);

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
      const list = extractList(raw) as IncidentDTO[];
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

  const onPublicMatchClick = async (m: MatchPublicDTO, sectionId: string) => {
    // public: rozwijamy szczegóły tylko dla meczów w trakcie / zakończonych
    if (m.status !== "IN_PROGRESS" && m.status !== "FINISHED") return;

    const isSame = selectedMatchId === m.id && selectedSection === sectionId;
    const willOpen = !isSame;
    setSelectedMatchId(willOpen ? m.id : null);
    setSelectedSection(willOpen ? sectionId : null);

    // bez przycisku „odśwież” – dociągamy automatycznie przy otwarciu
    if (willOpen) {
      await loadIncidentsForMatch(m.id);
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
              const list = extractList(raw) as IncidentDTO[];
              setIncidentsByMatch((prev) => ({ ...prev, [m.id]: list }));
              return list;
            }
            return [] as IncidentDTO[];
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
      const res = await apiFetch(
        `/api/tournaments/${id}/teams/name-change-requests/?status=PENDING&team_id=${teamId}`
      );

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

    const payload: any = {
      requested_name: dn,
    };

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

  // „Join wyłączony” pokazujemy tylko, gdy wiemy to na pewno i użytkownik NIE jest zapisany
  const joinIsDisabledKnown =
    !regMe && (joinDisabledByServer || (tournament ? tournament.allow_join_by_code === false : false));

  return (
    <div style={{ padding: "2rem", maxWidth: 980 }}>
      <div style={{ marginBottom: "1.25rem" }}>
        <h1 style={{ marginBottom: 6 }}>{tournament?.name ?? "Turniej"}</h1>

        {tournament?.description ? (
          <p style={{ opacity: 0.85, marginTop: 0, maxWidth: 820 }}>{tournament.description}</p>
        ) : (
          <p style={{ opacity: 0.7, marginTop: 0, maxWidth: 820 }}>Strona publiczna turnieju.</p>
        )}

        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", opacity: 0.85 }}>
          {dateRange ? (
            <div>
              <strong>Termin:</strong> {dateRange}
            </div>
          ) : null}
          {tournament?.location ? (
            <div>
              <strong>Miejsce:</strong> {tournament.location}
            </div>
          ) : null}
        </div>

        {/* PANEL DOŁĄCZANIA / ZMIANY NAZWY */}
        {shouldShowJoinPanel && (
          <section
            style={{
              marginTop: "1.25rem",
              padding: "1rem",
              border: "1px solid #333",
              borderRadius: 12,
              maxWidth: 620,
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: 6 }}>
              {regMe ? "Twoje dane w turnieju" : "Dołącz do turnieju"}
            </h3>

            {!isLogged ? (
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ opacity: 0.85 }}>Aby dołączyć, musisz się zalogować lub utworzyć konto.</div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <Link
                    to={`/login?next=${nextParam}`}
                    style={{
                      border: "1px solid #444",
                      padding: "0.45rem 0.75rem",
                      borderRadius: 10,
                      textDecoration: "none",
                      display: "inline-block",
                    }}
                  >
                    Zaloguj
                  </Link>
                  <Link
                    to={`/login?mode=register&next=${nextParam}`}
                    style={{
                      border: "1px solid #444",
                      padding: "0.45rem 0.75rem",
                      borderRadius: 10,
                      textDecoration: "none",
                      display: "inline-block",
                    }}
                  >
                    Zarejestruj konto
                  </Link>
                </div>
              </div>
            ) : joinIsDisabledKnown ? (
              <div style={{ opacity: 0.92, lineHeight: 1.45 }}>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>Dołączanie do turnieju jest wyłączone</div>
                <div style={{ opacity: 0.85 }}>
                  Organizator nie włączył opcji dołączania przez konto i kod dla tego turnieju.
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
                  <button
                    type="button"
                    onClick={() => loadTournamentAndMatches().catch(() => null)}
                    style={{ padding: "0.5rem 0.9rem" }}
                  >
                    Odśwież
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const keepAccess = code.trim() ? `?code=${encodeURIComponent(code.trim())}` : "";
                      navigate(location.pathname + keepAccess, { replace: true });
                    }}
                    style={{ padding: "0.5rem 0.9rem" }}
                  >
                    Przejdź do podglądu
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                {/* Stan: już zapisany -> zmiana nazwy (lub prośba) */}
                {regMe ? (
                  <>
                    <div style={{ opacity: 0.9 }}>
                      Jesteś zapisany jako: <strong>{regMe.display_name}</strong>
                      <div style={{ marginTop: 6, opacity: 0.75 }}>
                        Kod dołączania służy tylko do pierwszego dołączenia.
                      </div>

                      {pendingNameReq?.status === "PENDING" && (
                        <div
                          style={{
                            marginTop: 10,
                            padding: "10px 12px",
                            border: "1px solid rgba(201,162,39,0.35)",
                            borderRadius: 10,
                            color: "#c9a227",
                            lineHeight: 1.4,
                          }}
                        >
                          <div style={{ fontWeight: 800, marginBottom: 6 }}>Oczekująca prośba o zmianę nazwy</div>
                          <div style={{ opacity: 0.95 }}>
                            {pendingNameReq.old_name ? (
                              <>
                                {pendingNameReq.old_name} → <strong>{pendingNameReq.requested_name ?? "…"}</strong>
                              </>
                            ) : (
                              <>
                                Nowa nazwa: <strong>{pendingNameReq.requested_name ?? "…"}</strong>
                              </>
                            )}
                          </div>
                          <div style={{ marginTop: 6, opacity: 0.85 }}>
                            Nie możesz wysłać kolejnej prośby, dopóki organizator nie podejmie decyzji.
                          </div>
                        </div>
                      )}

                      {nameChangeApprovalRequired && (
                        <div style={{ marginTop: 10, opacity: 0.8 }}>
                          Zmiana nazwy wymaga akceptacji organizatora — zostanie wysłana prośba.
                        </div>
                      )}
                    </div>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <input
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        placeholder={
                          tournament?.competition_type === "INDIVIDUAL"
                            ? "Imię i nazwisko"
                            : "Nazwa drużyny / imię i nazwisko"
                        }
                        style={{ flex: 1, minWidth: 260, padding: "0.55rem" }}
                      />
                      <button
                        onClick={handleRenameOrRequest}
                        disabled={regBusy || pendingNameReq?.status === "PENDING"}
                        style={{ padding: "0.55rem 0.9rem" }}
                      >
                        {regBusy ? "…" : nameChangeApprovalRequired ? "Wyślij prośbę" : "Zmień nazwę"}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Stan: nie zapisany -> join przez kod */}
                    <div style={{ opacity: 0.9 }}>Wpisz kod dołączania, sprawdź go i uzupełnij nazwę.</div>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <input
                        value={regCode}
                        onChange={(e) => setRegCode(e.target.value)}
                        placeholder="Kod dołączania"
                        style={{ flex: 1, minWidth: 220, padding: "0.55rem" }}
                      />
                      <button onClick={verifyRegistrationCode} disabled={regBusy} style={{ padding: "0.55rem 0.9rem" }}>
                        {regBusy ? "…" : "Sprawdź kod"}
                      </button>
                    </div>

                    {(verified || joinFlag) && (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <input
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          placeholder={
                            tournament?.competition_type === "INDIVIDUAL"
                              ? "Imię i nazwisko"
                              : "Nazwa drużyny / imię i nazwisko"
                          }
                          style={{ flex: 1, minWidth: 220, padding: "0.55rem" }}
                        />
                        <button onClick={joinTournament} disabled={regBusy} style={{ padding: "0.55rem 0.9rem" }}>
                          {regBusy ? "…" : "Dołącz"}
                        </button>
                      </div>
                    )}
                  </>
                )}

                {regError && <div style={{ color: "crimson" }}>{regError}</div>}
                {regInfo && <div style={{ opacity: 0.85 }}>{regInfo}</div>}
              </div>
            )}
          </section>
        )}

        <div style={{ marginTop: "1rem", display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={() => setView("MATCHES")}
            style={{
              padding: "0.55rem 0.9rem",
              borderRadius: 10,
              border: "1px solid #444",
              background: view === "MATCHES" ? "rgba(255,255,255,0.10)" : "transparent",
              color: "#fff",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Mecze
          </button>

          <button
            onClick={() => setView("STANDINGS")}
            style={{
              padding: "0.55rem 0.9rem",
              borderRadius: 10,
              border: "1px solid #444",
              background: view === "STANDINGS" ? "rgba(255,255,255,0.10)" : "transparent",
              color: "#fff",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Tabela / Drabinka
          </button>
        </div>
      </div>

      {error && <div style={{ marginBottom: "1rem", color: "crimson" }}>{error}</div>}

      {needsCode && (
        <section
          style={{
            marginBottom: "1.25rem",
            padding: "1rem",
            border: "1px solid #333",
            borderRadius: 10,
            maxWidth: 420,
          }}
        >
          <h3 style={{ marginTop: 0 }}>Kod dostępu</h3>
          <p style={{ opacity: 0.8, marginTop: 0 }}>Ten turniej wymaga kodu. Wpisz kod i odśwież dane.</p>

          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Wpisz kod"
              style={{ flex: 1, padding: "0.5rem" }}
            />
            <button
              onClick={() => loadTournamentAndMatches().catch((e: any) => setError(e.message))}
              style={{ padding: "0.5rem 0.9rem" }}
            >
              Otwórz
            </button>
          </div>
        </section>
      )}

      {view === "MATCHES" ? (
        <div>
          {/* Moje mecze pokazuj tylko gdy są dostępne (to jest niezależne od rename) */}
          {regMe && tournament?.is_published && (
            <section style={{ marginBottom: "1.5rem" }}>
              <h2 style={{ margin: "0 0 0.5rem 0" }}>Moje mecze</h2>

              {myMatches.length === 0 ? (
                <div style={{ opacity: 0.75 }}>Brak meczów do wyświetlenia.</div>
              ) : (
                <div style={{ border: "1px solid #333", borderRadius: 12, padding: "0.75rem 1rem" }}>
                  {myMatches.map((m) => (
                    <div
                      key={m.id}
                      style={{
                        borderBottom: "1px solid #333",
                        padding: "0.75rem 0",
                        display: "flex",
                        gap: "1rem",
                        justifyContent: "space-between",
                        flexWrap: "wrap",
                      }}
                    >
                      <div style={{ minWidth: 260 }}>
                        <div style={{ fontWeight: 700 }}>
                          {m.home_team_name} <span style={{ opacity: 0.6 }}>vs</span> {m.away_team_name}
                        </div>
                        <div style={{ opacity: 0.75, fontSize: "0.9rem", marginTop: 4 }}>
                          {[m.scheduled_date, m.scheduled_time, m.location].filter(Boolean).join(" • ")}
                        </div>
                      </div>

                      <div style={{ textAlign: "right", minWidth: 140 }}>
                        {typeof m.home_score === "number" && typeof m.away_score === "number" ? (
                          <div style={{ fontWeight: 800 }}>
                            {m.home_score} : {m.away_score}
                          </div>
                        ) : (
                          <div style={{ opacity: 0.55 }} />
                        )}
                        <div style={{ opacity: 0.75, fontSize: "0.85rem" }}>{m.status ?? ""}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* PODGLĄD INCYDENTÓW – wybór przez kliknięcie meczu */}
{/* KRÓL STRZELCÓW – niezależna sekcja */}
          {showTopScorers ? (
            <section style={{ marginTop: 18, border: "1px solid #333", borderRadius: 12, padding: "1rem" }}>
              <h2 style={{ margin: "0 0 0.5rem 0" }}>Król strzelców</h2>
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <button onClick={computeTopScorers} disabled={scorerBusy} style={{ padding: "0.35rem 0.6rem" }}>
                  {scorerBusy ? "Liczenie…" : "Policz / odśwież"}
                </button>
                <div style={{ opacity: 0.75, fontSize: "0.9rem" }}>
                  Liczy gole na podstawie incydentów typu <b>GOAL</b> (zawodnik musi być przypisany do incydentu).
                </div>
              </div>
              {scorerError ? <div style={{ color: "#ff6b6b", marginTop: 8 }}>{scorerError}</div> : null}
              <div style={{ marginTop: 10 }}>
                {scorers.length === 0 ? (
                  <div style={{ opacity: 0.75 }}>Brak danych do rankingu (albo brak zawodników w incydentach).</div>
                ) : (
                  <div style={{ borderTop: "1px solid #333", marginTop: 10, paddingTop: 10 }}>
                    {scorers.map((r) => (
                      <div
                        key={r.player_name}
                        style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "0.35rem 0" }}
                      >
                        <div style={{ fontWeight: 700 }}>{r.player_name}</div>
                        <div style={{ fontWeight: 800 }}>{r.goals}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          ) : null}

          <div ref={matchesPanelRef}>
            <PublicMatchesPanel
              matches={publicMatches}
              selectedMatchId={selectedMatchId}
              selectedSection={selectedSection}
              incidentsByMatch={incidentsByMatch}
              incidentsBusy={incBusy}
              incidentsError={incError}
              onMatchClick={onPublicMatchClick}
            />
          </div>
        </div>
      ) : id ? (
        <StandingsBracket tournamentId={Number(id)} accessCode={code.trim() || undefined} />
      ) : null}
    </div>
  );
}
