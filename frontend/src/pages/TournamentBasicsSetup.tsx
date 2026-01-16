// frontend/src/pages/TournamentBasicsSetup.tsx
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { apiFetch } from "../api";
import { useTournamentFlowGuard } from "../flow/TournamentFlowGuardContext";
import TournamentFlowNav from "../components/TournamentFlowNav";
import TournamentStepFooter from "../components/TournamentStepFooter";

/* ====== typy ====== */
type Discipline = "football" | "volleyball" | "basketball" | "handball" | "tennis" | "wrestling";
type TournamentFormat = "LEAGUE" | "CUP" | "MIXED";

/* --- Handball --- */
type HandballTableDrawMode = "ALLOW_DRAW" | "PENALTIES" | "OVERTIME_PENALTIES";
type HandballKnockoutTiebreak = "OVERTIME_PENALTIES" | "PENALTIES";
type HandballPointsMode = "2_1_0" | "3_1_0" | "3_2_1_0";

/* --- Tennis --- */
type TennisBestOf = 3 | 5;
type TennisPointsMode = "NONE" | "PLT";

/* --- ZMIANA A: dodanie my_role do DTO --- */
type TournamentDTO = {
  id: number;
  name: string;
  discipline: Discipline;
  tournament_format: TournamentFormat;
  format_config: Record<string, any>;
  status?: "DRAFT" | "CONFIGURED" | "RUNNING" | "FINISHED";
  my_role?: "ORGANIZER" | "ASSISTANT" | null;
};

type TeamDTO = { id: number; name: string };

/* --- Stałe opcje --- */
const HB_POINTS_OPTIONS: { value: HandballPointsMode; label: string }[] = [
  { value: "2_1_0", label: "2-1-0 (W-R-P)" },
  { value: "3_1_0", label: "3-1-0 (W-R-P)" },
  { value: "3_2_1_0", label: "3-2-1-0 (karne: W=2, P=1)" },
];

const TENNIS_BEST_OF_OPTIONS: { value: TennisBestOf; label: string }[] = [
  { value: 3, label: "Best of 3 (do 2 wygranych setów)" },
  { value: 5, label: "Best of 5 (do 3 wygranych setów)" },
];

const TENNIS_POINTS_MODE_OPTIONS: { value: TennisPointsMode; label: string; hint?: string }[] = [
  {
    value: "NONE",
    label: "Bez punktów (ranking: zwycięstwa, RS, RG, H2H)",
    hint: "Klasyczny wariant grup tenisowych: tabela bez kolumny Pkt.",
  },
  {
    value: "PLT",
    label: "Punktacja PLT (np. 10/8/4/2/0)",
    hint: "Jeśli Twoja liga używa punktów – backend liczy i zwraca Pkt.",
  },
];

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
  return (size * (size - 1)) / 2 * matchesPerPair;
}

function isPowerOfTwo(n: number) {
  if (n < 1) return false;
  return (n & (n - 1)) === 0;
}

/* =========================
   SYSTEM OPISÓW (INFO BOXES)
   ========================= */

type InfoBoxVariant = "info" | "warning" | "note";

type InfoBox = {
  id: string;
  title: string;
  body: React.ReactNode;
  variant?: InfoBoxVariant;
};

function disciplineLabel(d: Discipline) {
  switch (d) {
    case "football":
      return "Piłka nożna";
    case "handball":
      return "Piłka ręczna";
    case "tennis":
      return "Tenis";
    case "volleyball":
      return "Siatkówka";
    case "basketball":
      return "Koszykówka";
    case "wrestling":
      return "Zapasy";
    default:
      return d;
  }
}

function formatLabel(f: TournamentFormat) {
  switch (f) {
    case "LEAGUE":
      return "Liga";
    case "CUP":
      return "Puchar (KO)";
    case "MIXED":
      return "Grupy + puchar";
    default:
      return f;
  }
}

