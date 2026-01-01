from __future__ import annotations

from tournaments.models import Match, Stage


class MatchResultService:
    """
    Serwis domenowy odpowiedzialny za zastosowanie wyniku meczu.

    Odpowiedzialności:
    - walidacja poprawności wyniku,
    - ustawienie statusu meczu,
    - wyznaczenie zwycięzcy (jeśli dotyczy).

    Serwis NIE:
    - generuje kolejnych etapów,
    - nie modyfikuje struktury turnieju,
    - nie komunikuje się z API.
    """

    # ========================================================
    # API PUBLICZNE
    # ========================================================

    @staticmethod
    def apply_result(match: Match) -> None:
        """
        Analizuje wynik meczu i stosuje odpowiednią logikę
        zależną od typu etapu turnieju.

        - Liga / grupa → remis dozwolony
        - Puchar (KO) → remis niedozwolony
        """

        # Brak kompletnego wyniku → brak akcji
        if not MatchResultService._is_result_complete(match):
            return

        stage_type = match.stage.stage_type

        if stage_type in (Stage.StageType.LEAGUE, Stage.StageType.GROUP):
            MatchResultService._apply_league_or_group(match)
            return

        if stage_type == Stage.StageType.KNOCKOUT:
            MatchResultService._apply_knockout(match)
            return

        # Zabezpieczenie na przyszłość
        raise ValueError(
            f"Nieobsługiwany typ etapu turnieju: {stage_type}"
        )

    # ========================================================
    # WALIDACJE
    # ========================================================

    @staticmethod
    def _is_result_complete(match: Match) -> bool:
        """
        Sprawdza, czy wynik meczu jest kompletny.
        """
        return (
            match.home_score is not None
            and match.away_score is not None
        )

    # ========================================================
    # LOGIKA: LIGA / GRUPA
    # ========================================================

    @staticmethod
    def _apply_league_or_group(match: Match) -> None:
        """
        Zastosowanie wyniku w lidze lub fazie grupowej.
        Remis jest dozwolony.
        """

        if match.home_score > match.away_score:
            winner = match.home_team
        elif match.away_score > match.home_score:
            winner = match.away_team
        else:
            winner = None  # remis

        MatchResultService._finalize_match(
            match=match,
            winner=winner,
        )

    # ========================================================
    # LOGIKA: PUCHAR (KO)
    # ========================================================

    @staticmethod
    def _apply_knockout(match: Match) -> None:
        """
        Zastosowanie wyniku w fazie pucharowej.
        Remis jest niedozwolony.
        """

        if match.home_score == match.away_score:
            raise ValueError(
                "Remis w fazie pucharowej jest niedozwolony."
            )

        winner = (
            match.home_team
            if match.home_score > match.away_score
            else match.away_team
        )

        MatchResultService._finalize_match(
            match=match,
            winner=winner,
        )

    # ========================================================
    # FINALIZACJA MECZU
    # ========================================================

    @staticmethod
    def _finalize_match(match: Match, winner) -> None:
        """
        Kończy mecz:
        - ustawia zwycięzcę,
        - ustawia status FINISHED,
        - zapisuje zmiany atomowo.
        """

        match.winner = winner
        match.status = Match.Status.FINISHED

        match.save(
            update_fields=[
                "winner",
                "status",
            ]
        )
