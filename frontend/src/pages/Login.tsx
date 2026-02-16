import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { LogIn, UserPlus, User, Mail, Lock, Eye, EyeOff, Loader2 } from "lucide-react";

import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { cn } from "../lib/cn";
import { toast } from "../ui/Toast";
import { apiFetch, setAccess, setRefresh } from "../api";

type Props = {
  onLogin?: () => Promise<void>;
};

function pickFirstError(data: any): string | null {
  if (!data) return null;
  if (typeof data === "string") return data;
  if (typeof data?.detail === "string") return data.detail;

  // typowe błędy DRF: { field: ["msg"] }
  for (const k of ["username", "email", "password", "non_field_errors"]) {
    const v = (data as any)[k];
    if (Array.isArray(v) && v.length) return String(v[0]);
  }
  return null;
}

export default function Login({ onLogin }: Props) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const urlMode = searchParams.get("mode");
  const nextParam = searchParams.get("next") || "";

  const [mode, setMode] = useState<"login" | "register">(
    urlMode === "register" ? "register" : "login"
  );

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setMode(urlMode === "register" ? "register" : "login");
    setError(null);
    // success zostawiamy (np. po udanej rejestracji i przejściu na login)
  }, [urlMode]);

  const nextQs = useMemo(() => {
    return nextParam && nextParam.startsWith("/") ? `next=${encodeURIComponent(nextParam)}` : "";
  }, [nextParam]);

  const goLogin = () => {
    navigate(nextQs ? `/login?${nextQs}` : "/login");
  };

  const goRegister = () => {
    navigate(nextQs ? `/login?mode=register&${nextQs}` : "/login?mode=register");
  };

  const translateLoginError = (msg?: string) => {
    if (!msg) return "Błąd logowania.";
    if (msg.includes("No active account")) return "Nieprawidłowy login lub hasło.";
    if (msg.toLowerCase().includes("unauthorized")) return "Brak dostępu. Zaloguj się ponownie.";
    return msg;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      if (mode === "login") {
        const res = await apiFetch(`/api/auth/login/`, {
          method: "POST",
          body: JSON.stringify({ username, password }),
          // Logowanie ma własny inline alert -> nie dublujemy toastów z apiFetch
          toastOnError: false,
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const msg = translateLoginError(pickFirstError(data) || data?.detail);
          setError(msg);
          return;
        }

        // zapis tokenów w jednym standardzie
        if (data?.access) setAccess(data.access);
        if (data?.refresh) setRefresh(data.refresh);

        toast.success("Zalogowano.", { durationMs: 1600 });

        await onLogin?.();

        if (nextParam && nextParam.startsWith("/")) {
          navigate(nextParam, { replace: true });
        } else {
          navigate("/my-tournaments");
        }
      } else {
        const res = await apiFetch(`/api/auth/register/`, {
          method: "POST",
          body: JSON.stringify({ username, email, password }),
          toastOnError: false,
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const msg =
            pickFirstError(data) || "Błąd rejestracji. Sprawdź dane i spróbuj ponownie.";
          setError(msg);
          return;
        }

        setPassword("");
        setSuccess("Konto utworzone. Możesz się teraz zalogować.");
        toast.success("Konto utworzone. Zaloguj się.", { durationMs: 2200 });

        goLogin();
      }
    } catch {
      // network / CORS / inne wyjątki
      setError("Błąd połączenia z serwerem.");
      toast.error("Brak połączenia z serwerem. Spróbuj ponownie.", { title: "Sieć" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-md py-8 sm:py-10">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
      >
        <Card className="p-6 sm:p-7">
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm text-slate-300">
                {mode === "login" ? "Panel użytkownika" : "Nowe konto"}
              </div>
              <h1 className="mt-1 text-2xl font-semibold text-white">
                {mode === "login" ? "Logowanie" : "Rejestracja"}
              </h1>
              <div className="mt-2 text-sm text-slate-300 leading-relaxed">
                {mode === "login"
                  ? "Zaloguj się, aby zarządzać turniejami lub dołączyć jako zawodnik, jeśli organizator włączył dołączanie."
                  : "Załóż konto, aby tworzyć turnieje lub dołączać do rozgrywek."}
              </div>
            </div>

            <div className="hidden sm:grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.06]">
              {mode === "login" ? (
                <LogIn className="h-5 w-5 text-white/90" />
              ) : (
                <UserPlus className="h-5 w-5 text-white/90" />
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="mt-5 grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-1">
            <button
              type="button"
              onClick={goLogin}
              className={cn(
                "rounded-xl px-3 py-2 text-sm font-semibold transition",
                mode === "login"
                  ? "bg-white/10 text-white shadow-[0_1px_0_rgba(255,255,255,0.06)_inset]"
                  : "text-slate-300 hover:text-white hover:bg-white/5"
              )}
            >
              Logowanie
            </button>
            <button
              type="button"
              onClick={goRegister}
              className={cn(
                "rounded-xl px-3 py-2 text-sm font-semibold transition",
                mode === "register"
                  ? "bg-white/10 text-white shadow-[0_1px_0_rgba(255,255,255,0.06)_inset]"
                  : "text-slate-300 hover:text-white hover:bg-white/5"
              )}
            >
              Rejestracja
            </button>
          </div>

          {/* Alerts (inline zostają) */}
          {(error || success) && (
            <div className="mt-4 space-y-2">
              {error && (
                <div className="rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {error}
                </div>
              )}
              {success && (
                <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
                  {success}
                </div>
              )}
            </div>
          )}

          {/* Form */}
          <form onSubmit={submit} className="mt-5 space-y-4">
            {/* Username */}
            <div>
              <label className="text-sm font-medium text-slate-200">Login</label>
              <div className="mt-2 relative">
                <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  className={cn(
                    "w-full rounded-2xl border border-white/10 bg-white/[0.04] pl-10 pr-3 py-2.5 text-sm text-white",
                    "placeholder:text-slate-500",
                    "focus:outline-none focus:ring-4 focus:ring-white/10 focus:border-white/15"
                  )}
                  value={username}
                  required
                  autoComplete="username"
                  placeholder="np. Dawid"
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
            </div>

            {/* Email only for register */}
            {mode === "register" && (
              <div>
                <label className="text-sm font-medium text-slate-200">Email</label>
                <div className="mt-2 relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="email"
                    className={cn(
                      "w-full rounded-2xl border border-white/10 bg-white/[0.04] pl-10 pr-3 py-2.5 text-sm text-white",
                      "placeholder:text-slate-500",
                      "focus:outline-none focus:ring-4 focus:ring-white/10 focus:border-white/15"
                    )}
                    value={email}
                    required
                    autoComplete="email"
                    placeholder="np. dawid@mail.com"
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* Password */}
            <div>
              <label className="text-sm font-medium text-slate-200">Hasło</label>
              <div className="mt-2 relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type={showPassword ? "text" : "password"}
                  className={cn(
                    "w-full rounded-2xl border border-white/10 bg-white/[0.04] pl-10 pr-10 py-2.5 text-sm text-white",
                    "placeholder:text-slate-500",
                    "focus:outline-none focus:ring-4 focus:ring-white/10 focus:border-white/15"
                  )}
                  value={password}
                  required
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  placeholder="Twoje hasło"
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl p-2 text-slate-300 hover:bg-white/5 hover:text-white"
                  aria-label={showPassword ? "Ukryj hasło" : "Pokaż hasło"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <div className="pt-2">
              <Button
                variant={mode === "login" ? "secondary" : "primary"}
                className="w-full justify-center"
                disabled={loading}
              >
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Przetwarzanie…
                  </span>
                ) : mode === "login" ? (
                  <span className="inline-flex items-center gap-2">
                    <LogIn className="h-4 w-4" />
                    Zaloguj
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    <UserPlus className="h-4 w-4" />
                    Zarejestruj
                  </span>
                )}
              </Button>
            </div>
          </form>

          {/* Links */}
          <div className="mt-5 flex items-center justify-between gap-3">
            {mode === "login" ? (
              <Link to="/forgot-password" className="text-sm text-slate-300 hover:text-white transition">
                Nie pamiętasz hasła?
              </Link>
            ) : (
              <span className="text-sm text-slate-400">
                Masz już konto?{" "}
                <button
                  type="button"
                  onClick={goLogin}
                  className="text-slate-200 hover:text-white underline underline-offset-4"
                >
                  Zaloguj się
                </button>
              </span>
            )}

            {mode === "login" ? (
              <span className="text-sm text-slate-400">
                Nie masz konta?{" "}
                <button
                  type="button"
                  onClick={goRegister}
                  className="text-slate-200 hover:text-white underline underline-offset-4"
                >
                  Zarejestruj się
                </button>
              </span>
            ) : (
              <span className="text-sm text-slate-400">Po rejestracji wrócisz do logowania.</span>
            )}
          </div>

          {/* Small note */}
          <div className="mt-6 text-xs text-slate-400">
            Wskazówka: jeśli organizator włączył dołączanie do turnieju, po zalogowaniu możesz wejść kodem i zgłosić udział.
          </div>
        </Card>
      </motion.div>
    </div>
  );
}
