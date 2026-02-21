import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { LogOut, Menu, Plus, Search, Trophy, X } from "lucide-react";

import { cn } from "../lib/cn";

import { Button } from "../ui/Button";

type Props = {
  username: string | null;
  onLogout: () => void;
};

function isActivePath(current: string, target: string) {
  if (target === "/") return current === "/";
  return current === target || current.startsWith(target + "/");
}

function DesktopNavLink({
  to,
  children,
  active,
}: {
  to: string;
  children: React.ReactNode;
  active: boolean;
}) {
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center rounded-full px-3.5 py-2 text-sm font-medium transition",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/15",
        active
          ? "bg-white/10 text-white border border-white/15 shadow-[0_1px_0_rgba(255,255,255,0.06)_inset]"
          : "text-slate-300 hover:text-white hover:bg-white/10"
      )}
    >
      {children}
    </Link>
  );
}

export default function NavBar({ username, onLogout }: Props) {
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 16);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // CSS var wysokości - spójne pozycjonowanie dla FlowBar pod NavBarem.
  useEffect(() => {
    const h = scrolled ? 72 : 84;
    document.documentElement.style.setProperty("--app-navbar-h", `${h}px`);
  }, [scrolled]);

  const authedLinks = [
    { to: "/", label: "Strona glowna" },
    { to: "/find-tournament", label: "Szukaj" },
    { to: "/my-tournaments", label: "Moje turnieje" },
    { to: "/tournaments/new", label: "Utworz" },
  ] as const;

  const isActive = (path: string) => isActivePath(location.pathname, path);

  useEffect(() => {
    if (!username && mobileMenuOpen) setMobileMenuOpen(false);
  }, [username, mobileMenuOpen]);

  return (
    <>
      <header
        className={cn(
          "fixed top-0 left-0 right-0 z-50 transition-all duration-300 border-b",
          scrolled
            ? "bg-slate-950/65 backdrop-blur-xl border-white/10 py-3 shadow-lg shadow-indigo-500/5"
            : "bg-transparent border-transparent py-5"
        )}
      >
        <div className="flex w-full items-center justify-between px-4 sm:px-6 lg:px-8 xl:px-10 2xl:px-12">
          <Link to="/" className="group flex items-center gap-3">
            <div className="relative grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-[0_0_20px_rgba(99,102,241,0.35)] transition-transform group-hover:scale-[1.03]">
              <Trophy className="h-5 w-5 text-white" />
              <div className="absolute inset-0 rounded-xl bg-white/15 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>

            <div className="hidden sm:block">
              <div className="text-lg font-bold leading-none text-white tracking-wide">
                Turnieje<span className="text-indigo-400">.pro</span>
              </div>
              <div className="text-[10px] font-medium text-slate-400 tracking-widest uppercase opacity-70">
                System zarzadzania
              </div>
            </div>
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            {username &&
              authedLinks.map((l) => (
                <DesktopNavLink key={l.to} to={l.to} active={isActive(l.to)}>
                  {l.label}
                </DesktopNavLink>
              ))}
          </nav>

          <div className="flex items-center gap-3">
            {!username ? (
              <>
                <Link to="/login">
                  <Button variant="secondary">Zaloguj</Button>
                </Link>
                <Link to="/login?mode=register">
                  <Button variant="primary">Zarejestruj</Button>
                </Link>
              </>
            ) : (
              <div className="flex items-center gap-3">
                <div className="hidden sm:flex items-center gap-3 rounded-full border border-white/10 bg-white/5 pl-2 pr-4 py-1.5 backdrop-blur-md">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-tr from-indigo-500 to-violet-500 shadow-inner">
                    <span className="text-xs font-bold text-white">
                      {username.slice(0, 1).toUpperCase()}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs text-slate-400 leading-none mb-0.5">Witaj,</span>
                    <span className="text-sm font-semibold text-white leading-none">{username}</span>
                  </div>
                </div>

                <button
                  onClick={onLogout}
                  className="group flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 transition-colors hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-300"
                  title="Wyloguj"
                >
                  <LogOut className="h-5 w-5" />
                </button>
              </div>
            )}

            <button
              className="md:hidden rounded-xl border border-white/10 bg-white/5 p-2 text-slate-200 hover:bg-white/10"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label="Otworz menu"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </header>

      <AnimatePresence>
        {mobileMenuOpen && username && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            style={{ top: "var(--app-navbar-h, 72px)" }}
            className="fixed left-0 right-0 z-40 overflow-hidden border-b border-white/10 bg-slate-950/90 backdrop-blur-2xl md:hidden"
          >
            <div className="p-4 space-y-2">
              {authedLinks.map((l) => {
                const active = isActive(l.to);

                const icon =
                  l.to === "/" ? (
                    <Trophy className="h-4 w-4 opacity-70" />
                  ) : l.to === "/find-tournament" ? (
                    <Search className="h-4 w-4 opacity-80" />
                  ) : l.to === "/tournaments/new" ? (
                    <Plus className="h-4 w-4 opacity-80" />
                  ) : (
                    <Trophy className="h-4 w-4 opacity-70" />
                  );

                return (
                  <Link
                    key={l.to}
                    to={l.to}
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      "flex items-center justify-between rounded-xl px-4 py-3 text-base font-medium transition",
                      active
                        ? "bg-white/10 text-white border border-white/10"
                        : "text-slate-300 hover:bg-white/5 hover:text-white"
                    )}
                  >
                    <span className="flex items-center gap-2">
                      {icon}
                      {l.label}
                    </span>

                    {active && (
                      <div className="h-2 w-2 rounded-full bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.7)]" />
                    )}
                  </Link>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className={cn(scrolled ? "h-[72px]" : "h-[84px]")} />
    </>
  );
}

/*
Co zmieniono:
- Dodano CSS var --app-navbar-h (72/84) do spójnego pozycjonowania elementów pod NavBarem.
- Mobile menu używa teraz top z tej zmiennej (bez hardcoded 72px).
- Bez zmian w UI i logice linków, tylko stabilizacja layoutu.
*/
