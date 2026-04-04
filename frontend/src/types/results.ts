// frontend/src/types/results.ts
// Plik definiuje kontrakty DTO dla wyników, klasyfikacji i rezultatów niestandardowych zwracanych przez backend.

// ===== Typy bazowe =====

export type MatchStageType = "LEAGUE" | "KNOCKOUT" | "GROUP" | "THIRD_PLACE" | "MASS_START";
export type MatchStatus = "SCHEDULED" | "IN_PROGRESS" | "RUNNING" | "FINISHED";

export type TournamentFormat = "LEAGUE" | "CUP" | "MIXED";
export type TournamentStatus = "DRAFT" | "CONFIGURED" | "RUNNING" | "FINISHED";
export type CompetitionType = "TEAM" | "INDIVIDUAL";
export type CompetitionModel = "HEAD_TO_HEAD" | "MASS_START";
export type MassStartStageStatus = "PLANNED" | "OPEN" | "CLOSED";

export type ResultMode = "SCORE" | "CUSTOM";

export type CustomResultValueKind = "NUMBER" | "TIME" | "PLACE";
export type CustomBetterResult = "HIGHER" | "LOWER";
export type CustomTimeFormat = "HH:MM:SS" | "MM:SS" | "MM:SS.hh" | "SS.hh";
export type CustomHeadToHeadMode = "POINTS_TABLE" | "MEASURED_RESULT";
export type CustomAggregationMode = "BEST" | "LAST_ROUND" | "SUM" | "AVERAGE";
export type CustomStandingsMode =
  | "HEAD_TO_HEAD_POINTS"
  | "HEAD_TO_HEAD_MEASURED"
  | "MASS_START_MEASURED";
export type StandingsTableSchema =
  | "DEFAULT"
  | "TENNIS"
  | "CUSTOM"
  | "CUSTOM_POINTS"
  | "CUSTOM_MEASURED_HEAD_TO_HEAD"
  | "CUSTOM_MEASURED_MASS_START";

export type HandballTableDrawMode = "ALLOW_DRAW" | "PENALTIES" | "OVERTIME_PENALTIES";
export type HandballKnockoutTiebreak = "OVERTIME_PENALTIES" | "PENALTIES";

// ===== Konfiguracja turnieju =====

export type TennisSetDTO = {
  home_games: number;
  away_games: number;
  home_tiebreak?: number | null;
  away_tiebreak?: number | null;
};

export type TournamentFormatConfigDTO = {
  cup_matches?: number;
  cup_matches_by_stage_order?: Record<string, number>;
  handball_table_draw_mode?: HandballTableDrawMode;
  handball_knockout_tiebreak?: HandballKnockoutTiebreak;
  tennis_best_of?: number;
  tennis_points_mode?: "NONE" | "PLT";
};

export type TournamentResultConfigDTO = {
  // Pole legacy używane w części obecnego frontu.
  value_kind?: CustomResultValueKind;

  // Pola rozróżniające tryb HEAD_TO_HEAD i MASS_START po stronie backendu.
  head_to_head_mode?: CustomHeadToHeadMode;
  measured_value_kind?: CustomResultValueKind;
  mass_start_value_kind?: CustomResultValueKind;

  unit?: string;
  unit_label?: string;
  better_result?: CustomBetterResult;
  decimal_places?: number | null;
  time_format?: CustomTimeFormat | null;
  allow_ties?: boolean;
  aggregation_mode?: CustomAggregationMode;
};

export type TournamentDTO = {
  id: number;
  name?: string;
  discipline: string;
  custom_discipline_name?: string | null;
  competition_type?: CompetitionType;
  competition_model?: CompetitionModel;
  tournament_format?: TournamentFormat;
  status: TournamentStatus;
  result_mode?: ResultMode;
  my_role?: "ORGANIZER" | "ASSISTANT" | "PARTICIPANT" | null;
  format_config?: TournamentFormatConfigDTO;
  result_config?: TournamentResultConfigDTO;
};

// ===== Wyniki meczowe =====

export type MatchCustomResultDTO = {
  id: number;
  team_id: number;
  team_name: string;
  value_kind: CustomResultValueKind;
  numeric_value?: string | null;
  time_ms?: number | null;
  place_value?: number | null;
  display_value: string;
  rank?: number | null;
  is_active: boolean;
  sort_value?: string | number | null;
};

