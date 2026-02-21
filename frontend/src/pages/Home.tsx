import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Brackets,
  Goal,
  Hand,
  ListChecks,
  Plus,
  QrCode,
  Search,
  ShieldCheck,
  Timer,
  Trophy,
  UserCheck,
  Users,
  Volleyball,
} from "lucide-react";

import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

type RevealProps = {
  children: ReactNode;
  delay?: number;
  className?: string;
};

// ===== Ujednolicenie animacji wejścia =====

/**
 * Ujednolicenie animacji ogranicza rozbieżności percepcyjne pomiędzy sekcjami,
 * co stabilizuje odbiór hierarchii informacji na stronach o charakterze promocyjnym.
 */
function Reveal({ children, delay = 0, className }: RevealProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14, filter: "blur(2px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, amount: 0.25 }}
      transition={{ duration: 0.35, ease: "easeOut", delay }}
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

// ===== Standaryzacja mikronawigacji wizualnej =====

/**
 * Ujednolicenie reakcji na hover wzmacnia spójność semantyki elementów klikalnych
 * oraz redukuje ryzyko niespójnych implementacji interakcji w różnych sekcjach systemu.
 */
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

type MiniInfoProps = {
  icon: ReactNode;
  label: string;
  title: string;
  desc: string;
};

function MiniInfo({ icon, label, title, desc }: MiniInfoProps) {
  return (
    <HoverLift scale={1.015} className="h-full">
      <div className="h-full min-w-0 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
        <div className="flex h-full min-w-0 items-start gap-3">
          <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.06]">
            {icon}
          </div>
          <div className="min-w-0 flex h-full flex-col">
            <div className="text-xs text-slate-400 break-words">{label}</div>
            <div className="mt-1 text-sm font-semibold text-white break-words">{title}</div>
            <div className="mt-2 min-h-[3.25rem] text-sm text-slate-300 leading-relaxed break-words">{desc}</div>
          </div>
        </div>
      </div>
    </HoverLift>
  );
}

type StepProps = {
  n: string;
  title: string;
  desc: string;
  icon: ReactNode;
};

