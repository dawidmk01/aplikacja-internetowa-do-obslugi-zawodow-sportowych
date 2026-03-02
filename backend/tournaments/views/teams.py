# backend/tournaments/views/teams.py
# Plik obsługuje listę drużyn, edycję, składy oraz wnioski o zmianę nazwy uczestnika.

from __future__ import annotations

from typing import Any, Optional

from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone

from rest_framework import status
from rest_framework.generics import ListAPIView
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from tournaments.access import (
    can_approve_name_changes,
    can_edit_roster,
    can_edit_teams,
    get_membership,
    user_can_view_tournament,
    user_is_registered_participant,
)
from tournaments.models import (
    Match,
    Stage,
    Team,
    TeamPlayer,
    Tournament,
    TournamentRegistration,
    TeamNameChangeRequest,
)
from tournaments.serializers import TeamSerializer, TeamUpdateSerializer, TournamentSerializer
from tournaments.services.match_generation import ensure_matches_generated

from ._helpers import public_access_or_403

BYE_TEAM_NAME = "__SYSTEM_BYE__"


def _norm_name(value: str) -> str:
    return " ".join((value or "").strip().split())


def _tournament_real_started(tournament: Tournament) -> bool:
    # Start liczony jest tylko po realnym meczu, bez technicznego BYE.
    return (
        Match.objects.filter(tournament=tournament)
        .exclude(Q(home_team__name__iexact=BYE_TEAM_NAME) | Q(away_team__name__iexact=BYE_TEAM_NAME))
        .filter(status__in=(Match.Status.IN_PROGRESS, Match.Status.FINISHED))
        .exists()
    )


def _user_owns_team_slot(user, tournament: Tournament, team: Team) -> bool:
    # Własność slotu wynika z rejestracji albo legacy registered_user.
    if not user or not user.is_authenticated:
        return False

    if team.registered_user_id == user.id:
        return True

    return TournamentRegistration.objects.filter(
        tournament=tournament,
        user=user,
        team=team,
    ).exists()


def _resolve_participant_team(
    *,
    tournament: Tournament,
    user,
    payload_team_id: Optional[int],
) -> Team:
    # team_id z payloadu jest dozwolone tylko dla własnego slotu.
    if payload_team_id:
        team = get_object_or_404(Team, pk=payload_team_id, tournament=tournament, is_active=True)
        if team.name == BYE_TEAM_NAME:
            raise ValueError("Nie można zmieniać nazwy BYE.")
        if not _user_owns_team_slot(user, tournament, team):
            raise PermissionError("To nie jest Twój slot uczestnika.")
        return team

    reg = (
        TournamentRegistration.objects.filter(tournament=tournament, user=user)
        .select_related("team")
        .first()
    )
    if reg and reg.team_id:
        team = get_object_or_404(Team, pk=reg.team_id, tournament=tournament, is_active=True)
        if team.name == BYE_TEAM_NAME:
            raise ValueError("Nie można zmieniać nazwy BYE.")
        return team

    team = (
        Team.objects.filter(tournament=tournament, registered_user=user, is_active=True)
        .exclude(name=BYE_TEAM_NAME)
        .order_by("id")
        .first()
    )
    if team:
        return team

    raise LookupError("Brak przypisanego uczestnika (team).")


def _roster_feature_enabled(tournament: Tournament) -> bool:
    return tournament.competition_type == Tournament.CompetitionType.TEAM


def _allow_team_owner_roster_edit(tournament: Tournament) -> bool:
    # Domyślnie właściciel drużyny nie edytuje składu bez jawnego włączenia.
    cfg = tournament.format_config or {}
    return bool(cfg.get("allow_team_owner_roster_edit", False))


def _roster_max_players(tournament: Tournament) -> Optional[int]:
    cfg = tournament.format_config or {}
    raw = cfg.get("roster_max_players")
    if raw is None:
        return None

    try:
        value = int(raw)
    except (TypeError, ValueError):
        return None

    return value if value > 0 else None


def _can_edit_team_roster(user, tournament: Tournament, team: Team) -> bool:
    if can_edit_roster(user, tournament):
        return True

    if _allow_team_owner_roster_edit(tournament) and _user_owns_team_slot(user, tournament, team):
        return True

    return False


