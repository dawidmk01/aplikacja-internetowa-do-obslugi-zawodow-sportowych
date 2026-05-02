// frontend/src/pages/Home.tsx
// Plik prezentuje główną stronę marketingową systemu i komunikuje realny zakres konfiguracji turniejów.

import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Brackets,
  Dumbbell,
  Flag,
  Gauge,
  Hash,
  Layers3,
  ListChecks,
  Medal,
  Pause,
  Play,
  QrCode,
  Repeat,
  Scale,
  Search,
  ShieldCheck,
  GitBranch,
  Target,
  Timer,
  Trophy,
  Users,
  Zap,
} from "lucide-react";

import { cn } from "../lib/cn";

import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

type RevealProps = {
  children: ReactNode;
  delay?: number;
  className?: string;
};

function Reveal({ children, delay = 0, className }: RevealProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, filter: "blur(4px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.38, ease: "easeOut", delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

type HoverLiftProps = {
  children: ReactNode;
  className?: string;
  scale?: number;
};

function HoverLift({ children, className, scale = 1.01 }: HoverLiftProps) {
  return (
    <motion.div
      whileHover={{ y: -3, scale }}
      transition={{ type: "spring", stiffness: 260, damping: 18 }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

type SectionHeaderProps = {
  eyebrow: string;
  title: string;
  desc: string;
  className?: string;
};

function SectionHeader({ eyebrow, title, desc, className }: SectionHeaderProps) {
  return (
    <div className={className}>
      <div className="text-sm font-medium text-slate-300">{eyebrow}</div>
      <h2 className="mt-1 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{title}</h2>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-300 sm:text-base">{desc}</p>
    </div>
  );
}

function MicroStat({ title, desc, icon }: { title: string; desc: string; icon: ReactNode }) {
  return (
    <Card className="h-full bg-white/[0.04] px-4 py-4">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.06]">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white break-words">{title}</div>
          <div className="mt-1 text-sm leading-relaxed text-slate-300 break-words">{desc}</div>
        </div>
      </div>
    </Card>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs font-medium text-slate-200">
      {children}
    </div>
  );
}

type CapabilityCardProps = {
  icon: ReactNode;
  title: string;
  desc: string;
  items: string[];
};

function CapabilityCard({ icon, title, desc, items }: CapabilityCardProps) {
  return (
    <HoverLift className="h-full">
      <Card className="relative h-full overflow-hidden bg-white/[0.04] p-5">
        <div className="absolute -right-12 -top-12 h-28 w-28 rounded-full bg-white/[0.05] blur-2xl" />
        <div className="relative">
          <div className="grid h-11 w-11 place-items-center rounded-2xl border border-white/10 bg-white/[0.06] text-white/90">
            {icon}
          </div>

          <h3 className="mt-4 text-lg font-semibold text-white">{title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">{desc}</p>

          <div className="mt-4 flex flex-wrap gap-2">
            {items.map((item) => (
              <Pill key={item}>{item}</Pill>
            ))}
          </div>
        </div>
      </Card>
    </HoverLift>
  );
}

type FeatureCardProps = {
  icon: ReactNode;
  title: string;
  desc: string;
};

function FeatureCard({ icon, title, desc }: FeatureCardProps) {
  return (
    <HoverLift className="h-full" scale={1.015}>
      <Card className="h-full bg-white/[0.04] p-5">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.06] text-white/90">
            {icon}
          </div>
          <div className="min-w-0">
            <div className="text-base font-semibold text-white break-words">{title}</div>
            <div className="mt-2 text-sm leading-relaxed text-slate-300 break-words">{desc}</div>
          </div>
        </div>
      </Card>
    </HoverLift>
  );
}

type StepCardProps = {
  n: string;
  title: string;
  desc: string;
  icon: ReactNode;
};

function StepCard({ n, title, desc, icon }: StepCardProps) {
  return (
    <Card className="relative h-full overflow-hidden bg-white/[0.04] p-5">
      <div className="absolute -right-12 -top-12 h-28 w-28 rounded-full bg-white/[0.05] blur-2xl" />
      <div className="relative flex h-full items-start gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.06] text-white/90">
          {icon}
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{n}</span>
            <span className="text-base font-semibold text-white break-words">{title}</span>
          </div>
          <div className="mt-2 text-sm leading-relaxed text-slate-300 break-words">{desc}</div>
        </div>
      </div>
    </Card>
  );
}


type TournamentExample = {
  name: string;
  group: string;
  discipline: string;
  format: string;
  model: string;
  desc: string;
  items: string[];
  icon: ReactNode;
};

const tournamentExamples: TournamentExample[] = [
  {
    name: "Międzyszkolny turniej piłki nożnej",
    group: "Szkoły podstawowe i średnie",
    discipline: "Piłka nożna",
    format: "Grupy + puchar",
    model: "Pojedynki drużynowe",
    desc:
      "Drużyny najpierw grają w grupach, a najlepsze zespoły awansują do fazy finałowej. Organizator prowadzi terminarz, wyniki meczów, tabele i publiczny podgląd dla uczniów oraz opiekunów.",
    items: ["faza grupowa", "awans z grup", "puchar", "tabela", "wyniki meczów"],
    icon: <Trophy className="h-5 w-5" />,
  },
  {
    name: "Szkolne zawody lekkoatletyczne",
    group: "Szkoły i wydarzenia międzyszkolne",
    discipline: "Dyscyplina niestandardowa",
    format: "Etapy redukcyjne",
    model: "Wszyscy razem",
    desc:
      "Konkurencja może opierać się na wyniku czasowym, na przykład w biegu na 400 metrów. System może porównywać czasy, obsłużyć rundy i wskazać uczestników przechodzących do kolejnego etapu.",
    items: ["czas", "serie", "kwalifikacje", "awans", "finał"],
    icon: <Timer className="h-5 w-5" />,
  },
  {
    name: "Liga miejska piłki ręcznej",
    group: "Kluby lokalne i ligi amatorskie",
    discipline: "Piłka ręczna",
    format: "Liga",
    model: "Pojedynki drużynowe",
    desc:
      "Zespoły grają w układzie ligowym, a tabela jest liczona na podstawie przyjętej punktacji. System pomaga prowadzić terminarz, rezultaty, klasyfikację i historię spotkań.",
    items: ["liga", "tabela", "punkty", "remisy", "karne lub dogrywka"],
    icon: <ShieldCheck className="h-5 w-5" />,
  },
  {
    name: "Turniej o Puchar Prezydenta w koszykówce",
    group: "Miasto, gmina lub organizator lokalny",
    discipline: "Koszykówka",
    format: "Puchar",
    model: "Pojedynki drużynowe",
    desc:
      "Turniej można poprowadzić rundami, z finałem i klasyfikacją końcową. Koszykówka działa jako dyscyplina meczowa, w której wynik musi zostać rozstrzygnięty.",
    items: ["puchar", "rundy", "finał", "dogrywka", "brak remisu"],
    icon: <Target className="h-5 w-5" />,
  },
  {
    name: "Gminny wielobój sprawnościowy",
    group: "Gminy, szkoły i wydarzenia rekreacyjne",
    discipline: "Dyscyplina niestandardowa",
    format: "Wiele konkurencji",
    model: "Wszyscy razem",
    desc:
      "Wydarzenie może składać się z kilku konkurencji, na przykład próby szybkościowej, siłowej i technicznej. Ranking końcowy powstaje z punktów za miejsca, sumy miejsc albo sumy wyników.",
    items: ["wiele konkurencji", "punkty za miejsca", "suma miejsc", "suma wyników", "ranking"],
    icon: <Layers3 className="h-5 w-5" />,
  },
  {
    name: "Amatorski turniej siatkówki",
    group: "Kluby, firmy i grupy rekreacyjne",
    discipline: "Siatkówka",
    format: "Grupy + puchar",
    model: "Pojedynki drużynowe",
    desc:
      "Zespoły mogą zostać podzielone na grupy, a następnie przejść do fazy finałowej. System porządkuje listę drużyn, mecze, wyniki i końcową klasyfikację.",
    items: ["zespoły", "grupy", "faza finałowa", "pojedynki", "klasyfikacja"],
    icon: <Brackets className="h-5 w-5" />,
  },
  {
    name: "Miejskie mistrzostwa w tenisie",
    group: "Ośrodki sportowe i turnieje open",
    discipline: "Tenis",
    format: "Puchar",
    model: "Pojedynki indywidualne",
    desc:
      "Zawodnicy rywalizują w pojedynkach indywidualnych. Organizator może prowadzić drabinkę, określić format meczu i udostępnić publiczny przebieg turnieju.",
    items: ["pojedynki", "best of 3", "best of 5", "drabinka", "wyniki"],
    icon: <Repeat className="h-5 w-5" />,
  },
  {
    name: "Wojewódzkie zawody zapaśnicze",
    group: "Kluby sportowe i związki wojewódzkie",
    discipline: "Zapasy",
    format: "Dwie grupy albo repasaże",
    model: "Pojedynki indywidualne",
    desc:
      "Zawody można podzielić na kategorie wagowe lub wiekowe. W konfiguracji dostępny jest styl wolny, styl klasyczny oraz tryby takie jak nordic, dwie grupy i eliminacje z repasażami.",
    items: ["styl wolny", "klasyczny", "nordic", "dwie grupy", "repasaże"],
    icon: <Dumbbell className="h-5 w-5" />,
  },
];

function TournamentExampleRailCard({
  example,
  index,
  total,
}: {
  example: TournamentExample;
  index: number;
  total: number;
}) {
  return (
    <Card className="h-[18rem] overflow-hidden bg-white/[0.04] p-5 sm:p-6 lg:p-7">
      <div className="flex h-full min-w-0 flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.06] text-white/90">
              {example.icon}
            </div>

            <div className="min-w-0">
              <div className="text-xs text-slate-400 break-words">{example.group}</div>
              <h3 className="mt-1 text-lg font-semibold text-white break-words sm:text-xl">{example.name}</h3>
            </div>
          </div>

          <div className="shrink-0 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] font-medium text-slate-300">
            {index}/{total}
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div>
            <div className="text-[11px] text-slate-400">Dyscyplina</div>
            <div className="mt-1 text-xs font-semibold text-white break-words sm:text-sm">{example.discipline}</div>
          </div>
          <div>
            <div className="text-[11px] text-slate-400">Format</div>
            <div className="mt-1 text-xs font-semibold text-white break-words sm:text-sm">{example.format}</div>
          </div>
          <div>
            <div className="text-[11px] text-slate-400">Model</div>
            <div className="mt-1 text-xs font-semibold text-white break-words sm:text-sm">{example.model}</div>
          </div>
        </div>

        <p className="mt-4 text-xs leading-relaxed text-slate-300 sm:text-sm">{example.desc}</p>

        <div className="mt-auto flex flex-wrap gap-2 pt-3">
          {example.items.slice(0, 5).map((item) => (
            <Pill key={item}>{item}</Pill>
          ))}
        </div>
      </div>
    </Card>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const [activeExampleIndex, setActiveExampleIndex] = useState(0);
  const [isExampleRailPaused, setIsExampleRailPaused] = useState(false);
  const [isExampleRailTransitionEnabled, setIsExampleRailTransitionEnabled] = useState(true);
  const exampleRail = [...tournamentExamples, ...tournamentExamples.slice(0, 2)];
  const normalizedExampleIndex = activeExampleIndex % tournamentExamples.length;

  useEffect(() => {
    if (isExampleRailPaused) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setIsExampleRailTransitionEnabled(true);
      setActiveExampleIndex((currentIndex) => currentIndex + 1);
    }, 5200);

    return () => window.clearInterval(intervalId);
  }, [isExampleRailPaused]);

  useEffect(() => {
    if (activeExampleIndex !== tournamentExamples.length) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setIsExampleRailTransitionEnabled(false);
      setActiveExampleIndex(0);
    }, 720);

    return () => window.clearTimeout(timeoutId);
  }, [activeExampleIndex]);

  useEffect(() => {
    if (isExampleRailTransitionEnabled) {
      return undefined;
    }

    const frameId = window.requestAnimationFrame(() => {
      setIsExampleRailTransitionEnabled(true);
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [isExampleRailTransitionEnabled]);

  const showSelectedExample = (index: number) => {
    setIsExampleRailTransitionEnabled(true);
    setActiveExampleIndex(index);
  };

  const disciplines = [
    {
      title: "Piłka nożna",
      desc:
        "Gotowy wariant dla turniejów meczowych z tabelą, terminarzem, fazą grupową albo pucharem.",
      items: ["mecze", "tabela", "grupy", "puchar", "klasyfikacja"],
      icon: <Trophy className="h-5 w-5" />,
    },
    {
      title: "Piłka ręczna",
      desc:
        "Konfiguracja z punktacją tabeli oraz sposobem rozstrzygania meczów w zależności od zasad zawodów.",
      items: ["remis", "karne", "dogrywka", "3-2-1-0", "2-1-0"],
      icon: <ShieldCheck className="h-5 w-5" />,
    },
    {
      title: "Koszykówka",
      desc:
        "Model oparty na spotkaniach, w których remis po czasie podstawowym jest rozstrzygany dogrywką.",
      items: ["mecze", "dogrywka", "bez remisu", "tabela", "puchar"],
      icon: <Target className="h-5 w-5" />,
    },
    {
      title: "Siatkówka",
      desc:
        "Dyscyplina turniejowa dla rozgrywek zespołowych prowadzonych w lidze, pucharze albo grupach.",
      items: ["zespoły", "pojedynki", "grupy", "tabela", "finały"],
      icon: <Brackets className="h-5 w-5" />,
    },
    {
      title: "Tenis",
      desc:
        "Konfiguracja dla pojedynków indywidualnych z wyborem formatu meczu i systemu klasyfikacji.",
      items: ["pojedynki", "best of 3", "best of 5", "PLT", "bez punktów"],
      icon: <Repeat className="h-5 w-5" />,
    },
    {
      title: "Zapasy",
      desc:
        "Dyscyplina indywidualna w modelu pojedynków, z wyborem stylu i trybu prowadzenia zawodów.",
      items: ["styl wolny", "klasyczny", "nordic", "dwie grupy", "repasaże"],
      icon: <Dumbbell className="h-5 w-5" />,
    },
  ];

  const divisions = [
    {
      title: "Kategorie wagowe",
      desc:
        "Przydatne w zapasach i sportach walki, gdzie uczestnicy muszą być rozdzieleni według masy ciała.",
      icon: <Scale className="h-5 w-5" />,
    },
    {
      title: "Kategorie wiekowe",
      desc:
        "Pozwalają prowadzić osobne rozgrywki dla juniorów, seniorów albo innych grup wiekowych.",
      icon: <Users className="h-5 w-5" />,
    },
    {
      title: "Poziomy zaawansowania",
      desc:
        "Ułatwiają rozdzielenie uczestników amatorskich, zaawansowanych i profesjonalnych.",
      icon: <Gauge className="h-5 w-5" />,
    },
    {
      title: "Osobne klasyfikacje",
      desc:
        "Każda dywizja może mieć własnych uczestników, ustawienia, wyniki i ranking końcowy.",
      icon: <ListChecks className="h-5 w-5" />,
    },
  ];

  const formats = [
    {
      title: "Liga",
      desc:
        "Rozgrywki każdy z każdym z tabelą wyników. W zależności od konfiguracji można prowadzić jeden mecz albo rewanż.",
      items: ["tabela", "punkty", "każdy z każdym", "rewanż"],
      icon: <ListChecks className="h-5 w-5" />,
    },
    {
      title: "Puchar",
      desc:
        "Rywalizacja rundami, w której przegrany odpada z walki o zwycięstwo, a organizator może przewidzieć mecz o 3. miejsce.",
      items: ["rundy", "finał", "3. miejsce", "dwumecz"],
      icon: <Brackets className="h-5 w-5" />,
    },
    {
      title: "Grupy + puchar",
      desc:
        "Najpierw faza grupowa, później dalszy etap dla najlepszych uczestników z każdej grupy.",
      items: ["grupy", "awans", "faza finałowa", "klasyfikacja"],
      icon: <Layers3 className="h-5 w-5" />,
    },
  ];

  const competitionModels = [
    {
      title: "Pojedynki",
      desc:
        "Model dla meczów i starć bezpośrednich: uczestnik kontra uczestnik albo drużyna kontra drużyna.",
      items: ["mecz", "remis", "dogrywka", "rzuty", "serie"],
      icon: <Brackets className="h-5 w-5" />,
    },
    {
      title: "Wszyscy razem",
      desc:
        "Model dla konkurencji bez par meczowych. Uczestnicy otrzymują wyniki, a system tworzy klasyfikację.",
      items: ["czas", "punkty", "liczba", "miejsce", "ranking"],
      icon: <Timer className="h-5 w-5" />,
    },
  ];

  const scoring = [
    {
      title: "Punkty za rozstrzygnięcia",
      desc:
        "Ustal punkty za zwycięstwo, remis, porażkę oraz rozstrzygnięcia po dogrywce albo rzutach decydujących.",
      icon: <Hash className="h-5 w-5" />,
    },
    {
      title: "Serie i rewanże",
      desc:
        "Dla własnych pojedynków można odwzorować jeden mecz, dwumecz albo serię do określonej liczby zwycięstw.",
      icon: <Repeat className="h-5 w-5" />,
    },
    {
      title: "Zasady remisów",
      desc:
        "Konfiguracja może dopuścić remis albo wymagać rozstrzygnięcia przez dogrywkę, rzuty decydujące lub oba mechanizmy.",
      icon: <Flag className="h-5 w-5" />,
    },
  ];

  const resultTypes = [
    {
      title: "Czas",
      desc: "Dla konkurencji, w których wynik jest zapisywany jako czas i porównywany według ustalonego kierunku.",
      icon: <Timer className="h-5 w-5" />,
    },
    {
      title: "Liczba",
      desc: "Dla wyników liczbowych, takich jak metry, kilogramy, powtórzenia albo własna wartość organizatora.",
      icon: <Hash className="h-5 w-5" />,
    },
    {
      title: "Punkty",
      desc: "Dla klasyfikacji, w której uczestnik otrzymuje wartość punktową w etapie albo konkurencji.",
      icon: <Target className="h-5 w-5" />,
    },
    {
      title: "Miejsce",
      desc: "Dla rankingów, w których podstawą klasyfikacji jest pozycja uczestnika w próbie, rundzie albo etapie.",
      icon: <Medal className="h-5 w-5" />,
    },
  ];

  const stages = [
    {
      title: "Etapy redukcyjne",
      desc:
        "Utwórz kwalifikacje, półfinały i finał. Dla każdego etapu określ liczbę uczestników, grup, rund oraz awansujących dalej.",
      items: ["kwalifikacje", "półfinał", "finał", "awans", "rundy"],
      icon: <GitBranch className="h-5 w-5" />,
    },
    {
      title: "Wiele konkurencji",
      desc:
        "Prowadź kilka konkurencji w jednym wydarzeniu. Każda może mieć własny wynik, a ranking końcowy powstaje z ustalonej agregacji.",
      items: ["konkurencje", "suma miejsc", "suma wyników", "punkty za miejsca"],
      icon: <Layers3 className="h-5 w-5" />,
    },
    {
      title: "Rundy i próby",
      desc:
        "Określ liczbę rund lub prób oraz sposób liczenia rezultatu: suma, średnia, najlepszy wynik albo ostatnia runda.",
      items: ["suma", "średnia", "najlepszy", "ostatnia runda"],
      icon: <Repeat className="h-5 w-5" />,
    },
  ];

  const steps = [
    {
      n: "01",
      title: "Wybierasz dyscyplinę",
      desc: "Korzystasz z gotowego presetu albo przechodzisz do konfiguracji niestandardowej.",
      icon: <Trophy className="h-5 w-5" />,
    },
    {
      n: "02",
      title: "Ustawiasz dywizje",
      desc: "Dzielisz turniej na kategorie wagowe, wiekowe, poziomowe albo organizacyjne.",
      icon: <Layers3 className="h-5 w-5" />,
    },
    {
      n: "03",
      title: "Dobierasz format",
      desc: "Wybierasz ligę, puchar, grupy z fazą finałową albo własny model rywalizacji.",
      icon: <Brackets className="h-5 w-5" />,
    },
    {
      n: "04",
      title: "Prowadzisz wyniki",
      desc: "Wpisujesz rezultaty meczowe, czasowe, liczbowe, punktowe albo miejsca.",
      icon: <ListChecks className="h-5 w-5" />,
    },
    {
      n: "05",
      title: "Publikujesz podgląd",
      desc: "Uczestnicy i widzowie mogą sprawdzać harmonogram, wyniki oraz klasyfikację publicznie.",
      icon: <QrCode className="h-5 w-5" />,
    },
  ];

  return (
    <div
      className={cn(
        "mx-auto pb-12",
        "max-w-7xl",
        "2xl:max-w-[96rem]",
        "[min-width:1920px]:max-w-[110rem]",
        "[min-width:2560px]:max-w-[128rem]"
      )}
    >
      <section className="grid gap-10 xl:grid-cols-[1.08fr_0.92fr] xl:items-stretch">
        <div className="flex min-w-0 flex-col">
          <Reveal>
            <div className="inline-flex w-fit rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-xs font-medium text-slate-200">
              Elastyczna organizacja rywalizacji
            </div>
          </Reveal>

          <Reveal delay={0.04}>
            <h1 className="mt-5 text-4xl font-semibold tracking-tight text-white sm:text-5xl xl:text-6xl">
              Od klasycznych turniejów po własne formaty - zorganizuj całe wydarzenie w jednym systemie.
            </h1>
          </Reveal>

          <Reveal delay={0.08}>
            <p className="mt-5 max-w-3xl text-base leading-relaxed text-slate-300 sm:text-lg">
              Korzystaj z gotowych ustawień dyscyplin, buduj dywizje, wybieraj ligę, puchar albo fazę grupową i
              konfiguruj własne modele rywalizacji. Zarządzaj uczestnikami, wynikami, harmonogramem, klasyfikacją i
              publicznym podglądem bez chaosu w arkuszach.
            </p>
          </Reveal>

          <Reveal delay={0.12}>
            <div className="mt-7 grid gap-3 sm:flex sm:flex-wrap sm:items-center">
              <Button
                type="button"
                className="w-full sm:w-auto"
                variant="primary"
                rightIcon={<ArrowRight className="h-4 w-4" />}
                onClick={() => navigate("/login?mode=register")}
              >
                Utwórz konto
              </Button>

              <Button
                type="button"
                className="w-full sm:w-auto"
                variant="secondary"
                rightIcon={<Search className="h-4 w-4" />}
                onClick={() => navigate("/find-tournament")}
              >
                Znajdź turniej
              </Button>

              <Link
                to="/login"
                className="w-full text-sm text-slate-300 underline underline-offset-4 transition hover:text-white sm:w-auto"
              >
                Mam konto - logowanie
              </Link>
            </div>
          </Reveal>

          <Reveal delay={0.16}>
            <div className="mt-6 flex flex-wrap gap-2">
              <Pill>Dyscypliny z presetami</Pill>
              <Pill>Dywizje i kategorie</Pill>
              <Pill>Liga / puchar / grupy</Pill>
              <Pill>Pojedynki</Pill>
              <Pill>Wszyscy razem</Pill>
              <Pill>Własne wyniki</Pill>
              <Pill>Etapy i konkurencje</Pill>
            </div>
          </Reveal>

          <Reveal delay={0.2} className="mt-8">
            <div className="grid gap-3 md:grid-cols-3">
              <MicroStat
                icon={<Trophy className="h-4 w-4 text-white/90" />}
                title="Gotowe dyscypliny"
                desc="Piłka nożna, ręczna, koszykówka, siatkówka, tenis, zapasy i tryb własny."
              />
              <MicroStat
                icon={<Layers3 className="h-4 w-4 text-white/90" />}
                title="Dywizje i etapy"
                desc="Kategorie, formaty, awanse, rundy, próby i osobne klasyfikacje."
              />
              <MicroStat
                icon={<QrCode className="h-4 w-4 text-white/90" />}
                title="Publikacja wyników"
                desc="Panel organizatora oraz publiczny podgląd dla uczestników i widzów."
              />
            </div>
          </Reveal>
        </div>

        <Reveal className="h-full min-w-0">
          <HoverLift className="h-full" scale={1.008}>
            <Card className="relative h-full overflow-hidden p-6 sm:p-7">
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute left-1/2 top-0 h-48 w-[26rem] -translate-x-1/2 rounded-full bg-indigo-500/15 blur-3xl" />
                <div className="absolute bottom-0 left-1/2 h-48 w-[26rem] -translate-x-1/2 rounded-full bg-sky-500/10 blur-3xl" />
              </div>

              <div className="relative flex h-full min-w-0 flex-col">
                <div className="flex items-start justify-between gap-4">
                  <h2 className="text-2xl font-semibold tracking-tight text-white break-words sm:text-3xl">
                    Przykładowe turnieje
                  </h2>

                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-slate-200 transition hover:border-white/20 hover:bg-white/[0.08] hover:text-white focus:outline-none focus:ring-2 focus:ring-white/20"
                      onClick={() => setIsExampleRailPaused((currentValue) => !currentValue)}
                      aria-label={isExampleRailPaused ? "Wznów automatyczne przewijanie" : "Zatrzymaj automatyczne przewijanie"}
                    >
                      {isExampleRailPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                    </button>

                    <div className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-xs font-medium text-slate-300">
                      {normalizedExampleIndex + 1}/{tournamentExamples.length}
                    </div>
                  </div>
                </div>

                <div className="mt-5 grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_1.25rem]">
                  <div className="relative h-[38.5rem] overflow-hidden rounded-[1.75rem] border border-white/10 bg-black/10 p-3">
                    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-10 bg-gradient-to-b from-slate-950/80 to-transparent" />
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-10 bg-gradient-to-t from-slate-950/80 to-transparent" />

                    <div
                      className="space-y-3"
                      style={{
                        transform: `translateY(-${activeExampleIndex * 18.75}rem)`,
                        transition: isExampleRailTransitionEnabled
                          ? "transform 720ms cubic-bezier(0.22, 1, 0.36, 1)"
                          : "none",
                      }}
                    >
                      {exampleRail.map((example, index) => (
                        <TournamentExampleRailCard
                          key={`${example.name}-${index}`}
                          example={example}
                          index={(index % tournamentExamples.length) + 1}
                          total={tournamentExamples.length}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-center sm:w-5">
                    <div className="flex flex-wrap justify-center gap-2 sm:flex-col sm:items-center">
                      {tournamentExamples.map((example, index) => (
                        <button
                          key={example.name}
                          type="button"
                          className={cn(
                            "h-2.5 rounded-full transition focus:outline-none focus:ring-2 focus:ring-white/20 sm:w-2.5",
                            index === normalizedExampleIndex ? "w-8 bg-white sm:h-8" : "w-2.5 bg-white/30 hover:bg-white/50"
                          )}
                          onClick={() => showSelectedExample(index)}
                          aria-label={`Pokaż przykład: ${example.name}`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </HoverLift>
        </Reveal>
      </section>

      <section className="mt-16">
        <Reveal>
          <SectionHeader
            eyebrow="Dyscypliny"
            title="Obsługiwane dyscypliny z gotowymi ustawieniami"
            desc="Strona główna najpierw pokazuje konkret: system ma zdefiniowane dyscypliny, które prowadzą organizatora przez właściwe ustawienia wyników, tabeli i rozstrzygnięć."
          />
        </Reveal>

        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {disciplines.map((discipline, index) => (
            <Reveal key={discipline.title} delay={0.05 + index * 0.04} className="h-full">
              <CapabilityCard
                icon={discipline.icon}
                title={discipline.title}
                desc={discipline.desc}
                items={discipline.items}
              />
            </Reveal>
          ))}
        </div>
      </section>

      <section className="mt-16">
        <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr] xl:items-stretch">
          <Reveal className="h-full">
            <Card className="relative h-full overflow-hidden p-6 sm:p-7">
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute -left-16 top-10 h-40 w-40 rounded-full bg-indigo-500/10 blur-3xl" />
              </div>

              <div className="relative">
                <SectionHeader
                  eyebrow="Dywizje"
                  title="Kategorie wagowe, wiekowe i poziomowe w jednym turnieju"
                  desc="Dywizje porządkują większe wydarzenia. Każda dywizja może mieć własnych uczestników, konfigurację, harmonogram, wyniki i klasyfikację."
                />

                <div className="mt-6 flex flex-wrap gap-2">
                  <Pill>kategorie wagowe</Pill>
                  <Pill>kategorie wiekowe</Pill>
                  <Pill>amatorzy / zaawansowani</Pill>
                  <Pill>kobiety / mężczyźni</Pill>
                  <Pill>drużynowe / indywidualne</Pill>
                  <Pill>kopiowanie ustawień</Pill>
                </div>

                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  <Card className="bg-white/[0.04] p-4">
                    <div className="text-sm font-semibold text-white">Osobna konfiguracja</div>
                    <div className="mt-2 text-sm leading-relaxed text-slate-300">
                      W jednej dywizji można prowadzić ligę, a w innej puchar albo własny model rywalizacji.
                    </div>
                  </Card>

                  <Card className="bg-white/[0.04] p-4">
                    <div className="text-sm font-semibold text-white">Osobna klasyfikacja</div>
                    <div className="mt-2 text-sm leading-relaxed text-slate-300">
                      Wyniki różnych kategorii nie mieszają się, więc ranking pozostaje czytelny dla uczestników.
                    </div>
                  </Card>
                </div>
              </div>
            </Card>
          </Reveal>

          <div className="grid gap-3 sm:grid-cols-2">
            {divisions.map((item, index) => (
              <Reveal key={item.title} delay={0.05 + index * 0.05} className="h-full">
                <FeatureCard icon={item.icon} title={item.title} desc={item.desc} />
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-16">
        <Reveal>
          <SectionHeader
            eyebrow="Formaty"
            title="Liga, puchar albo grupy z fazą finałową"
            desc="Po wyborze dyscypliny organizator dobiera strukturę rozgrywek do liczby uczestników i sposobu wyłaniania zwycięzcy."
          />
        </Reveal>

        <div className="mt-6 grid gap-3 lg:grid-cols-3">
          {formats.map((format, index) => (
            <Reveal key={format.title} delay={0.05 + index * 0.05} className="h-full">
              <CapabilityCard icon={format.icon} title={format.title} desc={format.desc} items={format.items} />
            </Reveal>
          ))}
        </div>
      </section>

      <section className="mt-16">
        <Reveal>
          <Card className="relative overflow-hidden p-6 sm:p-7">
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute left-1/2 top-0 h-40 w-[24rem] -translate-x-1/2 rounded-full bg-indigo-500/10 blur-3xl" />
            </div>

            <div className="relative grid gap-6 xl:grid-cols-[0.85fr_1.15fr] xl:items-start">
              <SectionHeader
                eyebrow="Tryb niestandardowy"
                title="Własna dyscyplina i własny model rywalizacji"
                desc="Jeżeli gotowa dyscyplina nie wystarcza, organizator może zdefiniować własny typ zawodów, określić uczestników, model rywalizacji, typ wyniku, jednostkę oraz sposób liczenia klasyfikacji."
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <FeatureCard
                  icon={<Users className="h-5 w-5" />}
                  title="Uczestnicy"
                  desc="Tryb indywidualny albo drużynowy, zależnie od charakteru rywalizacji."
                />
                <FeatureCard
                  icon={<Zap className="h-5 w-5" />}
                  title="Model rywalizacji"
                  desc="Pojedynki bezpośrednie albo klasyfikacja wszystkich uczestników na podstawie wyników."
                />
                <FeatureCard
                  icon={<Hash className="h-5 w-5" />}
                  title="Własne jednostki"
                  desc="Sekundy, minuty, metry, kilogramy, powtórzenia, miejsca albo własna etykieta wyniku."
                />
                <FeatureCard
                  icon={<ListChecks className="h-5 w-5" />}
                  title="Agregacja"
                  desc="Suma, średnia, najlepszy wynik albo ostatnia runda jako wynik końcowy."
                />
              </div>
            </div>
          </Card>
        </Reveal>
      </section>

      <section className="mt-16">
        <Reveal>
          <SectionHeader
            eyebrow="Modele rywalizacji"
            title="Pojedynki albo wszyscy razem"
            desc="System rozróżnia klasyczne starcia bezpośrednie oraz konkurencje, w których każdy uczestnik jest oceniany przez wynik, czas, punkty albo miejsce."
          />
        </Reveal>

        <div className="mt-6 grid gap-3 lg:grid-cols-2">
          {competitionModels.map((model, index) => (
            <Reveal key={model.title} delay={0.05 + index * 0.05} className="h-full">
              <CapabilityCard icon={model.icon} title={model.title} desc={model.desc} items={model.items} />
            </Reveal>
          ))}
        </div>
      </section>

      <section className="mt-16">
        <Reveal>
          <SectionHeader
            eyebrow="Punktacja"
            title="Własny system punktowy dla tabeli i rozstrzygnięć"
            desc="W niestandardowych pojedynkach można odwzorować punktację za różne typy wyniku, a także serie meczów i zasady rozstrzygania remisów."
          />
        </Reveal>

        <div className="mt-6 grid gap-3 lg:grid-cols-3">
          {scoring.map((item, index) => (
            <Reveal key={item.title} delay={0.05 + index * 0.05} className="h-full">
              <FeatureCard icon={item.icon} title={item.title} desc={item.desc} />
            </Reveal>
          ))}
        </div>
      </section>

      <section className="mt-16">
        <Reveal>
          <SectionHeader
            eyebrow="Wyniki"
            title="Własny system wyników dla konkurencji mierzalnych"
            desc="Wynik nie musi być wyłącznie rezultatem meczu. System pozwala zapisać czas, liczbę, punkty, miejsce albo własną jednostkę i określić, czy lepszy jest wynik większy czy mniejszy."
          />
        </Reveal>

        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {resultTypes.map((item, index) => (
            <Reveal key={item.title} delay={0.05 + index * 0.04} className="h-full">
              <FeatureCard icon={item.icon} title={item.title} desc={item.desc} />
            </Reveal>
          ))}
        </div>
      </section>

      <section className="mt-16">
        <Reveal>
          <SectionHeader
            eyebrow="Etapy"
            title="Etapy redukcyjne albo wiele konkurencji"
            desc="W trybie niestandardowym rywalizację można podzielić na kwalifikacje, półfinały i finał albo potraktować etapy jako osobne konkurencje wpływające na ranking końcowy."
          />
        </Reveal>

        <div className="mt-6 grid gap-3 lg:grid-cols-3">
          {stages.map((stage, index) => (
            <Reveal key={stage.title} delay={0.05 + index * 0.05} className="h-full">
              <CapabilityCard icon={stage.icon} title={stage.title} desc={stage.desc} items={stage.items} />
            </Reveal>
          ))}
        </div>
      </section>

      <section className="mt-16">
        <Reveal>
          <SectionHeader
            eyebrow="Proces"
            title="Od konfiguracji do publicznego podglądu"
            desc="Strona główna powinna pokazywać, że system prowadzi organizatora przez cały proces: od wyboru dyscypliny i dywizji po wyniki oraz publikację turnieju."
          />
        </Reveal>

        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {steps.map((step, index) => (
            <Reveal key={step.title} delay={0.05 + index * 0.05} className="h-full">
              <StepCard n={step.n} title={step.title} desc={step.desc} icon={step.icon} />
            </Reveal>
          ))}
        </div>
      </section>

      <section className="mt-16">
        <Reveal>
          <Card className="relative overflow-hidden p-6 sm:p-8">
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute left-1/2 top-0 h-40 w-[24rem] -translate-x-1/2 rounded-full bg-indigo-500/15 blur-3xl" />
              <div className="absolute bottom-0 left-1/2 h-40 w-[24rem] -translate-x-1/2 rounded-full bg-sky-500/10 blur-3xl" />
            </div>

            <div className="relative">
              <div className="text-sm font-medium text-slate-300">Gotowe na prosty turniej i rozbudowane zawody</div>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                Skonfiguruj dyscyplinę, dywizje, format, wyniki i publiczny podgląd w jednym miejscu.
              </h2>
              <p className="mt-4 max-w-3xl text-sm leading-relaxed text-slate-300 sm:text-base">
                Turnieje.pro porządkuje pracę organizatora: od ustawień dyscypliny i kategorii, przez harmonogram i
                wyniki, aż po klasyfikację widoczną dla uczestników oraz widzów.
              </p>

              <div className="mt-6 grid gap-3 sm:flex sm:flex-wrap sm:items-center">
                <Button
                  type="button"
                  className="w-full sm:w-auto"
                  variant="primary"
                  rightIcon={<ArrowRight className="h-4 w-4" />}
                  onClick={() => navigate("/login?mode=register")}
                >
                  Zacznij od konta
                </Button>

                <Button
                  type="button"
                  className="w-full sm:w-auto"
                  variant="secondary"
                  rightIcon={<Search className="h-4 w-4" />}
                  onClick={() => navigate("/find-tournament")}
                >
                  Otwórz publiczny podgląd
                </Button>

                <Button
                  type="button"
                  className="w-full sm:w-auto"
                  variant="secondary"
                  rightIcon={<ArrowRight className="h-4 w-4" />}
                  onClick={() => navigate("/tournaments/new")}
                >
                  Utwórz turniej
                </Button>
              </div>
            </div>
          </Card>
        </Reveal>
      </section>
    </div>
  );
}
