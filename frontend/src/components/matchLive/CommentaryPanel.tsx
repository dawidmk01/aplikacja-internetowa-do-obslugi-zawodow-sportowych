// frontend/src/components/matchLive/CommentaryPanel.tsx
// Komponent obsługuje komentarz tekstowy LIVE oraz sportowo zależny słownik gotowych fraz dla wybranego meczu.

import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { apiFetch } from "../../api";
import { cn } from "../../lib/cn";

import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";
import { Input } from "../../ui/Input";
import { Select, type SelectOption } from "../../ui/Select";
import { Textarea } from "../../ui/Textarea";
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
type PhrasePresetMode = "SPORT" | "GENERAL";
type SupportedDiscipline =
  | "football"
  | "basketball"
  | "handball"
  | "tennis"
  | "wrestling"
  | "custom"
  | "unknown";

type Props = {
  tournamentId: number;
  matchId: number;
  canEdit: boolean;
  minute: number;
  discipline: string;
  homeTeamName: string;
  awayTeamName: string;
};

const PHRASE_TYPE_OPTIONS: SelectOption<PhraseUiType>[] = [
  { value: "WORD", label: "Słowo" },
  { value: "TEMPLATE", label: "Zwrot" },
];

const PHRASE_PRESET_OPTIONS: SelectOption<PhrasePresetMode>[] = [
  { value: "SPORT", label: "Dopasowane do dyscypliny" },
  { value: "GENERAL", label: "Zwroty ogólne" },
];

function normalizeDiscipline(value: string): SupportedDiscipline {
  const normalized = String(value || "").trim().toLowerCase();

  if (
    normalized === "football" ||
    normalized === "basketball" ||
    normalized === "handball" ||
    normalized === "tennis" ||
    normalized === "wrestling" ||
    normalized === "custom"
  ) {
    return normalized;
  }

  return "unknown";
}

function isWrestlingDiscipline(discipline: SupportedDiscipline): boolean {
  return discipline === "wrestling";
}

function supportsSportPreset(discipline: SupportedDiscipline): boolean {
  return discipline !== "custom" && discipline !== "unknown";
}

function generalPhrases(): DictState {
  return {
    words: [
      { id: null, kind: "TOKEN", text: "atak" },
      { id: null, kind: "TOKEN", text: "obrona" },
      { id: null, kind: "TOKEN", text: "tempo" },
      { id: null, kind: "TOKEN", text: "pressing" },
      { id: null, kind: "TOKEN", text: "kontra" },
      { id: null, kind: "TOKEN", text: "przewaga" },
      { id: null, kind: "TOKEN", text: "interwencja" },
      { id: null, kind: "TOKEN", text: "niedokładność" },
      { id: null, kind: "TOKEN", text: "faul" },
      { id: null, kind: "TOKEN", text: "przerwa" },
    ],
    templates: [
      { id: null, kind: "TEMPLATE", text: "Dobra akcja - ale bez końcowego efektu." },
      { id: null, kind: "TEMPLATE", text: "Zespół buduje przewagę i utrzymuje piłkę." },
      { id: null, kind: "TEMPLATE", text: "Szybka zmiana tempa po przejęciu." },
      { id: null, kind: "TEMPLATE", text: "Udana interwencja w defensywie." },
      { id: null, kind: "TEMPLATE", text: "Akcja zatrzymana przewinieniem." },
      { id: null, kind: "TEMPLATE", text: "Rośnie presja po stronie atakującej." },
    ],
  };
}

