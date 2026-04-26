// frontend/src/pages/Account.tsx
// Plik prezentuje ustawienia konta użytkownika oraz obsługuje operacje bezpieczeństwa, sesje i historię logowań.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Laptop, LogOut, MailCheck, RefreshCw, Shield } from "lucide-react";

import { apiFetch, clearTokens } from "../api";
import { cn } from "../lib/cn";

import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { InlineAlert } from "../ui/InlineAlert";
import { Input } from "../ui/Input";

type MeDTO = {
  id?: number;
  email?: string | null;
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

type UserSessionDTO = {
  id: number;
  created_at?: string | null;
  last_seen_at?: string | null;
  expires_at?: string | null;
  ip_masked?: string | null;
  device_label?: string | null;
  user_agent?: string | null;
  current?: boolean;
};

type AccountTab = "account" | "sessions" | "history";
type LoginHistoryFilter = "all" | "success" | "failure";

type FormMessage = {
  variant: "info" | "success" | "error";
  text: string;
};

type FormState = {
  pending: boolean;
  message?: FormMessage;
};

const ACCOUNT_TABS: Array<{ key: AccountTab; label: string }> = [
  { key: "account", label: "Konto" },
  { key: "sessions", label: "Aktywne sesje" },
  { key: "history", label: "Historia logowań" },
];

const LOGIN_HISTORY_FILTERS: Array<{ key: LoginHistoryFilter; label: string }> = [
  { key: "all", label: "Wszystkie" },
  { key: "success", label: "Udane" },
  { key: "failure", label: "Nieudane" },
];

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function translateApiMessage(message?: string | null): string {
  if (!message) return "Wystąpił nieoczekiwany błąd.";

  const normalized = message.toLowerCase();

  if (normalized.includes("enter a valid email") || normalized.includes("valid email address")) {
    return "Nieprawidłowy adres e-mail.";
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

  if (normalized.includes("user with this email") || normalized.includes("already exists")) {
    return "Użytkownik z tym adresem e-mail już istnieje.";
  }

  return message;
}

function translateLoginFailureReason(reason?: string | null): string {
  const normalized = String(reason || "").trim().toLowerCase();

  if (!normalized || normalized === "invalid_credentials") {
    return "Nieudana próba logowania.";
  }

  if (normalized === "inactive_user") {
    return "Konto jest nieaktywne.";
  }

  if (normalized === "invalid_token" || normalized === "token_error") {
    return "Sesja jest nieprawidłowa lub wygasła.";
  }

  return "Nieudana próba logowania.";
}

function mapApiErrorToText(e: unknown) {
  if (!e) return "Wystąpił nieoczekiwany błąd.";
  if (typeof e === "string") return translateApiMessage(e);
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

function eventStatusClass(success: boolean): string {
  return success
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
    : "border-rose-500/30 bg-rose-500/10 text-rose-200";
}

export default function Account() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [activeTab, setActiveTab] = useState<AccountTab>("account");
  const [historyFilter, setHistoryFilter] = useState<LoginHistoryFilter>("all");

  const [me, setMe] = useState<MeDTO | null>(null);
  const [loading, setLoading] = useState(true);

  const [sessions, setSessions] = useState<UserSessionDTO[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionActionId, setSessionActionId] = useState<number | null>(null);

  const [loginEvents, setLoginEvents] = useState<LoginEventDTO[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  const [emailForm, setEmailForm] = useState({ newEmail: "", currentPassword: "" });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "" });

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
    return {
      email: me?.email ?? "",
      createdAt: me?.created_at ?? null,
    };
  }, [me]);

  const filteredLoginEvents = useMemo(() => {
    if (historyFilter === "success") {
      return loginEvents.filter((event) => event.success);
    }

    if (historyFilter === "failure") {
      return loginEvents.filter((event) => !event.success);
    }

    return loginEvents;
  }, [historyFilter, loginEvents]);

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

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);

    try {
      const res = await apiFetch("/api/auth/sessions/", {
        method: "GET",
        toastOnError: false,
      });

      if (!res.ok) {
        setSessions([]);
        return;
      }

      const data = (await res.json().catch(() => null)) as { results?: UserSessionDTO[] } | null;
      setSessions(Array.isArray(data?.results) ? data.results : []);
    } catch {
      setSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  const loadLoginEvents = useCallback(async () => {
    setEventsLoading(true);

    try {
      const res = await apiFetch("/api/auth/login-events/?limit=100", {
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

  const refreshAccountData = useCallback(async () => {
    await Promise.all([loadMe(), loadSessions(), loadLoginEvents()]);
  }, [loadLoginEvents, loadMe, loadSessions]);

  useEffect(() => {
    void refreshAccountData();
  }, [refreshAccountData]);

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
      setActiveTab("account");
      setConfirmMessage({
        variant: "info",
        text: "Trwa potwierdzanie operacji...",
      });

      if (capturedType !== "email") {
        setConfirmMessage({
          variant: "error",
          text: "Typ operacji jest nieprawidłowy.",
        });
        return;
      }

      try {
        const res = await apiFetch("/api/auth/confirm-email-change/", {
          method: "POST",
          toastOnError: false,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: capturedToken }),
        });

        const data = (await res.json().catch(() => null)) as { detail?: string } | null;

        if (!res.ok) {
          setConfirmMessage({
            variant: "error",
            text: translateApiMessage(data?.detail || "Nie udało się potwierdzić operacji."),
          });
          return;
        }

        await refreshAccountData();

        setConfirmMessage({
          variant: "success",
          text: data?.detail || "Adres e-mail został potwierdzony i zaktualizowany.",
        });
      } catch (err) {
        setConfirmMessage({
          variant: "error",
          text: mapApiErrorToText(err),
        });
      }
    };

    void confirmChange();
  }, [confirmType, refreshAccountData, token]);

  const requestEmailChange = async (e: FormEvent) => {
    e.preventDefault();
    setEmailState({ pending: true });

    const normalizedEmail = emailForm.newEmail.trim().toLowerCase();

    if (!normalizedEmail) {
      setEmailState({
        pending: false,
        message: { variant: "error", text: "Nowy adres e-mail jest wymagany." },
      });
      return;
    }

    if (!isValidEmail(normalizedEmail)) {
      setEmailState({
        pending: false,
        message: { variant: "error", text: "Nieprawidłowy adres e-mail." },
      });
      return;
    }

    if (!emailForm.currentPassword) {
      setEmailState({
        pending: false,
        message: { variant: "error", text: "Aktualne hasło jest wymagane." },
      });
      return;
    }

    try {
      const res = await apiFetch("/api/auth/change-email/", {
        method: "POST",
        toastOnError: false,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          new_email: normalizedEmail,
          current_password: emailForm.currentPassword,
        }),
      });

      const data = (await res.json().catch(() => null)) as { detail?: string } | null;

      if (!res.ok) {
        setEmailState({
          pending: false,
          message: {
            variant: "error",
            text: translateApiMessage(data?.detail || "Nie udało się zainicjować zmiany adresu e-mail."),
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

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPasswordState({ pending: true });

    if (!passwordForm.currentPassword) {
      setPasswordState({
        pending: false,
        message: { variant: "error", text: "Aktualne hasło jest wymagane." },
      });
      return;
    }

    if (!passwordForm.newPassword) {
      setPasswordState({
        pending: false,
        message: { variant: "error", text: "Nowe hasło jest wymagane." },
      });
      return;
    }

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
            text: translateApiMessage(data?.detail || "Nie udało się zmienić hasła."),
          },
        });
        return;
      }

      clearTokens();
      setPasswordForm({ currentPassword: "", newPassword: "" });
      setPasswordState({
        pending: false,
        message: {
          variant: "success",
          text: data?.detail || "Hasło zostało zmienione. Zaloguj się ponownie.",
        },
      });
      setSessions([]);

      window.setTimeout(() => {
        navigate("/login", { replace: true });
      }, 900);
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
          text: translateApiMessage(data?.detail || "Nie udało się wylogować pozostałych sesji."),
        });
        return;
      }

      setSecurityMessage({
        variant: "success",
        text: data?.detail || "Wylogowano z pozostałych urządzeń.",
      });
      await loadSessions();
    } catch (err) {
      setSecurityMessage({ variant: "error", text: mapApiErrorToText(err) });
    } finally {
      setLogoutOthersPending(false);
    }
  };

  const logoutAll = async () => {
    setLogoutAllPending(true);
    setSecurityMessage(undefined);

    try {
      await apiFetch("/api/auth/logout-all/", {
        method: "POST",
        toastOnError: false,
      });
    } catch {
      // Lokalna sesja i tak zostaje wyczyszczona, aby nie zostawić użytkownika w niespójnym stanie.
    } finally {
      clearTokens();
      setLogoutAllPending(false);
      navigate("/login", { replace: true });
    }
  };

  const removeSession = async (session: UserSessionDTO) => {
    setSessionActionId(session.id);
    setSecurityMessage(undefined);

    try {
      const res = await apiFetch(`/api/auth/sessions/${session.id}/`, {
        method: "DELETE",
        toastOnError: false,
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { detail?: string } | null;
        setSecurityMessage({
          variant: "error",
          text: translateApiMessage(data?.detail || "Nie udało się wylogować wybranej sesji."),
        });
        return;
      }

      setSecurityMessage({
        variant: "success",
        text: "Wybrana sesja została wylogowana.",
      });
      await loadSessions();
    } catch (err) {
      setSecurityMessage({ variant: "error", text: mapApiErrorToText(err) });
    } finally {
      setSessionActionId(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1100px]">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-2xl font-bold text-white">Moje konto</div>
          <div className="mt-1 text-sm text-slate-300">
            Zarządzanie adresem e-mail, aktywnymi sesjami i historią logowań.
          </div>
        </div>

        <Button
          variant="secondary"
          onClick={() => void refreshAccountData()}
          disabled={loading || sessionsLoading || eventsLoading}
          leftIcon={<RefreshCw className="h-4 w-4" />}
        >
          Odśwież dane
        </Button>
      </div>

      {confirmMessage ? (
        <InlineAlert variant={confirmMessage.variant} className="mb-5">
          {confirmMessage.text}
        </InlineAlert>
      ) : null}

      <div className="mb-5 flex flex-wrap gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-1.5">
        {ACCOUNT_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "rounded-xl px-4 py-2 text-sm font-medium transition",
              activeTab === tab.key
                ? "bg-white/10 text-white shadow-[0_1px_0_rgba(255,255,255,0.06)_inset]"
                : "text-slate-300 hover:bg-white/[0.06] hover:text-white"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-300">
          Ładowanie danych konta...
        </div>
      ) : null}

      {!loading && activeTab === "account" ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card className="p-5 lg:col-span-2">
            <div className="mb-3">
              <div className="text-lg font-semibold text-white">Dane konta</div>
              <div className="mt-1 text-sm text-slate-300">
                Konto jest identyfikowane wyłącznie przez adres e-mail.
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <SummaryRow
                icon={<MailCheck className="h-4 w-4" />}
                label="Adres e-mail"
                value={accountSummary.email || "Brak danych"}
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
              <div className="text-lg font-semibold text-white">Zmiana adresu e-mail</div>
              <div className="mt-1 text-sm text-slate-300">
                Podaj nowy adres e-mail oraz aktualne hasło, aby potwierdzić operację.
              </div>
            </div>

            {emailState.message ? (
              <InlineAlert variant={emailState.message.variant} className="mb-3">
                {emailState.message.text}
              </InlineAlert>
            ) : null}

            <form onSubmit={requestEmailChange} noValidate className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="account_new_email" className="text-sm font-medium text-slate-200">
                  Nowy adres e-mail
                </label>
                <Input
                  id="account_new_email"
                  type="text"
                  inputMode="email"
                  value={emailForm.newEmail}
                  onChange={(e) => setEmailForm((s) => ({ ...s, newEmail: e.target.value }))}
                  autoComplete="email"
                  placeholder="Wpisz nowy adres e-mail"
                  disabled={emailState.pending}
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="account_email_current_password" className="text-sm font-medium text-slate-200">
                  Aktualne hasło
                </label>
                <Input
                  id="account_email_current_password"
                  type="password"
                  value={emailForm.currentPassword}
                  onChange={(e) => setEmailForm((s) => ({ ...s, currentPassword: e.target.value }))}
                  autoComplete="current-password"
                  placeholder="Wpisz aktualne hasło"
                  disabled={emailState.pending}
                />
              </div>

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

            <form onSubmit={changePassword} noValidate className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="account_password_current_password" className="text-sm font-medium text-slate-200">
                  Aktualne hasło
                </label>
                <Input
                  id="account_password_current_password"
                  type="password"
                  value={passwordForm.currentPassword}
                  onChange={(e) => setPasswordForm((s) => ({ ...s, currentPassword: e.target.value }))}
                  autoComplete="current-password"
                  placeholder="Wpisz aktualne hasło"
                  disabled={passwordState.pending}
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="account_new_password" className="text-sm font-medium text-slate-200">
                  Nowe hasło
                </label>
                <Input
                  id="account_new_password"
                  type="password"
                  value={passwordForm.newPassword}
                  onChange={(e) => setPasswordForm((s) => ({ ...s, newPassword: e.target.value }))}
                  autoComplete="new-password"
                  placeholder="Wpisz nowe hasło"
                  disabled={passwordState.pending}
                />
              </div>

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
        </div>
      ) : null}

      {!loading && activeTab === "sessions" ? (
        <Card className="p-5">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-lg font-semibold text-white">Aktywne sesje</div>
              <div className="mt-1 text-sm text-slate-300">
                Zarządzaj urządzeniami, na których Twoje konto pozostaje zalogowane.
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

          {sessionsLoading ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
              Ładowanie aktywnych sesji...
            </div>
          ) : sessions.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
              Brak aktywnych sesji do wyświetlenia.
            </div>
          ) : (
            <div className="grid gap-3">
              {sessions.map((session) => (
                <div key={session.id} className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Laptop className="h-4 w-4 shrink-0 text-slate-400" />
                        <span className="text-sm font-semibold text-white">
                          {session.device_label || "Nieznane urządzenie"}
                        </span>
                        {session.current ? (
                          <span className="inline-flex items-center rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[11px] font-medium text-indigo-200">
                            Bieżąca sesja
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-2 grid gap-1 text-sm text-slate-300 md:grid-cols-2">
                        <div>
                          Ostatnia aktywność: <span className="text-slate-100">{formatDate(session.last_seen_at)}</span>
                        </div>
                        <div>
                          Utworzona: <span className="text-slate-100">{formatDate(session.created_at)}</span>
                        </div>
                        <div>
                          IP: <span className="text-slate-100">{session.ip_masked || "Brak danych"}</span>
                        </div>
                        <div>
                          Ważna do: <span className="text-slate-100">{formatDate(session.expires_at)}</span>
                        </div>
                      </div>

                      <div className="mt-2 text-xs leading-5 text-slate-400">
                        {session.user_agent || "Brak nagłówka user-agent"}
                      </div>
                    </div>

                    <div className="shrink-0">
                      {session.current ? null : (
                        <Button
                          variant="danger"
                          onClick={() => void removeSession(session)}
                          disabled={sessionActionId === session.id || logoutOthersPending || logoutAllPending}
                          leftIcon={<LogOut className="h-4 w-4" />}
                        >
                          {sessionActionId === session.id ? "Wylogowywanie..." : "Wyloguj"}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      ) : null}

      {!loading && activeTab === "history" ? (
        <Card className="p-5">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-lg font-semibold text-white">Historia logowań</div>
              <div className="mt-1 text-sm text-slate-300">
                Lista ostatnich prób logowania przypisanych do tego konta.
              </div>
            </div>

            <div className="flex flex-wrap gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-1">
              {LOGIN_HISTORY_FILTERS.map((filter) => (
                <button
                  key={filter.key}
                  type="button"
                  onClick={() => setHistoryFilter(filter.key)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-xs font-medium transition",
                    historyFilter === filter.key
                      ? "bg-white/10 text-white"
                      : "text-slate-300 hover:bg-white/[0.06] hover:text-white"
                  )}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>

          {eventsLoading ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
              Ładowanie historii logowań...
            </div>
          ) : filteredLoginEvents.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
              Brak danych dla wybranego filtra.
            </div>
          ) : (
            <div className="max-h-[560px] space-y-3 overflow-y-auto pr-2">
              {filteredLoginEvents.map((event) => (
                <div key={event.id} className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Laptop className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                        <span className="text-sm font-semibold text-white">
                          {event.device_label || "Nieznane urządzenie"}
                        </span>
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                            eventStatusClass(event.success)
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

                      {!event.success ? (
                        <div className="mt-1 text-sm text-slate-300">
                          Powód: <span className="text-slate-100">{translateLoginFailureReason(event.failure_reason)}</span>
                        </div>
                      ) : null}
                    </div>

                    <div className="max-w-full break-words text-xs leading-5 text-slate-400 md:max-w-[45%]">
                      {event.user_agent || "Brak nagłówka user-agent"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      ) : null}
    </div>
  );
}

function SummaryRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-400">
          <span className="text-slate-500">{icon}</span>
          <span>{label}</span>
        </div>
        <div className="mt-1 break-words text-base font-semibold text-white">{value}</div>
      </div>
    </div>
  );
}
