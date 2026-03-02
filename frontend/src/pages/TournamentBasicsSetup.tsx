// frontend/src/pages/TournamentBasicsSetup.tsx
// Strona obsługuje konfigurację podstawowych parametrów turnieju przed kolejnymi etapami.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";

import { apiFetch } from "../api";
import { useTournamentFlowGuard } from "../flow/TournamentFlowGuardContext";

import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { InlineAlert } from "../ui/InlineAlert";
import { toast } from "../ui/Toast";

import TournamentFlowNav from "../components/TournamentFlowNav";

import {
  BasicsCard,
  ConfirmModal,
  StructureCard,
  SummaryCard,
  type Discipline,
  type HandballKnockoutTiebreak,
  type HandballPointsMode,
  type HandballTableDrawMode,
  type MatchesPreview,
  type TennisBestOf,
  type TennisPointsMode,
  type TournamentFormat,
} from "./_components/TournamentBasicsSetupView";

type TournamentDTO = {
  id: number;
  name: string;
  description?: string | null;
  discipline: Discipline;
  tournament_format: TournamentFormat;
  format_config: Record<string, any>;
  status?: "DRAFT" | "CONFIGURED" | "RUNNING" | "FINISHED";
  my_role?: "ORGANIZER" | "ASSISTANT" | null;
  my_permissions?: Record<string, boolean>;
};

type TeamDTO = { id: number; name: string };

