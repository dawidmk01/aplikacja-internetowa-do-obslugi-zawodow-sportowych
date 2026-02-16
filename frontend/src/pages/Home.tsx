import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Trophy,
  QrCode,
  ShieldCheck,
  Timer,
  Brackets,
  Search,
  Plus,
  ArrowRight,
  Sparkles,
  Users,
  UserCheck,
  Volleyball,
  Hand,
  Goal,
  Award,
  ListChecks,
} from "lucide-react";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { cn } from "../lib/cn";

/* =========================
   Micro-animations
   ========================= */

function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
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

function HoverLift({
  children,
  className,
  scale = 1.01,
}: {
  children: React.ReactNode;
  className?: string;
  scale?: number;
}) {
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

/* =========================
   UI blocks
   ========================= */

function MiniInfo({
  icon,
  label,
  title,
  desc,
}: {
  icon: React.ReactNode;
  label: string;
  title: string;
  desc: string;
}) {
  return (
    <HoverLift scale={1.015} className="h-full">
      <div className="h-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[0.06]">
            {icon}
          </div>
          <div className="min-w-0">
            <div className="text-xs text-slate-400">{label}</div>
            <div className="mt-1 text-sm font-semibold text-white">{title}</div>
            <div className="mt-1 text-xs text-slate-300/90 leading-relaxed">{desc}</div>
          </div>
        </div>
      </div>
    </HoverLift>
  );
}

function Feature({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.06]">
        {icon}
      </div>
      <div>
        <div className="text-sm font-semibold text-white">{title}</div>
        <div className="mt-1 text-sm text-slate-300 leading-relaxed">{desc}</div>
      </div>
    </div>
  );
}

/**
 * ActionCard - wersja "równa wysokość + hover działa zawsze"
 * - Card ma h-full i flex-col
 * - CTA siedzi na dole (mt-auto)
 */
function ActionCard({
  icon,
  title,
  desc,
  to,
  cta,
  variant = "secondary",
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  to: string;
  cta: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  return (
    <Card className="h-full p-5">
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-indigo-500/25 to-purple-600/25 border border-white/10">
              {icon}
            </div>
            <div>
              <div className="text-base font-semibold text-white">{title}</div>
              <div className="mt-1 text-sm text-slate-300 leading-relaxed">{desc}</div>
            </div>
          </div>

          <Sparkles className="h-5 w-5 text-white/15" />
        </div>

        <div className="mt-auto pt-4">
          <Link to={to}>
            <Button
              variant={variant}
              rightIcon={<ArrowRight className="h-4 w-4" />}
              className={cn(
                "w-full justify-center",
                variant === "primary" &&
                  "shadow-[0_12px_40px_rgba(99,102,241,0.22)]"
              )}
            >
              {cta}
            </Button>
          </Link>
        </div>
      </div>
    </Card>
  );
}

function RuleCard({
  icon,
  title,
  items,
}: {
  icon: React.ReactNode;
  title: string;
  items: string[];
}) {
  return (
    <HoverLift className="h-full" scale={1.01}>
      <Card className="h-full p-6">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.06]">
            {icon}
          </div>
          <div className="text-base font-semibold text-white">{title}</div>
        </div>

        <ul className="mt-4 space-y-2 text-sm text-slate-300">
          {items.map((x, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-2 h-1.5 w-1.5 rounded-full bg-indigo-400/70 shrink-0" />
              <span className="leading-relaxed">{x}</span>
            </li>
          ))}
        </ul>
      </Card>
    </HoverLift>
  );
}

/* =========================
   Page
   ========================= */

