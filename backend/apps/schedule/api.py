import datetime as dt
from datetime import date, datetime, time, timedelta

from django.contrib.auth import get_user_model
from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from ninja import Router, Schema
from pydantic import Field

from apps.common import month_key, today, week_bounds
from config.permissions import coach_required

from . import services
from .models import Booking, Schedule, Session, WaitlistEntry

User = get_user_model()
router = Router(tags=["horarios"])
coach_router = Router(tags=["coach"])


class SessionOut(Schema):
    id: int
    schedule_id: int
    name: str
    type: str
    date: dt.date
    start_at: datetime
    end_at: datetime
    capacity: int
    taken: int


class BookingOut(Schema):
    id: int
    status: str
    session: SessionOut


class PatternItem(Schema):
    weekday: int = Field(ge=0, le=6)
    schedule_id: int


class BookMonthIn(Schema):
    month: str = Field(pattern=r"^\d{4}-\d{2}$")
    pattern: list[PatternItem]


class ChangeIn(Schema):
    session_id: int


class ScheduleIO(Schema):
    id: int | None = None
    name: str
    type: str = Field(pattern="^(open_gym|class)$")
    weekdays: list[int]
    start_time: time
    duration_min: int = Field(60, ge=15, le=300)
    capacity: int = Field(12, ge=1, le=200)
    requires_reservation: bool = True
    active: bool = True


def session_out(s: Session, taken: int | None = None) -> dict:
    return {
        "id": s.id,
        "schedule_id": s.schedule_id,
        "name": s.schedule.name,
        "type": s.schedule.type,
        "date": s.date,
        "start_at": s.start_at,
        "end_at": s.end_at,
        "capacity": s.capacity,
        "taken": taken if taken is not None else services.taken(s),
    }


def booking_out(b: Booking) -> dict:
    return {"id": b.id, "status": b.status, "session": session_out(b.session)}


# ---------- Miembro ----------

@router.get("/schedule/sessions", response=list[SessionOut])
def list_sessions(request, start: date, end: date):
    services.generate_sessions(start, end)
    return [session_out(s, s.taken) for s in services.sessions_for(request.user, start, end)]


@router.get("/schedule/schedules", response=list[ScheduleIO])
def my_schedules(request):
    """Horarios recurrentes de su plan, para armar el patrón semanal."""
    return list(Schedule.objects.filter(active=True, one_off=False, type__in=services.allowed_types(request.user)))


@router.get("/bookings", response=dict)
def my_bookings(request, month: str | None = None):
    month = month or month_key(today())
    qs = (
        Booking.objects.filter(member=request.user, month=month)
        .exclude(status=Booking.Status.MOVED)
        .select_related("session__schedule")
    )
    waits = WaitlistEntry.objects.filter(member=request.user, active=True).select_related("target_session__schedule")
    return {
        "month": month,
        "open": services.booking_month_open(month),
        "bookings": [booking_out(b) for b in qs],
        "waitlist": [
            {"id": w.id, "from_booking_id": w.from_booking_id, "target": session_out(w.target_session)} for w in waits
        ],
    }


@router.post("/bookings/month", response=dict)
def book_month(request, data: BookMonthIn):
    res = services.book_month(request.user, data.month, [p.dict() for p in data.pattern])
    return {
        "created": [booking_out(b) for b in res["created"]],
        "conflicts": res["conflicts"],
    }


@router.post("/bookings/single", response=BookingOut)
def book_single(request, data: ChangeIn):
    return booking_out(services.book_single(request.user, data.session_id))


@router.post("/bookings/{booking_id}/change", response=dict)
def change(request, booking_id: int, data: ChangeIn):
    res = services.change_booking(request.user, booking_id, data.session_id)
    if res["status"] == "changed":
        return {"status": "changed", "booking": booking_out(res["booking"])}
    return {"status": "waitlisted", "waitlist_id": res["waitlist"].id}


@router.delete("/waitlist/{entry_id}")
def leave_waitlist(request, entry_id: int):
    services.leave_waitlist(request.user, entry_id)
    return {"ok": True}


# ---------- Coach ----------

@coach_router.get("/schedules", response=list[ScheduleIO])
@coach_required
def schedules(request):
    return list(Schedule.objects.filter(one_off=False))


@coach_router.post("/schedules", response={201: ScheduleIO})
@coach_required
def create_schedule(request, data: ScheduleIO):
    s = Schedule.objects.create(**data.dict(exclude={"id"}))
    services.generate_sessions(today(), today() + timedelta(weeks=6))
    return 201, s


