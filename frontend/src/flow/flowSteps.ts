// frontend/src/flow/flowSteps.ts
// Plik definiuje kroki flow panelu turnieju i zachowuje kontekst aktywnej dywizji podczas nawigacji między ekranami.

export type FlowStepKey =
  | "setup"
  | "detail"
  | "teams"
  | "schedule"
  | "results"
  | "public_preview";

export type FlowStep = {
  key: FlowStepKey;
  label: string;
  path: (id: string) => string;
  match: (pathname: string) => boolean;
};

function cleanPath(pathname: string): string {
  const p = pathname.split("?")[0];
  return p.replace(/\/+$/, "");
}

function isPublicTournamentPath(pathname: string): boolean {
  const x = cleanPath(pathname);

  if (x === "/tournaments/new") return false;
  if (x.includes("/detail")) return false;

  return /^\/tournaments\/[^/]+(\/standings)?$/.test(x);
}

function getPreservedFlowSearch(): string {
  if (typeof window === "undefined") return "";

  const params = new URLSearchParams(window.location.search || "");
  const next = new URLSearchParams();

  const divisionId = params.get("division_id");
  const activeDivisionId = params.get("active_division_id");
  const divisionSlug = params.get("division_slug");
  const activeDivisionSlug = params.get("active_division_slug");

  if (divisionId) next.set("division_id", divisionId);
  if (!divisionId && activeDivisionId) next.set("division_id", activeDivisionId);

  if (divisionSlug) next.set("division_slug", divisionSlug);
  if (!divisionSlug && activeDivisionSlug) next.set("division_slug", activeDivisionSlug);

  const query = next.toString();
  return query ? `?${query}` : "";
}

function buildPanelPath(path: string): string {
  return `${path}${getPreservedFlowSearch()}`;
}

/** Definiuje kroki flow panelu i zachowuje aktywną dywizję w linkach między ekranami. */
export const FLOW_STEPS: FlowStep[] = [
  {
    key: "setup",
    label: "Konfiguracja",
    path: (id) => buildPanelPath(`/tournaments/${id}/detail/setup`),
    match: (p) => {
      const x = cleanPath(p);
      return x === "/tournaments/new" || x.endsWith("/detail/setup");
    },
  },
  {
    key: "detail",
    label: "Szczegóły",
    path: (id) => buildPanelPath(`/tournaments/${id}/detail`),
    match: (p) => cleanPath(p).endsWith("/detail"),
  },
  {
    key: "teams",
    label: "Uczestnicy",
    path: (id) => buildPanelPath(`/tournaments/${id}/detail/teams`),
    match: (p) => cleanPath(p).endsWith("/detail/teams"),
  },
  {
    key: "schedule",
    label: "Harmonogram",
    path: (id) => buildPanelPath(`/tournaments/${id}/detail/schedule`),
    match: (p) => cleanPath(p).endsWith("/detail/schedule"),
  },
  {
    key: "results",
    label: "Wyniki",
    path: (id) => buildPanelPath(`/tournaments/${id}/detail/results`),
    match: (p) => cleanPath(p).endsWith("/detail/results"),
  },
  {
    key: "public_preview",
    label: "Podgląd widza",
    path: (id) => buildPanelPath(`/tournaments/${id}`),
    match: (p) => isPublicTournamentPath(p),
  },
];

export function getCurrentStepIndex(pathname: string): number {
  const idx = FLOW_STEPS.findIndex((s) => s.match(pathname));
  return idx >= 0 ? idx : 0;
}
