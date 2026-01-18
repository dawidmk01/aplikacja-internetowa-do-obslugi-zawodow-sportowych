// frontend/src/pages/TournamentDetail.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiFetch } from "../api";
import { QRCodeCanvas } from "qrcode.react";
import AddAssistantForm from "../components/AddAssistantForm";

/* =========================
   Typy danych
   ========================= */

type MyPermissions = {
  teams_edit: boolean;
  schedule_edit: boolean;
  results_edit: boolean;
  bracket_edit: boolean;
  tournament_edit: boolean;

  // organizer-only (informacyjnie)
  publish: boolean;
  archive: boolean;
  manage_assistants: boolean;
  join_settings: boolean;
};

type Tournament = {
  id: number;
  name: string;
  discipline: string;
  tournament_format: "LEAGUE" | "CUP" | "MIXED";
  status: "DRAFT" | "CONFIGURED" | "RUNNING" | "FINISHED";
  is_published: boolean;
  access_code: string | null;

  description: string | null;

  // Toggle: dołączanie uczestników przez konto + kod
  allow_join_by_code?: boolean;
  join_code?: string | null;

  // Toggle: podgląd TournamentPublic dla zarejestrowanych uczestników przed publikacją
  participants_public_preview_enabled?: boolean;

  // Polityka zmiany nazwy (różne wersje zależnie od backendu)
  participants_self_rename_enabled?: boolean; // true => mogą sami; false => wymaga akceptacji
  participants_self_rename_requires_approval?: boolean; // true => wymaga akceptacji
  participants_self_rename_approval_required?: boolean; // true => wymaga akceptacji

  my_role: "ORGANIZER" | "ASSISTANT" | null;
  my_permissions?: MyPermissions;
};

type AssistantListItem = {
  user_id: number;
  email: string;
  username: string;
};

type AssistantPermissionsPayload = {
  teams_edit?: boolean;
  schedule_edit?: boolean;
  results_edit?: boolean;
  bracket_edit?: boolean;
  tournament_edit?: boolean;
};

type AssistantPermsResponse = {
  raw: Record<string, any>;
  effective: Record<string, any>;
};

/* =========================
   Narzędzia UI
   ========================= */

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // ignore
  }

  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "fixed";
    el.style.left = "-9999px";
    document.body.appendChild(el);
    el.focus();
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

function PermissionRow({ label, value }: { label: string; value: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        padding: "8px 0",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <span style={{ opacity: 0.92 }}>{label}</span>
      <span style={{ fontWeight: 800, color: value ? "#5fd38a" : "#d36a6a" }}>
        {value ? "TAK" : "NIE"}
      </span>
    </div>
  );
}

