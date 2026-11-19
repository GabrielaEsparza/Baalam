"""Horarios, reserva del mes y cambios. Nunca se cancela: se cambia."""
from datetime import date, datetime, timedelta

from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone

from apps.accounts.services import ServiceError, features_for
from apps.common import daterange, month_key, now, parse_month, today, week_bounds
from apps.memberships.models import GymSettings
from apps.memberships.services import current_membership

from .models import Booking, Schedule, Session, WaitlistEntry

ACTIVE = Booking.ACTIVE_STATUSES


# ---------- Sesiones concretas ----------

def generate_sessions(start: date, end: date) -> int:
    """Crea las Sessions de cada Schedule activo entre start y end (idempotente)."""
    created = 0
    tz = timezone.get_current_timezone()
    for sch in Schedule.objects.filter(active=True, one_off=False):
        for d in daterange(start, end):
            if d.weekday() not in sch.weekdays:
                continue
            start_at = timezone.make_aware(datetime.combine(d, sch.start_time), tz)
            _, was_created = Session.objects.get_or_create(
                schedule=sch,
                date=d,
                defaults={
                    "start_at": start_at,
                    "end_at": start_at + timedelta(minutes=sch.duration_min),
                    "capacity": sch.capacity,
                },
            )
            created += was_created
    return created


def taken(session: Session) -> int:
    return session.bookings.filter(status__in=ACTIVE).count()


def allowed_types(member) -> set[str]:
    f = features_for(member)
    types = set()
    if f["open_gym"]:
        types.add(Schedule.Type.OPEN_GYM)
    if f["classes"]:
        types.add(Schedule.Type.CLASS)
    return types


def sessions_for(member, start: date, end: date):
    """Sesiones del tipo de su plan con cupo libre anotado."""
    return (
        Session.objects.filter(
            date__range=(start, end), cancelled=False, schedule__type__in=allowed_types(member)
        )
        .select_related("schedule")
        .annotate(taken=Count("bookings", filter=Q(bookings__status__in=ACTIVE)))
    )


def weekly_count(member, d: date, exclude_booking_id: int | None = None) -> int:
    start, end = week_bounds(d)
    qs = Booking.objects.filter(
        member=member,
        session__date__range=(start, end),
        status__in=(Booking.Status.BOOKED, Booking.Status.ATTENDED, Booking.Status.MISSED),
    )
    if exclude_booking_id:
        qs = qs.exclude(id=exclude_booking_id)
    return qs.count()


def booking_month_open(month: str, on: date | None = None) -> bool:
    on = on or today()
    first, _ = parse_month(month)
    if month == month_key(on):
        return True
    next_first = (on.replace(day=1) + timedelta(days=32)).replace(day=1)
    return first == next_first and on.day >= GymSettings.load().booking_open_day


def _require_access(member):
    from apps.accounts.services import ensure_member

    ensure_member(member)
    f = features_for(member)
    if not f["access"]:
        raise ServiceError("Necesitas una membresía activa para reservar.", "no_access", 403)
    return current_membership(member)


# ---------- Reserva del mes ----------

@transaction.atomic
def book_month(member, month: str, pattern: list[dict]) -> dict:
    """pattern = [{weekday: 0..6, schedule_id}] -> {created: [...], conflicts: [...]}"""
    membership = _require_access(member)
    if not booking_month_open(month):
        raise ServiceError("La reserva de ese mes todavía no está abierta.", "month_closed")
    weekdays = [p["weekday"] for p in pattern]
    if len(set(weekdays)) != len(weekdays):
        raise ServiceError("Solo un horario por día de la semana.")
    if len(pattern) > membership.sessions_per_week:
        raise ServiceError(
            f"Tu plan permite {membership.sessions_per_week} días por semana.", "too_many_days"
        )
    types = allowed_types(member)
    schedules = {s.id: s for s in Schedule.objects.filter(id__in=[p["schedule_id"] for p in pattern], active=True)}
    for p in pattern:
        sch = schedules.get(p["schedule_id"])
        if not sch or sch.type not in types:
            raise ServiceError("Ese horario no es de tu plan.", "wrong_type")
        if p["weekday"] not in sch.weekdays:
            raise ServiceError(f"{sch.name} no abre ese día.")

    first, last = parse_month(month)
    start = max(first, today())
    generate_sessions(start, last)
    t_now = now()
    created, conflicts = [], []
    by_weekday = {p["weekday"]: schedules[p["schedule_id"]] for p in pattern}

    for d in daterange(start, last):
        sch = by_weekday.get(d.weekday())
        if not sch:
            continue
        session = Session.objects.select_for_update().filter(schedule=sch, date=d).first()
        if not session or session.cancelled or session.start_at <= t_now:
            continue
        if Booking.objects.filter(member=member, session__date=d, status__in=ACTIVE).exists():
            continue
        if weekly_count(member, d) >= membership.sessions_per_week:
            continue
        if taken(session) >= session.capacity:
            conflicts.append({"date": d, "schedule_id": sch.id, "reason": "full"})
            continue
        b = Booking.objects.create(member=member, session=session, month=month)
        created.append(b)
    return {"created": created, "conflicts": conflicts}


