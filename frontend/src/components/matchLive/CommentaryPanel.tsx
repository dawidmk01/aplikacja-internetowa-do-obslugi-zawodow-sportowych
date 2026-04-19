import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { apiFetch } from "../../api";
import { cn } from "../../lib/cn";

import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";
import { Input } from "../../ui/Input";
import { Textarea } from "../../ui/Textarea";
import { Select, type SelectOption } from "../../ui/Select";
import { toast } from "../../ui/Toast";

type LiveCommentaryEntryDTO = {
  id: number;
  match_id: number;
  period?: string | null;
  time_source?: "CLOCK" | "MANUAL" | string;
  minute: number | null;
  minute_raw?: string | null;
  text: string;
  created_at: string | null;
  created_by?: number | null;
};

type PhraseDTO = {
  id: number;
  tournament_id: number;
  kind: "TOKEN" | "TEMPLATE" | string;
  category: string | null;
  text: string;
  order: number;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
};

type UiPhrase = {
  id: number | null;
  text: string;
  kind: "TOKEN" | "TEMPLATE";
};

type DictState = {
  words: UiPhrase[];
  templates: UiPhrase[];
};

type PhraseUiType = "WORD" | "TEMPLATE";

type Props = {
  tournamentId: number;
  matchId: number;
  canEdit: boolean;
  minute: number;
  discipline: string;
  homeTeamName: string;
  awayTeamName: string;
};

function isWrestlingDiscipline(discipline: string): boolean {
  return String(discipline || "").toLowerCase() === "wrestling";
}

function defaultPhrases(discipline: string): DictState {
  if (isWrestlingDiscipline(discipline)) {
    return {
      words: [
        { id: null, kind: "TOKEN", text: "atak" },
        { id: null, kind: "TOKEN", text: "obrona" },
        { id: null, kind: "TOKEN", text: "parter" },
        { id: null, kind: "TOKEN", text: "pasywność" },
        { id: null, kind: "TOKEN", text: "ostrzeżenie" },
        { id: null, kind: "TOKEN", text: "tusz" },
        { id: null, kind: "TOKEN", text: "przewaga techniczna" },
        { id: null, kind: "TOKEN", text: "chwyt" },
        { id: null, kind: "TOKEN", text: "kontra" },
      ],
      templates: [
        { id: null, kind: "TEMPLATE", text: "Dobry atak - ale bez punktu." },
        { id: null, kind: "TEMPLATE", text: "Akcja przenosi się do parteru." },
        { id: null, kind: "TEMPLATE", text: "Zawodnik przejmuje inicjatywę w środku maty." },
        { id: null, kind: "TEMPLATE", text: "Sędzia zwraca uwagę na pasywność." },
        { id: null, kind: "TEMPLATE", text: "Groźna akcja - zawodnik blisko tuszu." },
        { id: null, kind: "TEMPLATE", text: "Kontrola walki po stronie atakującego." },
      ],
    };
  }

  return {
    words: [
      { id: null, kind: "TOKEN", text: "strzał" },
      { id: null, kind: "TOKEN", text: "faul" },
      { id: null, kind: "TOKEN", text: "kontra" },
      { id: null, kind: "TOKEN", text: "rzut rożny" },
      { id: null, kind: "TOKEN", text: "spalony" },
      { id: null, kind: "TOKEN", text: "podanie" },
      { id: null, kind: "TOKEN", text: "pressing" },
      { id: null, kind: "TOKEN", text: "obrona" },
      { id: null, kind: "TOKEN", text: "bramka" },
    ],
    templates: [
      { id: null, kind: "TEMPLATE", text: "Dobra akcja - ale bez efektu." },
      { id: null, kind: "TEMPLATE", text: "Nieudany strzał - piłka obok bramki." },
      { id: null, kind: "TEMPLATE", text: "Groźna sytuacja - bramkarz broni." },
      { id: null, kind: "TEMPLATE", text: "Faul w środku pola." },
      { id: null, kind: "TEMPLATE", text: "Rzut rożny - dośrodkowanie w pole karne." },
      { id: null, kind: "TEMPLATE", text: "Szybka kontra - obrona wraca." },
    ],
  };
}

function periodLabel(period?: string | null): string {
  const value = String(period || "").trim().toUpperCase();
  if (value === "P1") return "1 okres";
  if (value === "BREAK") return "Przerwa";
  if (value === "P2") return "2 okres";
  if (value === "Q1") return "1 kwarta";
  if (value === "Q2") return "2 kwarta";
  if (value === "Q3") return "3 kwarta";
  if (value === "Q4") return "4 kwarta";
  if (value === "OT1" || value === "ET1") return "Dogrywka 1";
  if (value === "OT2" || value === "ET2") return "Dogrywka 2";
  if (value === "FH" || value === "H1") return "1 połowa";
  if (value === "SH" || value === "H2") return "2 połowa";
  return "";
}

