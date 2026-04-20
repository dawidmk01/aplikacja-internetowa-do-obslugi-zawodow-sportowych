// frontend/src/pages/Home.tsx
// Plik prezentuje główną stronę marketingową systemu i komunikuje elastyczność formatów rywalizacji.

import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Brackets,
  Building2,
  Dumbbell,
  Gamepad2,
  GraduationCap,
  Hash,
  Layers3,
  ListChecks,
  Medal,
  QrCode,
  Ruler,
  Search,
  ShieldCheck,
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

type ModeCardProps = {
  icon: ReactNode;
  title: string;
  desc: string;
  bullets: string[];
};

function ModeCard({ icon, title, desc, bullets }: ModeCardProps) {
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

          <div className="mt-4 space-y-2">
            {bullets.map((bullet) => (
              <div key={bullet} className="flex items-start gap-2 text-sm text-slate-200">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-white/70" />
                <span className="break-words">{bullet}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </HoverLift>
  );
}

type ExampleCardProps = {
  icon: ReactNode;
  title: string;
  desc: string;
};

function ExampleCard({ icon, title, desc }: ExampleCardProps) {
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

type ResultCardProps = {
  icon: ReactNode;
  title: string;
  desc: string;
};

function ResultCard({ icon, title, desc }: ResultCardProps) {
  return (
    <Card className="h-full bg-white/[0.04] p-4">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.06] text-white/90">
          {icon}
        </div>
        <div className="text-sm font-semibold text-white">{title}</div>
      </div>
      <div className="mt-3 text-sm leading-relaxed text-slate-300">{desc}</div>
    </Card>
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

export default function Home() {
  const navigate = useNavigate();

  const modes = [
    {
      title: "Klasyczny turniej",
      desc:
        "Dla rozgrywek opartych na meczach lub pojedynkach. Sprawdza się w lidze, pucharze, grupach i układach mieszanych.",
      bullets: [
        "mecze, terminarz, tabela i drabinka",
        "piłka nożna, siatkówka, tenis, esport",
        "czytelny przebieg dla organizatora i uczestników",
      ],
      icon: <Brackets className="h-5 w-5" />,
    },
    {
      title: "Wszyscy razem",
      desc:
        "Dla konkurencji, w których liczy się rezultat uczestnika, a nie bezpośredni mecz 1 na 1. System buduje klasyfikację po wynikach.",
      bullets: [
        "bieg na 400 m, eliminacje czasowe, konkursy sprawnościowe",
        "wynik liczbowy, czas, miejsce albo najlepsza próba",
        "awans najlepszych do kolejnych etapów",
      ],
      icon: <Timer className="h-5 w-5" />,
    },
    {
      title: "Tryb niestandardowy",
      desc:
        "Dla wydarzeń z własną logiką punktacji i klasyfikacji. To rozwiązanie dla formatów, które nie mieszczą się w prostym schemacie turnieju.",
      bullets: [
        "trójbój, wielobój, szkolne zawody i eventy firmowe",
        "suma kilku konkurencji albo własny ranking",
        "większa swoboda budowy przebiegu wydarzenia",
      ],
      icon: <Zap className="h-5 w-5" />,
    },
  ];

  const useCases = [
    {
      title: "Turniej piłkarski lub siatkarski",
      desc:
        "Grupy, puchar, terminarz, wyniki i klasyfikacja w jednym panelu. Klasyczny scenariusz dla lokalnych lig i turniejów amatorskich.",
      icon: <Trophy className="h-5 w-5" />,
    },
    {
      title: "Amatorski turniej esportowy",
      desc:
        "Rozgrywki solo, duo albo drużynowe. Dywizje mogą rozdzielać poziom, platformę, tryb gry albo całą osobną konkurencję.",
      icon: <Gamepad2 className="h-5 w-5" />,
    },
    {
      title: "Bieg na 400 m lub zawody na czas",
      desc:
        "Uczestnicy startują wspólnie albo w seriach, a system układa klasyfikację na podstawie rezultatów i wskazuje awansujących.",
      icon: <Timer className="h-5 w-5" />,
    },
    {
      title: "Skok w dal lub konkurs techniczny",
      desc:
        "Rywalizacja bez meczów. Liczy się najlepsza próba, wynik końcowy albo miejsce, a klasyfikacja przelicza się automatycznie.",
      icon: <Ruler className="h-5 w-5" />,
    },
    {
      title: "Trójbój i zawody siłowe",
      desc:
        "Kilka konkurencji, wiele kategorii i osobne dywizje. Wynik końcowy może wynikać z sumy prób albo przyjętej logiki rankingu.",
      icon: <Dumbbell className="h-5 w-5" />,
    },
    {
      title: "Szkolne i firmowe wydarzenia",
      desc:
        "Jedno wydarzenie może obsłużyć wiele konkurencji, klas, działów lub poziomów zaawansowania bez tworzenia osobnych systemów.",
      icon: <Building2 className="h-5 w-5" />,
    },
  ];

  const resultTypes = [
    {
      title: "Wynik meczowy",
      desc: "Dla klasycznych spotkań 1 na 1 lub drużyna na drużynę, gdy liczą się gole, sety albo punkty meczowe.",
      icon: <Brackets className="h-5 w-5" />,
    },
    {
      title: "Punkty lub wartość liczbowa",
      desc: "Dla konkurencji ocenianych punktowo lub na podstawie wyniku liczbowego.",
      icon: <Hash className="h-5 w-5" />,
    },
    {
      title: "Czas",
      desc: "Dla biegów, przejazdów, testów szybkościowych i wszystkich scenariuszy, w których liczy się rezultat czasowy.",
      icon: <Timer className="h-5 w-5" />,
    },
    {
      title: "Miejsce",
      desc: "Dla klasyfikacji porządkowej, gdy uczestnik otrzymuje pozycję w danej próbie lub etapie.",
      icon: <Medal className="h-5 w-5" />,
    },
    {
      title: "Najlepsza próba",
      desc: "Dla skoku w dal, rzutu, prób technicznych i podobnych konkurencji, gdzie ważny jest najlepszy osiągnięty wynik.",
      icon: <Target className="h-5 w-5" />,
    },
    {
      title: "Suma lub ranking niestandardowy",
      desc: "Dla wielobojów, trójboju i formatów autorskich, w których końcowy wynik składa się z kilku rezultatów.",
      icon: <ListChecks className="h-5 w-5" />,
    },
  ];

  const divisionCases = [
    {
      title: "Lekkoatletyka",
      desc: "Dywizje mogą oznaczać 400 m, 800 m, skok w dal albo osobne kategorie wiekowe w ramach jednego wydarzenia.",
      icon: <Timer className="h-5 w-5" />,
    },
    {
      title: "Trójbój i siłowe",
      desc: "Podział według kategorii wagowych, poziomu albo płci pozwala utrzymać porządek i osobne klasyfikacje.",
      icon: <Dumbbell className="h-5 w-5" />,
    },
    {
      title: "Esport",
      desc: "Dywizje mogą rozdzielać tryb solo, duo, team, poziom amatorski albo różne platformy gry.",
      icon: <Gamepad2 className="h-5 w-5" />,
    },
    {
      title: "Szkoła i eventy",
      desc: "Jedno wydarzenie może mieć dywizje dla klas, działów, konkurencji albo poziomów trudności.",
      icon: <GraduationCap className="h-5 w-5" />,
    },
  ];

  const steps = [
    {
      n: "01",
      title: "Tworzysz wydarzenie",
      desc: "Określasz zakres rywalizacji - od prostego turnieju po większe wydarzenie z wieloma konkurencjami.",
      icon: <Trophy className="h-5 w-5" />,
    },
    {
      n: "02",
      title: "Budujesz dywizje i formaty",
      desc: "Dzielisz wydarzenie według kategorii, konkurencji lub poziomu i przypisujesz każdej dywizji właściwy model rywalizacji.",
      icon: <Layers3 className="h-5 w-5" />,
    },
    {
      n: "03",
      title: "Prowadzisz wyniki",
      desc: "Wpisujesz rezultaty meczów albo wyników zbiorczych, a system porządkuje klasyfikację i przebieg wydarzenia.",
      icon: <ListChecks className="h-5 w-5" />,
    },
    {
      n: "04",
      title: "Udostępniasz podgląd",
      desc: "Widzowie i uczestnicy śledzą wydarzenie przez publiczny link lub kod QR, bez ciągłego dopytywania organizatora.",
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
              Prowadź ligi, puchary, rywalizację „wszyscy razem”, konkurencje niestandardowe i wiele dywizji w ramach
              jednego wydarzenia. Zarządzaj uczestnikami, wynikami, harmonogramem, klasyfikacją i publicznym
              podglądem bez chaosu w arkuszach.
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
              <Pill>Liga i puchar</Pill>
              <Pill>Wszyscy razem</Pill>
              <Pill>Tryby niestandardowe</Pill>
              <Pill>Dywizje i kategorie</Pill>
              <Pill>Publiczny link / kod QR</Pill>
            </div>
          </Reveal>

          <Reveal delay={0.2} className="mt-8">
            <div className="grid gap-3 md:grid-cols-3">
              <MicroStat
                icon={<Layers3 className="h-4 w-4 text-white/90" />}
                title="Różne modele rywalizacji"
                desc="Mecze, etapy, klasyfikacje zbiorcze i własne scenariusze w jednym narzędziu."
              />
              <MicroStat
                icon={<Users className="h-4 w-4 text-white/90" />}
                title="Dywizje bez ograniczeń"
                desc="Kategorie wiekowe, wagowe, poziomy, konkurencje i osobne przebiegi w jednym wydarzeniu."
              />
              <MicroStat
                icon={<ShieldCheck className="h-4 w-4 text-white/90" />}
                title="Organizacja i publikacja"
                desc="Panel organizatora, role asystentów i publiczny podgląd dla uczestników oraz widzów."
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
                <div className="flex items-start gap-3">
                  <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.06]">
                    <Trophy className="h-5 w-5 text-white/90" />
                  </div>

                  <div className="min-w-0">
                    <div className="text-sm text-slate-300 break-words">Przykładowe wydarzenie</div>
                    <div className="text-xl font-semibold text-white break-words">Miejski festiwal rywalizacji</div>
                    <div className="mt-2 text-sm leading-relaxed text-slate-300">
                      Jedno wydarzenie może łączyć klasyczny turniej, konkurencję „wszyscy razem” i dywizję opartą na
                      własnej logice klasyfikacji.
                    </div>
                  </div>
                </div>

                <div className="mt-6 grid gap-3">
                  <Card className="bg-white/[0.04] p-4">
                    <div className="flex items-start gap-3">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.06]">
                        <Brackets className="h-4 w-4 text-white/90" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-white break-words">Dywizja: Piłka 5 na 5</div>
                        <div className="mt-1 text-sm leading-relaxed text-slate-300">
                          Klasyczny turniej z grupami, terminarzem, wynikami meczów i tabelą.
                        </div>
                      </div>
                    </div>
                  </Card>

                  <Card className="bg-white/[0.04] p-4">
                    <div className="flex items-start gap-3">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.06]">
                        <Timer className="h-4 w-4 text-white/90" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-white break-words">Dywizja: 400 m Open</div>
                        <div className="mt-1 text-sm leading-relaxed text-slate-300">
                          Tryb „wszyscy razem” z wynikami czasowymi i awansem najlepszych uczestników.
                        </div>
                      </div>
                    </div>
                  </Card>

                  <Card className="bg-white/[0.04] p-4">
                    <div className="flex items-start gap-3">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.06]">
                        <Zap className="h-4 w-4 text-white/90" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-white break-words">Dywizja: Trójbój Amator</div>
                        <div className="mt-1 text-sm leading-relaxed text-slate-300">
                          Własny model klasyfikacji oparty na kilku konkurencjach i wyniku końcowym.
                        </div>
                      </div>
                    </div>
                  </Card>
                </div>

                <div className="mt-6 grid gap-3 sm:grid-cols-3">
                  <Card className="bg-white/[0.04] p-4">
                    <div className="text-xs text-slate-400">Typy wyników</div>
                    <div className="mt-1 text-sm font-semibold text-white">Mecze, czas, próby, ranking</div>
                  </Card>

                  <Card className="bg-white/[0.04] p-4">
                    <div className="text-xs text-slate-400">Publiczny dostęp</div>
                    <div className="mt-1 text-sm font-semibold text-white">Link, kod QR i przejrzysty podgląd</div>
                  </Card>

                  <Card className="bg-white/[0.04] p-4">
                    <div className="text-xs text-slate-400">Praca zespołowa</div>
                    <div className="mt-1 text-sm font-semibold text-white">Organizator i asystenci</div>
                  </Card>
                </div>
              </div>
            </Card>
          </HoverLift>
        </Reveal>
      </section>

      <section className="mt-16">
        <Reveal>
          <SectionHeader
            eyebrow="Modele rywalizacji"
            title="Trzy sposoby pracy - jeden spójny system"
            desc="Strona główna powinna od razu tłumaczyć, że aplikacja nie kończy się na lidze i pucharze. Obsługuje także rywalizację zbiorczą oraz wydarzenia z własnymi zasadami."
          />
        </Reveal>

        <div className="mt-6 grid gap-3 lg:grid-cols-3">
          {modes.map((mode, index) => (
            <Reveal key={mode.title} delay={0.05 + index * 0.05} className="h-full">
              <ModeCard icon={mode.icon} title={mode.title} desc={mode.desc} bullets={mode.bullets} />
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
                  eyebrow="Dywizje i kategorie"
                  title="Jedno wydarzenie, wiele porządków"
                  desc="Dywizje mogą służyć nie tylko do podziału uczestników. Mogą także porządkować całe konkurencje, poziomy albo osobne przebiegi rywalizacji w ramach jednego wydarzenia."
                />

                <div className="mt-6 flex flex-wrap gap-2">
                  <Pill>kategorie wiekowe</Pill>
                  <Pill>poziomy zaawansowania</Pill>
                  <Pill>kategorie wagowe</Pill>
                  <Pill>konkurencje</Pill>
                  <Pill>indywidualne / duety / drużyny</Pill>
                  <Pill>własny podział organizacyjny</Pill>
                </div>

                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  <Card className="bg-white/[0.04] p-4">
                    <div className="text-sm font-semibold text-white">Osobni uczestnicy i klasyfikacje</div>
                    <div className="mt-2 text-sm leading-relaxed text-slate-300">
                      Każda dywizja może mieć własną listę uczestników, niezależne wyniki i odrębny ranking.
                    </div>
                  </Card>

                  <Card className="bg-white/[0.04] p-4">
                    <div className="text-sm font-semibold text-white">Różne formaty w jednym evencie</div>
                    <div className="mt-2 text-sm leading-relaxed text-slate-300">
                      Jedna dywizja może działać meczowo, a druga w trybie „wszyscy razem” lub niestandardowym.
                    </div>
                  </Card>
                </div>
              </div>
            </Card>
          </Reveal>

          <div className="grid gap-3 sm:grid-cols-2">
            {divisionCases.map((item, index) => (
              <Reveal key={item.title} delay={0.05 + index * 0.05} className="h-full">
                <ExampleCard icon={item.icon} title={item.title} desc={item.desc} />
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section id="przyklady" className="mt-16">
        <Reveal>
          <SectionHeader
            eyebrow="Przykłady zastosowań"
            title="To nie tylko turnieje sportowe"
            desc="Nowy Home powinien pokazywać szerokość zastosowań systemu. Dzięki temu użytkownik szybciej zrozumie, że platforma sprawdzi się także przy mniej oczywistych formatach."
          />
        </Reveal>

        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {useCases.map((item, index) => (
            <Reveal key={item.title} delay={0.05 + index * 0.04} className="h-full">
              <ExampleCard icon={item.icon} title={item.title} desc={item.desc} />
            </Reveal>
          ))}
        </div>
      </section>

      <section className="mt-16">
        <Reveal>
          <SectionHeader
            eyebrow="Typy wyników"
            title="Różne wyniki, jedna logika organizacji"
            desc="Na stronie warto mocno podkreślić, że system nie ogranicza się do wyniku meczowego. Obsługuje także czas, miejsce, najlepszą próbę i formaty oparte na własnym rankingu."
          />
        </Reveal>

        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {resultTypes.map((item, index) => (
            <Reveal key={item.title} delay={0.05 + index * 0.04} className="h-full">
              <ResultCard icon={item.icon} title={item.title} desc={item.desc} />
            </Reveal>
          ))}
        </div>
      </section>

      <section className="mt-16">
        <Reveal>
          <SectionHeader
            eyebrow="Proces"
            title="Jak to działa w praktyce"
            desc="Proces powinien być prosty zarówno dla klasycznych turniejów, jak i dla większych wydarzeń z dywizjami, konkurencjami oraz niestandardową klasyfikacją."
          />
        </Reveal>

        <div className="mt-6 grid gap-3 xl:grid-cols-4">
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
              <div className="text-sm font-medium text-slate-300">Gotowe na mały turniej i duże wydarzenie</div>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                Organizuj mecze, konkurencje, dywizje i własne zasady bez zmiany narzędzia w połowie pracy.
              </h2>
              <p className="mt-4 max-w-3xl text-sm leading-relaxed text-slate-300 sm:text-base">
                Jeden system może obsłużyć lokalny puchar, szkolny dzień sportu, turniej znajomych w grę komputerową,
                zawody lekkoatletyczne albo wieloetapowy event z własną logiką klasyfikacji.
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
                  Utwórz wydarzenie
                </Button>
              </div>
            </div>
          </Card>
        </Reveal>
      </section>
    </div>
  );
}