function sportSpecificPhrases(discipline: SupportedDiscipline): DictState {
  switch (discipline) {
    case "football":
      return {
        words: [
          { id: null, kind: "TOKEN", text: "strzał" },
          { id: null, kind: "TOKEN", text: "dośrodkowanie" },
          { id: null, kind: "TOKEN", text: "spalony" },
          { id: null, kind: "TOKEN", text: "rzut rożny" },
          { id: null, kind: "TOKEN", text: "stały fragment" },
          { id: null, kind: "TOKEN", text: "pole karne" },
          { id: null, kind: "TOKEN", text: "odbiór" },
          { id: null, kind: "TOKEN", text: "bramka" },
        ],
        templates: [
          { id: null, kind: "TEMPLATE", text: "Dośrodkowanie w pole karne - obrona wybija piłkę." },
          { id: null, kind: "TEMPLATE", text: "Groźny strzał - bramkarz skutecznie interweniuje." },
          { id: null, kind: "TEMPLATE", text: "Szybka kontra - akcja przenosi się pod bramkę rywali." },
          { id: null, kind: "TEMPLATE", text: "Piłka wraca do środka pola po nieudanym rozegraniu." },
          { id: null, kind: "TEMPLATE", text: "Stały fragment - zespół ustawia się do rozegrania." },
          { id: null, kind: "TEMPLATE", text: "Dobra wymiana podań, ale bez finalnego uderzenia." },
        ],
      };
    case "basketball":
      return {
        words: [
          { id: null, kind: "TOKEN", text: "trójka" },
          { id: null, kind: "TOKEN", text: "zbiórka" },
          { id: null, kind: "TOKEN", text: "asysta" },
          { id: null, kind: "TOKEN", text: "przechwyt" },
          { id: null, kind: "TOKEN", text: "strata" },
          { id: null, kind: "TOKEN", text: "blok" },
          { id: null, kind: "TOKEN", text: "rzut wolny" },
          { id: null, kind: "TOKEN", text: "wejście pod kosz" },
        ],
        templates: [
          { id: null, kind: "TEMPLATE", text: "Szybki atak kończy się rzutem spod kosza." },
          { id: null, kind: "TEMPLATE", text: "Celny rzut z dystansu podnosi tempo spotkania." },
          { id: null, kind: "TEMPLATE", text: "Dobra zbiórka otwiera kolejną akcję ofensywną." },
          { id: null, kind: "TEMPLATE", text: "Przechwyt uruchamia kontratak po zmianie posiadania." },
          { id: null, kind: "TEMPLATE", text: "Faul zatrzymuje akcję i prowadzi do rzutów wolnych." },
          { id: null, kind: "TEMPLATE", text: "Obrona zamyka środek i wymusza rzut z trudnej pozycji." },
        ],
      };
    case "handball":
      return {
        words: [
          { id: null, kind: "TOKEN", text: "rzut" },
          { id: null, kind: "TOKEN", text: "kontratak" },
          { id: null, kind: "TOKEN", text: "koło" },
          { id: null, kind: "TOKEN", text: "blok" },
          { id: null, kind: "TOKEN", text: "interwencja" },
          { id: null, kind: "TOKEN", text: "wykluczenie" },
          { id: null, kind: "TOKEN", text: "wznowienie" },
          { id: null, kind: "TOKEN", text: "przewinienie" },
        ],
        templates: [
          { id: null, kind: "TEMPLATE", text: "Szybkie wznowienie otwiera drogę do kontrataku." },
          { id: null, kind: "TEMPLATE", text: "Mocny rzut z drugiej linii - bramkarz skutecznie broni." },
          { id: null, kind: "TEMPLATE", text: "Akcja schodzi na koło, ale obrona zamyka dostęp do bramki." },
          { id: null, kind: "TEMPLATE", text: "Przewinienie przerywa akcję i spowalnia tempo ataku." },
          { id: null, kind: "TEMPLATE", text: "Dobra interwencja otwiera możliwość szybkiego wyjścia." },
          { id: null, kind: "TEMPLATE", text: "Zespół cierpliwie buduje pozycję rzutową." },
        ],
      };
    case "tennis":
      return {
        words: [
          { id: null, kind: "TOKEN", text: "serwis" },
          { id: null, kind: "TOKEN", text: "return" },
          { id: null, kind: "TOKEN", text: "forhend" },
          { id: null, kind: "TOKEN", text: "bekhend" },
          { id: null, kind: "TOKEN", text: "wolej" },
          { id: null, kind: "TOKEN", text: "przełamanie" },
          { id: null, kind: "TOKEN", text: "as serwisowy" },
          { id: null, kind: "TOKEN", text: "podwójny błąd" },
        ],
        templates: [
          { id: null, kind: "TEMPLATE", text: "Mocny serwis ustawia wymianę od pierwszego uderzenia." },
          { id: null, kind: "TEMPLATE", text: "Długa wymiana kończy się błędem po stronie odbierającego." },
          { id: null, kind: "TEMPLATE", text: "Dobry return odbiera inicjatywę serwującemu." },
          { id: null, kind: "TEMPLATE", text: "Zawodnik przejmuje kontrolę wymiany po mocnym forhendu." },
          { id: null, kind: "TEMPLATE", text: "Błąd serwisowy komplikuje gema serwisowego." },
          { id: null, kind: "TEMPLATE", text: "Akcja przy siatce przynosi przewagę po agresywnym wejściu." },
        ],
      };
    case "wrestling":
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
          { id: null, kind: "TOKEN", text: "mata" },
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
    default:
      return { words: [], templates: [] };
  }
}

