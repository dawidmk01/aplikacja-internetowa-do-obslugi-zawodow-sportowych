// frontend/src/pages/TournamentDetail.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { apiFetch } from "../api";
import { QRCodeCanvas } from "qrcode.react";
import AddAssistantForm from "../components/AddAssistantForm";

/* =========================
   Typy danych
   ========================= */

// SELF_REGISTER jest usunięte całkowicie – zostają tylko dwa tryby zarządzania
type EntryMode = "MANAGER" | "ORGANIZER_ONLY";

type MyPermissions = {
  teams_edit: boolean;
  schedule_edit: boolean;
  results_edit: boolean;
  bracket_edit: boolean;
  tournament_edit: boolean;

  // organizer-only (informacyjnie)
  publish: boolean;
  archive: boolean;
  manage_assistants: boolean;
  join_settings: boolean;
};

type Tournament = {
  id: number;
  name: string;
  discipline: string;
  tournament_format: "LEAGUE" | "CUP" | "MIXED";
  status: "DRAFT" | "CONFIGURED" | "RUNNING" | "FINISHED";
  is_published: boolean;
  access_code: string | null;

  description: string | null;

  // Zarządzanie uczestnikami (organizator-only ustawienie)
  entry_mode: EntryMode;

  // Toggle: dołączanie uczestników przez konto + kod
  allow_join_by_code: boolean;
  join_code: string | null;

  my_role: "ORGANIZER" | "ASSISTANT" | null;
  my_permissions?: MyPermissions;
};

type AssistantDTO = {
  user_id: number;
  email: string;
  username: string;
};

type AssistantPerms = {
  teams_edit: boolean;
  schedule_edit: boolean;
  results_edit: boolean;
  bracket_edit: boolean;
  tournament_edit: boolean;
};

type AssistantPermsResponse = {
  raw: Partial<AssistantPerms>;
  effective: AssistantPerms & {
    publish?: boolean;
    archive?: boolean;
    manage_assistants?: boolean;
    join_settings?: boolean;
  };
};

/* =========================
   Narzędzia UI
   ========================= */

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fallback
  }

  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "fixed";
    el.style.left = "-9999px";
    document.body.appendChild(el);
    el.focus();
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

function PermissionRow({ label, value }: { label: string; value: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        padding: "6px 0",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <span style={{ opacity: 0.9 }}>{label}</span>
      <span style={{ fontWeight: 700, color: value ? "#5fd38a" : "#d36a6a" }}>
        {value ? "TAK" : "NIE"}
      </span>
    </div>
  );
}

function AssistantPermissionToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        padding: "8px 0",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        alignItems: "center",
      }}
    >
      <span style={{ opacity: 0.9 }}>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/* =========================
   Komponent
   ========================= */

