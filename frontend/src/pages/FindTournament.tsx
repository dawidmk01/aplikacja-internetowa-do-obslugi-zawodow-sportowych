// frontend/src/pages/FindTournament.tsx
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Link as LinkIcon, Search } from "lucide-react";

import { Card } from "../ui/Card";
import { Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { cn } from "../lib/cn";

function extractTournamentTarget(rawInput: string): string | null {
  const raw = (rawInput ?? "").trim();
  if (!raw) return null;

  // 1) samo ID
  if (/^\d+$/.test(raw)) {
    return `/tournaments/${raw}`;
  }

  // 2) ścieżka lub URL — próbujemy bezpiecznie zbudować URL
  //    - pełny URL: https://...
  //    - ścieżka: /tournaments/12?code=...
  //    - wklejone "example.com/tournaments/12?..." bez schematu: wycinamy od /tournaments/...
  let url: URL | null = null;

  const tryBuildUrl = (value: string) => {
    try {
      // jeśli to sama ścieżka, base = origin
      if (value.startsWith("/")) return new URL(value, window.location.origin);
      return new URL(value);
    } catch {
      return null;
    }
  };

  url = tryBuildUrl(raw);

  if (!url) {
    const idx = raw.indexOf("/tournaments/");
    if (idx >= 0) {
      const tail = raw.slice(idx);
      url = tryBuildUrl(tail.startsWith("/") ? tail : `/${tail}`);
    }
  }

  if (!url) return null;

  // Wyciągamy: /tournaments/:id + opcjonalny suffix (np. /detail/results)
  // Zachowujemy query (?code=..., ?tab=..., itd.)
  const m = url.pathname.match(/^\/tournaments\/(\d+)(\/.*)?$/);
  if (!m) return null;

  const id = m[1];
  const suffix = m[2] ?? "";
  const search = url.search ?? "";

  return `/tournaments/${id}${suffix}${search}`;
}

export default function FindTournament() {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const hintExamples = useMemo(
    () => [
      "12",
      "/tournaments/12",
      "/tournaments/12?code=ABCD",
      "https://twojadomena.pl/tournaments/12?code=ABCD",
      "https://twojadomena.pl/tournaments/12/detail",
    ],
    []
  );

  const handleSearch = () => {
    setError(null);

    const target = extractTournamentTarget(input);
    if (!target) {
      setError("Wpisz link/ścieżkę lub ID turnieju (np. 12 lub /tournaments/12).");
      return;
    }

    navigate(target);
  };

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-8">
      <div className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight text-white">Wyszukaj turniej</h1>
        <p className="mt-1 text-sm text-slate-300">
          Wklej link z QR code / ścieżkę lub wpisz ID. Zachowamy też parametry typu <span className="text-slate-200">?code=</span>.
        </p>
      </div>

      <Card className="p-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSearch();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-300">Link / ścieżka / ID</div>
            <div className="relative">
              <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                <LinkIcon className="h-4 w-4" />
              </div>
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="np. 12 lub /tournaments/12?code=ABCD"
                className="pl-9"
                autoComplete="off"
              />
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
              <div className="text-xs font-semibold text-slate-300">Przykłady</div>
              <ul className="mt-2 space-y-1 text-sm text-slate-300">
                {hintExamples.map((ex) => (
                  <li
                    key={ex}
                    className="rounded-lg border border-white/5 bg-white/[0.03] px-2 py-1 font-mono text-xs text-slate-200"
                  >
                    {ex}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {error && (
            <div className="rounded-2xl border border-rose-400/20 bg-rose-400/5 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 text-rose-200" />
                <div className="text-sm text-slate-100">{error}</div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" leftIcon={<Search className="h-4 w-4" />}>
              Przejdź do turnieju
            </Button>

            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setInput("");
                setError(null);
              }}
              className={cn(!input && "opacity-60 pointer-events-none")}
            >
              Wyczyść
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
