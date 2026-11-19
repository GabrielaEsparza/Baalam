from django.conf import settings
from django.db import models

from apps.accounts.models import TimeStamped


class PointsLedger(TimeStamped):
    """Movimientos de puntos (no un total), para auditar y corregir sin perder historial."""

    class Reason(models.TextChoices):
        CHECKIN = "checkin", "Asistencia"
        WORKOUT = "workout", "Entrenamiento completo"
        CLASS = "class", "Clase grupal"
        PR = "pr", "Nuevo PR"
        STREAK_WEEK = "streak_week", "Semana con 4+ asistencias"
        BODY_LOG = "body_log", "Registro de peso o medidas"
        MANUAL = "manual", "Ajuste del coach"

    member = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="points")
    points = models.IntegerField()
    reason = models.CharField(max_length=12, choices=Reason.choices)
    ref = models.CharField(max_length=60, blank=True, help_text="Clave de idempotencia, ej. checkin:2026-11-16")
    note = models.CharField(max_length=200, blank=True)
    month = models.CharField(max_length=7, help_text="YYYY-MM")

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "movimiento de puntos"
        verbose_name_plural = "movimientos de puntos"


class PodiumMonth(TimeStamped):
    """Ranking congelado al cerrar el mes (close_podium)."""

    month = models.CharField(max_length=7, unique=True)
    ranking = models.JSONField(default=list)
