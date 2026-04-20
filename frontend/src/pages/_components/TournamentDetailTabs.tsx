// frontend/src/pages/_components/TournamentDetailTabs.tsx
// Komponent renderuje zakładki panelu ustawień turnieju oraz porządkuje główne obszary konfiguracji.

import type { ReactNode } from "react";
import { useMemo, useRef } from "react";
import { QRCodeCanvas } from "qrcode.react";
import {
  BarChart3,
  CheckCircle2,
  Copy,
  Download,
  Globe2,
  Info,
  PencilLine,
  QrCode,
  Send,
  Shield,
  UserRound,
  Users,
  X,
} from "lucide-react";

import { cn } from "../../lib/cn";

import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";
import { Checkbox } from "../../ui/Checkbox";
import { Input } from "../../ui/Input";
import { Select } from "../../ui/Select";
import { Switch } from "../../ui/Switch";
import { Textarea } from "../../ui/Textarea";
import { toast } from "../../ui/Toast";

import AddAssistantForm from "../../components/AddAssistantForm";

export type MyPermissions = {
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

export type TournamentPanelStats = {
  status?: string | null;
  status_label?: string | null;
  divisions_count?: number;
  teams_count?: number;
  players_count?: number;
  stages_total?: number;
  stages_closed?: number;
  stage_progress_label?: string | null;
  progress_mode?: "MATCHES" | "MASS_START" | "NONE" | string;
  primary_progress_current?: number;
  primary_progress_total?: number;
  primary_progress_label?: string | null;
  secondary_progress_current?: number | null;
  secondary_progress_total?: number | null;
  secondary_progress_label?: string | null;
};

export type Tournament = {
  id: number;
  name: string;
  discipline: string;
  competition_type?: "TEAM" | "INDIVIDUAL";
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
  panel_stats?: TournamentPanelStats;
};

export type AssistantListItem = {
  user_id: number;
  email: string;
  username?: string | null;
  status?: "PENDING" | "ACCEPTED";
  permissions?: AssistantPermissionsPayload | null;
};

export type AssistantPermissionsPayload = {
  teams_edit?: boolean;
  schedule_edit?: boolean;
  results_edit?: boolean;
  bracket_edit?: boolean;
  tournament_edit?: boolean;
  roster_edit?: boolean;
  name_change_approve?: boolean;
};

export type TabKey =
  | "overview"
  | "details"
  | "identity"
  | "registration"
  | "visibility"
  | "sharing"
  | "assistants"
  | "role";

export type TabConfig = {
  key: TabKey;
  label: string;
  icon: ReactNode;
  organizerOnly?: boolean;
  manageOnly?: boolean;
};

export const DESCRIPTION_MAX = 800;

const TABS: TabConfig[] = [
  { key: "overview", label: "Podsumowanie", icon: <Info className="h-4 w-4" /> },
  { key: "details", label: "Informacje o turnieju", icon: <BarChart3 className="h-4 w-4" /> },
  { key: "identity", label: "Nazwa i opis", icon: <PencilLine className="h-4 w-4" />, organizerOnly: true },
  { key: "registration", label: "Rejestracja zawodników", icon: <Users className="h-4 w-4" />, organizerOnly: true },
  { key: "visibility", label: "Publikacja i widoczność", icon: <Globe2 className="h-4 w-4" />, organizerOnly: true },
  { key: "sharing", label: "Udostępnianie", icon: <QrCode className="h-4 w-4" />, manageOnly: true },
  { key: "assistants", label: "Asystenci i uprawnienia", icon: <Shield className="h-4 w-4" />, organizerOnly: true },
  { key: "role", label: "Rola i uprawnienia", icon: <UserRound className="h-4 w-4" />, manageOnly: true },
];

function formatRoleLabel(role: Tournament["my_role"]): string {
  if (role === "ORGANIZER") return "Organizator";
  if (role === "ASSISTANT") return "Asystent";
  return "Brak";
}

function boolLabel(value: boolean): string {
  return value ? "Tak" : "Nie";
}

function formatJoinRenameLabel(tournament: Tournament, renameRequiresApprovalDraft: boolean): string {
  if (!tournament.allow_join_by_code) return "Nie dotyczy";
  return renameRequiresApprovalDraft ? "Akceptacja wymagana" : "Bez akceptacji";
}

function formatStatusLabel(status: string | null | undefined): string {
  if (status === "DRAFT") return "Szkic";
  if (status === "CONFIGURED") return "Skonfigurowany";
  if (status === "RUNNING") return "W trakcie";
  if (status === "FINISHED") return "Zakończony";
  return status || "Brak";
}

function formatDisciplineLabel(discipline: string | null | undefined): string {
  if (discipline === "football") return "Piłka nożna";
  if (discipline === "volleyball") return "Siatkówka";
  if (discipline === "basketball") return "Koszykówka";
  if (discipline === "handball") return "Piłka ręczna";
  if (discipline === "tennis") return "Tenis";
  if (discipline === "wrestling") return "Zapasy";
  if (discipline === "custom") return "Niestandardowa";
  return discipline || "Brak";
}

function formatTournamentFormatLabel(format: Tournament["tournament_format"] | string | null | undefined): string {
  if (format === "LEAGUE") return "Liga";
  if (format === "CUP") return "Puchar";
  if (format === "MIXED") return "Grupy + puchar";
  return format || "Brak";
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // brak
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

async function nativeShare(url: string, title?: string, text?: string): Promise<boolean> {
  const navAny = navigator as any;
  if (!navAny?.share) return false;

  try {
    await navAny.share({ title, text, url });
    return true;
  } catch {
    return false;
  }
}

function downloadQr(canvas: HTMLCanvasElement | null, filename: string): boolean {
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
}

function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "success" | "warning" }) {
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

function SaveIcon() {
  return <CheckCircle2 className="h-4 w-4" />;
}

function PermLine({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/10 py-2 last:border-none">
      <span className="text-slate-200/90">{label}</span>
      <span className={cn("text-xs font-extrabold", ok ? "text-emerald-200" : "text-rose-200")}>{ok ? "TAK" : "NIE"}</span>
    </div>
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
    <div className="flex items-start justify-between gap-4 border-b border-white/10 py-3 last:border-none">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-slate-100 break-words">{label}</div>
        {description ? <div className="mt-1 text-xs text-slate-300/80 break-words">{description}</div> : null}
      </div>

      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

function KeyValue({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/10 py-2 text-sm last:border-none">
      <span className="text-slate-300/90">{k}</span>
      <span className="text-right font-semibold text-slate-100">{v}</span>
    </div>
  );
}

function SummaryTile({
  title,
  description,
  lines,
  onClick,
  disabled,
}: {
  title: string;
  description: string;
  lines: Array<{ label: string; value: ReactNode }>;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const clickable = !disabled && typeof onClick === "function";

  return (
    <button
      type="button"
      onClick={clickable ? onClick : undefined}
      disabled={!clickable}
      className={cn(
        "h-full w-full min-w-0 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-left transition",
        clickable ? "hover:-translate-y-0.5 hover:border-white/20 hover:bg-white/[0.06]" : "cursor-default"
      )}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 text-base font-semibold text-white break-words">{title}</div>
          {disabled ? <span className="text-[11px] font-semibold text-slate-400">Podgląd</span> : null}
        </div>

        <div className="mt-1 text-sm text-slate-300 leading-relaxed break-words">{description}</div>

        <div className="mt-4 space-y-2 text-sm">
          {lines.map((line) => (
            <div key={line.label} className="flex items-center justify-between gap-3 border-b border-white/10 pb-2 last:border-none last:pb-0">
              <span className="text-slate-300/90">{line.label}</span>
              <span className="text-right font-semibold text-slate-100">{line.value}</span>
            </div>
          ))}
        </div>
      </div>
    </button>
  );
}

function getSummaryLineTone(value: boolean) {
  return value ? "text-emerald-200" : "text-amber-200";
}

export function getAllowedTabs(isOrganizer: boolean, canManage: boolean): TabConfig[] {
  return TABS.filter((t) => {
    if (t.organizerOnly && !isOrganizer) return false;
    if (t.manageOnly && !canManage) return false;
    return true;
  });
}

type Props = {
  tournament: Tournament;
  activeTab: TabKey;
  setTab: (k: TabKey) => void;
  allowedTabs: TabConfig[];
  isOrganizer: boolean;
  canManage: boolean;
  loadError: string | null;
  nameDraft: string;
  setNameDraft: (v: string) => void;
  descriptionDraft: string;
  setDescriptionDraft: (v: string) => void;
  savingIdentity: boolean;
  onSaveIdentity: () => void;
  isPublishedDraft: boolean;
  setIsPublishedDraft: (v: boolean) => void;
  accessCodeDraft: string;
  setAccessCodeDraft: (v: string) => void;
  savingVisibility: boolean;
  onSaveVisibility: () => void;
  allowJoinByCodeDraft: boolean;
  setAllowJoinByCodeDraft: (v: boolean) => void;
  joinCodeDraft: string;
  setJoinCodeDraft: (v: string) => void;
  participantsPreviewDraft: boolean;
  setParticipantsPreviewDraft: (v: boolean) => void;
  renameRequiresApprovalDraft: boolean;
  setRenameRequiresApprovalDraft: (v: boolean) => void;
  includeJoinCodeInLink: boolean;
  setIncludeJoinCodeInLink: (v: boolean) => void;
  savingRegistration: boolean;
  onSaveRegistration: () => void;
  includeShareCodeInLink: boolean;
  setIncludeShareCodeInLink: (v: boolean) => void;
  assistants: AssistantListItem[];
  assistantDrafts: Record<number, Required<AssistantPermissionsPayload>>;
  assistantBusy: Record<number, boolean>;
  pendingRemoveAssistantId: number | null;
  setPendingRemoveAssistantId: (id: number | null) => void;
  onLoadAssistants: (showSuccessToast?: boolean) => void;
  onLoadAssistantPerms: (userId: number) => void;
  onSaveAssistantPerms: (userId: number) => void;
  onRemoveAssistant: (assistant: AssistantListItem) => void;
  onUpdateAssistantDraft: (userId: number, patch: Partial<Required<AssistantPermissionsPayload>>) => void;
};

export function TournamentDetailTabs(props: Props) {
  const {
    tournament,
    activeTab,
    setTab,
    allowedTabs,
    isOrganizer,
    loadError,
    nameDraft,
    setNameDraft,
    descriptionDraft,
    setDescriptionDraft,
    savingIdentity,
    onSaveIdentity,
    isPublishedDraft,
    setIsPublishedDraft,
    accessCodeDraft,
    setAccessCodeDraft,
    savingVisibility,
    onSaveVisibility,
    allowJoinByCodeDraft,
    setAllowJoinByCodeDraft,
    joinCodeDraft,
    setJoinCodeDraft,
    participantsPreviewDraft,
    setParticipantsPreviewDraft,
    renameRequiresApprovalDraft,
    setRenameRequiresApprovalDraft,
    includeJoinCodeInLink,
    setIncludeJoinCodeInLink,
    savingRegistration,
    onSaveRegistration,
    includeShareCodeInLink,
    setIncludeShareCodeInLink,
    assistants,
    assistantDrafts,
    assistantBusy,
    pendingRemoveAssistantId,
    setPendingRemoveAssistantId,
    onLoadAssistants,
    onLoadAssistantPerms,
    onSaveAssistantPerms,
    onRemoveAssistant,
    onUpdateAssistantDraft,
  } = props;

  const canOpenTab = (key: TabKey) => allowedTabs.some((tab) => tab.key === key);

  const shareAccessCodeValue = useMemo(() => {
    const value = (accessCodeDraft ?? tournament.access_code ?? "").trim();
    return value.length ? value : "";
  }, [accessCodeDraft, tournament.access_code]);

  const shareUrl = useMemo(() => {
    const url = new URL(`/tournaments/${tournament.id}`, window.location.origin);
    if (includeShareCodeInLink && shareAccessCodeValue) {
      url.searchParams.set("code", shareAccessCodeValue);
    }
    return url.toString();
  }, [includeShareCodeInLink, shareAccessCodeValue, tournament.id]);

  const joinUrl = useMemo(() => {
    const url = new URL(`/tournaments/${tournament.id}`, window.location.origin);
    url.searchParams.set("join", "1");
    if (includeJoinCodeInLink) {
      const joinCode = (joinCodeDraft ?? tournament.join_code ?? "").trim();
      if (joinCode) url.searchParams.set("join_code", joinCode);
    }
    return url.toString();
  }, [includeJoinCodeInLink, joinCodeDraft, tournament.id, tournament.join_code]);

  const shareQrRef = useRef<HTMLCanvasElement | null>(null);
  const joinQrRef = useRef<HTMLCanvasElement | null>(null);

  const panelStats = tournament.panel_stats;
  const hasMultipleDivisions = Number(panelStats?.divisions_count ?? 0) > 1;
  const isIndividualCompetition = tournament.competition_type === "INDIVIDUAL";
  const primaryParticipantsLabel = hasMultipleDivisions
    ? "Uczestnicy"
    : isIndividualCompetition
      ? "Uczestnicy"
      : "Drużyny";
  const showPlayersCount = hasMultipleDivisions
    ? Number(panelStats?.players_count ?? 0) > 0
    : !isIndividualCompetition;

  const pendingAssistants = useMemo(
    () => assistants.filter((assistant) => assistant.status === "PENDING"),
    [assistants]
  );

  const activeAssistants = useMemo(
    () => assistants.filter((assistant) => assistant.status !== "PENDING"),
    [assistants]
  );

  const assistantDisplayName = (assistant: AssistantListItem): string => {
    const username = typeof assistant.username === "string" ? assistant.username.trim() : "";
    return username || assistant.email;
  };

  const pendingPermissionsCount = (assistant: AssistantListItem): number => {
    const permissions = assistant.permissions ?? {};
    return [
      permissions.teams_edit,
      permissions.roster_edit,
      permissions.schedule_edit,
      permissions.results_edit,
      permissions.bracket_edit,
      permissions.tournament_edit,
      permissions.name_change_approve,
    ].filter(Boolean).length;
  };

  const formatProgress = (current?: number | null, total?: number | null) => {
    const safeCurrent = Number.isFinite(Number(current)) ? Number(current) : 0;
    const safeTotal = Number.isFinite(Number(total)) ? Number(total) : 0;
    return `${safeCurrent}/${safeTotal}`;
  };

  const renderOverviewTab = () => (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="min-w-0">
          <div className="text-lg font-extrabold text-slate-100">Stan ustawień</div>
          <div className="mt-1 text-sm text-slate-300/90 break-words">
            Jedno miejsce do kontroli nazwy, publikacji, rejestracji zawodników, udostępniania i dostępu zespołu.
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <SummaryTile
            title="Informacje o turnieju"
            description="Status, zakres i postęp rozgrywek dla całego turnieju."
            onClick={canOpenTab("details") ? () => setTab("details") : undefined}
            disabled={!canOpenTab("details")}
            lines={[
              { label: "Status", value: panelStats?.status_label ?? formatStatusLabel(tournament.status) },
              { label: "Dyscyplina", value: formatDisciplineLabel(tournament.discipline) },
              { label: "Format", value: formatTournamentFormatLabel(tournament.tournament_format) },
              { label: "Widoczność", value: isPublishedDraft ? "Publiczny" : "Prywatny" },
              { label: "Dywizje", value: panelStats?.divisions_count ?? 0 },
            ]}
          />

          <SummaryTile
            title="Nazwa i opis"
            description="Podstawowe informacje prezentowane przy turnieju."
            onClick={canOpenTab("identity") ? () => setTab("identity") : undefined}
            disabled={!canOpenTab("identity")}
            lines={[
              {
                label: "Nazwa",
                value: <span className={cn(nameDraft.trim() ? "text-emerald-200" : "text-amber-200")}>{nameDraft.trim() ? "Ustawiona" : "Brak"}</span>,
              },
              {
                label: "Opis",
                value: (
                  <span className={cn(descriptionDraft.trim() ? "text-emerald-200" : "text-amber-200")}>
                    {descriptionDraft.trim() ? "Uzupełniony" : "Brak"}
                  </span>
                ),
              },
            ]}
          />

          <SummaryTile
            title="Rejestracja zawodników"
            description="Ustawienia kodu dołączania oraz zasad uczestnictwa."
            onClick={canOpenTab("registration") ? () => setTab("registration") : undefined}
            disabled={!canOpenTab("registration")}
            lines={[
              {
                label: "Rejestracja aktywna",
                value: <span className={cn(getSummaryLineTone(Boolean(allowJoinByCodeDraft)))}>{boolLabel(Boolean(allowJoinByCodeDraft))}</span>,
              },
              {
                label: "Podgląd przed publikacją",
                value: <span className={cn(getSummaryLineTone(Boolean(participantsPreviewDraft)))}>{boolLabel(Boolean(participantsPreviewDraft))}</span>,
              },
              { label: "Zmiana nazwy", value: formatJoinRenameLabel(tournament, renameRequiresApprovalDraft) },
            ]}
          />

          <SummaryTile
            title="Publikacja i widoczność"
            description="Kontrola publicznego dostępu do turnieju."
            onClick={canOpenTab("visibility") ? () => setTab("visibility") : undefined}
            disabled={!canOpenTab("visibility")}
            lines={[
              {
                label: "Turniej publiczny",
                value: <span className={cn(getSummaryLineTone(Boolean(isPublishedDraft)))}>{boolLabel(Boolean(isPublishedDraft))}</span>,
              },
              {
                label: "Kod dla widzów",
                value: (
                  <span className={cn(shareAccessCodeValue ? "text-emerald-200" : "text-amber-200")}>
                    {shareAccessCodeValue ? "Ustawiony" : "Brak"}
                  </span>
                ),
              },
            ]}
          />

          <SummaryTile
            title="Udostępnianie"
            description="Linki i kody QR do widoku publicznego oraz rejestracji."
            onClick={canOpenTab("sharing") ? () => setTab("sharing") : undefined}
            disabled={!canOpenTab("sharing")}
            lines={[
              {
                label: "Link publiczny",
                value: (
                  <span className={cn(isPublishedDraft || Boolean(shareAccessCodeValue) ? "text-emerald-200" : "text-amber-200")}>
                    {isPublishedDraft || shareAccessCodeValue ? "Gotowy" : "Ograniczony"}
                  </span>
                ),
              },
              {
                label: "Link rejestracyjny",
                value: <span className={cn(allowJoinByCodeDraft ? "text-emerald-200" : "text-amber-200")}>{allowJoinByCodeDraft ? "Gotowy" : "Wyłączony"}</span>,
              },
            ]}
          />

          <SummaryTile
            title="Asystenci"
            description="Zespół wspierający organizację i obsługę turnieju."
            onClick={canOpenTab("assistants") ? () => setTab("assistants") : undefined}
            disabled={!canOpenTab("assistants")}
            lines={[
              { label: "Aktywni", value: activeAssistants.length },
              { label: "Oczekujące", value: pendingAssistants.length },
            ]}
          />

          <SummaryTile
            title="Twoja rola"
            description="Zakres dostępu przypisany do bieżącego użytkownika."
            onClick={canOpenTab("role") ? () => setTab("role") : undefined}
            disabled={!canOpenTab("role")}
            lines={[
              { label: "Rola", value: formatRoleLabel(tournament.my_role) },
              {
                label: "Uprawnienia",
                value: tournament.my_role === "ORGANIZER" ? "Pełny dostęp" : tournament.my_permissions ? "Dostęp ograniczony" : "Brak danych",
              },
            ]}
          />
        </div>
      </Card>

      {loadError ? (
        <Card className="p-5">
          <div className="text-sm text-slate-300 break-words">Ostatnia próba pobrania danych nie powiodła się. Odśwież stronę lub spróbuj ponownie później.</div>
        </Card>
      ) : null}
    </div>
  );

  const renderDetailsTab = () => (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="min-w-0">
          <div className="text-base font-extrabold text-slate-100">Informacje o turnieju</div>
          <div className="mt-1 text-sm text-slate-300/90 break-words">
            Zbiorczy podgląd najważniejszych danych dla całego turnieju.
          </div>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          <Card className="bg-white/[0.04] p-4">
            <KeyValue k="Status" v={panelStats?.status_label ?? formatStatusLabel(tournament.status)} />
            <KeyValue k="Dyscyplina" v={formatDisciplineLabel(tournament.discipline)} />
            <KeyValue k="Format" v={formatTournamentFormatLabel(tournament.tournament_format)} />
            <KeyValue k="Widoczność" v={isPublishedDraft ? "Publiczny" : "Prywatny"} />
            <KeyValue k="Dywizje" v={panelStats?.divisions_count ?? 0} />
          </Card>

          <Card className="bg-white/[0.04] p-4">
            <KeyValue k={primaryParticipantsLabel} v={panelStats?.teams_count ?? 0} />
            {showPlayersCount ? <KeyValue k="Zawodnicy" v={panelStats?.players_count ?? 0} /> : null}
            {panelStats?.progress_mode === "MASS_START" ? (
              <>
                <KeyValue k="Rezultaty" v={formatProgress(panelStats?.primary_progress_current, panelStats?.primary_progress_total)} />
                <KeyValue k="Etapy zakończone" v={formatProgress(panelStats?.stages_closed, panelStats?.stages_total)} />
              </>
            ) : (
              <>
                <KeyValue k="Mecze w trakcie" v={formatProgress(panelStats?.primary_progress_current, panelStats?.primary_progress_total)} />
                <KeyValue k="Mecze zakończone" v={formatProgress(panelStats?.secondary_progress_current, panelStats?.secondary_progress_total)} />
                <KeyValue k="Etapy zakończone" v={formatProgress(panelStats?.stages_closed, panelStats?.stages_total)} />
              </>
            )}
          </Card>
        </div>
      </Card>
    </div>
  );

  const renderIdentityTab = () => (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-base font-extrabold text-slate-100">Nazwa i opis</div>
            <div className="mt-1 text-sm text-slate-300/90 break-words">Ustaw nazwę turnieju oraz opis widoczny w panelu i części publicznej.</div>
          </div>

          <Button type="button" variant="primary" leftIcon={<SaveIcon />} onClick={onSaveIdentity} disabled={savingIdentity}>
            {savingIdentity ? "Zapisywanie..." : "Zapisz"}
          </Button>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          <Card className="bg-white/[0.04] p-4">
            <div className="mb-2 text-xs font-semibold text-slate-300">Nazwa turnieju</div>
            <Input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} placeholder="Np. Letni Puchar Miasta" maxLength={160} disabled={savingIdentity} />
            <div className="mt-2 text-xs text-slate-300/70 break-words">To pole odpowiada za główną nazwę widoczną w panelu i linkach udostępniania.</div>
          </Card>

          <Card className="bg-white/[0.04] p-4">
            <div className="mb-2 text-xs font-semibold text-slate-300">Opis turnieju</div>
            <Textarea
              unstyled
              value={descriptionDraft}
              onChange={(e) => setDescriptionDraft(e.target.value)}
              placeholder="Informacje organizacyjne, regulamin, zasady uczestnictwa..."
              rows={7}
              maxLength={DESCRIPTION_MAX}
              disabled={savingIdentity}
              className={cn(
                "w-full rounded-2xl border border-white/10 bg-white/[0.06] p-3 text-sm text-slate-100",
                "placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/10"
              )}
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300/70">
              <span>
                {descriptionDraft.trim().length}/{DESCRIPTION_MAX}
              </span>
              <Button type="button" variant="ghost" onClick={() => setDescriptionDraft("")} disabled={savingIdentity}>
                Wyczyść
              </Button>
            </div>
          </Card>
        </div>
      </Card>
    </div>
  );

  const renderRegistrationTab = () => (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-base font-extrabold text-slate-100">Rejestracja zawodników</div>
            <div className="mt-1 text-sm text-slate-300/90 break-words">Skonfiguruj dołączanie zawodników, kod rejestracyjny i zasady widoczności dla uczestników.</div>
          </div>

          <Button type="button" variant="primary" leftIcon={<SaveIcon />} onClick={onSaveRegistration} disabled={savingRegistration}>
            {savingRegistration ? "Zapisywanie..." : "Zapisz"}
          </Button>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          <Card className="bg-white/[0.04] p-4">
            <SwitchRow
              label="Włącz rejestrację zawodników"
              description="Po włączeniu uczestnicy mogą dołączyć do turnieju przez konto i kod rejestracyjny."
              checked={allowJoinByCodeDraft}
              onChange={setAllowJoinByCodeDraft}
              disabled={savingRegistration}
            />

            <div className="mt-4">
              <div className="mb-2 text-xs font-semibold text-slate-300">Kod rejestracyjny</div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  value={joinCodeDraft}
                  onChange={(e) => setJoinCodeDraft(e.target.value)}
                  placeholder="Np. ZAWODNIK2026"
                  maxLength={32}
                  className="w-full sm:max-w-xs"
                  disabled={savingRegistration || !allowJoinByCodeDraft}
                />
                <Button type="button" variant="ghost" leftIcon={<X className="h-4 w-4" />} onClick={() => setJoinCodeDraft("")} disabled={savingRegistration || !allowJoinByCodeDraft}>
                  Wyczyść
                </Button>
              </div>
              <div className="mt-2 text-xs text-slate-300/70">Minimalnie 3 znaki. Kod może być potem dołączany do linku i QR.</div>
            </div>
          </Card>

          <Card className="bg-white/[0.04] p-4">
            <SwitchRow
              label="Podgląd dla zawodników przed publikacją"
              description="Pozwala uczestnikom zobaczyć turniej jeszcze przed jego publiczną publikacją."
              checked={participantsPreviewDraft}
              onChange={setParticipantsPreviewDraft}
              disabled={savingRegistration || !allowJoinByCodeDraft}
            />

            <div className="mt-4">
              <SwitchRow
                label="Zmiana nazwy wymaga akceptacji"
                description="Gdy opcja jest aktywna, zmiana nazwy uczestnika wymaga akceptacji organizatora lub asystenta."
                checked={renameRequiresApprovalDraft}
                onChange={setRenameRequiresApprovalDraft}
                disabled={savingRegistration || !allowJoinByCodeDraft}
              />
            </div>
          </Card>
        </div>
      </Card>
    </div>
  );

  const renderVisibilityTab = () => (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-base font-extrabold text-slate-100">Publikacja i widoczność</div>
            <div className="mt-1 text-sm text-slate-300/90 break-words">Ustaw publiczny status turnieju i opcjonalny kod dostępu dla widzów.</div>
          </div>

          <Button type="button" variant="primary" leftIcon={<SaveIcon />} onClick={onSaveVisibility} disabled={savingVisibility}>
            {savingVisibility ? "Zapisywanie..." : "Zapisz"}
          </Button>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          <Card className="bg-white/[0.04] p-4">
            <SwitchRow
              label="Upublicznij turniej"
              description="Po włączeniu widok turnieju jest dostępny publicznie bez konieczności logowania, chyba że ustawiono kod dla widzów."
              checked={isPublishedDraft}
              onChange={setIsPublishedDraft}
              disabled={savingVisibility}
            />
          </Card>

          <Card className="bg-white/[0.04] p-4">
            <div className="mb-2 text-xs font-semibold text-slate-300">Kod dostępu dla widzów</div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                value={accessCodeDraft}
                onChange={(e) => setAccessCodeDraft(e.target.value)}
                placeholder="Np. WIDZ2026"
                maxLength={20}
                className="w-full sm:max-w-xs"
                disabled={savingVisibility}
              />
              <Button type="button" variant="ghost" leftIcon={<X className="h-4 w-4" />} onClick={() => setAccessCodeDraft("")} disabled={savingVisibility}>
                Wyczyść
              </Button>
            </div>
            <div className="mt-2 text-xs text-slate-300/70 break-words">Kod można potem automatycznie dopiąć do linku publicznego w zakładce udostępniania.</div>
          </Card>
        </div>
      </Card>
    </div>
  );

  const renderSharingTab = () => (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="min-w-0">
          <div className="text-base font-extrabold text-slate-100">Udostępnianie</div>
          <div className="mt-1 text-sm text-slate-300/90 break-words">Linki i kody QR są rozdzielone na widok publiczny oraz rejestrację zawodników.</div>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          <Card className="bg-white/[0.04] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-extrabold text-slate-100">Widok publiczny</div>
                <div className="mt-1 text-xs text-slate-300/80 break-words">Link dla widzów i obserwatorów turnieju.</div>
              </div>

              <Checkbox
                checked={includeShareCodeInLink}
                onCheckedChange={setIncludeShareCodeInLink}
                label="Kod w linku"
                description={!shareAccessCodeValue ? "Aby dopinać kod, ustaw go w publikacji i widoczności." : "Dodaje kod dostępu do adresu linku."}
                disabled={!shareAccessCodeValue}
                className="shrink-0"
              />
            </div>

            {!isPublishedDraft ? (
              <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-200">
                Turniej nie jest publiczny. Link może nadal działać z kodem dostępu, ale nie będzie klasycznym publicznym wejściem bez ograniczeń.
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                leftIcon={<Copy className="h-4 w-4" />}
                onClick={async () => {
                  const ok = await copyToClipboard(shareUrl);
                  if (ok) toast.success("Skopiowano link publiczny.");
                  else toast.error("Nie udało się skopiować linku.", { title: "Schowek" });
                }}
              >
                Kopiuj link
              </Button>

              <Button
                type="button"
                variant="ghost"
                leftIcon={<Send className="h-4 w-4" />}
                onClick={async () => {
                  const shared = await nativeShare(shareUrl, tournament.name, "Link do turnieju");
                  if (shared) {
                    toast.success("Udostępniono link.");
                    return;
                  }

                  const ok = await copyToClipboard(shareUrl);
                  if (ok) toast.success("Skopiowano link publiczny.");
                  else toast.error("Nie udało się skopiować linku.", { title: "Schowek" });
                }}
              >
                Udostępnij
              </Button>
            </div>

            <div className="mt-3 break-all rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-slate-200/90">{shareUrl}</div>

            <div className="mt-4 grid gap-4 sm:grid-cols-[200px_1fr] sm:items-center">
              <div className="justify-self-start rounded-xl bg-white p-2">
                <QRCodeCanvas value={shareUrl} size={170} includeMargin ref={shareQrRef} />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  leftIcon={<Download className="h-4 w-4" />}
                  onClick={() => {
                    const ok = downloadQr(shareQrRef.current, `tournament-${tournament.id}-share.png`);
                    if (ok) toast.success("Pobrano QR publiczny.");
                    else toast.error("Nie udało się pobrać QR.", { title: "QR" });
                  }}
                >
                  Pobierz QR
                </Button>
              </div>
            </div>
          </Card>

          <Card className="bg-white/[0.04] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-extrabold text-slate-100">Rejestracja zawodników</div>
                <div className="mt-1 text-xs text-slate-300/80 break-words">Link do dołączania do turnieju dla uczestników.</div>
              </div>

              <Checkbox
                checked={includeJoinCodeInLink}
                onCheckedChange={setIncludeJoinCodeInLink}
                label="Kod w linku"
                description={!joinCodeDraft.trim() ? "Aby dopinać kod, ustaw go w rejestracji zawodników." : "Dodaje kod rejestracyjny do adresu linku."}
                disabled={!joinCodeDraft.trim()}
                className="shrink-0"
              />
            </div>

            {!allowJoinByCodeDraft ? (
              <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-200">
                Rejestracja zawodników jest wyłączona. Link pozostanie pomocniczy dopóki nie aktywujesz dołączania.
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                leftIcon={<Copy className="h-4 w-4" />}
                onClick={async () => {
                  const ok = await copyToClipboard(joinUrl);
                  if (ok) toast.success("Skopiowano link rejestracyjny.");
                  else toast.error("Nie udało się skopiować linku.", { title: "Schowek" });
                }}
              >
                Kopiuj link
              </Button>

              <Button
                type="button"
                variant="ghost"
                leftIcon={<Send className="h-4 w-4" />}
                onClick={async () => {
                  const shared = await nativeShare(joinUrl, tournament.name, "Link do rejestracji zawodników");
                  if (shared) {
                    toast.success("Udostępniono link.");
                    return;
                  }

                  const ok = await copyToClipboard(joinUrl);
                  if (ok) toast.success("Skopiowano link rejestracyjny.");
                  else toast.error("Nie udało się skopiować linku.", { title: "Schowek" });
                }}
              >
                Udostępnij
              </Button>
            </div>

            <div className="mt-3 break-all rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-slate-200/90">{joinUrl}</div>

            <div className="mt-4 grid gap-4 sm:grid-cols-[200px_1fr] sm:items-center">
              <div className="justify-self-start rounded-xl bg-white p-2">
                <QRCodeCanvas value={joinUrl} size={170} includeMargin ref={joinQrRef} />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  leftIcon={<Download className="h-4 w-4" />}
                  onClick={() => {
                    const ok = downloadQr(joinQrRef.current, `tournament-${tournament.id}-join.png`);
                    if (ok) toast.success("Pobrano QR rejestracyjny.");
                    else toast.error("Nie udało się pobrać QR.", { title: "QR" });
                  }}
                >
                  Pobierz QR
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </Card>
    </div>
  );

  const renderAssistantsTab = () => {
    const permsList: Array<{ key: keyof Required<AssistantPermissionsPayload>; label: string }> = [
      { key: "teams_edit", label: "Edycja drużyn" },
      { key: "roster_edit", label: "Składy: zawodnicy" },
      { key: "schedule_edit", label: "Edycja harmonogramu" },
      { key: "results_edit", label: "Wprowadzanie wyników" },
      { key: "bracket_edit", label: "Edycja drabinki" },
      { key: "tournament_edit", label: "Edycja ustawień turnieju" },
      { key: "name_change_approve", label: "Akceptacja zmian nazw" },
    ];

    return (
      <div className="space-y-4">
        <Card className="p-5">
          <div className="min-w-0">
            <div className="text-base font-extrabold text-slate-100">Asystenci i uprawnienia</div>
            <div className="mt-1 text-sm text-slate-300/90 break-words">
              Dodawaj zaproszenia i zarządzaj aktywnymi asystentami.
            </div>
          </div>

          <div className="mt-5">
            <AddAssistantForm tournamentId={tournament.id} onAdded={() => onLoadAssistants(false)} />
          </div>

          <div className="mt-6 space-y-5">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="text-sm font-semibold text-white">Zaproszenia oczekujące</div>
                <Badge tone="warning">{pendingAssistants.length}</Badge>
              </div>

              {pendingAssistants.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300/80">
                  Brak oczekujących zaproszeń.
                </div>
              ) : (
                <div className="space-y-3">
                  {pendingAssistants.map((assistant) => {
                    const busy = Boolean(assistantBusy[assistant.user_id]);
                    const confirmOpen = pendingRemoveAssistantId === assistant.user_id;
                    const selectedPerms = pendingPermissionsCount(assistant);

                    return (
                      <div key={assistant.user_id} className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-base font-semibold text-white break-words">{assistant.email}</div>
                              <Badge tone="warning">Zaproszenie oczekuje</Badge>
                            </div>
                            <div className="mt-1 text-xs text-slate-300/75 break-words">
                              Po akceptacji zostaną aktywowane wybrane uprawnienia{selectedPerms > 0 ? ` (${selectedPerms})` : ""}.
                            </div>
                          </div>

                          {confirmOpen ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <Button type="button" variant="danger" onClick={() => onRemoveAssistant(assistant)} disabled={busy} className="h-9 rounded-xl px-4">
                                {busy ? "Cofanie..." : "Cofnij zaproszenie"}
                              </Button>
                              <Button type="button" variant="secondary" onClick={() => setPendingRemoveAssistantId(null)} disabled={busy} className="h-9 rounded-xl px-4">
                                Anuluj
                              </Button>
                            </div>
                          ) : (
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => setPendingRemoveAssistantId(assistant.user_id)}
                              disabled={busy}
                              className="h-9 rounded-xl px-4"
                            >
                              Cofnij
                            </Button>
                          )}
                        </div>

                        {confirmOpen ? (
                          <div className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
                            Cofnięcie zaproszenia usunie tę pozycję z listy oczekujących.
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="text-sm font-semibold text-white">Aktywni asystenci</div>
                <Badge tone="success">{activeAssistants.length}</Badge>
              </div>

              {activeAssistants.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300/80">
                  Brak aktywnych asystentów.
                </div>
              ) : (
                <div className="space-y-3">
                  {activeAssistants.map((assistant) => {
                    const draft = assistantDrafts[assistant.user_id];
                    const busy = Boolean(assistantBusy[assistant.user_id]);
                    const confirmOpen = pendingRemoveAssistantId === assistant.user_id;

                    return (
                      <Card key={assistant.user_id} className="p-4">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="font-extrabold text-slate-100 break-words">{assistantDisplayName(assistant)}</div>
                              <Badge tone="success">Aktywny</Badge>
                            </div>
                            <div className="mt-1 text-xs text-slate-300/80 break-words">{assistant.email}</div>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <Button type="button" variant="primary" onClick={() => onSaveAssistantPerms(assistant.user_id)} disabled={busy || !draft}>
                              {busy ? "Zapisywanie..." : "Zapisz"}
                            </Button>
                            <Button type="button" variant="ghost" onClick={() => onLoadAssistantPerms(assistant.user_id)} disabled={busy}>
                              Odśwież
                            </Button>
                            {confirmOpen ? (
                              <>
                                <Button type="button" variant="danger" onClick={() => onRemoveAssistant(assistant)} disabled={busy}>
                                  Usuń asystenta
                                </Button>
                                <Button type="button" variant="secondary" onClick={() => setPendingRemoveAssistantId(null)} disabled={busy}>
                                  Anuluj
                                </Button>
                              </>
                            ) : (
                              <Button type="button" variant="danger" onClick={() => setPendingRemoveAssistantId(assistant.user_id)} disabled={busy}>
                                Usuń
                              </Button>
                            )}
                          </div>
                        </div>

                        {confirmOpen ? (
                          <div className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
                            Usunięcie asystenta odbierze mu dostęp do panelu turnieju.
                          </div>
                        ) : null}

                        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                          {!draft ? (
                            <div className="text-sm text-slate-300/80">Ładowanie uprawnień...</div>
                          ) : (
                            permsList.map((permission) => (
                              <div key={permission.key} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                                <Checkbox
                                  checked={Boolean((draft as any)[permission.key])}
                                  onCheckedChange={(value) => onUpdateAssistantDraft(assistant.user_id, { [permission.key]: value } as any)}
                                  label={permission.label}
                                  disabled={busy}
                                  className="w-full"
                                />
                              </div>
                            ))
                          )}
                        </div>

                        <div className="mt-3 text-xs text-slate-300/70 break-words">
                          Zakres nie obejmuje publikacji, archiwizacji, ustawień rejestracji i zarządzania asystentami.
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </Card>
      </div>
    );
  };

  const renderRoleTab = () => (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="text-base font-extrabold text-slate-100">Rola i uprawnienia</div>
        <div className="mt-1 text-sm text-slate-300/90 break-words">Podgląd roli bieżącego użytkownika oraz jego efektywnych możliwości w tym turnieju.</div>

        <Card className="mt-5 bg-white/[0.04] p-4">
          <KeyValue k="Rola" v={formatRoleLabel(tournament.my_role)} />
          <KeyValue k="Tryb dostępu" v={tournament.my_role === "ORGANIZER" ? "Pełny" : "Ograniczony"} />
        </Card>

        <Card className="mt-4 bg-white/[0.04] p-4">
          {!tournament.my_permissions ? (
            <div className="text-sm text-slate-300/80 break-words">Brak danych o uprawnieniach. Backend nie zwrócił pola my_permissions.</div>
          ) : (
            <div className="space-y-1 text-sm">
              <PermLine label="Edycja drużyn" ok={!!tournament.my_permissions.teams_edit} />
              <PermLine label="Składy: zawodnicy" ok={!!tournament.my_permissions.roster_edit} />
              <PermLine label="Edycja harmonogramu" ok={!!tournament.my_permissions.schedule_edit} />
              <PermLine label="Wprowadzanie wyników" ok={!!tournament.my_permissions.results_edit} />
              <PermLine label="Edycja drabinki" ok={!!tournament.my_permissions.bracket_edit} />
              <PermLine label="Edycja ustawień turnieju" ok={!!tournament.my_permissions.tournament_edit} />
              <PermLine label="Akceptacja zmian nazw" ok={!!tournament.my_permissions.name_change_approve} />
              <PermLine label="Publikacja turnieju" ok={!!tournament.my_permissions.publish || tournament.my_role === "ORGANIZER"} />
              <PermLine label="Zarządzanie asystentami" ok={!!tournament.my_permissions.manage_assistants || tournament.my_role === "ORGANIZER"} />
            </div>
          )}
        </Card>
      </Card>
    </div>
  );

  const Content = () => {
    if (activeTab === "overview") return renderOverviewTab();
    if (activeTab === "details") return renderDetailsTab();
    if (activeTab === "identity") return renderIdentityTab();
    if (activeTab === "registration") return renderRegistrationTab();
    if (activeTab === "visibility") return renderVisibilityTab();
    if (activeTab === "sharing") return renderSharingTab();
    if (activeTab === "assistants") return renderAssistantsTab();
    if (activeTab === "role") return renderRoleTab();
    return renderOverviewTab();
  };

  return (
    <div className="w-full">
      <div className="mb-5">
        <div className="min-w-0">
          <div className="text-2xl font-extrabold text-slate-100">Ustawienia turnieju</div>
          <div className="mt-1 text-sm text-slate-300/90 break-words">
            Zarządzaj nazwą, publikacją, rejestracją zawodników, udostępnianiem i uprawnieniami zespołu.
          </div>
        </div>
      </div>

      <div className="mb-4 md:hidden">
        <Select<TabKey>
          value={activeTab}
          onChange={setTab}
          options={allowedTabs.map((tab) => ({ value: tab.key, label: tab.label, leftIcon: tab.icon }))}
          ariaLabel="Wybór zakładki"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-[270px_1fr] xl:grid-cols-[300px_1fr]">
        <Card className="relative hidden overflow-hidden p-3 md:block">
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -top-24 left-1/2 h-48 w-[28rem] -translate-x-1/2 rounded-full bg-indigo-500/15 blur-3xl" />
            <div className="absolute -bottom-24 left-1/2 h-48 w-[28rem] -translate-x-1/2 rounded-full bg-sky-500/10 blur-3xl" />
          </div>

          <div className="relative sticky top-4">
            <div className="px-2 pb-2 text-xs font-extrabold uppercase tracking-wider text-slate-300/70">Zakładki</div>
            <div className="space-y-1">
              {allowedTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setTab(tab.key)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold",
                    activeTab === tab.key ? "bg-white/15 text-white" : "text-slate-200 hover:bg-white/10"
                  )}
                >
                  {tab.icon}
                  <span className="min-w-0 break-words">{tab.label}</span>
                </button>
              ))}
            </div>

            {loadError ? (
              <Card className="mt-3 bg-white/[0.04] p-3">
                <div className="text-xs text-slate-300/80 break-words">Ostatnie pobranie danych zakończyło się błędem. Część informacji może być nieaktualna.</div>
              </Card>
            ) : null}
          </div>
        </Card>

        <div className="min-w-0">
          <Content />
        </div>
      </div>
    </div>
  );
}