@transaction.atomic
def book_single(member, session_id: int) -> Booking:
    """Reserva una fecha suelta (ej. completar una fecha en conflicto)."""
    membership = _require_access(member)
    session = Session.objects.select_for_update().select_related("schedule").filter(id=session_id).first()
    if not session or session.cancelled or session.start_at <= now():
        raise ServiceError("Ese horario ya no está disponible.")
    if session.schedule.type not in allowed_types(member):
        raise ServiceError("Ese horario no es de tu plan.", "wrong_type")
    if Booking.objects.filter(member=member, session__date=session.date, status__in=ACTIVE).exists():
        raise ServiceError("Ya tienes reserva ese día.")
    if weekly_count(member, session.date) >= membership.sessions_per_week:
        raise ServiceError("Ya completaste tus días de esta semana.", "too_many_days")
    if taken(session) >= session.capacity:
        raise ServiceError("Ese horario está lleno.", "full")
    return Booking.objects.create(member=member, session=session, month=month_key(session.date))


# ---------- Cambios ----------

def _validate_change(member, booking: Booking, target: Session):
    s = GymSettings.load()
    if booking.status != Booking.Status.BOOKED:
        raise ServiceError("Solo puedes cambiar reservas pendientes.")
    if now() > booking.session.start_at - timedelta(hours=s.change_deadline_hours):
        raise ServiceError(
            f"Los cambios se hacen hasta {s.change_deadline_hours} h antes.", "too_late"
        )
    if target.cancelled or target.start_at <= now():
        raise ServiceError("Ese horario ya no está disponible.")
    if target.id == booking.session_id:
        raise ServiceError("Ya estás en ese horario.")
    if week_bounds(target.date) != week_bounds(booking.session.date):
        raise ServiceError("Solo puedes cambiar dentro de la misma semana.", "other_week")
    if target.schedule.type not in allowed_types(member):
        raise ServiceError("Ese horario no es de tu plan.", "wrong_type")
    other_same_day = Booking.objects.filter(
        member=member, session__date=target.date, status__in=ACTIVE
    ).exclude(id=booking.id)
    if other_same_day.exists():
        raise ServiceError("Ya tienes otra reserva ese día.")


def _apply_change(booking: Booking, target: Session) -> Booking:
    booking.status = Booking.Status.MOVED
    booking.save(update_fields=["status", "updated_at"])
    new = Booking.objects.create(
        member=booking.member, session=target, month=month_key(target.date), moved_from=booking
    )
    WaitlistEntry.objects.filter(from_booking=booking, active=True).update(active=False)
    return new


@transaction.atomic
def change_booking(member, booking_id: int, session_id: int) -> dict:
    from apps.accounts.services import ensure_member

    ensure_member(member)
    booking = (
        Booking.objects.select_for_update().select_related("session__schedule").filter(id=booking_id, member=member).first()
    )
    if not booking:
        raise ServiceError("Reserva no encontrada.", "not_found", 404)
    target = Session.objects.select_for_update().select_related("schedule").filter(id=session_id).first()
    if not target:
        raise ServiceError("Horario no encontrado.", "not_found", 404)
    _validate_change(member, booking, target)

    if taken(target) < target.capacity:
        old_session = booking.session
        new = _apply_change(booking, target)
        process_waitlist(old_session)
        return {"status": "changed", "booking": new}

    entry, _ = WaitlistEntry.objects.get_or_create(
        member=member, from_booking=booking, target_session=target, active=True
    )
    return {"status": "waitlisted", "waitlist": entry}


def process_waitlist(session: Session) -> list[Booking]:
    """Cuando se libera lugar, el primero de la fila se cambia solo."""
    moved = []
    for entry in WaitlistEntry.objects.select_related("from_booking__session", "target_session__schedule").filter(
        target_session=session, active=True
    ):
        if taken(session) >= session.capacity:
            break
        try:
            _validate_change(entry.member, entry.from_booking, session)
        except ServiceError:
            entry.active = False
            entry.save(update_fields=["active", "updated_at"])
            continue
        old_session = entry.from_booking.session
        new = _apply_change(entry.from_booking, session)
        entry.active = False
        entry.save(update_fields=["active", "updated_at"])
        moved.append(new)
        # TODO fase 2: notificación push/correo "Tu cambio se hizo".
        moved += process_waitlist(old_session)
    return moved


