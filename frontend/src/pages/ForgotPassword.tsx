// frontend/src/pages/ForgotPassword.tsx
// Komponent obsługuje rozpoczęcie procesu resetowania hasła za pomocą adresu e-mail.

import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Loader2, Mail, ShieldCheck } from "lucide-react";

import { apiFetch } from "../api";
import { cn } from "../lib/cn";

import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { InlineAlert } from "../ui/InlineAlert";
import { Input } from "../ui/Input";

const SAFE_MSG = "Jeśli konto istnieje, na podany adres e-mail wysłano link do resetu hasła.";

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const normalizedEmail = email.trim().toLowerCase();

    setError(null);
    setMessage(null);

    if (!normalizedEmail) {
      setError("Adres e-mail jest wymagany.");
      return;
    }

    if (!isValidEmail(normalizedEmail)) {
      setError("Nieprawidłowy adres e-mail.");
      return;
    }

    setLoading(true);

    try {
      const res = await apiFetch("/api/auth/password-reset/", {
        method: "POST",
        body: JSON.stringify({ email: normalizedEmail }),
        toastOnError: false,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const detail =
          typeof data?.detail === "string" && data.detail.trim()
            ? data.detail
            : "Nie udało się wysłać linku resetu hasła.";

        setError(detail);
        return;
      }

      setMessage(SAFE_MSG);
      setEmail("");
    } catch {
      setError("Brak połączenia z serwerem. Spróbuj ponownie.");
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
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="mt-1 text-2xl font-semibold text-white">Reset hasła</h1>
              <p className="mt-2 break-words text-sm leading-relaxed text-slate-300">
                Podaj adres e-mail powiązany z kontem. Jeśli konto istnieje, zostanie wysłana
                wiadomość z linkiem do ustawienia nowego hasła.
              </p>
            </div>

            <div className="hidden h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.06] sm:grid">
              <ShieldCheck className="h-5 w-5 text-white/90" />
            </div>
          </div>

          {message || error ? (
            <div className="mt-4 space-y-2">
              {message ? <InlineAlert variant="success">{message}</InlineAlert> : null}
              {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}
            </div>
          ) : null}

          <form onSubmit={submit} noValidate className="mt-5 space-y-4">
            <div>
              <label htmlFor="forgot_email" className="text-sm font-medium text-slate-200">
                Adres e-mail
              </label>
              <div className="relative mt-2">
                <Mail
                  className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <Input
                  id="forgot_email"
                  type="email"
                  inputMode="email"
                  className={cn(
                    "rounded-2xl bg-white/[0.04] py-2.5 pl-10 pr-3",
                    "text-white placeholder:text-slate-500"
                  )}
                  value={email}
                  autoComplete="email"
                  placeholder="np. jan.kowalski@example.com"
                  disabled={loading}
                  aria-invalid={Boolean(error)}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            <Button
              type="submit"
              variant="secondary"
              className="w-full justify-center"
              disabled={loading}
              leftIcon={loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              rightIcon={!loading ? <ArrowRight className="h-4 w-4" /> : null}
            >
              {loading ? "Wysyłanie..." : "Wyślij link resetu hasła"}
            </Button>
          </form>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm">
            <Link
              to="/login"
              className="text-slate-300 underline underline-offset-4 transition hover:text-white"
            >
              Wróć do logowania
            </Link>

            <Link
              to="/login?mode=register"
              className="text-slate-300 underline underline-offset-4 transition hover:text-white"
            >
              Załóż konto
            </Link>
          </div>
        </Card>
      </motion.div>
    </div>
  );
}