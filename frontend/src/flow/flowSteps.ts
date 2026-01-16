export type FlowStepKey = "setup" | "detail" | "teams" | "schedule" | "results";

export type FlowStep = {
  key: FlowStepKey;
  label: string;
  path: (id: string) => string;
  match: (pathname: string) => boolean;
};

/* =========================
   Helpers
   ========================= */

function cleanPath(pathname: string): string {
  // usuń query i końcowe slashe
  const p = pathname.split("?")[0];
  return p.replace(/\/+$/, "");
}

/* =========================
   Kroki flow
   Bazowa ścieżka managementu: /tournaments/:id/detail/*
   ========================= */

export const FLOW_STEPS: FlowStep[] = [
  {
    key: "setup",
    label: "Konfiguracja",
    path: (id) => `/tournaments/${id}/detail/setup`,
    match: (p) => {
      const x = cleanPath(p);
      return x === "/tournaments/new" || x.endsWith("/detail/setup");
    },
  },
  {
    key: "detail",
    label: "Szczegóły",
    path: (id) => `/tournaments/${id}/detail`,
    match: (p) => cleanPath(p).endsWith("/detail"),
  },
  {
    key: "teams",
    label: "Uczestnicy",
    path: (id) => `/tournaments/${id}/detail/teams`,
    match: (p) => cleanPath(p).endsWith("/detail/teams"),
  },
  {
    key: "schedule",
    label: "Harmonogram",
    path: (id) => `/tournaments/${id}/detail/schedule`,
    match: (p) => cleanPath(p).endsWith("/detail/schedule"),
  },
  {
    key: "results",
    label: "Wyniki",
    path: (id) => `/tournaments/${id}/detail/results`,
    match: (p) => cleanPath(p).endsWith("/detail/results"),
  },
];

export function getCurrentStepIndex(pathname: string): number {
  const idx = FLOW_STEPS.findIndex((s) => s.match(pathname));
  return idx >= 0 ? idx : 0;
}
