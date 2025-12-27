from django.db.models import Q
from django.shortcuts import get_object_or_404

from rest_framework.generics import (
    ListCreateAPIView,
    ListAPIView,
    RetrieveAPIView,
)
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from .models import Tournament, TournamentMembership
from .serializers import (
    TournamentSerializer,
    AddAssistantSerializer,
    TournamentAssistantSerializer,
)
from .permissions import IsTournamentOrganizer


class TournamentListView(ListCreateAPIView):
    """
    Lista wszystkich turniejów + tworzenie nowego.
    POST → zalogowany użytkownik staje się ORGANIZEREM.
    """
    queryset = Tournament.objects.all()
    serializer_class = TournamentSerializer
    permission_classes = [IsAuthenticated]

    def perform_create(self, serializer):
        serializer.save(organizer=self.request.user)


class MyTournamentListView(ListAPIView):
    """
    Turnieje, w których użytkownik jest ORGANIZEREM lub ASSISTANTEM.
    """
    serializer_class = TournamentSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        return Tournament.objects.filter(
            Q(organizer=user) |
            Q(memberships__user=user)
        ).distinct()


class TournamentDetailView(RetrieveAPIView):
    """
    Szczegóły turnieju – TYLKO dla ORGANIZER lub ASSISTANT.
    Inni użytkownicy dostaną 404.
    """
    serializer_class = TournamentSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        return Tournament.objects.filter(
            Q(organizer=user) |
            Q(memberships__user=user)
        ).distinct()


class TournamentAssistantListView(ListAPIView):
    """
    Lista ASSISTANTÓW turnieju.
    Dostęp: ORGANIZER lub ASSISTANT (tylko odczyt).
    """
    serializer_class = TournamentAssistantSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        tournament = get_object_or_404(Tournament, pk=self.kwargs["pk"])

        is_allowed = (
            tournament.organizer_id == user.id or
            TournamentMembership.objects.filter(
                tournament=tournament,
                user=user,
                role=TournamentMembership.Role.ASSISTANT,
            ).exists()
        )

        if not is_allowed:
            return TournamentMembership.objects.none()

        return TournamentMembership.objects.filter(
            tournament=tournament,
            role=TournamentMembership.Role.ASSISTANT,
        )


class AddAssistantView(APIView):
    """
    Dodawanie ASSISTANTA – tylko ORGANIZER.
    """
    permission_classes = [IsAuthenticated, IsTournamentOrganizer]

    def post(self, request, pk):
        tournament = get_object_or_404(Tournament, pk=pk)
        self.check_object_permissions(request, tournament)

        serializer = AddAssistantSerializer(
            data=request.data,
            context={"tournament": tournament},
        )
        serializer.is_valid(raise_exception=True)

        TournamentMembership.objects.create(
            tournament=tournament,
            user=serializer.validated_data["user"],
            role=TournamentMembership.Role.ASSISTANT,
        )

        return Response(
            {"status": "assistant added"},
            status=status.HTTP_201_CREATED,
        )


class RemoveAssistantView(APIView):
    """
    Usuwanie ASSISTANTA – tylko ORGANIZER.
    """
    permission_classes = [IsAuthenticated, IsTournamentOrganizer]

    def delete(self, request, pk, user_id):
        tournament = get_object_or_404(Tournament, pk=pk)
        self.check_object_permissions(request, tournament)

        membership = get_object_or_404(
            TournamentMembership,
            tournament=tournament,
            user_id=user_id,
            role=TournamentMembership.Role.ASSISTANT,
        )

        membership.delete()

        return Response(status=status.HTTP_204_NO_CONTENT)
