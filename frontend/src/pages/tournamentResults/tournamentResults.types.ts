export type TournamentDTO = {
  id: number;
  name?: string;
  discipline: string;
  tournament_format?: "LEAGUE" | "CUP" | "MIXED";
  participants_count?: number;
  status: "DRAFT" | "CONFIGURED" | "RUNNING" | "FINISHED";

  format_config?: {
    cup_matches?: number; // globalnie 1 albo 2
    cup_matches_by_stage_order?: Record<string, number>; // {"1":2,"2":2,...}
  };
};

export type MatchStageType = "LEAGUE" | "KNOCKOUT" | "GROUP" | "THIRD_PLACE";

export type MatchStatus = "SCHEDULED" | "IN_PROGRESS" | "FINISHED";

export type MatchDTO = {
  id: number;

  stage_id: number;
  stage_order: number;
  stage_type: MatchStageType;

  status: MatchStatus;
  round_number: number | null;

  home_team_name: string;
  away_team_name: string;

  home_score: number;
  away_score: number;
};
