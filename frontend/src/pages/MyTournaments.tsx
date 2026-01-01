import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch, apiGet } from "../api";

type Tournament = {
  id: number;
  name: string;
  discipline: string; // np. "football"
  tournament_format?: "LEAGUE" | "CUP" | "MIXED";
  participants_count?: number;
  status?: "DRAFT" | "CONFIGURED" | "RUNNING" | "FINISHED";
  is_published?: boolean;
  access_code?: string | null;

  // frontend już obsługuje, backend dopniemy później
  is_archived?: boolean;

  my_role: "ORGANIZER" | "ASSISTANT" | null;
};

function disciplineLabel(code: string | undefined) {
  switch (code) {
    case "football":
      return "Piłka nożna";
    case "volleyball":
      return "Siatkówka";
    case "basketball":
      return "Koszykówka";
    case "tennis":
      return "Tenis";
    case "wrestling":
      return "Zapasy";
    default:
      return code ?? "—";
  }
}

function formatLabel(v?: Tournament["tournament_format"]) {
  if (v === "LEAGUE") return "Liga";
  if (v === "CUP") return "Puchar";
  if (v === "MIXED") return "Mieszany";
  return "—";
}

function statusLabel(v?: Tournament["status"]) {
  if (v === "DRAFT") return "Szkic";
  if (v === "CONFIGURED") return "Skonfigurowany";
  if (v === "RUNNING") return "W trakcie";
  if (v === "FINISHED") return "Zakończony";
  return "—";
}

