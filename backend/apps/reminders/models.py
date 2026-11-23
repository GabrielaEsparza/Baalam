from django.conf import settings
from django.db import models


class PushSubscription(models.Model):
    """Un navegador/celular donde la persona activó los avisos."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="push_subscriptions")
    endpoint = models.URLField(max_length=600, unique=True)
    p256dh = models.CharField(max_length=200)
    auth = models.CharField(max_length=100)
    user_agent = models.CharField(max_length=200, blank=True)
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "dispositivo con avisos"
        verbose_name_plural = "dispositivos con avisos"


class ReminderPrefs(models.Model):
    """Qué avisos quiere recibir cada persona."""

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="reminder_prefs")
    water = models.BooleanField(default=True)
    water_goal_ml = models.PositiveIntegerField(null=True, blank=True, help_text="Vacío = automático según el peso")
    workout = models.BooleanField(default=True)
    workout_hour = models.PositiveSmallIntegerField(default=19, help_text="Hora del aviso si no ha registrado su entrenamiento")
    classes = models.BooleanField(default=True)
    measures = models.BooleanField(default=True)
    food = models.BooleanField(default=True)

    class Meta:
        verbose_name = "preferencias de avisos"
        verbose_name_plural = "preferencias de avisos"


class SentReminder(models.Model):
    """Registro de avisos enviados: evita mandar el mismo dos veces."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+")
    kind = models.CharField(max_length=12)
    ref = models.CharField(max_length=60)
    sent_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "kind", "ref"], name="uniq_reminder")]


class WaterLog(models.Model):
    """Agua tomada en el día (un renglón por persona y día)."""

    member = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="water_logs")
    date = models.DateField()
    ml = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["member", "date"], name="one_water_log_per_day")]
        verbose_name = "registro de agua"
