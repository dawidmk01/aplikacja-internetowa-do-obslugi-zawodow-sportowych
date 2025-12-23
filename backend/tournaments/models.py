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
    is_private = models.BooleanField(default=True)
    access_code = models.CharField(max_length=20, blank=True, null=True)
    start_date = models.DateField(blank=True, null=True)
    end_date = models.DateField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name