function uniqByText(list: UiPhrase[]): UiPhrase[] {
  const seen = new Set<string>();
  const out: UiPhrase[] = [];
  for (const p of list) {
    const key = (p.text || "").trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...p, text: (p.text || "").trim() });
  }
  return out;
}

async function readJsonSafe(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function getApiErrorMessage(data: any, fallback: string): string {
  const msg = String(data?.detail || data?.message || data?.error || "").trim();
  return msg || fallback;
}

function insertAtCursor(el: HTMLTextAreaElement | null, value: string) {
  if (!el) return;

  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;

  const before = el.value.slice(0, start);
  const after = el.value.slice(end);
  const needsSpaceBefore = before.length > 0 && !/\s$/.test(before);
  const needsSpaceAfter = after.length > 0 && !/^\s/.test(after);

  const inserted = `${needsSpaceBefore ? " " : ""}${value}${needsSpaceAfter ? " " : ""}`;
  el.value = before + inserted + after;

  const nextPos = (before + inserted).length;
  el.setSelectionRange(nextPos, nextPos);
  el.focus();
}

const PHRASE_TYPE_OPTIONS: SelectOption<PhraseUiType>[] = [
  { value: "WORD", label: "Słowo" },
  { value: "TEMPLATE", label: "Zwrot" },
];

/** Panel komentarza LIVE obsługuje wpisy minutowe oraz słownik fraz dla szybkiego wprowadzania. */
export function CommentaryPanel({
  tournamentId,
  matchId,
  canEdit,
  minute,
  discipline,
  homeTeamName,
  awayTeamName,
}: Props) {
  const [entries, setEntries] = useState<LiveCommentaryEntryDTO[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);

  const [dict, setDict] = useState<DictState>(() => defaultPhrases(discipline));
  const [dictLoading, setDictLoading] = useState(false);

  const [draft, setDraft] = useState("");
  const [newPhrase, setNewPhrase] = useState("");
  const [newPhraseType, setNewPhraseType] = useState<PhraseUiType>("WORD");

  const [entrySubmitting, setEntrySubmitting] = useState(false);
  const [dictSubmitting, setDictSubmitting] = useState(false);
  const [deletingEntryIds, setDeletingEntryIds] = useState<Record<number, boolean>>({});
  const [deletingPhraseIds, setDeletingPhraseIds] = useState<Record<number, boolean>>({});

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const teams = useMemo(() => {
    const a = (homeTeamName || "Gospodarze").trim();
    const b = (awayTeamName || "Goście").trim();
    return [a, b].filter(Boolean);
  }, [homeTeamName, awayTeamName]);

  const minuteSafe = useMemo(() => Math.max(0, Number(minute || 0)), [minute]);
  const commentaryHeaderLabel = isWrestlingDiscipline(discipline) ? "Czas walki" : "Minuta";
  const commentaryPlaceholder = isWrestlingDiscipline(discipline)
    ? "Np. Dobry chwyt w środku maty, zawodnik przechodzi do parteru..."
    : "Np. Lewandowski biegnie do bramki, nieudany strzał, Real rozpoczyna z pola...";

  useEffect(() => {
    setDraft("");
    setDict(defaultPhrases(discipline));
  }, [matchId, discipline]);

  useEffect(() => {
    let alive = true;

    const loadEntries = async () => {
      setEntriesLoading(true);
      try {
        const res = await apiFetch(
          `/api/matches/${matchId}/commentary/`,
          { method: "GET", toastOnError: false } as any
        );

        const data = await readJsonSafe(res);
        if (!res.ok) {
          throw new Error(getApiErrorMessage(data, "Nie udało się pobrać komentarzy."));
        }

        const list = Array.isArray(data) ? (data as LiveCommentaryEntryDTO[]) : [];
        if (!alive) return;
        setEntries(list);
      } catch (e: any) {
        if (!alive) return;
        toast.error(e?.message ?? "Nie udało się pobrać komentarzy.", { title: "Komentarz LIVE" });
        setEntries([]);
      } finally {
        if (alive) setEntriesLoading(false);
      }
    };

    loadEntries();

    return () => {
      alive = false;
    };
  }, [matchId]);

  useEffect(() => {
    let alive = true;

    const loadDict = async () => {
      setDictLoading(true);
      try {
        const res = await apiFetch(
          `/api/tournaments/${tournamentId}/commentary-phrases/`,
          { method: "GET", toastOnError: false } as any
        );

        const data = await readJsonSafe(res);
        if (!res.ok) {
          throw new Error(getApiErrorMessage(data, "Nie udało się pobrać słownika."));
        }

        const list = Array.isArray(data) ? (data as PhraseDTO[]) : [];
        const active = list.filter((x) => !!x && x.is_active !== false);

        const apiWords: UiPhrase[] = active
          .filter((x) => String(x.kind) === "TOKEN")
          .map((x) => ({ id: x.id, kind: "TOKEN" as const, text: String(x.text || "").trim() }))
          .filter((x) => x.text);

        const apiTemplates: UiPhrase[] = active
          .filter((x) => String(x.kind) === "TEMPLATE")
          .map((x) => ({ id: x.id, kind: "TEMPLATE" as const, text: String(x.text || "").trim() }))
          .filter((x) => x.text);

        const fallback = defaultPhrases();
        const merged: DictState = {
          words: uniqByText([...apiWords, ...fallback.words]),
          templates: uniqByText([...apiTemplates, ...fallback.templates]),
        };

        if (!alive) return;
        setDict(merged);
      } catch (e: any) {
        if (!alive) return;
        toast.error(e?.message ?? "Nie udało się pobrać słownika.", { title: "Komentarz LIVE" });
        setDict(defaultPhrases(discipline));
      } finally {
        if (alive) setDictLoading(false);
      }
    };

    loadDict();

    return () => {
      alive = false;
    };
  }, [tournamentId]);

  const insertPhrase = useCallback((text: string) => {
    const el = textareaRef.current;
    if (!el) return;
    insertAtCursor(el, text);
    setDraft(el.value);
  }, []);

  const addEntry = useCallback(async () => {
    const text = (draft || "").trim();
    if (!text) return;
    if (!canEdit) return;

    setEntrySubmitting(true);
    try {
      const res = await apiFetch(
        `/api/matches/${matchId}/commentary/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            time_source: "CLOCK",
            minute: minuteSafe,
          }),
          toastOnError: false,
        } as any
      );

      const data = await readJsonSafe(res);
      if (!res.ok) {
        throw new Error(getApiErrorMessage(data, "Nie udało się dodać wpisu."));
      }

      const created = data as LiveCommentaryEntryDTO;
      setEntries((prev) => [created, ...prev]);
      setDraft("");
    } catch (e: any) {
      toast.error(e?.message ?? "Nie udało się dodać wpisu.", { title: "Komentarz LIVE" });
    } finally {
      setEntrySubmitting(false);
    }
  }, [canEdit, draft, matchId, minuteSafe]);

  const deleteEntry = useCallback(
    async (id: number) => {
      if (!canEdit) return;

      setDeletingEntryIds((m) => ({ ...m, [id]: true }));

      const prev = entries;
      setEntries((list) => list.filter((x) => x.id !== id));

      try {
        const res = await apiFetch(`/api/commentary/${id}/`, { method: "DELETE", toastOnError: false } as any);
        const data = await readJsonSafe(res);
        if (!res.ok) {
          throw new Error(getApiErrorMessage(data, "Nie udało się usunąć wpisu."));
        }
      } catch (e: any) {
        setEntries(prev);
        toast.error(e?.message ?? "Nie udało się usunąć wpisu.", { title: "Komentarz LIVE" });
      } finally {
        setDeletingEntryIds((m) => {
          const n = { ...m };
          delete n[id];
          return n;
        });
      }
    },
    [canEdit, entries]
  );

  const addToDictionary = useCallback(async () => {
    const text = (newPhrase || "").trim();
    if (!text) return;

    const kind = newPhraseType === "WORD" ? "TOKEN" : "TEMPLATE";

    setDictSubmitting(true);
    try {
      const res = await apiFetch(
        `/api/tournaments/${tournamentId}/commentary-phrases/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, text, is_active: true }),
          toastOnError: false,
        } as any
      );

      const data = await readJsonSafe(res);
      if (!res.ok) {
        throw new Error(getApiErrorMessage(data, "Nie udało się dodać frazy."));
      }

      const created = data as PhraseDTO;
      const phrase: UiPhrase = {
        id: created.id,
        kind: kind as any,
        text: String(created.text || "").trim(),
      };

      setDict((prev) => {
        if (phrase.kind === "TOKEN") {
          return { ...prev, words: uniqByText([phrase, ...prev.words]) };
        }
        return { ...prev, templates: uniqByText([phrase, ...prev.templates]) };
      });

      setNewPhrase("");
    } catch (e: any) {
      toast.error(e?.message ?? "Nie udało się dodać frazy.", { title: "Komentarz LIVE" });
    } finally {
      setDictSubmitting(false);
    }
  }, [newPhrase, newPhraseType, tournamentId]);

  const deletePhrase = useCallback(
    async (phrase: UiPhrase) => {
      if (!canEdit) return;
      if (!phrase.id) return;

      const id = phrase.id;
      const prev = dict;

      setDeletingPhraseIds((m) => ({ ...m, [id]: true }));

      setDict((d) => {
        if (phrase.kind === "TOKEN") {
          return { ...d, words: d.words.filter((x) => x.id !== id) };
        }
        return { ...d, templates: d.templates.filter((x) => x.id !== id) };
      });

      try {
        const res = await apiFetch(`/api/commentary-phrases/${id}/`, { method: "DELETE", toastOnError: false } as any);
        const data = await readJsonSafe(res);
        if (!res.ok) {
          throw new Error(getApiErrorMessage(data, "Nie udało się usunąć frazy."));
        }
      } catch (e: any) {
        setDict(prev);
        toast.error(e?.message ?? "Nie udało się usunąć frazy.", { title: "Komentarz LIVE" });
      } finally {
        setDeletingPhraseIds((m) => {
          const n = { ...m };
          delete n[id];
          return n;
        });
      }
    },
    [canEdit, dict]
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (!canEdit) return;
      void addEntry();
    }
  };

  const sortedEntries = useMemo(() => {
    return entries
      .slice()
      .sort((a, b) => {
        const am = a.minute == null ? -1 : a.minute;
        const bm = b.minute == null ? -1 : b.minute;
        if (bm !== am) return bm - am;
        const ac = String(a.created_at || "");
        const bc = String(b.created_at || "");
        return bc.localeCompare(ac);
      });
  }, [entries]);

  const showAddEntryHint = useMemo(() => {
    const parts: string[] = [];
    parts.push("Skrót: Ctrl + Enter dodaje wpis.");
    if (entriesLoading) parts.push("wczytywanie...");
    return parts.join(" ");
  }, [entriesLoading]);

  const addEntryDisabled = !canEdit || !draft.trim() || entrySubmitting;
  const addPhraseDisabled = !newPhrase.trim() || dictSubmitting;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-base font-extrabold text-white">Komentarz LIVE</div>
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white">
          {commentaryHeaderLabel}: <span className="font-bold">{minuteSafe}'</span>
        </span>
      </div>

      <div className="mt-3 grid min-w-0 gap-3">
        <Card className="bg-white/[0.03] p-3">
          <Textarea
            unstyled
            ref={textareaRef}
            className={cn(
              "min-h-[88px] w-full resize-y rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white",
              "placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/10",
              !canEdit && "opacity-70"
            )}
            aria-label="Treść komentarza"
            name="live_commentary_draft"
            placeholder={commentaryPlaceholder}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!canEdit || entrySubmitting}
          />

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-slate-400">{showAddEntryHint}</div>

            <Button
              type="button"
              variant="primary"
              onClick={() => void addEntry()}
              disabled={addEntryDisabled}
              className="h-9 px-4 text-sm"
            >
              {entrySubmitting ? "Dodawanie..." : "Dodaj wpis"}
            </Button>
          </div>
        </Card>

        <Card className="bg-white/[0.03] p-3">
          <div className="grid gap-3">
            <div className="grid gap-2">
              <div className="text-xs font-semibold text-slate-300">Drużyny</div>
              <div className="flex flex-wrap gap-2">
                {teams.map((t) => (
                  <Button
                    key={t}
                    type="button"
                    variant="secondary"
                    className="h-8 rounded-full px-3 text-xs"
                    onClick={() => insertPhrase(t)}
                  >
                    {t}
                  </Button>
                ))}
              </div>
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold text-slate-300">Słowa</div>
                {dictLoading ? <div className="text-xs text-slate-500">wczytywanie...</div> : null}
              </div>

              <div className="flex flex-wrap gap-2">
                {dict.words.map((p) => {
                  const key = `${p.kind}:${p.id ?? "d"}:${p.text}`;
                  const canDelete = canEdit && !!p.id;
                  const busy = p.id ? !!deletingPhraseIds[p.id] : false;

                  return (
                    <div key={key} className="group inline-flex items-center gap-1">
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-8 rounded-full px-3 text-xs"
                        onClick={() => insertPhrase(p.text)}
                      >
                        {p.text}
                      </Button>

                      {canDelete ? (
                        <Button
                          type="button"
                          variant="danger"
                          className="hidden h-8 w-8 rounded-full p-0 text-xs group-hover:inline-flex"
                          onClick={() => void deletePhrase(p)}
                          disabled={busy}
                          aria-label="Usuń frazę"
                          title="Usuń frazę"
                        >
                          {busy ? "..." : "x"}
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold text-slate-300">Gotowe zwroty</div>
                {dictLoading ? <div className="text-xs text-slate-500">wczytywanie...</div> : null}
              </div>

              <div className="flex flex-wrap gap-2">
                {dict.templates.map((p) => {
                  const key = `${p.kind}:${p.id ?? "d"}:${p.text}`;
                  const canDelete = canEdit && !!p.id;
                  const busy = p.id ? !!deletingPhraseIds[p.id] : false;

                  return (
                    <div key={key} className="group inline-flex items-center gap-1">
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-8 rounded-full px-3 text-xs"
                        onClick={() => insertPhrase(p.text)}
                      >
                        {p.text}
                      </Button>

                      {canDelete ? (
                        <Button
                          type="button"
                          variant="danger"
                          className="hidden h-8 w-8 rounded-full p-0 text-xs group-hover:inline-flex"
                          onClick={() => void deletePhrase(p)}
                          disabled={busy}
                          aria-label="Usuń frazę"
                          title="Usuń frazę"
                        >
                          {busy ? "..." : "x"}
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>

            {canEdit ? (
              <div className="grid gap-2 border-t border-white/10 pt-3">
                <div className="text-xs font-semibold text-slate-300">Dodaj do słownika</div>

                <div className="grid gap-2 md:grid-cols-[220px_1fr_auto] md:items-end">
                  <div className="grid gap-1">
                    <div className="text-xs text-slate-300">Typ</div>
                    <Select<PhraseUiType>
                      value={newPhraseType}
                      onChange={setNewPhraseType}
                      options={PHRASE_TYPE_OPTIONS}
                      disabled={dictSubmitting}
                      ariaLabel="Typ frazy"
                    />
                  </div>

                  <div className="grid min-w-0 gap-1">
                    <div className="text-xs text-slate-300">Treść</div>
                    <Input
                      value={newPhrase}
                      onChange={(e) => setNewPhrase(e.target.value)}
                      placeholder="Wpisz nowe słowo lub zwrot"
                      disabled={dictSubmitting}
                    />
                  </div>

                  <div className="flex md:justify-end">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => void addToDictionary()}
                      disabled={addPhraseDisabled}
                      className="h-9 px-4"
                    >
                      {dictSubmitting ? "Dodawanie..." : "Dodaj"}
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </Card>

        <div className="grid gap-2">
          {entriesLoading ? (
            <Card className="bg-white/[0.03] px-3 py-3">
              <div className="text-sm text-slate-300">Wczytywanie komentarzy...</div>
            </Card>
          ) : sortedEntries.length === 0 ? (
            <Card className="bg-white/[0.03] px-3 py-3">
              <div className="text-sm text-slate-300">Brak komentarzy.</div>
            </Card>
          ) : (
            sortedEntries.map((e) => {
              const busy = !!deletingEntryIds[e.id];
              const periodText = periodLabel(e.period);

              return (
                <Card key={e.id} className="bg-white/[0.03] p-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                    <div className="min-w-0 text-sm text-slate-200">
                      <span className="font-bold text-white">{Math.max(0, Number(e.minute ?? 0))}'</span>
                      {periodText ? (
                        <>
                          <span className="mx-2 text-slate-500">|</span>
                          <span className="text-slate-400">{periodText}</span>
                        </>
                      ) : null}
                      <span className="mx-2 text-slate-500">|</span>
                      <span className="break-words text-slate-200">{e.text}</span>
                    </div>

                    <div className="shrink-0">
                      <Button
                        type="button"
                        variant="danger"
                        className="h-9 px-4"
                        onClick={() => void deleteEntry(e.id)}
                        disabled={!canEdit || busy}
                      >
                        {busy ? "Usuwanie..." : "Usuń"}
                      </Button>
                    </div>
                  </div>

                  <div className="mt-2 text-xs text-slate-400">
                    {e.created_at ? new Date(e.created_at).toLocaleString() : ""}
                  </div>
                </Card>
              );
            })
          )}
        </div>
      </div>
    </Card>
  );
}