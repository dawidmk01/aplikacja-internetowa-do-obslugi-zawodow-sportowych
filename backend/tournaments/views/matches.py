from __future__ import annotations

from typing import Optional, Tuple

from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404

from rest_framework import status
from rest_framework.generics import ListAPIView, RetrieveUpdateAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from tournaments.services.match_result import MatchResultService

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
    # Jeśli masz Stage.StageType.THIRD_PLACE jako TextChoices – bierzemy jego value,
    # a jeśli nie – porównujemy do stringa "THIRD_PLACE".
    return getattr(Stage.StageType, "THIRD_PLACE", "THIRD_PLACE")


def _is_third_place_stage(stage: Stage) -> bool:
    return str(stage.stage_type) == str(_third_place_value())


def _pair_key_ids(home_id: int, away_id: int) -> Tuple[int, int]:
    return (home_id, away_id) if home_id < away_id else (away_id, home_id)


def _get_pair_matches(stage: Stage, match: Match) -> list[Match]:
    """
    Zwraca mecze należące do tej samej pary (niezależnie od tego, kto jest gospodarzem).
    """
    key = _pair_key_ids(match.home_team_id, match.away_team_id)
    qs = Match.objects.filter(stage=stage).only(
        "id",
        "status",
        "winner_id",
        "home_team_id",
        "away_team_id",
        "home_score",
        "away_score",
    )
    group = [m for m in qs if _pair_key_ids(m.home_team_id, m.away_team_id) == key]
    return group


def _pair_is_complete_two_leg(group: list[Match]) -> bool:
    return len(group) == 2 and all(m.status == Match.Status.FINISHED for m in group)


def _pair_winner_id(group: list[Match]) -> Optional[int]:
    """
    Zakładamy, że _sync_two_leg_pair_winner_if_possible ustawia winner_id na OBU meczach pary.
    """
    if not group:
        return None
    ids = {m.winner_id for m in group}
    if None in ids:
        return None
    if len(ids) == 1:
        return next(iter(ids))
    return None


def _score_winner_id(match: Match) -> Optional[int]:
    """
    Zwycięzca wynikający z wyniku (jeśli nie remis i mamy komplet danych).
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

    # Jeśli nie ma już rozstrzygnięcia -> downstream jest nieważny
    if new_winner_id is None:
        rollback_knockout_after_stage(stage)
        return

    if _knockout_downstream_has_results(tournament, stage.order):
        rollback_knockout_after_stage(stage)
        return

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
        * cup_matches=1: remis dozwolony, winner może być None (wybierany przy /finish/ jeśli remis)
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
        match = serializer.save()

        cup_matches = _get_cup_matches(tournament)
        is_knockout_like = stage.stage_type == Stage.StageType.KNOCKOUT or _is_third_place_stage(stage)

        # 1) Liga / grupa – standard (remis dozwolony)
        if stage.stage_type in (Stage.StageType.LEAGUE, Stage.StageType.GROUP):
            try:
                MatchResultService.apply_result(match)
            except Exception:
                pass

            # FINISHED nie może wchodzić z PATCH
            if old_status != Match.Status.FINISHED and match.status == Match.Status.FINISHED:
                match.status = old_status
                match.save(update_fields=["status"])

            return Response(MatchSerializer(match).data, status=status.HTTP_200_OK)

        # 2) KO / 3 miejsce
        if is_knockout_like:
            # ---- cup_matches=1: jeżeli nie remis -> ustaw winner wg wyniku; remis zostawia winner bez zmian
            if cup_matches == 1:
                winner_id = _score_winner_id(match)
                if winner_id is not None and winner_id != match.winner_id:
                    match.winner_id = winner_id
                    match.save(update_fields=["winner"])

                # PATCH nie ustawia FINISHED
                if old_status != Match.Status.FINISHED and match.status == Match.Status.FINISHED:
                    match.status = old_status
                    match.save(update_fields=["status"])

                # rollback/propagacja tylko dla głównego KO
                _rollback_or_propagate_after_winner_change(
                    tournament=tournament,
                    stage=stage,
                    old_winner_id=old_winner_id,
                    new_winner_id=match.winner_id,
                )

                # auto-advance może zadziałać, jeśli ktoś edytuje już zakończone mecze
                if stage.stage_type == Stage.StageType.KNOCKOUT and tournament.status != Tournament.Status.FINISHED:
                    _try_auto_advance_knockout(stage)

                return Response(MatchSerializer(match).data, status=status.HTTP_200_OK)

            # ---- cup_matches=2: po zmianie wyniku przelicz agregat TYLKO jeśli oba mecze FINISHED
            old_pair_winner = _pair_winner_id(_get_pair_matches(stage, match))

            _sync_two_leg_pair_winner_if_possible(stage, tournament, match)

            new_pair_winner = _pair_winner_id(_get_pair_matches(stage, match))

            # rollback/propagacja tylko dla głównego KO
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
    - FINISHED ustawiamy wyłącznie tutaj,
    - KO/3 miejsce:
        * cup_matches=1: remis dozwolony, ale wymagamy winner_side=HOME/AWAY (chyba że winner już istnieje)
        * cup_matches=2: remis w meczu dozwolony, ale po 2 meczach agregat musi wyłonić winner;
          jeśli agregat remisowy -> 400 + cofamy zakończenie AKTUALNEGO meczu (status=SCHEDULED)
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
            # remis dozwolony
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

            # ---- cup_matches=1: remis dozwolony, ale wymagamy zwycięzcy
            if cup_matches == 1:
                old_winner_id = match.winner_id

                if match.home_score != match.away_score:
                    # zwycięzca wynika z wyniku
                    match.winner_id = match.home_team_id if match.home_score > match.away_score else match.away_team_id
                else:
                    # remis: winner musi być wytypowany albo już istnieć
                    winner_side = request.data.get("winner_side")

                    if winner_side in ("HOME", "AWAY"):
                        if winner_side == "HOME":
                            match.winner_id = match.home_team_id
                        else:
                            if not match.away_team_id:
                                return Response(
                                    {"detail": "Brak drużyny gości — nie można wskazać zwycięzcy AWAY."},
                                    status=status.HTTP_400_BAD_REQUEST,
                                )
                            match.winner_id = match.away_team_id
                    else:
                        # idempotencja: jeżeli wcześniej już wskazano winner, pozwalamy zakończyć bez ponownego podawania
                        if not match.winner_id:
                            return Response(
                                {"detail": "Remis w KO (1 mecz) wymaga wytypowania zwycięzcy (winner_side=HOME/AWAY)."},
                                status=status.HTTP_400_BAD_REQUEST,
                            )

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
            old_pair_winner = _pair_winner_id(_get_pair_matches(stage, match))

            # oznacz FINISHED (idempotentnie)
            if match.status != Match.Status.FINISHED:
                match.status = Match.Status.FINISHED
                match.save(update_fields=["status"])

            # przelicz agregat jeśli para kompletna
            _sync_two_leg_pair_winner_if_possible(stage, tournament, match)

            group = _get_pair_matches(stage, match)

            if _pair_is_complete_two_leg(group):
                new_pair_winner = _pair_winner_id(group)
                if not new_pair_winner:
                    # agregat remisowy -> NIE pozwalamy zakończyć tego meczu
                    match.status = Match.Status.SCHEDULED
                    match.save(update_fields=["status"])
                    return Response(
                        {"detail": "Dwumecz musi być rozstrzygnięty. Zmień wynik rewanżu (agregat nie może być remisowy)."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
            else:
                new_pair_winner = None

            # rollback/propagacja tylko dla głównego KO
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
