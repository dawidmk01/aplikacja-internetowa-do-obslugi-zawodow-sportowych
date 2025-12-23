from rest_framework.generics import ListAPIView
from .models import Tournament
from .serializers import TournamentSerializer


class TournamentListView(ListAPIView):
    queryset = Tournament.objects.all()
    serializer_class = TournamentSerializer