def leave_waitlist(member, entry_id: int):
    n = WaitlistEntry.objects.filter(id=entry_id, member=member, active=True).update(active=False)
    if not n:
        raise ServiceError("No estás en esa lista de espera.", "not_found", 404)


# ---------- Coach ----------

@transaction.atomic
def coach_cancel_booking(booking_id: int):
    b = Booking.objects.select_related("session").get(id=booking_id)
    b.status = Booking.Status.CANCELLED
    b.save(update_fields=["status", "updated_at"])
    process_waitlist(b.session)


@transaction.atomic
def coach_add_booking(member, session_id: int) -> Booking:
    """El coach puede agregar a cualquier miembro (día extra), incluso sobre el cupo."""
    from apps.accounts.services import ensure_member

    ensure_member(member)
    session = Session.objects.get(id=session_id)
    return Booking.objects.create(member=member, session=session, month=month_key(session.date))


def _editable(session_id: int) -> Session:
    session = Session.objects.select_for_update().select_related("schedule").filter(id=session_id).first()
    if not session:
        raise ServiceError("Ese horario no existe.", "not_found", 404)
    if session.date < today():
        raise ServiceError("No se pueden cambiar fechas pasadas.")
    return session


@transaction.atomic
def cancel_session(session_id: int):
    """Cierra solo esa fecha. Guarda qué reservas tenía para poder reabrirla igual."""
    session = _editable(session_id)
    if session.cancelled:
        return session
    booked = session.bookings.filter(status=Booking.Status.BOOKED)
    session.cancelled_booking_ids = list(booked.values_list("id", flat=True))
    session.cancelled = True
    session.save(update_fields=["cancelled", "cancelled_booking_ids", "updated_at"])
    booked.update(status=Booking.Status.CANCELLED)
    WaitlistEntry.objects.filter(target_session=session, active=True).update(active=False)
    return session


@transaction.atomic
def reopen_session(session_id: int) -> Session:
    """Vuelve a abrir esa fecha y regresa las reservas que tenía al cerrarla."""
    session = _editable(session_id)
    if not session.cancelled:
        return session
    session.bookings.filter(id__in=session.cancelled_booking_ids, status=Booking.Status.CANCELLED).update(
        status=Booking.Status.BOOKED
    )
    session.cancelled = False
    session.cancelled_booking_ids = []
    session.save(update_fields=["cancelled", "cancelled_booking_ids", "updated_at"])
    return session


@transaction.atomic
def edit_session(session_id: int, *, start_time, duration_min: int, capacity: int) -> Session:
    """Cambia hora, duración o cupo SOLO de esa fecha; el horario fijo y las reservas siguen igual."""
    session = _editable(session_id)
    n = taken(session)
    if capacity < n:
        raise ServiceError(f"Ya hay {n} reservas; el cupo no puede ser menor.")
    tz = timezone.get_current_timezone()
    start_at = timezone.make_aware(datetime.combine(session.date, start_time), tz)
    session.start_at = start_at
    session.end_at = start_at + timedelta(minutes=duration_min)
    session.capacity = capacity
    session.edited = True
    session.save(update_fields=["start_at", "end_at", "capacity", "edited", "updated_at"])
    process_waitlist(session)
    return session


@transaction.atomic
def create_extra_session(
    *, name: str, type: str, on: date, start_time, duration_min: int, capacity: int, requires_reservation: bool = True
) -> Session:
    """Abre un horario de un solo día. No aparece en los horarios fijos ni en la reserva del mes."""
    if on < today():
        raise ServiceError("Elige hoy o una fecha futura.")
    sch = Schedule.objects.create(
        name=name.strip() or ("Clase extra" if type == Schedule.Type.CLASS else "Turno extra"),
        type=type,
        weekdays=[],
        start_time=start_time,
        duration_min=duration_min,
        capacity=capacity,
        requires_reservation=requires_reservation,
        one_off=True,
    )
    tz = timezone.get_current_timezone()
    start_at = timezone.make_aware(datetime.combine(on, start_time), tz)
    return Session.objects.create(
        schedule=sch, date=on, start_at=start_at, end_at=start_at + timedelta(minutes=duration_min), capacity=capacity
    )


def mark_missed(on: date) -> int:
    """Cron: reservas de días pasados sin check-in quedan como falta."""
    return Booking.objects.filter(session__date__lt=on, status=Booking.Status.BOOKED).update(
        status=Booking.Status.MISSED
    )


def missing_days_this_week(member, on: date | None = None) -> int:
    on = on or today()
    m = current_membership(member)
    if not m:
        return 0
    return max(0, m.sessions_per_week - weekly_count(member, on))