function buildInfoBoxes(params: {
  discipline: Discipline;
  format: TournamentFormat;
  participants: number;

  // league/group config
  leagueMatches: 1 | 2;
  groupsCount: number;
  groupMatches: 1 | 2;
  advanceFromGroup: number;
  minGroupSize: number;

  // cup config
  cupMatches: 1 | 2;
  finalMatches: 1 | 2;
  thirdPlace: boolean;
  thirdPlaceMatches: 1 | 2;

  // handball
  isHandball: boolean;
  hbPointsMode: HandballPointsMode;
  hbTableDrawMode: HandballTableDrawMode;
  hbKnockoutTiebreak: HandballKnockoutTiebreak;

  // tennis
  isTennis: boolean;
  tennisBestOf: TennisBestOf;
  tennisPointsMode: TennisPointsMode;
}): InfoBox[] {
  const {
    discipline,
    format,
    participants,
    leagueMatches,
    groupsCount,
    groupMatches,
    advanceFromGroup,
    minGroupSize,
    cupMatches,
    finalMatches,
    thirdPlace,
    thirdPlaceMatches,
    isHandball,
    hbPointsMode,
    hbTableDrawMode,
    hbKnockoutTiebreak,
    isTennis,
    tennisBestOf,
    tennisPointsMode,
  } = params;

  const boxes: InfoBox[] = [];

  // 1) SPORT I ZASADY MECZU
  if (isTennis) {
    boxes.push({
      id: "sport-tennis",
      title: "Sport i zasady meczu: Tenis",
      variant: "info",
      body: (
        <div style={{ lineHeight: 1.5 }}>
          <div>
            Mecze tenisowe rozgrywamy w systemie <strong>Best of {tennisBestOf}</strong> (do{" "}
            <strong>{tennisBestOf === 3 ? "2" : "3"}</strong> wygranych setów).
          </div>
          <div style={{ marginTop: 6 }}>
            Wynik w systemie zapisujesz jako <strong>gemy w setach</strong> (np. 6:4, 3:6, 10:8). Na podstawie setów i
            gemów budowana jest tabela (sety: RS/RG, gemy: różnica gemów).
          </div>
          <div style={{ marginTop: 6 }}>
            W tenisie w tej wersji systemu <strong>KO nie obsługuje dwumeczu</strong> – rundy, finał i mecz o 3. miejsce
            są zawsze pojedynczym meczem.
          </div>
        </div>
      ),
    });
  } else if (isHandball) {
    boxes.push({
      id: "sport-handball",
      title: "Sport i zasady meczu: Piłka ręczna",
      variant: "info",
      body: (
        <div style={{ lineHeight: 1.5 }}>
          <div>Mecze wprowadzamy jako wynik bramkowy (bramki zdobyte/stracone).</div>
          <div style={{ marginTop: 6 }}>
            W rozgrywkach ligowych/grupowych remis może być dopuszczalny lub rozstrzygany (np. karne) – zależy to od
            ustawienia <strong>Rozstrzyganie meczów</strong>.
          </div>
          <div style={{ marginTop: 6 }}>
            Punktacja tabeli zależy od wybranego modelu: <strong>{hbPointsMode}</strong>. Poniżej system opisuje wpływ
            tej punktacji na tabelę i remisy.
          </div>
        </div>
      ),
    });
  } else if (discipline === "football") {
    boxes.push({
      id: "sport-football",
      title: "Sport i zasady meczu: Piłka nożna",
      variant: "info",
      body: (
        <div style={{ lineHeight: 1.5 }}>
          <div>Mecze wprowadzamy jako wynik bramkowy (bramki zdobyte/stracone).</div>
          <div style={{ marginTop: 6 }}>
            W fazie ligowej/grupowej remis jest możliwy. W fazie pucharowej para powinna wyłonić zwycięzcę zgodnie z
            regulaminem turnieju (np. dogrywka/karne), jeżeli wymagasz rozstrzygnięcia.
          </div>
          <div style={{ marginTop: 6 }}>
            Dla tabeli stosujemy reguły <strong>PZPN</strong> (opis poniżej) – szczególnie ważne przy równej liczbie
            punktów.
          </div>
        </div>
      ),
    });
  } else {
    boxes.push({
      id: "sport-generic",
      title: `Sport i zasady meczu: ${disciplineLabel(discipline)}`,
      variant: "info",
      body: (
        <div style={{ lineHeight: 1.5 }}>
          <div>
            Ten ekran konfiguruje strukturę turnieju (liga / KO / mixed) oraz zasady tabeli. Dla tej dyscypliny możesz
            doprecyzować regulamin w opisie turnieju (np. długość setów/kwart, dogrywki itp.).
          </div>
        </div>
      ),
    });
  }

  // 2) TYP ROZGRYWEK (format)
  boxes.push({
    id: "format",
    title: `Typ rozgrywek: ${formatLabel(format)}`,
    variant: "info",
    body: (
      <div style={{ lineHeight: 1.5 }}>
        {format === "LEAGUE" && (
          <>
            <div>
              <strong>Liga</strong> oznacza system „każdy z każdym”. Liczba spotkań w parze zależy od ustawienia:{" "}
              <strong>{leagueMatches === 2 ? "dwumecz (rewanż)" : "1 mecz"}</strong>.
            </div>
            <div style={{ marginTop: 6 }}>
              Tabela na bieżąco pokazuje klasyfikację. Po zakończeniu etapu system może stosować dodatkowe kryteria
              rozstrzygania remisów (H2H) – szczegóły w sekcji „Tabela i awans”.
            </div>
          </>
        )}

        {format === "CUP" && (
          <>
            <div>
              <strong>Puchar (KO)</strong> oznacza drabinkę pucharową: przegrany odpada, wygrany przechodzi dalej.
            </div>
            <div style={{ marginTop: 6 }}>
              Rundy: <strong>{cupMatches === 2 ? "dwumecz" : "1 mecz"}</strong>, finał:{" "}
              <strong>{finalMatches === 2 ? "2 mecze" : "1 mecz"}</strong>
              {thirdPlace ? (
                <>
                  , mecz o 3. miejsce: <strong>{thirdPlaceMatches === 2 ? "2 mecze" : "1 mecz"}</strong>
                </>
              ) : (
                ", bez meczu o 3. miejsce"
              )}
              .
            </div>
            {cupMatches === 2 && !isTennis && (
              <div style={{ marginTop: 6 }}>
                Dwumecz: pojedynczy mecz może zakończyć się remisem, ale <strong>para w całym dwumeczu musi mieć zwycięzcę</strong>{" "}
                zgodnie z regulaminem (np. dogrywka/karne w drugim meczu, jeśli suma jest remisowa).
              </div>
            )}
          </>
        )}

        {format === "MIXED" && (
          <>
            <div>
              <strong>Grupy + puchar</strong>: najpierw faza grupowa (tabela), a następnie faza pucharowa (KO) dla
              awansujących.
            </div>
            <div style={{ marginTop: 6 }}>
              Grupy: <strong>{groupsCount}</strong>, mecze w grupach: <strong>{groupMatches === 2 ? "dwumecz" : "1 mecz"}</strong>, awans z każdej grupy:{" "}
              <strong>{advanceFromGroup}</strong>.
            </div>
            <div style={{ marginTop: 6 }}>
              Po fazie grupowej system buduje drabinkę KO dla awansujących. Jeśli liczba awansujących nie jest potęgą 2,
              w drabince mogą pojawić się wolne losy (BYE).
            </div>
          </>
        )}
      </div>
    ),
  });

  // 3) TABELA I AWANS (Liga lub Mixed)
  const showTable = format === "LEAGUE" || format === "MIXED";
  if (showTable) {
    if (isTennis) {
      boxes.push({
        id: "table-tennis",
        title: "Tabela i awans: Tenis (NONE vs PLT)",
        variant: "note",
        body: (
          <div style={{ lineHeight: 1.5 }}>
            <div>
              Wybrany system klasyfikacji: <strong>{tennisPointsMode}</strong>.
            </div>
            {tennisPointsMode === "NONE" ? (
              <>
                <div style={{ marginTop: 6 }}>
                  <strong>NONE (bez punktów)</strong>: podstawą tabeli są <strong>zwycięstwa</strong>. Przy remisie po
                  zwycięstwach liczą się kolejno: różnica setów (RS−RG), sety wygrane, różnica gemów, gemy wygrane.
                </div>
                <div style={{ marginTop: 6 }}>
                  Po zakończeniu całego etapu, dla drużyn ex aequo system rozstrzyga remis w oparciu o{" "}
                  <strong>mecze bezpośrednie (H2H)</strong>: zwycięstwa H2H, różnica setów H2H, sety H2H, różnica gemów
                  H2H, gemy H2H.
                </div>
              </>
            ) : (
              <>
                <div style={{ marginTop: 6 }}>
                  <strong>PLT</strong>: tabela zawiera punkty (np. 10/8/4/2/0) i sortuje głównie po <strong>pkt</strong>.
                  Przy remisie punktowym system bierze dodatkowo zwycięstwa, a potem sety i gemy.
                </div>
                <div style={{ marginTop: 6 }}>
                  Po zakończeniu etapu, dla remisów punktowych stosowane jest <strong>H2H</strong> (punkty i wyniki H2H),
                  a następnie fallback do kryteriów ogólnych.
                </div>
              </>
            )}
            <div style={{ marginTop: 6, color: "#666" }}>
              Uwaga praktyczna: PLT wpływa na tabelę ligową/grupową. Faza KO rozstrzyga się wynikami meczów (bez tabeli
              punktowej).
            </div>
          </div>
        ),
      });
    } else if (isHandball) {
      boxes.push({
        id: "table-handball",
        title: "Tabela i awans: Piłka ręczna (kryteria rozstrzygania remisów)",
        variant: "note",
        body: (
          <div style={{ lineHeight: 1.5 }}>
            <div>
              Punktacja tabeli: <strong>{HB_POINTS_OPTIONS.find((x) => x.value === hbPointsMode)?.label ?? hbPointsMode}</strong>
            </div>
            <div style={{ marginTop: 6 }}>
              W trakcie etapu tabela jest sortowana: <strong>Pkt → bilans bramek → bramki zdobyte → nazwa</strong>.
            </div>
            <div style={{ marginTop: 6 }}>
              Po zakończeniu etapu (gdy wszystkie mecze są FINISHED), dla drużyn z równą liczbą punktów system liczy
              „małą tabelę” (H2H): <strong>pkt H2H → bilans H2H → bramki H2H</strong>. Jeśli nadal remis, wraca do
              kryteriów ogólnych.
            </div>
            <div style={{ marginTop: 6 }}>
              Rozstrzyganie meczów w fazie ligowej/grupowej:{" "}
              <strong>
                {hbTableDrawMode === "ALLOW_DRAW"
                  ? "remis dopuszczalny"
                  : hbTableDrawMode === "PENALTIES"
                    ? "remis → karne"
                    : "remis → dogrywka + karne"}
              </strong>
              .
            </div>
          </div>
        ),
      });

      // punktacja-specyficzna wskazówka
      if (hbPointsMode === "3_2_1_0") {
        boxes.push({
          id: "hb-3210",
          title: "Piłka ręczna: 3-2-1-0 (ważne konsekwencje)",
          variant: "warning",
          body: (
            <div style={{ lineHeight: 1.5 }}>
              <div>
                Tryb <strong>3-2-1-0</strong> zakłada rozstrzyganie remisów (np. karne), bo inaczej nie da się przydzielić
                punktów 2 i 1 za wynik po karnych.
              </div>
              <div style={{ marginTop: 6 }}>
                Dlatego przy 3-2-1-0 system wymusza, aby mecze remisowe miały rozstrzygnięcie (co najmniej karne).
              </div>
            </div>
          ),
        });
      }
    } else if (discipline === "football") {
      boxes.push({
        id: "table-football",
        title: "Tabela i awans: Piłka nożna (PZPN – zasady kolejności)",
        variant: "note",
        body: (
          <div style={{ lineHeight: 1.5 }}>
            <div>
              Sortowanie tabeli bazuje na regułach PZPN: <strong>punkty → H2H (warunkowo) → bilans → bramki → zwycięstwa → zwycięstwa wyjazdowe</strong>.
            </div>
            <div style={{ marginTop: 6 }}>
              H2H (mecze bezpośrednie) jest używane <strong>tylko wtedy</strong>, gdy w danym bloku remisowym zostały
              rozegrane i zakończone wszystkie wymagane mecze bezpośrednie pomiędzy tymi drużynami. W przeciwnym razie
              system przechodzi do kryteriów ogólnych (bilans, bramki itd.).
            </div>
          </div>
        ),
      });
    } else {
      boxes.push({
        id: "table-generic",
        title: "Tabela i awans",
        variant: "note",
        body: (
          <div style={{ lineHeight: 1.5 }}>
            <div>
              W rozgrywkach ligowych/grupowych tabela decyduje o kolejności. Przy remisach punktowych system korzysta z
              dodatkowych kryteriów (np. bilans, punkty bezpośrednie, różnice) zależnie od dyscypliny.
            </div>
          </div>
        ),
      });
    }

    // Mixed — doprecyzowanie awansu
    if (format === "MIXED") {
      boxes.push({
        id: "mixed-advance",
        title: "Faza grupowa → faza pucharowa",
        variant: "info",
        body: (
          <div style={{ lineHeight: 1.5 }}>
            <div>
              Awans do KO: <strong>{groupsCount}</strong> grup × <strong>{advanceFromGroup}</strong> awansujących ={" "}
              <strong>{groupsCount * advanceFromGroup}</strong> uczestników w drabince KO.
            </div>
            <div style={{ marginTop: 6 }}>
              Jeśli liczba awansujących nie jest potęgą 2, system może dodać wolne losy (BYE), aby zbudować poprawną
              drabinkę.
            </div>
          </div>
        ),
      });
    }
  }

  // 4) OSTRZEŻENIA / OGRANICZENIA zależne od ustawień
  // - tenis: brak dwumeczu już opisany, ale zostawimy też lekki alert jeśli user próbuje ustawić
  if (isTennis && (cupMatches !== 1 || finalMatches !== 1 || thirdPlaceMatches !== 1)) {
    boxes.push({
      id: "warn-tennis-ko",
      title: "Ograniczenie: tenis i dwumecz",
      variant: "warning",
      body: (
        <div style={{ lineHeight: 1.5 }}>
          System ustawia tenisowe KO jako pojedyncze mecze (rundy/finał/3. miejsce). Dwumecz w KO jest wyłączony.
        </div>
      ),
    });
  }

  // - Mixed: minimalna grupa
  if (format === "MIXED" && minGroupSize > 0 && minGroupSize < 2) {
    boxes.push({
      id: "warn-mixed-minsize",
      title: "Uwaga: zbyt małe grupy",
      variant: "warning",
      body: (
        <div style={{ lineHeight: 1.5 }}>
          Najmniejsza grupa ma <strong>{minGroupSize}</strong> uczestników. W MIXED każda grupa musi mieć co najmniej 2
          uczestników.
        </div>
      ),
    });
  }

  // - KO: dwumecz jako zasada turniejowa (nie obiecujemy automatyki, tylko regułę)
  if (!isTennis && format === "CUP" && cupMatches === 2) {
    boxes.push({
      id: "note-aggregate",
      title: "Dwumecz: praktyczna zasada rozstrzygnięcia",
      variant: "note",
      body: (
        <div style={{ lineHeight: 1.5 }}>
          W dwumeczu można dopuścić remis w pojedynczym meczu, ale w całej parze powinno zostać rozstrzygnięte, kto
          przechodzi dalej (np. przez dodatkowe zasady w drugim meczu).
        </div>
      ),
    });
  }

  // 5) Krótkie podsumowanie parametrów „dla organizatora”
  boxes.push({
    id: "summary-settings",
    title: "Szybkie podsumowanie wybranych ustawień",
    variant: "info",
    body: (
      <div style={{ lineHeight: 1.5 }}>
        <div>
          <strong>Sport:</strong> {disciplineLabel(discipline)} | <strong>Format:</strong> {formatLabel(format)} |{" "}
          <strong>Uczestnicy:</strong> {participants}
        </div>
        {format === "LEAGUE" && (
          <div style={{ marginTop: 6 }}>
            Liga: <strong>{leagueMatches === 2 ? "dwumecz" : "1 mecz"}</strong> w parze.
          </div>
        )}
        {format === "MIXED" && (
          <div style={{ marginTop: 6 }}>
            Grupy: <strong>{groupsCount}</strong>, mecze w grupie: <strong>{groupMatches === 2 ? "dwumecz" : "1 mecz"}</strong>, awans:{" "}
            <strong>{advanceFromGroup}</strong> (min. rozmiar grupy: {minGroupSize || "—"}).
          </div>
        )}
        {(format === "CUP" || format === "MIXED") && (
          <div style={{ marginTop: 6 }}>
            KO: rundy <strong>{isTennis ? "1 mecz" : cupMatches === 2 ? "dwumecz" : "1 mecz"}</strong>, finał{" "}
            <strong>{isTennis ? "1 mecz" : finalMatches === 2 ? "2 mecze" : "1 mecz"}</strong>
            {thirdPlace ? (
              <>
                , 3. miejsce <strong>{isTennis ? "1 mecz" : thirdPlaceMatches === 2 ? "2 mecze" : "1 mecz"}</strong>
              </>
            ) : null}
            .
          </div>
        )}
      </div>
    ),
  });

  return boxes;
}

