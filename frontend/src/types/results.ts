// Kontrakty typów DTO dla wyników i tabel - używane przez widoki i komponenty, bez logiki UI.

export type MatchStageType = "LEAGUE" | "KNOCKOUT" | "GROUP" | "THIRD_PLACE";

/**
 * Uwaga: backend może zwracać zarówno "IN_PROGRESS" jak i "RUNNING" dla meczu w trakcie.
 */
export type MatchStatus = "SCHEDULED" | "IN_PROGRESS" | "RUNNING" | "FINISHED";

export type TournamentFormat = "LEAGUE" | "CUP" | "MIXED";
export type TournamentStatus = "DRAFT" | "CONFIGURED" | "RUNNING" | "FINISHED";

export type HandballTableDrawMode = "ALLOW_DRAW" | "PENALTIES" | "OVERTIME_PENALTIES";
export type HandballKnockoutTiebreak = "OVERTIME_PENALTIES" | "PENALTIES";

export type TennisSetDTO = {
  home_games: number;
  away_games: number;
  home_tiebreak?: number | null;
  away_tiebreak?: number | null;
};

export type TournamentDTO = {
  id: number;
  name?: string;
  discipline: string;
  tournament_format?: TournamentFormat;
  status: TournamentStatus;
  format_config?: {
    cup_matches?: number;
    cup_matches_by_stage_order?: Record<string, number>;
    handball_table_draw_mode?: HandballTableDrawMode;
    handball_knockout_tiebreak?: HandballKnockoutTiebreak;

    // Zwykle 3 lub 5, ale zostawiamy number dla zgodności z backendem.
    tennis_best_of?: number;
  };
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
};