export default function TournamentDetail() {
  const { id } = useParams<{ id: string }>();

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Publiczny odczyt turnieju z kodem dostępu (jeśli wymagany)
  const [accessCode, setAccessCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);

  // Asystenci i uprawnienia (organizator)
  const [assistants, setAssistants] = useState<AssistantDTO[]>([]);
  const [assistantsLoading, setAssistantsLoading] = useState(false);
  const [assistantsError, setAssistantsError] = useState<string | null>(null);

  // per-asystent: draft + effective + busy/info
  const [permsDraft, setPermsDraft] = useState<Record<number, AssistantPerms>>({});
  const [permsEffective, setPermsEffective] = useState<Record<number, AssistantPermsResponse["effective"]>>({});
  const [permsBusy, setPermsBusy] = useState<Record<number, boolean>>({});
  const [permsInfo, setPermsInfo] = useState<Record<number, string | null>>({});
  const [permsErr, setPermsErr] = useState<Record<number, string | null>>({});
  const [removeBusy, setRemoveBusy] = useState<Record<number, boolean>>({});

  // DRAFTY ustawień (edytowane po stronie UI)
  const [isPublishedDraft, setIsPublishedDraft] = useState(false);
  const [accessCodeDraft, setAccessCodeDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");

  const [entryModeDraft, setEntryModeDraft] = useState<EntryMode>("MANAGER");

  // Toggle: join-by-code
  const [allowJoinByCodeDraft, setAllowJoinByCodeDraft] = useState(false);
  const [joinCodeDraft, setJoinCodeDraft] = useState("");

  const [savingSecurity, setSavingSecurity] = useState(false);
  const [securityMsg, setSecurityMsg] = useState<string | null>(null);

  // Udostępnianie (QR)
  const qrRef = useRef<HTMLCanvasElement | null>(null);

  const DESCRIPTION_MAX = 800;

  const isOrganizer = tournament?.my_role === "ORGANIZER";
  const isAssistant = tournament?.my_role === "ASSISTANT";
  const canManage = tournament?.my_role === "ORGANIZER" || tournament?.my_role === "ASSISTANT";

  /* =========================
     Pobieranie turnieju
     ========================= */

  const fetchTournament = () => {
    if (!id) return;

    setLoading(true);
    setError(null);

    const url = `/api/tournaments/${id}/` + (accessCode ? `?code=${encodeURIComponent(accessCode)}` : "");

    apiFetch(url)
      .then(async (res) => {
        if (res.status === 403) {
          const data = await res.json().catch(() => ({}));
          if (data?.detail?.toLowerCase?.().includes("kod")) {
            setNeedsCode(true);
            throw new Error("Wymagany poprawny kod dostępu.");
          }
        }

        if (!res.ok) throw new Error("Brak dostępu do turnieju.");
        return res.json();
      })
      .then((data: Tournament) => {
        setTournament(data);

        // Snapshot do edycji ustawień
        setIsPublishedDraft(Boolean(data.is_published));
        setAccessCodeDraft(data.access_code ?? "");
        setDescriptionDraft(data.description ?? "");

        setEntryModeDraft(data.entry_mode ?? "MANAGER");
        setAllowJoinByCodeDraft(Boolean(data.allow_join_by_code));
        setJoinCodeDraft(data.join_code ?? "");

        setNeedsCode(false);
        setSecurityMsg(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchTournament();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /* =========================
     Asystenci: lista + pobranie uprawnień
     ========================= */

  const loadAssistants = async () => {
    if (!id || !isOrganizer) return;

    setAssistantsLoading(true);
    setAssistantsError(null);

    try {
      const res = await apiFetch(`/api/tournaments/${id}/assistants/`);
      if (!res.ok) throw new Error("Nie udało się pobrać listy asystentów.");

      const data = await res.json().catch(() => []);
      const list: AssistantDTO[] = Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : [];
      setAssistants(list);

      // Dociągnij uprawnienia per asystent
      await Promise.all(
        list.map(async (a) => {
          await loadAssistantPerms(a.user_id);
        })
      );
    } catch (e: any) {
      setAssistantsError(e?.message ?? "Błąd pobierania asystentów.");
      setAssistants([]);
    } finally {
      setAssistantsLoading(false);
    }
  };

  const loadAssistantPerms = async (userId: number) => {
    if (!id || !isOrganizer) return;

    setPermsErr((prev) => ({ ...prev, [userId]: null }));
    setPermsInfo((prev) => ({ ...prev, [userId]: null }));
    setPermsBusy((prev) => ({ ...prev, [userId]: true }));

    try {
      const res = await apiFetch(`/api/tournaments/${id}/assistants/${userId}/permissions/`);
      const data = (await res.json().catch(() => null)) as AssistantPermsResponse | null;
      if (!res.ok) throw new Error(data?.["detail"] || "Nie udało się pobrać uprawnień asystenta.");

      const eff = data?.effective;
      if (!eff) throw new Error("Backend nie zwrócił danych effective.");

      const normalizedDraft: AssistantPerms = {
        teams_edit: !!eff.teams_edit,
        schedule_edit: !!eff.schedule_edit,
        results_edit: !!eff.results_edit,
        bracket_edit: !!eff.bracket_edit,
        tournament_edit: !!eff.tournament_edit,
      };

      setPermsEffective((prev) => ({ ...prev, [userId]: eff }));
      setPermsDraft((prev) => ({ ...prev, [userId]: normalizedDraft }));
    } catch (e: any) {
      setPermsErr((prev) => ({ ...prev, [userId]: e?.message ?? "Błąd pobierania uprawnień." }));
    } finally {
      setPermsBusy((prev) => ({ ...prev, [userId]: false }));
    }
  };

  const saveAssistantPerms = async (userId: number) => {
    if (!id || !isOrganizer) return;

    const draft = permsDraft[userId];
    if (!draft) return;

    setPermsBusy((prev) => ({ ...prev, [userId]: true }));
    setPermsErr((prev) => ({ ...prev, [userId]: null }));
    setPermsInfo((prev) => ({ ...prev, [userId]: null }));

    try {
      const res = await apiFetch(`/api/tournaments/${id}/assistants/${userId}/permissions/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teams_edit: !!draft.teams_edit,
          schedule_edit: !!draft.schedule_edit,
          results_edit: !!draft.results_edit,
          bracket_edit: !!draft.bracket_edit,
          tournament_edit: !!draft.tournament_edit,
        }),
      });

      const data = (await res.json().catch(() => null)) as AssistantPermsResponse | null;
      if (!res.ok) throw new Error(data?.["detail"] || "Nie udało się zapisać uprawnień.");

      if (data?.effective) {
        setPermsEffective((prev) => ({ ...prev, [userId]: data.effective }));
        setPermsDraft((prev) => ({
          ...prev,
          [userId]: {
            teams_edit: !!data.effective.teams_edit,
            schedule_edit: !!data.effective.schedule_edit,
            results_edit: !!data.effective.results_edit,
            bracket_edit: !!data.effective.bracket_edit,
            tournament_edit: !!data.effective.tournament_edit,
          },
        }));
      }

      setPermsInfo((prev) => ({ ...prev, [userId]: "Zapisano." }));
    } catch (e: any) {
      setPermsErr((prev) => ({ ...prev, [userId]: e?.message ?? "Błąd zapisu." }));
    } finally {
      setPermsBusy((prev) => ({ ...prev, [userId]: false }));
    }
  };

  const removeAssistant = async (userId: number) => {
    if (!id || !isOrganizer) return;

    setRemoveBusy((prev) => ({ ...prev, [userId]: true }));

    try {
      const res = await apiFetch(`/api/tournaments/${id}/assistants/${userId}/remove/`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.detail || "Nie udało się usunąć asystenta.");
      }

      // Usuń lokalnie i wyczyść stany
      setAssistants((prev) => prev.filter((a) => a.user_id !== userId));
      setPermsDraft((prev) => {
        const n = { ...prev };
        delete n[userId];
        return n;
      });
      setPermsEffective((prev) => {
        const n = { ...prev };
        delete n[userId];
        return n;
      });
      setPermsBusy((prev) => {
        const n = { ...prev };
        delete n[userId];
        return n;
      });
      setPermsInfo((prev) => {
        const n = { ...prev };
        delete n[userId];
        return n;
      });
      setPermsErr((prev) => {
        const n = { ...prev };
        delete n[userId];
        return n;
      });
    } catch (e: any) {
      setAssistantsError(e?.message ?? "Błąd usuwania asystenta.");
    } finally {
      setRemoveBusy((prev) => ({ ...prev, [userId]: false }));
    }
  };

  useEffect(() => {
    if (!isOrganizer) return;
    loadAssistants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isOrganizer]);

  /* =========================
     Generowanie rozgrywek
     ========================= */

  const generateTournament = () => {
    if (!tournament) return;

    apiFetch(`/api/tournaments/${tournament.id}/generate/`, { method: "POST" })
      .then((res) => {
        if (!res.ok) throw new Error("Nie udało się wygenerować rozgrywek.");
        return res.json();
      })
      .then(() => {
        fetchTournament();
        alert("Rozgrywki zostały wygenerowane.");
      })
      .catch((e) => alert(e.message));
  };

  /* =========================
     Zapis ustawień (PATCH)
     ========================= */

  const saveSecuritySettings = async () => {
    if (!tournament) return;

    setSavingSecurity(true);
    setSecurityMsg(null);
    setError(null);

    const normalizedCode = accessCodeDraft.trim();
    const normalizedDesc = descriptionDraft.trim();
    const normalizedJoinCode = joinCodeDraft.trim();

    if (normalizedDesc.length > DESCRIPTION_MAX) {
      setSavingSecurity(false);
      setError(`Opis jest za długi (max ${DESCRIPTION_MAX} znaków).`);
      return;
    }

    if (allowJoinByCodeDraft && normalizedJoinCode.length < 3) {
      setSavingSecurity(false);
      setError("Dla dołączania przez kod wymagany jest kod (min. 3 znaki).");
      return;
    }

    const payload = {
      is_published: isPublishedDraft,
      access_code: normalizedCode.length ? normalizedCode : null,
      description: normalizedDesc.length ? normalizedDesc : null,

      entry_mode: entryModeDraft,

      allow_join_by_code: allowJoinByCodeDraft,
      join_code: allowJoinByCodeDraft ? normalizedJoinCode : null,
    };

    try {
      const res = await apiFetch(`/api/tournaments/${tournament.id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.detail || "Nie udało się zapisać ustawień turnieju.");
      }

      const updated = (await res.json()) as Tournament;
      setTournament(updated);

      setIsPublishedDraft(Boolean(updated.is_published));
      setAccessCodeDraft(updated.access_code ?? "");
      setDescriptionDraft(updated.description ?? "");
      setEntryModeDraft(updated.entry_mode ?? "MANAGER");

      setAllowJoinByCodeDraft(Boolean(updated.allow_join_by_code));
      setJoinCodeDraft(updated.join_code ?? "");

      setSecurityMsg("Ustawienia zostały zapisane.");
    } catch (e: any) {
      setError(e?.message || "Błąd połączenia z serwerem.");
    } finally {
      setSavingSecurity(false);
    }
  };

  const clearAccessCode = () => setAccessCodeDraft("");
  const clearDescription = () => setDescriptionDraft("");

  /* =========================
     Link do udostępniania + QR
     ========================= */

  const shareUrl = useMemo(() => {
    if (!tournament) return "";
    return new URL(`/tournaments/${tournament.id}`, window.location.origin).toString();
  }, [tournament]);

  const handleCopyLink = async () => {
    if (!shareUrl) return;
    const ok = await copyToClipboard(shareUrl);
    setSecurityMsg(ok ? "Link został skopiowany do schowka." : "Nie udało się skopiować linku.");
  };

  const handleNativeShare = async () => {
    if (!shareUrl) return;

    const navAny = navigator as any;
    if (navAny?.share) {
      try {
        await navAny.share({
          title: tournament?.name || "Turniej",
          text: "Link do turnieju",
          url: shareUrl,
        });
        return;
      } catch {
        // anulowanie
      }
    }
    await handleCopyLink();
  };

  const handleDownloadQr = () => {
    const canvas = qrRef.current;
    if (!canvas) {
      setSecurityMsg("Nie udało się pobrać QR – brak canvas.");
      return;
    }
    try {
      const pngUrl = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = pngUrl;
      a.download = `tournament-${tournament?.id ?? "qr"}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setSecurityMsg("Kod QR został pobrany jako PNG.");
    } catch {
      setSecurityMsg("Nie udało się wygenerować pliku PNG z kodu QR.");
    }
  };

  /* =========================
     Widoki dostępu (kod)
     ========================= */

  if (needsCode) {
    return (
      <div style={{ padding: "2rem" }}>
        <h2>Dostęp do turnieju</h2>
        <p>Ten turniej wymaga kodu dostępu.</p>
        <input
          type="text"
          placeholder="Kod dostępu"
          value={accessCode}
          onChange={(e) => setAccessCode(e.target.value)}
        />
        <button onClick={fetchTournament} style={{ marginLeft: 8 }}>
          Potwierdź
        </button>
        {error && <p style={{ color: "crimson" }}>{error}</p>}
      </div>
    );
  }

  if (loading) return <p>Ładowanie…</p>;
  if (error) return <p style={{ color: "crimson" }}>{error}</p>;
  if (!tournament) return null;

  return (
    <div style={{ padding: "2rem" }}>
      <h1 style={{ marginBottom: 6 }}>{tournament.name}</h1>

      {/* Informacja o roli kroku 2 oraz rekomendacji publikacji */}
      <section
        style={{
          marginTop: 10,
          marginBottom: "1.25rem",
          padding: "0.9rem 1rem",
          border: "1px solid #333",
          borderRadius: 10,
          background: "rgba(255,255,255,0.03)",
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Krok 2: Dostęp, współorganizatorzy i udostępnianie</div>
        <div style={{ opacity: 0.9, lineHeight: 1.5 }}>
          Na tym etapie definiowany jest dostęp do turnieju, współorganizatorzy (asystenci) oraz sposób udostępniania.
          <br />
          <strong>Publikacja jest opcjonalna</strong>. Zwykle zaleca się publikację dopiero po:{" "}
          <strong>nadaniu własnych nazw drużynom</strong> oraz <strong>ustawieniu harmonogramu</strong>.
          Po publikacji turniej jest widoczny publicznie (z uwzględnieniem kodu dostępu, jeżeli został ustawiony).
        </div>
      </section>

      {tournament.description && (
        <div style={{ marginBottom: 12, opacity: 0.95, whiteSpace: "pre-wrap" }}>{tournament.description}</div>
      )}

      <p>
        <strong>Dyscyplina:</strong> {tournament.discipline}
      </p>
      <p>
        <strong>Status:</strong> {tournament.status}
      </p>
      <p>
        <strong>Widoczność:</strong> {tournament.is_published ? "Opublikowany" : "Prywatny"}
        {tournament.access_code ? " (z kodem dostępu)" : ""}
      </p>

      <div style={{ marginTop: 10 }}>
        <Link to={`/tournaments/${tournament.id}`} style={{ color: "#9fd3ff" }}>
          Otwórz stronę publiczną turnieju
        </Link>
      </div>

      {/* ===== PODGLĄD UPRAWNIEŃ (TYLKO ASYSTENT – READ ONLY) ===== */}
      {isAssistant && (
        <section style={{ marginTop: "1.25rem", padding: "1rem", border: "1px solid #333", borderRadius: 8 }}>
          <h3>Twoje uprawnienia</h3>

          <p style={{ opacity: 0.9 }}>
            Jesteś asystentem – zakres uprawnień zależy od ustawień nadanych przez organizatora.
          </p>

          {tournament.my_permissions ? (
            <div style={{ marginTop: 10 }}>
              <PermissionRow label="Edycja drużyn" value={!!tournament.my_permissions.teams_edit} />
              <PermissionRow label="Edycja harmonogramu" value={!!tournament.my_permissions.schedule_edit} />
              <PermissionRow label="Wprowadzanie wyników" value={!!tournament.my_permissions.results_edit} />
              <PermissionRow label="Edycja drabinki" value={!!tournament.my_permissions.bracket_edit} />
              <PermissionRow label="Edycja ustawień turnieju" value={!!tournament.my_permissions.tournament_edit} />

              <details style={{ marginTop: 12, opacity: 0.9 }}>
                <summary style={{ cursor: "pointer", opacity: 0.85 }}>Pokaż szczegóły ograniczeń</summary>
                <div style={{ marginTop: 10, opacity: 0.8, lineHeight: 1.45 }}>
                  Uprawnienia „publikacja / archiwizacja / zarządzanie asystentami / ustawienia dołączania” są
                  zarezerwowane dla organizatora. Panel nie umożliwia modyfikacji – prezentuje wyłącznie aktualny zakres.
                </div>
              </details>
            </div>
          ) : (
            <p style={{ opacity: 0.75 }}>Brak danych o uprawnieniach (backend nie zwrócił my_permissions).</p>
          )}
        </section>
      )}

      {/* ===== ZARZĄDZANIE UPRAWNIENIAMI ASYSTENTÓW (TYLKO ORGANIZATOR) ===== */}
      {isOrganizer && (
        <section style={{ marginTop: "1.25rem", padding: "1rem", border: "1px solid #333", borderRadius: 12 }}>
          <h3 style={{ marginTop: 0 }}>Współorganizatorzy</h3>

          <div style={{ opacity: 0.85, marginBottom: 12, lineHeight: 1.45 }}>
            W tym miejscu definiowany jest zakres uprawnień edycyjnych dla każdego asystenta. Zmiany dotyczą wyłącznie
            obszarów: uczestnicy, harmonogram, wyniki, drabinka oraz dane turnieju. Uprawnienia organizatorskie (publikacja,
            archiwizacja, zarządzanie asystentami i ustawienia dołączania) pozostają niedostępne dla asystenta.
          </div>

          <AddAssistantForm tournamentId={tournament.id} onAdded={() => loadAssistants()} />

          <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={loadAssistants} disabled={assistantsLoading}>
              {assistantsLoading ? "Odświeżanie…" : "Odśwież listę"}
            </button>
          </div>

          {assistantsError && <div style={{ marginTop: 10, color: "crimson" }}>{assistantsError}</div>}

          {assistants.length === 0 && !assistantsLoading ? (
            <div style={{ marginTop: 12, opacity: 0.75 }}>Brak asystentów.</div>
          ) : null}

          <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
            {assistants.map((a) => {
              const d = permsDraft[a.user_id];
              const busy = !!permsBusy[a.user_id];
              const info = permsInfo[a.user_id];
              const err = permsErr[a.user_id];
              const removing = !!removeBusy[a.user_id];

              return (
                <div
                  key={a.user_id}
                  style={{
                    border: "1px solid #333",
                    borderRadius: 12,
                    padding: "0.9rem 1rem",
                    background: "rgba(255,255,255,0.02)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontWeight: 800 }}>{a.username || a.email}</div>
                      <div style={{ opacity: 0.8, fontSize: "0.9rem" }}>{a.email}</div>
                    </div>

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      <button onClick={() => saveAssistantPerms(a.user_id)} disabled={busy || !d}>
                        {busy ? "…" : "Zapisz"}
                      </button>
                      <button onClick={() => loadAssistantPerms(a.user_id)} disabled={busy}>
                        Odśwież uprawnienia
                      </button>
                      <button onClick={() => removeAssistant(a.user_id)} disabled={removing}>
                        {removing ? "…" : "Usuń"}
                      </button>
                    </div>
                  </div>

                  <div style={{ marginTop: 10 }}>
                    {!d ? (
                      <div style={{ opacity: 0.75 }}>Ładowanie uprawnień…</div>
                    ) : (
                      <>
                        <div style={{ fontWeight: 700, marginBottom: 6 }}>Uprawnienia asystenta</div>

                        <AssistantPermissionToggleRow
                          label="Edycja drużyn"
                          checked={!!d.teams_edit}
                          onChange={(v) =>
                            setPermsDraft((prev) => ({ ...prev, [a.user_id]: { ...prev[a.user_id], teams_edit: v } }))
                          }
                        />
                        <AssistantPermissionToggleRow
                          label="Edycja harmonogramu"
                          checked={!!d.schedule_edit}
                          onChange={(v) =>
                            setPermsDraft((prev) => ({
                              ...prev,
                              [a.user_id]: { ...prev[a.user_id], schedule_edit: v },
                            }))
                          }
                        />
                        <AssistantPermissionToggleRow
                          label="Wprowadzanie wyników"
                          checked={!!d.results_edit}
                          onChange={(v) =>
                            setPermsDraft((prev) => ({
                              ...prev,
                              [a.user_id]: { ...prev[a.user_id], results_edit: v },
                            }))
                          }
                        />
                        <AssistantPermissionToggleRow
                          label="Edycja drabinki"
                          checked={!!d.bracket_edit}
                          onChange={(v) =>
                            setPermsDraft((prev) => ({
                              ...prev,
                              [a.user_id]: { ...prev[a.user_id], bracket_edit: v },
                            }))
                          }
                        />
                        <AssistantPermissionToggleRow
                          label="Edycja ustawień turnieju"
                          checked={!!d.tournament_edit}
                          onChange={(v) =>
                            setPermsDraft((prev) => ({
                              ...prev,
                              [a.user_id]: { ...prev[a.user_id], tournament_edit: v },
                            }))
                          }
                        />

                        <div style={{ marginTop: 10, opacity: 0.75, fontSize: "0.9rem" }}>
                          Nie obejmuje: publikacji, archiwizacji, zarządzania asystentami i ustawień dołączania.
                        </div>

                        {err && <div style={{ marginTop: 8, color: "crimson" }}>{err}</div>}
                        {info && <div style={{ marginTop: 8, opacity: 0.85 }}>{info}</div>}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ===== Udostępnianie (link + QR) ===== */}
      <section style={{ marginTop: "1.25rem", padding: "1rem", border: "1px solid #333", borderRadius: 8 }}>
        <h3>Udostępnianie</h3>
        {!tournament.is_published && (
          <p style={{ color: "#c9a227" }}>
            Turniej jest prywatny. Link i kod QR będą użyteczne dla widzów dopiero po publikacji.
          </p>
        )}
        {tournament.access_code && (
          <p style={{ opacity: 0.9 }}>
            <strong>Kod dostępu:</strong> {tournament.access_code}
          </p>
        )}
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={handleCopyLink}>Kopiuj link</button>
          <button onClick={handleNativeShare}>Udostępnij</button>
        </div>
        <div style={{ marginTop: "0.75rem", wordBreak: "break-all", opacity: 0.9 }}>
          <small>{shareUrl}</small>
        </div>
        <div style={{ marginTop: "1rem", display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ padding: 8, background: "white", borderRadius: 6 }}>
            <QRCodeCanvas value={shareUrl} size={180} includeMargin ref={qrRef} />
          </div>
          <button onClick={handleDownloadQr}>Pobierz kod QR (PNG)</button>
        </div>
        {securityMsg && <p style={{ color: "green", marginTop: 8 }}>{securityMsg}</p>}
      </section>

      {/* ===== Ustawienia turnieju (organizator) ===== */}
      {isOrganizer && (
        <section style={{ marginTop: "1.25rem", padding: "1rem", border: "1px solid #333", borderRadius: 8 }}>
          <h3>Ustawienia turnieju</h3>

          <label style={{ display: "block", marginTop: 8 }}>
            <input type="checkbox" checked={isPublishedDraft} onChange={(e) => setIsPublishedDraft(e.target.checked)} />{" "}
            Opublikuj turniej
          </label>

          <div style={{ marginTop: 14, padding: "12px", background: "rgba(255,255,255,0.05)", borderRadius: 6 }}>
            <label style={{ display: "block", marginBottom: 6, fontWeight: "bold" }}>Sposób zarządzania uczestnikami</label>

            <select
              value={entryModeDraft}
              onChange={(e) => setEntryModeDraft(e.target.value as EntryMode)}
              style={{ padding: "0.5rem", width: "100%", maxWidth: "420px", borderRadius: "4px" }}
            >
              <option value="ORGANIZER_ONLY">Tylko organizator (asystent nie dodaje)</option>
              <option value="MANAGER">Organizator + asystent (ręcznie)</option>
            </select>

            <div style={{ marginTop: 8, opacity: 0.8, fontSize: "0.9rem" }}>
              {entryModeDraft === "ORGANIZER_ONLY" && <div>Uczestników dodajesz tylko Ty w zakładce „Uczestnicy”.</div>}
              {entryModeDraft === "MANAGER" && <div>Uczestników dodajesz Ty lub Twoi asystenci (domyślny tryb).</div>}
            </div>

            {/* Toggle join-by-code */}
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <label style={{ display: "block", marginBottom: 6, fontWeight: "bold" }}>
                Dołączanie uczestników przez konto + kod
              </label>

              <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  type="checkbox"
                  checked={allowJoinByCodeDraft}
                  onChange={(e) => setAllowJoinByCodeDraft(e.target.checked)}
                />
                Zezwól uczestnikom dołączać przez konto i kod (join link + code)
              </label>

              <div style={{ marginTop: 8, opacity: 0.8, fontSize: "0.9rem" }}>
                Jeśli włączone, uczestnik po zalogowaniu podaje kod i uzupełnia swoje dane (np. nazwę drużyny).
              </div>

              {allowJoinByCodeDraft && (
                <div style={{ marginTop: 10 }}>
                  <label style={{ display: "block", fontSize: "0.85rem", marginBottom: 4 }}>
                    Kod dołączania (dla uczestników)
                  </label>
                  <input
                    type="text"
                    value={joinCodeDraft}
                    onChange={(e) => setJoinCodeDraft(e.target.value)}
                    placeholder="np. START2024"
                    maxLength={32}
                    style={{ padding: "0.4rem", width: "220px" }}
                  />
                </div>
              )}
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <label style={{ display: "block", marginBottom: 6 }}>Opis turnieju (publiczny)</label>
            <textarea
              value={descriptionDraft}
              onChange={(e) => setDescriptionDraft(e.target.value)}
              placeholder="Informacje organizacyjne, zasady..."
              rows={6}
              style={{ width: "min(680px, 100%)" }}
              maxLength={DESCRIPTION_MAX}
            />
            <div style={{ marginTop: 6, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <small style={{ opacity: 0.85 }}>
                {descriptionDraft.trim().length}/{DESCRIPTION_MAX}
              </small>
              <button type="button" onClick={clearDescription}>
                Wyczyść opis
              </button>
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <label style={{ display: "block", marginBottom: 6 }}>Kod dostępu (dla widzów/podglądu)</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input
                type="text"
                value={accessCodeDraft}
                onChange={(e) => setAccessCodeDraft(e.target.value)}
                placeholder="np. WIDZ123"
                maxLength={20}
              />
              <button type="button" onClick={clearAccessCode}>
                Wyczyść kod
              </button>
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <button disabled={savingSecurity} onClick={saveSecuritySettings}>
              {savingSecurity ? "Zapisywanie…" : "Zapisz ustawienia"}
            </button>
          </div>
        </section>
      )}

      {/* ===== Generowanie rozgrywek ===== */}
      {canManage && tournament.status === "DRAFT" && (
        <div style={{ marginTop: "1rem" }}>
          <button onClick={generateTournament}>Generuj rozgrywki</button>
        </div>
      )}
    </div>
  );
}
