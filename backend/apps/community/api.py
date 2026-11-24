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


# ---------------- Rachas y gym sis / gym bro ----------------

from config.permissions import member_required  # noqa: E402

from . import streaks  # noqa: E402


class InviteIn(Schema):
    user_id: int


@router.get("/streaks", response=dict)
@member_required
def my_streaks(request):
    """Racha individual (kcal y entrenamientos), compas e invitaciones."""
    return streaks.overview(request.user)


@router.get("/buddies/search", response=list[dict])
@member_required
def buddy_search(request, q: str = ""):
    return streaks.search(request.user, q)


@router.post("/buddies", response=dict)
@member_required
def buddy_invite(request, data: InviteIn):
    return streaks.invite(request.user, data.user_id)


@router.post("/buddies/{buddy_id}/accept", response=dict)
@member_required
def buddy_accept(request, buddy_id: int):
    return streaks.accept(request.user, buddy_id)


@router.delete("/buddies/{buddy_id}", response=dict)
@member_required
def buddy_remove(request, buddy_id: int):
    streaks.remove(request.user, buddy_id)
    return {"ok": True}


@router.post("/buddies/{buddy_id}/nudge", response=dict)
@member_required
def buddy_nudge(request, buddy_id: int):
    streaks.nudge_kcal(request.user, buddy_id)
    return {"ok": True}


class WildcardIn(Schema):
    reason: str


class DecideIn(Schema):
    approve: bool


@router.post("/wildcards", response=dict)
@member_required
def wildcard_request(request, data: WildcardIn):
    """Pide un comodín (1 por semana) para el entrenamiento que no pudo hacer."""
    return streaks.request_wildcard(request.user, data.reason)


@coach_router.get("/wildcards", response=list[dict])
@coach_required
def wildcards_pending(request):
    return streaks.pending_wildcards()


@coach_router.post("/wildcards/{wildcard_id}/decide", response=dict)
@coach_required
def wildcard_decide(request, wildcard_id: int, data: DecideIn):
    return streaks.decide_wildcard(request.user, wildcard_id, data.approve)
