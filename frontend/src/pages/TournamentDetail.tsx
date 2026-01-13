import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { apiFetch } from "../api";
import { QRCodeCanvas } from "qrcode.react";
import AddAssistantForm from "../components/AddAssistantForm";
import AssistantsList from "../components/AssistantsList";

/* =========================
   Typy danych
   ========================= */

type Tournament = {
  id: number;
  name: string;
  discipline: string;
  tournament_format: "LEAGUE" | "CUP" | "MIXED";
  status: "DRAFT" | "CONFIGURED" | "RUNNING" | "FINISHED";
  is_published: boolean;
  access_code: string | null;

  // ✅ Opis widoczny na stronie publicznej (/tournaments/:id)
  // UJEDNOLICONE z TournamentPublicDTO: backend/serializer powinien zwracać "description"
  description: string | null;

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
    // fallback poniżej
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

  // Publiczny odczyt turnieju z kodem dostępu (fallback, gdy ktoś nie ma uprawnień)
  const [accessCode, setAccessCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);

  // Zarządzanie asystentami
  const [assistantsVersion, setAssistantsVersion] = useState(0);

  // Ustawienia publikacji i kodu dostępu (dla organizatora)
  const [isPublishedDraft, setIsPublishedDraft] = useState(false);
  const [accessCodeDraft, setAccessCodeDraft] = useState("");

  // ✅ Opis publiczny (dla organizatora)
  const [descriptionDraft, setDescriptionDraft] = useState("");

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

        // Snapshot do edycji ustawień (organizator)
        setIsPublishedDraft(Boolean(data.is_published));
        setAccessCodeDraft(data.access_code ?? "");

        // ✅ opis publiczny (UJEDNOLICONE: description)
        setDescriptionDraft(data.description ?? "");

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
     Publikacja + zabezpieczenia + opis (PATCH)
     ========================= */

  const saveSecuritySettings = async () => {
    if (!tournament) return;

    setSavingSecurity(true);
    setSecurityMsg(null);
    setError(null);

    const normalizedCode = accessCodeDraft.trim();
    const normalizedDesc = descriptionDraft.trim();

    if (normalizedDesc.length > DESCRIPTION_MAX) {
      setSavingSecurity(false);
      setError(`Opis jest za długi (max ${DESCRIPTION_MAX} znaków).`);
      return;
    }

    // ✅ Wysyłamy "description" (zgodnie z publiczną stroną TournamentPublic)
    const payload: Partial<Tournament> = {
      is_published: isPublishedDraft,
      access_code: normalizedCode.length ? normalizedCode : null,
      description: normalizedDesc.length ? normalizedDesc : null,
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
        // anulowanie udostępniania – ignorujemy
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

        <p>Ten turniej wymaga kodu dostępu. Wpisz kod i potwierdź, aby pobrać dane turnieju.</p>

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

  const canManage = tournament.my_role === "ORGANIZER" || tournament.my_role === "ASSISTANT";
  const isOrganizer = tournament.my_role === "ORGANIZER";

  return (
    <div style={{ padding: "2rem" }}>
      <h1 style={{ marginBottom: 6 }}>{tournament.name}</h1>

      {/* ✅ Podgląd opisu (widzoczny także dla asystenta w panelu) */}
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
            Turniej jest prywatny. Link i kod QR będą użyteczne dla widzów dopiero po publikacji (lub po podaniu kodu).
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

          <div>
            <button onClick={handleDownloadQr}>Pobierz kod QR (PNG)</button>
          </div>
        </div>

        {securityMsg && <p style={{ color: "green", marginTop: 8 }}>{securityMsg}</p>}
      </section>

      {/* ===== Publikacja, kod dostępu, opis (organizator) ===== */}
      {isOrganizer && (
        <section style={{ marginTop: "1.25rem", padding: "1rem", border: "1px solid #333", borderRadius: 8 }}>
          <h3>Ustawienia publiczne</h3>

          <label style={{ display: "block", marginTop: 8 }}>
            <input
              type="checkbox"
              checked={isPublishedDraft}
              onChange={(e) => setIsPublishedDraft(e.target.checked)}
            />{" "}
            Opublikuj turniej
          </label>

          {/* ✅ Opis publiczny */}
          <div style={{ marginTop: 14 }}>
            <label style={{ display: "block", marginBottom: 6 }}>Opis turnieju (widoczny na stronie publicznej)</label>

            <textarea
              value={descriptionDraft}
              onChange={(e) => setDescriptionDraft(e.target.value)}
              placeholder="Np. informacje organizacyjne, zasady, sponsorzy, kontakt…"
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

          {/* Kod dostępu */}
          <div style={{ marginTop: 14 }}>
            <label style={{ display: "block", marginBottom: 6 }}>Kod dostępu (opcjonalny, max 20 znaków)</label>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input
                type="text"
                value={accessCodeDraft}
                onChange={(e) => setAccessCodeDraft(e.target.value)}
                placeholder="np. ABC123"
                maxLength={20}
              />

              <button type="button" onClick={clearAccessCode}>
                Wyczyść kod
              </button>
            </div>
          </div>

          {/* Zapis */}
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

      {/* ===== Asystenci (organizator) ===== */}
      {isOrganizer && (
        <>
          <AddAssistantForm tournamentId={tournament.id} onAdded={() => setAssistantsVersion((v) => v + 1)} />
          <AssistantsList key={assistantsVersion} tournamentId={tournament.id} canManage />
        </>
      )}
    </div>
  );
}