export default function Home() {
  return (
    <div className="space-y-10">
      {/* HERO */}
      <section className="relative">
        <div className="absolute inset-0 -z-10 rounded-3xl bg-gradient-to-r from-white/[0.06] to-white/[0.02] border border-white/10" />

        {/* subtle local glow */}
        <div className="pointer-events-none absolute -z-10 inset-0 overflow-hidden rounded-3xl">
          <div className="absolute -top-20 left-1/3 h-60 w-[36rem] rounded-full bg-indigo-500/10 blur-3xl" />
          <div className="absolute -bottom-20 left-2/3 h-60 w-[36rem] rounded-full bg-purple-500/10 blur-3xl" />
        </div>

        <div className="px-6 py-10 sm:px-10 sm:py-12">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="max-w-3xl"
          >
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-xs font-semibold text-slate-200">
              <Trophy className="h-4 w-4 text-indigo-300" />
              System do organizacji turniejów sportowych
            </div>

            <h1 className="mt-4 text-3xl sm:text-4xl font-bold tracking-tight text-white">
              Turniej od A do Z - konfiguracja, publikacja i prowadzenie meczów{" "}
              <span className="text-indigo-300">w jednej aplikacji</span>.
            </h1>

            <p className="mt-4 text-base sm:text-lg text-slate-300 leading-relaxed">
              Przygotuj strukturę rozgrywek, dodaj uczestników, wygeneruj mecze i prowadź wynik w trakcie spotkań.
              Podgląd dla widzów działa przez link, identyfikator, kod dostępu lub QR, zależnie od ustawień turnieju.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link to="/find-tournament">
                <Button variant="secondary" leftIcon={<Search className="h-4 w-4" />}>
                  Znajdź turniej
                </Button>
              </Link>

              <Link to="/tournaments/new">
                <Button
                  variant="primary"
                  leftIcon={<Plus className="h-4 w-4" />}
                  className="shadow-[0_12px_40px_rgba(99,102,241,0.22)]"
                >
                  Utwórz turniej
                </Button>
              </Link>

              <Link to="/my-tournaments">
                <Button variant="ghost">Moje turnieje</Button>
              </Link>
            </div>

            {/* Mini info - NIE powtarzamy dużych kart */}
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 items-stretch">
              <MiniInfo
                icon={<Goal className="h-4 w-4 text-white/90" />}
                label="Sporty"
                title="Piłka, ręczna, kosz, siatka"
                desc="System jest przygotowany pod różne dyscypliny i łatwo go rozszerzać o kolejne."
              />
              <MiniInfo
                icon={<Brackets className="h-4 w-4 text-white/90" />}
                label="Formaty"
                title="Liga, grupy, puchar, mieszany"
                desc="Możesz prowadzić rozgrywki etapami - np. grupy + faza pucharowa."
              />
              <MiniInfo
                icon={<Timer className="h-4 w-4 text-white/90" />}
                label="Punktacja"
                title="Gole, punkty, sety"
                desc="Tryb liczenia wyniku zależy od sportu - różne zasady i walidacja wyniku."
              />
              <MiniInfo
                icon={<Award className="h-4 w-4 text-white/90" />}
                label="Rankingi"
                title="Tabele i tie-breaki"
                desc="Zasady tabel i rozstrzygania remisów są wzorowane na praktykach ligowych (np. PZPN) i możliwe do konfiguracji."
              />
            </div>
          </motion.div>
        </div>
      </section>

      {/* AKCJE - równe wysokości + hover */}
      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 items-stretch">
        <Reveal delay={0.02}>
          <HoverLift className="h-full">
            <ActionCard
              icon={<QrCode className="h-5 w-5 text-indigo-200" />}
              title="Jestem widzem"
              desc="Otwórz turniej po identyfikatorze, linku lub QR. Zobacz tabele, drabinkę, terminarz i wyniki."
              to="/find-tournament"
              cta="Znajdź turniej"
              variant="secondary"
            />
          </HoverLift>
        </Reveal>

        <Reveal delay={0.06}>
          <HoverLift className="h-full">
            <ActionCard
              icon={<UserCheck className="h-5 w-5 text-indigo-200" />}
              title="Jestem zawodnikiem"
              desc="Jeśli organizator włączył dołączanie, możesz wejść kodem i zgłosić udział (np. nazwa drużyny)."
              to="/find-tournament"
              cta="Dołącz do turnieju"
              variant="secondary"
            />
          </HoverLift>
        </Reveal>

        <Reveal delay={0.10}>
          <HoverLift className="h-full">
            <ActionCard
              icon={<Users className="h-5 w-5 text-indigo-200" />}
              title="Panel organizatora"
              desc="Zarządzaj turniejami i etapami. Kontroluj role (organizator, asystent), dostęp i publikację turnieju."
              to="/my-tournaments"
              cta="Przejdź do panelu"
              variant="secondary"
            />
          </HoverLift>
        </Reveal>

        <Reveal delay={0.14}>
          <HoverLift className="h-full">
            <ActionCard
              icon={<Plus className="h-5 w-5 text-indigo-200" />}
              title="Nowy turniej"
              desc="Utwórz turniej w kilku krokach: format, uczestnicy, generowanie meczów, publikacja i udostępnienie."
              to="/tournaments/new"
              cta="Utwórz turniej"
              variant="primary"
            />
          </HoverLift>
        </Reveal>
      </section>

      {/* ZASADY i KONFIGURACJA - tu dajemy „mięso” */}
      <section>
        <Reveal>
          <div className="mb-4">
            <div className="text-lg font-semibold text-white">Zasady i konfiguracja rozgrywek</div>
            <div className="mt-1 text-sm text-slate-300">
              Rzeczy, które realnie robią różnicę w turnieju - formaty, punktacja, rankingi i reguły rozstrzygania remisów.
            </div>
          </div>
        </Reveal>

        <div className="grid gap-4 md:grid-cols-2 items-stretch">
          <Reveal delay={0.02}>
            <RuleCard
              icon={<Volleyball className="h-5 w-5 text-white/90" />}
              title="Obsługiwane dyscypliny"
              items={[
                "Piłka nożna - wynik bramkowy i incydenty meczowe.",
                "Piłka ręczna - wynik bramkowy, podobny przebieg jak w piłce.",
                "Koszykówka - punktacja i szybkie aktualizacje wyniku.",
                "Siatkówka - sety i wynik oparty o sety (zależnie od konfiguracji).",
              ]}
            />
          </Reveal>

          <Reveal delay={0.06}>
            <RuleCard
              icon={<Brackets className="h-5 w-5 text-white/90" />}
              title="Typy turniejów"
              items={[
                "Liga - klasyczna tabela i kolejki.",
                "Grupy - tabela w grupach + awans dalej.",
                "Puchar - drabinka i fazy eliminacyjne.",
                "Mieszany - np. grupy + puchar (najczęstszy scenariusz na wydarzeniach).",
              ]}
            />
          </Reveal>

          <Reveal delay={0.10}>
            <RuleCard
              icon={<ListChecks className="h-5 w-5 text-white/90" />}
              title="Punktacja i wynik"
              items={[
                "Tryby: gole, punkty, sety - dobierane per dyscyplina.",
                "Incydenty mogą wspierać prowadzenie spotkania (np. przebieg, zdarzenia) i aktualizować wynik.",
                "Walidacja wyniku zależna od typu etapu (np. remis w lidze, brak remisu w pucharze).",
              ]}
            />
          </Reveal>

          <Reveal delay={0.14}>
            <RuleCard
              icon={<ShieldCheck className="h-5 w-5 text-white/90" />}
              title="Rankingi i tie-breaki"
              items={[
                "Tabela rankingowa wzorowana na praktykach ligowych (np. PZPN) - punkty, bilans, bramki.",
                "Rozstrzyganie remisów - kolejność kryteriów jest przewidywalna i możliwa do rozszerzenia.",
                "Kontrola dostępu - publiczny link/QR, opcjonalny kod, role: organizator i asystent.",
              ]}
            />
          </Reveal>
        </div>
      </section>

      {/* FUNKCJE - największy box też ma hover */}
      <section>
        <Reveal>
          <div className="mb-4">
            <div className="text-lg font-semibold text-white">Co dokładnie oferuje system?</div>
            <div className="mt-1 text-sm text-slate-300">
              Konkretne funkcje, które mają sens w turnieju - a nie ogólniki.
            </div>
          </div>
        </Reveal>

        <Reveal delay={0.04}>
          <HoverLift scale={1.005}>
            <Card className="p-6">
              <div className="grid gap-6 md:grid-cols-2">
                <Feature
                  icon={<Brackets className="h-5 w-5 text-white/90" />}
                  title="Tabele i drabinki"
                  desc="Wyniki są prezentowane w czytelnych widokach. Widz od razu widzi kto gra dalej i jaki jest stan rozgrywek."
                />
                <Feature
                  icon={<Timer className="h-5 w-5 text-white/90" />}
                  title="Zegar i incydenty"
                  desc="Przebieg meczu zapisujesz jako incydenty (np. gol, punkt, kara). Zegar wspiera prowadzenie spotkania na żywo."
                />
                <Feature
                  icon={<ShieldCheck className="h-5 w-5 text-white/90" />}
                  title="Kontrola dostępu"
                  desc="Turniej może być dostępny po linku lub QR, a w razie potrzeby dodatkowo zabezpieczony kodem dostępu."
                />
                <Feature
                  icon={<QrCode className="h-5 w-5 text-white/90" />}
                  title="Podgląd dla zawodników i widzów"
                  desc="Osoby z zewnątrz sprawdzają harmonogram i wyniki bez wchodzenia do panelu zarządzania."
                />
              </div>
            </Card>
          </HoverLift>
        </Reveal>
      </section>

      {/* JAK TO DZIAŁA */}
      <section>
        <Reveal>
          <div className="mb-4">
            <div className="text-lg font-semibold text-white">Jak to wygląda w praktyce?</div>
            <div className="mt-1 text-sm text-slate-300">
              Typowy scenariusz od utworzenia turnieju do podglądu wyników przez widzów i zawodników.
            </div>
          </div>
        </Reveal>

        <div className="grid gap-4 md:grid-cols-3 items-stretch">
          <Reveal delay={0.02}>
            <HoverLift className="h-full">
              <Card className="h-full p-5 flex flex-col">
                <div className="flex items-center gap-3">
                  <div className="grid h-9 w-9 place-items-center rounded-xl bg-white/10 border border-white/10 text-white font-bold">
                    1
                  </div>
                  <div className="text-base font-semibold text-white">Konfiguracja</div>
                </div>
                <div className="mt-3 text-sm text-slate-300 leading-relaxed">
                  Organizator wybiera format, dodaje uczestników i generuje mecze. Panel prowadzi krok po kroku.
                </div>
                <div className="mt-auto pt-4">
                  <Link to="/tournaments/new">
                    <Button variant="ghost" rightIcon={<ArrowRight className="h-4 w-4" />} className="w-full justify-center">
                      Otwórz kreator
                    </Button>
                  </Link>
                </div>
              </Card>
            </HoverLift>
          </Reveal>

          <Reveal delay={0.06}>
            <HoverLift className="h-full">
              <Card className="h-full p-5 flex flex-col">
                <div className="flex items-center gap-3">
                  <div className="grid h-9 w-9 place-items-center rounded-xl bg-white/10 border border-white/10 text-white font-bold">
                    2
                  </div>
                  <div className="text-base font-semibold text-white">Publikacja</div>
                </div>
                <div className="mt-3 text-sm text-slate-300 leading-relaxed">
                  System udostępnia turniej przez identyfikator i QR. Opcjonalnie można włączyć kod dostępu.
                </div>
                <div className="mt-auto pt-4">
                  <Link to="/find-tournament">
                    <Button variant="ghost" rightIcon={<ArrowRight className="h-4 w-4" />} className="w-full justify-center">
                      Znajdź turniej
                    </Button>
                  </Link>
                </div>
              </Card>
            </HoverLift>
          </Reveal>

          <Reveal delay={0.10}>
            <HoverLift className="h-full">
              <Card className="h-full p-5 flex flex-col">
                <div className="flex items-center gap-3">
                  <div className="grid h-9 w-9 place-items-center rounded-xl bg-white/10 border border-white/10 text-white font-bold">
                    3
                  </div>
                  <div className="text-base font-semibold text-white">Prowadzenie</div>
                </div>
                <div className="mt-3 text-sm text-slate-300 leading-relaxed">
                  W trakcie meczu wpisujesz incydenty i wynik. Widzowie i zawodnicy widzą aktualizacje w podglądzie turnieju.
                </div>
                <div className="mt-auto pt-4">
                  <div className="text-xs text-slate-400">
                    Tip: tryb prowadzenia zależy od dyscypliny - gole, punkty lub sety.
                  </div>
                </div>
              </Card>
            </HoverLift>
          </Reveal>
        </div>
      </section>

      <Reveal>
        <div className="text-xs text-slate-400">
          Tip: Jako widz lub zawodnik najszybciej wejdziesz przez "Znajdź turniej" - identyfikator, QR lub kod.
        </div>
      </Reveal>
    </div>
  );
}
