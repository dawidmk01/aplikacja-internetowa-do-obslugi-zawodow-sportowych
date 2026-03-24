// frontend/src/components/NavBar.tsx
// Plik renderuje główny pasek nawigacji aplikacji wraz z obsługą stanu sesji i menu mobilnego.

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
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
  children: ReactNode;
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
  const navigate = useNavigate();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  const mobileMenuId = "app-mobile-nav";

  const authedLinks = useMemo(
    () =>
      [
        { to: "/", label: "Strona główna" },
        { to: "/find-tournament", label: "Szukaj" },
        { to: "/my-tournaments", label: "Moje turnieje" },
        { to: "/tournaments/new", label: "Utwórz" },
      ] as const,
    []
  );

  const isActive = (path: string) => isActivePath(location.pathname, path);

  useEffect(() => {
    const handleScroll = () => {
      const y = typeof window !== "undefined" ? window.scrollY : 0;
      setScrolled(y > 16);
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // CSS var wysokości - spójne pozycjonowanie elementów pod NavBarem.
  useEffect(() => {
    const h = scrolled ? 72 : 84;
    document.documentElement.style.setProperty("--app-navbar-h", `${h}px`);
  }, [scrolled]);

  useEffect(() => {
    if (!username && mobileMenuOpen) setMobileMenuOpen(false);
  }, [username, mobileMenuOpen]);

  useEffect(() => {
    if (!mobileMenuOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileMenuOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (mobileMenuOpen) setMobileMenuOpen(false);
  }, [location.pathname]);

  const handleAccountClick = () => {
    if (!username) {
      navigate("/login");
      return;
    }

    navigate("/account");
  };

  return (
    <>
      <header
        className={cn(
          "fixed left-0 right-0 top-0 z-50 border-b transition-all duration-300",
          scrolled
            ? "bg-slate-950/65 backdrop-blur-xl border-white/10 py-3 shadow-lg shadow-indigo-500/5"
            : "bg-transparent border-transparent py-5"
        )}
      >
        <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link to="/" className="group flex items-center gap-3">
            <div
              className={cn(
                "relative grid h-10 w-10 place-items-center overflow-hidden rounded-xl",
                "transition-transform group-hover:scale-[1.03]"
              )}
            >
              <div className="h-8 w-8 overflow-hidden rounded-lg">
                <img
                  src={`${import.meta.env.BASE_URL}turnieje_pro.png`}
                  alt="Turnieje.pro"
                  className="h-full w-full object-contain p-0.5"
                  draggable="false"
                  loading="eager"
                />
              </div>
            </div>

            <div className="hidden sm:block">
              <div className="text-lg font-bold leading-none tracking-wide text-white">
                Turnieje<span className="text-indigo-400">.pro</span>
              </div>
              <div className="text-[10px] font-medium uppercase tracking-widest text-slate-400 opacity-70">
                System zarządzania
              </div>
            </div>
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Nawigacja główna">
            {username
              ? authedLinks.map((l) => (
                  <DesktopNavLink key={l.to} to={l.to} active={isActive(l.to)}>
                    {l.label}
                  </DesktopNavLink>
                ))
              : null}
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
                <button
                  type="button"
                  onClick={handleAccountClick}
                  className={cn(
                    "hidden items-center gap-3 rounded-full border border-white/10 bg-white/5 py-1.5 pl-2 pr-4 backdrop-blur-md sm:flex",
                    "transition-colors",
                    isActive("/account")
                      ? "border-white/15 bg-white/10 text-white shadow-[0_1px_0_rgba(255,255,255,0.06)_inset]"
                      : "hover:border-indigo-500/40 hover:bg-indigo-500/10",
                    "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/15"
                  )}
                  title="Moje konto"
                  aria-label="Moje konto"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-tr from-indigo-500 to-violet-500 shadow-inner">
                    <span className="text-xs font-bold text-white">
                      {username.slice(0, 1).toUpperCase()}
                    </span>
                  </div>

                  <div className="flex flex-col text-left">
                    <span className="mb-0.5 text-xs leading-none text-slate-400">Witaj,</span>
                    <span className="text-sm font-semibold leading-none text-white">{username}</span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={onLogout}
                  className={cn(
                    "group flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 transition-colors",
                    "hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-300",
                    "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/15"
                  )}
                  title="Wyloguj"
                  aria-label="Wyloguj"
                >
                  <LogOut className="h-5 w-5" />
                </button>
              </div>
            )}

            <button
              type="button"
              className={cn(
                "rounded-xl border border-white/10 bg-white/5 p-2 text-slate-200 transition md:hidden",
                "hover:bg-white/10",
                "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/15"
              )}
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label={mobileMenuOpen ? "Zamknij menu" : "Otwórz menu"}
              aria-expanded={mobileMenuOpen}
              aria-controls={mobileMenuId}
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </header>

      <AnimatePresence>
        {mobileMenuOpen && username ? (
          <motion.div
            id={mobileMenuId}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            style={{ top: "var(--app-navbar-h, 72px)" }}
            className="fixed left-0 right-0 z-40 overflow-hidden border-b border-white/10 bg-slate-950/90 backdrop-blur-2xl md:hidden"
          >
            <div className="space-y-2 p-4">
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  navigate("/account");
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-xl px-4 py-3 text-base font-medium transition",
                  "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/15",
                  isActive("/account")
                    ? "bg-white/10 text-white border border-white/10"
                    : "text-slate-300 hover:bg-white/5 hover:text-white"
                )}
                aria-current={isActive("/account") ? "page" : undefined}
              >
                <span>Moje konto</span>
                {isActive("/account") ? (
                  <div className="h-2 w-2 rounded-full bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.7)]" />
                ) : null}
              </button>

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
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center justify-between rounded-xl px-4 py-3 text-base font-medium transition",
                      "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/15",
                      active
                        ? "bg-white/10 text-white border border-white/10"
                        : "text-slate-300 hover:bg-white/5 hover:text-white"
                    )}
                  >
                    <span className="flex items-center gap-2">
                      {icon}
                      {l.label}
                    </span>

                    {active ? (
                      <div className="h-2 w-2 rounded-full bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.7)]" />
                    ) : null}
                  </Link>
                );
              })}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className={cn(scrolled ? "h-[72px]" : "h-[84px]")} />
    </>
  );
}