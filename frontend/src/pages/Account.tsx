// frontend/src/pages/Account.tsx
// Plik prezentuje ustawienia konta użytkownika oraz obsługuje operacje bezpieczeństwa i historię logowań.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Laptop, LogOut, MailCheck, RefreshCw, Shield, UserRound } from "lucide-react";

import { apiFetch, clearTokens } from "../api";
import { cn } from "../lib/cn";

import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { InlineAlert } from "../ui/InlineAlert";
import { Input } from "../ui/Input";
import { toast } from "../ui/Toast";

type MeDTO = {
  id?: number;
  username?: string | null;
  email?: string | null;
  email_verified?: boolean | null;
  created_at?: string | null;
};

type LoginEventDTO = {
  id: number;
  created_at: string;
  success: boolean;
  ip_masked?: string | null;
  device_label?: string | null;
  user_agent?: string | null;
  failure_reason?: string | null;
};

type FormMessage = {
  variant: "info" | "success" | "error";
  title?: string;
  text: string;
};

type FormState = {
  pending: boolean;
  message?: FormMessage;
};

function mapApiErrorToText(e: unknown) {
  if (!e) return "Wystąpił nieoczekiwany błąd.";
  if (typeof e === "string") return e;
  return "Nie udało się wykonać operacji.";
}

