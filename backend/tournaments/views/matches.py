from __future__ import annotations

from typing import Optional, Tuple, List

from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404

from rest_framework import status
from rest_framework.generics import ListAPIView, RetrieveUpdateAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from tournaments.services.match_result import MatchResultService
from tournaments.services.match_outcome import (
    knockout_winner_id,
    validate_extra_time_consistency,
    validate_penalties_consistency,
)

from ..models import Match, Stage, Team, Tournament
from ..serializers import MatchResultUpdateSerializer, MatchSerializer
from ._helpers import (
    user_can_manage_tournament,
    _get_cup_matches,
    _sync_two_leg_pair_winner_if_possible,
    _knockout_downstream_stages,
    _knockout_downstream_has_results,
    _soft_propagate_knockout_winner_change,
    rollback_knockout_after_stage,
    _try_auto_advance_knockout,
)


# ============================================================
# Lokalne helpers (KO/3 miejsce + dwumecz)
# ============================================================

def _third_place_value() -> str:
    """Safely retrieves the value for Third Place stage type."""
    return getattr(Stage.StageType, "THIRD_PLACE", "THIRD_PLACE")


def _is_third_place_stage(stage: Stage) -> bool:
    return str(stage.stage_type) == str(_third_place_value())


def _pair_key_ids(home_id: int, away_id: int) -> Tuple[int, int]:
    return (home_id, away_id) if home_id < away_id else (away_id, home_id)


def _get_pair_matches(stage: Stage, match: Match) -> List[Match]:
    """
    Zwraca mecze należące do tej samej pary (Home vs Away lub Away vs Home).
    Optimized: Filters at DB level instead of fetching all stage matches.
    """
    if not match.home_team_id or not match.away_team_id:
        return [match]

    # Szukamy meczów A vs B lub B vs A w tym samym etapie
    qs = Match.objects.filter(
        Q(home_team_id=match.home_team_id, away_team_id=match.away_team_id) |
        Q(home_team_id=match.away_team_id, away_team_id=match.home_team_id),
        stage=stage
    ).only(
        "id",
        "status",
        "winner_id",
        "home_team_id",
        "away_team_id",
        "home_score",
        "away_score",
    )
    return list(qs)


def _pair_is_complete_two_leg(group: List[Match]) -> bool:
    return len(group) == 2 and all(m.status == Match.Status.FINISHED for m in group)


def _pair_winner_id(group: List[Match]) -> Optional[int]:
    """
    Zakładamy, że _sync_two_leg_pair_winner_if_possible ustawia winner_id na OBU meczach pary.
    """
    if not group:
        return None
    ids = {m.winner_id for m in group}
    # Jeśli w zbiorze jest None (brak rozstrzygnięcia w jednym z meczów) -> brak winnera pary
    if None in ids:
        return None
    # Jeśli jest dokładnie 1 unikalne ID (i nie jest to None), to mamy zwycięzcę
    if len(ids) == 1:
        return next(iter(ids))
    return None


def _score_winner_id(match: Match) -> Optional[int]:
    """
    Zwycięzca wynikający z wyniku (jeśli nie remis i mamy komplet danych).
    Stosowane głównie przy PATCH, jako pomocnicze wyliczenie przed finalizacją.
    """
    if match.home_score is None or match.away_score is None:
        return None
    if match.home_score == match.away_score:
        return None
    return match.home_team_id if match.home_score > match.away_score else match.away_team_id


def _rollback_or_propagate_after_winner_change(
        *,
        tournament: Tournament,
        stage: Stage,
        old_winner_id: Optional[int],
        new_winner_id: Optional[int],
) -> None:
    """
    Rollback/propagacja dotyczy tylko głównego KO (nie 3 miejsca).
    """
    if stage.stage_type != Stage.StageType.KNOCKOUT:
        return

    if old_winner_id == new_winner_id:
        return

    if not _knockout_downstream_stages(tournament, stage.order).exists():
        return

    # Jeśli nie ma już rozstrzygnięcia -> downstream jest nieważny (Rollback)
    if new_winner_id is None:
        rollback_knockout_after_stage(stage)
        return

    # Jeśli downstream ma już wyniki -> nie możemy bezpiecznie podmienić drużyny -> Rollback
    if _knockout_downstream_has_results(tournament, stage.order):
        rollback_knockout_after_stage(stage)
        return

    # Próba miękkiej propagacji (podmiana drużyny w 'Next Match')
    new_team = Team.objects.filter(pk=new_winner_id).first()
    try:
        _soft_propagate_knockout_winner_change(
            tournament=tournament,
            after_order=stage.order,
            old_team_id=old_winner_id,
            new_team=new_team,
        )
    except ValueError:
        rollback_knockout_after_stage(stage)


# ============================================================
# Views
# ============================================================