function normalizePL(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // usuwa znaki diakrytyczne
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export default function MyTournaments() {
  const [items, setItems] = useState<Tournament[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState("");
  const [shareOpenId, setShareOpenId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Filtry widoczności sekcji (jeden rząd checkboxów)
  const [visibleSections, setVisibleSections] = useState({
    draft: true,
    ready: true,
    published: true,
    archived: false, // domyślnie ukryte
  });

  const load = () => {
    setLoading(true);
    setError(null);

    apiGet<Tournament[]>("/api/tournaments/my/")
      .then(setItems)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const setToastSafe = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2200);
  };

  // ✅ Filtr + ranking trafności (żeby np. "c" dawało "c Zapasy" na górze)
  const filtered = useMemo(() => {
    const q = normalizePL(query.trim());
    if (!q) return items;

    const scored = items
      .map((t) => {
        const name = normalizePL(t.name);
        const discipline = normalizePL(disciplineLabel(t.discipline));
        const format = normalizePL(formatLabel(t.tournament_format));
        const st = normalizePL(statusLabel(t.status));
        const vis = normalizePL(t.is_published ? "opublikowany" : "nieopublikowany");
        const arch = normalizePL(t.is_archived ? "archiwum" : "");

        let score = 0;

        // Priorytet: nazwa turnieju
        if (name === q) score += 200;
        else if (name.startsWith(q)) score += 140;
        else if (name.includes(q)) score += 90;

        // Priorytet: dyscyplina / format / status
        if (discipline.startsWith(q)) score += 60;
        else if (discipline.includes(q)) score += 40;

        if (format.includes(q)) score += 15;
        if (st.includes(q)) score += 10;
        if (vis.includes(q)) score += 6;
        if (arch.includes(q)) score += 6;

        // Dodatkowy „fallback” — jeśli query pasuje do zlepionego opisu,
        // ale nie weszło w powyższe, daj minimalny score, żeby rekord nie zniknął.
        const hay = [name, discipline, format, st, vis, arch].join(" ");
        if (score === 0 && hay.includes(q)) score = 1;

        return { t, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.t);

    return scored;
  }, [items, query]);

  const grouped = useMemo(() => {
    const archived = filtered.filter((t) => !!t.is_archived);
    const notArchived = filtered.filter((t) => !t.is_archived);

    const draft = notArchived.filter((t) => (t.status ?? "DRAFT") === "DRAFT");
    const ready = notArchived.filter(
      (t) => (t.status ?? "DRAFT") !== "DRAFT" && !t.is_published
    );
    const published = notArchived.filter(
      (t) => (t.status ?? "DRAFT") !== "DRAFT" && !!t.is_published
    );

    return { draft, ready, published, archived };
  }, [filtered]);

  const togglePublish = async (t: Tournament) => {
    if (t.my_role !== "ORGANIZER") return;

    // biznesowo: publikacja dopiero po konfiguracji
    if ((t.status ?? "DRAFT") === "DRAFT") {
      setToastSafe("Najpierw skonfiguruj turniej i wygeneruj rozgrywki.");
      return;
    }

    setBusyId(t.id);
    setError(null);

    try {
      const res = await apiFetch(`/api/tournaments/${t.id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_published: !t.is_published }),
      });

      if (!res.ok) throw new Error("Nie udało się zmienić publikacji turnieju.");

      load();
      setToastSafe(!t.is_published ? "Turniej opublikowany." : "Turniej ukryty.");
    } catch (e: any) {
      setError(e?.message ?? "Błąd publikacji turnieju.");
    } finally {
      setBusyId(null);
    }
  };

  const toggleArchive = async (t: Tournament) => {
    if (t.my_role !== "ORGANIZER") return;

    setBusyId(t.id);
    setError(null);

    try {
      // Backend dopniemy w następnym kroku (pole is_archived + walidacja).
      const res = await apiFetch(`/api/tournaments/${t.id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_archived: !t.is_archived }),
      });

      if (!res.ok) {
        setToastSafe("Funkcja archiwum jeszcze nieobsługiwana po stronie backendu.");
        return;
      }

      load();
      setToastSafe(!t.is_archived ? "Przeniesiono do archiwum." : "Przywrócono z archiwum.");
    } catch {
      setToastSafe("Funkcja archiwum jeszcze nieobsługiwana po stronie backendu.");
    } finally {
      setBusyId(null);
    }
  };

  const renderSection = (title: string, list: Tournament[]) => {
    if (list.length === 0) return null;

    return (
      <section style={{ marginTop: "1.5rem" }}>
        <h2 style={{ marginBottom: "0.75rem" }}>{title}</h2>

        <div style={{ display: "grid", gap: "0.75rem" }}>
          {list.map((t) => {
            const canManage = t.my_role === "ORGANIZER";
            const isDraft = (t.status ?? "DRAFT") === "DRAFT";
            const isShareOpen = shareOpenId === t.id;

            const baseLink = `${window.location.origin}/tournaments/${t.id}`;
            const linkWithCode =
              t.access_code && t.access_code.trim()
                ? `${baseLink}?code=${encodeURIComponent(t.access_code)}`
                : baseLink;

            return (
              <div
                key={t.id}
                style={{
                  border: "1px solid #333",
                  borderRadius: 10,
                  padding: "1rem",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "1rem",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ minWidth: 280 }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                      <Link
                        to={`/tournaments/${t.id}`}
                        style={{ fontSize: "1.05rem", fontWeight: 700, textDecoration: "none" }}
                      >
                        {t.name}
                      </Link>
                      <span style={{ opacity: 0.85 }}>{disciplineLabel(t.discipline)}</span>
                    </div>

                    <div style={{ marginTop: 6, display: "flex", gap: 10, flexWrap: "wrap", opacity: 0.9 }}>
                      <span>Format: {formatLabel(t.tournament_format)}</span>
                      {typeof t.participants_count === "number" && (
                        <span>Uczestnicy: {t.participants_count}</span>
                      )}
                      <span>Status: {statusLabel(t.status)}</span>
                      {!t.is_archived && (
                        <span>Widoczność: {t.is_published ? "Opublikowany" : "Nieopublikowany"}</span>
                      )}
                      {t.is_archived && <span>Stan: Archiwum</span>}
                    </div>

                    <div style={{ marginTop: 6, opacity: 0.85 }}>Rola: {t.my_role ?? "—"}</div>
                  </div>

                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <Link
                      to={`/tournaments/${t.id}`}
                      style={{
                        border: "1px solid #444",
                        padding: "0.45rem 0.75rem",
                        borderRadius: 8,
                        textDecoration: "none",
                        display: "inline-block",
                      }}
                    >
                      Szczegóły
                    </Link>

                    {!t.is_archived && (
                      <button
                        onClick={() => setShareOpenId(isShareOpen ? null : t.id)}
                        style={{
                          border: "1px solid #444",
                          padding: "0.45rem 0.75rem",
                          borderRadius: 8,
                          background: "transparent",
                          cursor: "pointer",
                        }}
                      >
                        Udostępnij
                      </button>
                    )}

                    {canManage && !t.is_archived && (
                      <button
                        onClick={() => togglePublish(t)}
                        disabled={busyId === t.id}
                        title={isDraft ? "Publikacja jest dostępna po wygenerowaniu rozgrywek." : ""}
                        style={{
                          border: "1px solid #444",
                          padding: "0.45rem 0.75rem",
                          borderRadius: 8,
                          background: "transparent",
                          cursor: busyId === t.id ? "not-allowed" : "pointer",
                          opacity: busyId === t.id ? 0.7 : 1,
                        }}
                      >
                        {t.is_published ? "Ukryj" : "Publikuj"}
                      </button>
                    )}

                    {canManage && (
                      <button
                        onClick={() => toggleArchive(t)}
                        disabled={busyId === t.id}
                        style={{
                          border: "1px solid #444",
                          padding: "0.45rem 0.75rem",
                          borderRadius: 8,
                          background: "transparent",
                          cursor: busyId === t.id ? "not-allowed" : "pointer",
                          opacity: busyId === t.id ? 0.7 : 1,
                        }}
                      >
                        {t.is_archived ? "Przywróć" : "Archiwizuj"}
                      </button>
                    )}
                  </div>
                </div>

                {isShareOpen && !t.is_archived && (
                  <div
                    style={{
                      marginTop: "0.9rem",
                      paddingTop: "0.9rem",
                      borderTop: "1px solid #333",
                      display: "grid",
                      gap: 10,
                    }}
                  >
                    {!t.is_published && (
                      <div style={{ opacity: 0.9 }}>
                        Uwaga: turniej jest nieopublikowany — dostęp dla widzów będzie możliwy dopiero po publikacji.
                      </div>
                    )}

                    <div style={{ display: "grid", gap: 6 }}>
                      <div style={{ opacity: 0.9, fontWeight: 600 }}>Link do turnieju</div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <code style={{ padding: "0.35rem 0.5rem", border: "1px solid #333", borderRadius: 8 }}>
                          {baseLink}
                        </code>
                        <button
                          onClick={async () => {
                            const ok = await copyToClipboard(baseLink);
                            setToastSafe(ok ? "Skopiowano link." : "Nie udało się skopiować.");
                          }}
                          style={{
                            border: "1px solid #444",
                            padding: "0.35rem 0.6rem",
                            borderRadius: 8,
                            background: "transparent",
                            cursor: "pointer",
                          }}
                        >
                          Kopiuj
                        </button>
                      </div>
                    </div>

                    {t.access_code && t.access_code.trim() && (
                      <>
                        <div style={{ display: "grid", gap: 6 }}>
                          <div style={{ opacity: 0.9, fontWeight: 600 }}>Kod dostępu</div>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                            <code style={{ padding: "0.35rem 0.5rem", border: "1px solid #333", borderRadius: 8 }}>
                              {t.access_code}
                            </code>
                            <button
                              onClick={async () => {
                                const ok = await copyToClipboard(t.access_code ?? "");
                                setToastSafe(ok ? "Skopiowano kod." : "Nie udało się skopiować.");
                              }}
                              style={{
                                border: "1px solid #444",
                                padding: "0.35rem 0.6rem",
                                borderRadius: 8,
                                background: "transparent",
                                cursor: "pointer",
                              }}
                            >
                              Kopiuj
                            </button>
                          </div>
                        </div>

                        <div style={{ display: "grid", gap: 6 }}>
                          <div style={{ opacity: 0.9, fontWeight: 600 }}>Link z kodem</div>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                            <code style={{ padding: "0.35rem 0.5rem", border: "1px solid #333", borderRadius: 8 }}>
                              {linkWithCode}
                            </code>
                            <button
                              onClick={async () => {
                                const ok = await copyToClipboard(linkWithCode);
                                setToastSafe(ok ? "Skopiowano link z kodem." : "Nie udało się skopiować.");
                              }}
                              style={{
                                border: "1px solid #444",
                                padding: "0.35rem 0.6rem",
                                borderRadius: 8,
                                background: "transparent",
                                cursor: "pointer",
                              }}
                            >
                              Kopiuj
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    );
  };

  if (loading) return <p>Ładowanie…</p>;
  if (error) return <p style={{ color: "crimson" }}>{error}</p>;

  return (
    <div style={{ padding: "2rem", maxWidth: 1000 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Moje turnieje</h1>

        <Link
          to="/tournaments/new"
          style={{
            border: "1px solid #444",
            padding: "0.5rem 0.85rem",
            borderRadius: 10,
            textDecoration: "none",
            display: "inline-block",
          }}
        >
          ➕ Utwórz turniej
        </Link>
      </div>

      <div style={{ marginTop: "1rem", display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Szukaj: nazwa, dyscyplina (PL), status…"
          style={{ width: "min(520px, 100%)" }}
        />

        <button
          onClick={load}
          style={{
            border: "1px solid #444",
            padding: "0.45rem 0.75rem",
            borderRadius: 8,
            background: "transparent",
            cursor: "pointer",
          }}
        >
          Odśwież
        </button>
      </div>

      {/* ✅ Jeden rząd checkboxów sterujących widocznością sekcji */}
      <div style={{ marginTop: "1rem", display: "flex", gap: 16, flexWrap: "wrap" }}>
        {[
          ["draft", "Szkice"],
          ["ready", "Gotowe"],
          ["published", "Opublikowane"],
          ["archived", "Archiwum"],
        ].map(([key, label]) => (
          <label key={key} style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={visibleSections[key as keyof typeof visibleSections]}
              onChange={(e) =>
                setVisibleSections((v) => ({
                  ...v,
                  [key]: e.target.checked,
                }))
              }
            />
            {label}
          </label>
        ))}
      </div>

      {items.length === 0 && <p style={{ marginTop: "1rem" }}>Brak turniejów.</p>}

      {visibleSections.draft && renderSection("Szkice", grouped.draft)}
      {visibleSections.ready && renderSection("Gotowe do publikacji", grouped.ready)}
      {visibleSections.published && renderSection("Opublikowane", grouped.published)}
      {visibleSections.archived && renderSection("Archiwum", grouped.archived)}

      {toast && <div style={{ marginTop: "1rem", opacity: 0.9 }}>{toast}</div>}
    </div>
  );
}
