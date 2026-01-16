import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { getAssistants, removeAssistant } from "../api";

type Assistant = {
  user_id: number; // klucz do usuwania
  email: string;
  username: string;
  role: "ASSISTANT";
};

// Kontrakt permissions (punkt 5) – klucze zgodne z backend PERM_*
type AssistantPerms = {
  teams_edit: boolean;
  schedule_edit: boolean;
  results_edit: boolean;
  bracket_edit: boolean;
  tournament_edit: boolean;
  // organizer-only (zawsze false dla asystenta, ale trzymamy spójny kontrakt)
  publish: boolean;
  archive: boolean;
  manage_assistants: boolean;
  join_settings: boolean;
};

const DEFAULT_PERMS: AssistantPerms = {
  teams_edit: true,
  schedule_edit: true,
  results_edit: true,
  bracket_edit: true,
  tournament_edit: true,
  publish: false,
  archive: false,
  manage_assistants: false,
  join_settings: false,
};

type Props = {
  tournamentId: number;
  canManage: boolean; // u Ciebie: czy można usuwać. W nowej strategii: tylko organizer powinien mieć true.
};

function permLabel(key: keyof AssistantPerms) {
  switch (key) {
    case "teams_edit":
      return "Edycja uczestników (Teams)";
    case "schedule_edit":
      return "Edycja harmonogramu (Schedule)";
    case "results_edit":
      return "Edycja wyników (Results)";
    case "bracket_edit":
      return "Generowanie/zmiany rozgrywek (Bracket)";
    case "tournament_edit":
      return "Edycja danych turnieju (Detail)";
    case "publish":
      return "Publikacja (tylko organizator)";
    case "archive":
      return "Archiwizacja (tylko organizator)";
    case "manage_assistants":
      return "Zarządzanie asystentami (tylko organizator)";
    case "join_settings":
      return "Kody + dołączanie (tylko organizator)";
    default:
      return key;
  }
}

