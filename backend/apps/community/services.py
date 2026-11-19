from apps.common import now

from .models import Announcement


def _published():
    return Announcement.objects.filter(publish_at__lte=now())


def feed(limit: int = 20):
    return list(_published()[:limit])


def latest() -> Announcement | None:
    return _published().first()
