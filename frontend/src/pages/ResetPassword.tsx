import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight, Eye, EyeOff, KeyRound, Loader2, Lock } from "lucide-react";

import { apiFetch } from "../api";
import { cn } from "../lib/cn";

import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { InlineAlert } from "../ui/InlineAlert";
import { Input } from "../ui/Input";

/** Normalizuje odpowiedzi DRF do pojedynczego komunikatu, aby formularz mógł wyświetlić spójny błąd. */
function pickFirstError(data: any): string | null {
  if (!data) return null;
  if (typeof data === "string") return data;
  if (typeof data?.detail === "string") return data.detail;

  for (const k of ["token", "new_password", "password", "detail", "non_field_errors"]) {
    const v = data?.[k];
    if (typeof v === "string" && v) return v;
    if (Array.isArray(v) && v.length) return String(v[0]);
  }

  return null;
}

export default function ResetPassword() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const token = useMemo(() => searchParams.get("token") || "", [searchParams]);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showPw, setShowPw] = useState(false);
  const [showPw2, setShowPw2] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const redirectTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (redirectTimerRef.current) window.clearTimeout(redirectTimerRef.current);
    };
  }, []);

  const validate = (): string | null => {
    if (password.length < 8) return "Hasło musi mieć co najmniej 8 znaków.";
    if (password !== confirmPassword) return "Hasła nie są takie same.";
    return null;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!token) {
      setError("Brak tokenu resetu hasła.");
      return;
    }

    const v = validate();
    if (v) {
      setError(v);
      return;
    }

    setLoading(true);

    try {
      const res = await apiFetch("/api/auth/password-reset/confirm/", {
        method: "POST",
        body: JSON.stringify({ token, new_password: password }),
        toastOnError: false,
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(pickFirstError(data) || "Nie udało się zmienić hasła.");
        return;
      }

      setSuccess("Hasło zostało zmienione. Możesz się zalogować.");
      setPassword("");
      setConfirmPassword("");

      redirectTimerRef.current = window.setTimeout(() => navigate("/login"), 800);
    } catch {
      setError("Brak połączenia z serwerem. Spróbuj ponownie.");
    } finally {
      setLoading(false);
    }
  };

  const inputBase = cn(
    "pl-10 pr-10 py-2.5",
    "rounded-2xl bg-white/[0.04]",
    "text-white placeholder:text-slate-500"
  );

  if (!token) {
    return (
      <div className="mx-auto max-w-md py-8 sm:py-10">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: "easeOut" }}>
          <Card className="p-6 sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="mt-1 text-2xl font-semibold text-white">Brak tokenu</h1>
                <p className="mt-2 text-sm text-slate-300 leading-relaxed break-words">
                  Link do resetu hasła jest nieprawidłowy albo wygasł. Wygeneruj nowy link resetu.
                </p>
              </div>

              <div className="hidden sm:grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.06]">
                <AlertTriangle className="h-5 w-5 text-white/90" />
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <Button
                type="button"
                variant="secondary"
                rightIcon={<ArrowRight className="h-4 w-4" />}
                onClick={() => navigate("/forgot-password")}
              >
                Wygeneruj nowy link
              </Button>

              <Link
                to="/login"
                className="text-sm text-slate-300 hover:text-white transition underline underline-offset-4 self-center"
              >
                Wróć do logowania
              </Link>
            </div>
          </Card>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md py-8 sm:py-10">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: "easeOut" }}>
        <Card className="p-6 sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="mt-1 text-2xl font-semibold text-white">Ustaw nowe hasło</h1>
              <p className="mt-2 text-sm text-slate-300 leading-relaxed break-words">
                Wprowadź nowe hasło i potwierdź je. Po zapisaniu nastąpi przekierowanie do logowania.
              </p>
            </div>

            <div className="hidden sm:grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.06]">
              <KeyRound className="h-5 w-5 text-white/90" />
            </div>
          </div>

          {(error || success) ? (
            <div className="mt-4 space-y-2">
              {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}
              {success ? <InlineAlert variant="success">{success}</InlineAlert> : null}
            </div>
          ) : null}

          <form onSubmit={submit} className="mt-5 space-y-4">
            <div>
              <label htmlFor="reset_pw_1" className="text-sm font-medium text-slate-200">
                Nowe hasło
              </label>
              <div className="mt-2 relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <Input
                  id="reset_pw_1"
                  type={showPw ? "text" : "password"}
                  className={inputBase}
                  value={password}
                  required
                  autoComplete="new-password"
                  placeholder="min. 8 znaków"
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className={cn(
                    "absolute right-2 top-1/2 -translate-y-1/2 rounded-xl p-2",
                    "text-slate-300 hover:bg-white/5 hover:text-white",
                    "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/15"
                  )}
                  aria-label={showPw ? "Ukryj hasło" : "Pokaż hasło"}
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <div className="mt-2 text-xs text-slate-400">Zalecenie: użyj dłuższego hasła i unikaj oczywistych fraz.</div>
            </div>

            <div>
              <label htmlFor="reset_pw_2" className="text-sm font-medium text-slate-200">
                Powtórz hasło
              </label>
              <div className="mt-2 relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <Input
                  id="reset_pw_2"
                  type={showPw2 ? "text" : "password"}
                  className={inputBase}
                  value={confirmPassword}
                  required
                  autoComplete="new-password"
                  placeholder="powtórz nowe hasło"
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPw2((v) => !v)}
                  className={cn(
                    "absolute right-2 top-1/2 -translate-y-1/2 rounded-xl p-2",
                    "text-slate-300 hover:bg-white/5 hover:text-white",
                    "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/15"
                  )}
                  aria-label={showPw2 ? "Ukryj hasło" : "Pokaż hasło"}
                >
                  {showPw2 ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button
              variant="secondary"
              className="w-full justify-center"
              disabled={loading}
              leftIcon={loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              rightIcon={!loading ? <ArrowRight className="h-4 w-4" /> : null}
            >
              {loading ? "Zapisywanie..." : "Zmień hasło"}
            </Button>
          </form>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm">
            <Link to="/login" className="text-slate-300 hover:text-white transition underline underline-offset-4">
              Wróć do logowania
            </Link>
            <Link to="/forgot-password" className="text-slate-300 hover:text-white transition underline underline-offset-4">
              Wygeneruj nowy link
            </Link>
          </div>
        </Card>
      </motion.div>
    </div>
  );
}