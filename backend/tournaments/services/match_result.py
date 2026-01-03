from __future__ import annotations

from typing import Optional, TYPE_CHECKING

from tournaments.models import Match, Stage

if TYPE_CHECKING:
    from tournaments.models import Team


__all__ = ["MatchResultService"]


class MatchResultService:
    """
    Serwis domenowy odpowiedzialny za reakcję systemu na EDYCJĘ WYNIKU
    (PATCH /api/matches/:id/result/).

    Zasady kluczowe:
    - wpisanie/edycja wyniku NIE kończy meczu,
    - status FINISHED ustawiany jest WYŁĄCZNIE przez osobną akcję domenową
      (POST /api/matches/:id/finish/),
    - jeżeli mecz jest już FINISHED, to edycja wyniku NIE powinna cofać statusu
      do IN_PROGRESS (trzymamy FINISHED, ale aktualizujemy winner).
    """

    # ========================================================
    # API PUBLICZNE
    # ========================================================

    @staticmethod
    def apply_result(match: Match) -> None:
        """
        Reaguje na zmianę wyniku meczu.

        - jeśli wynik nie był ruszony (result_entered=False) -> SCHEDULED, winner=None
        - jeśli wynik był ruszony -> IN_PROGRESS + winner zależnie od typu etapu
        - jeśli match.status == FINISHED -> NIE zmieniamy statusu (zostaje FINISHED),
          ale nadal liczymy winner (żeby edycja wyniku aktualizowała zwycięzcę).
        """

        stage_type = match.stage.stage_type

        # 1) Jeśli użytkownik jeszcze nie "dotknął" wyniku -> traktujemy jako brak wyniku
        #    (w Twoim modelu score ma default 0, więc result_entered jest jedyną sensowną flagą)
        if not match.result_entered:
            MatchResultService._set_state(
                match=match,
                winner=None,
                desired_status=Match.Status.SCHEDULED,
            )
            return

        # 2) Ustal winner wg domeny
        if stage_type in (Stage.StageType.LEAGUE, Stage.StageType.GROUP):
            winner = MatchResultService._winner_league_or_group(match)
        elif stage_type == Stage.StageType.KNOCKOUT:
            winner = MatchResultService._winner_knockout(match)
        else:
            raise ValueError(f"Nieobsługiwany typ etapu turnieju: {stage_type}")

        # 3) Status po edycji wyniku:
        #    - jeżeli mecz jest już zakończony, NIE cofamy statusu (zostaje FINISHED)
        #    - w przeciwnym razie IN_PROGRESS
        if match.status == Match.Status.FINISHED:
            desired_status = Match.Status.FINISHED
        else:
            desired_status = Match.Status.IN_PROGRESS

        MatchResultService._set_state(
            match=match,
            winner=winner,
            desired_status=desired_status,
        )

    # ========================================================
    # LOGIKA: WYŁANIANIE ZWYCIĘZCY
    # ========================================================

    @staticmethod
    def _winner_league_or_group(match: Match) -> Optional["Team"]:
        """
        Liga / grupa:
        - remis dozwolony -> winner=None
        """
        if match.home_score > match.away_score:
            return match.home_team
        if match.away_score > match.home_score:
            return match.away_team
        return None

    @staticmethod
    def _winner_knockout(match: Match) -> Optional["Team"]:
        """
        KO:
        - remis = brak rozstrzygnięcia (winner=None)
          (zakończenie meczu KO i walidacja remisu odbywa się w POST /finish/)
        """
        if match.home_score == match.away_score:
            return None
        return match.home_team if match.home_score > match.away_score else match.away_team

    # ========================================================
    # ZAPIS STANU (minimalny, idempotentny)
    # ========================================================

    @staticmethod
    def _set_state(match: Match, *, winner: Optional["Team"], desired_status: str) -> None:
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
