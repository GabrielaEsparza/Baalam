from django.conf import settings
from django.db import models

from apps.accounts.models import TimeStamped


class Announcement(TimeStamped):
    title = models.CharField(max_length=120)
    body = models.TextField(blank=True)
    image = models.ImageField(upload_to="announcements/", blank=True)
    pinned = models.BooleanField(default=False)
    publish_at = models.DateTimeField()
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)

    class Meta:
        ordering = ["-pinned", "-publish_at"]
        verbose_name = "aviso"

    def __str__(self):
        return self.title


class Buddy(TimeStamped):
    """Gym sis / gym bro: dos miembros que comparten racha. Se puede tener más de uno."""

    class Status(models.TextChoices):
        PENDING = "pending", "Invitación enviada"
        ACCEPTED = "accepted", "Aceptada"

    from_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="buddy_invites_sent")
    to_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="buddy_invites_got")
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.PENDING)
    since = models.DateField(null=True, blank=True, help_text="Día en que aceptó: la racha juntos cuenta desde aquí")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["from_user", "to_user"], name="uniq_buddy_pair")]
        verbose_name = "gym sis / gym bro"
        verbose_name_plural = "gym sis / gym bros"

    def other(self, user):
        return self.to_user if self.from_user_id == user.id else self.from_user


class Wildcard(TimeStamped):
    """Comodín: un día de entrenamiento que no pudo hacer (enfermedad, etc.). 1 por semana y lo aprueba la coach."""

    class Status(models.TextChoices):
        PENDING = "pending", "Por aprobar"
        APPROVED = "approved", "Aprobado"
        REJECTED = "rejected", "Rechazado"

    member = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="wildcards")
    date = models.DateField(help_text="El día que cubre")
    reason = models.CharField(max_length=160)
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.PENDING)
    decided_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    decided_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [models.UniqueConstraint(fields=["member", "date"], name="uniq_wildcard_day")]
        verbose_name = "comodín"
        verbose_name_plural = "comodines"


class StreakMilestone(TimeStamped):
    """Alguien cumplió 1, 2, 3… meses de racha: se anuncia a todo el gym."""

    member = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="streak_milestones")
    months = models.PositiveSmallIntegerField()
    reached_on = models.DateField()

    class Meta:
        ordering = ["-reached_on"]
        verbose_name = "racha de un mes o más"
        verbose_name_plural = "rachas de un mes o más"
