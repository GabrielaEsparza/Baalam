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
