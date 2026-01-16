import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch, apiGet } from "../api";

type Tournament = {
  id: number;
  name: string;
  discipline: string;
  tournament_format?: "LEAGUE" | "CUP" | "MIXED";
  participants_count?: number;
  status?: "DRAFT" | "CONFIGURED" | "RUNNING" | "FINISHED";
  is_published?: boolean;
  access_code?: string | null;

  is_archived?: boolean;

  entry_mode?: "MANAGER" | "ORGANIZER_ONLY" | "SELF_REGISTER";
  registration_code?: string | null;

  my_role: "ORGANIZER" | "ASSISTANT" | "PARTICIPANT" | null;
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

function entryModeLabel(v?: Tournament["entry_mode"]) {
  const m = v ?? "MANAGER"; // kompatybilność wsteczna
  if (m === "MANAGER") return "Organizator + asystent";
  if (m === "ORGANIZER_ONLY") return "Tylko organizator";
  if (m === "SELF_REGISTER") return "Self-register";
  return "—";
}

function normalizePL(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
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

function canUsePanel(t: Tournament) {
  const mode = t.entry_mode ?? "MANAGER";
  if (t.my_role === "ORGANIZER") return true;
  if (t.my_role === "ASSISTANT") return mode === "MANAGER";
  return false;
}

function panelDisabledReason(t: Tournament) {
  if (t.my_role !== "ASSISTANT") return null;
  const mode = t.entry_mode ?? "MANAGER";
  if (mode === "MANAGER") return null;
  if (mode === "ORGANIZER_ONLY") return "Panel wyłączony (tryb: tylko organizator). Masz podgląd.";
  if (mode === "SELF_REGISTER") return "Panel wyłączony (tryb: self-register). Masz podgląd.";
  return "Panel wyłączony. Masz podgląd.";
}

export default function MyTournaments() {
  const [items, setItems] = useState<Tournament[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState("");
  const [shareOpenId, setShareOpenId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [visibleSections, setVisibleSections] = useState({
    draft: true,
    ready: true,
    published: true,
    archived: false,
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
        const mode = normalizePL(entryModeLabel(t.entry_mode));
        const role = normalizePL(t.my_role ?? "");

        let score = 0;

        if (name === q) score += 200;
        else if (name.startsWith(q)) score += 140;
        else if (name.includes(q)) score += 90;

        if (discipline.startsWith(q)) score += 60;
        else if (discipline.includes(q)) score += 40;

        if (format.includes(q)) score += 15;
        if (st.includes(q)) score += 10;
        if (vis.includes(q)) score += 6;
        if (arch.includes(q)) score += 6;
        if (mode.includes(q)) score += 6;
        if (role.includes(q)) score += 6;

        const hay = [name, discipline, format, st, vis, arch, mode, role].join(" ");
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
      const res = await apiFetch(`/api/tournaments/${t.id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_archived: !t.is_archived }),
      });

      if (!res.ok) {
        setToastSafe("Błąd archiwizacji.");
        return;
      }

      load();
      setToastSafe(!t.is_archived ? "Przeniesiono do archiwum." : "Przywrócono z archiwum.");
    } catch {
      setToastSafe("Błąd komunikacji z serwerem.");
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
            const panelEnabled = canUsePanel(t);
            const isOrganizer = t.my_role === "ORGANIZER";
            const isDraft = (t.status ?? "DRAFT") === "DRAFT";
            const isShareOpen = shareOpenId === t.id;

            const baseLink = `${window.location.origin}/tournaments/${t.id}`;

            const joinLink =
              t.access_code && t.access_code.trim()
                ? `${baseLink}?code=${encodeURIComponent(t.access_code)}&join=1`
                : `${baseLink}?join=1`;

            const linkWithCode =
              t.access_code && t.access_code.trim()
                ? `${baseLink}?code=${encodeURIComponent(t.access_code)}`
                : baseLink;

            const panelNote = panelDisabledReason(t);

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
                      <span style={{ fontSize: "1.05rem", fontWeight: 700 }}>
                        {t.name}
                      </span>
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
                      <span>Tryb: {entryModeLabel(t.entry_mode)}</span>
                    </div>

                    <div style={{ marginTop: 6, opacity: 0.85 }}>Rola: {t.my_role ?? "—"}</div>

                    {panelNote && (
                      <div style={{ marginTop: 8, opacity: 0.9 }}>
                        {panelNote}
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    {/* Panel: zawsze pokazujemy dla ORGANIZER i ASSISTANT (wejście pokaże gate w layout),
                        ale dla braku uprawnień gate wyświetli komunikat i link do podglądu. */}
                    {(t.my_role === "ORGANIZER" || t.my_role === "ASSISTANT") && (
                      <Link
                        to={`/tournaments/${t.id}/detail`}
                        style={{
                          border: "1px solid #444",
                          padding: "0.45rem 0.75rem",
                          borderRadius: 8,
                          textDecoration: "none",
                          display: "inline-block",
                          backgroundColor: panelEnabled ? "#2c3e50" : "transparent",
                          color: panelEnabled ? "white" : "inherit",
                          opacity: panelEnabled ? 1 : 0.85,
                        }}
                        title={
                          panelEnabled
                            ? "Panel zarządzania"
                            : "Panel jest wyłączony w tym trybie. Zobaczysz komunikat i przejdziesz do podglądu."
                        }
                      >
                        Panel
                      </Link>
                    )}

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
                      Turniej
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

                    {isOrganizer && !t.is_archived && (
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

                    {isOrganizer && (
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

                    {isOrganizer && (t.entry_mode ?? "MANAGER") === "SELF_REGISTER" && (
                      <div style={{ display: "grid", gap: 10, marginTop: 10, borderTop: "1px solid #444", paddingTop: 10 }}>
                        <div style={{ opacity: 0.9, fontWeight: 700 }}>Rejestracja uczestników</div>

                        <div style={{ display: "grid", gap: 6 }}>
                          <div style={{ opacity: 0.9, fontWeight: 600 }}>Link do rejestracji</div>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                            <code style={{ padding: "0.35rem 0.5rem", border: "1px solid #333", borderRadius: 8 }}>
                              {joinLink}
                            </code>
                            <button
                              onClick={async () => {
                                const ok = await copyToClipboard(joinLink);
                                setToastSafe(ok ? "Skopiowano link rejestracji." : "Nie udało się skopiować.");
                              }}
                              style={{ border: "1px solid #444", padding: "0.35rem 0.6rem", borderRadius: 8, background: "transparent", cursor: "pointer" }}
                            >
                              Kopiuj
                            </button>
                          </div>
                        </div>

                        <div style={{ display: "grid", gap: 6 }}>
                          <div style={{ opacity: 0.9, fontWeight: 600 }}>Kod rejestracyjny</div>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                            <code style={{ padding: "0.35rem 0.5rem", border: "1px solid #333", borderRadius: 8 }}>
                              {t.registration_code ?? "—"}
                            </code>
                            <button
                              disabled={!t.registration_code}
                              onClick={async () => {
                                const ok = await copyToClipboard(t.registration_code ?? "");
                                setToastSafe(ok ? "Skopiowano kod rejestracyjny." : "Nie udało się skopiować.");
                              }}
                              style={{ border: "1px solid #444", padding: "0.35rem 0.6rem", borderRadius: 8, background: "transparent", cursor: "pointer", opacity: t.registration_code ? 1 : 0.6 }}
                            >
                              Kopiuj
                            </button>
                          </div>
                        </div>
                      </div>
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
