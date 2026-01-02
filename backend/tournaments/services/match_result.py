from __future__ import annotations

from typing import Optional, TYPE_CHECKING

from tournaments.models import Match, Stage

if TYPE_CHECKING:
    from tournaments.models import Team


class MatchResultService:
    """
    Serwis domenowy odpowiedzialny za zastosowanie wyniku meczu.

    Odpowiedzialności:
    - ocena, czy wynik jest kompletny,
    - wyznaczenie zwycięzcy (jeśli to możliwe),
    - ustawienie statusu meczu.

    Założenie projektowe (pod auto-generowanie etapów):
    - Serwis NIE rzuca błędów za "stan przejściowy" (np. remis w KO).
      Taki stan oznacza po prostu: mecz nie jest rozstrzygnięty,
      więc ma status SCHEDULED i winner=None.
    """

    # ========================================================
    # API PUBLICZNE
    # ========================================================

    @staticmethod
    def apply_result(match: Match) -> None:
        """
        Analizuje wynik meczu i aktualizuje:
        - winner
        - status

        Zasady:
        - Liga / grupa: remis dozwolony -> FINISHED (winner może być None)
        - KO: remis niedozwolony -> mecz pozostaje SCHEDULED (winner=None)
        - Wynik niekompletny -> SCHEDULED (winner=None)
        """

        # Wynik niekompletny -> cofamy rozstrzygnięcie
        if not MatchResultService._is_result_complete(match):
            MatchResultService._set_state(
                match=match,
                winner=None,
                status=Match.Status.SCHEDULED,
            )
            return

        stage_type = match.stage.stage_type

        if stage_type in (Stage.StageType.LEAGUE, Stage.StageType.GROUP):
            MatchResultService._apply_league_or_group(match)
            return

        if stage_type == Stage.StageType.KNOCKOUT:
            MatchResultService._apply_knockout(match)
            return

        raise ValueError(f"Nieobsługiwany typ etapu turnieju: {stage_type}")

    # ========================================================
    # WALIDACJE
    # ========================================================

    @staticmethod
    def _is_result_complete(match: Match) -> bool:
        return match.home_score is not None and match.away_score is not None

    # ========================================================
    # LOGIKA: LIGA / GRUPA
    # ========================================================

    @staticmethod
    def _apply_league_or_group(match: Match) -> None:
        winner: Optional["Team"]

        if match.home_score > match.away_score:
            winner = match.home_team
        elif match.away_score > match.home_score:
            winner = match.away_team
        else:
            winner = None  # remis dozwolony

        MatchResultService._set_state(
            match=match,
            winner=winner,
            status=Match.Status.FINISHED,
        )

    # ========================================================
    # LOGIKA: KO
    # ========================================================

    @staticmethod
    def _apply_knockout(match: Match) -> None:
        # Remis w KO -> nie błąd HTTP, tylko "mecz nierozstrzygnięty"
        if match.home_score == match.away_score:
            MatchResultService._set_state(
                match=match,
                winner=None,
                status=Match.Status.SCHEDULED,
            )
            return

        winner: "Team" = match.home_team if match.home_score > match.away_score else match.away_team

        MatchResultService._set_state(
            match=match,
            winner=winner,
            status=Match.Status.FINISHED,
        )

    # ========================================================
    # ZAPIS STANU
    # ========================================================

    @staticmethod
    def _set_state(match: Match, *, winner: Optional["Team"], status: str) -> None:
        """
        Ustawia stan meczu minimalną liczbą zapisów.
        """
        update_fields: list[str] = []

        new_winner_id = winner.id if winner else None
        if match.winner_id != new_winner_id:
            match.winner = winner
            update_fields.append("winner")

        if match.status != status:
            match.status = status
            update_fields.append("status")

        if update_fields:
            match.save(update_fields=update_fields)
