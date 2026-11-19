from django.conf import settings
from django.db import models

from apps.accounts.models import TimeStamped


class BodyLog(TimeStamped):
    member = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="body_logs")
    date = models.DateField()
    weight_kg = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)
    waist_cm = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)
    hip_cm = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)
    chest_cm = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)
    arm_cm = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True, help_text="Brazo relajado")
    arm_flexed_cm = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True, help_text="Brazo contraído")
    wrist_cm = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)
    calf_cm = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)
    leg_cm = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True, help_text="Cuádriceps")
    body_fat_pct = models.DecimalField(max_digits=4, decimal_places=1, null=True, blank=True)
    water_pct = models.DecimalField(max_digits=4, decimal_places=1, null=True, blank=True)
    muscle_pct = models.DecimalField(max_digits=4, decimal_places=1, null=True, blank=True)

    class Meta:
        ordering = ["date"]
        constraints = [models.UniqueConstraint(fields=["member", "date"], name="one_body_log_per_day")]
        verbose_name = "registro corporal"


class ProgressPhoto(TimeStamped):
    member = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="photos")
    date = models.DateField()
    image = models.ImageField(upload_to="progress/")
    angle = models.CharField(max_length=10, blank=True, help_text="frente / perfil / espalda")

    class Meta:
        ordering = ["-date"]
        verbose_name = "foto de progreso"
