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
