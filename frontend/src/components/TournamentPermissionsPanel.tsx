import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { apiFetch } from "../api";
import { cn } from "../lib/cn";

import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Checkbox } from "../ui/Checkbox";
import { InlineAlert } from "../ui/InlineAlert";
import { Select, type SelectOption } from "../ui/Select";

import AddAssistantForm from "./AddAssistantForm";
import AssistantsList from "./AssistantsList";

type EntryMode = "MANAGER" | "ORGANIZER_ONLY";

type TournamentDTO = {
  id: number;
  name: string;

  status?: "DRAFT" | "CONFIGURED" | "RUNNING" | "FINISHED";
  is_published?: boolean;

  access_code?: string | null;

  entry_mode?: EntryMode | "SELF_REGISTER";

  allow_join_by_code?: boolean;
  join_code?: string | null;

  my_role?: "ORGANIZER" | "ASSISTANT" | "PARTICIPANT" | null;
};

function normalizeEntryMode(v: TournamentDTO["entry_mode"]): EntryMode {
  if (v === "ORGANIZER_ONLY") return "ORGANIZER_ONLY";
  return "MANAGER";
}

function entryModeLabel(v: TournamentDTO["entry_mode"]) {
  const m = normalizeEntryMode(v);
  if (m === "MANAGER") return "Organizator + asystenci";
  if (m === "ORGANIZER_ONLY") return "Tylko organizator";
  return "-";
}

function genCode(len = 8) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  try {
    const arr = new Uint32Array(len);
    crypto.getRandomValues(arr);

    let out = "";
    for (let i = 0; i < len; i += 1) out += alphabet[arr[i] % alphabet.length];
    return out;
  } catch {
    let out = "";
    for (let i = 0; i < len; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
    return out;
  }
}

const entryModeOptions: SelectOption<EntryMode>[] = [
  { value: "MANAGER", label: "MANAGER" },
  { value: "ORGANIZER_ONLY", label: "ORGANIZER_ONLY" },
];

