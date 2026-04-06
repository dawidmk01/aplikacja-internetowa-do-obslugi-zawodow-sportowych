# backend/tournaments/views/registrations.py
# Plik obsługuje dołączanie uczestnika i podgląd własnych danych w kontekście aktywnej dywizji.

from __future__ import annotations

from typing import Optional

from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404

from rest_framework import serializers, status
from rest_framework.generics import ListAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from tournaments.models import Division, Match, Team, Tournament, TournamentRegistration
from tournaments.serializers.matches import MatchSerializer

from ._helpers import resolve_request_division

BYE_TEAM_NAME = "__SYSTEM_BYE__"


def _norm_name(value: str) -> str:
    return " ".join((value or "").strip().split())


def _join_enabled_or_400(tournament: Tournament) -> Optional[Response]:
    if not getattr(tournament, "join_enabled", False):
        return Response({"detail": "Dołączanie przez konto i kod jest wyłączone dla tego turnieju."}, status=status.HTTP_400_BAD_REQUEST)
    return None


def _validate_code_or_400(tournament: Tournament, code: str) -> Optional[Response]:
    if not tournament.registration_code:
        return Response({"detail": "Turniej nie ma ustawionego kodu dołączania."}, status=status.HTTP_400_BAD_REQUEST)
    if (code or "").strip() != (tournament.registration_code or "").strip():
        return Response({"detail": "Nieprawidłowy kod dołączania."}, status=status.HTTP_400_BAD_REQUEST)
    return None


def _tournament_real_started(tournament: Tournament, division: Optional[Division]) -> bool:
    qs = Match.objects.filter(tournament=tournament).exclude(Q(home_team__name__iexact=BYE_TEAM_NAME) | Q(away_team__name__iexact=BYE_TEAM_NAME))
    if division is not None:
        qs = qs.filter(stage__division=division)
    return qs.filter(result_entered=True).exists()


def _get_user_team(tournament: Tournament, user, division: Optional[Division]) -> Optional[Team]:
    qs = Team.objects.filter(tournament=tournament, registered_user=user, is_active=True).exclude(name=BYE_TEAM_NAME)
    if division is not None:
        qs = qs.filter(division=division)
    return qs.first()


def _claim_free_team_or_none(tournament: Tournament, user, division: Optional[Division]) -> Optional[Team]:
    team_qs = Team.objects.select_for_update().filter(tournament=tournament, is_active=True, registered_user__isnull=True).exclude(name=BYE_TEAM_NAME)
    if division is not None:
        team_qs = team_qs.filter(division=division)
    team = team_qs.order_by("id").first()
    if not team:
        return None
    team.registered_user = user
    team.save(update_fields=["registered_user"])
    return team


class RegistrationVerifySerializer(serializers.Serializer):
    code = serializers.CharField(max_length=64, allow_blank=False, trim_whitespace=True, required=False)
    registration_code = serializers.CharField(max_length=64, allow_blank=False, trim_whitespace=True, required=False)

    def validate(self, attrs):
        if not attrs.get("code") and attrs.get("registration_code"):
            attrs["code"] = attrs["registration_code"]
        if not attrs.get("code"):
            raise serializers.ValidationError({"code": "Wymagany kod."})
        return attrs


class RegistrationJoinSerializer(serializers.Serializer):
    code = serializers.CharField(max_length=64, allow_blank=False, trim_whitespace=True)
    display_name = serializers.CharField(max_length=255, allow_blank=False, trim_whitespace=True, required=False)
    name = serializers.CharField(max_length=255, allow_blank=False, trim_whitespace=True, required=False)

    def validate(self, attrs):
        if not attrs.get("display_name") and attrs.get("name"):
            attrs["display_name"] = attrs["name"]
        if not attrs.get("display_name"):
            raise serializers.ValidationError({"display_name": "Wymagana nazwa."})
        attrs["display_name"] = _norm_name(attrs["display_name"])
        return attrs


class RegistrationRenameSerializer(serializers.Serializer):
    display_name = serializers.CharField(max_length=80, allow_blank=False, trim_whitespace=True)

    def validate_display_name(self, value: str) -> str:
        normalized = _norm_name(value)
        if not normalized:
            raise serializers.ValidationError("Wymagana nazwa.")
        if len(normalized) > 80:
            raise serializers.ValidationError("Nazwa jest za długa (max 80 znaków).")
        return normalized


class TournamentRegistrationVerifyView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk: int):
        tournament = get_object_or_404(Tournament, pk=pk)
        denied = _join_enabled_or_400(tournament)
        if denied:
            return denied

        serializer = RegistrationVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        denied = _validate_code_or_400(tournament, serializer.validated_data["code"])
        if denied:
            return denied

        division = resolve_request_division(request, tournament)
        return Response({"detail": "OK", "division_id": getattr(division, "id", None)}, status=status.HTTP_200_OK)


