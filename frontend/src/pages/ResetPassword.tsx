// frontend/src/pages/ResetPassword.tsx
// Plik obsługuje ustawienie nowego hasła po użyciu linku resetującego konto.

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  XCircle,
} from "lucide-react";

import { apiFetch } from "../api";
import { cn } from "../lib/cn";

import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { InlineAlert } from "../ui/InlineAlert";
import { Input } from "../ui/Input";

type PasswordRule = {
  id: string;
  label: string;
  valid: boolean;
};

function getPasswordRules(password: string): PasswordRule[] {
  return [
    {
      id: "length",
      label: "Co najmniej 8 znaków",
      valid: password.length >= 8,
    },
    {
      id: "lowercase",
      label: "Co najmniej jedna mała litera",
      valid: /[a-z]/.test(password),
    },
    {
      id: "uppercase",
      label: "Co najmniej jedna duża litera",
      valid: /[A-Z]/.test(password),
    },
    {
      id: "digitOrSpecial",
      label: "Co najmniej jedna cyfra albo znak specjalny",
      valid: /[0-9]|[^A-Za-z0-9]/.test(password),
    },
  ];
}

function firstPasswordRuleError(password: string): string | null {
  const failedRule = getPasswordRules(password).find((rule) => !rule.valid);

  if (!failedRule) {
    return null;
  }

  return failedRule.label.endsWith(".") ? failedRule.label : `${failedRule.label}.`;
}

function pickFirstError(data: unknown): string | null {
  if (!data) return null;
  if (typeof data === "string") return data;

  if (typeof data === "object") {
    const record = data as Record<string, unknown>;

    if (typeof record.detail === "string") {
      return record.detail;
    }

    for (const key of ["token", "new_password", "password", "detail", "non_field_errors"]) {
      const value = record[key];
      if (typeof value === "string" && value) return value;
      if (Array.isArray(value) && value.length) return String(value[0]);
    }
  }

  return null;
}

