# backend/tournaments/services/match_result.py
# Plik udostępnia serwis domenowy odpowiedzialny za reakcję systemu na zmianę wyniku meczu.

from __future__ import annotations

from typing import TYPE_CHECKING, Optional

from tournaments.models import Match, Stage
from tournaments.services.match_outcome import final_score, knockout_winner_id, penalty_winner_id

if TYPE_CHECKING:
    from tournaments.models import Team


__all__ = ["MatchResultService"]


WRESTLING_DOMINANT_RESULT_CODES = {"VFA", "VIN", "VFO", "DSQ", "VCA"}
WRESTLING_TECH_SUPERIORITY_CODES = {"VSU", "VSU1", "VSU2"}
WRESTLING_POINTS_WIN_CODES = {"VPO", "VPO1", "VPO2"}


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

        # Brak wyniku przywraca stan zaplanowany i usuwa zwycięzcę oraz klasyfikację specjalną.
        if not match.result_entered:
            MatchResultService._set_state(
                match=match,
                winner=None,
                desired_status=Match.Status.SCHEDULED,
                home_classification_points=None,
                away_classification_points=None,
            )
            return

        if discipline == "wrestling":
            winner = MatchResultService._winner_wrestling(match)
            home_cp, away_cp = MatchResultService._classification_points_wrestling(match, winner)
        else:
            home_cp = None
            away_cp = None

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
            home_classification_points=home_cp,
            away_classification_points=away_cp,
        )

    @staticmethod
    def _winner_league_or_group(match: Match, *, discipline: str) -> Optional["Team"]:
        # Wynik końcowy uwzględnia dogrywkę, jeśli dana dyscyplina ją dopuszcza.
        home_final, away_final = final_score(match)

        if home_final > away_final:
            return match.home_team
        if away_final > home_final:
            return match.away_team

        # Piłka ręczna może rozstrzygać remis karnymi także poza KO.
        if discipline == "handball":
            winner_id = penalty_winner_id(match)
            if winner_id is None:
                return None
            return match.home_team if winner_id == match.home_team_id else match.away_team

        # Koszykówka nie powinna kończyć się remisem po wyniku końcowym.
        # Pozostawienie None utrzymuje mecz poza stanem FINISHED, jeśli dane są niespójne.
        return None

    @staticmethod
    def _winner_knockout_like(match: Match, *, discipline: str) -> Optional["Team"]:
        if discipline == "tennis":
            home_final, away_final = final_score(match)
            if home_final == away_final:
                return None
            return match.home_team if home_final > away_final else match.away_team

        winner_id = knockout_winner_id(match)
        if winner_id is None:
            return None
        return match.home_team if winner_id == match.home_team_id else match.away_team

    @staticmethod
    def _wrestling_style(match: Match) -> str:
        division = getattr(match.stage, "division", None)
        if division is not None and hasattr(division, "get_wrestling_style"):
            return str(division.get_wrestling_style() or "").upper()

        tournament = getattr(match, "tournament", None)
        if tournament is not None and hasattr(tournament, "get_wrestling_style"):
            return str(tournament.get_wrestling_style() or "").upper()

        return "FREESTYLE"

    @staticmethod
    def _wrestling_superiority_threshold(match: Match) -> int:
        return 8 if MatchResultService._wrestling_style(match) == "GRECO_ROMAN" else 10

    @staticmethod
    def _winner_wrestling(match: Match) -> Optional["Team"]:
        if match.winner_id == match.home_team_id:
            return match.home_team
        if match.winner_id == match.away_team_id:
            return match.away_team

        home_final, away_final = final_score(match)
        if home_final > away_final:
            return match.home_team
        if away_final > home_final:
            return match.away_team

        return None

    @staticmethod
    def _classification_points_wrestling(
        match: Match,
        winner: Optional["Team"],
    ) -> tuple[int | None, int | None]:
        if winner is None:
            return (None, None)

        home_final, away_final = final_score(match)
        method = str(getattr(match, "wrestling_result_method", "") or "").upper().strip()

        home_won = winner.id == match.home_team_id
        loser_points = away_final if home_won else home_final

        if method in WRESTLING_DOMINANT_RESULT_CODES:
            return (5, 0) if home_won else (0, 5)

        if method in WRESTLING_TECH_SUPERIORITY_CODES:
            winner_cp = 4
            loser_cp = 1 if loser_points > 0 else 0
            return (winner_cp, loser_cp) if home_won else (loser_cp, winner_cp)

        if method in WRESTLING_POINTS_WIN_CODES:
            winner_cp = 3
            loser_cp = 1 if loser_points > 0 else 0
            return (winner_cp, loser_cp) if home_won else (loser_cp, winner_cp)

        diff = abs(home_final - away_final)
        if diff >= MatchResultService._wrestling_superiority_threshold(match):
            winner_cp = 4
            loser_cp = 1 if loser_points > 0 else 0
            return (winner_cp, loser_cp) if home_won else (loser_cp, winner_cp)

        winner_cp = 3
        loser_cp = 1 if loser_points > 0 else 0
        return (winner_cp, loser_cp) if home_won else (loser_cp, winner_cp)

    @staticmethod
    def _set_state(
        match: Match,
        *,
        winner: Optional["Team"],
        desired_status: str,
        home_classification_points: int | None = None,
        away_classification_points: int | None = None,
    ) -> None:
        update_fields: list[str] = []

        new_winner_id = winner.id if winner else None
        if match.winner_id != new_winner_id:
            match.winner = winner
            update_fields.append("winner")

        if match.status != desired_status:
            match.status = desired_status
            update_fields.append("status")

        if hasattr(match, "home_classification_points"):
            if match.home_classification_points != home_classification_points:
                match.home_classification_points = home_classification_points
                update_fields.append("home_classification_points")

        if hasattr(match, "away_classification_points"):
            if match.away_classification_points != away_classification_points:
                match.away_classification_points = away_classification_points
                update_fields.append("away_classification_points")

        if update_fields:
            match.save(update_fields=update_fields)