function defaultPhrases(discipline: SupportedDiscipline, presetMode: PhrasePresetMode): DictState {
  const general = generalPhrases();
  if (presetMode === "GENERAL" || !supportsSportPreset(discipline)) {
    return general;
  }

  const sportSpecific = sportSpecificPhrases(discipline);
  return {
    words: uniqByText([...sportSpecific.words, ...general.words]),
    templates: uniqByText([...sportSpecific.templates, ...general.templates]),
  };
}

function commentaryPlaceholderForDiscipline(discipline: SupportedDiscipline): string {
  switch (discipline) {
    case "football":
      return "Np. Szybkie dośrodkowanie z prawej strony, obrona wybija piłkę poza pole karne...";
    case "basketball":
      return "Np. Szybki atak po przechwycie, wejście pod kosz i celny rzut...";
    case "handball":
      return "Np. Wznowienie przyspiesza kontratak, rzut z drugiej linii broni bramkarz...";
    case "tennis":
      return "Np. Mocny serwis otwiera gema, return ląduje blisko linii końcowej...";
    case "wrestling":
      return "Np. Dobry chwyt w środku maty, zawodnik przechodzi do parteru...";
    default:
      return "Np. Szybka akcja po przejęciu, obrona przerywa atak faulem...";
  }
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

export function CommentaryPanel({
  tournamentId,
  matchId,
  canEdit,
  minute,
  discipline,
  homeTeamName,
  awayTeamName,
}: Props) {
  const normalizedDiscipline = useMemo(() => normalizeDiscipline(discipline), [discipline]);
  const canSwitchPreset = useMemo(() => supportsSportPreset(normalizedDiscipline), [normalizedDiscipline]);

  const [entries, setEntries] = useState<LiveCommentaryEntryDTO[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);

  const [apiDict, setApiDict] = useState<DictState>({ words: [], templates: [] });
  const [dictLoading, setDictLoading] = useState(false);

  const [draft, setDraft] = useState("");
  const [newPhrase, setNewPhrase] = useState("");
  const [newPhraseType, setNewPhraseType] = useState<PhraseUiType>("WORD");
  const [presetMode, setPresetMode] = useState<PhrasePresetMode>(canSwitchPreset ? "SPORT" : "GENERAL");

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
  const commentaryHeaderLabel = isWrestlingDiscipline(normalizedDiscipline) ? "Czas walki" : "Minuta";
  const commentaryPlaceholder = useMemo(
    () => commentaryPlaceholderForDiscipline(normalizedDiscipline),
    [normalizedDiscipline]
  );

  const fallbackDict = useMemo(
    () => defaultPhrases(normalizedDiscipline, presetMode),
    [normalizedDiscipline, presetMode]
  );

  const dict = useMemo<DictState>(() => {
    return {
      words: uniqByText([...apiDict.words, ...fallbackDict.words]),
      templates: uniqByText([...apiDict.templates, ...fallbackDict.templates]),
    };
  }, [apiDict, fallbackDict]);

  useEffect(() => {
    setPresetMode(canSwitchPreset ? "SPORT" : "GENERAL");
  }, [canSwitchPreset, normalizedDiscipline]);

  useEffect(() => {
    setDraft("");
  }, [matchId, normalizedDiscipline]);

  // ===== Odczyt wpisów komentarza =====

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
        toast.error(e?.message ?? "Nie udało się pobrać komentarzy.", { title: "Komentarz na żywo" });
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

  // ===== Odczyt i scalanie słownika fraz =====

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

        if (!alive) return;
        setApiDict({
          words: uniqByText(apiWords),
          templates: uniqByText(apiTemplates),
        });
      } catch (e: any) {
        if (!alive) return;
        toast.error(e?.message ?? "Nie udało się pobrać słownika.", { title: "Komentarz na żywo" });
        setApiDict({ words: [], templates: [] });
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

  // ===== Operacje na wpisach komentarza =====

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
      toast.error(e?.message ?? "Nie udało się dodać wpisu.", { title: "Komentarz na żywo" });
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
        toast.error(e?.message ?? "Nie udało się usunąć wpisu.", { title: "Komentarz na żywo" });
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

  // ===== Operacje na słowniku fraz =====

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
        kind: kind as "TOKEN" | "TEMPLATE",
        text: String(created.text || "").trim(),
      };

      setApiDict((prev) => {
        if (phrase.kind === "TOKEN") {
          return { ...prev, words: uniqByText([phrase, ...prev.words]) };
        }
        return { ...prev, templates: uniqByText([phrase, ...prev.templates]) };
      });

      setNewPhrase("");
    } catch (e: any) {
      toast.error(e?.message ?? "Nie udało się dodać frazy.", { title: "Komentarz na żywo" });
    } finally {
      setDictSubmitting(false);
    }
  }, [newPhrase, newPhraseType, tournamentId]);

  const deletePhrase = useCallback(
    async (phrase: UiPhrase) => {
      if (!canEdit) return;
      if (!phrase.id) return;

      const id = phrase.id;
      const prev = apiDict;

      setDeletingPhraseIds((m) => ({ ...m, [id]: true }));

      setApiDict((d) => {
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
        setApiDict(prev);
        toast.error(e?.message ?? "Nie udało się usunąć frazy.", { title: "Komentarz na żywo" });
      } finally {
        setDeletingPhraseIds((m) => {
          const n = { ...m };
          delete n[id];
          return n;
        });
      }
    },
    [apiDict, canEdit]
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

  const presetDescription = useMemo(() => {
    if (!canSwitchPreset) {
      return "Dla dyscypliny niestandardowej używany jest ogólny zestaw słów i gotowych zwrotów.";
    }

    return presetMode === "SPORT"
      ? "Widoczne są frazy dopasowane do bieżącej dyscypliny oraz zwroty ogólne."
      : "Widoczne są wyłącznie ogólne frazy, niezależne od konkretnej dyscypliny.";
  }, [canSwitchPreset, presetMode]);

  const addEntryDisabled = !canEdit || !draft.trim() || entrySubmitting;
  const addPhraseDisabled = !newPhrase.trim() || dictSubmitting;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-base font-extrabold text-white">Komentarz na żywo</div>
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
            <div className="grid gap-2 md:grid-cols-[280px_1fr] md:items-end">
              <div className="grid gap-1">
                <div className="text-xs text-slate-300">Zestaw gotowych fraz</div>
                <Select<PhrasePresetMode>
                  value={presetMode}
                  onChange={setPresetMode}
                  options={PHRASE_PRESET_OPTIONS}
                  disabled={dictLoading || !canSwitchPreset}
                  ariaLabel="Zestaw gotowych fraz"
                />
              </div>

              <div className="text-xs text-slate-400">{presetDescription}</div>
            </div>

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