function clampInt(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function defaultGroupsCountFor4PerGroup(participants: number) {
  const p = Math.max(2, Math.trunc(participants));
  return Math.max(1, Math.ceil(p / 4));
}

function splitIntoGroups(participants: number, groupsCount: number): number[] {
  const p = Math.max(0, Math.trunc(participants));
  const g = clampInt(groupsCount, 1, Math.max(1, p));
  const base = Math.floor(p / g);
  const extra = p % g;

  const sizes: number[] = [];
  for (let i = 0; i < g; i++) sizes.push(i < extra ? base + 1 : base);
  return sizes;
}

function roundRobinMatches(size: number, matchesPerPair: 1 | 2) {
  if (size < 2) return 0;
  return ((size * (size - 1)) / 2) * matchesPerPair;
}

function isPowerOfTwo(n: number) {
  if (n < 1) return false;
  return (n & (n - 1)) === 0;
}

function pickFirstError(payload: any): string | null {
  if (!payload) return null;
  if (typeof payload === "string") return payload;
  if (typeof payload?.detail === "string") return payload.detail;

  const tryKeys = ["non_field_errors", "name", "description", "discipline", "tournament_format"];
  for (const k of tryKeys) {
    const v = payload?.[k];
    if (typeof v === "string") return v;
    if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  }

  const anyKey = Object.keys(payload || {})[0];
  const anyVal = anyKey ? payload?.[anyKey] : null;
  if (typeof anyVal === "string") return anyVal;
  if (Array.isArray(anyVal) && typeof anyVal[0] === "string") return anyVal[0];

  return null;
}

// Zapis jest etapowy, aby backend mógł wykryć potrzebę resetu i utrzymać spójność danych.
export default function TournamentBasicsSetup() {
  const { id } = useParams<{ id: string }>();
  const isCreateMode = !id;

  const navigate = useNavigate();
  const location = useLocation();

  const { dirty, markDirty, registerSave } = useTournamentFlowGuard();
  const createdIdRef = useRef<string | null>(null);

  const [loading, setLoading] = useState(!isCreateMode);
  const [saving, setSaving] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState<string>("Potwierdzenie");
  const [confirmMessage, setConfirmMessage] = useState<string>("");
  const [confirmConfirmLabel, setConfirmConfirmLabel] = useState<string>("Kontynuuj");
  const [confirmCancelLabel, setConfirmCancelLabel] = useState<string>("Anuluj");
  const confirmResolverRef = useRef<((value: boolean) => void) | null>(null);

  const askConfirm = useCallback((opts: { title?: string; message: string; confirmLabel?: string; cancelLabel?: string }) => {
    setConfirmTitle(opts.title ?? "Potwierdzenie");
    setConfirmMessage(opts.message);
    setConfirmConfirmLabel(opts.confirmLabel ?? "Kontynuuj");
    setConfirmCancelLabel(opts.cancelLabel ?? "Anuluj");
    setConfirmOpen(true);
    return new Promise<boolean>((resolve) => {
      confirmResolverRef.current = resolve;
    });
  }, []);

  const resolveConfirm = useCallback((value: boolean) => {
    setConfirmOpen(false);
    const r = confirmResolverRef.current;
    confirmResolverRef.current = null;
    if (r) r(value);
  }, []);

  const [myRole, setMyRole] = useState<"ORGANIZER" | "ASSISTANT" | null>(null);
  const [myPerms, setMyPerms] = useState<Record<string, boolean>>({});

  const canEditTournament = myRole === "ORGANIZER" || Boolean(myPerms?.tournament_edit);
  const isAssistantReadOnly = !isCreateMode && !canEditTournament;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const [initialName, setInitialName] = useState("");
  const [initialDescription, setInitialDescription] = useState("");

  const [discipline, setDiscipline] = useState<Discipline>("football");
  const [initialDiscipline, setInitialDiscipline] = useState<Discipline>("football");

  const [format, setFormat] = useState<TournamentFormat>("LEAGUE");
  const [participants, setParticipants] = useState(8);
  const initialParticipantsRef = useRef<number>(8);

  const [leagueMatches, setLeagueMatches] = useState<1 | 2>(1);
  const [groupsCount, setGroupsCount] = useState(2);
  const [groupMatches, setGroupMatches] = useState<1 | 2>(1);
  const [advanceFromGroup, setAdvanceFromGroup] = useState(2);

  const [hbTableDrawMode, setHbTableDrawMode] = useState<HandballTableDrawMode>("ALLOW_DRAW");
  const [hbPointsMode, setHbPointsMode] = useState<HandballPointsMode>("2_1_0");
  const [hbKnockoutTiebreak, setHbKnockoutTiebreak] = useState<HandballKnockoutTiebreak>("OVERTIME_PENALTIES");

  const [cupMatches, setCupMatches] = useState<1 | 2>(1);
  const [finalMatches, setFinalMatches] = useState<1 | 2>(1);
  const [thirdPlace, setThirdPlace] = useState(false);
  const [thirdPlaceMatches, setThirdPlaceMatches] = useState<1 | 2>(1);

  const [tennisBestOf, setTennisBestOf] = useState<TennisBestOf>(3);
  const [tennisPointsMode, setTennisPointsMode] = useState<TennisPointsMode>("NONE");

  const isHandball = discipline === "handball";
  const isTennis = discipline === "tennis";

  useEffect(() => {
    const flash = (location.state as any)?.flashError as string | undefined;
    if (flash) {
      setInlineError(flash);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, navigate, location.pathname]);

  useEffect(() => {
    if (hbPointsMode === "3_2_1_0" && hbTableDrawMode === "ALLOW_DRAW") {
      setHbTableDrawMode("PENALTIES");
    }
  }, [hbPointsMode, hbTableDrawMode]);

  useEffect(() => {
    if (!isTennis) return;
    if (cupMatches !== 1) setCupMatches(1);
    if (finalMatches !== 1) setFinalMatches(1);
    if (thirdPlaceMatches !== 1) setThirdPlaceMatches(1);
  }, [isTennis, cupMatches, finalMatches, thirdPlaceMatches]);

  const maxGroupsForMin2PerGroup = useMemo(() => {
    return Math.max(1, Math.floor(Math.max(2, participants) / 2));
  }, [participants]);

  useEffect(() => {
    if (format !== "MIXED") return;
    setGroupsCount((prev) => clampInt(prev, 1, maxGroupsForMin2PerGroup));
  }, [format, maxGroupsForMin2PerGroup]);

  const groupSizes = useMemo(() => {
    if (format !== "MIXED") return [];
    const safeParticipants = clampInt(participants, 2, 10_000);
    const safeGroups = clampInt(groupsCount, 1, Math.max(1, safeParticipants));
    return splitIntoGroups(safeParticipants, safeGroups);
  }, [format, participants, groupsCount]);

  const minGroupSize = useMemo(() => {
    if (!groupSizes.length) return 0;
    return Math.min(...groupSizes);
  }, [groupSizes]);

  useEffect(() => {
    if (format !== "MIXED") return;
    if (minGroupSize < 2) return;
    setAdvanceFromGroup((prev) => clampInt(prev, 1, minGroupSize));
  }, [format, minGroupSize]);

  const advanceOptions = useMemo(() => {
    if (format !== "MIXED" || minGroupSize < 2) return [1, 2].filter((x) => x <= Math.max(1, minGroupSize));
    const maxOpt = Math.min(minGroupSize, 8);
    return Array.from({ length: maxOpt }, (_, i) => i + 1);
  }, [format, minGroupSize]);

  useEffect(() => {
    if (isCreateMode) return;

    const load = async () => {
      setLoading(true);
      setInlineError(null);
      try {
        const [tRes, teamsRes] = await Promise.all([
          apiFetch(`/api/tournaments/${id}/`, { toastOnError: false } as any),
          apiFetch(`/api/tournaments/${id}/teams/`, { toastOnError: false } as any),
        ]);

        if (!tRes.ok) {
          const data = await tRes.json().catch(() => ({}));
          setInlineError(pickFirstError(data) || "Nie udało się pobrać danych turnieju.");
          return;
        }
        if (!teamsRes.ok) {
          const data = await teamsRes.json().catch(() => ({}));
          setInlineError(pickFirstError(data) || "Nie udało się pobrać listy uczestników.");
          return;
        }

        const t: TournamentDTO = await tRes.json();
        const teams: TeamDTO[] = await teamsRes.json();

        setMyRole(t.my_role ?? null);
        setMyPerms(t.my_permissions ?? {});

        setName(t.name || "");
        setInitialName(t.name || "");

        const desc = (t.description ?? "") as string;
        setDescription(desc);
        setInitialDescription(desc);

        setDiscipline(t.discipline);
        setInitialDiscipline(t.discipline);

        setFormat(t.tournament_format);

        const currentCount = Math.max(2, teams.length);
        setParticipants(currentCount);
        initialParticipantsRef.current = currentCount;

        const cfg = t.format_config || {};

        setLeagueMatches(cfg.league_matches === 2 ? 2 : 1);

        const savedGroups = cfg.groups_count;
        if (typeof savedGroups === "number" && savedGroups >= 1) {
          setGroupsCount(savedGroups);
        } else {
          setGroupsCount(defaultGroupsCountFor4PerGroup(currentCount));
        }

        setGroupMatches(cfg.group_matches === 2 ? 2 : 1);

        const savedAdvance = Number(cfg.advance_from_group ?? 2);
        setAdvanceFromGroup(Number.isFinite(savedAdvance) ? savedAdvance : 2);

        setCupMatches(cfg.cup_matches === 2 ? 2 : 1);
        setFinalMatches(cfg.final_matches === 2 ? 2 : 1);
        setThirdPlace(!!cfg.third_place);
        setThirdPlaceMatches(cfg.third_place_matches === 2 ? 2 : 1);

        setHbTableDrawMode(cfg.handball_table_draw_mode ?? "ALLOW_DRAW");
        setHbKnockoutTiebreak(cfg.handball_knockout_tiebreak ?? "OVERTIME_PENALTIES");
        setHbPointsMode(cfg.handball_points_mode ?? "2_1_0");

        setTennisBestOf(cfg.tennis_best_of === 5 ? 5 : 3);
        const tpm = (cfg.tennis_points_mode ?? "NONE").toString().toUpperCase();
        setTennisPointsMode(tpm === "PLT" ? "PLT" : "NONE");
      } catch {
        toast.error("Brak połączenia z serwerem. Spróbuj ponownie.", { title: "Sieć" });
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [id, isCreateMode]);

  const preview: MatchesPreview = useMemo(() => {
    const p = clampInt(participants, 2, 10_000);

    if (format === "LEAGUE") {
      const matches = ((p * (p - 1)) / 2) * leagueMatches;
      return { total: matches, groupTotal: matches, koTotal: 0, groups: 0, advancing: 0 };
    }

    if (format === "CUP") {
      const roundsMatches = Math.max(0, (p - 2) * cupMatches);
      const finalCount = finalMatches;
      const thirdCount = thirdPlace ? thirdPlaceMatches : 0;
      const koTotal = roundsMatches + finalCount + thirdCount;
      return { total: koTotal, groupTotal: 0, koTotal, groups: 0, advancing: 0 };
    }

    const safeGroups = clampInt(groupsCount, 1, Math.max(1, Math.floor(p / 2)));
    const sizes = splitIntoGroups(p, safeGroups);
    const groupTotal = sizes.reduce((sum, size) => sum + roundRobinMatches(size, groupMatches), 0);
    const minSize = sizes.length ? Math.min(...sizes) : 2;
    const adv = clampInt(advanceFromGroup, 1, Math.max(1, minSize));
    const advancing = sizes.length * adv;

    if (advancing < 2) {
      return { total: groupTotal, groupTotal, koTotal: 0, groups: sizes.length, advancing };
    }

    const koRoundsMatches = Math.max(0, (advancing - 2) * cupMatches);
    const finalCount = finalMatches;
    const thirdCount = thirdPlace ? thirdPlaceMatches : 0;
    const koTotal = koRoundsMatches + finalCount + thirdCount;

    return { total: groupTotal + koTotal, groupTotal, koTotal, groups: sizes.length, advancing };
  }, [
    format,
    participants,
    leagueMatches,
    cupMatches,
    finalMatches,
    thirdPlace,
    thirdPlaceMatches,
    groupsCount,
    groupMatches,
    advanceFromGroup,
  ]);

  const validateLocalBeforeSave = (): string | null => {
    const trimmedName = name.trim();
    if (!trimmedName) return "Wpisz nazwę turnieju - bez tego nie da się przejść dalej.";

    const p = clampInt(participants, 2, 10_000);

    if (format === "MIXED") {
      const gMax = Math.max(1, Math.floor(p / 2));
      const g = clampInt(groupsCount, 1, gMax);
      const sizes = splitIntoGroups(p, g);
      const minSize = sizes.length ? Math.min(...sizes) : 2;

      if (minSize < 2)
        return "W grupach + puchar każda grupa musi mieć co najmniej 2 uczestników (zmniejsz liczbę grup).";

      const adv = clampInt(advanceFromGroup, 1, minSize);
      if (adv !== advanceFromGroup) {
        return `Awans z grupy nie może być większy niż liczba zespołów w najmniejszej grupie (min: ${minSize}).`;
      }

      const advancing = g * adv;
      if (advancing >= 2 && !isPowerOfTwo(advancing)) {
        return `Uwaga: awansujących jest ${advancing}. To nie jest potęga 2, więc w drabince mogą pojawić się wolne losy (BYE).`;
      }
    }

    if (isTennis) {
      if (cupMatches !== 1 || finalMatches !== 1 || thirdPlaceMatches !== 1) {
        return "Tenis: KO nie wspiera dwumeczów - ustaw rundy/finał/3. miejsce na 1 mecz.";
      }
    }

    return null;
  };

  const buildFormatConfig = () => {
    const safeParticipants = clampInt(participants, 2, 10_000);
    const maxGroups = Math.max(1, Math.floor(safeParticipants / 2));
    const safeGroups = clampInt(groupsCount, 1, Math.max(1, maxGroups));
    const sizes = splitIntoGroups(safeParticipants, safeGroups);
    const computedTeamsPerGroup = Math.max(2, ...(sizes.length ? sizes : [2]));
    const minSize = sizes.length ? Math.min(...sizes) : 2;
    const safeAdvance = clampInt(advanceFromGroup, 1, Math.max(1, minSize));

    const rawConfig: Record<string, any> = {
      league_matches: leagueMatches,
      groups_count: safeGroups,
      teams_per_group: computedTeamsPerGroup,
      group_matches: groupMatches,
      advance_from_group: safeAdvance,
      cup_matches: isTennis ? 1 : cupMatches,
      final_matches: isTennis ? 1 : finalMatches,
      third_place: thirdPlace,
      third_place_matches: isTennis ? 1 : thirdPlaceMatches,
    };

    if (isHandball) {
      rawConfig.handball_table_draw_mode = hbTableDrawMode;
      rawConfig.handball_knockout_tiebreak = hbKnockoutTiebreak;
      rawConfig.handball_points_mode = hbPointsMode;
    }

    if (isTennis) {
      rawConfig.tennis_best_of = tennisBestOf;
      rawConfig.tennis_points_mode = tennisPointsMode;
    }

    const finalConfig = { ...rawConfig };

    if (format === "LEAGUE") {
      delete finalConfig.cup_matches;
      delete finalConfig.final_matches;
      delete finalConfig.third_place;
      delete finalConfig.third_place_matches;
      delete finalConfig.advance_from_group;
      delete finalConfig.groups_count;
      delete finalConfig.teams_per_group;
      delete finalConfig.group_matches;
      delete finalConfig.handball_knockout_tiebreak;
    }

    if (format === "CUP") {
      delete finalConfig.league_matches;
      delete finalConfig.groups_count;
      delete finalConfig.teams_per_group;
      delete finalConfig.group_matches;
      delete finalConfig.advance_from_group;
      delete finalConfig.handball_table_draw_mode;
      delete finalConfig.handball_points_mode;
      delete finalConfig.tennis_points_mode;
    }

    if (format === "MIXED") {
      delete finalConfig.league_matches;
    }

    return finalConfig;
  };

  const saveAll = useCallback(async (): Promise<{ tournamentId: number }> => {
    if (isAssistantReadOnly) {
      const msg = "Tryb podglądu: brak uprawnień do zmiany konfiguracji.";
      setInlineError(msg);
      throw new Error(msg);
    }

    const localMsg = validateLocalBeforeSave();
    if (localMsg) {
      if (localMsg.startsWith("Uwaga:")) {
        const ok = await askConfirm({
          title: "Zapis konfiguracji",
          message: `${localMsg}\n\nKontynuować zapis?`,
          confirmLabel: "Zapisz",
          cancelLabel: "Anuluj",
        });
        if (!ok) {
          setInlineError("Anulowano zapis konfiguracji.");
          throw new Error("Anulowano zapis konfiguracji.");
        }
      } else {
        setInlineError(localMsg);
        throw new Error(localMsg);
      }
    }

    if (!isCreateMode && !dirty) return { tournamentId: Number(id) };

    setSaving(true);
    setInlineError(null);

    let createdId: number | null = null;

    try {
      const trimmedName = name.trim();
      const trimmedDesc = description.trim();
      let tournamentId = Number(id);

      if (isCreateMode) {
        const createRes = await apiFetch("/api/tournaments/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: trimmedName,
            description: trimmedDesc ? trimmedDesc : null,
            discipline,
          }),
          toastOnError: false,
        } as any);

        if (!createRes.ok) {
          const data = await createRes.json().catch(() => ({}));
          const msg = pickFirstError(data) || "Nie udało się utworzyć turnieju.";
          setInlineError(msg);
          throw new Error(msg);
        }

        const created = await createRes.json();
        createdId = created.id;
        tournamentId = created.id;

        setInitialName(trimmedName);
        setInitialDescription(trimmedDesc);
        setInitialDiscipline(discipline);
      } else {
        if (discipline !== initialDiscipline) {
          const ok = await askConfirm({
            title: "Zmiana dyscypliny",
            message:
              "Zmiana dyscypliny spowoduje usunięcie wprowadzonych wyników oraz danych pochodnych.\n\nCzy na pewno chcesz kontynuować?",
            confirmLabel: "Zmień",
            cancelLabel: "Anuluj",
          });

          if (!ok) {
            setDiscipline(initialDiscipline);
          } else {
            const res = await apiFetch(`/api/tournaments/${tournamentId}/change-discipline/`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ discipline }),
              toastOnError: false,
            } as any);

            if (!res.ok) {
              const data = await res.json().catch(() => ({}));
              const msg = pickFirstError(data) || "Nie udało się zmienić dyscypliny.";
              setInlineError(msg);
              throw new Error(msg);
            }
            setInitialDiscipline(discipline);
          }
        }

        const patch: Record<string, any> = {};
        if (trimmedName !== initialName) patch.name = trimmedName;
        if (trimmedDesc !== initialDescription) patch.description = trimmedDesc ? trimmedDesc : null;

        if (Object.keys(patch).length) {
          const res = await apiFetch(`/api/tournaments/${tournamentId}/`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(patch),
            toastOnError: false,
          } as any);

          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            const msg = pickFirstError(data) || "Nie udało się zapisać danych turnieju.";
            setInlineError(msg);
            throw new Error(msg);
          }

          setInitialName(trimmedName);
          setInitialDescription(trimmedDesc);
        }
      }

      const format_config = buildFormatConfig();

      const dry = await apiFetch(`/api/tournaments/${tournamentId}/setup/?dry_run=true`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tournament_format: format, format_config }),
        toastOnError: false,
      } as any);

      if (!dry.ok) {
        const data = await dry.json().catch(() => ({}));
        const msg = pickFirstError(data) || "Błąd walidacji konfiguracji.";
        setInlineError(msg);
        throw new Error(msg);
      }

      const dryData = await dry.json().catch(() => ({}));
      const resetNeeded = Boolean((dryData as any)?.reset_needed);

      if (!isCreateMode && resetNeeded) {
        const ok = await askConfirm({
          title: "Zmiana konfiguracji",
          message: "Zmiana konfiguracji usunie istniejące mecze. Kontynuować?",
          confirmLabel: "Kontynuuj",
          cancelLabel: "Anuluj",
        });
        if (!ok) throw new Error("Anulowano zapis konfiguracji.");
      }

      const res = await apiFetch(`/api/tournaments/${tournamentId}/setup/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tournament_format: format, format_config }),
        toastOnError: false,
      } as any);

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const msg = pickFirstError(data) || "Błąd zapisu konfiguracji.";
        setInlineError(msg);
        throw new Error(msg);
      }

      const safeParticipants = clampInt(participants, 2, 10_000);
      const participantsChanged = safeParticipants !== initialParticipantsRef.current;

      if (!isCreateMode && participantsChanged && !resetNeeded) {
        const ok = await askConfirm({
          title: "Zmiana uczestników",
          message: "Zmiana liczby uczestników spowoduje reset rozgrywek. Kontynuować?",
          confirmLabel: "Kontynuuj",
          cancelLabel: "Anuluj",
        });
        if (!ok) throw new Error("Anulowano zmianę liczby uczestników.");
      }

      const teamsRes = await apiFetch(`/api/tournaments/${tournamentId}/teams/setup/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teams_count: safeParticipants,
          participants_count: safeParticipants,
        }),
        toastOnError: false,
      } as any);

      if (!teamsRes.ok) {
        const data = await teamsRes.json().catch(() => ({}));
        const msg = pickFirstError(data) || "Nie udało się ustawić liczby uczestników.";
        setInlineError(msg);
        throw new Error(msg);
      }

      initialParticipantsRef.current = safeParticipants;
      createdIdRef.current = String(tournamentId);

      if (isCreateMode) {
        navigate(`/tournaments/${tournamentId}/detail/setup`, { replace: true });
      } else {
        toast.success("Zapisano konfigurację.", { title: "Turniej" });
      }

      return { tournamentId };
    } catch (e: any) {
      const msg = e?.message || "Nie udało się zapisać.";
      if (isCreateMode && createdId) {
        navigate(`/tournaments/${createdId}/setup`, {
          replace: true,
          state: { flashError: msg },
        });
        return { tournamentId: createdId };
      }
      throw e;
    } finally {
      setSaving(false);
    }
  }, [
    isAssistantReadOnly,
    isCreateMode,
    dirty,
    id,
    name,
    description,
    discipline,
    initialDiscipline,
    initialName,
    initialDescription,
    format,
    participants,
    leagueMatches,
    groupsCount,
    groupMatches,
    advanceFromGroup,
    cupMatches,
    finalMatches,
    thirdPlace,
    thirdPlaceMatches,
    hbTableDrawMode,
    hbKnockoutTiebreak,
    hbPointsMode,
    tennisBestOf,
    tennisPointsMode,
    isTennis,
    navigate,
    askConfirm,
  ]);

  const goNext = useCallback(async () => {
    try {
      const { tournamentId } = await saveAll();
      navigate(`/tournaments/${tournamentId}/detail`, { replace: true });
    } catch (e: any) {
      const msg = e?.message || "Nie udało się zapisać.";
      setInlineError(msg);
    }
  }, [saveAll, navigate]);

  useEffect(() => {
    if (isAssistantReadOnly) {
      registerSave(null);
      return () => registerSave(null);
    }
    registerSave(async () => {
      const { tournamentId } = await saveAll();
      createdIdRef.current = String(tournamentId);
    });
    return () => registerSave(null);
  }, [registerSave, saveAll, isAssistantReadOnly]);

  const disableForm = loading || saving || isAssistantReadOnly;
  const isTournamentCreated = !isCreateMode || Boolean(createdIdRef.current);
  const showLeagueOrGroupConfig = format === "LEAGUE" || format === "MIXED";
  const showKnockoutConfig = format === "CUP" || format === "MIXED";

  const onNameChange = useCallback(
    (v: string) => {
      setName(v);
      markDirty();
      if (inlineError) setInlineError(null);
    },
    [inlineError, markDirty]
  );

  const onDescriptionChange = useCallback(
    (v: string) => {
      setDescription(v);
      markDirty();
      if (inlineError) setInlineError(null);
    },
    [inlineError, markDirty]
  );

  const onDisciplineChange = useCallback(
    (v: Discipline) => {
      setDiscipline(v);
      markDirty();
      if (inlineError) setInlineError(null);
    },
    [inlineError, markDirty]
  );

  const onFormatChange = useCallback(
    (v: TournamentFormat) => {
      setFormat(v);
      markDirty();
      if (inlineError) setInlineError(null);
      if (v !== "CUP") setThirdPlace(false);
    },
    [inlineError, markDirty]
  );

  const onParticipantsChange = useCallback(
    (raw: number) => {
      const p = clampInt(Number(raw), 2, 10_000);
      setParticipants(p);
      markDirty();
      if (inlineError) setInlineError(null);
      if (format === "MIXED") {
        const gMax = Math.max(1, Math.floor(p / 2));
        setGroupsCount((prev) => clampInt(prev, 1, gMax));
      }
    },
    [format, inlineError, markDirty]
  );

  if (loading) {
    return (
      <div className="w-full py-8">
        <Card className="p-6">
          <div className="text-sm text-slate-300">Ładowanie...</div>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6 py-8">
      {isCreateMode && (
        <div className="-mt-2">
          <TournamentFlowNav />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            {isCreateMode ? "Utwórz turniej" : "Ustawienia turnieju"}
          </h1>
          {isAssistantReadOnly && (
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-100">
              <AlertTriangle className="h-3.5 w-3.5" />
              Podgląd (asystent)
            </span>
          )}
        </div>

        <div className="text-sm leading-relaxed text-slate-300">
          {isCreateMode
            ? "Ustal podstawy i strukturę rozgrywek. W kolejnym kroku uzupełnisz uczestników."
            : "Zmień parametry rozgrywek. Uwaga: część zmian może wymagać resetu."}
        </div>
      </div>

      <AnimatePresence>
        {inlineError && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
            <div className="space-y-2">
              <InlineAlert variant="error" title="Nie udało się zapisać">
                {inlineError}
              </InlineAlert>
              <div className="flex justify-end">
                <Button variant="ghost" onClick={() => setInlineError(null)}>
                  Zamknij
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid items-start gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6">
          <BasicsCard
            disableForm={disableForm}
            isCreateMode={isCreateMode}
            isTournamentCreated={isTournamentCreated}
            name={name}
            description={description}
            onNameChange={onNameChange}
            onDescriptionChange={onDescriptionChange}
            onCreate={async () => {
              try {
                setInlineError(null);
                await saveAll();
              } catch (e: any) {
                setInlineError(e?.message || "Nie udało się utworzyć turnieju.");
              }
            }}
          />

          <StructureCard
            isTournamentCreated={isTournamentCreated}
            disableForm={disableForm}
            saving={saving}
            discipline={discipline}
            format={format}
            participants={participants}
            leagueMatches={leagueMatches}
            groupsCount={groupsCount}
            groupMatches={groupMatches}
            advanceFromGroup={advanceFromGroup}
            hbTableDrawMode={hbTableDrawMode}
            hbPointsMode={hbPointsMode}
            hbKnockoutTiebreak={hbKnockoutTiebreak}
            cupMatches={cupMatches}
            finalMatches={finalMatches}
            thirdPlace={thirdPlace}
            thirdPlaceMatches={thirdPlaceMatches}
            tennisBestOf={tennisBestOf}
            tennisPointsMode={tennisPointsMode}
            maxGroupsForMin2PerGroup={maxGroupsForMin2PerGroup}
            groupSizes={groupSizes}
            minGroupSize={minGroupSize}
            advanceOptions={advanceOptions}
            showLeagueOrGroupConfig={showLeagueOrGroupConfig}
            showKnockoutConfig={showKnockoutConfig}
            onSave={async () => {
              try {
                setInlineError(null);
                await saveAll();
              } catch (e: any) {
                setInlineError(e?.message || "Nie udało się zapisać.");
              }
            }}
            onDisciplineChange={onDisciplineChange}
            onFormatChange={onFormatChange}
            onParticipantsChange={onParticipantsChange}
            onLeagueMatchesChange={(v) => {
              setLeagueMatches(v);
              markDirty();
              if (inlineError) setInlineError(null);
            }}
            onGroupsCountChange={(raw) => {
              setGroupsCount(clampInt(Number(raw), 1, maxGroupsForMin2PerGroup));
              markDirty();
              if (inlineError) setInlineError(null);
            }}
            onGroupMatchesChange={(v) => {
              setGroupMatches(v);
              markDirty();
              if (inlineError) setInlineError(null);
            }}
            onAdvanceFromGroupChange={(v) => {
              setAdvanceFromGroup(v);
              markDirty();
              if (inlineError) setInlineError(null);
            }}
            onHbTableDrawModeChange={(v) => {
              setHbTableDrawMode(v);
              markDirty();
              if (inlineError) setInlineError(null);
            }}
            onHbPointsModeChange={(v) => {
              setHbPointsMode(v);
              markDirty();
              if (inlineError) setInlineError(null);
            }}
            onHbKnockoutTiebreakChange={(v) => {
              setHbKnockoutTiebreak(v);
              markDirty();
              if (inlineError) setInlineError(null);
            }}
            onCupMatchesChange={(v) => {
              setCupMatches(v);
              markDirty();
              if (inlineError) setInlineError(null);
            }}
            onFinalMatchesChange={(v) => {
              setFinalMatches(v);
              markDirty();
              if (inlineError) setInlineError(null);
            }}
            onThirdPlaceChange={(v) => {
              setThirdPlace(v);
              markDirty();
              if (inlineError) setInlineError(null);
            }}
            onThirdPlaceMatchesChange={(v) => {
              setThirdPlaceMatches(v);
              markDirty();
              if (inlineError) setInlineError(null);
            }}
            onTennisBestOfChange={(v) => {
              setTennisBestOf(v);
              markDirty();
              if (inlineError) setInlineError(null);
            }}
            onTennisPointsModeChange={(v) => {
              setTennisPointsMode(v);
              markDirty();
              if (inlineError) setInlineError(null);
            }}
          />

          {isCreateMode && (
            <div className="pt-2">
              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={() => {
                    void goNext();
                  }}
                  disabled={saving || disableForm || !name.trim()}
                >
                  {saving ? "Zapisywanie..." : "Utwórz turniej"}
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="lg:sticky lg:top-[92px]">
          <SummaryCard
            isTournamentCreated={isTournamentCreated}
            discipline={discipline}
            format={format}
            participants={participants}
            preview={preview}
            isAssistantReadOnly={isAssistantReadOnly}
          />
        </div>
      </div>

      <ConfirmModal
        open={confirmOpen}
        title={confirmTitle}
        message={confirmMessage}
        confirmLabel={confirmConfirmLabel}
        cancelLabel={confirmCancelLabel}
        onConfirm={() => resolveConfirm(true)}
        onCancel={() => resolveConfirm(false)}
      />
    </div>
  );
}