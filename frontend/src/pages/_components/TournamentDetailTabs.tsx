import type { ReactNode } from "react";
import { useMemo, useRef } from "react";
import { QRCodeCanvas } from "qrcode.react";
import {
  BarChart3,
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

export type Tournament = {
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

export type AssistantListItem = {
  user_id: number;
  email: string;
  username: string;
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

export type TabKey = "overview" | "access" | "join" | "assistants" | "share" | "permissions";

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
  { key: "access", label: "Dostęp i opis", icon: <Settings className="h-4 w-4" />, organizerOnly: true },
  { key: "join", label: "Dołączanie", icon: <Users className="h-4 w-4" />, organizerOnly: true },
  { key: "assistants", label: "Asystenci", icon: <Shield className="h-4 w-4" />, manageOnly: true },
  { key: "share", label: "Udostępnianie", icon: <QrCode className="h-4 w-4" />, manageOnly: true },
  { key: "permissions", label: "Twoje uprawnienia", icon: <Shield className="h-4 w-4" />, manageOnly: true },
];

function formatRoleLabel(role: Tournament["my_role"]): string {
  if (role === "ORGANIZER") return "Organizator";
  if (role === "ASSISTANT") return "Asystent";
  return "Brak";
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
    <div className="flex items-center justify-between gap-3 border-b border-white/10 py-2">
      <span className="text-slate-200/90">{label}</span>
      <span className={cn("text-xs font-extrabold", ok ? "text-emerald-200" : "text-rose-200")}>
        {ok ? "TAK" : "NIE"}
      </span>
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
    <div className="flex items-start justify-between gap-4 border-b border-white/10 py-3">
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
    <div className="flex items-center justify-between gap-3 border-b border-white/10 py-2 text-sm">
      <span className="text-slate-300/90">{k}</span>
      <span className="font-semibold text-slate-100">{v}</span>
    </div>
  );
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

  onOpenPublicView: () => void;
  onRefresh: () => void;

  isPublishedDraft: boolean;
  setIsPublishedDraft: (v: boolean) => void;
  accessCodeDraft: string;
  setAccessCodeDraft: (v: string) => void;
  descriptionDraft: string;
  setDescriptionDraft: (v: string) => void;
  savingSettings: boolean;
  onSaveSettings: () => void;

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
  savingJoin: boolean;
  onSaveJoinAndParticipantSettings: () => void;

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
  onRemoveAssistant: (userId: number) => void;
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
    onOpenPublicView,
    onRefresh,
    isPublishedDraft,
    setIsPublishedDraft,
    accessCodeDraft,
    setAccessCodeDraft,
    descriptionDraft,
    setDescriptionDraft,
    savingSettings,
    onSaveSettings,
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
    savingJoin,
    onSaveJoinAndParticipantSettings,
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

  const basePublicUrl = useMemo(() => new URL(`/tournaments/${tournament.id}`, window.location.origin).toString(), [tournament.id]);

  const shareAccessCodeValue = useMemo(() => {
    const v = (accessCodeDraft ?? tournament.access_code ?? "").trim();
    return v.length ? v : "";
  }, [accessCodeDraft, tournament.access_code]);

  const shareUrl = useMemo(() => {
    const u = new URL(`/tournaments/${tournament.id}`, window.location.origin);
    if (includeShareCodeInLink) {
      const c = shareAccessCodeValue;
      if (c) u.searchParams.set("code", c);
    }
    return u.toString();
  }, [tournament.id, includeShareCodeInLink, shareAccessCodeValue]);

  const joinUrl = useMemo(() => {
    const u = new URL(`/tournaments/${tournament.id}`, window.location.origin);
    u.searchParams.set("join", "1");
    if (includeJoinCodeInLink) {
      const jc = (joinCodeDraft ?? tournament.join_code ?? "").trim();
      if (jc) u.searchParams.set("join_code", jc);
    }
    return u.toString();
  }, [tournament.id, includeJoinCodeInLink, joinCodeDraft, tournament.join_code]);

  const shareQrRef = useRef<HTMLCanvasElement | null>(null);
  const joinQrRef = useRef<HTMLCanvasElement | null>(null);

  const headerStatusTone =
    tournament.status === "FINISHED" ? "success" : tournament.status === "DRAFT" ? "warning" : "neutral";

  const OverviewTab = () => (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xl font-extrabold text-slate-100 break-words">{tournament.name}</div>
            <div className="mt-1 text-sm text-slate-300/90 break-words">
              Panel zarządzania: dostęp, asystenci, dołączanie i udostępnianie.
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {tournament.discipline ? <Badge>{tournament.discipline}</Badge> : null}
            {tournament.tournament_format ? <Badge>{tournament.tournament_format}</Badge> : null}
            <Badge tone={headerStatusTone}>{tournament.status}</Badge>
            <Badge tone={tournament.is_published ? "success" : "warning"}>
              {tournament.is_published ? "Opublikowany" : "Prywatny"}
            </Badge>
            {tournament.access_code ? <Badge>Kod: {tournament.access_code}</Badge> : null}
          </div>
        </div>

        <div className="mt-5 grid gap-3 xl:grid-cols-2">
          <Card className="bg-white/[0.04] p-4">
            <div className="text-sm font-extrabold text-slate-100">Skróty</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" variant="secondary" leftIcon={<LinkIcon className="h-4 w-4" />} onClick={onOpenPublicView}>
                Otwórz publiczny widok
              </Button>

              <Button
                type="button"
                variant="ghost"
                leftIcon={<Copy className="h-4 w-4" />}
                onClick={async () => {
                  const ok = await copyToClipboard(basePublicUrl);
                  if (ok) toast.success("Skopiowano link publiczny.");
                  else toast.error("Nie udało się skopiować linku.", { title: "Schowek" });
                }}
              >
                Kopiuj link
              </Button>
            </div>
          </Card>

          <Card className="bg-white/[0.04] p-4">
            <div className="text-sm font-extrabold text-slate-100">Informacje</div>
            <div className="mt-2 text-xs text-slate-300/90 break-words">
              Najczęściej używane akcje są w zakładkach: <b>Dostęp i opis</b>, <b>Dołączanie</b>, <b>Udostępnianie</b>.
            </div>
            <div className="mt-3 text-xs text-slate-300/70 break-words">
              Rola: <b>{formatRoleLabel(tournament.my_role)}</b>
            </div>
          </Card>
        </div>
      </Card>

      {loadError ? (
        <Card className="p-5">
          <div className="text-sm text-slate-300 break-words">
            Ostatnia próba odświeżenia danych nie powiodła się. Użyj przycisku odświeżenia w nagłówku.
          </div>
        </Card>
      ) : null}
    </div>
  );

  const AccessTab = () => (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-base font-extrabold text-slate-100">Dostęp i opis</div>
            <div className="mt-1 text-sm text-slate-300/90 break-words">
              Publikacja, kod dla widzów oraz opis widoczny w publicznym widoku.
            </div>
          </div>

          <Button type="button" variant="primary" leftIcon={<SaveIcon />} onClick={onSaveSettings} disabled={savingSettings}>
            {savingSettings ? "Zapisywanie..." : "Zapisz"}
          </Button>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          <Card className="bg-white/[0.04] p-4">
            <SwitchRow
              label="Opublikuj turniej"
              description="Gdy wyłączone, widok publiczny ma sens głównie z kodem dostępu lub w trybie podglądu uczestników."
              checked={isPublishedDraft}
              onChange={setIsPublishedDraft}
              disabled={savingSettings}
            />

            <div className="mt-4">
              <div className="mb-2 text-xs font-semibold text-slate-300">Kod dostępu (dla widzów / link ?code=...)</div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  value={accessCodeDraft}
                  onChange={(e) => setAccessCodeDraft(e.target.value)}
                  placeholder="np. WIDZ123"
                  maxLength={20}
                  className="w-full sm:max-w-xs"
                  disabled={savingSettings}
                />

                <Button type="button" variant="ghost" leftIcon={<X className="h-4 w-4" />} onClick={() => setAccessCodeDraft("")} disabled={savingSettings}>
                  Wyczyść
                </Button>
              </div>

              <div className="mt-2 text-xs text-slate-300/70 break-words">
                Jeśli ustawisz kod, możesz dopinać go do linków/QR w zakładce "Udostępnianie".
              </div>
            </div>
          </Card>

          <Card className="bg-white/[0.04] p-4">
            <div className="mb-2 text-xs font-semibold text-slate-300">Opis turnieju (publiczny)</div>
            <Textarea
              unstyled
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
              <Button type="button" variant="ghost" onClick={() => setDescriptionDraft("")} disabled={savingSettings}>
                Wyczyść
              </Button>
            </div>
          </Card>
        </div>
      </Card>
    </div>
  );

  const JoinTab = () => (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-base font-extrabold text-slate-100">Dołączanie zawodników</div>
            <div className="mt-1 text-sm text-slate-300/90 break-words">
              Uczestnik loguje się, podaje kod i uzupełnia nazwę. Dodatkowo można włączyć podgląd przed publikacją.
            </div>
          </div>

          <Button type="button" variant="primary" leftIcon={<SaveIcon />} onClick={onSaveJoinAndParticipantSettings} disabled={savingJoin}>
            {savingJoin ? "Zapisywanie..." : "Zapisz"}
          </Button>
        </div>

        <Card className="mt-5 bg-white/[0.04] p-4">
          <SwitchRow
            label="Zezwól dołączać przez konto i kod"
            description="Jeśli włączone, udostępniasz uczestnikom link do dołączania (opcjonalnie z kodem w URL/QR)."
            checked={allowJoinByCodeDraft}
            onChange={setAllowJoinByCodeDraft}
            disabled={savingJoin}
          />

          {allowJoinByCodeDraft ? (
            <>
              <div className="mt-4">
                <div className="mb-2 text-xs font-semibold text-slate-300">Kod dołączania</div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Input
                    value={joinCodeDraft}
                    onChange={(e) => setJoinCodeDraft(e.target.value)}
                    placeholder="np. START2024"
                    maxLength={32}
                    className="w-full sm:max-w-xs"
                    disabled={savingJoin}
                  />
                  <Button type="button" variant="ghost" leftIcon={<X className="h-4 w-4" />} onClick={() => setJoinCodeDraft("")} disabled={savingJoin}>
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

              <Card className="mt-4 bg-white/[0.04] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-extrabold text-slate-100">Link / QR do dołączania</div>
                    <div className="mt-1 text-xs text-slate-300/80 break-words">
                      Link prowadzi do widoku publicznego z aktywnym trybem dołączania.
                    </div>
                  </div>

                  <Checkbox
                    checked={includeJoinCodeInLink}
                    onCheckedChange={setIncludeJoinCodeInLink}
                    label="Kod w linku/QR"
                    description="Dodaje parametr join_code do URL."
                    disabled={!joinCodeDraft.trim()}
                    className="shrink-0"
                  />
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    leftIcon={<Copy className="h-4 w-4" />}
                    onClick={async () => {
                      const ok = await copyToClipboard(joinUrl);
                      if (ok) toast.success("Skopiowano link dołączania.");
                      else toast.error("Nie udało się skopiować linku.", { title: "Schowek" });
                    }}
                  >
                    Kopiuj
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    leftIcon={<Send className="h-4 w-4" />}
                    onClick={async () => {
                      const shared = await nativeShare(joinUrl, tournament.name, "Link do dołączania do turnieju");
                      if (shared) {
                        toast.success("Udostępniono link.");
                        return;
                      }

                      const ok = await copyToClipboard(joinUrl);
                      if (ok) toast.success("Skopiowano link dołączania.");
                      else toast.error("Nie udało się skopiować linku.", { title: "Schowek" });
                    }}
                  >
                    Udostępnij
                  </Button>
                </div>

                <div className="mt-3 break-all rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-slate-200/90">
                  {joinUrl}
                </div>

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
                        if (ok) toast.success("Pobrano QR dołączania.");
                        else toast.error("Nie udało się pobrać QR.", { title: "QR" });
                      }}
                    >
                      Pobierz QR
                    </Button>
                  </div>
                </div>
              </Card>
            </>
          ) : (
            <div className="mt-3 text-sm text-slate-300/80 break-words">Dołączanie przez link i kod jest wyłączone.</div>
          )}
        </Card>
      </Card>
    </div>
  );

  const AssistantsTab = () => {
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
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-base font-extrabold text-slate-100">Asystenci i uprawnienia</div>
              <div className="mt-1 text-sm text-slate-300/90 break-words">
                {isOrganizer ? "Dodawaj asystentów i ustawiaj im zakres uprawnień." : "Dostępne tylko dla organizatora."}
              </div>
            </div>

            {isOrganizer ? (
              <Button type="button" variant="secondary" leftIcon={<Users className="h-4 w-4" />} onClick={() => onLoadAssistants(true)}>
                Odśwież
              </Button>
            ) : null}
          </div>

          {isOrganizer ? (
            <div className="mt-5">
              <Card className="bg-white/[0.04] p-4">
                <div className="text-sm font-extrabold text-slate-100">Dodaj asystenta</div>
                <div className="mt-3">
                  <AddAssistantForm tournamentId={tournament.id} onAdded={() => onLoadAssistants(false)} />
                </div>
              </Card>

              <div
                className={cn(
                  "mt-4",
                  assistants.length === 0
                    ? "text-sm text-slate-300/80"
                    : "grid gap-3 md:grid-cols-2 xl:grid-cols-3 [min-width:2560px]:grid-cols-4"
                )}
              >
                {assistants.length === 0
                  ? "Brak asystentów."
                  : assistants.map((a) => {
                      const draft = assistantDrafts[a.user_id];
                      const busy = Boolean(assistantBusy[a.user_id]);
                      const confirmRemoveOpen = pendingRemoveAssistantId === a.user_id;

                      return (
                        <Card key={a.user_id} className="p-4">
                          <div className="flex flex-wrap items-start justify-between gap-4">
                            <div className="min-w-0">
                              <div className="font-extrabold text-slate-100 break-words">{a.username || a.email}</div>
                              <div className="mt-1 text-xs text-slate-300/80 break-words">{a.email}</div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              <Button type="button" variant="primary" onClick={() => onSaveAssistantPerms(a.user_id)} disabled={busy || !draft}>
                                {busy ? "..." : "Zapisz"}
                              </Button>

                              <Button type="button" variant="ghost" onClick={() => onLoadAssistantPerms(a.user_id)} disabled={busy}>
                                Odśwież
                              </Button>

                              {confirmRemoveOpen ? (
                                <Button type="button" variant="secondary" onClick={() => setPendingRemoveAssistantId(null)} disabled={busy}>
                                  Anuluj
                                </Button>
                              ) : (
                                <Button type="button" variant="danger" onClick={() => setPendingRemoveAssistantId(a.user_id)} disabled={busy}>
                                  Usuń
                                </Button>
                              )}
                            </div>
                          </div>

                          {confirmRemoveOpen ? (
                            <Card className="mt-3 bg-rose-500/10 p-3">
                              <div className="text-sm font-semibold text-rose-200">Potwierdzenie</div>
                              <div className="mt-1 text-xs text-rose-200/90 break-words">
                                Usunięcie asystenta odbierze mu dostęp do panelu turnieju.
                              </div>

                              <div className="mt-3 flex flex-wrap gap-2">
                                <Button type="button" variant="danger" onClick={() => onRemoveAssistant(a.user_id)} disabled={busy}>
                                  Usuń asystenta
                                </Button>
                                <Button type="button" variant="secondary" onClick={() => setPendingRemoveAssistantId(null)} disabled={busy}>
                                  Anuluj
                                </Button>
                              </div>
                            </Card>
                          ) : null}

                          <Card className="mt-4 bg-white/[0.04] p-4">
                            <div className="text-sm font-extrabold text-slate-100">Uprawnienia</div>

                            {!draft ? (
                              <div className="mt-2 text-sm text-slate-300/80">Ładowanie...</div>
                            ) : (
                              <div className="mt-3 space-y-2">
                                {permsList.map((p) => (
                                  <div key={p.key} className="border-b border-white/10 py-2 last:border-none">
                                    <Checkbox
                                      checked={Boolean((draft as any)[p.key])}
                                      onCheckedChange={(v) => onUpdateAssistantDraft(a.user_id, { [p.key]: v } as any)}
                                      label={p.label}
                                      disabled={busy}
                                      className="w-full"
                                    />
                                  </div>
                                ))}
                                <div className="pt-2 text-xs text-slate-300/70 break-words">
                                  Nie obejmuje: publikacji/archiwizacji, zarządzania asystentami i ustawień dołączania.
                                </div>
                              </div>
                            )}
                          </Card>
                        </Card>
                      );
                    })}
              </div>
            </div>
          ) : (
            <div className="mt-5 text-sm text-slate-300/80 break-words">Brak dostępu do tej zakładki.</div>
          )}
        </Card>
      </div>
    );
  };

  const ShareTab = () => (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-base font-extrabold text-slate-100">Udostępnianie (link + QR)</div>
            <div className="mt-1 text-sm text-slate-300/90 break-words">
              Link i QR do widoku publicznego. Opcjonalnie dopinaj kod dostępu do URL.
            </div>
          </div>

          <Button
            type="button"
            variant="secondary"
            leftIcon={<Copy className="h-4 w-4" />}
            onClick={async () => {
              const ok = await copyToClipboard(shareUrl);
              if (ok) toast.success("Skopiowano link.");
              else toast.error("Nie udało się skopiować linku.", { title: "Schowek" });
            }}
          >
            Kopiuj link
          </Button>
        </div>

        {!tournament.is_published ? (
          <Card className="mt-4 bg-amber-500/10 p-4">
            <div className="text-sm text-amber-200 break-words">
              Turniej jest prywatny. Link i QR dla widzów ma sens głównie po publikacji (lub gdy używasz kodu dostępu).
            </div>
          </Card>
        ) : null}

        <Card className="mt-5 bg-white/[0.04] p-4">
          <KeyValue k="Kod dostępu" v={tournament.access_code ? tournament.access_code : <span className="opacity-70">brak</span>} />

          <div className="pt-3">
            <Checkbox
              checked={includeShareCodeInLink}
              onCheckedChange={setIncludeShareCodeInLink}
              label="Kod w linku/QR"
              description={!shareAccessCodeValue ? "Aby dopinać kod, ustaw go w 'Dostęp i opis'." : "Dodaje parametr code do URL."}
              disabled={!shareAccessCodeValue}
            />

            <div className="mt-3 flex flex-wrap items-center gap-2">
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
                  if (ok) toast.success("Skopiowano link.");
                  else toast.error("Nie udało się skopiować linku.", { title: "Schowek" });
                }}
              >
                Udostępnij
              </Button>
            </div>

            <div className="mt-3 break-all rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-slate-200/90">
              {shareUrl}
            </div>

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
                    if (ok) toast.success("Pobrano QR.");
                    else toast.error("Nie udało się pobrać QR.", { title: "QR" });
                  }}
                >
                  Pobierz QR
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </Card>
    </div>
  );

  const PermissionsTab = () => (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="text-base font-extrabold text-slate-100">Twoje uprawnienia</div>
        <div className="mt-1 text-sm text-slate-300/90 break-words">Podgląd efektywnych uprawnień.</div>

        <Card className="mt-5 bg-white/[0.04] p-4">
          <KeyValue k="Rola" v={formatRoleLabel(tournament.my_role)} />
          <KeyValue k="Turniej" v={`ID ${tournament.id}`} />
        </Card>

        <Card className="mt-4 bg-white/[0.04] p-4">
          {!tournament.my_permissions ? (
            <div className="text-sm text-slate-300/80 break-words">Brak danych o uprawnieniach (backend nie zwrócił my_permissions).</div>
          ) : (
            <div className="space-y-1 text-sm">
              <PermLine label="Edycja drużyn" ok={!!tournament.my_permissions.teams_edit} />
              <PermLine label="Składy: zawodnicy" ok={!!tournament.my_permissions.roster_edit} />
              <PermLine label="Edycja harmonogramu" ok={!!tournament.my_permissions.schedule_edit} />
              <PermLine label="Wprowadzanie wyników" ok={!!tournament.my_permissions.results_edit} />
              <PermLine label="Edycja drabinki" ok={!!tournament.my_permissions.bracket_edit} />
              <PermLine label="Edycja ustawień turnieju" ok={!!tournament.my_permissions.tournament_edit} />
              <PermLine label="Akceptacja zmian nazw" ok={!!tournament.my_permissions.name_change_approve} />
              <div className="pt-2 text-xs text-slate-300/70 break-words">
                Publikacja/archiwizacja oraz zarządzanie asystentami są zarezerwowane dla organizatora.
              </div>
            </div>
          )}
        </Card>
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
    return <OverviewTab />;
  };

  return (
    <div className="w-full">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
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
          <Button type="button" variant="secondary" leftIcon={<LinkIcon className="h-4 w-4" />} onClick={onOpenPublicView}>
            Publiczny widok
          </Button>

          <Button
            type="button"
            variant="ghost"
            leftIcon={<Copy className="h-4 w-4" />}
            onClick={async () => {
              const ok = await copyToClipboard(basePublicUrl);
              if (ok) toast.success("Skopiowano link publiczny.");
              else toast.error("Nie udało się skopiować linku.", { title: "Schowek" });
            }}
          >
            Kopiuj link
          </Button>

          <Button type="button" variant="ghost" onClick={onRefresh}>
            Odśwież
          </Button>
        </div>
      </div>

      <div className="mb-4 md:hidden">
        <Select<TabKey>
          value={activeTab}
          onChange={setTab}
          options={allowedTabs.map((t) => ({ value: t.key, label: t.label, leftIcon: t.icon }))}
          ariaLabel="Wybór zakładki"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-[260px_1fr] xl:grid-cols-[280px_1fr]">
        <Card className="hidden p-3 md:block">
          <div className="sticky top-4">
            <div className="px-2 pb-2 text-xs font-extrabold uppercase tracking-wider text-slate-300/70">Menu</div>
            <div className="space-y-1">
              {allowedTabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold",
                    activeTab === t.key ? "bg-white/15 text-white" : "text-slate-200 hover:bg-white/10"
                  )}
                >
                  {t.icon}
                  <span className="min-w-0 break-words">{t.label}</span>
                </button>
              ))}
            </div>

            <Card className="mt-4 bg-white/[0.04] p-3">
              <div className="text-xs font-extrabold text-slate-200/90">Skrót</div>
              <div className="mt-2 text-xs text-slate-300/80">
                Ustawienia publikacji i kod: <b>Dostęp i opis</b>
                <br />
                Join: <b>Dołączanie</b>
                <br />
                Link i QR: <b>Udostępnianie</b>
              </div>
            </Card>

            {loadError ? (
              <Card className="mt-3 bg-white/[0.04] p-3">
                <div className="flex items-start gap-2 text-xs text-slate-300/80">
                  <BarChart3 className="mt-0.5 h-4 w-4 shrink-0 text-slate-300/70" />
                  <div className="min-w-0 break-words">Ostatnie odświeżenie nie powiodło się.</div>
                </div>
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