function Section({
  title,
  children,
  hint,
}: {
  title: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <section
      style={{
        marginTop: "1.25rem",
        padding: "1rem",
        border: "1px solid #333",
        borderRadius: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h3 style={{ marginTop: 0, marginBottom: 6 }}>{title}</h3>
        {hint ? <div style={{ opacity: 0.7, fontSize: "0.9rem" }}>{hint}</div> : null}
      </div>
      {children}
    </section>
  );
}

/* =========================
   Komponent
   ========================= */

export default function TournamentDetail() {
  const { id } = useParams<{ id: string }>();

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [loading, setLoading] = useState(true);

  const [loadError, setLoadError] = useState<string | null>(null);

  // Publiczny odczyt turnieju z kodem dostępu (jeśli wymagany)
  const [accessCode, setAccessCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);

  // ====== DRAFTY: Ustawienia (publikacja/kod/opis)
  const [isPublishedDraft, setIsPublishedDraft] = useState(false);
  const [accessCodeDraft, setAccessCodeDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");

  // status zapisu ustawień
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  // ====== DRAFTY: Dołączanie zawodników
  const [allowJoinByCodeDraft, setAllowJoinByCodeDraft] = useState(false);
  const [joinCodeDraft, setJoinCodeDraft] = useState("");
  const [participantsPreviewDraft, setParticipantsPreviewDraft] = useState(false);

  // Zmiana nazwy uczestników: wymagaj akceptacji (przeniesione do sekcji dołączania)
  const [renameRequiresApprovalDraft, setRenameRequiresApprovalDraft] = useState(false);

  // "Udostępniaj kod razem czy osobno" (dla link/QR/share) – osobno dla join i dla public share
  const [includeJoinCodeInLink, setIncludeJoinCodeInLink] = useState(true);
  const [includeShareCodeInLink, setIncludeShareCodeInLink] = useState(false);

  // status zapisu dołączania
  const [savingJoin, setSavingJoin] = useState(false);
  const [joinMsg, setJoinMsg] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  // QR refs
  const shareQrRef = useRef<HTMLCanvasElement | null>(null);
  const joinQrRef = useRef<HTMLCanvasElement | null>(null);

  // === Asystenci + uprawnienia (tylko organizer) ===
  const [assistants, setAssistants] = useState<AssistantListItem[]>([]);
  const [assistantDrafts, setAssistantDrafts] = useState<
    Record<number, Required<AssistantPermissionsPayload>>
  >({});
  const [assistantBusy, setAssistantBusy] = useState<Record<number, boolean>>({});
  const [assistantMsg, setAssistantMsg] = useState<Record<number, string | null>>({});

  const DESCRIPTION_MAX = 800;

  const isOrganizer = tournament?.my_role === "ORGANIZER";
  const isAssistant = tournament?.my_role === "ASSISTANT";
  const canManage = tournament?.my_role === "ORGANIZER" || tournament?.my_role === "ASSISTANT";

  const fetchTournament = () => {
    if (!id) return;

    setLoading(true);
    setLoadError(null);

    const url =
      `/api/tournaments/${id}/` + (accessCode ? `?code=${encodeURIComponent(accessCode)}` : "");

    apiFetch(url)
      .then(async (res) => {
        if (res.status === 403) {
          const data = await res.json().catch(() => ({}));
          if (data?.detail?.toLowerCase?.().includes("kod")) {
            setNeedsCode(true);
            throw new Error("Wymagany poprawny kod dostępu.");
          }
        }

        if (!res.ok) throw new Error("Brak dostępu do turnieju.");
        return res.json();
      })
      .then((data: Tournament) => {
        setTournament(data);

        // ====== ustawienia
        setIsPublishedDraft(Boolean(data.is_published));
        setAccessCodeDraft(data.access_code ?? "");
        setDescriptionDraft(data.description ?? "");

        // ====== dołączanie
        if (Object.prototype.hasOwnProperty.call(data, "allow_join_by_code")) {
          setAllowJoinByCodeDraft(Boolean((data as any).allow_join_by_code));
        } else {
          setAllowJoinByCodeDraft(false);
        }
        if (Object.prototype.hasOwnProperty.call(data, "join_code")) {
          setJoinCodeDraft(((data as any).join_code ?? "") as string);
        } else {
          setJoinCodeDraft("");
        }
        if (Object.prototype.hasOwnProperty.call(data, "participants_public_preview_enabled")) {
          setParticipantsPreviewDraft(Boolean((data as any).participants_public_preview_enabled));
        } else {
          setParticipantsPreviewDraft(false);
        }

        // ====== rename policy (defensywnie)
        if (Object.prototype.hasOwnProperty.call(data, "participants_self_rename_enabled")) {
          const enabled = Boolean((data as any).participants_self_rename_enabled);
          setRenameRequiresApprovalDraft(!enabled);
        } else if (Object.prototype.hasOwnProperty.call(data, "participants_self_rename_requires_approval")) {
          setRenameRequiresApprovalDraft(Boolean((data as any).participants_self_rename_requires_approval));
        } else if (Object.prototype.hasOwnProperty.call(data, "participants_self_rename_approval_required")) {
          setRenameRequiresApprovalDraft(Boolean((data as any).participants_self_rename_approval_required));
        } else {
          // brak pola -> domyślnie bez akceptacji
          setRenameRequiresApprovalDraft(false);
        }

        setNeedsCode(false);

        // czyścimy komunikaty po odświeżeniu
        setSettingsMsg(null);
        setSettingsError(null);
        setJoinMsg(null);
        setJoinError(null);
      })
      .catch((e) => setLoadError(e.message))
      .finally(() => setLoading(false));
  };

  const loadAssistants = async () => {
    if (!id) return;

    const res = await apiFetch(`/api/tournaments/${id}/assistants/`);
    if (!res.ok) {
      setAssistants([]);
      return;
    }
    const raw = await res.json().catch(() => []);
    const list: AssistantListItem[] = Array.isArray(raw)
      ? raw
      : Array.isArray((raw as any)?.results)
        ? (raw as any).results
        : [];
    setAssistants(list);
  };

  const loadAssistantPerms = async (userId: number) => {
    if (!id) return;

    setAssistantBusy((m) => ({ ...m, [userId]: true }));
    setAssistantMsg((m) => ({ ...m, [userId]: null }));

    try {
      const res = await apiFetch(`/api/tournaments/${id}/assistants/${userId}/permissions/`);
      if (!res.ok) throw new Error("Nie udało się pobrać uprawnień asystenta.");

      const data = (await res.json().catch(() => null)) as AssistantPermsResponse | null;
      const eff = data?.effective ?? {};

      const draft: Required<AssistantPermissionsPayload> = {
        teams_edit: Boolean(eff.teams_edit),
        schedule_edit: Boolean(eff.schedule_edit),
        results_edit: Boolean(eff.results_edit),
        bracket_edit: Boolean(eff.bracket_edit),
        tournament_edit: Boolean(eff.tournament_edit),
      };

      setAssistantDrafts((m) => ({ ...m, [userId]: draft }));
    } catch (e: any) {
      setAssistantMsg((m) => ({ ...m, [userId]: e?.message ?? "Błąd pobierania uprawnień." }));
    } finally {
      setAssistantBusy((m) => ({ ...m, [userId]: false }));
    }
  };

  const saveAssistantPerms = async (userId: number) => {
    if (!id) return;

    const draft = assistantDrafts[userId];
    if (!draft) return;

    setAssistantBusy((m) => ({ ...m, [userId]: true }));
    setAssistantMsg((m) => ({ ...m, [userId]: null }));

    try {
      const payload: AssistantPermissionsPayload = {
        teams_edit: draft.teams_edit,
        schedule_edit: draft.schedule_edit,
        results_edit: draft.results_edit,
        bracket_edit: draft.bracket_edit,
        tournament_edit: draft.tournament_edit,
      };

      const res = await apiFetch(`/api/tournaments/${id}/assistants/${userId}/permissions/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any)?.detail || "Nie udało się zapisać uprawnień.");

      const eff = (data as any)?.effective ?? {};
      const normalized: Required<AssistantPermissionsPayload> = {
        teams_edit: Boolean(eff.teams_edit),
        schedule_edit: Boolean(eff.schedule_edit),
        results_edit: Boolean(eff.results_edit),
        bracket_edit: Boolean(eff.bracket_edit),
        tournament_edit: Boolean(eff.tournament_edit),
      };
      setAssistantDrafts((m) => ({ ...m, [userId]: normalized }));
      setAssistantMsg((m) => ({ ...m, [userId]: "Zapisano." }));
    } catch (e: any) {
      setAssistantMsg((m) => ({ ...m, [userId]: e?.message ?? "Błąd zapisu." }));
    } finally {
      setAssistantBusy((m) => ({ ...m, [userId]: false }));
    }
  };

  const removeAssistant = async (userId: number) => {
    if (!id) return;

    setAssistantBusy((m) => ({ ...m, [userId]: true }));
    setAssistantMsg((m) => ({ ...m, [userId]: null }));

    try {
      const res = await apiFetch(`/api/tournaments/${id}/assistants/${userId}/remove/`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as any)?.detail || "Nie udało się usunąć asystenta.");
      }

      setAssistants((prev) => prev.filter((a) => a.user_id !== userId));
      setAssistantDrafts((m) => {
        const copy = { ...m };
        delete copy[userId];
        return copy;
      });
    } catch (e: any) {
      setAssistantMsg((m) => ({ ...m, [userId]: e?.message ?? "Błąd usuwania." }));
    } finally {
      setAssistantBusy((m) => ({ ...m, [userId]: false }));
    }
  };

  useEffect(() => {
    fetchTournament();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // po pobraniu turnieju, jeśli organizer -> ładuj asystentów
  useEffect(() => {
    if (!id) return;
    if (!isOrganizer) return;

    loadAssistants().catch(() => setAssistants([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isOrganizer]);

  // gdy zmienia się lista asystentów, dociągnij ich uprawnienia (tylko brakujące)
  useEffect(() => {
    if (!isOrganizer) return;

    for (const a of assistants) {
      if (!assistantDrafts[a.user_id]) {
        loadAssistantPerms(a.user_id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistants, isOrganizer]);

  const generateTournament = () => {
    if (!tournament) return;

    apiFetch(`/api/tournaments/${tournament.id}/generate/`, { method: "POST" })
      .then((res) => {
        if (!res.ok) throw new Error("Nie udało się wygenerować rozgrywek.");
        return res.json();
      })
      .then(() => {
        fetchTournament();
        alert("Rozgrywki zostały wygenerowane.");
      })
      .catch((e) => alert(e.message));
  };

  // helper: bezpiecznie nadpisuj stan turnieju nawet jeśli backend nie zwróci pól
  const applyPatchedTournament = (patch: Partial<Tournament>, responseBody: any) => {
    setTournament((prev) => {
      if (!prev) return prev;

      const merged = { ...prev, ...patch };

      if (responseBody && typeof responseBody === "object") {
        for (const k of Object.keys(responseBody)) {
          (merged as any)[k] = (responseBody as any)[k];
        }
      }

      return merged;
    });
  };

  /* =========================
     ZAPIS: Ustawienia
     ========================= */
  const saveSettings = async () => {
    if (!tournament) return;

    setSettingsMsg(null);
    setSettingsError(null);

    const normalizedCode = accessCodeDraft.trim();
    const normalizedDesc = descriptionDraft.trim();

    if (normalizedDesc.length > DESCRIPTION_MAX) {
      setSettingsError(`Opis jest za długi (max ${DESCRIPTION_MAX} znaków).`);
      return;
    }

    setSavingSettings(true);
    try {
      const payload: Partial<Tournament> = {
        is_published: isPublishedDraft,
        access_code: normalizedCode.length ? normalizedCode : null,
        description: normalizedDesc.length ? normalizedDesc : null,
      };

      const res = await apiFetch(`/api/tournaments/${tournament.id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any)?.detail || "Nie udało się zapisać ustawień.");

      applyPatchedTournament(payload, data);

      setIsPublishedDraft(
        Object.prototype.hasOwnProperty.call(data, "is_published")
          ? Boolean((data as any).is_published)
          : Boolean(payload.is_published)
      );
      setAccessCodeDraft(
        Object.prototype.hasOwnProperty.call(data, "access_code")
          ? ((data as any).access_code ?? "")
          : ((payload.access_code ?? "") as string)
      );
      setDescriptionDraft(
        Object.prototype.hasOwnProperty.call(data, "description")
          ? ((data as any).description ?? "")
          : ((payload.description ?? "") as string)
      );

      setSettingsMsg("Zapisano.");
    } catch (e: any) {
      setSettingsError(e?.message || "Błąd połączenia z serwerem.");
    } finally {
      setSavingSettings(false);
    }
  };

  /* =========================
     ZAPIS: Dołączanie zawodników (+ preview + rename approval)
     ========================= */
  const buildRenameApprovalPatch = (): Partial<Tournament> => {
    if (!tournament) return {};

    // jeśli backend ma participants_self_rename_enabled: true => samodzielnie, false => akceptacja
    if (Object.prototype.hasOwnProperty.call(tournament, "participants_self_rename_enabled")) {
      return { participants_self_rename_enabled: !renameRequiresApprovalDraft };
    }

    // jeśli backend ma pole "requires_approval" / "approval_required"
    if (Object.prototype.hasOwnProperty.call(tournament, "participants_self_rename_requires_approval")) {
      return { participants_self_rename_requires_approval: renameRequiresApprovalDraft };
    }
    if (Object.prototype.hasOwnProperty.call(tournament, "participants_self_rename_approval_required")) {
      return { participants_self_rename_approval_required: renameRequiresApprovalDraft };
    }

    // fallback: wysyłamy najbezpieczniejszy wariant (backend może go znać)
    return { participants_self_rename_requires_approval: renameRequiresApprovalDraft } as any;
  };

  const saveJoinAndParticipantSettings = async () => {
    if (!tournament) return;

    setJoinMsg(null);
    setJoinError(null);

    const normalizedJoinCode = joinCodeDraft.trim();

    if (allowJoinByCodeDraft && normalizedJoinCode.length < 3) {
      setJoinError("Dla dołączania przez kod wymagany jest kod (min. 3 znaki).");
      return;
    }

    setSavingJoin(true);
    try {
      const payload: Partial<Tournament> = {
        allow_join_by_code: allowJoinByCodeDraft,
        join_code: allowJoinByCodeDraft ? normalizedJoinCode : null,
        participants_public_preview_enabled: participantsPreviewDraft,
        ...buildRenameApprovalPatch(),
      };

      const res = await apiFetch(`/api/tournaments/${tournament.id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any)?.detail || "Nie udało się zapisać ustawień dołączania.");

      applyPatchedTournament(payload, data);

      // odśwież drafty wg odpowiedzi
      const nextAllow =
        Object.prototype.hasOwnProperty.call(data, "allow_join_by_code")
          ? Boolean((data as any).allow_join_by_code)
          : Boolean((payload as any).allow_join_by_code);

      const nextJoinCode =
        Object.prototype.hasOwnProperty.call(data, "join_code")
          ? ((data as any).join_code ?? "")
          : (((payload as any).join_code ?? "") as string);

      setAllowJoinByCodeDraft(nextAllow);
      setJoinCodeDraft(nextJoinCode);

      const nextPreview =
        Object.prototype.hasOwnProperty.call(data, "participants_public_preview_enabled")
          ? Boolean((data as any).participants_public_preview_enabled)
          : Boolean((payload as any).participants_public_preview_enabled);

      setParticipantsPreviewDraft(nextPreview);

      // rename policy - odczyt po zapisie
      if (Object.prototype.hasOwnProperty.call(data, "participants_self_rename_enabled")) {
        setRenameRequiresApprovalDraft(!Boolean((data as any).participants_self_rename_enabled));
      } else if (Object.prototype.hasOwnProperty.call(data, "participants_self_rename_requires_approval")) {
        setRenameRequiresApprovalDraft(Boolean((data as any).participants_self_rename_requires_approval));
      } else if (Object.prototype.hasOwnProperty.call(data, "participants_self_rename_approval_required")) {
        setRenameRequiresApprovalDraft(Boolean((data as any).participants_self_rename_approval_required));
      }

      setJoinMsg("Zapisano.");
    } catch (e: any) {
      setJoinError(e?.message || "Błąd połączenia z serwerem.");
    } finally {
      setSavingJoin(false);
    }
  };

  const clearAccessCode = () => setAccessCodeDraft("");
  const clearDescription = () => setDescriptionDraft("");
  const clearJoinCode = () => setJoinCodeDraft("");

  /* =========================
     Linki / QR / Share
     ========================= */

  const basePublicUrl = useMemo(() => {
    if (!tournament) return "";
    return new URL(`/tournaments/${tournament.id}`, window.location.origin).toString();
  }, [tournament]);

  const shareAccessCodeValue = useMemo(() => {
    // Używamy wartości z draft (bo user tego oczekuje w UI),
    // ale jeśli nie ma draftu -> fallback na turniej
    const v = (accessCodeDraft ?? tournament?.access_code ?? "").trim();
    return v.length ? v : "";
  }, [accessCodeDraft, tournament]);

  const shareUrl = useMemo(() => {
    if (!tournament) return "";
    const u = new URL(`/tournaments/${tournament.id}`, window.location.origin);

    if (includeShareCodeInLink) {
      const c = shareAccessCodeValue;
      if (c) u.searchParams.set("code", c);
    }

    return u.toString();
  }, [tournament, includeShareCodeInLink, shareAccessCodeValue]);

  const joinUrl = useMemo(() => {
    if (!tournament) return "";
    const u = new URL(`/tournaments/${tournament.id}`, window.location.origin);
    u.searchParams.set("join", "1");

    if (includeJoinCodeInLink) {
      const jc = (joinCodeDraft ?? tournament.join_code ?? "").trim();
      if (jc) u.searchParams.set("join_code", jc);
    }

    return u.toString();
  }, [tournament, includeJoinCodeInLink, joinCodeDraft]);

  const handleNativeShare = async (url: string, title?: string, text?: string) => {
    if (!url) return;

    const navAny = navigator as any;
    if (navAny?.share) {
      try {
        await navAny.share({
          title: title ?? tournament?.name ?? "Turniej",
          text: text ?? "Link",
          url,
        });
        return true;
      } catch {
        // anulowanie
      }
    }
    return false;
  };

  const downloadQrFromRef = (ref: React.RefObject<HTMLCanvasElement>, filename: string) => {
    const canvas = ref.current;
    if (!canvas) return false;

    try {
      const pngUrl = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = pngUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return true;
    } catch {
      return false;
    }
  };

  /* =========================
     Widoki dostępu (kod)
     ========================= */

  if (needsCode) {
    return (
      <div style={{ padding: "2rem" }}>
        <h2>Dostęp do turnieju</h2>
        <p>Ten turniej wymaga kodu dostępu.</p>
        <input
          type="text"
          placeholder="Kod dostępu"
          value={accessCode}
          onChange={(e) => setAccessCode(e.target.value)}
        />
        <button onClick={fetchTournament} style={{ marginLeft: 8 }}>
          Potwierdź
        </button>
        {loadError && <p style={{ color: "crimson" }}>{loadError}</p>}
      </div>
    );
  }

  if (loading) return <p>Ładowanie…</p>;

  if (!tournament) {
    return <p style={{ color: "crimson" }}>{loadError || "Nie udało się załadować turnieju."}</p>;
  }

  return (
    <div style={{ padding: "2rem", maxWidth: 980 }}>
      <h1 style={{ marginBottom: 6 }}>{tournament.name}</h1>

      {loadError && (
        <div
          style={{
            margin: "10px 0 16px",
            padding: "10px 12px",
            border: "1px solid rgba(255,0,0,0.35)",
            borderRadius: 10,
            color: "crimson",
          }}
        >
          {loadError}
        </div>
      )}

      <section
        style={{
          marginTop: 10,
          marginBottom: "1.25rem",
          padding: "0.9rem 1rem",
          border: "1px solid #333",
          borderRadius: 10,
          background: "rgba(255,255,255,0.03)",
        }}
      >
        <div style={{ fontWeight: 800, marginBottom: 6 }}>
          Krok 2: Ustawienia dostępu, asystenci, dołączanie i udostępnianie
        </div>
        <div style={{ opacity: 0.9, lineHeight: 1.5 }}>
          W tym kroku ustawiasz: publikację, kody, asystentów, dołączanie zawodników oraz sposób udostępniania linków/QR.
        </div>
      </section>

      <p>
        <strong>Dyscyplina:</strong> {tournament.discipline}
      </p>
      <p>
        <strong>Status:</strong> {tournament.status}
      </p>
      <p>
        <strong>Widoczność:</strong> {tournament.is_published ? "Opublikowany" : "Prywatny"}
        {tournament.access_code ? " (z kodem dostępu)" : ""}
      </p>

      <div style={{ marginTop: 10 }}>
        <Link to={`/tournaments/${tournament.id}`} style={{ color: "#9fd3ff" }}>
          Otwórz stronę publiczną turnieju
        </Link>
      </div>

      {/* 1) USTAWIENIA */}
      {isOrganizer && (
        <Section title="1) Ustawienia turnieju">
          <div style={{ marginTop: 6, padding: "12px", background: "rgba(255,255,255,0.05)", borderRadius: 10 }}>
            <div style={{ fontWeight: 800, marginBottom: 10 }}>Publikacja i dostęp dla widzów</div>

            <label style={{ display: "block", marginTop: 4 }}>
              <input
                type="checkbox"
                checked={isPublishedDraft}
                onChange={(e) => {
                  setIsPublishedDraft(e.target.checked);
                  setSettingsMsg(null);
                  setSettingsError(null);
                }}
              />{" "}
              Opublikuj turniej
            </label>

            <div style={{ marginTop: 14 }}>
              <label style={{ display: "block", marginBottom: 6 }}>Kod dostępu (dla widzów/podglądu)</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <input
                  type="text"
                  value={accessCodeDraft}
                  onChange={(e) => {
                    setAccessCodeDraft(e.target.value);
                    setSettingsMsg(null);
                    setSettingsError(null);
                  }}
                  placeholder="np. WIDZ123"
                  maxLength={20}
                />
                <button type="button" onClick={clearAccessCode}>
                  Wyczyść kod
                </button>
              </div>
              <div style={{ marginTop: 6, opacity: 0.75, fontSize: "0.9rem" }}>
                Jeśli ustawione, widzowie mogą otworzyć turniej również poprzez link z parametrem <code>?code=...</code>.
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <label style={{ display: "block", marginBottom: 6 }}>Opis turnieju (publiczny)</label>
              <textarea
                value={descriptionDraft}
                onChange={(e) => {
                  setDescriptionDraft(e.target.value);
                  setSettingsMsg(null);
                  setSettingsError(null);
                }}
                placeholder="Informacje organizacyjne, zasady..."
                rows={6}
                style={{ width: "min(680px, 100%)" }}
                maxLength={DESCRIPTION_MAX}
              />
              <div style={{ marginTop: 6, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <small style={{ opacity: 0.85 }}>
                  {descriptionDraft.trim().length}/{DESCRIPTION_MAX}
                </small>
                <button type="button" onClick={clearDescription}>
                  Wyczyść opis
                </button>
              </div>
            </div>

            {settingsError && <div style={{ color: "crimson", marginTop: 10 }}>{settingsError}</div>}
            {settingsMsg && <div style={{ color: "green", marginTop: 10 }}>{settingsMsg}</div>}

            <div style={{ marginTop: 14 }}>
              <button disabled={savingSettings} onClick={saveSettings}>
                {savingSettings ? "Zapisywanie…" : "Zapisz ustawienia"}
              </button>
            </div>
          </div>
        </Section>
      )}

      {/* 2) ASYSTENCI */}
      {canManage && (
        <Section title="2) Asystenci i uprawnienia">
          {/* Panel "Twoje uprawnienia" – tylko asystent */}
          {isAssistant && (
            <div style={{ marginTop: 6 }}>
              <p style={{ opacity: 0.9, marginTop: 0 }}>
                Jesteś asystentem – zakres uprawnień zależy od ustawień nadanych przez organizatora.
              </p>

              {tournament.my_permissions ? (
                <div style={{ marginTop: 10 }}>
                  <PermissionRow label="Edycja drużyn" value={!!tournament.my_permissions.teams_edit} />
                  <PermissionRow label="Edycja harmonogramu" value={!!tournament.my_permissions.schedule_edit} />
                  <PermissionRow label="Wprowadzanie wyników" value={!!tournament.my_permissions.results_edit} />
                  <PermissionRow label="Edycja drabinki" value={!!tournament.my_permissions.bracket_edit} />
                  <PermissionRow label="Edycja ustawień turnieju" value={!!tournament.my_permissions.tournament_edit} />

                  <div style={{ marginTop: 10, opacity: 0.75, fontSize: "0.9rem" }}>
                    Publikacja, archiwizacja, zarządzanie asystentami i ustawienia dołączania są zarezerwowane dla organizatora.
                  </div>
                </div>
              ) : (
                <p style={{ opacity: 0.75 }}>Brak danych o uprawnieniach (backend nie zwrócił my_permissions).</p>
              )}
            </div>
          )}

          {/* Edycja asystentów – tylko organizer */}
          {isOrganizer && (
            <div style={{ marginTop: 6 }}>
              <div style={{ marginTop: 10 }}>
                <AddAssistantForm
                  tournamentId={tournament.id}
                  onAdded={async () => {
                    await loadAssistants();
                  }}
                />
              </div>

              {assistants.length === 0 ? (
                <div style={{ marginTop: 12, opacity: 0.8 }}>Brak asystentów.</div>
              ) : (
                <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
                  {assistants.map((a) => {
                    const draft = assistantDrafts[a.user_id];
                    const busy = Boolean(assistantBusy[a.user_id]);
                    const msg = assistantMsg[a.user_id];

                    const setDraft = (patch: Partial<Required<AssistantPermissionsPayload>>) => {
                      setAssistantDrafts((m) => ({
                        ...m,
                        [a.user_id]: {
                          teams_edit: m[a.user_id]?.teams_edit ?? false,
                          schedule_edit: m[a.user_id]?.schedule_edit ?? false,
                          results_edit: m[a.user_id]?.results_edit ?? false,
                          bracket_edit: m[a.user_id]?.bracket_edit ?? false,
                          tournament_edit: m[a.user_id]?.tournament_edit ?? false,
                          ...patch,
                        },
                      }));
                    };

                    return (
                      <div
                        key={a.user_id}
                        style={{
                          border: "1px solid rgba(255,255,255,0.08)",
                          borderRadius: 12,
                          padding: "0.9rem 1rem",
                          background: "rgba(255,255,255,0.03)",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                          <div>
                            <div style={{ fontWeight: 800 }}>{a.username || a.email}</div>
                            <div style={{ opacity: 0.75, fontSize: "0.92rem" }}>{a.email}</div>
                          </div>

                          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                            <button type="button" onClick={() => saveAssistantPerms(a.user_id)} disabled={busy || !draft}>
                              {busy ? "…" : "Zapisz"}
                            </button>

                            <button type="button" onClick={() => loadAssistantPerms(a.user_id)} disabled={busy}>
                              Odśwież uprawnienia
                            </button>

                            <button type="button" onClick={() => removeAssistant(a.user_id)} disabled={busy}>
                              Usuń
                            </button>
                          </div>
                        </div>

                        <div style={{ marginTop: 12 }}>
                          <div style={{ fontWeight: 800, marginBottom: 8 }}>Uprawnienia asystenta</div>

                          {!draft ? (
                            <div style={{ opacity: 0.75 }}>Ładowanie…</div>
                          ) : (
                            <div style={{ display: "grid", gap: 8 }}>
                              {[
                                ["teams_edit", "Edycja drużyn"],
                                ["schedule_edit", "Edycja harmonogramu"],
                                ["results_edit", "Wprowadzanie wyników"],
                                ["bracket_edit", "Edycja drabinki"],
                                ["tournament_edit", "Edycja ustawień turnieju"],
                              ].map(([k, label]) => (
                                <label
                                  key={k}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: 12,
                                    padding: "8px 0",
                                    borderBottom: "1px solid rgba(255,255,255,0.06)",
                                  }}
                                >
                                  <span style={{ opacity: 0.92 }}>{label}</span>
                                  <input
                                    type="checkbox"
                                    checked={Boolean((draft as any)[k])}
                                    onChange={(e) => setDraft({ [k]: e.target.checked } as any)}
                                  />
                                </label>
                              ))}

                              <div style={{ marginTop: 8, opacity: 0.75, fontSize: "0.9rem" }}>
                                Nie obejmuje: publikacji, archiwizacji, zarządzania asystentami i ustawień dołączania.
                              </div>

                              {msg ? <div style={{ marginTop: 6, opacity: 0.9 }}>{msg}</div> : null}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </Section>
      )}

      {/* 3) DOŁĄCZANIE ZAWODNIKÓW */}
      {isOrganizer && (
        <Section title="3) Dołączanie zawodników">
          <div style={{ marginTop: 6, padding: "12px", background: "rgba(255,255,255,0.05)", borderRadius: 10 }}>
            <div style={{ fontWeight: 800, marginBottom: 10 }}>Ustawienia dołączania</div>

            <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                type="checkbox"
                checked={allowJoinByCodeDraft}
                onChange={(e) => {
                  setAllowJoinByCodeDraft(e.target.checked);
                  setJoinMsg(null);
                  setJoinError(null);
                }}
              />
              Zezwól uczestnikom dołączać przez konto i kod (join link + code)
            </label>

            <div style={{ marginTop: 8, opacity: 0.8, fontSize: "0.9rem" }}>
              Jeśli włączone, uczestnik po zalogowaniu podaje kod i uzupełnia swoje dane (np. nazwę drużyny).
            </div>

            {allowJoinByCodeDraft && (
              <>
                <div style={{ marginTop: 12 }}>
                  <label style={{ display: "block", fontSize: "0.85rem", marginBottom: 4 }}>
                    Kod dołączania (dla uczestników)
                  </label>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <input
                      type="text"
                      value={joinCodeDraft}
                      onChange={(e) => {
                        setJoinCodeDraft(e.target.value);
                        setJoinMsg(null);
                        setJoinError(null);
                      }}
                      placeholder="np. START2024"
                      maxLength={32}
                      style={{ padding: "0.55rem", width: "260px" }}
                    />
                    <button type="button" onClick={clearJoinCode}>
                      Wyczyść kod
                    </button>
                  </div>
                  <div style={{ marginTop: 6, opacity: 0.75, fontSize: "0.9rem" }}>Minimalnie 3 znaki.</div>
                </div>

                <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                  <div style={{ fontWeight: 800, marginBottom: 8 }}>Zmiana nazwy uczestników</div>
                  <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <input
                      type="checkbox"
                      checked={renameRequiresApprovalDraft}
                      onChange={(e) => {
                        setRenameRequiresApprovalDraft(e.target.checked);
                        setJoinMsg(null);
                        setJoinError(null);
                      }}
                    />
                    Wymagaj akceptacji zmiany nazwy (zamiast samodzielnej zmiany przez uczestnika)
                  </label>
                  <div style={{ marginTop: 6, opacity: 0.8, fontSize: "0.9rem" }}>
                    Gdy włączone, uczestnik w TournamentPublic wyśle prośbę o zmianę nazwy, a organizator/asystent ją zaakceptuje.
                  </div>
                </div>

                <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                  <div style={{ fontWeight: 800, marginBottom: 8 }}>Podgląd przed publikacją</div>

                  <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <input
                      type="checkbox"
                      checked={participantsPreviewDraft}
                      onChange={(e) => {
                        setParticipantsPreviewDraft(e.target.checked);
                        setJoinMsg(null);
                        setJoinError(null);
                      }}
                    />
                    Zezwól uczestnikom na podgląd TournamentPublic przed publikacją turnieju
                  </label>

                  <div style={{ marginTop: 6, opacity: 0.8, fontSize: "0.9rem" }}>
                    Jeśli wyłączone, uczestnicy (nawet zapisani) nie zobaczą meczów / tabeli / harmonogramu w widoku publicznym dopóki nie opublikujesz turnieju.
                  </div>
                </div>

                <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                  <div style={{ fontWeight: 800, marginBottom: 8 }}>Link / QR do dołączania</div>

                  <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
                    <input
                      type="checkbox"
                      checked={includeJoinCodeInLink}
                      onChange={(e) => setIncludeJoinCodeInLink(e.target.checked)}
                    />
                    Udostępniaj kod razem czy osobno (jeśli zaznaczone – kod będzie w linku i w QR)
                  </label>

                  <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
                    <button
                      type="button"
                      onClick={async () => {
                        const ok = await copyToClipboard(joinUrl);
                        setJoinMsg(ok ? "Link do dołączania został skopiowany." : "Nie udało się skopiować linku.");
                      }}
                    >
                      Kopiuj link
                    </button>

                    <button
                      type="button"
                      onClick={async () => {
                        const shared = await handleNativeShare(
                          joinUrl,
                          tournament.name,
                          "Link do dołączania do turnieju"
                        );
                        if (!shared) {
                          const ok = await copyToClipboard(joinUrl);
                          setJoinMsg(ok ? "Link do dołączania został skopiowany." : "Nie udało się skopiować linku.");
                        }
                      }}
                    >
                      Udostępnij
                    </button>
                  </div>

                  <div style={{ marginTop: "0.75rem", wordBreak: "break-all", opacity: 0.9 }}>
                    <small>{joinUrl}</small>
                  </div>

                  <div style={{ marginTop: "1rem", display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ padding: 8, background: "white", borderRadius: 6 }}>
                      <QRCodeCanvas value={joinUrl} size={180} includeMargin ref={joinQrRef} />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const ok = downloadQrFromRef(joinQrRef, `tournament-${tournament.id}-join.png`);
                        setJoinMsg(ok ? "Kod QR (dołączanie) pobrany jako PNG." : "Nie udało się pobrać QR.");
                      }}
                    >
                      Pobierz kod QR (PNG)
                    </button>
                  </div>
                </div>
              </>
            )}

            {!allowJoinByCodeDraft && (
              <div style={{ marginTop: 12, opacity: 0.75 }}>
                Dołączanie po link + kod jest wyłączone, więc link/QR do dołączania nie mają zastosowania.
              </div>
            )}

            {joinError && <div style={{ color: "crimson", marginTop: 10 }}>{joinError}</div>}
            {joinMsg && <div style={{ color: "green", marginTop: 10 }}>{joinMsg}</div>}

            <div style={{ marginTop: 14 }}>
              <button disabled={savingJoin} onClick={saveJoinAndParticipantSettings}>
                {savingJoin ? "Zapisywanie…" : "Zapisz (dołączanie zawodników)"}
              </button>
            </div>
          </div>
        </Section>
      )}

      {/* 4) UDOSTĘPNIANIE */}
      {canManage && (
        <Section
          title="4) Udostępnianie"
          hint={tournament.is_published ? "Turniej opublikowany" : "Turniej prywatny"}
        >
          {!tournament.is_published && (
            <p style={{ color: "#c9a227", marginTop: 0 }}>
              Turniej jest prywatny. Link/QR dla widzów ma sens głównie po publikacji (lub gdy używasz kodu dostępu).
            </p>
          )}

          <div style={{ marginTop: 6, opacity: 0.9 }}>
            <strong>Kod dostępu:</strong>{" "}
            {tournament.access_code ? tournament.access_code : <span style={{ opacity: 0.7 }}>brak</span>}
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
            <input
              type="checkbox"
              checked={includeShareCodeInLink}
              onChange={(e) => setIncludeShareCodeInLink(e.target.checked)}
              disabled={!shareAccessCodeValue}
            />
            Udostępniaj kod razem czy osobno (jeśli zaznaczone – kod będzie w linku i w QR)
          </label>
          {!shareAccessCodeValue && (
            <div style={{ marginTop: 6, opacity: 0.75, fontSize: "0.9rem" }}>
              Aby dołączać kod do linku/QR, ustaw kod dostępu w sekcji „Ustawienia”.
            </div>
          )}

          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
            <button
              type="button"
              onClick={async () => {
                const ok = await copyToClipboard(shareUrl);
                setSettingsMsg(ok ? "Link został skopiowany do schowka." : "Nie udało się skopiować linku.");
              }}
            >
              Kopiuj link
            </button>

            <button
              type="button"
              onClick={async () => {
                const shared = await handleNativeShare(shareUrl, tournament.name, "Link do turnieju");
                if (!shared) {
                  const ok = await copyToClipboard(shareUrl);
                  setSettingsMsg(ok ? "Link został skopiowany do schowka." : "Nie udało się skopiować linku.");
                }
              }}
            >
              Udostępnij
            </button>
          </div>

          <div style={{ marginTop: "0.75rem", wordBreak: "break-all", opacity: 0.9 }}>
            <small>{shareUrl}</small>
          </div>

          <div style={{ marginTop: "1rem", display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ padding: 8, background: "white", borderRadius: 6 }}>
              <QRCodeCanvas value={shareUrl} size={180} includeMargin ref={shareQrRef} />
            </div>
            <button
              type="button"
              onClick={() => {
                const ok = downloadQrFromRef(shareQrRef, `tournament-${tournament.id}-share.png`);
                setSettingsMsg(ok ? "Kod QR pobrany jako PNG." : "Nie udało się pobrać QR.");
              }}
            >
              Pobierz kod QR (PNG)
            </button>
          </div>

          {settingsMsg && <div style={{ marginTop: 10, color: "green" }}>{settingsMsg}</div>}
        </Section>
      )}

      {canManage && tournament.status === "DRAFT" && (
        <div style={{ marginTop: "1rem" }}>
          <button onClick={generateTournament}>Generuj rozgrywki</button>
        </div>
      )}
    </div>
  );
}
