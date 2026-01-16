import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";
import AddAssistantForm from "./AddAssistantForm";
import AssistantsList from "./AssistantsList";

type EntryMode = "MANAGER" | "ORGANIZER_ONLY" | "SELF_REGISTER";

type TournamentDTO = {
  id: number;
  name: string;
  status?: "DRAFT" | "CONFIGURED" | "RUNNING" | "FINISHED";
  is_published?: boolean;

  // dostęp
  access_code?: string | null;

  // rejestracja
  entry_mode?: EntryMode;
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

export default function TournamentPermissionsPanel({
  tournamentId,
}: {
  tournamentId: number;
}) {
  const [t, setT] = useState<TournamentDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [assistantsKey, setAssistantsKey] = useState(0);

  const isOrganizer = t?.my_role === "ORGANIZER";
  const canManage = t?.my_role === "ORGANIZER" || t?.my_role === "ASSISTANT";

  const basePublicLink = useMemo(() => {
    return `${window.location.origin}/tournaments/${tournamentId}`;
  }, [tournamentId]);

  const joinLink = useMemo(() => {
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
      setT(data as TournamentDTO);
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
      setT(data as TournamentDTO);
      setInfo("Zapisano.");
    } catch (e: any) {
      setError(e?.message ?? "Błąd zapisu.");
    } finally {
      setBusy(false);
      window.setTimeout(() => setInfo(null), 1800);
    }
  };

  if (!canManage) return null;

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
      <div style={{ fontWeight: 800, marginBottom: 8 }}>Uprawnienia</div>

      {loading ? <div>Ładowanie…</div> : null}
      {error ? <div style={{ color: "crimson", marginTop: 8 }}>{error}</div> : null}
      {info ? <div style={{ opacity: 0.85, marginTop: 8 }}>{info}</div> : null}

      {!loading && t ? (
        <div style={{ display: "grid", gap: 12, marginTop: 10 }}>
          <div style={{ opacity: 0.9 }}>
            <div style={{ fontWeight: 700 }}>{t.name}</div>
            <div style={{ opacity: 0.8, marginTop: 4 }}>Rola: {t.my_role ?? "—"}</div>
          </div>

          {/* Tryb dodawania uczestników */}
          <section style={{ borderTop: "1px solid #333", paddingTop: 10 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Dodawanie uczestników</div>

            <div style={{ opacity: 0.85, fontSize: "0.9rem", marginBottom: 8 }}>
              MANAGER: organizator + asystenci • ORGANIZER_ONLY: tylko organizator • SELF_REGISTER: link + kod dla zawodników/drużyn
            </div>

            <select
              disabled={!isOrganizer || busy}
              value={t.entry_mode ?? "MANAGER"}
              onChange={(e) => patchTournament({ entry_mode: e.target.value as EntryMode })}
              style={{ width: "100%", padding: "0.5rem" }}
            >
              <option value="MANAGER">MANAGER</option>
              <option value="ORGANIZER_ONLY">ORGANIZER_ONLY</option>
              <option value="SELF_REGISTER">SELF_REGISTER</option>
            </select>

            {/* SELF_REGISTER: kod + link */}
            {t.entry_mode === "SELF_REGISTER" ? (
              <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                <div style={{ opacity: 0.85, fontSize: "0.9rem" }}>
                  Link do rejestracji (wymaga loginu):
                </div>

                <code style={{ padding: "0.45rem 0.6rem", border: "1px solid #333", borderRadius: 8 }}>
                  {joinLink}
                </code>

                <div style={{ opacity: 0.85, fontSize: "0.9rem" }}>Kod rejestracyjny:</div>

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
              </div>
            ) : null}
          </section>

          {/* Asystenci */}
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
          </section>
        </div>
      ) : null}
    </aside>
  );
}
