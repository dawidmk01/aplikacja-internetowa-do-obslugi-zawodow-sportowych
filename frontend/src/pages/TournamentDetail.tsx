// frontend/src/pages/TournamentDetail.tsx
// Strona obsługuje szczegóły turnieju oraz konfigurację dostępu i asystentów.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { apiFetch } from "../api";
import { cn } from "../lib/cn";
import { useTournamentWs, type TournamentWsEvent } from "../hooks/useTournamentWs";

import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Input } from "../ui/Input";
import { toast } from "../ui/Toast";

import {
  DESCRIPTION_MAX,
  TournamentDetailTabs,
  getAllowedTabs,
  type AssistantListItem,
  type AssistantPermissionsPayload,
  type TabKey,
  type Tournament,
} from "./_components/TournamentDetailTabs";

async function readDetail(res: Response): Promise<string | null> {
  const data = await res.json().catch(() => null);
  const detail = data && typeof data === "object" ? (data as any).detail : null;
  return typeof detail === "string" && detail.trim() ? detail.trim() : null;
}

function extractList(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

function buildRenameApprovalPatch(tournament: Tournament, renameRequiresApproval: boolean): Partial<Tournament> {
  if (Object.prototype.hasOwnProperty.call(tournament, "participants_self_rename_enabled")) {
    return { participants_self_rename_enabled: !renameRequiresApproval } as any;
  }
  if (Object.prototype.hasOwnProperty.call(tournament, "participants_self_rename_requires_approval")) {
    return { participants_self_rename_requires_approval: renameRequiresApproval } as any;
  }
  if (Object.prototype.hasOwnProperty.call(tournament, "participants_self_rename_approval_required")) {
    return { participants_self_rename_approval_required: renameRequiresApproval } as any;
  }
  return { participants_self_rename_requires_approval: renameRequiresApproval } as any;
}

export default function TournamentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [loading, setLoading] = useState(true);

  const [needsCode, setNeedsCode] = useState(false);
  const [accessCode, setAccessCode] = useState("");
  const accessCodeRef = useRef("");

  const [loadError, setLoadError] = useState<string | null>(null);

  const [isPublishedDraft, setIsPublishedDraft] = useState(false);
  const [accessCodeDraft, setAccessCodeDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");

  const [savingSettings, setSavingSettings] = useState(false);

  const [allowJoinByCodeDraft, setAllowJoinByCodeDraft] = useState(false);
  const [joinCodeDraft, setJoinCodeDraft] = useState("");
  const [participantsPreviewDraft, setParticipantsPreviewDraft] = useState(false);
  const [renameRequiresApprovalDraft, setRenameRequiresApprovalDraft] = useState(false);
  const [includeJoinCodeInLink, setIncludeJoinCodeInLink] = useState(false);
  const [includeShareCodeInLink, setIncludeShareCodeInLink] = useState(false);

  const [savingJoin, setSavingJoin] = useState(false);

  const [assistants, setAssistants] = useState<AssistantListItem[]>([]);
  const [assistantDrafts, setAssistantDrafts] = useState<Record<number, Required<AssistantPermissionsPayload>>>({});
  const [assistantBusy, setAssistantBusy] = useState<Record<number, boolean>>({});
  const [pendingRemoveAssistantId, setPendingRemoveAssistantId] = useState<number | null>(null);

  const [assistantPermsBump, setAssistantPermsBump] = useState(0);

  const [myUserId, setMyUserId] = useState<number | null>(null);
  const myUserIdRef = useRef<number | null>(null);
  const lastPermsRefreshAtRef = useRef<number>(0);

  useEffect(() => {
    accessCodeRef.current = accessCode;
  }, [accessCode]);

  useEffect(() => {
    myUserIdRef.current = myUserId;
  }, [myUserId]);

  const isOrganizer = tournament?.my_role === "ORGANIZER";
  const canManage = tournament?.my_role === "ORGANIZER" || tournament?.my_role === "ASSISTANT";

  const activeTab = (searchParams.get("tab") as TabKey | null) ?? "overview";

  const setTab = useCallback(
    (k: TabKey) => {
      const next = new URLSearchParams(searchParams);
      next.set("tab", k);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const allowedTabs = useMemo(() => getAllowedTabs(Boolean(isOrganizer), Boolean(canManage)), [isOrganizer, canManage]);

  useEffect(() => {
    if (!allowedTabs.some((t) => t.key === activeTab)) {
      setTab(allowedTabs[0]?.key ?? "overview");
    }
  }, [activeTab, allowedTabs, setTab]);

  const applyPatchedTournament = useCallback((patch: Partial<Tournament>, responseBody: any) => {
    setTournament((prev) => {
      if (!prev) return prev;
      const merged: any = { ...prev, ...patch };
      if (responseBody && typeof responseBody === "object") {
        for (const k of Object.keys(responseBody)) merged[k] = (responseBody as any)[k];
      }
      return merged as Tournament;
    });
  }, []);

  const fetchTournament = useCallback(async () => {
    if (!id) return;

    setLoading(true);
    setLoadError(null);

    try {
      const code = accessCodeRef.current.trim();
      const url = `/api/tournaments/${id}/` + (code ? `?code=${encodeURIComponent(code)}` : "");
      const res = await apiFetch(url, { toastOnError: false });

      if (res.status === 403) {
        const detail = await readDetail(res);
        if ((detail || "").toLowerCase().includes("kod")) {
          setNeedsCode(true);
          throw new Error("Wymagany poprawny kod dostępu.");
        }
        throw new Error(detail || "Brak dostępu do turnieju.");
      }

      if (!res.ok) throw new Error((await readDetail(res)) || "Nie udało się pobrać danych turnieju.");

      const data = (await res.json().catch(() => null)) as Tournament | null;
      if (!data) throw new Error("Nie udało się odczytać danych turnieju.");

      setTournament(data);

      setIsPublishedDraft(Boolean(data.is_published));
      setAccessCodeDraft(data.access_code ?? "");
      setDescriptionDraft(data.description ?? "");

      setAllowJoinByCodeDraft(Boolean((data as any).allow_join_by_code ?? false));
      setJoinCodeDraft(((data as any).join_code ?? "") as string);

      setParticipantsPreviewDraft(Boolean((data as any).participants_public_preview_enabled ?? false));

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
    } catch (e: any) {
      const msg = e?.message ?? "Błąd połączenia z serwerem.";
      setLoadError(msg);
      toast.error(msg, { title: "Turniej" });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchTournament();
  }, [fetchTournament]);

  useEffect(() => {
    if (!tournament) return;
    if (tournament.my_role !== "ASSISTANT") {
      setMyUserId(null);
      return;
    }
    if (myUserIdRef.current != null) return;

    let cancelled = false;

    (async () => {
      try {
        const res = await apiFetch("/api/auth/me/", { toastOnError: false });
        const me = await res.json().catch(() => null);
        if (!res.ok || !me) return;

        const uid = (me as any).id ?? (me as any).user_id ?? (me as any).pk ?? null;
        if (!uid || cancelled) return;

        setMyUserId(Number(uid));
      } catch {
        return;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tournament]);

  const onOpenPublicView = useCallback(() => {
    if (!tournament) return;
    navigate(`/tournaments/${tournament.id}`);
  }, [navigate, tournament]);

  const onRefresh = useCallback(() => {
    fetchTournament();
  }, [fetchTournament]);

  const loadAssistants = useCallback(
    async (showSuccessToast?: boolean) => {
      if (!id) return;

      try {
        const res = await apiFetch(`/api/tournaments/${id}/assistants/`, { toastOnError: false });
        if (!res.ok) throw new Error((await readDetail(res)) || "Nie udało się pobrać listy asystentów.");

        const raw = await res.json().catch(() => []);
        const list: AssistantListItem[] = extractList(raw) as any;

        setAssistants(list);

        const ids = new Set(list.map((x) => x.user_id));

        setAssistantDrafts((prev) => {
          const next: Record<number, Required<AssistantPermissionsPayload>> = {};
          for (const uid of Object.keys(prev)) {
            const idNum = Number(uid);
            if (ids.has(idNum)) next[idNum] = prev[idNum];
          }
          return next;
        });

        setAssistantBusy((prev) => {
          const next: Record<number, boolean> = {};
          for (const uid of Object.keys(prev)) {
            const idNum = Number(uid);
            if (ids.has(idNum)) next[idNum] = prev[idNum];
          }
          return next;
        });

        setPendingRemoveAssistantId((prev) => (prev != null && !ids.has(prev) ? null : prev));

        if (showSuccessToast) toast.success("Odświeżono listę asystentów.");
      } catch (e: any) {
        toast.error(e?.message ?? "Błąd pobierania asystentów.", { title: "Asystenci" });
        setAssistants([]);
      }
    },
    [id]
  );

  useEffect(() => {
    if (!id) return;
    if (!isOrganizer) return;
    loadAssistants(false);
  }, [id, isOrganizer, loadAssistants]);

  const loadAssistantPerms = useCallback(
    async (userId: number) => {
      if (!id) return;

      setAssistantBusy((m) => ({ ...m, [userId]: true }));

      try {
        const res = await apiFetch(`/api/tournaments/${id}/assistants/${userId}/permissions/`, { toastOnError: false });
        if (res.status === 404) {
          setAssistants((prev) => prev.filter((a) => a.user_id !== userId));
          setAssistantDrafts((m) => {
            const copy = { ...m };
            delete copy[userId];
            return copy;
          });
          return;
        }
        if (!res.ok) throw new Error((await readDetail(res)) || "Nie udało się pobrać uprawnień asystenta.");

        const data = (await res.json().catch(() => null)) as any;
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
        toast.error(e?.message ?? "Błąd pobierania uprawnień.", { title: "Asystenci" });
      } finally {
        setAssistantBusy((m) => ({ ...m, [userId]: false }));
      }
    },
    [id]
  );

  useEffect(() => {
    if (!isOrganizer) return;
    for (const a of assistants) {
      if (!assistantDrafts[a.user_id]) {
        loadAssistantPerms(a.user_id);
      }
    }
  }, [assistants, assistantDrafts, isOrganizer, loadAssistantPerms]);

  const updateAssistantDraft = useCallback((userId: number, patch: Partial<Required<AssistantPermissionsPayload>>) => {
    setAssistantDrafts((m) => {
      const prev = m[userId] ?? {
        teams_edit: false,
        schedule_edit: false,
        results_edit: false,
        bracket_edit: false,
        tournament_edit: false,
        roster_edit: false,
        name_change_approve: false,
      };
      return { ...m, [userId]: { ...prev, ...patch } };
    });
  }, []);

  const saveAssistantPerms = useCallback(
    async (userId: number) => {
      if (!id) return;
      const draft = assistantDrafts[userId];
      if (!draft) return;

      setAssistantBusy((m) => ({ ...m, [userId]: true }));

      try {
        const payload: AssistantPermissionsPayload = { ...draft };
        const res = await apiFetch(`/api/tournaments/${id}/assistants/${userId}/permissions/`, {
          toastOnError: false,
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const data = await res.json().catch(() => ({}));
        if (res.status === 404) {
          setAssistants((prev) => prev.filter((a) => a.user_id !== userId));
          setAssistantDrafts((m) => {
            const copy = { ...m };
            delete copy[userId];
            return copy;
          });
          throw new Error((data as any)?.detail || "Nie znaleziono asystenta.");
        }
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
        toast.success("Uprawnienia asystenta zapisane.");
      } catch (e: any) {
        toast.error(e?.message ?? "Błąd zapisu uprawnień.", { title: "Asystenci" });
      } finally {
        setAssistantBusy((m) => ({ ...m, [userId]: false }));
      }
    },
    [assistantDrafts, id]
  );

  const removeAssistant = useCallback(
    async (userId: number) => {
      if (!id) return;

      setAssistantBusy((m) => ({ ...m, [userId]: true }));

      try {
        const res = await apiFetch(`/api/tournaments/${id}/assistants/${userId}/remove/`, {
          toastOnError: false,
          method: "DELETE",
        });

        if (!res.ok) throw new Error((await readDetail(res)) || "Nie udało się usunąć asystenta.");

        setAssistants((prev) => prev.filter((a) => a.user_id !== userId));
        setAssistantDrafts((m) => {
          const copy = { ...m };
          delete copy[userId];
          return copy;
        });

        toast.success("Asystent usunięty.");
      } catch (e: any) {
        toast.error(e?.message ?? "Błąd usuwania asystenta.", { title: "Asystenci" });
      } finally {
        setAssistantBusy((m) => ({ ...m, [userId]: false }));
        setPendingRemoveAssistantId((prev) => (prev === userId ? null : prev));
      }
    },
    [id]
  );

  const onWsEvent = useCallback(
    (evt: TournamentWsEvent) => {
      if (evt?.v !== 1) return;
      if (evt.type !== "permissions.changed") return;
      if (!tournament) return;
      if (evt.tournamentId !== tournament.id) return;

      if (tournament.my_role === "ORGANIZER") {
        const action = typeof (evt as any).action === "string" ? String((evt as any).action) : "";

        if (action == "assistant_removed" && typeof evt.userId === "number") {
          const removedUserId = evt.userId;

          setAssistants((prev) => prev.filter((a) => a.user_id !== removedUserId));
          setAssistantDrafts((prev) => {
            const copy = { ...prev };
            delete copy[removedUserId];
            return copy;
          });
        }

        loadAssistants(false);

        if (action == "assistant_permissions_updated" && typeof evt.userId === "number") {
          loadAssistantPerms(evt.userId);
        }
        return;
      }

      if (tournament.my_role === "ASSISTANT") {
        const mine = myUserIdRef.current;
        if (typeof evt.userId === "number" && mine != null && evt.userId !== mine) return;
        setAssistantPermsBump((x) => x + 1);
      }
    },
    [loadAssistants, loadAssistantPerms, tournament]
  );

  useTournamentWs({
    tournamentId: tournament?.id ?? null,
    enabled: Boolean(tournament) && !needsCode,
    onEvent: onWsEvent,
  });

  useEffect(() => {
    if (!id) return;
    if (!tournament) return;
    if (tournament.my_role !== "ASSISTANT") return;
    if (!myUserId) return;

    const now = Date.now();
    if (now - lastPermsRefreshAtRef.current < 600) return;
    lastPermsRefreshAtRef.current = now;

    let cancelled = false;

    (async () => {
      try {
        const pRes = await apiFetch(`/api/tournaments/${id}/assistants/${myUserId}/permissions/`, { toastOnError: false });
        const pdata = await pRes.json().catch(() => null);
        if (!pRes.ok || !pdata) return;

        const eff = (pdata as any).effective ?? pdata ?? {};
        if (cancelled) return;

        setTournament((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            my_permissions: {
              teams_edit: Boolean(eff.teams_edit),
              schedule_edit: Boolean(eff.schedule_edit),
              results_edit: Boolean(eff.results_edit),
              bracket_edit: Boolean(eff.bracket_edit),
              tournament_edit: Boolean(eff.tournament_edit),
              roster_edit: Boolean(eff.roster_edit),
              name_change_approve: Boolean(eff.name_change_approve),

              publish: Boolean(eff.publish),
              archive: Boolean(eff.archive),
              manage_assistants: Boolean(eff.manage_assistants),
              join_settings: Boolean(eff.join_settings),
            },
          } as Tournament;
        });
      } catch {
        return;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [assistantPermsBump, id, myUserId, tournament?.my_role]);

  const saveSettings = useCallback(async () => {
    if (!tournament) return;

    const normalizedCode = accessCodeDraft.trim();
    const normalizedDesc = descriptionDraft.trim();

    if (normalizedDesc.length > DESCRIPTION_MAX) {
      toast.error(`Opis jest za długi (max ${DESCRIPTION_MAX} znaków).`, { title: "Dostęp i opis" });
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
        toastOnError: false,
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any)?.detail || "Nie udało się zapisać ustawień.");

      applyPatchedTournament(payload, data);

      setIsPublishedDraft(
        Object.prototype.hasOwnProperty.call(data, "is_published") ? Boolean((data as any).is_published) : Boolean(payload.is_published)
      );
      setAccessCodeDraft(
        Object.prototype.hasOwnProperty.call(data, "access_code") ? ((data as any).access_code ?? "") : ((payload.access_code ?? "") as string)
      );
      setDescriptionDraft(
        Object.prototype.hasOwnProperty.call(data, "description") ? ((data as any).description ?? "") : ((payload.description ?? "") as string)
      );

      toast.success("Ustawienia zapisane.");
    } catch (e: any) {
      toast.error(e?.message || "Błąd połączenia z serwerem.", { title: "Dostęp i opis" });
    } finally {
      setSavingSettings(false);
    }
  }, [applyPatchedTournament, descriptionDraft, accessCodeDraft, isPublishedDraft, tournament]);

  const saveJoinAndParticipantSettings = useCallback(async () => {
    if (!tournament) return;

    const normalizedJoinCode = joinCodeDraft.trim();

    if (allowJoinByCodeDraft && normalizedJoinCode.length < 3) {
      toast.error("Dla dołączania przez kod wymagany jest kod (min. 3 znaki).", { title: "Dołączanie" });
      return;
    }

    setSavingJoin(true);

    try {
      const payload: Partial<Tournament> = {
        allow_join_by_code: allowJoinByCodeDraft as any,
        join_code: (allowJoinByCodeDraft ? normalizedJoinCode : null) as any,
        participants_public_preview_enabled: participantsPreviewDraft as any,
        ...buildRenameApprovalPatch(tournament, renameRequiresApprovalDraft),
      };

      const res = await apiFetch(`/api/tournaments/${tournament.id}/`, {
        toastOnError: false,
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any)?.detail || "Nie udało się zapisać ustawień dołączania.");

      applyPatchedTournament(payload, data);

      const nextAllow = Object.prototype.hasOwnProperty.call(data, "allow_join_by_code")
        ? Boolean((data as any).allow_join_by_code)
        : Boolean((payload as any).allow_join_by_code);

      const nextJoinCode = Object.prototype.hasOwnProperty.call(data, "join_code")
        ? ((data as any).join_code ?? "")
        : (((payload as any).join_code ?? "") as string);

      setAllowJoinByCodeDraft(nextAllow);
      setJoinCodeDraft(nextJoinCode);

      const nextPreview = Object.prototype.hasOwnProperty.call(data, "participants_public_preview_enabled")
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

      toast.success("Ustawienia dołączania zapisane.");
    } catch (e: any) {
      toast.error(e?.message || "Błąd połączenia z serwerem.", { title: "Dołączanie" });
    } finally {
      setSavingJoin(false);
    }
  }, [allowJoinByCodeDraft, applyPatchedTournament, joinCodeDraft, participantsPreviewDraft, renameRequiresApprovalDraft, tournament]);

  const generateTournament = useCallback(async () => {
    if (!tournament) return;

    try {
      const res = await apiFetch(`/api/tournaments/${tournament.id}/generate/`, { toastOnError: false, method: "POST" });
      if (!res.ok) throw new Error((await readDetail(res)) || "Nie udało się wygenerować rozgrywek.");

      await res.json().catch(() => null);
      await fetchTournament();

      toast.success("Rozgrywki wygenerowane.");
    } catch (e: any) {
      toast.error(e?.message ?? "Błąd generowania rozgrywek.", { title: "Narzędzia" });
    }
  }, [fetchTournament, tournament]);

  if (needsCode) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 py-8">
        <Card className="p-6">
          <div className="text-lg font-extrabold text-slate-100">Dostęp do turnieju</div>
          <div className="mt-2 text-sm text-slate-300/90 break-words">Ten turniej wymaga kodu dostępu.</div>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="w-full sm:flex-1">
              <Input id="tournament-access-code" name="tournamentAccessCode" autoComplete="off" value={accessCode} onChange={(e) => setAccessCode(e.target.value)} placeholder="Kod dostępu" />
            </div>

            <Button type="button" variant="primary" onClick={fetchTournament}>
              Potwierdź
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (loading) {
    return <div className="px-4 py-8 text-slate-200">Ładowanie...</div>;
  }

  if (!tournament) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 py-8">
        <Card className="p-6">
          <div className="text-lg font-extrabold text-slate-100">Nie można otworzyć panelu</div>
          <div className="mt-2 text-sm text-slate-300/90 break-words">Użyj przycisku poniżej, aby spróbować ponownie.</div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={fetchTournament}>
              Spróbuj ponownie
            </Button>
            <Button type="button" variant="ghost" onClick={() => navigate("/my-tournaments")}>
              Wróć do moich turniejów
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "mx-auto w-full py-6 px-4 sm:px-6",
        "max-w-7xl",
        "2xl:max-w-[96rem]",
        "[min-width:1920px]:max-w-[110rem]",
        "[min-width:2560px]:max-w-[128rem]"
      )}
    >
      <TournamentDetailTabs
        tournament={tournament}
        activeTab={activeTab}
        setTab={setTab}
        allowedTabs={allowedTabs}
        isOrganizer={Boolean(isOrganizer)}
        canManage={Boolean(canManage)}
        loadError={loadError}
        onOpenPublicView={onOpenPublicView}
        onRefresh={onRefresh}
        isPublishedDraft={isPublishedDraft}
        setIsPublishedDraft={setIsPublishedDraft}
        accessCodeDraft={accessCodeDraft}
        setAccessCodeDraft={setAccessCodeDraft}
        descriptionDraft={descriptionDraft}
        setDescriptionDraft={setDescriptionDraft}
        savingSettings={savingSettings}
        onSaveSettings={saveSettings}
        allowJoinByCodeDraft={allowJoinByCodeDraft}
        setAllowJoinByCodeDraft={setAllowJoinByCodeDraft}
        joinCodeDraft={joinCodeDraft}
        setJoinCodeDraft={setJoinCodeDraft}
        participantsPreviewDraft={participantsPreviewDraft}
        setParticipantsPreviewDraft={setParticipantsPreviewDraft}
        renameRequiresApprovalDraft={renameRequiresApprovalDraft}
        setRenameRequiresApprovalDraft={setRenameRequiresApprovalDraft}
        includeJoinCodeInLink={includeJoinCodeInLink}
        setIncludeJoinCodeInLink={setIncludeJoinCodeInLink}
        savingJoin={savingJoin}
        onSaveJoinAndParticipantSettings={saveJoinAndParticipantSettings}
        includeShareCodeInLink={includeShareCodeInLink}
        setIncludeShareCodeInLink={setIncludeShareCodeInLink}
        assistants={assistants}
        assistantDrafts={assistantDrafts}
        assistantBusy={assistantBusy}
        pendingRemoveAssistantId={pendingRemoveAssistantId}
        setPendingRemoveAssistantId={setPendingRemoveAssistantId}
        onLoadAssistants={loadAssistants}
        onLoadAssistantPerms={loadAssistantPerms}
        onSaveAssistantPerms={saveAssistantPerms}
        onRemoveAssistant={removeAssistant}
        onUpdateAssistantDraft={updateAssistantDraft}
        onGenerateTournament={generateTournament}
      />
    </div>
  );
}