function Step({ n, title, desc, icon }: StepProps) {
  return (
    <div className="relative min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="absolute -right-12 -top-12 h-28 w-28 rounded-full bg-white/[0.06] blur-2xl" />
      <div className="relative flex min-w-0 items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.06]">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-xs font-semibold text-slate-300/90">{n}</span>
            <span className="text-sm font-semibold text-white break-words">{title}</span>
          </div>
          <div className="mt-1 text-sm text-slate-300 leading-relaxed break-words">{desc}</div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <div
      className={[
        "mx-auto pb-10",
        "max-w-7xl",
        "2xl:max-w-[96rem]",
        "[min-width:1920px]:max-w-[110rem]",
        "[min-width:2560px]:max-w-[128rem]",
      ].join(" ")}
    >
      {/* ===== HERO ===== */}
      <section className="grid gap-10 lg:grid-cols-2 lg:items-stretch">
        <div className="flex h-full min-w-0 flex-col">
          <Reveal>
            <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Prowadź turnieje szybciej, czytelniej i bez chaosu w arkuszach.
            </h1>
          </Reveal>

          <Reveal delay={0.05}>
            <p className="mt-4 text-base text-slate-300 leading-relaxed">
              Tworzenie struktury rozgrywek, harmonogram, wyniki i zestawienia w jednym miejscu. Udostępniaj publiczny
              podgląd przez link lub QR, a pracę dziel z asystentami.
            </p>
          </Reveal>

          <Reveal delay={0.1}>
            <div className="mt-6 grid gap-3 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
              <Link to="/login?mode=register" className="w-full sm:w-auto">
                <Button className="w-full sm:w-auto" variant="primary" rightIcon={<ArrowRight className="h-4 w-4" />}>
                  Utwórz konto
                </Button>
              </Link>

              <Link to="/find-tournament" className="w-full sm:w-auto">
                <Button className="w-full sm:w-auto" variant="secondary" rightIcon={<Search className="h-4 w-4" />}>
                  Znajdź turniej
                </Button>
              </Link>

              <Link
                to="/login"
                className="w-full sm:w-auto text-sm text-slate-300 hover:text-white transition underline underline-offset-4"
              >
                Mam konto - logowanie
              </Link>
            </div>
          </Reveal>

          <Reveal delay={0.15} className="mt-auto">
            <div
              className={[
                "mt-6 grid items-stretch gap-3",
                "grid-cols-1",
                "sm:grid-cols-3",
                "2xl:gap-4",
              ].join(" ")}
            >
              <MiniInfo
                icon={<QrCode className="h-4 w-4 text-white/90" />}
                label="Dostęp"
                title="Link / QR"
                desc="Widzowie i zawodnicy wchodzą w sekundę."
              />
              <MiniInfo
                icon={<ShieldCheck className="h-4 w-4 text-white/90" />}
                label="Role"
                title="Organizator + asystenci"
                desc="Delegowanie zadań z kontrolą uprawnień."
              />
              <MiniInfo
                icon={<Timer className="h-4 w-4 text-white/90" />}
                label="Live"
                title="Zegar i incydenty"
                desc="Opcjonalnie: przebieg meczu w czasie rzeczywistym."
              />
            </div>
          </Reveal>
        </div>

        <Reveal className="h-full min-w-0 lg:justify-self-end">
          <HoverLift scale={1.01} className="h-full">
            <Card className="relative h-full min-w-0 overflow-hidden p-6 sm:p-7">
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute -top-24 left-1/2 h-48 w-[28rem] -translate-x-1/2 rounded-full bg-indigo-500/15 blur-3xl" />
                <div className="absolute -bottom-24 left-1/2 h-48 w-[28rem] -translate-x-1/2 rounded-full bg-sky-500/10 blur-3xl" />
              </div>

              <div className="relative flex h-full min-w-0 flex-col">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.06]">
                    <Trophy className="h-5 w-5 text-white/90" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm text-slate-300 break-words">Przykładowy turniej</div>
                    <div className="text-lg font-semibold text-white break-words">Liga miejska - 8 drużyn</div>
                  </div>
                </div>

                <div
                  className={[
                    "mt-6 grid gap-3",
                    "grid-cols-1",
                    "sm:grid-cols-2",
                    "[min-width:1440px]:grid-cols-2",
                    "[min-width:1920px]:grid-cols-2",
                  ].join(" ")}
                >
                  <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-white">
                      <Brackets className="h-4 w-4 text-white/80" />
                      Struktura i mecze
                    </div>
                    <div className="mt-2 text-sm text-slate-300 leading-relaxed break-words">
                      Generowanie spotkań po konfiguracji formatu.
                    </div>
                  </div>

                  <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-white">
                      <ListChecks className="h-4 w-4 text-white/80" />
                      Zestawienia
                    </div>
                    <div className="mt-2 text-sm text-slate-300 leading-relaxed break-words">
                      Tabela / grupy / drabinka aktualizowane po wynikach.
                    </div>
                  </div>

                  <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-white">
                      <Users className="h-4 w-4 text-white/80" />
                      Uczestnicy
                    </div>
                    <div className="mt-2 text-sm text-slate-300 leading-relaxed break-words">
                      Drużyny, składy i szybki podgląd terminarza.
                    </div>
                  </div>

                  <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-white">
                      <UserCheck className="h-4 w-4 text-white/80" />
                      Udostępnianie
                    </div>
                    <div className="mt-2 text-sm text-slate-300 leading-relaxed break-words">
                      Publiczny widok z opcją kodu dostępu.
                    </div>
                  </div>
                </div>

                <div className="mt-6 grid gap-3 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
                  <Link to="/tournaments/new" className="w-full sm:w-auto">
                    <Button className="w-full sm:w-auto" variant="secondary" rightIcon={<Plus className="h-4 w-4" />}>
                      Nowy turniej
                    </Button>
                  </Link>
                  <Link to="/find-tournament" className="w-full sm:w-auto">
                    <Button className="w-full sm:w-auto" variant="ghost" rightIcon={<Search className="h-4 w-4" />}>
                      Otwórz publiczny podgląd
                    </Button>
                  </Link>
                </div>
              </div>
            </Card>
          </HoverLift>
        </Reveal>
      </section>

      {/* ===== PROCES ===== */}
      <section className="mt-10">
        <Reveal>
          <div className="text-sm text-slate-300">Proces</div>
          <h2 className="mt-1 text-2xl font-semibold text-white">Jak to działa</h2>
        </Reveal>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <Reveal delay={0.05}>
            <Step
              n="1"
              title="Konfiguracja turnieju"
              desc="Nazwa, dyscyplina, format i podstawowe parametry rozgrywek."
              icon={<Trophy className="h-5 w-5 text-white/90" />}
            />
          </Reveal>
          <Reveal delay={0.1}>
            <Step
              n="2"
              title="Uczestnicy i terminarz"
              desc="Dodaj drużyny, ustaw terminy, lokalizacje i udostępnij link/QR."
              icon={<QrCode className="h-5 w-5 text-white/90" />}
            />
          </Reveal>
          <Reveal delay={0.15}>
            <Step
              n="3"
              title="Wyniki i zestawienia"
              desc="Wprowadzaj wyniki, a system przeliczy tabele lub drabinki."
              icon={<ListChecks className="h-5 w-5 text-white/90" />}
            />
          </Reveal>
        </div>
      </section>

      {/* ===== DYSCYPLINY ===== */}
      <section className="mt-10">
        <Reveal>
          <div className="text-sm text-slate-300">Dyscypliny</div>
          <h2 className="mt-1 text-2xl font-semibold text-white">Różne sporty, jeden panel</h2>
        </Reveal>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Reveal delay={0.05}>
            <HoverLift className="h-full">
              <Card className="h-full p-5">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.06]">
                    <Goal className="h-5 w-5 text-white/90" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-base font-semibold text-white break-words">Sporty bramkowe</div>
                    <div className="mt-1 text-sm text-slate-300 break-words">
                      Piłka nożna / ręczna - wynik jako gole.
                    </div>
                  </div>
                </div>
              </Card>
            </HoverLift>
          </Reveal>

          <Reveal delay={0.1}>
            <HoverLift className="h-full">
              <Card className="h-full p-5">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.06]">
                    <Volleyball className="h-5 w-5 text-white/90" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-base font-semibold text-white break-words">Sety</div>
                    <div className="mt-1 text-sm text-slate-300 break-words">Siatkówka / tenis - wynik w setach.</div>
                  </div>
                </div>
              </Card>
            </HoverLift>
          </Reveal>

          <Reveal delay={0.15}>
            <HoverLift className="h-full">
              <Card className="h-full p-5">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.06]">
                    <Hand className="h-5 w-5 text-white/90" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-base font-semibold text-white break-words">Punkty</div>
                    <div className="mt-1 text-sm text-slate-300 break-words">
                      Koszykówka i inne - klasyczny wynik punktowy.
                    </div>
                  </div>
                </div>
              </Card>
            </HoverLift>
          </Reveal>
        </div>
      </section>
    </div>
  );
}