class TournamentMatchListView(ListAPIView):
    serializer_class = MatchSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        tournament = get_object_or_404(Tournament, pk=self.kwargs["pk"])
        if not user_can_manage_tournament(self.request.user, tournament):
            return Match.objects.none()

        return (
            Match.objects.filter(tournament=tournament)
            .select_related("home_team", "away_team", "stage")
            .order_by("stage__order", "round_number", "id")
        )


class MatchScheduleUpdateView(RetrieveUpdateAPIView):
    queryset = Match.objects.all()
    serializer_class = MatchSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        return Match.objects.filter(
            Q(tournament__organizer=user) | Q(tournament__memberships__user=user)
        ).distinct()

    def update(self, request, *args, **kwargs):
        allowed_fields = {"scheduled_date", "scheduled_time", "location"}
        data = {k: v for k, v in request.data.items() if k in allowed_fields}

        serializer = self.get_serializer(self.get_object(), data=data, partial=True)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)

        return Response(serializer.data, status=status.HTTP_200_OK)


class MatchResultUpdateView(RetrieveUpdateAPIView):
    """
    PATCH /api/matches/<pk>/result/

    Zasada:
    - FINISHED ustawiamy wyłącznie w /finish/
    - KO:
      * cup_matches=1: remis dozwolony, winner może być None (wybierany przy /finish/)
      * cup_matches=2: winner wyliczamy dopiero z agregatu, gdy oba mecze FINISHED
    """
    serializer_class = MatchResultUpdateSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        return (
            Match.objects.filter(
                Q(tournament__organizer=user) | Q(tournament__memberships__user=user)
            )
            .select_related("stage", "tournament")
            .distinct()
        )

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        match = self.get_object()
        stage = match.stage
        tournament = match.tournament

        old_winner_id = match.winner_id
        old_status = match.status

        serializer = self.get_serializer(match, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)

        # Blokada ustawiania statusu FINISHED przez PATCH
        validated_status = serializer.validated_data.get('status')
        if validated_status == Match.Status.FINISHED and old_status != Match.Status.FINISHED:
            # Wymuszamy zachowanie starego statusu przy zapisie, aby uniknąć "migania" w bazie
            match = serializer.save(status=old_status)
        else:
            match = serializer.save()

        cup_matches = _get_cup_matches(tournament)
        is_knockout_like = stage.stage_type == Stage.StageType.KNOCKOUT or _is_third_place_stage(stage)

        # 1) Liga / grupa – standard (remis dozwolony)
        if stage.stage_type in (Stage.StageType.LEAGUE, Stage.StageType.GROUP):
            try:
                MatchResultService.apply_result(match)
            except Exception:
                pass
            return Response(MatchSerializer(match).data, status=status.HTTP_200_OK)

        # 2) KO / 3 miejsce
        if is_knockout_like:
            # ---- cup_matches=1: jeżeli nie remis -> ustaw winner wg wyniku
            if cup_matches == 1:
                winner_id = _score_winner_id(match)

                # Aktualizuj zwycięzcę tylko jeśli się zmienił
                if winner_id is not None and winner_id != match.winner_id:
                    match.winner_id = winner_id
                    match.save(update_fields=["winner"])

                # rollback/propagacja tylko dla głównego KO
                _rollback_or_propagate_after_winner_change(
                    tournament=tournament,
                    stage=stage,
                    old_winner_id=old_winner_id,
                    new_winner_id=match.winner_id,
                )

                if stage.stage_type == Stage.StageType.KNOCKOUT and tournament.status != Tournament.Status.FINISHED:
                    _try_auto_advance_knockout(stage)

                return Response(MatchSerializer(match).data, status=status.HTTP_200_OK)

            # ---- cup_matches=2: po zmianie wyniku przelicz agregat TYLKO jeśli oba mecze FINISHED
            elif cup_matches == 2:
                # Pobierz zwycięzcę pary PRZED aktualizacją agregatu
                old_pair_winner = _pair_winner_id(_get_pair_matches(stage, match))

                # Przelicz agregat (to może zaktualizować winner_id w bazie dla obu meczów)
                _sync_two_leg_pair_winner_if_possible(stage, tournament, match)

                # Pobierz zwycięzcę PO aktualizacji
                new_pair_winner = _pair_winner_id(_get_pair_matches(stage, match))

                _rollback_or_propagate_after_winner_change(
                    tournament=tournament,
                    stage=stage,
                    old_winner_id=old_pair_winner,
                    new_winner_id=new_pair_winner,
                )

                if stage.stage_type == Stage.StageType.KNOCKOUT and tournament.status != Tournament.Status.FINISHED:
                    _try_auto_advance_knockout(stage)

                return Response(MatchSerializer(match).data, status=status.HTTP_200_OK)

        return Response(MatchSerializer(match).data, status=status.HTTP_200_OK)


