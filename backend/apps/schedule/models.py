from django.conf import settings
from django.db import models

from apps.accounts.models import TimeStamped


class Schedule(TimeStamped):
    """Horario recurrente: turno de piso libre (Plan Rutina) o clase (Plan Clases)."""

    class Type(models.TextChoices):
        OPEN_GYM = "open_gym", "Turno de piso libre"
        CLASS = "class", "Clase"

    name = models.CharField(max_length=80)
    type = models.CharField(max_length=10, choices=Type.choices)
    weekdays = models.JSONField(default=list, help_text="0=lunes … 6=domingo, ej. [0,2,4]")
    start_time = models.TimeField()
    duration_min = models.PositiveSmallIntegerField(default=60)
    capacity = models.PositiveSmallIntegerField(default=12)
    requires_reservation = models.BooleanField(default=True)
    active = models.BooleanField(default=True)
    one_off = models.BooleanField(default=False, help_text="Horario extra de un solo día (no se repite)")

    class Meta:
        ordering = ["start_time", "name"]
        verbose_name = "horario"

    def __str__(self):
        return f"{self.name} {self.start_time:%H:%M}"


class Session(TimeStamped):
    """Fecha concreta de un horario, con su propio cupo."""

    schedule = models.ForeignKey(Schedule, on_delete=models.CASCADE, related_name="sessions")
    date = models.DateField()
    start_at = models.DateTimeField()
    end_at = models.DateTimeField()
    capacity = models.PositiveSmallIntegerField()
    cancelled = models.BooleanField(default=False)
    edited = models.BooleanField(default=False, help_text="El coach cambió hora o cupo solo para esta fecha")
    cancelled_booking_ids = models.JSONField(default=list, blank=True, help_text="Reservas a restaurar si se reabre")

    class Meta:
        ordering = ["start_at"]
        constraints = [models.UniqueConstraint(fields=["schedule", "date"], name="uniq_session_per_day")]
        verbose_name = "sesión"
        verbose_name_plural = "sesiones"

    def __str__(self):
        return f"{self.schedule.name} {self.date}"


class Booking(TimeStamped):
    class Status(models.TextChoices):
        BOOKED = "booked", "Reservada"
        ATTENDED = "attended", "Asistió"
        MISSED = "missed", "Falta"
        MOVED = "moved", "Cambiada"
        CANCELLED = "cancelled", "Cancelada por el coach"

    ACTIVE_STATUSES = (Status.BOOKED, Status.ATTENDED)

    member = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="bookings")
    session = models.ForeignKey(Session, on_delete=models.CASCADE, related_name="bookings")
    month = models.CharField(max_length=7, help_text="YYYY-MM")
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.BOOKED)
    moved_from = models.ForeignKey("self", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")

    class Meta:
        ordering = ["session__start_at"]
        verbose_name = "reserva"


class WaitlistEntry(TimeStamped):
    member = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="waitlist")
    from_booking = models.ForeignKey(Booking, on_delete=models.CASCADE, related_name="waitlist_entries")
    target_session = models.ForeignKey(Session, on_delete=models.CASCADE, related_name="waitlist")
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["created_at", "id"]
        verbose_name = "lista de espera"
        verbose_name_plural = "lista de espera"
