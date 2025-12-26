from django.conf import settings
from django.db import models


class Tournament(models.Model):
    class Discipline(models.TextChoices):
        FOOTBALL = "football", "Piłka nożna"
        VOLLEYBALL = "volleyball", "Siatkówka"
        BASKETBALL = "basketball", "Koszykówka"
        TENNIS = "tennis", "Tenis"
        WRESTLING = "wrestling", "Zapasy"

    name = models.CharField(max_length=255)
    discipline = models.CharField(max_length=50, choices=Discipline.choices)

    # ORGANIZATOR (właściciel turnieju)
    organizer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="organized_tournaments",
    )

    is_private = models.BooleanField(default=True)
    access_code = models.CharField(max_length=20, blank=True, null=True)
    start_date = models.DateField(blank=True, null=True)
    end_date = models.DateField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class TournamentMembership(models.Model):
    """
    Relacja użytkownik–turniej dla współorganizatorów (asystentów).
    """

    class Role(models.TextChoices):
        ASSISTANT = "ASSISTANT", "Asystent"

    tournament = models.ForeignKey(
        Tournament,
        on_delete=models.CASCADE,
        related_name="memberships",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="tournament_memberships",
    )
    role = models.CharField(
        max_length=20,
        choices=Role.choices,
        default=Role.ASSISTANT,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["tournament", "user"],
                name="uniq_tournament_user"
            )
        ]

    def __str__(self):
        return f"{self.user_id} -> {self.tournament_id} ({self.role})"