@coach_router.put("/schedules/{schedule_id}", response=ScheduleIO)
@coach_required
def update_schedule(request, schedule_id: int, data: ScheduleIO):
    s = get_object_or_404(Schedule, id=schedule_id)
    for k, v in data.dict(exclude={"id"}).items():
        setattr(s, k, v)
    s.save()
    # El cupo nuevo aplica a las fechas futuras ya generadas.
    # Las fechas que el coach ajustó a mano se respetan.
    s.sessions.filter(date__gte=today(), edited=False).update(capacity=s.capacity)
    return s


@coach_router.post("/sessions/{session_id}/cancel")
@coach_required
def cancel_session(request, session_id: int):
    services.cancel_session(session_id)
    return {"ok": True}


@coach_router.post("/sessions/{session_id}/reopen")
@coach_required
def reopen_session(request, session_id: int):
    services.reopen_session(session_id)
    return {"ok": True}


class ExtraSessionIn(Schema):
    name: str = ""
    type: str = Field(pattern="^(open_gym|class)$")
    date: dt.date
    start_time: time
    duration_min: int = Field(60, ge=15, le=300)
    capacity: int = Field(12, ge=1, le=200)
    requires_reservation: bool = True


@coach_router.post("/sessions/extra", response={201: dict})
@coach_required
def extra_session(request, data: ExtraSessionIn):
    d = data.dict()
    s = services.create_extra_session(on=d.pop("date"), **d)
    return 201, {**session_out(s), "cancelled": False, "edited": False}


class SessionEditIn(Schema):
    start_time: time
    duration_min: int = Field(60, ge=15, le=300)
    capacity: int = Field(12, ge=1, le=200)


@coach_router.patch("/sessions/{session_id}", response=dict)
@coach_required
def edit_session(request, session_id: int, data: SessionEditIn):
    s = services.edit_session(session_id, **data.dict())
    return {**session_out(s), "cancelled": s.cancelled, "edited": s.edited}


@coach_router.get("/occupancy", response=dict)
@coach_required
def occupancy(request, week: date | None = None):
    start, end = week_bounds(week or today())
    services.generate_sessions(start, end)
    sessions = (
        Session.objects.filter(date__range=(start, end))
        .select_related("schedule")
        .annotate(taken=Count("bookings", filter=Q(bookings__status__in=Booking.ACTIVE_STATUSES)))
    )
    month = month_key(start)
    booked_ids = set(Booking.objects.filter(month=month).values_list("member_id", flat=True))
    from apps.accounts.models import Profile
    from apps.memberships.services import current_membership, display_status, has_access

    not_booked = []
    for p in Profile.objects.filter(role="member", status="active").select_related("user"):
        if p.user_id in booked_ids:
            continue
        if has_access(display_status(current_membership(p.user))):
            not_booked.append({"id": p.user_id, "name": p.full_name})
    missed = Booking.objects.filter(session__date__range=(start, end), status=Booking.Status.MISSED).select_related(
        "member__profile", "session__schedule"
    )
    return {
        "week_start": start,
        "sessions": [
            {
                **session_out(s, s.taken),
                "cancelled": s.cancelled,
                "edited": s.edited,
                "extra": s.schedule.one_off,
                "past": s.date < today(),
            }
            for s in sessions
        ],
        "not_booked": not_booked,
        "missed": [
            {"member_id": b.member_id, "name": b.member.profile.full_name, "date": b.session.date, "session": b.session.schedule.name}
            for b in missed
        ],
    }


@coach_router.get("/sessions/{session_id}/bookings", response=list[dict])
@coach_required
def session_bookings(request, session_id: int):
    return [
        {"id": b.id, "member_id": b.member_id, "name": b.member.profile.full_name, "status": b.status}
        for b in Booking.objects.filter(session_id=session_id)
        .exclude(status=Booking.Status.MOVED)
        .select_related("member__profile")
    ]


class CoachBookingIn(Schema):
    member_id: int
    session_id: int


@coach_router.post("/bookings", response={201: dict})
@coach_required
def coach_add(request, data: CoachBookingIn):
    b = services.coach_add_booking(get_object_or_404(User, id=data.member_id), data.session_id)
    return 201, {"id": b.id}


@coach_router.delete("/bookings/{booking_id}")
@coach_required
def coach_remove(request, booking_id: int):
    services.coach_cancel_booking(booking_id)
    return {"ok": True}
