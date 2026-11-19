from datetime import datetime

from django.shortcuts import get_object_or_404
from ninja import Router, Schema

from apps.common import now
from config.permissions import coach_required

from . import services
from .models import Announcement

router = Router(tags=["comunidad"])
coach_router = Router(tags=["coach"])


class AnnouncementIO(Schema):
    id: int | None = None
    title: str
    body: str = ""
    pinned: bool = False
    publish_at: datetime | None = None


@router.get("/announcements", response=list[AnnouncementIO])
def feed(request):
    return services.feed()


@coach_router.get("/announcements", response=list[AnnouncementIO])
@coach_required
def all_announcements(request):
    return list(Announcement.objects.all()[:100])


@coach_router.post("/announcements", response={201: AnnouncementIO})
@coach_required
def create(request, data: AnnouncementIO):
    d = data.dict(exclude={"id"})
    d["publish_at"] = d["publish_at"] or now()
    return 201, Announcement.objects.create(author=request.user, **d)


@coach_router.put("/announcements/{ann_id}", response=AnnouncementIO)
@coach_required
def update(request, ann_id: int, data: AnnouncementIO):
    a = get_object_or_404(Announcement, id=ann_id)
    for k, v in data.dict(exclude={"id"}).items():
        if v is not None:
            setattr(a, k, v)
    a.save()
    return a


@coach_router.delete("/announcements/{ann_id}")
@coach_required
def delete(request, ann_id: int):
    Announcement.objects.filter(id=ann_id).delete()
    return {"ok": True}
