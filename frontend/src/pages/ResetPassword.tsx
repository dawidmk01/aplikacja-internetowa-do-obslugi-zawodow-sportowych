import React, { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  KeyRound,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  Loader2,
  AlertTriangle,
} from "lucide-react";

import { apiFetch } from "../api";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { cn } from "../lib/cn";

function pickFirstError(data: any): string | null {
  if (!data) return null;
  if (typeof data === "string") return data;
  if (typeof data?.detail === "string") return data.detail;

  // typowe błędy DRF: { field: ["msg"] }
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          new_password: password,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(
          pickFirstError(data) || "Nie udało się zmienić hasła."
        );
      }

      setSuccess("Hasło zostało zmienione. Możesz się zalogować.");
      setPassword("");
      setConfirmPassword("");

      // krótka chwila na komunikat i przerzut na login
      setTimeout(() => navigate("/login"), 800);
    } catch (e: any) {
      setError(e?.message || "Błąd połączenia z serwerem.");
    } finally {
      setLoading(false);
    }
  };

  // Widok bez tokenu – elegancko
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
              <div>
                <div className="text-sm text-slate-300">Reset hasła</div>
                <h1 className="mt-1 text-2xl font-semibold text-white">
                  Brak tokenu
                </h1>
                <p className="mt-2 text-sm text-slate-300 leading-relaxed">
                  Link do resetu hasła jest nieprawidłowy albo wygasł. Wygeneruj
                  nowy link resetu.
                </p>
              </div>

              <div className="hidden sm:grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.06]">
                <AlertTriangle className="h-5 w-5 text-white/90" />
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <Link to="/forgot-password">
                <Button variant="secondary" rightIcon={<ArrowRight className="h-4 w-4" />}>
                  Wygeneruj nowy link
                </Button>
              </Link>
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
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
      >
        <Card className="p-6 sm:p-7">
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm text-slate-300">Reset hasła</div>
              <h1 className="mt-1 text-2xl font-semibold text-white">
                Ustaw nowe hasło
              </h1>
              <p className="mt-2 text-sm text-slate-300 leading-relaxed">
                Wprowadź nowe hasło i potwierdź je. Po zapisaniu przekierujemy Cię
                do logowania.
              </p>
            </div>

            <div className="hidden sm:grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.06]">
              <KeyRound className="h-5 w-5 text-white/90" />
            </div>
          </div>

          {/* Alerts */}
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

          <form onSubmit={submit} className="mt-5 space-y-4">
            {/* New password */}
            <div>
              <label className="text-sm font-medium text-slate-200">
                Nowe hasło
              </label>
              <div className="mt-2 relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type={showPw ? "text" : "password"}
                  className={cn(
                    "w-full rounded-2xl border border-white/10 bg-white/[0.04] pl-10 pr-10 py-2.5 text-sm text-white",
                    "placeholder:text-slate-500",
                    "focus:outline-none focus:ring-4 focus:ring-white/10 focus:border-white/15"
                  )}
                  value={password}
                  required
                  autoComplete="new-password"
                  placeholder="min. 8 znaków"
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl p-2 text-slate-300 hover:bg-white/5 hover:text-white"
                  aria-label={showPw ? "Ukryj hasło" : "Pokaż hasło"}
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <div className="mt-2 text-xs text-slate-400">
                Zalecenie: użyj dłuższego hasła i unikaj oczywistych fraz.
              </div>
            </div>

            {/* Confirm password */}
            <div>
              <label className="text-sm font-medium text-slate-200">
                Powtórz hasło
              </label>
              <div className="mt-2 relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type={showPw2 ? "text" : "password"}
                  className={cn(
                    "w-full rounded-2xl border border-white/10 bg-white/[0.04] pl-10 pr-10 py-2.5 text-sm text-white",
                    "placeholder:text-slate-500",
                    "focus:outline-none focus:ring-4 focus:ring-white/10 focus:border-white/15"
                  )}
                  value={confirmPassword}
                  required
                  autoComplete="new-password"
                  placeholder="powtórz hasło"
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPw2((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl p-2 text-slate-300 hover:bg-white/5 hover:text-white"
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
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Zapisywanie…
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  Zmień hasło
                  <ArrowRight className="h-4 w-4" />
                </span>
              )}
            </Button>
          </form>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm">
            <Link
              to="/login"
              className="text-slate-300 hover:text-white transition underline underline-offset-4"
            >
              Wróć do logowania
            </Link>
            <Link
              to="/forgot-password"
              className="text-slate-300 hover:text-white transition underline underline-offset-4"
            >
              Wygeneruj nowy link
            </Link>
          </div>
        </Card>
      </motion.div>
    </div>
  );
}
