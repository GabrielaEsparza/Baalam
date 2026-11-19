from django.conf import settings
from django.db import models

from apps.accounts.models import TimeStamped


class CheckIn(TimeStamped):
    class Source(models.TextChoices):
        QR = "qr", "QR"
        CODE = "code", "Código"
        MANUAL = "manual", "Manual"

    member = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="checkins")
    at = models.DateTimeField()
    date = models.DateField(help_text="Fecha local, para el límite de 1 por día")
    source = models.CharField(max_length=6, choices=Source.choices)
    booking = models.ForeignKey("schedule.Booking", on_delete=models.SET_NULL, null=True, blank=True)

    class Meta:
        ordering = ["-at"]
        constraints = [models.UniqueConstraint(fields=["member", "date"], name="one_checkin_per_day")]
        verbose_name = "asistencia"