export default function TournamentPermissionsPanel({ tournamentId }: { tournamentId: number }) {
  const [t, setT] = useState<TournamentDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [assistantsKey, setAssistantsKey] = useState(0);

  const infoTimerRef = useRef<number | null>(null);

  const isOrganizer = t?.my_role === "ORGANIZER";
  const isAssistant = t?.my_role === "ASSISTANT";

  const canSeePanel = isOrganizer || isAssistant;

  const origin = useMemo(() => {
    if (typeof window === "undefined") return "";
    return window.location.origin;
  }, []);

  const basePublicLink = useMemo(() => {
    return `${origin}/tournaments/${tournamentId}`;
  }, [origin, tournamentId]);

  const joinLink = useMemo(() => {
    const ac = (t?.access_code ?? "").trim();
    if (ac) return `${basePublicLink}?join=1&code=${encodeURIComponent(ac)}`;
    return `${basePublicLink}?join=1`;
  }, [basePublicLink, t?.access_code]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setInfo(null);

    try {
      const res = await apiFetch(`/api/tournaments/${tournamentId}/`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || "Nie udało się pobrać danych turnieju.");

      const dto = data as TournamentDTO;
      dto.entry_mode = normalizeEntryMode(dto.entry_mode);
      setT(dto);
    } catch (e: any) {
      setError(e?.message ?? "Błąd ładowania.");
    } finally {
      setLoading(false);
    }
  }, [tournamentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const clearInfoTimer = useCallback(() => {
    if (infoTimerRef.current) {
      window.clearTimeout(infoTimerRef.current);
      infoTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearInfoTimer();
    };
  }, [clearInfoTimer]);

  const patchTournament = useCallback(
    async (payload: Partial<TournamentDTO>) => {
      setBusy(true);
      setError(null);
      setInfo(null);
      clearInfoTimer();

      try {
        const res = await apiFetch(`/api/tournaments/${tournamentId}/`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.detail || "Nie udało się zapisać zmian.");

        const dto = data as TournamentDTO;
        dto.entry_mode = normalizeEntryMode(dto.entry_mode);

        setT(dto);
        setInfo("Zapisano.");

        infoTimerRef.current = window.setTimeout(() => setInfo(null), 1800);
      } catch (e: any) {
        setError(e?.message ?? "Błąd zapisu.");
      } finally {
        setBusy(false);
      }
    },
    [clearInfoTimer, tournamentId]
  );

  if (!canSeePanel) return null;

  const stickyTop = "top-[calc(var(--app-navbar-h,84px)+var(--app-flowbar-h,0px)+12px)]";

  const sectionTitle = "text-sm font-semibold text-white";
  const helperText = "text-xs text-slate-300 leading-relaxed";

  const entryModeButtonClass = cn(
    "h-10 w-full rounded-2xl border border-white/10 bg-white/[0.06] px-3 text-sm text-slate-100",
    "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/10",
    "disabled:opacity-60"
  );

  return (
    <aside className={cn("sticky", stickyTop, "w-full max-w-[520px]")}>
      <Card className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-semibold text-white">Uprawnienia i dostęp</div>
            <div className="mt-1 text-xs text-slate-300">
              Konfiguracja trybu panelu, dołączania oraz zarządzania asystentami.
            </div>
          </div>
        </div>

        {loading ? <div className="mt-4 text-sm text-slate-200/80">Ładowanie...</div> : null}

        {error ? (
          <div className="mt-4">
            <InlineAlert variant="error">{error}</InlineAlert>
          </div>
        ) : null}

        {info ? (
          <div className="mt-4">
            <InlineAlert variant="success">{info}</InlineAlert>
          </div>
        ) : null}

        {!loading && t ? (
          <div className="mt-4 space-y-5">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <div className="text-sm font-semibold text-white">{t.name}</div>
              <div className="mt-1 text-xs text-slate-300">Rola: {t.my_role ?? "-"}</div>
            </div>

            <section className="space-y-3 border-t border-white/10 pt-4">
              <div className={sectionTitle}>Tryb panelu zarządzania</div>

              <div className={helperText}>
                Steruje tym, kto może edytować w panelu. Dołączanie uczestników jest osobnym przełącznikiem.
              </div>

              <div className="text-xs text-slate-300">
                Aktualnie: <span className="font-semibold text-white">{entryModeLabel(t.entry_mode)}</span>
              </div>

              <div className="block">
                <span className="sr-only">Wybierz tryb panelu</span>
                <Select<EntryMode>
                  value={normalizeEntryMode(t.entry_mode)}
                  onChange={(v) => patchTournament({ entry_mode: v })}
                  options={entryModeOptions}
                  disabled={!isOrganizer || busy}
                  ariaLabel="Wybierz tryb panelu"
                  className="w-full"
                  buttonClassName={cn(entryModeButtonClass, "rounded-2xl")}
                  menuClassName="rounded-2xl"
                  size="md"
                  align="start"
                />
              </div>

              {!isOrganizer ? (
                <div className={helperText}>Zmiana trybu panelu jest dostępna tylko dla organizatora.</div>
              ) : null}
            </section>

            <section className="space-y-3 border-t border-white/10 pt-4">
              <div className={sectionTitle}>Dołączanie uczestników (konto + kod)</div>

              <div className={helperText}>
                To nie jest entry_mode. To osobny przełącznik: użytkownik (zalogowany) może wejść przez link + kod.
              </div>

              <Checkbox
                checked={!!t.allow_join_by_code}
                onCheckedChange={(checked) => patchTournament({ allow_join_by_code: checked })}
                disabled={!isOrganizer || busy}
                className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3"
                boxClassName={cn(
                  "mt-0 h-4 w-4 rounded border-white/20 bg-white/[0.06]",
                  "peer-focus-visible:ring-4 peer-focus-visible:ring-white/10"
                )}
                label={<span className="text-sm text-slate-200 font-normal">Zezwól uczestnikom dołączać przez konto i kod</span>}
              />

              {!t.allow_join_by_code ? (
                <div className={helperText}>Dołączanie jest wyłączone.</div>
              ) : (
                <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <div className={helperText}>Link do dołączenia (wymaga loginu):</div>

                  <code className="block rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-slate-100 break-all">
                    {joinLink}
                  </code>

                  <div className={helperText}>Kod dołączania:</div>

                  <div className="flex flex-wrap items-center gap-2">
                    <code className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-100">
                      {(t.join_code ?? "").trim() ? t.join_code : "-"}
                    </code>

                    {isOrganizer ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="h-9 rounded-xl px-3"
                        disabled={busy}
                        onClick={() => patchTournament({ join_code: genCode(8) })}
                      >
                        Wygeneruj kod
                      </Button>
                    ) : null}
                  </div>

                  {!isOrganizer ? (
                    <div className={helperText}>Kod i ustawienia dołączania może zmieniać tylko organizator.</div>
                  ) : null}
                </div>
              )}
            </section>

            <section className="space-y-3 border-t border-white/10 pt-4">
              <div className={sectionTitle}>Asystenci</div>

              {isOrganizer ? (
                <AddAssistantForm tournamentId={tournamentId} onAdded={() => setAssistantsKey((k) => k + 1)} />
              ) : (
                <div className={helperText}>Dodawanie/usuwanie asystentów jest dostępne tylko dla organizatora.</div>
              )}

              <div className="mt-2">
                <AssistantsList key={assistantsKey} tournamentId={tournamentId} canManage={!!isOrganizer} />
              </div>

              <div className={helperText}>
                Uprawnienia per-asystent konfigurujesz w liście asystentów. Panel nie blokuje stron - ogranicza tylko
                akcje edycyjne.
              </div>
            </section>
          </div>
        ) : null}
      </Card>
    </aside>
  );
}
