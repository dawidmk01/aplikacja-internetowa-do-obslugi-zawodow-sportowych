// frontend/src/pages/TournamentDetail.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { QRCodeCanvas } from "qrcode.react";
import {
  CheckCircle2,
  Copy,
  Download,
  Info,
  Link as LinkIcon,
  QrCode,
  Send,
  Settings,
  Shield,
  Users,
  X,
  AlertTriangle,
  PlayCircle,
} from "lucide-react";

import { apiFetch } from "../api";
import AddAssistantForm from "../components/AddAssistantForm";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Input } from "../ui/Input";
import { cn } from "../lib/cn";

/* =========================
   Typy danych
   ========================= */

type MyPermissions = {
  teams_edit: boolean;
  schedule_edit: boolean;
  results_edit: boolean;
  bracket_edit: boolean;
  tournament_edit: boolean;

  roster_edit: boolean;
  name_change_approve: boolean;

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

  allow_join_by_code?: boolean;
  join_code?: string | null;

  participants_public_preview_enabled?: boolean;

  participants_self_rename_enabled?: boolean;
  participants_self_rename_requires_approval?: boolean;
  participants_self_rename_approval_required?: boolean;

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
  roster_edit?: boolean;
  name_change_approve?: boolean;
};

type AssistantPermsResponse = {
  raw: Record<string, any>;
  effective: Record<string, any>;
};

/* =========================
   Helpers
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

function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "success" | "warning";
}) {
  const cls =
    tone === "success"
      ? "bg-emerald-500/15 text-emerald-200 border-emerald-500/20"
      : tone === "warning"
        ? "bg-amber-500/15 text-amber-200 border-amber-500/20"
        : "bg-white/10 text-slate-200 border-white/10";
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold", cls)}>
      {children}
    </span>
  );
}

function SwitchRow({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/10 py-3">
      <div>
        <div className="text-sm font-semibold text-slate-100">{label}</div>
        {description ? <div className="mt-1 text-xs text-slate-300/80">{description}</div> : null}
      </div>
      <label className={cn("relative inline-flex cursor-pointer select-none items-center", disabled && "opacity-60")}>
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
        />
        <div className="h-6 w-11 rounded-full border border-white/10 bg-white/10 peer-checked:bg-white/25" />
        <div className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white/80 transition peer-checked:translate-x-5" />
      </label>
    </div>
  );
}

function KeyValue({
  k,
  v,
}: {
  k: string;
  v: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/10 py-2 text-sm">
      <span className="text-slate-300/90">{k}</span>
      <span className="font-semibold text-slate-100">{v}</span>
    </div>
  );
}

type ToastKind = "success" | "error" | "info";

function Toast({
  open,
  kind,
  text,
  onClose,
}: {
  open: boolean;
  kind: ToastKind;
  text: string;
  onClose: () => void;
}) {
  if (!open) return null;

  const Icon = kind === "success" ? CheckCircle2 : kind === "error" ? AlertTriangle : Info;
  const left =
    kind === "success" ? "border-emerald-400/30" : kind === "error" ? "border-rose-400/30" : "border-sky-400/30";
  const bg =
    kind === "success" ? "bg-emerald-500/10" : kind === "error" ? "bg-rose-500/10" : "bg-sky-500/10";
  const ic =
    kind === "success" ? "text-emerald-200" : kind === "error" ? "text-rose-200" : "text-sky-200";

  return (
    <div className="fixed bottom-6 right-6 z-[200] w-[min(420px,calc(100vw-2rem))]">
      <div className={cn("rounded-2xl border border-white/10 backdrop-blur", bg, "shadow-lg")}>
        <div className={cn("flex items-start gap-3 border-l-4 p-4", left)}>
          <Icon className={cn("mt-0.5 h-5 w-5", ic)} />
          <div className="flex-1 text-sm text-slate-100">{text}</div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-200/80 hover:bg-white/10 hover:text-slate-100"
            aria-label="Zamknij"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/* =========================
   Zakładki / układ
   ========================= */

type TabKey = "overview" | "access" | "join" | "assistants" | "share" | "permissions" | "dev";

const TABS: Array<{
  key: TabKey;
  label: string;
  icon: React.ReactNode;
  organizerOnly?: boolean;
  manageOnly?: boolean; // organizer lub assistant
}> = [
  { key: "overview", label: "Podsumowanie", icon: <Info className="h-4 w-4" /> },
  { key: "access", label: "Dostęp i opis", icon: <Settings className="h-4 w-4" />, organizerOnly: true },
  { key: "join", label: "Dołączanie", icon: <Users className="h-4 w-4" />, organizerOnly: true },
  { key: "assistants", label: "Asystenci", icon: <Shield className="h-4 w-4" />, manageOnly: true },
  { key: "share", label: "Udostępnianie", icon: <QrCode className="h-4 w-4" />, manageOnly: true },
  { key: "permissions", label: "Twoje uprawnienia", icon: <Shield className="h-4 w-4" />, manageOnly: true },
  { key: "dev", label: "Narzędzia", icon: <PlayCircle className="h-4 w-4" />, organizerOnly: true },
];

