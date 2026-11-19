from django.conf import settings
from django.db import models

from apps.accounts.models import TimeStamped


class GymSettings(TimeStamped):
    """Una sola fila. Usa GymSettings.load()."""

    name = models.CharField(max_length=80, default="BÁALAM GYM")
    whatsapp = models.CharField(max_length=20, blank=True, help_text="Con lada, solo números: 5215512345678")
    address = models.CharField(max_length=200, blank=True)
    maps_url = models.URLField(blank=True)
    hours = models.TextField(blank=True, help_text="Horario de apertura, texto libre")
    grace_days = models.PositiveSmallIntegerField(default=3, help_text="Días extra con acceso tras el vencimiento (p. ej. si vence en fin de semana)")
    expiring_days = models.PositiveSmallIntegerField(default=7, help_text="Días antes del vencimiento en que sale el aviso")
    change_deadline_hours = models.PositiveSmallIntegerField(default=2)
    checkin_early_min = models.PositiveSmallIntegerField(default=30)
    booking_open_day = models.PositiveSmallIntegerField(default=25)
    points_config = models.JSONField(default=dict, blank=True)

    class Meta:
        verbose_name = verbose_name_plural = "ajustes del gym"

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def load(cls) -> "GymSettings":
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj


class Plan(TimeStamped):
    name = models.CharField(max_length=60)
    price_mxn = models.DecimalField(max_digits=8, decimal_places=2)
    duration_months = models.PositiveSmallIntegerField(default=1)
    includes_routine = models.BooleanField(default=False)
    includes_open_gym = models.BooleanField(default=False)
    includes_classes = models.BooleanField(default=False)
    default_sessions_per_week = models.PositiveSmallIntegerField(default=3)
    benefits = models.JSONField(default=list, blank=True)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["-price_mxn"]
        verbose_name = "plan"

    def __str__(self):
        return f"{self.name} (${self.price_mxn:.0f})"


class Membership(TimeStamped):
    class Status(models.TextChoices):
        ACTIVE = "active", "Activa"
        PAUSED = "paused", "Pausada"
        EXPIRED = "expired", "Vencida"

    member = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="memberships")
    plan = models.ForeignKey(Plan, on_delete=models.PROTECT)
    start_date = models.DateField()
    end_date = models.DateField()
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ACTIVE)
    paused_days_left = models.PositiveIntegerField(null=True, blank=True)
    sessions_per_week = models.PositiveSmallIntegerField(default=3)

    class Meta:
        ordering = ["-start_date", "-id"]
        verbose_name = "membresía"

    def __str__(self):
        return f"{self.member} · {self.plan.name} → {self.end_date}"


class Payment(TimeStamped):
    class Method(models.TextChoices):
        CASH = "cash", "Efectivo"
        TRANSFER = "transfer", "Transferencia"
        OTHER = "other", "Otro"

    member = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="payments")
    membership = models.ForeignKey(Membership, on_delete=models.PROTECT, related_name="payments")
    amount_mxn = models.DecimalField(max_digits=8, decimal_places=2)
    method = models.CharField(max_length=10, choices=Method.choices)
    paid_at = models.DateField()
    note = models.CharField(max_length=200, blank=True)
    registered_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+"
    )

    class Meta:
        ordering = ["-paid_at", "-id"]
        verbose_name = "pago"


class MembershipRequest(TimeStamped):
    class Type(models.TextChoices):
        SIGNUP = "signup", "Registro"
        RENEWAL = "renewal", "Renovación"
        PLAN_CHANGE = "plan_change", "Cambio de plan"

    class Status(models.TextChoices):
        OPEN = "open", "Abierta"
        DONE = "done", "Atendida"
        REJECTED = "rejected", "Rechazada"

    member = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="requests")
    type = models.CharField(max_length=12, choices=Type.choices)
    plan = models.ForeignKey(Plan, on_delete=models.SET_NULL, null=True, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OPEN)
    note = models.CharField(max_length=200, blank=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "solicitud"
