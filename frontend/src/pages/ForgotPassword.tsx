import React, { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Mail, ArrowRight, Loader2, ShieldCheck } from "lucide-react";

import { apiFetch } from "../api";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { cn } from "../lib/cn";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const res = await apiFetch("/api/auth/password-reset/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        throw new Error("Nie udało się wysłać żądania resetu hasła.");
      }

      // zawsze ten sam komunikat (bezpieczne)
      setMessage(
        "Jeśli konto istnieje, na podany adres e-mail wysłano link do resetu hasła."
      );
      setEmail("");
    } catch (e: any) {
      setError(e?.message || "Błąd połączenia z serwerem.");
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
              <div className="text-sm text-slate-300">Bezpieczny reset</div>
              <h1 className="mt-1 text-2xl font-semibold text-white">
                Reset hasła
              </h1>
              <p className="mt-2 text-sm text-slate-300 leading-relaxed">
                Podaj adres e-mail powiązany z kontem. Jeśli konto istnieje,
                wyślemy wiadomość z linkiem do ustawienia nowego hasła.
              </p>
            </div>

            <div className="hidden sm:grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.06]">
              <ShieldCheck className="h-5 w-5 text-white/90" />
            </div>
          </div>

          {/* Alerts */}
          {(message || error) && (
            <div className="mt-4 space-y-2">
              {message && (
                <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
                  {message}
                </div>
              )}
              {error && (
                <div className="rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {error}
                </div>
              )}
            </div>
          )}

          {/* Form */}
          <form onSubmit={submit} className="mt-5 space-y-4">
            <div>
              <label className="text-sm font-medium text-slate-200">
                E-mail
              </label>
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

            <Button
              variant="secondary"
              className="w-full justify-center"
              disabled={loading}
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Wysyłanie…
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  Wyślij link resetu
                  <ArrowRight className="h-4 w-4" />
                </span>
              )}
            </Button>
          </form>

          {/* Footer links */}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm">
            <Link
              to="/login"
              className="text-slate-300 hover:text-white transition underline underline-offset-4"
            >
              Wróć do logowania
            </Link>

            <Link
              to="/login?mode=register"
              className="text-slate-300 hover:text-white transition underline underline-offset-4"
            >
              Załóż konto
            </Link>
          </div>

          <div className="mt-6 text-xs text-slate-400">
            Dla bezpieczeństwa zawsze pokazujemy ten sam komunikat, niezależnie od
            tego czy konto istnieje.
          </div>
        </Card>
      </motion.div>
    </div>
  );
}
