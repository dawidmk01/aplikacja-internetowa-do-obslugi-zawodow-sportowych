import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";
import AddAssistantForm from "./AddAssistantForm";
import AssistantsList from "./AssistantsList";

/**
 * Nowa strategia:
 * - entry_mode: tylko MANAGER | ORGANIZER_ONLY (steruje panelem zarządzania)
 * - dołączanie (join link + code): toggle join_enabled + registration_code
 * - SELF_REGISTER jeśli istnieje w bazie traktujemy jako legacy (UI go nie pokazuje)
 */
type EntryMode = "MANAGER" | "ORGANIZER_ONLY";

type TournamentDTO = {
  id: number;
  name: string;

  status?: "DRAFT" | "CONFIGURED" | "RUNNING" | "FINISHED";
  is_published?: boolean;

  // kod dostępu do podglądu publicznego (opcjonalnie)
  access_code?: string | null;

  // tryb panelu
  entry_mode?: EntryMode | "SELF_REGISTER"; // legacy może przyjść z API

  // join toggle (konto + kod)
  join_enabled?: boolean;
  registration_code?: string | null;

  my_role?: "ORGANIZER" | "ASSISTANT" | "PARTICIPANT" | null;
};

function genCode(len = 8) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[arr[i] % alphabet.length];
  return out;
}

function normalizeEntryMode(v: TournamentDTO["entry_mode"]): EntryMode {
  // SELF_REGISTER traktujemy jako legacy -> MANAGER
  if (v === "ORGANIZER_ONLY") return "ORGANIZER_ONLY";
  return "MANAGER";
}

function entryModeLabel(v: TournamentDTO["entry_mode"]) {
  const m = normalizeEntryMode(v);
  if (m === "MANAGER") return "Organizator + asystenci";
  if (m === "ORGANIZER_ONLY") return "Tylko organizator";
  return "—";
}

