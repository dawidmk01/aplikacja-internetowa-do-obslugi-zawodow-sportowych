export type FlowStepKey = "setup" | "teams" | "matches" | "schedule" | "results";

export type FlowStep = {
  key: FlowStepKey;
  label: string;
  path: (id: string) => string;
  match: (pathname: string) => boolean;
};

export const FLOW_STEPS: FlowStep[] = [
  {
    key: "setup",
    label: "Konfiguracja",
    path: (id) => `/tournaments/${id}/setup`,
    match: (p) =>
      p === "/tournaments/new" ||
      p.split("?")[0].endsWith("/setup"),
  },
  {
    key: "teams",
    label: "Uczestnicy",
    path: (id) => `/tournaments/${id}/teams`,
    match: (p) => p.split("?")[0].endsWith("/teams"),
  },
  {
    key: "matches",
    label: "Mecze",
    path: (id) => `/tournaments/${id}/matches`,
    match: (p) => p.split("?")[0].endsWith("/matches"),
  },
  {
    key: "schedule",
    label: "Harmonogram",
    path: (id) => `/tournaments/${id}/schedule`,
    match: (p) => p.split("?")[0].endsWith("/schedule"),
  },
  {
    key: "results",
    label: "Wyniki",
    path: (id) => `/tournaments/${id}/results`,
    match: (p) => p.split("?")[0].endsWith("/results"),
  },
];

export function getCurrentStepIndex(pathname: string): number {
  const idx = FLOW_STEPS.findIndex((s) => s.match(pathname));
  return idx >= 0 ? idx : 0;
}