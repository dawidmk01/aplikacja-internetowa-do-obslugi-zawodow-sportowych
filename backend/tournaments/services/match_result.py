from __future__ import annotations

from typing import Optional, TYPE_CHECKING

from tournaments.models import Match, Stage

from tournaments.services.match_outcome import knockout_winner_id, penalty_winner_id

if TYPE_CHECKING:
    from tournaments.models import Team


__all__ = ["MatchResultService"]


def _third_place_value() -> str:
    return getattr(Stage.StageType, "THIRD_PLACE", "THIRD_PLACE")


def _is_knockout_like(stage_type: str) -> bool:
    return str(stage_type) in (str(Stage.StageType.KNOCKOUT), str(_third_place_value()))


def _lower(v: object) -> str:
    return str(v or "").lower()


class MatchResultService:
    """
    Serwis domenowy odpowiedzialny za reakcję systemu na EDYCJĘ WYNIKU
    (PATCH /api/matches/:id/result/).

    Zasady kluczowe:
    - wpisanie/edycja wyniku NIE kończy meczu,
    - status FINISHED ustawiany jest WYŁĄCZNIE przez osobną akcję domenową
      (POST /api/matches/:id/finish/),
    - jeżeli mecz jest już FINISHED, to edycja wyniku może „od-finiszować” mecz,
      jeśli po zmianie nie da się wyznaczyć zwycięzcy (np. tenis: 1:1 po edycji).
      To jest celowe zabezpieczenie spójności danych.
    """

    # ========================================================
    # API PUBLICZNE
    # ========================================================

    @staticmethod
    def apply_result(match: Match) -> None:
        """
        Reaguje na zmianę wyniku meczu.

        - jeśli wynik nie był ruszony (result_entered=False) -> SCHEDULED, winner=None
        - jeśli wynik był ruszony -> IN_PROGRESS + winner zależnie od dyscypliny i typu etapu
        - jeśli match.status == FINISHED:
          - gdy nadal da się wyznaczyć winner -> zostaje FINISHED
          - gdy NIE da się wyznaczyć winner -> cofamy do IN_PROGRESS (spójność)
        """
        stage_type = match.stage.stage_type
        discipline = _lower(getattr(match.tournament, "discipline", ""))

        # 1) Brak wyniku (result_entered=False)
        if not match.result_entered:
            MatchResultService._set_state(
                match=match,
                winner=None,
                desired_status=Match.Status.SCHEDULED,
            )
            return

        # 2) Winner wg domeny
        if stage_type in (Stage.StageType.LEAGUE, Stage.StageType.GROUP):
            winner = MatchResultService._winner_league_or_group(match, discipline=discipline)
        elif _is_knockout_like(stage_type):
            winner = MatchResultService._winner_knockout_like(match, discipline=discipline)
        else:
            raise ValueError(f"Nieobsługiwany typ etapu turnieju: {stage_type}")

        # 3) Status po edycji wyniku:
        #    - standardowo: IN_PROGRESS
        #    - jeżeli było FINISHED i nadal mamy winner -> zostaw FINISHED
        #    - jeżeli było FINISHED i nie mamy winner -> cofamy do IN_PROGRESS (spójność)
        if match.status == Match.Status.FINISHED and winner is not None:
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
    def _winner_league_or_group(match: Match, *, discipline: str) -> Optional["Team"]:
        """
        Liga / grupa:
        - football: remis dozwolony -> winner=None
        - handball: remis może być rozstrzygany karnymi (jeśli podane i różne)
        - tennis: brak remisów w meczu docelowo, ale przy PATCH dopuszczamy częściowy wynik
                 (np. 1:1) -> winner=None
        """
        hs = int(match.home_score or 0)
        aws = int(match.away_score or 0)

        if hs > aws:
            return match.home_team
        if aws > hs:
            return match.away_team

        # remis (score tie)
        if discipline == "handball":
            # jeśli są karne (i rozstrzygają), winner może wynikać z karnych
            wid = penalty_winner_id(match)
            if wid is None:
                return None
            return match.home_team if wid == match.home_team_id else match.away_team

        # football/tennis/pozostałe: remis => brak winner
        return None

    @staticmethod
    def _winner_knockout_like(match: Match, *, discipline: str) -> Optional["Team"]:
        """
        KO / mecz o 3. miejsce:
        - tenis: winner z setów (home_score/away_score), bez ET/karnych
        - pozostałe: winner wg knockout_winner_id (reg+ET, a jeśli remis to karne)
          (uwaga: rozstrzyganie remisu „na twardo” powinno być wymagane dopiero w FINISH,
           ale przy PATCH możemy mieć winner=None jeśli jeszcze nie wpisano karnych).
        """
        if discipline == "tennis":
            hs = int(match.home_score or 0)
            aws = int(match.away_score or 0)
            if hs == aws:
                return None
            return match.home_team if hs > aws else match.away_team

        wid = knockout_winner_id(match)
        if wid is None:
            return None
        return match.home_team if wid == match.home_team_id else match.away_team

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
