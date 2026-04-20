// frontend/src/lib/sportLabels.ts
// Plik przechowuje polskie etykiety prezentacyjne dla technicznych wartości konfiguracji sportów.

export const DISCIPLINE_LABELS = {
  football: "Piłka nożna",
  volleyball: "Siatkówka",
  basketball: "Koszykówka",
  handball: "Piłka ręczna",
  tennis: "Tenis",
  wrestling: "Zapasy",
  custom: "Dyscyplina niestandardowa",
} as const;

export const TOURNAMENT_FORMAT_LABELS = {
  LEAGUE: "Liga",
  CUP: "Puchar",
  MIXED: "Grupy + puchar",
} as const;

export const TOURNAMENT_STATUS_LABELS = {
  DRAFT: "Szkic",
  CONFIGURED: "Skonfigurowany",
  RUNNING: "W trakcie",
  FINISHED: "Zakończony",
} as const;

export const DIVISION_STATUS_LABELS = {
  DRAFT: "Szkic",
  CONFIGURED: "Skonfigurowany",
  RUNNING: "W trakcie",
  FINISHED: "Zakończony",
} as const;

export const MATCH_STATUS_LABELS = {
  SCHEDULED: "Zaplanowany",
  IN_PROGRESS: "W trakcie",
  FINISHED: "Zakończony",
  CANCELLED: "Anulowany",
  WALKOVER: "Walkower",
} as const;

export const COMPETITION_TYPE_LABELS = {
  TEAM: "Drużynowa",
  INDIVIDUAL: "Indywidualna",
} as const;

export const COMPETITION_MODEL_LABELS = {
  HEAD_TO_HEAD: "Pojedynki / mecze",
  MASS_START: "Wszyscy razem",
} as const;

export const HEAD_TO_HEAD_MODE_LABELS = {
  POINTS_TABLE: "System punktowy",
  MEASURED_RESULT: "Wynik mierzalny",
} as const;

export const RESULT_VALUE_KIND_LABELS = {
  NUMBER: "Wynik liczbowy",
  TIME: "Wynik czasowy",
  PLACE: "Miejsce",
  POINTS: "Wynik punktowy",
} as const;

export const BETTER_RESULT_LABELS = {
  HIGHER: "Wyższy wynik jest lepszy",
  LOWER: "Niższy wynik jest lepszy",
} as const;

export const TIME_FORMAT_LABELS = {
  "HH:MM:SS": "godziny:minuty:sekundy",
  "MM:SS": "minuty:sekundy",
  "MM:SS.hh": "minuty:sekundy:setne",
  "SS.hh": "sekundy:setne",
} as const;

export const AGGREGATION_MODE_LABELS = {
  SUM: "Suma",
  AVERAGE: "Średnia",
  BEST: "Najlepszy wynik",
  LAST_ROUND: "Ostatnia runda",
} as const;

export const UNIT_PRESET_LABELS = {
  POINTS: "Punkty",
  SECONDS: "Sekundy",
  MILLISECONDS: "Milisekundy",
  MINUTES: "Minuty",
  METERS: "Metry",
  CENTIMETERS: "Centymetry",
  KILOGRAMS: "Kilogramy",
  GRAMS: "Gramy",
  REPS: "Powtórzenia",
  PLACE: "Miejsce",
  CUSTOM: "Własna",
} as const;

export const TENNIS_POINTS_MODE_LABELS = {
  NONE: "Standardowy zapis tenisa",
  PLT: "Skrócony zapis punktowy",
} as const;

export const WRESTLING_STYLE_LABELS = {
  FREESTYLE: "Styl wolny",
  GRECO_ROMAN: "Styl klasyczny",
} as const;

export const WRESTLING_COMPETITION_MODE_LABELS = {
  AUTO: "Automatyczny",
  NORDIC: "System nordycki",
  TWO_POOLS: "Dwie grupy",
  ELIMINATION_REPECHAGE: "Eliminacja + repasaże",
} as const;

export function getLabel<T extends Record<string, string>>(
  map: T,
  value: string | null | undefined,
  fallback = "-"
): string {
  if (!value) {
    return fallback;
  }

  return map[value as keyof T] ?? value;
}

export const USER_ROLE_LABELS = {
  ORGANIZER: "Organizator",
  ASSISTANT: "Asystent",
  PARTICIPANT: "Uczestnik",
} as const;

export const ROLE_LABELS = USER_ROLE_LABELS;

export const ENTRY_MODE_LABELS = {
  MANAGER: "Organizator + asystenci",
  ORGANIZER_ONLY: "Tylko organizator",
} as const;

export const STAGE_TYPE_LABELS = {
  LEAGUE: "Liga",
  GROUP: "Grupa",
  KNOCKOUT: "Puchar",
  THIRD_PLACE: "Mecz o 3. miejsce",
} as const;

export const PERMISSION_LABELS = {
  teams_edit: "zarządzania uczestnikami",
  schedule_edit: "zarządzania harmonogramem",
  results_edit: "wprowadzania wyników",
  bracket_edit: "zarządzania drabinką",
  tournament_edit: "zarządzania ustawieniami turnieju",
  roster_edit: "zarządzania składami",
  name_change_approve: "zatwierdzania zmian nazw",
  publish: "publikacji turnieju",
  archive: "archiwizacji turnieju",
  manage_assistants: "zarządzania asystentami",
  join_settings: "zarządzania ustawieniami dołączania",
} as const;