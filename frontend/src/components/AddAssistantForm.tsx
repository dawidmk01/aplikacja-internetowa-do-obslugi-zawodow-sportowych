import type { FormEvent } from "react";
import { useCallback, useMemo, useState } from "react";

import { addAssistant } from "../api";

import { Button } from "../ui/Button";
import { InlineAlert } from "../ui/InlineAlert";
import { Input } from "../ui/Input";

type Props = {
  tournamentId: number;
  onAdded?: () => void;
};

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export default function AddAssistantForm({ tournamentId, onAdded }: Props) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const normalized = useMemo(() => normalizeEmail(email), [email]);

  const submit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();

      setLoading(true);
      setError(null);
      setSuccess(null);

      try {
        const nextEmail = normalizeEmail(email);
        if (!nextEmail) {
          setError("Podaj adres email.");
          return;
        }

        await addAssistant(tournamentId, nextEmail);

        setSuccess("Asystent został dodany.");
        setEmail("");
        onAdded?.();
      } catch (err: any) {
        const msg =
          typeof err?.message === "string" && err.message.trim() ? err.message : "Błąd połączenia z serwerem.";
        setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [email, onAdded, tournamentId]
  );

  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-semibold text-white">Dodaj asystenta</div>
        <div className="mt-1 text-xs text-slate-300">Wpisz email użytkownika, który ma otrzymać dostęp do panelu.</div>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label className="block">
            <span className="sr-only">Adres email użytkownika</span>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email użytkownika"
              autoComplete="email"
              disabled={loading}
              aria-label="Adres email użytkownika"
            />
          </label>

          {normalized && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? (
            <div className="mt-1 text-xs text-amber-200">To nie wygląda jak poprawny adres email.</div>
          ) : null}
        </div>

        <Button type="submit" disabled={loading} variant="secondary" className="h-10 rounded-2xl px-4">
          {loading ? "Dodawanie..." : "Dodaj"}
        </Button>
      </form>

      {success ? <InlineAlert variant="success">{success}</InlineAlert> : null}
      {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}
    </div>
  );
}