export type MatchDTO = {
  id: number;
  stage_id: number;
  stage_order: number;
  stage_type: MatchStageType;
  group_name?: string | null;
  status: MatchStatus;
  round_number: number | null;
  home_team_id?: number;
  away_team_id?: number;
  home_team_name: string | null;
  away_team_name: string | null;
  home_score: number | null;
  away_score: number | null;
  tennis_sets?: TennisSetDTO[] | null;
  went_to_extra_time?: boolean;
  home_extra_time_score?: number | null;
  away_extra_time_score?: number | null;
  decided_by_penalties?: boolean;
  home_penalty_score?: number | null;
  away_penalty_score?: number | null;
  result_entered?: boolean;
  winner_id?: number | null;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  location?: string | null;
  is_technical?: boolean;
  uses_custom_results?: boolean;
  custom_results?: MatchCustomResultDTO[];
};

// ===== Rezultaty etapowe MASS_START =====

export type MassStartRoundResultDTO = {
  round_number: number;
  result_id: number | null;
  numeric_value?: string | null;
  time_ms?: number | null;
  place_value?: number | null;
  display_value?: string | null;
  rank?: number | null;
  is_active: boolean;
};

export type MassStartEntryDTO = {
  team_id: number;
  team_name: string;
  group_id: number | null;
  rank?: number | null;
  aggregate_value?: string | number | null;
  aggregate_display?: string | null;
  rounds: MassStartRoundResultDTO[];
};

export type MassStartGroupDTO = {
  group_id: number;
  group_name: string;
  entries: MassStartEntryDTO[];
};

export type MassStartStageDTO = {
  stage_id: number;
  stage_order: number;
  stage_name: string;
  stage_status?: MassStartStageStatus;
  groups_count: number;
  participants_count?: number | null;
  advance_count?: number | null;
  rounds_count: number;
  aggregation_mode: string;
  groups: MassStartGroupDTO[];
};

export type TournamentMassStartResultsResponseDTO = {
  tournament_id: number;
  competition_model: CompetitionModel;
  value_kind?: CustomResultValueKind;
  unit_label?: string;
  allow_ties?: boolean;
  stages: MassStartStageDTO[];
};

export type StageMassStartResultWriteDTO = {
  stage_id: number;
  group_id?: number | null;
  team_id: number;
  round_number: number;
  numeric_value?: string;
  time_ms?: number;
  place_value?: number;
};

export type AdvanceMassStartStageResponseDTO = {
  detail: string;
  stage_id: number;
};

// ===== Klasyfikacja i drabinka =====

export type StandingsRowDTO = {
  team_id: number;
  team_name: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  games_for?: number;
  games_against?: number;
  games_difference?: number;
  sets_for?: number;
  sets_against?: number;
  sets_diff?: number;
  games_diff?: number;
  rank?: number | null;

  is_custom_result?: boolean;
  custom_mode?: CustomStandingsMode | null;
  custom_value_kind?: CustomResultValueKind | null;
  custom_result_numeric?: string | null;
  custom_result_time_ms?: number | null;
  custom_result_place?: number | null;
  custom_result_display?: string | null;
};

export type StandingsGroupDTO = {
  group_id: number;
  group_name: string;
  table: StandingsRowDTO[];
};

export type StandingsMetaDTO = {
  discipline: string;
  competition_type?: CompetitionType;
  competition_model?: CompetitionModel;
  tournament_format?: TournamentFormat;
  result_mode?: ResultMode;
  table_schema?: StandingsTableSchema;
  tennis_points_mode?: "NONE" | "PLT";

  custom_discipline_name?: string | null;
  custom_mode?: CustomStandingsMode;
  custom_value_kind?: CustomResultValueKind | null;

  result_config?: TournamentResultConfigDTO;
  format_config?: TournamentFormatConfigDTO;

  shows_points_table?: boolean;
  shows_result_ranking?: boolean;
};

export type KnockoutBracketTeamDTO = {
  team_id?: number | null;
  team_name?: string | null;
};

export type KnockoutBracketMatchDTO = {
  id: number;
  stage_id?: number;
  round_number?: number | null;
  status?: MatchStatus;
  winner_id?: number | null;
  home_team?: KnockoutBracketTeamDTO | null;
  away_team?: KnockoutBracketTeamDTO | null;
  home_score?: number | null;
  away_score?: number | null;
  label?: string;
};

export type KnockoutBracketRoundDTO = {
  key: string;
  label: string;
  matches: KnockoutBracketMatchDTO[];
};

export type KnockoutBracketDTO = {
  rounds: KnockoutBracketRoundDTO[];
};

export type TournamentStandingsResponseDTO = {
  meta: StandingsMetaDTO;
  table?: StandingsRowDTO[];
  groups?: StandingsGroupDTO[];
  bracket?: KnockoutBracketDTO;
};

// ===== Zapis wyników custom dla meczów =====

export type MatchCustomResultWriteDTO = {
  team_id: number;
  numeric_value?: string;
  time_ms?: number;
  place_value?: number;
  is_active?: boolean;
};

export type MatchCustomResultWriteResponseDTO = {
  detail: string;
  match: MatchDTO;
  custom_results: MatchCustomResultDTO[];
};