def _serialize_player(player: TeamPlayer) -> dict[str, Any]:
    return {
        "id": player.id,
        "team_id": player.team_id,
        "display_name": player.display_name,
        "jersey_number": player.jersey_number,
        "is_active": player.is_active,
        "created_at": player.created_at,
        "updated_at": player.updated_at,
    }


class TournamentTeamListView(ListAPIView):
    serializer_class = TeamSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        tournament = get_object_or_404(Tournament, pk=self.kwargs["pk"])

        if not user_can_view_tournament(self.request.user, tournament):
            return Team.objects.none()

        return (
            tournament.teams.filter(is_active=True)
            .exclude(name=BYE_TEAM_NAME)
            .order_by("id")
        )


class TournamentTeamUpdateView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk, team_id):
        tournament = get_object_or_404(Tournament, pk=pk)

        # Zmiana nazwy drużyny wymaga teams_edit.
        if not can_edit_teams(request.user, tournament):
            return Response(
                {"detail": "Nie masz uprawnień do edycji drużyn/uczestników. Dostępny jest tylko podgląd."},
                status=status.HTTP_403_FORBIDDEN,
            )

        team = get_object_or_404(
            Team,
            pk=team_id,
            tournament=tournament,
            is_active=True,
        )

        if team.name == BYE_TEAM_NAME:
            return Response(
                {"detail": "Nie można edytować zespołu technicznego BYE."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = TeamUpdateSerializer(team, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()

        return Response(TeamSerializer(team).data, status=status.HTTP_200_OK)


class TournamentTeamSetupView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, pk):
        tournament = get_object_or_404(Tournament, pk=pk)

        if not can_edit_teams(request.user, tournament):
            return Response(
                {"detail": "Nie masz uprawnień do edycji drużyn/uczestników. Dostępny jest tylko podgląd."},
                status=status.HTTP_403_FORBIDDEN,
            )

        is_organizer = tournament.organizer_id == request.user.id
        is_assistant = get_membership(request.user, tournament) is not None

        if tournament.status == Tournament.Status.FINISHED:
            return Response(
                {"detail": "Nie można zmieniać liczby uczestników w zakończonym turnieju."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        real_started = _tournament_real_started(tournament)

        # Po realnym starcie blokada dotyczy tylko asystenta.
        if is_assistant and real_started:
            return Response(
                {"detail": "Turniej już się rozpoczął - asystent nie może zmieniać liczby uczestników."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        raw_count = request.data.get("teams_count", None)
        if raw_count is None:
            raw_count = request.data.get("participants_count", None)

        try:
            requested_count = int(raw_count)
        except (TypeError, ValueError):
            return Response({"detail": "Nieprawidłowa liczba uczestników."}, status=status.HTTP_400_BAD_REQUEST)

        if requested_count < 2:
            return Response({"detail": "Liczba uczestników musi wynosić co najmniej 2."}, status=status.HTTP_400_BAD_REQUEST)

        Team.objects.filter(tournament=tournament, name=BYE_TEAM_NAME).update(is_active=False)

        active_before = (
            Team.objects.filter(tournament=tournament, is_active=True)
            .exclude(name=BYE_TEAM_NAME)
            .count()
        )
        had_structure = Stage.objects.filter(tournament=tournament).exists()

        all_real_teams = list(tournament.teams.exclude(name=BYE_TEAM_NAME).order_by("id"))
        existing_total = len(all_real_teams)

        name_prefix = (
            "Zawodnik"
            if tournament.competition_type == Tournament.CompetitionType.INDIVIDUAL
            else "Drużyna"
        )

        if existing_total < requested_count:
            Team.objects.bulk_create(
                [
                    Team(tournament=tournament, name=f"{name_prefix} {i}", is_active=True)
                    for i in range(existing_total + 1, requested_count + 1)
                ]
            )
            all_real_teams = list(tournament.teams.exclude(name=BYE_TEAM_NAME).order_by("id"))

        changed = []
        for idx, team in enumerate(all_real_teams):
            should_be_active = idx < requested_count
            if team.is_active != should_be_active:
                team.is_active = should_be_active
                changed.append(team)

        if changed:
            Team.objects.bulk_update(changed, ["is_active"])

        active_after = (
            Team.objects.filter(tournament=tournament, is_active=True)
            .exclude(name=BYE_TEAM_NAME)
            .count()
        )

        count_changed = active_after != active_before
        should_upgrade = (active_after >= 2) and (count_changed or not had_structure)

        reset_done = False
        if should_upgrade and tournament.status != Tournament.Status.DRAFT:
            tournament.status = Tournament.Status.DRAFT
            tournament.save(update_fields=["status"])
            reset_done = True

        if should_upgrade:
            ensure_matches_generated(tournament)
            if tournament.status == Tournament.Status.DRAFT:
                tournament.status = Tournament.Status.CONFIGURED
                tournament.save(update_fields=["status"])

        detail = "Uczestnicy zostali zaktualizowani."
        if reset_done:
            detail += " Rozgrywki zostały przebudowane (reset etapów i meczów)."
        elif should_upgrade:
            detail += " Rozgrywki zostały wygenerowane."
        else:
            detail += " (Bez przebudowy rozgrywek.)"

        if is_organizer and real_started and should_upgrade:
            detail += (
                " UWAGA: turniej był już rozpoczęty - zmiana liczby uczestników usuwa istniejące mecze, wyniki i harmonogram."
            )

        active_teams = (
            tournament.teams.filter(is_active=True)
            .exclude(name=BYE_TEAM_NAME)
            .order_by("id")
        )

        return Response(
            {
                "detail": detail,
                "reset_done": reset_done,
                "tournament": TournamentSerializer(tournament, context={"request": request}).data,
                "teams": TeamSerializer(active_teams, many=True).data,
                "teams_count": active_after,
                "upgraded": should_upgrade,
            },
            status=status.HTTP_200_OK,
        )


class TournamentTeamPlayersView(APIView):
    def get_permissions(self):
        if self.request.method == "GET":
            return [AllowAny()]
        return [IsAuthenticated()]

    def get(self, request, pk: int, team_id: int):
        tournament = get_object_or_404(Tournament, pk=pk)

        err = public_access_or_403(request, tournament)
        if err is not None:
            return err

        if not _roster_feature_enabled(tournament):
            return Response({"detail": "Składy są dostępne tylko dla turniejów drużynowych."}, status=status.HTTP_400_BAD_REQUEST)

        team = get_object_or_404(Team, pk=team_id, tournament=tournament, is_active=True)
        if team.name == BYE_TEAM_NAME:
            return Response({"detail": "BYE nie posiada składu."}, status=status.HTTP_400_BAD_REQUEST)

        players = TeamPlayer.objects.filter(team=team, is_active=True).order_by("id")
        return Response(
            {
                "team_id": team.id,
                "count": players.count(),
                "results": [_serialize_player(player) for player in players],
            },
            status=status.HTTP_200_OK,
        )

    @transaction.atomic
    def put(self, request, pk: int, team_id: int):
        tournament = get_object_or_404(Tournament, pk=pk)

        if not _roster_feature_enabled(tournament):
            return Response({"detail": "Składy są dostępne tylko dla turniejów drużynowych."}, status=status.HTTP_400_BAD_REQUEST)

        team = get_object_or_404(Team, pk=team_id, tournament=tournament, is_active=True)
        if team.name == BYE_TEAM_NAME:
            return Response({"detail": "BYE nie posiada składu."}, status=status.HTTP_400_BAD_REQUEST)

        if not _can_edit_team_roster(request.user, tournament, team):
            return Response({"detail": "Brak uprawnień do edycji składu tej drużyny."}, status=status.HTTP_403_FORBIDDEN)

        payload = request.data
        if isinstance(payload, dict) and "players" in payload:
            payload = payload.get("players")

        if payload is None:
            payload = []

        if not isinstance(payload, list):
            return Response(
                {"detail": "Nieprawidłowy format danych. Oczekiwano listy zawodników lub pola 'players'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        max_players = _roster_max_players(tournament)
        if max_players is not None and len(payload) > max_players:
            return Response(
                {"detail": f"Przekroczono limit zawodników w składzie: {max_players}."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        jersey_numbers: list[int] = []
        for item in payload:
            if not isinstance(item, dict):
                return Response({"detail": "Każdy element listy zawodników musi być obiektem JSON."}, status=status.HTTP_400_BAD_REQUEST)

            raw_jersey = item.get("jersey_number")
            if raw_jersey is None or raw_jersey == "":
                continue

            try:
                jersey = int(raw_jersey)
            except (TypeError, ValueError):
                return Response({"detail": "Nieprawidłowy 'jersey_number' - oczekiwano liczby."}, status=status.HTTP_400_BAD_REQUEST)

            if jersey <= 0:
                return Response({"detail": "Numer koszulki musi być dodatni."}, status=status.HTTP_400_BAD_REQUEST)

            jersey_numbers.append(jersey)

        if len(set(jersey_numbers)) != len(jersey_numbers):
            return Response(
                {"detail": "W składzie nie można mieć dwóch aktywnych zawodników z tym samym numerem koszulki."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        existing_active = list(TeamPlayer.objects.filter(team=team, is_active=True).order_by("id"))
        existing_by_id = {player.id: player for player in existing_active}

        to_update: list[TeamPlayer] = []
        to_create: list[TeamPlayer] = []
        seen_ids: set[int] = set()
        now_ts = timezone.now()

        for idx, item in enumerate(payload, start=1):
            raw_name = item.get("display_name") or item.get("name") or ""
            display_name = _norm_name(str(raw_name))
            if not display_name:
                continue

            raw_id = item.get("id")
            player_id: Optional[int] = None
            if raw_id not in (None, ""):
                try:
                    player_id = int(raw_id)
                except (TypeError, ValueError):
                    return Response({"detail": f"Nieprawidłowe 'id' zawodnika (pozycja {idx})."}, status=status.HTTP_400_BAD_REQUEST)

            raw_jersey = item.get("jersey_number")
            jersey_number: Optional[int] = None
            if raw_jersey not in (None, ""):
                try:
                    jersey_number = int(raw_jersey)
                except (TypeError, ValueError):
                    return Response({"detail": f"Nieprawidłowy 'jersey_number' (pozycja {idx})."}, status=status.HTTP_400_BAD_REQUEST)

                if jersey_number <= 0:
                    return Response({"detail": f"Numer koszulki musi być dodatni (pozycja {idx})."}, status=status.HTTP_400_BAD_REQUEST)

            if player_id and player_id in existing_by_id:
                player = existing_by_id[player_id]
                player.display_name = display_name
                player.jersey_number = jersey_number
                player.is_active = True
                player.updated_at = now_ts
                to_update.append(player)
                seen_ids.add(player.id)
            elif player_id:
                belongs = TeamPlayer.objects.filter(id=player_id, team=team).exists()
                if not belongs:
                    return Response({"detail": f"Zawodnik id={player_id} nie należy do tej drużyny."}, status=status.HTTP_400_BAD_REQUEST)

                player = TeamPlayer.objects.get(id=player_id, team=team)
                player.display_name = display_name
                player.jersey_number = jersey_number
                player.is_active = True
                player.updated_at = now_ts
                to_update.append(player)
                seen_ids.add(player.id)
            else:
                to_create.append(
                    TeamPlayer(
                        team=team,
                        display_name=display_name,
                        jersey_number=jersey_number,
                        is_active=True,
                        created_by=request.user,
                    )
                )

        to_deactivate = [player for player in existing_active if player.id not in seen_ids]
        for player in to_deactivate:
            player.is_active = False
            player.updated_at = now_ts

        if to_update:
            TeamPlayer.objects.bulk_update(to_update, ["display_name", "jersey_number", "is_active", "updated_at"])
        if to_deactivate:
            TeamPlayer.objects.bulk_update(to_deactivate, ["is_active", "updated_at"])
        if to_create:
            TeamPlayer.objects.bulk_create(to_create)

        players = TeamPlayer.objects.filter(team=team, is_active=True).order_by("id")
        return Response(
            {
                "detail": "Skład został zapisany.",
                "team_id": team.id,
                "count": players.count(),
                "results": [_serialize_player(player) for player in players],
            },
            status=status.HTTP_200_OK,
        )


class TournamentMyTeamPlayersView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk: int):
        tournament = get_object_or_404(Tournament, pk=pk)

        if not user_can_view_tournament(request.user, tournament):
            return Response({"detail": "Brak dostępu do turnieju."}, status=status.HTTP_403_FORBIDDEN)

        if not _roster_feature_enabled(tournament):
            return Response({"detail": "Składy są dostępne tylko dla turniejów drużynowych."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            team = _resolve_participant_team(tournament=tournament, user=request.user, payload_team_id=None)
        except Exception:
            return Response({"detail": "Brak przypisanej drużyny."}, status=status.HTTP_400_BAD_REQUEST)

        if team.name == BYE_TEAM_NAME:
            return Response({"detail": "BYE nie posiada składu."}, status=status.HTTP_400_BAD_REQUEST)

        if not _user_owns_team_slot(request.user, tournament, team):
            return Response({"detail": "Brak uprawnień do podglądu składu."}, status=status.HTTP_403_FORBIDDEN)

        players = TeamPlayer.objects.filter(team=team, is_active=True).order_by("id")
        return Response(
            {
                "team_id": team.id,
                "count": players.count(),
                "results": [_serialize_player(player) for player in players],
            },
            status=status.HTTP_200_OK,
        )

    @transaction.atomic
    def put(self, request, pk: int):
        tournament = get_object_or_404(Tournament, pk=pk)

        if not _roster_feature_enabled(tournament):
            return Response({"detail": "Składy są dostępne tylko dla turniejów drużynowych."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            team = _resolve_participant_team(tournament=tournament, user=request.user, payload_team_id=None)
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        except Exception:
            return Response({"detail": "Brak przypisanej drużyny."}, status=status.HTTP_400_BAD_REQUEST)

        if team.name == BYE_TEAM_NAME:
            return Response({"detail": "BYE nie posiada składu."}, status=status.HTTP_400_BAD_REQUEST)

        if not _allow_team_owner_roster_edit(tournament):
            return Response({"detail": "Edycja składu przez właściciela drużyny jest wyłączona."}, status=status.HTTP_403_FORBIDDEN)

        if not _user_owns_team_slot(request.user, tournament, team):
            return Response({"detail": "Brak uprawnień do edycji składu."}, status=status.HTTP_403_FORBIDDEN)

        view = TournamentTeamPlayersView()
        return view.put(request, pk=pk, team_id=team.id)


class TournamentTeamNameChangeRequestListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk: int):
        tournament = get_object_or_404(Tournament, pk=pk)

        status_q = _norm_name(str(request.query_params.get("status") or "")).upper() or None
        team_id_q = request.query_params.get("team_id")
        try:
            team_id_int = int(team_id_q) if team_id_q else None
        except (TypeError, ValueError):
            team_id_int = None

        if can_approve_name_changes(request.user, tournament):
            qs = (
                TeamNameChangeRequest.objects.filter(tournament=tournament)
                .select_related("team", "requested_by")
                .order_by("-created_at")
            )

            if status_q:
                qs = qs.filter(status=status_q)
            else:
                qs = qs.filter(status=TeamNameChangeRequest.Status.PENDING)

            if team_id_int:
                qs = qs.filter(team_id=team_id_int)

            items: list[dict[str, Any]] = [
                {
                    "id": req.id,
                    "team_id": req.team_id,
                    "old_name": req.old_name,
                    "requested_name": req.requested_name,
                    "requested_by_id": req.requested_by_id,
                    "created_at": req.created_at,
                    "status": req.status,
                }
                for req in qs
            ]
            return Response({"count": len(items), "results": items}, status=status.HTTP_200_OK)

        # Dla panelu bez właściwego uprawnienia zwracana jest pusta lista zamiast 403.
        if request.user and getattr(request.user, "is_authenticated", False):
            if tournament.organizer_id == request.user.id or get_membership(request.user, tournament) is not None:
                return Response({"count": 0, "results": []}, status=status.HTTP_200_OK)

        if not user_is_registered_participant(request.user, tournament):
            return Response({"detail": "Brak uprawnień."}, status=status.HTTP_403_FORBIDDEN)

        qs = (
            TeamNameChangeRequest.objects.filter(
                tournament=tournament,
                requested_by=request.user,
            )
            .select_related("team")
            .order_by("-created_at")
        )

        if status_q:
            qs = qs.filter(status=status_q)

        if team_id_int:
            try:
                team = _resolve_participant_team(
                    tournament=tournament,
                    user=request.user,
                    payload_team_id=team_id_int,
                )
            except Exception:
                return Response({"count": 0, "results": []}, status=status.HTTP_200_OK)
            qs = qs.filter(team_id=team.id)

        items: list[dict[str, Any]] = [
            {
                "id": req.id,
                "team_id": req.team_id,
                "old_name": req.old_name,
                "requested_name": req.requested_name,
                "created_at": req.created_at,
                "status": req.status,
            }
            for req in qs
        ]
        return Response({"count": len(items), "results": items}, status=status.HTTP_200_OK)

    @transaction.atomic
    def post(self, request, pk: int):
        tournament = get_object_or_404(Tournament, pk=pk)

        if not user_can_view_tournament(request.user, tournament):
            return Response({"detail": "Brak dostępu do turnieju."}, status=status.HTTP_403_FORBIDDEN)

        if not user_is_registered_participant(request.user, tournament):
            return Response(
                {"detail": "Tylko zarejestrowany uczestnik może złożyć prośbę."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if getattr(tournament, "participants_self_rename_enabled", True):
            return Response(
                {"detail": "Samodzielna zmiana nazwy jest włączona - nie trzeba wysyłać prośby."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        requested_name = _norm_name(str(request.data.get("requested_name") or request.data.get("name") or ""))
        if len(requested_name) < 2:
            return Response({"detail": "Nazwa jest zbyt krótka."}, status=status.HTTP_400_BAD_REQUEST)

        payload_team_id = request.data.get("team_id")
        try:
            payload_team_id_int = int(payload_team_id) if payload_team_id is not None else None
        except (TypeError, ValueError):
            payload_team_id_int = None

        try:
            team = _resolve_participant_team(
                tournament=tournament,
                user=request.user,
                payload_team_id=payload_team_id_int,
            )
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        except LookupError:
            return Response({"detail": "Brak przypisanego uczestnika (team)."}, status=status.HTTP_400_BAD_REQUEST)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        if TeamNameChangeRequest.objects.filter(team=team, status=TeamNameChangeRequest.Status.PENDING).exists():
            return Response(
                {"detail": "Istnieje już oczekująca prośba dla tego uczestnika."},
                status=status.HTTP_409_CONFLICT,
            )

        req = TeamNameChangeRequest.objects.create(
            tournament=tournament,
            team=team,
            requested_by=request.user,
            old_name=team.name,
            requested_name=requested_name,
            status=TeamNameChangeRequest.Status.PENDING,
        )

        return Response(
            {
                "detail": "Prośba została złożona.",
                "request": {
                    "id": req.id,
                    "team_id": req.team_id,
                    "old_name": req.old_name,
                    "requested_name": req.requested_name,
                    "status": req.status,
                    "created_at": req.created_at,
                },
            },
            status=status.HTTP_201_CREATED,
        )


class TournamentTeamNameChangeRequestCreateView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, pk: int, team_id: int):
        tournament = get_object_or_404(Tournament, pk=pk)

        if not user_can_view_tournament(request.user, tournament):
            return Response({"detail": "Brak dostępu do turnieju."}, status=status.HTTP_403_FORBIDDEN)

        if not user_is_registered_participant(request.user, tournament):
            return Response(
                {"detail": "Tylko zarejestrowany uczestnik może złożyć prośbę."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if getattr(tournament, "participants_self_rename_enabled", True):
            return Response(
                {"detail": "Samodzielna zmiana nazwy jest włączona - nie trzeba wysyłać prośby."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        team = get_object_or_404(Team, pk=team_id, tournament=tournament, is_active=True)

        if team.name == BYE_TEAM_NAME:
            return Response({"detail": "Nie można zmieniać BYE."}, status=status.HTTP_400_BAD_REQUEST)

        if not _user_owns_team_slot(request.user, tournament, team):
            return Response({"detail": "To nie jest Twój slot uczestnika."}, status=status.HTTP_403_FORBIDDEN)

        requested_name = _norm_name(str(request.data.get("requested_name") or request.data.get("name") or ""))
        if len(requested_name) < 2:
            return Response({"detail": "Nazwa jest zbyt krótka."}, status=status.HTTP_400_BAD_REQUEST)

        if TeamNameChangeRequest.objects.filter(team=team, status=TeamNameChangeRequest.Status.PENDING).exists():
            return Response(
                {"detail": "Istnieje już oczekująca prośba dla tego uczestnika."},
                status=status.HTTP_409_CONFLICT,
            )

        req = TeamNameChangeRequest.objects.create(
            tournament=tournament,
            team=team,
            requested_by=request.user,
            old_name=team.name,
            requested_name=requested_name,
            status=TeamNameChangeRequest.Status.PENDING,
        )

        return Response(
            {
                "detail": "Prośba została złożona.",
                "request": {
                    "id": req.id,
                    "team_id": req.team_id,
                    "old_name": req.old_name,
                    "requested_name": req.requested_name,
                    "status": req.status,
                    "created_at": req.created_at,
                },
            },
            status=status.HTTP_201_CREATED,
        )


class TournamentTeamNameChangeRequestApproveView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, pk: int, request_id: int):
        tournament = get_object_or_404(Tournament, pk=pk)

        if not can_approve_name_changes(request.user, tournament):
            return Response({"detail": "Brak uprawnień."}, status=status.HTTP_403_FORBIDDEN)

        req = get_object_or_404(
            TeamNameChangeRequest,
            pk=request_id,
            tournament=tournament,
        )

        if req.status != TeamNameChangeRequest.Status.PENDING:
            return Response({"detail": "Ta prośba nie jest w statusie PENDING."}, status=status.HTTP_400_BAD_REQUEST)

        team = req.team
        if team.tournament_id != tournament.id or team.name == BYE_TEAM_NAME or not team.is_active:
            return Response({"detail": "Nieprawidłowy uczestnik dla prośby."}, status=status.HTTP_400_BAD_REQUEST)

        new_name = _norm_name(req.requested_name)
        if len(new_name) < 2:
            return Response({"detail": "Nazwa jest zbyt krótka."}, status=status.HTTP_400_BAD_REQUEST)

        if team.name != new_name:
            team.name = new_name
            team.save(update_fields=["name"])

        TournamentRegistration.objects.filter(tournament=tournament, team=team).update(display_name=new_name)

        req.status = TeamNameChangeRequest.Status.APPROVED
        req.decided_by = request.user
        req.decided_at = timezone.now()
        req.save(update_fields=["status", "decided_by", "decided_at"])

        return Response(
            {"detail": "Prośba zaakceptowana.", "team": TeamSerializer(team).data},
            status=status.HTTP_200_OK,
        )


class TournamentTeamNameChangeRequestRejectView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, pk: int, request_id: int):
        tournament = get_object_or_404(Tournament, pk=pk)

        if not can_approve_name_changes(request.user, tournament):
            return Response({"detail": "Brak uprawnień."}, status=status.HTTP_403_FORBIDDEN)

        req = get_object_or_404(
            TeamNameChangeRequest,
            pk=request_id,
            tournament=tournament,
        )

        if req.status != TeamNameChangeRequest.Status.PENDING:
            return Response({"detail": "Ta prośba nie jest w statusie PENDING."}, status=status.HTTP_400_BAD_REQUEST)

        req.status = TeamNameChangeRequest.Status.REJECTED
        req.decided_by = request.user
        req.decided_at = timezone.now()
        req.save(update_fields=["status", "decided_by", "decided_at"])

        return Response({"detail": "Prośba odrzucona."}, status=status.HTTP_200_OK)