export default function TournamentDetail() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // dostęp z kodem (jeśli wymagany)
  const [accessCode, setAccessCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);

  // drafty: publikacja/kod/opis
  const [isPublishedDraft, setIsPublishedDraft] = useState(false);
  const [accessCodeDraft, setAccessCodeDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");

  // drafty: dołączanie
  const [allowJoinByCodeDraft, setAllowJoinByCodeDraft] = useState(false);
  const [joinCodeDraft, setJoinCodeDraft] = useState("");
  const [participantsPreviewDraft, setParticipantsPreviewDraft] = useState(false);
  const [renameRequiresApprovalDraft, setRenameRequiresApprovalDraft] = useState(false);

  // “kod w linku/QR”
  const [includeJoinCodeInLink, setIncludeJoinCodeInLink] = useState(true);
  const [includeShareCodeInLink, setIncludeShareCodeInLink] = useState(false);

  // busy flags
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingJoin, setSavingJoin] = useState(false);

  // toast (globalny)
  const [toastOpen, setToastOpen] = useState(false);
  const [toastKind, setToastKind] = useState<ToastKind>("info");
  const [toastText, setToastText] = useState("");

  const toast = (kind: ToastKind, text: string) => {
    setToastKind(kind);
    setToastText(text);
    setToastOpen(true);
    // auto-hide
    window.setTimeout(() => setToastOpen(false), 2600);
  };

  // QR refs
  const shareQrRef = useRef<HTMLCanvasElement | null>(null);
  const joinQrRef = useRef<HTMLCanvasElement | null>(null);

  // assistants
  const [assistants, setAssistants] = useState<AssistantListItem[]>([]);
  const [assistantDrafts, setAssistantDrafts] = useState<Record<number, Required<AssistantPermissionsPayload>>>({});
  const [assistantBusy, setAssistantBusy] = useState<Record<number, boolean>>({});
  const [assistantMsg, setAssistantMsg] = useState<Record<number, string | null>>({});

  const DESCRIPTION_MAX = 800;

  const isOrganizer = tournament?.my_role === "ORGANIZER";
  const isAssistant = tournament?.my_role === "ASSISTANT";
  const canManage = tournament?.my_role === "ORGANIZER" || tournament?.my_role === "ASSISTANT";

  const activeTab = (searchParams.get("tab") as TabKey | null) ?? "overview";
  const setTab = (k: TabKey) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", k);
    setSearchParams(next, { replace: true });
  };

  const allowedTabs = useMemo(() => {
    return TABS.filter((t) => {
      if (t.organizerOnly && !isOrganizer) return false;
      if (t.manageOnly && !canManage) return false;
      return true;
    });
  }, [isOrganizer, canManage]);

  useEffect(() => {
    // jeśli aktywna zakładka nie jest dozwolona -> przestaw
    if (!allowedTabs.some((t) => t.key === activeTab)) {
      setTab(allowedTabs[0]?.key ?? "overview");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedTabs.length, isOrganizer, canManage]);

  const fetchTournament = () => {
    if (!id) return;

    setLoading(true);
    setLoadError(null);

    const url = `/api/tournaments/${id}/` + (accessCode ? `?code=${encodeURIComponent(accessCode)}` : "");

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

        // ustawienia
        setIsPublishedDraft(Boolean(data.is_published));
        setAccessCodeDraft(data.access_code ?? "");
        setDescriptionDraft(data.description ?? "");

        // dołączanie
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

        // rename policy
        if (Object.prototype.hasOwnProperty.call(data, "participants_self_rename_enabled")) {
          const enabled = Boolean((data as any).participants_self_rename_enabled);
          setRenameRequiresApprovalDraft(!enabled);
        } else if (Object.prototype.hasOwnProperty.call(data, "participants_self_rename_requires_approval")) {
          setRenameRequiresApprovalDraft(Boolean((data as any).participants_self_rename_requires_approval));
        } else if (Object.prototype.hasOwnProperty.call(data, "participants_self_rename_approval_required")) {
          setRenameRequiresApprovalDraft(Boolean((data as any).participants_self_rename_approval_required));
        } else {
          setRenameRequiresApprovalDraft(false);
        }

        setNeedsCode(false);
      })
      .catch((e) => setLoadError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchTournament();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const loadAssistants = async () => {
    if (!id) return;
    const res = await apiFetch(`/api/tournaments/${id}/assistants/`);
    if (!res.ok) {
      setAssistants([]);
      return;
    }
    const raw = await res.json().catch(() => []);
    const list: AssistantListItem[] = Array.isArray(raw) ? raw : Array.isArray((raw as any)?.results) ? (raw as any).results : [];
    setAssistants(list);
  };

  useEffect(() => {
    if (!id) return;
    if (!isOrganizer) return;
    loadAssistants().catch(() => setAssistants([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isOrganizer]);

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
        roster_edit: Boolean(eff.roster_edit),
        name_change_approve: Boolean(eff.name_change_approve),
      };

      setAssistantDrafts((m) => ({ ...m, [userId]: draft }));
    } catch (e: any) {
      setAssistantMsg((m) => ({ ...m, [userId]: e?.message ?? "Błąd pobierania uprawnień." }));
    } finally {
      setAssistantBusy((m) => ({ ...m, [userId]: false }));
    }
  };

  // Organizer: auto-load perms for new assistants
  useEffect(() => {
    if (!isOrganizer) return;
    for (const a of assistants) {
      if (!assistantDrafts[a.user_id]) {
        loadAssistantPerms(a.user_id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistants, isOrganizer]);

  const saveAssistantPerms = async (userId: number) => {
    if (!id) return;
    const draft = assistantDrafts[userId];
    if (!draft) return;

    setAssistantBusy((m) => ({ ...m, [userId]: true }));
    setAssistantMsg((m) => ({ ...m, [userId]: null }));

    try {
      const payload: AssistantPermissionsPayload = { ...draft };
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
        roster_edit: Boolean(eff.roster_edit),
        name_change_approve: Boolean(eff.name_change_approve),
      };
      setAssistantDrafts((m) => ({ ...m, [userId]: normalized }));
      setAssistantMsg((m) => ({ ...m, [userId]: "Zapisano." }));
      toast("success", "Uprawnienia asystenta zapisane.");
    } catch (e: any) {
      setAssistantMsg((m) => ({ ...m, [userId]: e?.message ?? "Błąd zapisu." }));
      toast("error", e?.message ?? "Błąd zapisu uprawnień.");
    } finally {
      setAssistantBusy((m) => ({ ...m, [userId]: false }));
    }
  };

  const removeAssistant = async (userId: number) => {
    if (!id) return;

    setAssistantBusy((m) => ({ ...m, [userId]: true }));
    setAssistantMsg((m) => ({ ...m, [userId]: null }));

    try {
      const res = await apiFetch(`/api/tournaments/${id}/assistants/${userId}/remove/`, { method: "DELETE" });
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
      toast("success", "Asystent usunięty.");
    } catch (e: any) {
      setAssistantMsg((m) => ({ ...m, [userId]: e?.message ?? "Błąd usuwania." }));
      toast("error", e?.message ?? "Błąd usuwania asystenta.");
    } finally {
      setAssistantBusy((m) => ({ ...m, [userId]: false }));
    }
  };

  /**
   * ASSISTANT: dociągnij effective perms
   */
  useEffect(() => {
    if (!id) return;
    if (!tournament) return;
    if (tournament.my_role !== "ASSISTANT") return;

    let cancelled = false;

    (async () => {
      try {
        const meRes = await apiFetch("/api/auth/me/");
        const me = await meRes.json().catch(() => null);
        if (!meRes.ok || !me) return;

        const myUserId = (me as any).id ?? (me as any).user_id ?? (me as any).pk ?? null;
        if (!myUserId) return;

        const pRes = await apiFetch(`/api/tournaments/${id}/assistants/${myUserId}/permissions/`);
        const pdata = await pRes.json().catch(() => null);
        if (!pRes.ok || !pdata) return;

        const eff = (pdata as any).effective ?? pdata ?? {};
        if (cancelled) return;

        setTournament((prev) => {
          if (!prev) return prev;

          const prevPerms = prev.my_permissions ?? ({} as MyPermissions);
          const mergedPerms: MyPermissions = {
            teams_edit: Boolean((prevPerms as any).teams_edit),
            schedule_edit: Boolean((prevPerms as any).schedule_edit),
            results_edit: Boolean((prevPerms as any).results_edit),
            bracket_edit: Boolean((prevPerms as any).bracket_edit),
            tournament_edit: Boolean((prevPerms as any).tournament_edit),

            roster_edit: Boolean(eff.roster_edit),
            name_change_approve: Boolean(eff.name_change_approve),

            publish: Boolean(eff.publish),
            archive: Boolean(eff.archive),
            manage_assistants: Boolean(eff.manage_assistants),
            join_settings: Boolean(eff.join_settings),
          };

          return { ...prev, my_permissions: mergedPerms };
        });
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, tournament?.my_role, tournament?.id]);

  const applyPatchedTournament = (patch: Partial<Tournament>, responseBody: any) => {
    setTournament((prev) => {
      if (!prev) return prev;
      const merged = { ...prev, ...patch };
      if (responseBody && typeof responseBody === "object") {
        for (const k of Object.keys(responseBody)) (merged as any)[k] = (responseBody as any)[k];
      }
      return merged;
    });
  };

  /* =========================
     SAVE: Access & description
     ========================= */

  const saveSettings = async () => {
    if (!tournament) return;

    const normalizedCode = accessCodeDraft.trim();
    const normalizedDesc = descriptionDraft.trim();

    if (normalizedDesc.length > DESCRIPTION_MAX) {
      toast("error", `Opis jest za długi (max ${DESCRIPTION_MAX} znaków).`);
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

      toast("success", "Ustawienia zapisane.");
    } catch (e: any) {
      toast("error", e?.message || "Błąd połączenia z serwerem.");
    } finally {
      setSavingSettings(false);
    }
  };

  /* =========================
     SAVE: Join settings
     ========================= */

  const buildRenameApprovalPatch = (): Partial<Tournament> => {
    if (!tournament) return {};

    if (Object.prototype.hasOwnProperty.call(tournament, "participants_self_rename_enabled")) {
      return { participants_self_rename_enabled: !renameRequiresApprovalDraft };
    }
    if (Object.prototype.hasOwnProperty.call(tournament, "participants_self_rename_requires_approval")) {
      return { participants_self_rename_requires_approval: renameRequiresApprovalDraft };
    }
    if (Object.prototype.hasOwnProperty.call(tournament, "participants_self_rename_approval_required")) {
      return { participants_self_rename_approval_required: renameRequiresApprovalDraft };
    }
    return { participants_self_rename_requires_approval: renameRequiresApprovalDraft } as any;
  };

  const saveJoinAndParticipantSettings = async () => {
    if (!tournament) return;

    const normalizedJoinCode = joinCodeDraft.trim();
    if (allowJoinByCodeDraft && normalizedJoinCode.length < 3) {
      toast("error", "Dla dołączania przez kod wymagany jest kod (min. 3 znaki).");
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

      if (Object.prototype.hasOwnProperty.call(data, "participants_self_rename_enabled")) {
        setRenameRequiresApprovalDraft(!Boolean((data as any).participants_self_rename_enabled));
      } else if (Object.prototype.hasOwnProperty.call(data, "participants_self_rename_requires_approval")) {
        setRenameRequiresApprovalDraft(Boolean((data as any).participants_self_rename_requires_approval));
      } else if (Object.prototype.hasOwnProperty.call(data, "participants_self_rename_approval_required")) {
        setRenameRequiresApprovalDraft(Boolean((data as any).participants_self_rename_approval_required));
      }

      toast("success", "Ustawienia dołączania zapisane.");
    } catch (e: any) {
      toast("error", e?.message || "Błąd połączenia z serwerem.");
    } finally {
      setSavingJoin(false);
    }
  };

  /* =========================
     Linki / QR / Share
     ========================= */

  const basePublicUrl = useMemo(() => {
    if (!tournament) return "";
    return new URL(`/tournaments/${tournament.id}`, window.location.origin).toString();
  }, [tournament]);

  const shareAccessCodeValue = useMemo(() => {
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
    if (!url) return false;
    const navAny = navigator as any;
    if (navAny?.share) {
      try {
        await navAny.share({ title: title ?? tournament?.name ?? "Turniej", text: text ?? "Link", url });
        return true;
      } catch {
        // cancel
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
     DEV: generate
     ========================= */

  const generateTournament = () => {
    if (!tournament) return;

    apiFetch(`/api/tournaments/${tournament.id}/generate/`, { method: "POST" })
      .then((res) => {
        if (!res.ok) throw new Error("Nie udało się wygenerować rozgrywek.");
        return res.json();
      })
      .then(() => {
        fetchTournament();
        toast("success", "Rozgrywki wygenerowane.");
      })
      .catch((e) => toast("error", e.message));
  };

  /* =========================
     Widoki dostępu (kod)
     ========================= */

  if (needsCode) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <Card className="p-6">
          <div className="text-lg font-extrabold text-slate-100">Dostęp do turnieju</div>
          <div className="mt-2 text-sm text-slate-300/90">Ten turniej wymaga kodu dostępu.</div>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Input
              value={accessCode}
              onChange={(e) => setAccessCode(e.target.value)}
              placeholder="Kod dostępu"
              className="max-w-xs"
            />
            <Button
              variant="primary"
              onClick={() => fetchTournament()}
              leftIcon={<Shield className="h-4 w-4" />}
            >
              Potwierdź
            </Button>
          </div>

          {loadError ? (
            <div className="mt-4 rounded-xl border border-rose-400/25 bg-rose-500/10 p-3 text-sm text-rose-200">
              {loadError}
            </div>
          ) : null}
        </Card>
      </div>
    );
  }

  if (loading) return <div className="px-4 py-8 text-slate-200">Ładowanie…</div>;

  if (!tournament) {
    return (
      <div className="px-4 py-8">
        <div className="rounded-xl border border-rose-400/25 bg-rose-500/10 p-4 text-rose-200">
          {loadError || "Nie udało się załadować turnieju."}
        </div>
      </div>
    );
  }

  const headerStatusTone =
    tournament.status === "FINISHED" ? "success" : tournament.status === "DRAFT" ? "warning" : "neutral";

  /* =========================
     Renderers per tab
     ========================= */

  const OverviewTab = () => (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xl font-extrabold text-slate-100">{tournament.name}</div>
            <div className="mt-1 text-sm text-slate-300/90">
              Panel zarządzania: dostęp, asystenci, dołączanie i udostępnianie.
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge>{tournament.discipline}</Badge>
            <Badge>{tournament.tournament_format}</Badge>
            <Badge tone={headerStatusTone}>{tournament.status}</Badge>
            <Badge tone={tournament.is_published ? "success" : "warning"}>
              {tournament.is_published ? "Opublikowany" : "Prywatny"}
            </Badge>
            {tournament.access_code ? <Badge>Kod: {tournament.access_code}</Badge> : null}
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="text-sm font-extrabold text-slate-100">Skróty</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link to={`/tournaments/${tournament.id}`} className="inline-flex">
                <Button variant="secondary" leftIcon={<LinkIcon className="h-4 w-4" />}>
                  Otwórz publiczny widok
                </Button>
              </Link>
              <Button
                variant="ghost"
                leftIcon={<Copy className="h-4 w-4" />}
                onClick={async () => {
                  const ok = await copyToClipboard(basePublicUrl);
                  toast(ok ? "success" : "error", ok ? "Skopiowano link publiczny." : "Nie udało się skopiować linku.");
                }}
              >
                Kopiuj link
              </Button>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="text-sm font-extrabold text-slate-100">Informacje</div>
            <div className="mt-2 text-xs text-slate-300/90">
              Najczęściej używane akcje są w zakładkach: <b>Dostęp i opis</b>, <b>Dołączanie</b>, <b>Udostępnianie</b>.
            </div>
            <div className="mt-3 text-xs text-slate-300/70">
              Rola: <b>{tournament.my_role ?? "brak"}</b>
            </div>
          </div>
        </div>
      </Card>

      {loadError ? (
        <Card className="p-4">
          <div className="rounded-xl border border-rose-400/25 bg-rose-500/10 p-3 text-sm text-rose-200">
            {loadError}
          </div>
        </Card>
      ) : null}
    </div>
  );

  const AccessTab = () => (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-base font-extrabold text-slate-100">Dostęp i opis</div>
            <div className="mt-1 text-sm text-slate-300/90">
              Publikacja + kod dla widzów + opis widoczny w publicznym widoku.
            </div>
          </div>

          <Button
            variant="primary"
            leftIcon={<SaveIcon />}
            onClick={saveSettings}
            disabled={savingSettings}
          >
            {savingSettings ? "Zapisywanie…" : "Zapisz"}
          </Button>
        </div>

        <div className="mt-5 space-y-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <SwitchRow
              label="Opublikuj turniej"
              description="Gdy wyłączone, widok publiczny ma sens głównie z kodem dostępu lub w trybie podglądu uczestników."
              checked={isPublishedDraft}
              onChange={(v) => setIsPublishedDraft(v)}
              disabled={savingSettings}
            />

            <div className="mt-4">
              <div className="mb-2 text-xs font-semibold text-slate-300">Kod dostępu (dla widzów / link ?code=...)</div>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={accessCodeDraft}
                  onChange={(e) => setAccessCodeDraft(e.target.value)}
                  placeholder="np. WIDZ123"
                  maxLength={20}
                  className="max-w-xs"
                  disabled={savingSettings}
                />
                <Button
                  variant="ghost"
                  leftIcon={<X className="h-4 w-4" />}
                  onClick={() => setAccessCodeDraft("")}
                  disabled={savingSettings}
                >
                  Wyczyść
                </Button>
              </div>
              <div className="mt-2 text-xs text-slate-300/70">
                Jeśli ustawisz kod, możesz go dopinać do linków/QR w zakładce „Udostępnianie”.
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="mb-2 text-xs font-semibold text-slate-300">Opis turnieju (publiczny)</div>
            <textarea
              value={descriptionDraft}
              onChange={(e) => setDescriptionDraft(e.target.value)}
              placeholder="Informacje organizacyjne, zasady..."
              rows={7}
              maxLength={DESCRIPTION_MAX}
              disabled={savingSettings}
              className={cn(
                "w-full rounded-2xl border border-white/10 bg-white/[0.06] p-3 text-sm text-slate-100",
                "placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/10"
              )}
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300/70">
              <span>
                {descriptionDraft.trim().length}/{DESCRIPTION_MAX}
              </span>
              <button
                type="button"
                className="rounded-lg px-2 py-1 hover:bg-white/10"
                onClick={() => setDescriptionDraft("")}
                disabled={savingSettings}
              >
                Wyczyść
              </button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );

  const JoinTab = () => (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-base font-extrabold text-slate-100">Dołączanie zawodników</div>
            <div className="mt-1 text-sm text-slate-300/90">
              Uczestnik loguje się → podaje kod → uzupełnia nazwę / dane. Dodatkowo możesz włączyć podgląd przed publikacją.
            </div>
          </div>

          <Button variant="primary" leftIcon={<SaveIcon />} onClick={saveJoinAndParticipantSettings} disabled={savingJoin}>
            {savingJoin ? "Zapisywanie…" : "Zapisz"}
          </Button>
        </div>

        <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <SwitchRow
            label="Zezwól dołączać przez konto i kod"
            description="Jeśli włączone, udostępniasz uczestnikom link do dołączania (+ opcjonalnie kod w URL/QR)."
            checked={allowJoinByCodeDraft}
            onChange={setAllowJoinByCodeDraft}
            disabled={savingJoin}
          />

          {allowJoinByCodeDraft ? (
            <>
              <div className="mt-4">
                <div className="mb-2 text-xs font-semibold text-slate-300">Kod dołączania</div>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    value={joinCodeDraft}
                    onChange={(e) => setJoinCodeDraft(e.target.value)}
                    placeholder="np. START2024"
                    maxLength={32}
                    className="max-w-xs"
                    disabled={savingJoin}
                  />
                  <Button
                    variant="ghost"
                    leftIcon={<X className="h-4 w-4" />}
                    onClick={() => setJoinCodeDraft("")}
                    disabled={savingJoin}
                  >
                    Wyczyść
                  </Button>
                </div>
                <div className="mt-2 text-xs text-slate-300/70">Minimalnie 3 znaki.</div>
              </div>

              <div className="mt-4">
                <SwitchRow
                  label="Wymagaj akceptacji zmiany nazwy"
                  description="Gdy włączone, uczestnik wysyła prośbę, a organizator/asystent ją akceptuje."
                  checked={renameRequiresApprovalDraft}
                  onChange={setRenameRequiresApprovalDraft}
                  disabled={savingJoin}
                />
              </div>

              <div className="mt-4">
                <SwitchRow
                  label="Podgląd dla uczestników przed publikacją"
                  description="Jeśli wyłączone, uczestnicy nie zobaczą publicznego widoku dopóki nie opublikujesz turnieju."
                  checked={participantsPreviewDraft}
                  onChange={setParticipantsPreviewDraft}
                  disabled={savingJoin}
                />
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-extrabold text-slate-100">Link / QR do dołączania</div>
                  <label className="flex items-center gap-2 text-xs text-slate-300/90">
                    <input
                      type="checkbox"
                      checked={includeJoinCodeInLink}
                      onChange={(e) => setIncludeJoinCodeInLink(e.target.checked)}
                    />
                    Kod w linku/QR
                  </label>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    leftIcon={<Copy className="h-4 w-4" />}
                    onClick={async () => {
                      const ok = await copyToClipboard(joinUrl);
                      toast(ok ? "success" : "error", ok ? "Skopiowano link dołączania." : "Nie udało się skopiować linku.");
                    }}
                  >
                    Kopiuj
                  </Button>

                  <Button
                    variant="ghost"
                    leftIcon={<Send className="h-4 w-4" />}
                    onClick={async () => {
                      const shared = await handleNativeShare(joinUrl, tournament.name, "Link do dołączania do turnieju");
                      if (!shared) {
                        const ok = await copyToClipboard(joinUrl);
                        toast(ok ? "success" : "error", ok ? "Skopiowano link dołączania." : "Nie udało się skopiować linku.");
                      }
                    }}
                  >
                    Udostępnij
                  </Button>
                </div>

                <div className="mt-3 break-all rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-slate-200/90">
                  {joinUrl}
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-4">
                  <div className="rounded-xl bg-white p-2">
                    <QRCodeCanvas value={joinUrl} size={170} includeMargin ref={joinQrRef} />
                  </div>

                  <Button
                    variant="secondary"
                    leftIcon={<Download className="h-4 w-4" />}
                    onClick={() => {
                      const ok = downloadQrFromRef(joinQrRef, `tournament-${tournament.id}-join.png`);
                      toast(ok ? "success" : "error", ok ? "Pobrano QR dołączania." : "Nie udało się pobrać QR.");
                    }}
                  >
                    Pobierz QR
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="mt-3 text-sm text-slate-300/80">
              Dołączanie po link + kod jest wyłączone.
            </div>
          )}
        </div>
      </Card>
    </div>
  );

  const AssistantsTab = () => (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-base font-extrabold text-slate-100">Asystenci i uprawnienia</div>
            <div className="mt-1 text-sm text-slate-300/90">
              {isOrganizer
                ? "Dodawaj asystentów i ustawiaj im zakres uprawnień."
                : "Jesteś asystentem – możesz podejrzeć swoje uprawnienia."}
            </div>
          </div>

          {isOrganizer ? (
            <Button
              variant="secondary"
              leftIcon={<Users className="h-4 w-4" />}
              onClick={() => loadAssistants().then(() => toast("success", "Odświeżono listę asystentów."))}
            >
              Odśwież
            </Button>
          ) : null}
        </div>

        {isOrganizer ? (
          <div className="mt-5">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="text-sm font-extrabold text-slate-100">Dodaj asystenta</div>
              <div className="mt-3">
                <AddAssistantForm
                  tournamentId={tournament.id}
                  onAdded={async () => {
                    await loadAssistants();
                    toast("success", "Dodano asystenta.");
                  }}
                />
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {assistants.length === 0 ? (
                <div className="text-sm text-slate-300/80">Brak asystentów.</div>
              ) : (
                assistants.map((a) => {
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
                        roster_edit: m[a.user_id]?.roster_edit ?? false,
                        name_change_approve: m[a.user_id]?.name_change_approve ?? false,
                        ...patch,
                      },
                    }));
                  };

                  return (
                    <Card key={a.user_id} className="p-4">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <div className="font-extrabold text-slate-100">{a.username || a.email}</div>
                          <div className="mt-1 text-xs text-slate-300/80">{a.email}</div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            variant="primary"
                            onClick={() => saveAssistantPerms(a.user_id)}
                            disabled={busy || !draft}
                          >
                            {busy ? "…" : "Zapisz"}
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => loadAssistantPerms(a.user_id)}
                            disabled={busy}
                          >
                            Odśwież
                          </Button>
                          <Button
                            variant="danger"
                            onClick={() => removeAssistant(a.user_id)}
                            disabled={busy}
                          >
                            Usuń
                          </Button>
                        </div>
                      </div>

                      <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                        <div className="text-sm font-extrabold text-slate-100">Uprawnienia</div>

                        {!draft ? (
                          <div className="mt-2 text-sm text-slate-300/80">Ładowanie…</div>
                        ) : (
                          <div className="mt-3 space-y-2">
                            {[
                              ["teams_edit", "Edycja drużyn"],
                              ["roster_edit", "Składy: zawodnicy"],
                              ["schedule_edit", "Edycja harmonogramu"],
                              ["results_edit", "Wprowadzanie wyników"],
                              ["bracket_edit", "Edycja drabinki"],
                              ["tournament_edit", "Edycja ustawień turnieju"],
                              ["name_change_approve", "Akceptacja zmian nazw"],
                            ].map(([k, label]) => (
                              <div key={k} className="flex items-center justify-between gap-3 border-b border-white/10 py-2">
                                <div className="text-sm text-slate-200/90">{label}</div>
                                <input
                                  type="checkbox"
                                  checked={Boolean((draft as any)[k])}
                                  onChange={(e) => setDraft({ [k]: e.target.checked } as any)}
                                />
                              </div>
                            ))}

                            <div className="pt-2 text-xs text-slate-300/70">
                              Nie obejmuje: publikacji/archiwizacji, zarządzania asystentami i ustawień dołączania.
                            </div>

                            {msg ? <div className="pt-2 text-xs text-slate-200/90">{msg}</div> : null}
                          </div>
                        )}
                      </div>
                    </Card>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          <div className="mt-5 text-sm text-slate-300/80">
            Tę zakładkę edytuje organizator. Swoje uprawnienia zobaczysz w „Twoje uprawnienia”.
          </div>
        )}
      </Card>
    </div>
  );

  const ShareTab = () => (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-base font-extrabold text-slate-100">Udostępnianie (link + QR)</div>
            <div className="mt-1 text-sm text-slate-300/90">
              Link/QR do widoku publicznego. Opcjonalnie dopinaj kod dostępu do URL.
            </div>
          </div>

          <Button
            variant="secondary"
            leftIcon={<Copy className="h-4 w-4" />}
            onClick={async () => {
              const ok = await copyToClipboard(shareUrl);
              toast(ok ? "success" : "error", ok ? "Skopiowano link." : "Nie udało się skopiować linku.");
            }}
          >
            Kopiuj link
          </Button>
        </div>

        {!tournament.is_published ? (
          <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4 text-sm text-amber-200">
            Turniej jest prywatny. Link/QR dla widzów ma sens głównie po publikacji (lub gdy używasz kodu dostępu).
          </div>
        ) : null}

        <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <KeyValue
            k="Kod dostępu"
            v={tournament.access_code ? tournament.access_code : <span className="opacity-70">brak</span>}
          />

          <div className="pt-3">
            <label className="flex items-center gap-2 text-xs text-slate-300/90">
              <input
                type="checkbox"
                checked={includeShareCodeInLink}
                onChange={(e) => setIncludeShareCodeInLink(e.target.checked)}
                disabled={!shareAccessCodeValue}
              />
              Kod w linku/QR
            </label>
            {!shareAccessCodeValue ? (
              <div className="mt-2 text-xs text-slate-300/70">
                Aby dopinać kod, ustaw go w „Dostęp i opis”.
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                leftIcon={<Send className="h-4 w-4" />}
                onClick={async () => {
                  const shared = await handleNativeShare(shareUrl, tournament.name, "Link do turnieju");
                  if (!shared) {
                    const ok = await copyToClipboard(shareUrl);
                    toast(ok ? "success" : "error", ok ? "Skopiowano link." : "Nie udało się skopiować linku.");
                  }
                }}
              >
                Udostępnij
              </Button>
            </div>

            <div className="mt-3 break-all rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-slate-200/90">
              {shareUrl}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-4">
              <div className="rounded-xl bg-white p-2">
                <QRCodeCanvas value={shareUrl} size={170} includeMargin ref={shareQrRef} />
              </div>

              <Button
                variant="secondary"
                leftIcon={<Download className="h-4 w-4" />}
                onClick={() => {
                  const ok = downloadQrFromRef(shareQrRef, `tournament-${tournament.id}-share.png`);
                  toast(ok ? "success" : "error", ok ? "Pobrano QR." : "Nie udało się pobrać QR.");
                }}
              >
                Pobierz QR
              </Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );

  const PermissionsTab = () => (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="text-base font-extrabold text-slate-100">Twoje uprawnienia</div>
        <div className="mt-1 text-sm text-slate-300/90">
          Podgląd efektywnych uprawnień (szczególnie ważne dla asystenta).
        </div>

        <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <KeyValue k="Rola" v={tournament.my_role ?? "brak"} />
          <KeyValue k="Turniej" v={`ID ${tournament.id}`} />
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          {!tournament.my_permissions ? (
            <div className="text-sm text-slate-300/80">Brak danych o uprawnieniach (backend nie zwrócił my_permissions).</div>
          ) : (
            <div className="space-y-1 text-sm">
              <PermLine label="Edycja drużyn" ok={!!tournament.my_permissions.teams_edit} />
              <PermLine label="Składy: zawodnicy" ok={!!tournament.my_permissions.roster_edit} />
              <PermLine label="Edycja harmonogramu" ok={!!tournament.my_permissions.schedule_edit} />
              <PermLine label="Wprowadzanie wyników" ok={!!tournament.my_permissions.results_edit} />
              <PermLine label="Edycja drabinki" ok={!!tournament.my_permissions.bracket_edit} />
              <PermLine label="Edycja ustawień turnieju" ok={!!tournament.my_permissions.tournament_edit} />
              <PermLine label="Akceptacja zmian nazw" ok={!!tournament.my_permissions.name_change_approve} />
              <div className="pt-2 text-xs text-slate-300/70">
                Publikacja/archiwizacja oraz zarządzanie asystentami są zarezerwowane dla organizatora.
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );

  const DevTab = () => (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="text-base font-extrabold text-slate-100">Narzędzia</div>
        <div className="mt-1 text-sm text-slate-300/90">
          Operacje pomocnicze. (Docelowo możesz to schować, ale na etapie developmentu jest przydatne.)
        </div>

        <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-extrabold text-slate-100">Generowanie rozgrywek</div>
              <div className="mt-1 text-xs text-slate-300/80">
                Dostępne tylko gdy status = DRAFT.
              </div>
            </div>

            <Button
              variant="primary"
              leftIcon={<PlayCircle className="h-4 w-4" />}
              onClick={generateTournament}
              disabled={tournament.status !== "DRAFT"}
            >
              Generuj
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );

  const Content = () => {
    if (activeTab === "overview") return <OverviewTab />;
    if (activeTab === "access") return <AccessTab />;
    if (activeTab === "join") return <JoinTab />;
    if (activeTab === "assistants") return <AssistantsTab />;
    if (activeTab === "share") return <ShareTab />;
    if (activeTab === "permissions") return <PermissionsTab />;
    if (activeTab === "dev") return <DevTab />;
    return <OverviewTab />;
  };

  return (
    <>
      <Toast open={toastOpen} kind={toastKind} text={toastText} onClose={() => setToastOpen(false)} />

      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-2xl font-extrabold text-slate-100">Turniej</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge>{tournament.name}</Badge>
              <Badge>{`ID ${tournament.id}`}</Badge>
              <Badge tone={headerStatusTone}>{tournament.status}</Badge>
              <Badge tone={tournament.is_published ? "success" : "warning"}>
                {tournament.is_published ? "Opublikowany" : "Prywatny"}
              </Badge>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/tournaments/${tournament.id}`} className="inline-flex">
              <Button variant="secondary" leftIcon={<LinkIcon className="h-4 w-4" />}>
                Publiczny widok
              </Button>
            </Link>

            <Button
              variant="ghost"
              leftIcon={<Copy className="h-4 w-4" />}
              onClick={async () => {
                const ok = await copyToClipboard(basePublicUrl);
                toast(ok ? "success" : "error", ok ? "Skopiowano link publiczny." : "Nie udało się skopiować linku.");
              }}
            >
              Kopiuj link
            </Button>
          </div>
        </div>

        {/* Mobile Tabs */}
        <div className="mb-4 flex gap-2 overflow-auto pb-1 md:hidden">
          {allowedTabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold",
                activeTab === t.key
                  ? "border-white/20 bg-white/15 text-white"
                  : "border-white/10 bg-white/[0.06] text-slate-200 hover:bg-white/10"
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-[260px_1fr]">
          {/* Desktop Sidebar */}
          <Card className="hidden p-3 md:block">
            <div className="sticky top-4">
              <div className="px-2 pb-2 text-xs font-extrabold uppercase tracking-wider text-slate-300/70">
                Menu
              </div>
              <div className="space-y-1">
                {allowedTabs.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTab(t.key)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold",
                      activeTab === t.key
                        ? "bg-white/15 text-white"
                        : "text-slate-200 hover:bg-white/10"
                    )}
                  >
                    {t.icon}
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                <div className="text-xs font-extrabold text-slate-200/90">Skrót</div>
                <div className="mt-2 text-xs text-slate-300/80">
                  Ustawienia publikacji + kod: <b>Dostęp i opis</b><br />
                  Join: <b>Dołączanie</b><br />
                  Link/QR: <b>Udostępnianie</b>
                </div>
              </div>
            </div>
          </Card>

          {/* Content */}
          <div className="min-w-0">
            <Content />
          </div>
        </div>
      </div>
    </>
  );
}

/* =========================
   Mini components
   ========================= */

function SaveIcon() {
  // prosta ikonka “save” w stylu app (bez importu kolejnych lucide)
  return <CheckCircle2 className="h-4 w-4" />;
}

function PermLine({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/10 py-2">
      <span className="text-slate-200/90">{label}</span>
      <span className={cn("text-xs font-extrabold", ok ? "text-emerald-200" : "text-rose-200")}>
        {ok ? "TAK" : "NIE"}
      </span>
    </div>
  );
}
