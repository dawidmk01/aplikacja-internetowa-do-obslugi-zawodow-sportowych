import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { apiFetch } from "../api";
import { QRCodeCanvas } from "qrcode.react";
import AddAssistantForm from "../components/AddAssistantForm";
import AssistantsList from "../components/AssistantsList";

/* =========================
   Typy danych
   ========================= */

// Zgodne z backendem (models.py)
type EntryMode = "MANAGER" | "ORGANIZER_ONLY" | "SELF_REGISTER";

type Tournament = {
  id: number;
  name: string;
  discipline: string;
  tournament_format: "LEAGUE" | "CUP" | "MIXED";
  status: "DRAFT" | "CONFIGURED" | "RUNNING" | "FINISHED";
  is_published: boolean;
  access_code: string | null;

  description: string | null;

  // ✅ Nowe pola konfiguracji rejestracji
  entry_mode: EntryMode;
  registration_code: string | null;

  my_role: "ORGANIZER" | "ASSISTANT" | null;
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

/* =========================
   Komponent
   ========================= */

export default function TournamentDetail() {
  const { id } = useParams<{ id: string }>();

  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Publiczny odczyt turnieju z kodem dostępu
  const [accessCode, setAccessCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);

  // Zarządzanie asystentami
  const [assistantsVersion, setAssistantsVersion] = useState(0);

  // === DRAFTY USTAWIEŃ (Edycja) ===
  const [isPublishedDraft, setIsPublishedDraft] = useState(false);
  const [accessCodeDraft, setAccessCodeDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");

  // ✅ State dla trybu rejestracji
  const [entryModeDraft, setEntryModeDraft] = useState<EntryMode>("MANAGER");
  const [registrationCodeDraft, setRegistrationCodeDraft] = useState("");

  const [savingSecurity, setSavingSecurity] = useState(false);
  const [securityMsg, setSecurityMsg] = useState<string | null>(null);

  // Udostępnianie (QR)
  const qrRef = useRef<HTMLCanvasElement | null>(null);

  const DESCRIPTION_MAX = 800;

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

        // ✅ Inicjalizacja trybu
        setEntryModeDraft(data.entry_mode ?? "MANAGER");
        setRegistrationCodeDraft(data.registration_code ?? "");

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
    const normalizedRegCode = registrationCodeDraft.trim();

    if (normalizedDesc.length > DESCRIPTION_MAX) {
      setSavingSecurity(false);
      setError(`Opis jest za długi (max ${DESCRIPTION_MAX} znaków).`);
      return;
    }

    // Walidacja dla trybu SELF_REGISTER
    if (entryModeDraft === "SELF_REGISTER" && normalizedRegCode.length < 3) {
      setSavingSecurity(false);
      setError("Dla samodzielnej rejestracji wymagany jest kod rejestracyjny (min. 3 znaki).");
      return;
    }

    const payload: Partial<Tournament> = {
      is_published: isPublishedDraft,
      access_code: normalizedCode.length ? normalizedCode : null,
      description: normalizedDesc.length ? normalizedDesc : null,

      // ✅ Nowe pola w payloadzie
      entry_mode: entryModeDraft,
      registration_code: entryModeDraft === "SELF_REGISTER" ? normalizedRegCode : null,
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
      setRegistrationCodeDraft(updated.registration_code ?? "");

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
        <button onClick={fetchTournament} style={{ marginLeft: 8 }}>Potwierdź</button>
        {error && <p style={{ color: "crimson" }}>{error}</p>}
      </div>
    );
  }

  if (loading) return <p>Ładowanie…</p>;
  if (error) return <p style={{ color: "crimson" }}>{error}</p>;
  if (!tournament) return null;

  const canManage = tournament.my_role === "ORGANIZER" || tournament.my_role === "ASSISTANT";
  const isOrganizer = tournament.my_role === "ORGANIZER";

  return (
    <div style={{ padding: "2rem" }}>
      <h1 style={{ marginBottom: 6 }}>{tournament.name}</h1>

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

      {/* Szybkie przejście do publicznej strony */}
      <div style={{ marginTop: 10 }}>
        <Link to={`/tournaments/${tournament.id}`} style={{ color: "#9fd3ff" }}>
          Otwórz stronę publiczną turnieju
        </Link>
      </div>

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

      {/* ===== Publikacja, kod dostępu, opis, ENTRY_MODE (organizator) ===== */}
      {isOrganizer && (
        <section style={{ marginTop: "1.25rem", padding: "1rem", border: "1px solid #333", borderRadius: 8 }}>
          <h3>Ustawienia turnieju</h3>

          <label style={{ display: "block", marginTop: 8 }}>
            <input
              type="checkbox"
              checked={isPublishedDraft}
              onChange={(e) => setIsPublishedDraft(e.target.checked)}
            />{" "}
            Opublikuj turniej
          </label>

          {/* Wybór trybu rejestracji */}
          <div style={{ marginTop: 14, padding: "12px", background: "rgba(255,255,255,0.05)", borderRadius: 6 }}>
            <label style={{ display: "block", marginBottom: 6, fontWeight: "bold" }}>
              Sposób rejestracji uczestników
            </label>

            <select
              value={entryModeDraft}
              onChange={(e) => setEntryModeDraft(e.target.value as EntryMode)}
              style={{ padding: "0.5rem", width: "100%", maxWidth: "420px", borderRadius: "4px" }}
            >
              <option value="ORGANIZER_ONLY">Tylko organizator (asystent nie dodaje)</option>
              <option value="MANAGER">Organizator + asystent (Ręcznie)</option>
              <option value="SELF_REGISTER">Samodzielna rejestracja (Konto + Kod)</option>
            </select>

            <div style={{ marginTop: 8, opacity: 0.8, fontSize: "0.9rem" }}>
              {entryModeDraft === "ORGANIZER_ONLY" && (
                <div>Uczestników dodajesz tylko Ty w zakładce „Drużyny”.</div>
              )}
              {entryModeDraft === "MANAGER" && (
                <div>Uczestników dodajesz Ty lub Twoi asystenci (domyślny tryb).</div>
              )}
              {entryModeDraft === "SELF_REGISTER" && (
                <div>
                  Uczestnicy sami zakładają konta i dołączają wpisując kod.
                  <br />
                  <strong>Wymagane:</strong> Ustawienie kodu rejestracyjnego poniżej oraz utworzenie "pustych slotów" w drużynach.
                </div>
              )}
            </div>

            {/* Input na kod rejestracyjny - tylko dla SELF_REGISTER */}
            {entryModeDraft === "SELF_REGISTER" && (
               <div style={{ marginTop: 10 }}>
                 <label style={{ display: "block", fontSize: "0.85rem", marginBottom: 4 }}>
                   Kod rejestracyjny (dla uczestników)
                 </label>
                 <input
                    type="text"
                    value={registrationCodeDraft}
                    onChange={(e) => setRegistrationCodeDraft(e.target.value)}
                    placeholder="np. START2024"
                    maxLength={32}
                    style={{ padding: "0.4rem", width: "200px" }}
                 />
               </div>
            )}
          </div>

          {/* Opis publiczny */}
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
              <button type="button" onClick={clearDescription}>Wyczyść opis</button>
            </div>
          </div>

          {/* Kod dostępu (dla widzów) */}
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
              <button type="button" onClick={clearAccessCode}>Wyczyść kod</button>
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

      {/* ===== Asystenci ===== */}
      {isOrganizer && (
        <>
          <AddAssistantForm tournamentId={tournament.id} onAdded={() => setAssistantsVersion((v) => v + 1)} />
          <AssistantsList key={assistantsVersion} tournamentId={tournament.id} canManage />
        </>
      )}
    </div>
  );
}