class FinishMatchView(APIView):
    """
    POST /api/matches/<pk>/finish/

    Zasady:
    - FINISHED ustawiamy wyłącznie tutaj.
    - KO/3 miejsce:
      * cup_matches=1: Remis w czasie regulaminowym wymaga dogrywki/karnych.
      * cup_matches=2: Remis w meczu dozwolony, ale po 2 meczach agregat musi wyłonić winner.
    """
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, *args, **kwargs):
        match_id = kwargs.get("pk") or kwargs.get("id")
        if not match_id:
            return Response({"detail": "Brak identyfikatora meczu."}, status=status.HTTP_400_BAD_REQUEST)

        match = get_object_or_404(
            Match.objects.select_related("stage", "tournament", "home_team", "away_team"),
            pk=match_id,
        )
        tournament = match.tournament
        stage = match.stage

        if not user_can_manage_tournament(request.user, tournament):
            return Response({"detail": "Brak uprawnień."}, status=status.HTTP_403_FORBIDDEN)

        cup_matches = _get_cup_matches(tournament)
        is_knockout_like = stage.stage_type == Stage.StageType.KNOCKOUT or _is_third_place_stage(stage)

        # ===============================
        # LIGA / GRUPA
        # ===============================
        if stage.stage_type in (Stage.StageType.LEAGUE, Stage.StageType.GROUP):
            try:
                MatchResultService.apply_result(match)
            except Exception:
                pass

            match.status = Match.Status.FINISHED
            match.save(update_fields=["status"])
            return Response({"detail": "Mecz zakończony."}, status=status.HTTP_200_OK)

        # ===============================
        # KO + 3 miejsce
        # ===============================
        if is_knockout_like:
            if not match.result_entered:
                return Response(
                    {"detail": "Nie można zakończyć meczu KO bez wprowadzenia wyniku."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if match.home_score is None or match.away_score is None:
                return Response(
                    {"detail": "Brak kompletnego wyniku — uzupełnij bramki/punkty."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            # ---- cup_matches=1: jeden mecz, musi być zwycięzca
            if cup_matches == 1:
                err = validate_extra_time_consistency(match) or validate_penalties_consistency(match)
                if err:
                    return Response({"detail": err}, status=status.HTTP_400_BAD_REQUEST)

                winner_id = knockout_winner_id(match)
                if winner_id is None:
                    return Response(
                        {"detail": "Mecz pucharowy musi mieć zwycięzcę: jeśli remis po dogrywce, wprowadź karne."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                old_winner_id = match.winner_id
                match.winner_id = winner_id
                match.status = Match.Status.FINISHED
                match.save(update_fields=["winner", "status"])

                _rollback_or_propagate_after_winner_change(
                    tournament=tournament,
                    stage=stage,
                    old_winner_id=old_winner_id,
                    new_winner_id=match.winner_id,
                )

                if stage.stage_type == Stage.StageType.KNOCKOUT and tournament.status != Tournament.Status.FINISHED:
                    _try_auto_advance_knockout(stage)

                return Response({"detail": "Mecz zakończony."}, status=status.HTTP_200_OK)

            # ---- cup_matches=2: winner dopiero po agregacie (po 2. meczu)
            elif cup_matches == 2:
                old_pair_winner = _pair_winner_id(_get_pair_matches(stage, match))

                # 1. Oznaczamy bieżący mecz jako FINISHED (wstępnie)
                if match.status != Match.Status.FINISHED:
                    match.status = Match.Status.FINISHED
                    match.save(update_fields=["status"])

                # 2. Przeliczamy agregat dwumeczu
                # Funkcja ta powinna ustawić winner_id w obu meczach, jeśli para jest rozstrzygnięta
                _sync_two_leg_pair_winner_if_possible(stage, tournament, match)

                # 3. Sprawdzamy czy dwumecz jest kompletny i rozstrzygnięty
                group = _get_pair_matches(stage, match)

                if _pair_is_complete_two_leg(group):
                    new_pair_winner = _pair_winner_id(group)
                    if not new_pair_winner:
                        # Agregat remisowy -> COFAMY zakończenie meczu.
                        # Użytkownik musi zmienić wynik (karne/dogrywka w rewanżu).
                        match.status = Match.Status.SCHEDULED
                        match.save(update_fields=["status"])

                        return Response(
                            {
                                "detail": "Dwumecz musi być rozstrzygnięty. Zmień wynik rewanżu (agregat nie może być remisowy)."},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                else:
                    # Jeśli to dopiero pierwszy mecz lub drugi jeszcze nie finished (teoretycznie niemożliwe tu),
                    # to winner pary to None.
                    new_pair_winner = None

                # 4. Propagacja (jeśli para rozstrzygnięta)
                _rollback_or_propagate_after_winner_change(
                    tournament=tournament,
                    stage=stage,
                    old_winner_id=old_pair_winner,
                    new_winner_id=new_pair_winner,
                )

                if stage.stage_type == Stage.StageType.KNOCKOUT and tournament.status != Tournament.Status.FINISHED:
                    _try_auto_advance_knockout(stage)

                return Response({"detail": "Mecz zakończony."}, status=status.HTTP_200_OK)

        return Response({"detail": "Nieobsługiwany typ etapu."}, status=status.HTTP_400_BAD_REQUEST)