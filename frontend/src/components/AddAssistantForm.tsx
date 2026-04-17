// frontend/src/components/AddAssistantForm.tsx
// Komponent obsługuje dodawanie zaproszeń asystenta wraz z wstępnym zestawem uprawnień.

import type { FormEvent } from "react";
import { useCallback, useMemo, useState } from "react";

import { addAssistant, type AssistantInvitePermissions } from "../api";

import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { InlineAlert } from "../ui/InlineAlert";
import { Input } from "../ui/Input";

type Props = {
  tournamentId: number;
  onAdded?: () => void;
};

const DEFAULT_PERMISSIONS: Required<AssistantInvitePermissions> = {
  teams_edit: true,
  roster_edit: true,
  schedule_edit: true,
  results_edit: true,
  bracket_edit: true,
  tournament_edit: true,
  name_change_approve: true,
};

const PERMISSION_OPTIONS: Array<{ key: keyof Required<AssistantInvitePermissions>; label: string }> = [
  { key: "teams_edit", label: "Edycja drużyn" },
  { key: "roster_edit", label: "Składy: zawodnicy" },
  { key: "schedule_edit", label: "Edycja harmonogramu" },
  { key: "results_edit", label: "Wprowadzanie wyników" },
  { key: "bracket_edit", label: "Edycja drabinki" },
  { key: "tournament_edit", label: "Edycja ustawień turnieju" },
  { key: "name_change_approve", label: "Akceptacja zmian nazw" },
];

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export default function AddAssistantForm({ tournamentId, onAdded }: Props) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [permissions, setPermissions] = useState<Required<AssistantInvitePermissions>>(DEFAULT_PERMISSIONS);

  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const normalized = useMemo(() => normalizeEmail(email), [email]);
  const selectedCount = useMemo(
    () => Object.values(permissions).filter(Boolean).length,
    [permissions]
  );

  const updatePermission = useCallback(
    (key: keyof Required<AssistantInvitePermissions>, value: boolean) => {
      setPermissions((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

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

        const message = await addAssistant(tournamentId, nextEmail, permissions);
        setSuccess(message);
        setEmail("");
        onAdded?.();
      } catch (err: any) {
        const msg = typeof err?.message === "string" && err.message.trim() ? err.message : "Błąd połączenia z serwerem.";
        setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [email, onAdded, permissions, tournamentId]
  );

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-semibold text-white">Dodaj asystenta</div>
        <div className="mt-1 text-xs text-slate-300">
          Wpisz email użytkownika i wybierz uprawnienia, które zostaną aktywowane po akceptacji zaproszenia.
        </div>
      </div>

      <form onSubmit={submit} className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
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
            {loading ? "Zapisywanie..." : "Dodaj"}
          </Button>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-xs font-semibold text-slate-200">Uprawnienia po akceptacji</div>
            <div className="text-[11px] text-slate-300/80">Wybrane: {selectedCount}/{PERMISSION_OPTIONS.length}</div>
          </div>

          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {PERMISSION_OPTIONS.map((permission) => (
              <div key={permission.key} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <Checkbox
                  checked={Boolean(permissions[permission.key])}
                  onCheckedChange={(value) => updatePermission(permission.key, Boolean(value))}
                  label={permission.label}
                  disabled={loading}
                  className="w-full"
                />
              </div>
            ))}
          </div>
        </div>
      </form>

      {success ? <InlineAlert variant="success">{success}</InlineAlert> : null}
      {error ? <InlineAlert variant="error">{error}</InlineAlert> : null}
    </div>
  );
}
