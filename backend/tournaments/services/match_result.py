# backend/tournaments/services/match_result.py
# Plik udostępnia serwis domenowy odpowiedzialny za reakcję systemu na zmianę wyniku meczu.

from __future__ import annotations

from typing import TYPE_CHECKING, Optional

from tournaments.models import Match, Stage
from tournaments.services.match_outcome import knockout_winner_id, penalty_winner_id

if TYPE_CHECKING:
    from tournaments.models import Team


__all__ = ["MatchResultService"]


def _third_place_value() -> str:
    return getattr(Stage.StageType, "THIRD_PLACE", "THIRD_PLACE")


def _is_knockout_like(stage_type: str) -> bool:
    return str(stage_type) in (str(Stage.StageType.KNOCKOUT), str(_third_place_value()))


def _lower(value: object) -> str:
    return str(value or "").lower()


class MatchResultService:
    @staticmethod
    def apply_result(match: Match) -> None:
        stage_type = match.stage.stage_type
        discipline = _lower(getattr(match.tournament, "discipline", ""))

        # Brak wyniku przywraca stan zaplanowany i usuwa zwycięzcę.
        if not match.result_entered:
            MatchResultService._set_state(
                match=match,
                winner=None,
                desired_status=Match.Status.SCHEDULED,
            )
            return

        # Wyłonienie zwycięzcy zależy od typu etapu i dyscypliny.
        if stage_type in (Stage.StageType.LEAGUE, Stage.StageType.GROUP):
            winner = MatchResultService._winner_league_or_group(match, discipline=discipline)
        elif _is_knockout_like(stage_type):
            winner = MatchResultService._winner_knockout_like(match, discipline=discipline)
        else:
            raise ValueError(f"Nieobsługiwany typ etapu turnieju: {stage_type}")

        # FINISHED zostaje zachowany tylko przy nadal poprawnie wyznaczonym zwycięzcy.
        if match.status == Match.Status.FINISHED and winner is not None:
            desired_status = Match.Status.FINISHED
        else:
            desired_status = Match.Status.IN_PROGRESS

        MatchResultService._set_state(
            match=match,
            winner=winner,
            desired_status=desired_status,
        )

    @staticmethod
    def _winner_league_or_group(match: Match, *, discipline: str) -> Optional["Team"]:
        home_score = int(match.home_score or 0)
        away_score = int(match.away_score or 0)

        if home_score > away_score:
            return match.home_team
        if away_score > home_score:
            return match.away_team

        # Piłka ręczna może rozstrzygać remis karnymi także poza KO.
        if discipline == "handball":
            winner_id = penalty_winner_id(match)
            if winner_id is None:
                return None
            return match.home_team if winner_id == match.home_team_id else match.away_team

        return None

    @staticmethod
    def _winner_knockout_like(match: Match, *, discipline: str) -> Optional["Team"]:
        if discipline == "tennis":
            home_score = int(match.home_score or 0)
            away_score = int(match.away_score or 0)
            if home_score == away_score:
                return None
            return match.home_team if home_score > away_score else match.away_team

        winner_id = knockout_winner_id(match)
        if winner_id is None:
            return None
        return match.home_team if winner_id == match.home_team_id else match.away_team

    @staticmethod
    def _set_state(
        match: Match,
        *,
        winner: Optional["Team"],
        desired_status: str,
    ) -> None:
        update_fields: list[str] = []

        new_winner_id = winner.id if winner else None
        if match.winner_id != new_winner_id:
            match.winner = winner
            update_fields.append("winner")

        if match.status != desired_status:
            match.status = desired_status
            update_fields.append("status")

        if update_fields:
            match.save(update_fields=update_fields)