function formatDate(value?: string | null) {
  if (!value) return "Brak danych";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Brak danych";

  return new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function Account() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [me, setMe] = useState<MeDTO | null>(null);
  const [loading, setLoading] = useState(true);

  const [loginEvents, setLoginEvents] = useState<LoginEventDTO[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  const [usernameForm, setUsernameForm] = useState({ newUsername: "", currentPassword: "" });
  const [emailForm, setEmailForm] = useState({ newEmail: "", currentPassword: "" });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "" });

  const [usernameState, setUsernameState] = useState<FormState>({ pending: false });
  const [emailState, setEmailState] = useState<FormState>({ pending: false });
  const [passwordState, setPasswordState] = useState<FormState>({ pending: false });

  const [securityMessage, setSecurityMessage] = useState<FormMessage | undefined>(undefined);
  const [logoutOthersPending, setLogoutOthersPending] = useState(false);
  const [logoutAllPending, setLogoutAllPending] = useState(false);

  const [confirmMessage, setConfirmMessage] = useState<FormMessage | undefined>(undefined);

  const processedConfirmKeyRef = useRef<string | null>(null);

  const token = searchParams.get("token");
  const confirmType = searchParams.get("type");

  const accountSummary = useMemo(() => {
    const username = me?.username ?? "";
    const email = me?.email ?? "";

    const emailVerified =
      me?.email_verified === null || typeof me?.email_verified === "undefined"
        ? null
        : Boolean(me.email_verified);

    return {
      username,
      email,
      emailVerified,
      createdAt: me?.created_at ?? null,
    };
  }, [me]);

  const loadMe = useCallback(async () => {
    setLoading(true);

    try {
      const res = await apiFetch("/api/auth/me/", { method: "GET", toastOnError: false });

      if (!res.ok) {
        setMe(null);
        return;
      }

      const data = (await res.json().catch(() => null)) as MeDTO | null;
      setMe(data);
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLoginEvents = useCallback(async () => {
    setEventsLoading(true);

    try {
      const res = await apiFetch("/api/auth/login-events/?limit=20", {
        method: "GET",
        toastOnError: false,
      });

      if (!res.ok) {
        setLoginEvents([]);
        return;
      }

      const data = (await res.json().catch(() => null)) as { results?: LoginEventDTO[] } | null;
      setLoginEvents(Array.isArray(data?.results) ? data.results : []);
    } catch {
      setLoginEvents([]);
    } finally {
      setEventsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMe();
    void loadLoginEvents();
  }, [loadLoginEvents, loadMe]);

  useEffect(() => {
    if (!token || !confirmType) return;

    const confirmKey = `${confirmType}:${token}`;
    if (processedConfirmKeyRef.current === confirmKey) return;
    processedConfirmKeyRef.current = confirmKey;

    const capturedToken = token;
    const capturedType = confirmType;

    if (window.location.search) {
      window.history.replaceState({}, "", "/account");
    }

    const confirmChange = async () => {
      setConfirmMessage({
        variant: "info",
        text: "Trwa potwierdzanie operacji...",
      });

      const endpoint =
        capturedType === "email"
          ? "/api/auth/confirm-email-change/"
          : capturedType === "username"
            ? "/api/auth/confirm-username-change/"
            : null;

      if (!endpoint) {
        setConfirmMessage({
          variant: "error",
          text: "Typ operacji jest nieprawidłowy.",
        });
        return;
      }

      try {
        const res = await apiFetch(endpoint, {
          method: "POST",
          toastOnError: false,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: capturedToken }),
        });

        const data = (await res.json().catch(() => null)) as { detail?: string } | null;

        if (!res.ok) {
          setConfirmMessage({
            variant: "error",
            text: data?.detail || "Nie udało się potwierdzić operacji.",
          });
          return;
        }

        await Promise.all([loadMe(), loadLoginEvents()]);

        const successText =
          capturedType === "username"
            ? "Login został potwierdzony i zaktualizowany."
            : capturedType === "email"
              ? "Adres e-mail został potwierdzony i zaktualizowany."
              : data?.detail || "Operacja została potwierdzona.";

        setConfirmMessage({
          variant: "success",
          text: successText,
        });
      } catch (err) {
        setConfirmMessage({
          variant: "error",
          text: mapApiErrorToText(err),
        });
      }
    };

    void confirmChange();
  }, [confirmType, loadLoginEvents, loadMe, token]);

  const requestUsernameChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setUsernameState({ pending: true });

    try {
      const res = await apiFetch("/api/auth/change-username/", {
        method: "POST",
        toastOnError: false,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          new_username: usernameForm.newUsername.trim(),
          current_password: usernameForm.currentPassword,
        }),
      });

      const data = (await res.json().catch(() => null)) as { detail?: string } | null;

      if (!res.ok) {
        setUsernameState({
          pending: false,
          message: {
            variant: "error",
            text: data?.detail || "Nie udało się zainicjować zmiany loginu.",
          },
        });
        return;
      }

      setUsernameState({
        pending: false,
        message: {
          variant: "success",
          text: data?.detail || "Wysłano wiadomość potwierdzającą zmianę loginu.",
        },
      });

      setUsernameForm({ newUsername: "", currentPassword: "" });
    } catch (err) {
      setUsernameState({
        pending: false,
        message: { variant: "error", text: mapApiErrorToText(err) },
      });
    }
  };

  const requestEmailChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailState({ pending: true });

    try {
      const res = await apiFetch("/api/auth/change-email/", {
        method: "POST",
        toastOnError: false,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          new_email: emailForm.newEmail.trim(),
          current_password: emailForm.currentPassword,
        }),
      });

      const data = (await res.json().catch(() => null)) as { detail?: string } | null;

      if (!res.ok) {
        setEmailState({
          pending: false,
          message: {
            variant: "error",
            text: data?.detail || "Nie udało się zainicjować zmiany adresu e-mail.",
          },
        });
        return;
      }

      setEmailState({
        pending: false,
        message: {
          variant: "success",
          text: data?.detail || "Wysłano wiadomość potwierdzającą zmianę adresu e-mail.",
        },
      });

      setEmailForm({ newEmail: "", currentPassword: "" });
    } catch (err) {
      setEmailState({
        pending: false,
        message: { variant: "error", text: mapApiErrorToText(err) },
      });
    }
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordState({ pending: true });

    try {
      const res = await apiFetch("/api/auth/change-password/", {
        method: "POST",
        toastOnError: false,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_password: passwordForm.currentPassword,
          new_password: passwordForm.newPassword,
        }),
      });

      const data = (await res.json().catch(() => null)) as { detail?: string } | null;

      if (!res.ok) {
        setPasswordState({
          pending: false,
          message: {
            variant: "error",
            text: data?.detail || "Nie udało się zmienić hasła.",
          },
        });
        return;
      }

      setPasswordState({
        pending: false,
        message: {
          variant: "success",
          text: data?.detail || "Hasło zostało zmienione.",
        },
      });

      clearTokens();
      navigate("/login", { replace: true });
    } catch (err) {
      setPasswordState({
        pending: false,
        message: { variant: "error", text: mapApiErrorToText(err) },
      });
    }
  };

  const logoutOthers = async () => {
    setLogoutOthersPending(true);
    setSecurityMessage(undefined);

    try {
      const res = await apiFetch("/api/auth/logout-others/", {
        method: "POST",
        toastOnError: false,
      });

      const data = (await res.json().catch(() => null)) as { detail?: string } | null;

      if (!res.ok) {
        setSecurityMessage({
          variant: "error",
          text: data?.detail || "Nie udało się wylogować z pozostałych urządzeń.",
        });
        return;
      }

      setSecurityMessage({
        variant: "success",
        text: data?.detail || "Wylogowano z pozostałych urządzeń.",
      });
    } catch (err) {
      setSecurityMessage({
        variant: "error",
        text: mapApiErrorToText(err),
      });
    } finally {
      setLogoutOthersPending(false);
    }
  };

  const logoutAll = async () => {
    setLogoutAllPending(true);
    setSecurityMessage(undefined);

    try {
      const res = await apiFetch("/api/auth/logout-all/", {
        method: "POST",
        toastOnError: false,
      });

      const data = (await res.json().catch(() => null)) as { detail?: string } | null;

      if (!res.ok) {
        setSecurityMessage({
          variant: "error",
          text: data?.detail || "Nie udało się wylogować ze wszystkich urządzeń.",
        });
        return;
      }

      clearTokens();
      navigate("/login", { replace: true });
    } catch (err) {
      setSecurityMessage({
        variant: "error",
        text: mapApiErrorToText(err),
      });
    } finally {
      setLogoutAllPending(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1100px]">
      <div className="mb-6">
        <div className="text-2xl font-bold text-white">Moje konto</div>
        <div className="mt-1 text-sm text-slate-300">
          Zarządzanie danymi konta, sesjami i bezpieczeństwem logowania.
        </div>
      </div>

      {confirmMessage ? (
        <InlineAlert variant={confirmMessage.variant} className="mb-5">
          {confirmMessage.text}
        </InlineAlert>
      ) : null}

      {loading ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-300">
          Ładowanie danych konta...
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-white">Dane konta</div>
                <div className="mt-1 text-sm text-slate-300">Podstawowe informacje o profilu użytkownika.</div>
              </div>

              <Button
                variant="secondary"
                onClick={() => {
                  void loadMe();
                  void loadLoginEvents();
                }}
                leftIcon={<RefreshCw className="h-4 w-4" />}
              >
                Odśwież
              </Button>
            </div>

            <div className="space-y-3">
              <SummaryRow
                icon={<UserRound className="h-4 w-4" />}
                label="Login"
                value={accountSummary.username || "Brak danych"}
              />
              <SummaryRow
                icon={<MailCheck className="h-4 w-4" />}
                label="E-mail"
                value={accountSummary.email || "Brak danych"}
                badge={
                  accountSummary.emailVerified !== null ? (
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium",
                        accountSummary.emailVerified
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                          : "border-amber-500/30 bg-amber-500/10 text-amber-200"
                      )}
                    >
                      {accountSummary.emailVerified ? "Zweryfikowany" : "Niezweryfikowany"}
                    </span>
                  ) : null
                }
              />
              <SummaryRow
                icon={<Shield className="h-4 w-4" />}
                label="Data utworzenia"
                value={formatDate(accountSummary.createdAt)}
              />
            </div>
          </Card>

          <Card className="p-5">
            <div className="mb-3">
              <div className="text-lg font-semibold text-white">Zmiana loginu</div>
              <div className="mt-1 text-sm text-slate-300">
                Podaj nowy login oraz aktualne hasło, aby potwierdzić operację.
              </div>
            </div>

            {usernameState.message ? (
              <InlineAlert variant={usernameState.message.variant} className="mb-3">
                {usernameState.message.text}
              </InlineAlert>
            ) : null}

            <form onSubmit={requestUsernameChange} className="space-y-4">
              <Input
                label="Nowy login"
                value={usernameForm.newUsername}
                onChange={(e) => setUsernameForm((s) => ({ ...s, newUsername: e.target.value }))}
                autoComplete="username"
                placeholder="Wpisz nowy login"
                disabled={usernameState.pending}
              />

              <Input
                label="Aktualne hasło"
                type="password"
                value={usernameForm.currentPassword}
                onChange={(e) => setUsernameForm((s) => ({ ...s, currentPassword: e.target.value }))}
                autoComplete="current-password"
                placeholder="Wpisz aktualne hasło"
                disabled={usernameState.pending}
              />

              <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
                Zmiana loginu wymaga potwierdzenia przez wiadomość wysłaną na obecny adres e-mail.
              </div>

              <div className="flex justify-end">
                <Button
                  type="submit"
                  variant="primary"
                  disabled={!usernameForm.newUsername.trim() || !usernameForm.currentPassword || usernameState.pending}
                >
                  {usernameState.pending ? "Wysyłanie..." : "Wyślij potwierdzenie"}
                </Button>
              </div>
            </form>
          </Card>

          <Card className="p-5">
            <div className="mb-3">
              <div className="text-lg font-semibold text-white">Zmiana e-mail</div>
              <div className="mt-1 text-sm text-slate-300">
                Podaj nowy adres e-mail oraz aktualne hasło, aby potwierdzić operację.
              </div>
            </div>

            {emailState.message ? (
              <InlineAlert variant={emailState.message.variant} className="mb-3">
                {emailState.message.text}
              </InlineAlert>
            ) : null}

            <form onSubmit={requestEmailChange} className="space-y-4">
              <Input
                label="Nowy adres e-mail"
                value={emailForm.newEmail}
                onChange={(e) => setEmailForm((s) => ({ ...s, newEmail: e.target.value }))}
                autoComplete="email"
                placeholder="Wpisz nowy adres e-mail"
                disabled={emailState.pending}
              />

              <Input
                label="Aktualne hasło"
                type="password"
                value={emailForm.currentPassword}
                onChange={(e) => setEmailForm((s) => ({ ...s, currentPassword: e.target.value }))}
                autoComplete="current-password"
                placeholder="Wpisz aktualne hasło"
                disabled={emailState.pending}
              />

              <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
                Zmiana adresu e-mail wymaga potwierdzenia przez wiadomość wysłaną na obecny adres e-mail.
              </div>

              <div className="flex justify-end">
                <Button
                  type="submit"
                  variant="primary"
                  disabled={!emailForm.newEmail.trim() || !emailForm.currentPassword || emailState.pending}
                >
                  {emailState.pending ? "Wysyłanie..." : "Wyślij potwierdzenie"}
                </Button>
              </div>
            </form>
          </Card>

          <Card className="p-5">
            <div className="mb-3">
              <div className="text-lg font-semibold text-white">Zmiana hasła</div>
              <div className="mt-1 text-sm text-slate-300">
                Podaj aktualne hasło i nowe hasło. Po zmianie wszystkie zapisane sesje zostaną unieważnione.
              </div>
            </div>

            {passwordState.message ? (
              <InlineAlert variant={passwordState.message.variant} className="mb-3">
                {passwordState.message.text}
              </InlineAlert>
            ) : null}

            <form onSubmit={changePassword} className="space-y-4">
              <Input
                label="Aktualne hasło"
                type="password"
                value={passwordForm.currentPassword}
                onChange={(e) => setPasswordForm((s) => ({ ...s, currentPassword: e.target.value }))}
                autoComplete="current-password"
                placeholder="Wpisz aktualne hasło"
                disabled={passwordState.pending}
              />

              <Input
                label="Nowe hasło"
                type="password"
                value={passwordForm.newPassword}
                onChange={(e) => setPasswordForm((s) => ({ ...s, newPassword: e.target.value }))}
                autoComplete="new-password"
                placeholder="Wpisz nowe hasło"
                disabled={passwordState.pending}
              />

              <div className="flex justify-end">
                <Button
                  type="submit"
                  variant="primary"
                  disabled={!passwordForm.currentPassword || !passwordForm.newPassword || passwordState.pending}
                >
                  {passwordState.pending ? "Zapisywanie..." : "Zmień hasło"}
                </Button>
              </div>
            </form>
          </Card>

          <Card className="p-5 lg:col-span-2">
            <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="text-lg font-semibold text-white">Sesje i historia logowań</div>
                <div className="mt-1 text-sm text-slate-300">
                  Sekcja pozwala przejrzeć ostatnie logowania oraz unieważnić pozostałe sesje.
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={logoutOthers}
                  disabled={logoutOthersPending || logoutAllPending}
                  leftIcon={<LogOut className="h-4 w-4" />}
                >
                  {logoutOthersPending ? "Trwa wylogowywanie..." : "Wyloguj z innych urządzeń"}
                </Button>

                <Button
                  variant="danger"
                  onClick={logoutAll}
                  disabled={logoutOthersPending || logoutAllPending}
                  leftIcon={<LogOut className="h-4 w-4" />}
                >
                  {logoutAllPending ? "Trwa wylogowywanie..." : "Wyloguj ze wszystkich urządzeń"}
                </Button>
              </div>
            </div>

            {securityMessage ? (
              <InlineAlert variant={securityMessage.variant} className="mb-3">
                {securityMessage.text}
              </InlineAlert>
            ) : null}

            {eventsLoading ? (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
                Ładowanie historii logowań...
              </div>
            ) : loginEvents.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
                Brak danych do wyświetlenia.
              </div>
            ) : (
              <div className="space-y-3">
                {loginEvents.map((event) => (
                  <div
                    key={event.id}
                    className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3"
                  >
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Laptop className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                          <span className="text-sm font-semibold text-white">
                            {event.device_label || "Nieznane urządzenie"}
                          </span>
                          <span
                            className={cn(
                              "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                              event.success
                                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                                : "border-rose-500/30 bg-rose-500/10 text-rose-200"
                            )}
                          >
                            {event.success ? "Udane logowanie" : "Nieudana próba"}
                          </span>
                        </div>

                        <div className="mt-2 text-sm text-slate-300">
                          Data: <span className="text-slate-100">{formatDate(event.created_at)}</span>
                        </div>

                        <div className="mt-1 text-sm text-slate-300">
                          IP: <span className="text-slate-100">{event.ip_masked || "Brak danych"}</span>
                        </div>

                        {!event.success && event.failure_reason ? (
                          <div className="mt-1 text-sm text-slate-300">
                            Powód: <span className="text-slate-100">{event.failure_reason}</span>
                          </div>
                        ) : null}
                      </div>

                      <div className="max-w-full text-xs leading-5 text-slate-400 md:max-w-[45%]">
                        {event.user_agent || "Brak nagłówka user-agent"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function SummaryRow({
  icon,
  label,
  value,
  badge,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  badge?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-400">
            <span className="text-slate-500">{icon}</span>
            <span>{label}</span>
          </div>
          <div className="mt-1 break-words text-base font-semibold text-white">{value}</div>
        </div>

        {badge ? <div className="shrink-0">{badge}</div> : null}
      </div>
    </div>
  );
}