export default function TournamentPermissionsPanel({ tournamentId }: { tournamentId: number }) {
  const [t, setT] = useState<TournamentDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [assistantsKey, setAssistantsKey] = useState(0);

  const isOrganizer = t?.my_role === "ORGANIZER";
  const isAssistant = t?.my_role === "ASSISTANT";

  // Panel pokazujemy dla ORGANIZER i ASSISTANT (asystent zobaczy część informacyjną),
  // ale edycja i zarządzanie uprawnieniami jest tylko dla ORGANIZER.
  const canSeePanel = isOrganizer || isAssistant;

  const basePublicLink = useMemo(() => {
    return `${window.location.origin}/tournaments/${tournamentId}`;
  }, [tournamentId]);

  const joinLink = useMemo(() => {
    // Link do dołączania NIE zależy od entry_mode.
    // Kod dostępu (access_code) może być wymagany do wejścia na publiczny widok,
    // dlatego dopinamy go do URL jeśli istnieje.
    const ac = (t?.access_code ?? "").trim();
    if (ac) return `${basePublicLink}?join=1&code=${encodeURIComponent(ac)}`;
    return `${basePublicLink}?join=1`;
  }, [basePublicLink, t?.access_code]);

  const load = async () => {
    setLoading(true);
    setError(null);
    setInfo(null);

    try {
      const res = await apiFetch(`/api/tournaments/${tournamentId}/`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || "Nie udało się pobrać danych turnieju.");

      // Defensive: normalizujemy legacy
      const dto = data as TournamentDTO;
      dto.entry_mode = normalizeEntryMode(dto.entry_mode);

      setT(dto);
    } catch (e: any) {
      setError(e?.message ?? "Błąd ładowania.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId]);

  const patchTournament = async (payload: Partial<TournamentDTO>) => {
    setBusy(true);
    setError(null);
    setInfo(null);

    try {
      const res = await apiFetch(`/api/tournaments/${tournamentId}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || "Nie udało się zapisać zmian.");

      const dto = data as TournamentDTO;
      dto.entry_mode = normalizeEntryMode(dto.entry_mode);

      setT(dto);
      setInfo("Zapisano.");
    } catch (e: any) {
      setError(e?.message ?? "Błąd zapisu.");
    } finally {
      setBusy(false);
      window.setTimeout(() => setInfo(null), 1800);
    }
  };

  if (!canSeePanel) return null;

  return (
    <aside
      style={{
        border: "1px solid #333",
        borderRadius: 12,
        padding: "1rem",
        position: "sticky",
        top: 18,
      }}
    >
      <div style={{ fontWeight: 800, marginBottom: 8 }}>Uprawnienia i dostęp</div>

      {loading ? <div>Ładowanie…</div> : null}
      {error ? <div style={{ color: "crimson", marginTop: 8 }}>{error}</div> : null}
      {info ? <div style={{ opacity: 0.85, marginTop: 8 }}>{info}</div> : null}

      {!loading && t ? (
        <div style={{ display: "grid", gap: 12, marginTop: 10 }}>
          <div style={{ opacity: 0.9 }}>
            <div style={{ fontWeight: 700 }}>{t.name}</div>
            <div style={{ opacity: 0.8, marginTop: 4 }}>Rola: {t.my_role ?? "—"}</div>
          </div>

          {/* Tryb panelu (entry_mode) */}
          <section style={{ borderTop: "1px solid #333", paddingTop: 10 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Tryb panelu zarządzania</div>

            <div style={{ opacity: 0.85, fontSize: "0.9rem", marginBottom: 8 }}>
              Steruje tym, kto może edytować w panelu. Dołączanie uczestników jest osobnym przełącznikiem (poniżej).
            </div>

            <div style={{ opacity: 0.85, fontSize: "0.9rem", marginBottom: 8 }}>
              Aktualnie: <b>{entryModeLabel(t.entry_mode)}</b>
            </div>

            <select
              disabled={!isOrganizer || busy}
              value={normalizeEntryMode(t.entry_mode)}
              onChange={(e) => patchTournament({ entry_mode: e.target.value as EntryMode })}
              style={{ width: "100%", padding: "0.5rem" }}
            >
              <option value="MANAGER">MANAGER</option>
              <option value="ORGANIZER_ONLY">ORGANIZER_ONLY</option>
            </select>

            {!isOrganizer && (
              <div style={{ marginTop: 8, opacity: 0.85 }}>
                Zmiana trybu panelu jest dostępna tylko dla organizatora.
              </div>
            )}
          </section>

          {/* Toggle dołączania (join_enabled) */}
          <section style={{ borderTop: "1px solid #333", paddingTop: 10 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Dołączanie uczestników (konto + kod)</div>

            <div style={{ opacity: 0.85, fontSize: "0.9rem", marginBottom: 8 }}>
              To NIE jest entry_mode. To osobny przełącznik: użytkownik (zalogowany) może wejść przez link + kod.
            </div>

            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                disabled={!isOrganizer || busy}
                checked={!!t.join_enabled}
                onChange={(e) => patchTournament({ join_enabled: e.target.checked })}
              />
              <span>Zezwól uczestnikom dołączać przez konto i kod</span>
            </label>

            {!t.join_enabled ? (
              <div style={{ marginTop: 8, opacity: 0.85 }}>
                Dołączanie jest wyłączone.
              </div>
            ) : (
              <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                <div style={{ opacity: 0.85, fontSize: "0.9rem" }}>Link do dołączenia (wymaga loginu):</div>

                <code style={{ padding: "0.45rem 0.6rem", border: "1px solid #333", borderRadius: 8 }}>
                  {joinLink}
                </code>

                <div style={{ opacity: 0.85, fontSize: "0.9rem" }}>Kod dołączania:</div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <code style={{ padding: "0.45rem 0.6rem", border: "1px solid #333", borderRadius: 8 }}>
                    {t.registration_code ?? "—"}
                  </code>

                  {isOrganizer && (
                    <button
                      disabled={busy}
                      onClick={() => patchTournament({ registration_code: genCode(8) })}
                      style={{
                        border: "1px solid #444",
                        padding: "0.45rem 0.75rem",
                        borderRadius: 8,
                        background: "transparent",
                        cursor: "pointer",
                      }}
                    >
                      Wygeneruj kod
                    </button>
                  )}
                </div>

                {!isOrganizer && (
                  <div style={{ opacity: 0.85 }}>
                    Kod i ustawienia dołączania może zmieniać tylko organizator.
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Asystenci + panel uprawnień per-asystent (punkt 5) */}
          <section style={{ borderTop: "1px solid #333", paddingTop: 10 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Asystenci</div>

            {isOrganizer ? (
              <AddAssistantForm
                tournamentId={tournamentId}
                onAdded={() => setAssistantsKey((k) => k + 1)}
              />
            ) : (
              <div style={{ opacity: 0.85, marginBottom: 8 }}>
                Dodawanie/usuwanie asystentów jest dostępne tylko dla organizatora.
              </div>
            )}

            <div style={{ marginTop: 10 }}>
              <AssistantsList
                key={assistantsKey}
                tournamentId={tournamentId}
                canRemove={!!isOrganizer}
              />
            </div>

            {/* Punkt 5: przypomnienie w UI (konkrety) */}
            <div style={{ marginTop: 10, opacity: 0.85, fontSize: "0.9rem" }}>
              Uprawnienia per-asystent (granularne) konfigurujesz w sekcji „Uprawnienia asystentów” na stronie turnieju
              (TournamentTeams / TournamentSchedule / TournamentResults / TournamentDetail będą disable’ować akcje wg PERM_*).
              Ten panel nie blokuje stron — ogranicza tylko działania.
            </div>
          </section>
        </div>
      ) : null}
    </aside>
  );
}