function translatePasswordResetError(message?: string | null): string {
  if (!message) {
    return "Nie udało się zmienić hasła.";
  }

  const normalized = message.toLowerCase();

  if (normalized.includes("token") && (normalized.includes("invalid") || normalized.includes("expired"))) {
    return "Link resetu hasła jest nieprawidłowy albo wygasł.";
  }

  if (normalized.includes("this field may not be blank") || normalized.includes("this field is required")) {
    return "Uzupełnij wymagane pola.";
  }

  if (normalized.includes("password is too common")) {
    return "Hasło jest zbyt popularne.";
  }

  if (normalized.includes("password is entirely numeric")) {
    return "Hasło nie może składać się wyłącznie z cyfr.";
  }

  if (normalized.includes("password is too short")) {
    return "Hasło jest zbyt krótkie.";
  }

  if (normalized.includes("password is too similar")) {
    return "Hasło jest zbyt podobne do danych konta.";
  }

  if (
    normalized.includes("hasło jest zbyt podobne do adresu e-mail") ||
    normalized.includes("hasło nie może być takie samo") ||
    normalized.includes("password_matches_email")
  ) {
    return "Hasło jest zbyt podobne do adresu e-mail.";
  }

  if (
    normalized.includes("małą literę") ||
    normalized.includes("mala litere") ||
    normalized.includes("password_missing_lowercase")
  ) {
    return "Hasło musi zawierać co najmniej jedną małą literę.";
  }

  if (
    normalized.includes("dużą literę") ||
    normalized.includes("duza litere") ||
    normalized.includes("password_missing_uppercase")
  ) {
    return "Hasło musi zawierać co najmniej jedną dużą literę.";
  }

  if (
    normalized.includes("cyfrę albo znak specjalny") ||
    normalized.includes("cyfre albo znak specjalny") ||
    normalized.includes("password_missing_digit_or_special")
  ) {
    return "Hasło musi zawierać co najmniej jedną cyfrę albo znak specjalny.";
  }

  return message;
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
    if (!password) return "Hasło jest wymagane.";

    const passwordRuleError = firstPasswordRuleError(password);
    if (passwordRuleError) {
      return passwordRuleError;
    }

    if (!confirmPassword) return "Powtórzenie hasła jest wymagane.";
    if (password !== confirmPassword) return "Hasła nie są identyczne.";

    return null;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!token) {
      setError("Brak tokenu resetu hasła.");
      return;
    }

    const validationError = validate();
    if (validationError) {
      setError(validationError);
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
        setError(translatePasswordResetError(pickFirstError(data)));
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

  const passwordRules = getPasswordRules(password);

  if (!token) {
    return (
      <div className="mx-auto max-w-md py-8 sm:py-10">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
        >
          <Card className="p-6 sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="mt-1 text-2xl font-semibold text-white">Brak tokenu</h1>
                <p className="mt-2 break-words text-sm leading-relaxed text-slate-300">
                  Link do resetu hasła jest nieprawidłowy albo wygasł. Wygeneruj nowy link resetu.
                </p>
              </div>

              <div className="hidden h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.06] sm:grid">
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
                className="self-center text-sm text-slate-300 underline underline-offset-4 transition hover:text-white"
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
    <div className="mx-auto max-w-2xl py-8 sm:py-10">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
      >
        <Card className="p-6 sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="mt-1 text-2xl font-semibold text-white">Ustaw nowe hasło</h1>
              <p className="mt-2 break-words text-sm leading-relaxed text-slate-300">
                Wprowadź nowe hasło zgodne z wymaganiami i potwierdź je. Po zapisaniu nastąpi przekierowanie do logowania.
              </p>
            </div>

            <div className="hidden h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.06] sm:grid">
              <KeyRound className="h-5 w-5 text-white/90" />
            </div>
          </div>

          {error || success ? (
            <div className="mt-4 space-y-2">
              {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}
              {success ? <InlineAlert variant="success">{success}</InlineAlert> : null}
            </div>
          ) : null}

          <form onSubmit={submit} noValidate className="mt-5 space-y-4">
            <div className="md:grid md:grid-cols-[minmax(0,1fr)_minmax(220px,0.9fr)] md:gap-4">
              <div className="space-y-4">
                <div>
                  <label htmlFor="reset_pw_1" className="text-sm font-medium text-slate-200">
                    Nowe hasło
                  </label>
                  <div className="relative mt-2">
                    <Lock
                      className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                      aria-hidden="true"
                    />
                    <Input
                      id="reset_pw_1"
                      type={showPw ? "text" : "password"}
                      className={inputBase}
                      value={password}
                      required
                      disabled={loading}
                      autoComplete="new-password"
                      placeholder="••••••••"
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowPw((v) => !v)}
                      className={cn(
                        "absolute right-2 top-1/2 h-8 min-h-0 -translate-y-1/2 rounded-xl p-2",
                        "text-slate-300 hover:bg-white/5 hover:text-white"
                      )}
                      aria-label={showPw ? "Ukryj hasło" : "Pokaż hasło"}
                    >
                      {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>

                <div>
                  <label htmlFor="reset_pw_2" className="text-sm font-medium text-slate-200">
                    Powtórz hasło
                  </label>
                  <div className="relative mt-2">
                    <Lock
                      className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                      aria-hidden="true"
                    />
                    <Input
                      id="reset_pw_2"
                      type={showPw2 ? "text" : "password"}
                      className={inputBase}
                      value={confirmPassword}
                      required
                      disabled={loading}
                      autoComplete="new-password"
                      placeholder="••••••••"
                      onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowPw2((v) => !v)}
                      className={cn(
                        "absolute right-2 top-1/2 h-8 min-h-0 -translate-y-1/2 rounded-xl p-2",
                        "text-slate-300 hover:bg-white/5 hover:text-white"
                      )}
                      aria-label={showPw2 ? "Ukryj powtórzone hasło" : "Pokaż powtórzone hasło"}
                    >
                      {showPw2 ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 md:mt-0">
                <div className="text-xs font-medium text-slate-300">Wymagania hasła</div>
                <div className="mt-2 space-y-1.5">
                  {passwordRules.map((rule) => (
                    <div
                      key={rule.id}
                      className={cn("flex items-center gap-2 text-xs", rule.valid ? "text-emerald-300" : "text-slate-400")}
                    >
                      {rule.valid ? (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      )}
                      <span>{rule.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="pt-2">
              <Button
                type="submit"
                variant="secondary"
                className="w-full justify-center"
                disabled={loading}
                leftIcon={loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                rightIcon={!loading ? <ArrowRight className="h-4 w-4" /> : null}
              >
                {loading ? "Zapisywanie..." : "Zmień hasło"}
              </Button>
            </div>
          </form>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm">
            <Link to="/login" className="text-slate-300 underline underline-offset-4 transition hover:text-white">
              Wróć do logowania
            </Link>
            <Link to="/forgot-password" className="text-slate-300 underline underline-offset-4 transition hover:text-white">
              Wygeneruj nowy link
            </Link>
          </div>
        </Card>
      </motion.div>
    </div>
  );
}
