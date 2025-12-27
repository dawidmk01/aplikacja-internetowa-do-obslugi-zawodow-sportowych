from django.db.models import Q
from django.shortcuts import get_object_or_404

from rest_framework.generics import (
    ListCreateAPIView,
    ListAPIView,
    RetrieveUpdateAPIView,
)
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated, AllowAny
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


class TournamentDetailView(RetrieveUpdateAPIView):
    """
    Szczegóły turnieju – dostęp przez link, z opcjonalnym kodem.
    ORGANIZER / ASSISTANT → zawsze dostęp.
    """
    queryset = Tournament.objects.all()
    serializer_class = TournamentSerializer
    permission_classes = [AllowAny]  # 🔑 KLUCZOWE

    def retrieve(self, request, *args, **kwargs):
        tournament = self.get_object()
        user = request.user if request.user.is_authenticated else None

        # 1️⃣ ORGANIZER / ASSISTANT – pełny dostęp
        if user and (
            tournament.organizer_id == user.id or
            TournamentMembership.objects.filter(
                tournament=tournament,
                user=user,
                role=TournamentMembership.Role.ASSISTANT,
            ).exists()
        ):
            return super().retrieve(request, *args, **kwargs)

        # 2️⃣ NIEOPUBLIKOWANY → brak dostępu
        if not tournament.is_published:
            return Response(
                {"detail": "Turniej nie jest dostępny."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # 3️⃣ WYMAGA KODU
        if tournament.access_code:
            code = request.query_params.get("code")
            if code != tournament.access_code:
                return Response(
                    {"detail": "Wymagany poprawny kod dostępu."},
                    status=status.HTTP_403_FORBIDDEN,
                )

        # 4️⃣ OK – dostęp przez link
        return super().retrieve(request, *args, **kwargs)


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