export default function AssistantsList({ tournamentId, canManage }: Props) {
  const [items, setItems] = useState<Assistant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // komunikat czasowy
  const [message, setMessage] = useState<string | null>(null);

  // permissions cache per user_id
  const [permsByUser, setPermsByUser] = useState<Record<number, AssistantPerms | null>>({});
  const [permsLoading, setPermsLoading] = useState<Record<number, boolean>>({});
  const [permsSaving, setPermsSaving] = useState<Record<number, boolean>>({});

  const load = () => {
    setLoading(true);
    setError(null);

    getAssistants(tournamentId)
      .then((list) => {
        setItems(list);
        // reset cache, ale zachowaj jeśli już było
        setPermsByUser((prev) => {
          const next = { ...prev };
          for (const a of list) {
            if (!(a.user_id in next)) next[a.user_id] = null;
          }
          return next;
        });
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [tournamentId]);

  const remove = async (userId: number) => {
    try {
      await removeAssistant(tournamentId, userId);
      setMessage("Współorganizator został usunięty.");
      load();
      setTimeout(() => setMessage(null), 3000);
    } catch (e: any) {
      setError(e.message || "Błąd usuwania współorganizatora");
    }
  };

  const permissionsUrl = (userId: number) =>
    `/api/tournaments/${tournamentId}/assistants/${userId}/permissions/`;

  const loadPerms = async (userId: number) => {
    // tylko organizer (canManage) powinien ładować/edytować
    if (!canManage) return;

    setPermsLoading((m) => ({ ...m, [userId]: true }));
    setError(null);

    try {
      const res = await apiFetch(permissionsUrl(userId));
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || "Nie udało się pobrać uprawnień asystenta.");

      // defensywnie merge z defaultem (gdy backend nie zwróci wszystkich kluczy)
      const merged: AssistantPerms = { ...DEFAULT_PERMS, ...(data ?? {}) };
      setPermsByUser((p) => ({ ...p, [userId]: merged }));
    } catch (e: any) {
      setError(e?.message ?? "Błąd pobierania uprawnień.");
    } finally {
      setPermsLoading((m) => ({ ...m, [userId]: false }));
    }
  };

  const savePerms = async (userId: number, nextPerms: AssistantPerms) => {
    if (!canManage) return;

    setPermsSaving((m) => ({ ...m, [userId]: true }));
    setError(null);

    try {
      const res = await apiFetch(permissionsUrl(userId), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextPerms),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || "Nie udało się zapisać uprawnień.");

      const merged: AssistantPerms = { ...DEFAULT_PERMS, ...(data ?? nextPerms) };
      setPermsByUser((p) => ({ ...p, [userId]: merged }));

      setMessage("Zapisano uprawnienia asystenta.");
      setTimeout(() => setMessage(null), 2000);
    } catch (e: any) {
      setError(e?.message ?? "Błąd zapisu uprawnień.");
    } finally {
      setPermsSaving((m) => ({ ...m, [userId]: false }));
    }
  };

  const togglePerm = async (userId: number, key: keyof AssistantPerms) => {
    const current = permsByUser[userId];
    const base = current ?? DEFAULT_PERMS;

    // organizer-only klucze trzymamy false — nie pozwalamy ich ustawiać w UI
    if (key === "publish" || key === "archive" || key === "manage_assistants" || key === "join_settings") return;

    const next = { ...base, [key]: !base[key] };
    setPermsByUser((p) => ({ ...p, [userId]: next }));
    await savePerms(userId, next);
  };

  if (loading) return <p>Ładowanie współorganizatorów…</p>;
  if (error) return <p style={{ color: "crimson" }}>{error}</p>;

  return (
    <div style={{ marginTop: "2rem" }}>
      <h3>Współorganizatorzy</h3>

      {message && <p style={{ color: "green", marginBottom: "0.5rem" }}>{message}</p>}

      {items.length === 0 ? (
        <p>Brak współorganizatorów</p>
      ) : (
        <ul style={{ paddingLeft: 18 }}>
          {items.map((a) => {
            const perms = permsByUser[a.user_id];
            const isPermsLoading = !!permsLoading[a.user_id];
            const isPermsSaving = !!permsSaving[a.user_id];

            return (
              <li key={a.user_id} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <span>
                    {a.email} ({a.username})
                  </span>

                  {canManage && (
                    <>
                      <button style={{ marginLeft: 8 }} onClick={() => remove(a.user_id)}>
                        Usuń
                      </button>

                      <button
                        style={{ marginLeft: 8 }}
                        onClick={() => loadPerms(a.user_id)}
                        disabled={isPermsLoading}
                        title="Pobierz uprawnienia asystenta"
                      >
                        {isPermsLoading ? "Ładowanie…" : perms ? "Odśwież uprawnienia" : "Pokaż uprawnienia"}
                      </button>
                    </>
                  )}
                </div>

                {/* Punkt 5: granularne uprawnienia per-asystent */}
                {canManage && perms && (
                  <div
                    style={{
                      marginTop: 10,
                      border: "1px solid #333",
                      borderRadius: 10,
                      padding: "0.75rem",
                      display: "grid",
                      gap: 8,
                      opacity: isPermsSaving ? 0.85 : 1,
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>Uprawnienia asystenta</div>

                    {(
                      [
                        "teams_edit",
                        "schedule_edit",
                        "results_edit",
                        "bracket_edit",
                        "tournament_edit",
                      ] as (keyof AssistantPerms)[]
                    ).map((k) => (
                      <label key={k} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <input
                          type="checkbox"
                          checked={!!perms[k]}
                          disabled={isPermsSaving}
                          onChange={() => togglePerm(a.user_id, k)}
                        />
                        <span>{permLabel(k)}</span>
                      </label>
                    ))}

                    <div style={{ opacity: 0.85, fontSize: "0.9rem", marginTop: 6 }}>
                      Uwaga: asystent nadal może wejść na strony panelu. Jeśli nie ma prawa do edycji, elementy edycji będą
                      wyłączone/ukryte, a strona zostanie w trybie podglądu.
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
