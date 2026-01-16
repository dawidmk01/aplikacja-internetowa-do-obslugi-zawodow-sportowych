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

from tournaments.models import Match, Team, Tournament, TournamentRegistration
from tournaments.serializers.matches import MatchSerializer

BYE_TEAM_NAME = "__SYSTEM_BYE__"


def _norm_name(s: str) -> str:
    return " ".join((s or "").strip().split())


def _self_register_or_400(tournament: Tournament) -> Optional[Response]:
    if tournament.entry_mode != Tournament.EntryMode.SELF_REGISTER:
        return Response(
            {"detail": "Samodzielna rejestracja (SELF_REGISTER) nie jest włączona dla tego turnieju."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    return None


def _validate_code_or_400(tournament: Tournament, code: str) -> Optional[Response]:
    if not tournament.registration_code:
        return Response(
            {"detail": "Turniej nie ma ustawionego kodu rejestracyjnego."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if (code or "").strip() != (tournament.registration_code or "").strip():
        return Response(
            {"detail": "Nieprawidłowy kod rejestracyjny."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    return None


def _tournament_real_started(tournament: Tournament) -> bool:
    qs = Match.objects.filter(tournament=tournament).exclude(
        Q(home_team__name__iexact=BYE_TEAM_NAME) | Q(away_team__name__iexact=BYE_TEAM_NAME)
    )
    return qs.filter(result_entered=True).exists()


def _get_user_team(tournament: Tournament, user) -> Optional[Team]:
    return Team.objects.filter(
        tournament=tournament,
        registered_user=user,
        is_active=True,
    ).first()


def _claim_free_team_or_none(tournament: Tournament, user) -> Optional[Team]:
    team = Team.objects.filter(
        tournament=tournament,
        is_active=True,
        registered_user__isnull=True,
    ).order_by("id").first()

    if not team:
        return None

    team.registered_user = user
    team.save(update_fields=["registered_user"])
    return team


class RegistrationVerifySerializer(serializers.Serializer):
    # kompatybilność: stary payload mógł mieć registration_code
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
        return attrs


class TournamentRegistrationVerifyView(APIView):
    """
    POST /api/tournaments/<pk>/registrations/verify/
    body: { "code": "..." }
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, pk: int):
        tournament = get_object_or_404(Tournament, pk=pk)

        denied = _self_register_or_400(tournament)
        if denied:
            return denied

        ser = RegistrationVerifySerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        denied = _validate_code_or_400(tournament, ser.validated_data["code"])
        if denied:
            return denied

        return Response({"detail": "OK"}, status=status.HTTP_200_OK)


class TournamentRegistrationJoinView(APIView):
    """
    POST /api/tournaments/<pk>/registrations/join/
    body: { "code": "...", "display_name": "..." }
    """
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, pk: int):
        tournament = get_object_or_404(Tournament, pk=pk)

        denied = _self_register_or_400(tournament)
        if denied:
            return denied

        ser = RegistrationJoinSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        code = ser.validated_data["code"]
        display_name = _norm_name(ser.validated_data["display_name"])

        denied = _validate_code_or_400(tournament, code)
        if denied:
            return denied

        # blokada dołączenia po realnym starcie (wynik wpisany w nie-BYE)
        existing = TournamentRegistration.objects.filter(tournament=tournament, user=request.user).first()
        if not existing and _tournament_real_started(tournament):
            return Response(
                {"detail": "Turniej już się rozpoczął — nie można dołączyć po starcie rozgrywek."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        reg, _ = TournamentRegistration.objects.get_or_create(
            tournament=tournament,
            user=request.user,
            defaults={"display_name": display_name},
        )
        reg.display_name = display_name

        # team slot
        team = reg.team if reg.team_id else None
        if team and (team.tournament_id != tournament.id or team.registered_user_id != request.user.id):
            team = None

        if not team:
            team = _get_user_team(tournament, request.user) or _claim_free_team_or_none(tournament, request.user)

        # jeśli dalej brak: tworzymy nowy slot, ale z limitem participants_count (jeżeli ustawiony)
        if not team:
            if tournament.participants_count and Team.objects.filter(tournament=tournament, is_active=True).count() >= tournament.participants_count:
                return Response({"detail": "Brak wolnych miejsc (limit uczestników)."}, status=status.HTTP_400_BAD_REQUEST)

            team = Team.objects.create(
                tournament=tournament,
                name=display_name,
                is_active=True,
                registered_user=request.user,
            )

        # ustaw nazwę teamu = display_name
        if team.name != display_name:
            team.name = display_name
            team.save(update_fields=["name"])

        reg.team = team
        reg.save(update_fields=["display_name", "team"])

        return Response(
            {"detail": "OK", "display_name": reg.display_name, "team_id": reg.team_id},
            status=status.HTTP_200_OK,
        )


class TournamentRegistrationMeView(APIView):
    """
    GET /api/tournaments/<pk>/registrations/me/
    -> 200 { display_name, team_id } albo 404
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, pk: int):
        tournament = get_object_or_404(Tournament, pk=pk)
        reg = TournamentRegistration.objects.filter(
            tournament=tournament,
            user=request.user,
        ).only("display_name", "team_id").first()

        if not reg:
            return Response({"detail": "Brak rejestracji."}, status=status.HTTP_404_NOT_FOUND)

        return Response({"display_name": reg.display_name, "team_id": reg.team_id}, status=status.HTTP_200_OK)


class TournamentRegistrationMyMatchesView(ListAPIView):
    """
    GET /api/tournaments/<pk>/registrations/my/matches/
    Zwraca listę meczów dla teamu zalogowanego usera (format jak public matches).
    """
    permission_classes = [IsAuthenticated]
    serializer_class = MatchSerializer

    def get_queryset(self):
        tournament = get_object_or_404(Tournament, pk=self.kwargs["pk"])

        reg = TournamentRegistration.objects.filter(
            tournament=tournament,
            user=self.request.user,
        ).only("team_id").first()

        if not reg or not reg.team_id:
            return Match.objects.none()

        return (
            Match.objects.filter(tournament=tournament)
            .filter(Q(home_team_id=reg.team_id) | Q(away_team_id=reg.team_id))
            .select_related("home_team", "away_team", "stage")
            .order_by("stage__order", "round_number", "id")
        )


# Alias dla kompatybilności (stare /self-register/)
TournamentSelfRegisterView = TournamentRegistrationJoinView
TournamentSelfRegisterMeView = TournamentRegistrationMeView
TournamentSelfRegisterMyMatchesView = TournamentRegistrationMyMatchesView
