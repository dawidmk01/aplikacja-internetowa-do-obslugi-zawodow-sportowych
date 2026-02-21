import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

import { apiFetch } from "../../api";
import { cn } from "../../lib/cn";

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

type Props = {
  tournamentId: number;
  matchId: number;
  canEdit: boolean;
  minute: number;
  homeTeamName: string;
  awayTeamName: string;
};

function defaultPhrases(): DictState {
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

export function CommentaryPanel({
  tournamentId,
  matchId,
  canEdit,
  minute,
  homeTeamName,
  awayTeamName,
}: Props) {
  const [entries, setEntries] = useState<LiveCommentaryEntryDTO[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);

  const [dict, setDict] = useState<DictState>(() => defaultPhrases());
  const [dictLoading, setDictLoading] = useState(false);

  const [draft, setDraft] = useState("");
  const [newPhrase, setNewPhrase] = useState("");
  const [newPhraseType, setNewPhraseType] = useState<"WORD" | "TEMPLATE">("WORD");

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const teams = useMemo(() => {
    const a = (homeTeamName || "Gospodarze").trim();
    const b = (awayTeamName || "Goście").trim();
    return [a, b].filter(Boolean);
  }, [homeTeamName, awayTeamName]);

  const minuteSafe = useMemo(() => Math.max(0, Number(minute || 0)), [minute]);

  useEffect(() => {
    setDraft("");
  }, [matchId]);

  useEffect(() => {
    let alive = true;

    const loadEntries = async () => {
      setEntriesLoading(true);
      try {
        const res = await apiFetch(`/api/matches/${matchId}/commentary/`, { method: "GET" });
        const data = await readJsonSafe(res);
        if (!res.ok) {
          throw new Error(getApiErrorMessage(data, "Nie udało się pobrać komentarzy."));
        }

        const list = Array.isArray(data) ? (data as LiveCommentaryEntryDTO[]) : [];
        if (!alive) return;
        setEntries(list);
      } catch (e: any) {
        if (!alive) return;
        toast(e?.message ?? "Nie udało się pobrać komentarzy.");
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
        const res = await apiFetch(`/api/tournaments/${tournamentId}/commentary-phrases/`, { method: "GET" });
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
        toast(e?.message ?? "Nie udało się pobrać słownika.");
        setDict(defaultPhrases());
      } finally {
        if (alive) setDictLoading(false);
      }
    };

    loadDict();

    return () => {
      alive = false;
    };
  }, [tournamentId]);

  const insertPhrase = (text: string) => {
    const el = textareaRef.current;
    if (!el) return;
    insertAtCursor(el, text);
    setDraft(el.value);
  };

  const addEntry = async () => {
    const text = (draft || "").trim();
    if (!text) return;
    if (!canEdit) return;

    try {
      const res = await apiFetch(`/api/matches/${matchId}/commentary/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          time_source: "CLOCK",
          minute: minuteSafe,
        }),
      });

      const data = await readJsonSafe(res);
      if (!res.ok) {
        throw new Error(getApiErrorMessage(data, "Nie udało się dodać wpisu."));
      }

      const created = data as LiveCommentaryEntryDTO;
      setEntries((prev) => [created, ...prev]);
      setDraft("");
    } catch (e: any) {
      toast(e?.message ?? "Nie udało się dodać wpisu.");
    }
  };

  const deleteEntry = async (id: number) => {
    if (!canEdit) return;

    const prev = entries;
    setEntries((list) => list.filter((x) => x.id !== id));

    try {
      const res = await apiFetch(`/api/commentary/${id}/`, { method: "DELETE" });
      const data = await readJsonSafe(res);
      if (!res.ok) {
        throw new Error(getApiErrorMessage(data, "Nie udało się usunąć wpisu."));
      }
    } catch (e: any) {
      setEntries(prev);
      toast(e?.message ?? "Nie udało się usunąć wpisu.");
    }
  };

  const addToDictionary = async () => {
    const text = (newPhrase || "").trim();
    if (!text) return;

    const kind = newPhraseType === "WORD" ? "TOKEN" : "TEMPLATE";

    try {
      const res = await apiFetch(`/api/tournaments/${tournamentId}/commentary-phrases/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, text, is_active: true }),
      });

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
      toast(e?.message ?? "Nie udało się dodać frazy.");
    }
  };

  const deletePhrase = async (phrase: UiPhrase) => {
    if (!canEdit) return;
    if (!phrase.id) return;

    const id = phrase.id;
    const prev = dict;

    setDict((d) => {
      if (phrase.kind === "TOKEN") {
        return { ...d, words: d.words.filter((x) => x.id !== id) };
      }
      return { ...d, templates: d.templates.filter((x) => x.id !== id) };
    });

    try {
      const res = await apiFetch(`/api/commentary-phrases/${id}/`, { method: "DELETE" });
      const data = await readJsonSafe(res);
      if (!res.ok) {
        throw new Error(getApiErrorMessage(data, "Nie udało się usunąć frazy."));
      }
    } catch (e: any) {
      setDict(prev);
      toast(e?.message ?? "Nie udało się usunąć frazy.");
    }
  };

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

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-base font-extrabold text-white">Komentarz LIVE</div>
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white">
          Minuta: <span className="font-bold">{minuteSafe}'</span>
        </span>
      </div>

      <div className="mt-3 grid gap-3">
        <div className="grid gap-2 rounded-2xl border border-white/10 bg-white/[0.02] p-3">
          <textarea
            ref={textareaRef}
            className={cn(
              "min-h-[88px] w-full resize-y rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none",
              !canEdit && "opacity-70"
            )}
            placeholder="Np. Lewandowski biegnie do bramki, nieudany strzał, Real rozpoczyna z pola..."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!canEdit}
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-slate-400">
              Skrót: Ctrl + Enter dodaje wpis.
              {entriesLoading ? " - wczytywanie..." : ""}
            </div>
            <button
              type="button"
              className={cn(
                "rounded-xl border border-white/10 bg-emerald-500/15 px-3 py-2 text-sm font-semibold text-white",
                (!canEdit || !draft.trim()) && "opacity-60"
              )}
              onClick={() => void addEntry()}
              disabled={!canEdit || !draft.trim()}
            >
              Dodaj wpis
            </button>
          </div>
        </div>

        <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-3">
          <div className="grid gap-2">
            <div className="text-xs font-semibold text-slate-300">Drużyny</div>
            <div className="flex flex-wrap gap-2">
              {teams.map((t) => (
                <button
                  key={t}
                  type="button"
                  className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-white hover:bg-white/[0.06]"
                  onClick={() => insertPhrase(t)}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold text-slate-300">Słowa</div>
              {dictLoading ? <div className="text-xs text-slate-500">wczytywanie...</div> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {dict.words.map((p) => (
                <div key={`${p.kind}:${p.id ?? "d"}:${p.text}`} className="group inline-flex items-center gap-1">
                  <button
                    type="button"
                    className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white hover:bg-white/[0.06]"
                    onClick={() => insertPhrase(p.text)}
                  >
                    {p.text}
                  </button>
                  {canEdit && p.id ? (
                    <button
                      type="button"
                      className="hidden rounded-full border border-white/10 bg-red-500/10 px-2 py-1 text-[11px] text-white hover:bg-red-500/15 group-hover:inline-flex"
                      onClick={() => void deletePhrase(p)}
                      title="Usuń frazę"
                    >
                      x
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold text-slate-300">Gotowe zwroty</div>
              {dictLoading ? <div className="text-xs text-slate-500">wczytywanie...</div> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {dict.templates.map((p) => (
                <div key={`${p.kind}:${p.id ?? "d"}:${p.text}`} className="group inline-flex items-center gap-1">
                  <button
                    type="button"
                    className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white hover:bg-white/[0.06]"
                    onClick={() => insertPhrase(p.text)}
                  >
                    {p.text}
                  </button>
                  {canEdit && p.id ? (
                    <button
                      type="button"
                      className="hidden rounded-full border border-white/10 bg-red-500/10 px-2 py-1 text-[11px] text-white hover:bg-red-500/15 group-hover:inline-flex"
                      onClick={() => void deletePhrase(p)}
                      title="Usuń frazę"
                    >
                      x
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          {canEdit ? (
            <div className="grid gap-2 border-t border-white/10 pt-3">
              <div className="text-xs font-semibold text-slate-300">Dodaj do słownika</div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none"
                  value={newPhraseType}
                  onChange={(e) => setNewPhraseType(e.target.value as any)}
                >
                  <option value="WORD">Słowo</option>
                  <option value="TEMPLATE">Zwrot</option>
                </select>

                <input
                  className="min-w-[220px] flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none"
                  value={newPhrase}
                  onChange={(e) => setNewPhrase(e.target.value)}
                  placeholder="Wpisz nowe słowo lub zwrot"
                />

                <button
                  type="button"
                  className={cn(
                    "rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm font-semibold text-white",
                    !newPhrase.trim() && "opacity-60"
                  )}
                  onClick={() => void addToDictionary()}
                  disabled={!newPhrase.trim()}
                >
                  Dodaj
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="grid gap-2">
          {entriesLoading ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-3 text-sm text-slate-300">Wczytywanie komentarzy...</div>
          ) : sortedEntries.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-3 text-sm text-slate-300">Brak komentarzy.</div>
          ) : (
            sortedEntries.map((e) => (
              <div key={e.id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm text-slate-200">
                    <span className="font-bold text-white">{Math.max(0, Number(e.minute ?? 0))}'</span>
                    <span className="mx-2 text-slate-500">|</span>
                    <span className="text-slate-200">{e.text}</span>
                  </div>
                  <button
                    type="button"
                    className={cn(
                      "rounded-xl border border-white/10 bg-red-500/10 px-3 py-1.5 text-sm font-semibold text-white",
                      !canEdit && "opacity-60"
                    )}
                    onClick={() => void deleteEntry(e.id)}
                    disabled={!canEdit}
                  >
                    Usuń
                  </button>
                </div>
                <div className="mt-2 text-xs text-slate-400">
                  {e.created_at ? new Date(e.created_at).toLocaleString() : ""}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