class TournamentRegistrationJoinView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, pk: int):
        tournament = get_object_or_404(Tournament, pk=pk)
        division = resolve_request_division(request, tournament)

        denied = _join_enabled_or_400(tournament)
        if denied:
            return denied

        if division is None:
            return Response({"detail": "Brak aktywnej dywizji do dołączenia."}, status=status.HTTP_400_BAD_REQUEST)

        serializer = RegistrationJoinSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        code = serializer.validated_data["code"]
        display_name = serializer.validated_data["display_name"]

        denied = _validate_code_or_400(tournament, code)
        if denied:
            return denied

        existing = TournamentRegistration.objects.filter(tournament=tournament, division=division, user=request.user).first()
        if not existing and _tournament_real_started(tournament, division):
            return Response({"detail": "Ta dywizja już się rozpoczęła - nie można dołączyć po starcie rozgrywek."}, status=status.HTTP_400_BAD_REQUEST)

        reg, _ = TournamentRegistration.objects.get_or_create(
            tournament=tournament,
            division=division,
            user=request.user,
            defaults={"display_name": display_name},
        )
        reg.display_name = display_name

        team = reg.team if reg.team_id else None
        if team and (team.tournament_id != tournament.id or not team.is_active or team.division_id != division.id):
            team = None

        if team and team.registered_user_id not in (None, request.user.id):
            team = None

        if not team:
            team = _get_user_team(tournament, request.user, division) or _claim_free_team_or_none(tournament, request.user, division)

        if not team:
            return Response({"detail": "Brak wolnych miejsc w tej dywizji."}, status=status.HTTP_400_BAD_REQUEST)

        update_fields = []
        if team.registered_user_id != request.user.id:
            team.registered_user = request.user
            update_fields.append("registered_user")
        if team.name != display_name:
            team.name = display_name
            update_fields.append("name")
        if update_fields:
            team.save(update_fields=update_fields)

        reg.team = team
        reg.save(update_fields=["display_name", "team"])

        return Response({"detail": "OK", "display_name": reg.display_name, "team_id": reg.team_id, "division_id": division.id}, status=status.HTTP_200_OK)


class TournamentRegistrationMeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk: int):
        tournament = get_object_or_404(Tournament, pk=pk)
        division = resolve_request_division(request, tournament)

        reg_qs = TournamentRegistration.objects.filter(tournament=tournament, user=request.user)
        if division is not None:
            reg_qs = reg_qs.filter(division=division)

        reg = reg_qs.only("display_name", "team_id", "division_id").first()
        if not reg:
            return Response({"detail": "Brak rejestracji."}, status=status.HTTP_404_NOT_FOUND)

        return Response({"display_name": reg.display_name, "team_id": reg.team_id, "division_id": reg.division_id}, status=status.HTTP_200_OK)

    @transaction.atomic
    def patch(self, request, pk: int):
        tournament = get_object_or_404(Tournament, pk=pk)
        division = resolve_request_division(request, tournament)

        if not getattr(tournament, "participants_self_rename_enabled", True):
            return Response({"detail": "Zmiana nazwy wymaga akceptacji organizatora - wyślij prośbę o zmianę nazwy."}, status=status.HTTP_400_BAD_REQUEST)

        reg_qs = TournamentRegistration.objects.select_for_update().filter(tournament=tournament, user=request.user)
        if division is not None:
            reg_qs = reg_qs.filter(division=division)

        reg = reg_qs.first()
        if not reg:
            return Response({"detail": "Brak rejestracji."}, status=status.HTTP_404_NOT_FOUND)

        serializer = RegistrationRenameSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        new_name = serializer.validated_data["display_name"]
        changed = False

        if reg.display_name != new_name:
            reg.display_name = new_name
            reg.save(update_fields=["display_name"])
            changed = True

        if reg.team_id:
            team = Team.objects.select_for_update().filter(id=reg.team_id, tournament=tournament).first()
            if team and team.name != new_name and team.name != BYE_TEAM_NAME:
                team.name = new_name
                team.save(update_fields=["name"])
                changed = True

        return Response({"detail": "OK" if changed else "NO_CHANGES", "display_name": reg.display_name, "team_id": reg.team_id, "division_id": reg.division_id}, status=status.HTTP_200_OK)


class TournamentRegistrationMyMatchesView(ListAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = MatchSerializer

    def get_queryset(self):
        tournament = get_object_or_404(Tournament, pk=self.kwargs["pk"])
        division = resolve_request_division(self.request, tournament)

        reg_qs = TournamentRegistration.objects.filter(tournament=tournament, user=self.request.user).only("team_id")
        if division is not None:
            reg_qs = reg_qs.filter(division=division)

        reg = reg_qs.first()
        if not reg or not reg.team_id:
            return Match.objects.none()

        qs = (
            Match.objects.filter(tournament=tournament)
            .filter(Q(home_team_id=reg.team_id) | Q(away_team_id=reg.team_id))
            .select_related("home_team", "away_team", "stage", "stage__division")
        )
        if division is not None:
            qs = qs.filter(stage__division=division)
        return qs.order_by("stage__order", "round_number", "id")


TournamentSelfRegisterView = TournamentRegistrationJoinView
TournamentSelfRegisterMeView = TournamentRegistrationMeView
TournamentSelfRegisterMyMatchesView = TournamentRegistrationMyMatchesView