function InfoBoxCard({ box }: { box: InfoBox }) {
  const variant = box.variant ?? "info";

  const styleByVariant: Record<InfoBoxVariant, React.CSSProperties> = {
    info: {
      border: "1px solid #3b3b3b",
      background: "rgba(255,255,255,0.02)",
    },
    note: {
      border: "1px solid #3b3b3b",
      background: "rgba(255,255,255,0.02)",
    },
    warning: {
      border: "1px solid rgba(255, 165, 0, 0.55)",
      background: "rgba(255, 165, 0, 0.08)",
    },
  };

  const titleColor = variant === "warning" ? "orange" : "inherit";

  return (
    <div
      style={{
        padding: "0.9rem 1rem",
        borderRadius: 12,
        ...styleByVariant[variant],
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 6, color: titleColor }}>{box.title}</div>
      <div style={{ color: "#cfcfcf" }}>{box.body}</div>
    </div>
  );
}

export default function TournamentBasicsSetup() {
  const { id } = useParams<{ id: string }>();
  const isCreateMode = !id;
  const navigate = useNavigate();
  const location = useLocation();

  const { dirty, markDirty, registerSave } = useTournamentFlowGuard();
  const createdIdRef = useRef<string | null>(null);

  const [loading, setLoading] = useState(!isCreateMode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* --- ZMIANA B: stan roli + flaga read-only --- */
  const [myRole, setMyRole] = useState<"ORGANIZER" | "ASSISTANT" | null>(null);
  const isAssistantReadOnly = !isCreateMode && myRole === "ASSISTANT";

  /* ====== KROK 1 (dane podstawowe) ====== */
  const [name, setName] = useState("");
  const [discipline, setDiscipline] = useState<Discipline>("football");
  const [initialDiscipline, setInitialDiscipline] = useState<Discipline>("football");
  const [initialName, setInitialName] = useState("");

  /* ====== KROK 2 (format i struktura) ====== */
  const [format, setFormat] = useState<TournamentFormat>("LEAGUE");
  const [participants, setParticipants] = useState(8);
  const initialParticipantsRef = useRef<number>(8);

  /* --- Konfiguracja Ligi / Grup --- */
  const [leagueMatches, setLeagueMatches] = useState<1 | 2>(1);
  const [groupsCount, setGroupsCount] = useState(2);
  const [groupMatches, setGroupMatches] = useState<1 | 2>(1);
  const [advanceFromGroup, setAdvanceFromGroup] = useState(2);

  // Handball: Liga / Grupa
  const [hbTableDrawMode, setHbTableDrawMode] = useState<HandballTableDrawMode>("ALLOW_DRAW");
  const [hbPointsMode, setHbPointsMode] = useState<HandballPointsMode>("2_1_0");

  /* --- Konfiguracja Pucharu (KO) --- */
  const [cupMatches, setCupMatches] = useState<1 | 2>(1);
  const [finalMatches, setFinalMatches] = useState<1 | 2>(1);
  const [thirdPlace, setThirdPlace] = useState(false);
  const [thirdPlaceMatches, setThirdPlaceMatches] = useState<1 | 2>(1);

  // Handball: Puchar
  const [hbKnockoutTiebreak, setHbKnockoutTiebreak] = useState<HandballKnockoutTiebreak>("OVERTIME_PENALTIES");

  // Tennis: best-of
  const [tennisBestOf, setTennisBestOf] = useState<TennisBestOf>(3);

  // Tennis: tabela – punkty lub bez punktów
  const [tennisPointsMode, setTennisPointsMode] = useState<TennisPointsMode>("NONE");

  const isHandball = discipline === "handball";
  const isTennis = discipline === "tennis";

  /* ====== Logika spójności Handball ====== */
  useEffect(() => {
    if (hbPointsMode === "3_2_1_0" && hbTableDrawMode === "ALLOW_DRAW") {
      setHbTableDrawMode("PENALTIES");
    }
  }, [hbPointsMode, hbTableDrawMode]);

  /* ====== Logika spójności TENIS ====== */
  useEffect(() => {
    if (!isTennis) return;
    if (cupMatches !== 1) setCupMatches(1);
    if (finalMatches !== 1) setFinalMatches(1);
    if (thirdPlaceMatches !== 1) setThirdPlaceMatches(1);
  }, [isTennis, cupMatches, finalMatches, thirdPlaceMatches]);

  /* ====== MIXED: pilnowanie spójności grup ====== */
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

  /* ====== Obsługa Flash Error ====== */
  useEffect(() => {
    const flash = (location.state as any)?.flashError as string | undefined;
    if (flash) {
      setError(flash);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, navigate, location.pathname]);

  /* ====== Load existing data ====== */
  useEffect(() => {
    if (isCreateMode) return;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [tRes, teamsRes] = await Promise.all([apiFetch(`/api/tournaments/${id}/`), apiFetch(`/api/tournaments/${id}/teams/`)]);

        if (!tRes.ok) throw new Error("Nie udało się pobrać danych turnieju.");
        if (!teamsRes.ok) throw new Error("Nie udało się pobrać listy uczestników.");

        const t: TournamentDTO = await tRes.json();
        const teams: TeamDTO[] = await teamsRes.json();

        setMyRole(t.my_role ?? null);

        setName(t.name);
        setInitialName(t.name);
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
      } catch (e: any) {
        setError(e.message || "Błąd ładowania.");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [id, isCreateMode]);

  /* ====== Preview ====== */
  const preview = useMemo(() => {
    const p = clampInt(participants, 2, 10_000);

    if (format === "LEAGUE") {
      const matches = (p * (p - 1)) / 2 * leagueMatches;
      return { matches };
    }

    if (format === "CUP") {
      const roundsMatches = Math.max(0, (p - 2) * cupMatches);
      const finalCount = finalMatches;
      const thirdCount = thirdPlace ? thirdPlaceMatches : 0;
      return { matches: roundsMatches + finalCount + thirdCount };
    }

    if (format === "MIXED") {
      const safeGroups = clampInt(groupsCount, 1, Math.max(1, Math.floor(p / 2)));
      const sizes = splitIntoGroups(p, safeGroups);
      const groupTotal = sizes.reduce((sum, size) => sum + roundRobinMatches(size, groupMatches), 0);
      const minSize = sizes.length ? Math.min(...sizes) : 2;
      const adv = clampInt(advanceFromGroup, 1, Math.max(1, minSize));
      const advancing = sizes.length * adv;

      if (advancing < 2) {
        return { matches: groupTotal, groupMatches: groupTotal, koMatches: 0, groups: sizes.length };
      }

      const koRoundsMatches = Math.max(0, (advancing - 2) * cupMatches);
      const finalCount = finalMatches;
      const thirdCount = thirdPlace ? thirdPlaceMatches : 0;
      const koTotal = koRoundsMatches + finalCount + thirdCount;

      return {
        matches: groupTotal + koTotal,
        groupMatches: groupTotal,
        koMatches: koTotal,
        groups: sizes.length,
        advancing,
      };
    }
    return null;
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

  /* ====== Helpers ====== */
  const confirmDisciplineChange = () => {
    return window.confirm(
      "Zmiana dyscypliny spowoduje usunięcie wprowadzonych wyników oraz danych pochodnych.\n\nCzy na pewno chcesz kontynuować?"
    );
  };

  const validateLocalBeforeSave = (): string | null => {
    const trimmedName = name.trim();
    if (!trimmedName) return "Wpisz nazwę turnieju — bez tego nie da się przejść dalej.";

    const p = clampInt(participants, 2, 10_000);

    if (format === "MIXED") {
      const gMax = Math.max(1, Math.floor(p / 2));
      const g = clampInt(groupsCount, 1, gMax);
      const sizes = splitIntoGroups(p, g);
      const minSize = sizes.length ? Math.min(...sizes) : 2;

      if (minSize < 2) return "W MIXED każda grupa musi mieć co najmniej 2 zespoły (zmniejsz liczbę grup).";

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
        return "Tenis: KO nie wspiera dwumeczów — ustaw rundy/finał/3. miejsce na 1 mecz.";
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

  /* ====== SAVE ACTION ====== */
  const saveAll = useCallback(async (): Promise<{ tournamentId: number }> => {
    if (isAssistantReadOnly) {
      const msg = "Tryb podglądu: asystent nie może zmieniać konfiguracji turnieju.";
      setError(msg);
      throw new Error(msg);
    }

    const localMsg = validateLocalBeforeSave();
    if (localMsg) {
      if (localMsg.startsWith("Uwaga:")) {
        if (!window.confirm(`${localMsg}\n\nKontynuować zapis?`)) {
          setError("Anulowano zapis konfiguracji.");
          throw new Error("Anulowano zapis konfiguracji.");
        }
      } else {
        setError(localMsg);
        throw new Error(localMsg);
      }
    }

    if (!isCreateMode && !dirty) return { tournamentId: Number(id) };

    setSaving(true);
    setError(null);
    let createdId: number | null = null;

    try {
      const trimmedName = name.trim();
      let tournamentId = Number(id);

      if (isCreateMode) {
        const createRes = await apiFetch("/api/tournaments/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmedName, discipline }),
        });

        if (!createRes.ok) {
          const data = await createRes.json().catch(() => ({}));
          throw new Error(data?.detail || "Nie udało się utworzyć turnieju.");
        }

        const created = await createRes.json();
        createdId = created.id;
        tournamentId = created.id;

        setInitialName(trimmedName);
        setInitialDiscipline(discipline);
      } else {
        if (discipline !== initialDiscipline) {
          if (!confirmDisciplineChange()) {
            setDiscipline(initialDiscipline);
          } else {
            const res = await apiFetch(`/api/tournaments/${tournamentId}/change-discipline/`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ discipline }),
            });
            if (!res.ok) throw new Error("Nie udało się zmienić dyscypliny.");
            setInitialDiscipline(discipline);
          }
        }

        if (trimmedName !== initialName) {
          const res = await apiFetch(`/api/tournaments/${tournamentId}/`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: trimmedName }),
          });
          if (!res.ok) throw new Error("Nie udało się zapisać nazwy.");
          setInitialName(trimmedName);
        }
      }

      const format_config = buildFormatConfig();

      const dry = await apiFetch(`/api/tournaments/${tournamentId}/setup/?dry_run=true`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tournament_format: format, format_config }),
      });
      if (!dry.ok) throw new Error("Błąd walidacji konfiguracji.");

      const dryData = await dry.json().catch(() => ({}));
      const resetNeeded = Boolean((dryData as any)?.reset_needed);

      if (!isCreateMode && resetNeeded) {
        if (!window.confirm("Zmiana konfiguracji usunie istniejące mecze. Kontynuować?")) {
          throw new Error("Anulowano zapis konfiguracji.");
        }
      }

      const res = await apiFetch(`/api/tournaments/${tournamentId}/setup/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tournament_format: format, format_config }),
      });
      if (!res.ok) throw new Error("Błąd zapisu konfiguracji.");

      const safeParticipants = clampInt(participants, 2, 10_000);
      const participantsChanged = safeParticipants !== initialParticipantsRef.current;

      if (!isCreateMode && participantsChanged && !resetNeeded) {
        if (!window.confirm("Zmiana liczby uczestników spowoduje reset rozgrywek. Kontynuować?")) {
          throw new Error("Anulowano zmianę liczby uczestników.");
        }
      }

      const teamsRes = await apiFetch(`/api/tournaments/${tournamentId}/teams/setup/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teams_count: safeParticipants }),
      });
      if (!teamsRes.ok) throw new Error("Nie udało się ustawić liczby uczestników.");

      initialParticipantsRef.current = safeParticipants;

      return { tournamentId };
    } catch (e: any) {
      const msg = e?.message || "Nie udało się zapisać.";
      if (isCreateMode && createdId) {
        navigate(`/tournaments/${createdId}/setup`, { replace: true, state: { flashError: msg } });
        return { tournamentId: createdId };
      }
      throw e;
    } finally {
      setSaving(false);
    }
  }, [
    isCreateMode,
    id,
    dirty,
    name,
    discipline,
    initialDiscipline,
    initialName,
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
    hbTableDrawMode,
    hbKnockoutTiebreak,
    hbPointsMode,
    tennisBestOf,
    tennisPointsMode,
    navigate,
    isAssistantReadOnly,
    isTennis,
  ]);

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

  /* ====== INFO BOXES (dynamiczne) ====== */
  const infoBoxes = useMemo(() => {
    return buildInfoBoxes({
      discipline,
      format,
      participants,
      leagueMatches,
      groupsCount,
      groupMatches,
      advanceFromGroup,
      minGroupSize,
      cupMatches,
      finalMatches,
      thirdPlace,
      thirdPlaceMatches,
      isHandball,
      hbPointsMode,
      hbTableDrawMode,
      hbKnockoutTiebreak,
      isTennis,
      tennisBestOf,
      tennisPointsMode,
    });
  }, [
    discipline,
    format,
    participants,
    leagueMatches,
    groupsCount,
    groupMatches,
    advanceFromGroup,
    minGroupSize,
    cupMatches,
    finalMatches,
    thirdPlace,
    thirdPlaceMatches,
    isHandball,
    hbPointsMode,
    hbTableDrawMode,
    hbKnockoutTiebreak,
    isTennis,
    tennisBestOf,
    tennisPointsMode,
  ]);

  if (loading) return <p style={{ padding: "2rem" }}>Ładowanie…</p>;

  const showLeagueOrGroupConfig = format === "LEAGUE" || format === "MIXED";
  const showKnockoutConfig = format === "CUP" || format === "MIXED";

  return (
    <div style={{ padding: "2rem", maxWidth: 900 }}>
      {isCreateMode && <TournamentFlowNav getCreatedId={() => createdIdRef.current} />}

      <h1>Konfiguracja turnieju</h1>

      {isAssistantReadOnly && (
        <div
          style={{
            marginTop: 12,
            padding: "0.75rem 1rem",
            border: "1px solid #555",
            borderRadius: 10,
            background: "rgba(255, 193, 7, 0.08)",
          }}
        >
          <strong>Tryb podglądu.</strong> Jako asystent możesz przeglądać konfigurację, ale nie możesz jej zmieniać.
          Zmiany wykonuje organizator.
        </div>
      )}

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {/* ====== NOWY BLOK: Informacje / zasady (dynamiczne) ====== */}
      <section style={{ marginTop: "1.25rem" }}>
        <h3 style={{ marginBottom: 10 }}>Zasady i objaśnienia</h3>
        <div style={{ display: "grid", gap: 10 }}>
          {infoBoxes.map((b) => (
            <InfoBoxCard key={b.id} box={b} />
          ))}
        </div>
      </section>

      <fieldset
        disabled={saving || isAssistantReadOnly}
        style={{
          border: 0,
          padding: 0,
          margin: 0,
          marginTop: "1.75rem",
          opacity: saving || isAssistantReadOnly ? 0.9 : 1,
        }}
      >
        {/* ===== 1. DANE TURNIEJU ===== */}
        <section style={{ marginTop: "1.5rem" }}>
          <h3>Dane turnieju</h3>

          <div style={{ marginBottom: 12 }}>
            <label>Nazwa</label>
            <input
              style={{ width: "100%", padding: 8 }}
              value={name}
              required
              onChange={(e) => {
                setName(e.target.value);
                markDirty();
                if (error) setError(null);
              }}
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label>Dyscyplina</label>
            <select
              style={{ width: "100%", padding: 8 }}
              value={discipline}
              onChange={(e) => {
                setDiscipline(e.target.value as Discipline);
                markDirty();
              }}
            >
              <option value="football">Piłka nożna</option>
              <option value="volleyball">Siatkówka</option>
              <option value="basketball">Koszykówka</option>
              <option value="handball">Piłka ręczna</option>
              <option value="tennis">Tenis</option>
              <option value="wrestling">Zapasy</option>
            </select>
          </div>

          {isTennis && (
            <div style={{ marginBottom: 12 }}>
              <label>Tenis – format meczu</label>
              <select
                style={{ width: "100%", padding: 8 }}
                value={tennisBestOf}
                disabled={saving || isAssistantReadOnly}
                onChange={(e) => {
                  setTennisBestOf(Number(e.target.value) as TennisBestOf);
                  markDirty();
                }}
              >
                {TENNIS_BEST_OF_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>

              <div style={{ marginTop: 6, fontSize: "0.9em", color: "#666" }}>
                Wyniki będziesz wpisywać w <strong>gemach per set</strong> w ekranie „Wprowadzanie wyników”.
              </div>
            </div>
          )}
        </section>

        {/* ===== 2. RODZAJ TURNIEJU (MASTER SWITCH) ===== */}
        <section style={{ marginTop: "2rem" }}>
          <h3>Rodzaj turnieju</h3>

          <select
            style={{ width: "100%", padding: 8 }}
            value={format}
            onChange={(e) => {
              setFormat(e.target.value as TournamentFormat);
              markDirty();
            }}
            disabled={saving || isAssistantReadOnly}
          >
            <option value="LEAGUE">Liga</option>
            <option value="CUP">Puchar (KO)</option>
            <option value="MIXED">Grupy + puchar</option>
          </select>

          <p style={{ marginTop: 8, fontSize: "0.9em", color: "#666" }}>
            Liczba uczestników:{" "}
            <input
              type="number"
              min={2}
              style={{ width: 80, marginLeft: 8 }}
              value={participants}
              disabled={saving || isAssistantReadOnly}
              onChange={(e) => {
                const p = clampInt(Number(e.target.value), 2, 10_000);
                setParticipants(p);
                markDirty();

                if (format === "MIXED") {
                  const gMax = Math.max(1, Math.floor(p / 2));
                  setGroupsCount((prev) => clampInt(prev, 1, gMax));
                }
              }}
            />
          </p>
        </section>

        {/* ===== 3. FAZA LIGOWA / GRUPOWA ===== */}
        {showLeagueOrGroupConfig && (
          <section style={{ marginTop: "1.5rem" }}>
            <h3>Faza {format === "LEAGUE" ? "ligowa" : "grupowa"}</h3>

            {isTennis && (
              <div style={{ marginBottom: "1rem" }}>
                <strong>Tenis – tabela</strong>
                <div style={{ marginTop: 8 }}>
                  <label style={{ display: "block", marginBottom: 8 }}>
                    System klasyfikacji:
                    <select
                      style={{ marginLeft: 8 }}
                      value={tennisPointsMode}
                      disabled={saving || isAssistantReadOnly}
                      onChange={(e) => {
                        setTennisPointsMode(e.target.value as TennisPointsMode);
                        markDirty();
                      }}
                    >
                      {TENNIS_POINTS_MODE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div style={{ fontSize: "0.9em", color: "#666" }}>
                    {tennisPointsMode === "PLT"
                      ? "Tabela pokaże kolumnę Pkt (liczone wg ustawień w backendzie)."
                      : "Tabela będzie bez punktów – o kolejności decydują: zwycięstwa, RS, RG i H2H (gdy etap zakończony)."}
                  </div>
                </div>
              </div>
            )}

            {isHandball && (
              <div style={{ marginBottom: "1rem" }}>
                <strong>Ustawienia punktacji (Piłka ręczna)</strong>

                <div style={{ marginTop: 8 }}>
                  <label style={{ display: "block", marginBottom: 8 }}>
                    Punktacja (tabela):
                    <select
                      style={{ marginLeft: 8 }}
                      value={hbPointsMode}
                      disabled={saving || isAssistantReadOnly}
                      onChange={(e) => {
                        setHbPointsMode(e.target.value as HandballPointsMode);
                        markDirty();
                      }}
                    >
                      {HB_POINTS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label style={{ display: "block", marginBottom: 8 }}>
                    Rozstrzyganie meczów:
                    <select
                      style={{ marginLeft: 8 }}
                      value={hbTableDrawMode}
                      disabled={saving || isAssistantReadOnly || hbPointsMode === "3_2_1_0"}
                      onChange={(e) => {
                        setHbTableDrawMode(e.target.value as HandballTableDrawMode);
                        markDirty();
                      }}
                    >
                      <option value="ALLOW_DRAW">Remis dopuszczalny</option>
                      <option value="PENALTIES">Remis → karne</option>
                      <option value="OVERTIME_PENALTIES">Remis → dogrywka + karne</option>
                    </select>
                    {hbPointsMode === "3_2_1_0" && (
                      <span style={{ fontSize: "0.8em", color: "orange", marginLeft: 8 }}>
                        (Wymagane przy 3-2-1-0)
                      </span>
                    )}
                  </label>
                </div>
              </div>
            )}

            {format === "LEAGUE" && (
              <div>
                <label>
                  Mecze każdy z każdym:
                  <select
                    style={{ marginLeft: 8 }}
                    value={leagueMatches}
                    disabled={saving || isAssistantReadOnly}
                    onChange={(e) => {
                      setLeagueMatches(Number(e.target.value) as 1 | 2);
                      markDirty();
                    }}
                  >
                    <option value={1}>1 mecz (bez rewanżu)</option>
                    <option value={2}>2 mecze (rewanż)</option>
                  </select>
                </label>
              </div>
            )}

            {format === "MIXED" && (
              <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
                <label>
                  Liczba grup:
                  <input
                    type="number"
                    min={1}
                    max={maxGroupsForMin2PerGroup}
                    style={{ width: 70, marginLeft: 8 }}
                    value={groupsCount}
                    disabled={saving || isAssistantReadOnly}
                    onChange={(e) => {
                      setGroupsCount(clampInt(Number(e.target.value), 1, maxGroupsForMin2PerGroup));
                      markDirty();
                    }}
                  />
                </label>

                <label>
                  Mecze w grupach:
                  <select
                    style={{ marginLeft: 8 }}
                    value={groupMatches}
                    disabled={saving || isAssistantReadOnly}
                    onChange={(e) => {
                      setGroupMatches(Number(e.target.value) as 1 | 2);
                      markDirty();
                    }}
                  >
                    <option value={1}>1 mecz</option>
                    <option value={2}>2 mecze</option>
                  </select>
                </label>

                <label>
                  Awans z grupy:
                  <select
                    style={{ marginLeft: 8 }}
                    value={advanceFromGroup}
                    disabled={saving || isAssistantReadOnly || minGroupSize < 2}
                    onChange={(e) => {
                      setAdvanceFromGroup(Number(e.target.value));
                      markDirty();
                    }}
                  >
                    {advanceOptions.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>

                {groupSizes.length > 0 && (
                  <div style={{ fontSize: "0.9em", color: "#666", alignSelf: "center" }}>
                    Rozmiary grup: {groupSizes.join(", ")} (min: {minGroupSize})
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* ===== 4. FAZA PUCHAROWA ===== */}
        {showKnockoutConfig && (
          <section style={{ marginTop: "1.5rem" }}>
            <h3>Faza pucharowa</h3>

            {isHandball && (
              <div style={{ marginBottom: "1rem" }}>
                <strong>Dogrywki i karne (Puchar)</strong>
                <div style={{ marginTop: 8 }}>
                  <label>
                    Sposób rozstrzygania remisów:
                    <select
                      style={{ marginLeft: 8 }}
                      value={hbKnockoutTiebreak}
                      disabled={saving || isAssistantReadOnly}
                      onChange={(e) => {
                        setHbKnockoutTiebreak(e.target.value as HandballKnockoutTiebreak);
                        markDirty();
                      }}
                    >
                      <option value="OVERTIME_PENALTIES">Dogrywka + karne</option>
                      <option value="PENALTIES">Od razu karne</option>
                    </select>
                  </label>
                </div>
              </div>
            )}

            <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
              <label>
                Rundy (mecze):
                <select
                  style={{ marginLeft: 8 }}
                  value={cupMatches}
                  disabled={saving || isAssistantReadOnly || isTennis}
                  onChange={(e) => {
                    setCupMatches(Number(e.target.value) as 1 | 2);
                    markDirty();
                  }}
                >
                  <option value={1}>1 mecz</option>
                  <option value={2}>2 mecze (dwumecz)</option>
                </select>
                {isTennis && (
                  <span style={{ fontSize: "0.8em", color: "orange", marginLeft: 8 }}>
                    (Tenis: brak dwumeczu)
                  </span>
                )}
              </label>

              <label>
                Finał:
                <select
                  style={{ marginLeft: 8 }}
                  value={finalMatches}
                  disabled={saving || isAssistantReadOnly || isTennis}
                  onChange={(e) => {
                    setFinalMatches(Number(e.target.value) as 1 | 2);
                    markDirty();
                  }}
                >
                  <option value={1}>1 mecz</option>
                  <option value={2}>2 mecze</option>
                </select>
                {isTennis && (
                  <span style={{ fontSize: "0.8em", color: "orange", marginLeft: 8 }}>
                    (Tenis: zawsze 1)
                  </span>
                )}
              </label>

              <label style={{ display: "flex", alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={thirdPlace}
                  disabled={saving || isAssistantReadOnly}
                  onChange={(e) => {
                    setThirdPlace(e.target.checked);
                    markDirty();
                  }}
                  style={{ marginRight: 8 }}
                />
                Mecz o 3. miejsce
              </label>

              {thirdPlace && (
                <label>
                  Mecz o 3. msc:
                  <select
                    style={{ marginLeft: 8 }}
                    value={thirdPlaceMatches}
                    disabled={saving || isAssistantReadOnly || isTennis}
                    onChange={(e) => {
                      setThirdPlaceMatches(Number(e.target.value) as 1 | 2);
                      markDirty();
                    }}
                  >
                    <option value={1}>1 mecz</option>
                    <option value={2}>2 mecze</option>
                  </select>
                  {isTennis && (
                    <span style={{ fontSize: "0.8em", color: "orange", marginLeft: 8 }}>
                      (Tenis: zawsze 1)
                    </span>
                  )}
                </label>
              )}
            </div>
          </section>
        )}
      </fieldset>

      {/* ===== PODGLĄD (zawsze widoczny) ===== */}
      {preview && (
        <section style={{ marginTop: "2rem" }}>
          <h4 style={{ margin: "0 0 10px 0" }}>Podsumowanie struktury</h4>

          {"groups" in preview && (
            <div>
              Liczba grup: <strong>{(preview as any).groups}</strong>
            </div>
          )}
          {"advancing" in preview && (
            <div>
              Awansujących do KO: <strong>{(preview as any).advancing}</strong>
            </div>
          )}
          {"groupMatches" in preview && (
            <div>
              Mecze w grupach: <strong>{(preview as any).groupMatches}</strong>
            </div>
          )}
          {"koMatches" in preview && (
            <div>
              Mecze fazy pucharowej: <strong>{(preview as any).koMatches}</strong>
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            Szacowana łączna liczba meczów: <strong>{(preview as any).matches}</strong>
          </div>
        </section>
      )}

      {isCreateMode ? <TournamentStepFooter getCreatedId={() => createdIdRef.current} /> : null}
    </div>
  );
}
