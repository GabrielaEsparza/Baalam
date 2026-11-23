"""Asistencia por QR. El token cambia cada 60 s: una foto del QR no sirve desde casa."""
import hashlib
import hmac
import time
from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, transaction

from apps.accounts.services import ServiceError
from apps.common import now, today
from apps.memberships.models import GymSettings
from apps.memberships.services import current_membership, display_status, has_access
from apps.podium import services as podium
from apps.podium.models import PointsLedger
from apps.schedule.models import Booking, Schedule, Session
from apps.schedule.services import allowed_types
from apps.training.services import is_swapped

WINDOW_S = 60


def _window(ts: float | None = None) -> int:
    return int((ts if ts is not None else time.time()) // WINDOW_S)


def _digest(window: int) -> bytes:
    return hmac.new(settings.QR_SECRET.encode(), f"baalam-checkin:{window}".encode(), hashlib.sha256).digest()


def token_for(window: int) -> str:
    return _digest(window).hex()[:32]


def code_for(window: int) -> str:
    return f"{int.from_bytes(_digest(window)[-4:], 'big') % 1_000_000:06d}"


def current_qr_token(ts: float | None = None) -> dict:
    ts = ts if ts is not None else time.time()
    w = _window(ts)
    return {
        "token": token_for(w),
        "code": code_for(w),
        "expires_in": int(WINDOW_S - (ts % WINDOW_S)),
    }


def verify(token: str | None = None, code: str | None = None, ts: float | None = None) -> bool:
    """Acepta la ventana actual o la anterior (tolerancia de reloj)."""
    w = _window(ts)
    for win in (w, w - 1):
        if token and hmac.compare_digest(token, token_for(win)):
            return True
        if code and hmac.compare_digest(code.strip(), code_for(win)):
            return True
    return False


def _find_booking_or_open_session(member):
    """Reserva de hoy dentro de [inicio − 30 min, fin], o un turno sin reserva obligatoria."""
    t = now()
    early = timedelta(minutes=GymSettings.load().checkin_early_min)
    booking = (
        Booking.objects.select_related("session__schedule")
        .filter(
            member=member,
            status=Booking.Status.BOOKED,
            session__date=today(),
            session__cancelled=False,
            session__start_at__lte=t + early,
            session__end_at__gte=t,
        )
        .first()
    )
    if booking:
        return booking, None
    open_session = Session.objects.filter(
        date=today(),
        cancelled=False,
        schedule__requires_reservation=False,
        schedule__type__in=allowed_types(member),
        start_at__lte=t + early,
        end_at__gte=t,
    ).first()
    return None, open_session


def _hhmm(dt) -> str:
    from django.utils import timezone as tz

    return tz.localtime(dt).strftime("%H:%M")


def _explain_no_booking(member) -> ServiceError:
    """Por qué no entra: aún es temprano, su horario ya pasó, o no reservó hoy."""
    t = now()
    early = timedelta(minutes=GymSettings.load().checkin_early_min)
    todays = list(
        Booking.objects.select_related("session__schedule")
        .filter(member=member, status=Booking.Status.BOOKED, session__date=today(), session__cancelled=False)
        .order_by("session__start_at")
    )
    upcoming = [b for b in todays if b.session.start_at - early > t]
    if upcoming:
        s = upcoming[0].session
        return ServiceError(
            f"Tu {s.schedule.name.lower()} es a las {_hhmm(s.start_at)}. "
            f"Puedes registrar tu asistencia desde las {_hhmm(s.start_at - early)}.",
            "too_early",
            403,
        )
    if todays:
        s = todays[-1].session
        return ServiceError(
            f"Tu horario de las {_hhmm(s.start_at)} ya terminó. Habla con tu coach si sí viniste.",
            "too_late",
            403,
        )
    return ServiceError("No tienes horario reservado hoy.", "no_booking", 403)


def _todays_booking_for_manual(member):
    """Check-in manual: liga la reserva de hoy más cercana a la hora actual, si la hay."""
    t = now()
    todays = list(
        Booking.objects.select_related("session__schedule").filter(
            member=member, status=Booking.Status.BOOKED, session__date=today(), session__cancelled=False
        )
    )
    return min(todays, key=lambda b: abs((b.session.start_at - t).total_seconds()), default=None)


def live_status() -> dict:
    """Para la pantalla de recepción: horarios abiertos para check-in ahora y quién ya llegó."""
    from django.db.models import Count, Q

    from .models import CheckIn

    t = now()
    early = timedelta(minutes=GymSettings.load().checkin_early_min)
    sessions = (
        Session.objects.filter(date=today(), cancelled=False, start_at__lte=t + early, end_at__gte=t)
        .select_related("schedule")
        .annotate(
            booked=Count("bookings", filter=Q(bookings__status__in=[Booking.Status.BOOKED, Booking.Status.ATTENDED])),
            attended=Count("bookings", filter=Q(bookings__status=Booking.Status.ATTENDED)),
        )
        .order_by("start_at")
    )
    nxt = (
        Session.objects.filter(date=today(), cancelled=False, start_at__gt=t + early)
        .select_related("schedule")
        .order_by("start_at")
        .first()
    )
    recent = CheckIn.objects.filter(date=today()).select_related("member__profile", "booking__session__schedule")[:8]
    return {
        "open_sessions": [
            {
                "id": s.id,
                "name": s.schedule.name,
                "type": s.schedule.type,
                "start_at": s.start_at,
                "end_at": s.end_at,
                "capacity": s.capacity,
                "booked": s.booked,
                "attended": s.attended,
                "requires_reservation": s.schedule.requires_reservation,
            }
            for s in sessions
        ],
        "next_session": (
            {"name": nxt.schedule.name, "start_at": nxt.start_at, "opens_at": nxt.start_at - early} if nxt else None
        ),
        "recent": [
            {
                "name": c.member.profile.full_name,
                "avatar_url": c.member.profile.avatar.url if c.member.profile.avatar else None,
                "at": c.at,
                "session": c.booking.session.schedule.name if c.booking else None,
            }
            for c in recent
        ],
        "today_count": CheckIn.objects.filter(date=today()).count(),
    }


def checkin(member, *, token: str | None = None, code: str | None = None, source: str = "qr", manual_by=None) -> dict:
    from .models import CheckIn

    from apps.accounts.services import ensure_member

    ensure_member(member)
    if manual_by is None and not verify(token=token, code=code):
        raise ServiceError("El código ya expiró. Escanea el QR de nuevo.", "bad_token")

    m = current_membership(member)
    status = display_status(m)
    if not has_access(status):
        msg = {
            "pending": "Tu cuenta aún no tiene membresía activa. Habla con tu coach.",
            "paused": "Tu membresía está pausada.",
            "expired": "Tu membresía venció. Renueva con tu coach para entrar.",
        }.get(status, "No tienes acceso.")
        raise ServiceError(msg, "no_access", 403)

    if CheckIn.objects.filter(member=member, date=today()).exists():
        raise ServiceError("Ya registraste tu asistencia hoy.", "already", 409)

    booking = open_session = None
    if manual_by is None:
        booking, open_session = _find_booking_or_open_session(member)
        if not booking and not open_session:
            raise _explain_no_booking(member)
    else:
        booking = _todays_booking_for_manual(member)

    try:
        with transaction.atomic():
            ci = CheckIn.objects.create(member=member, at=now(), date=today(), source=source, booking=booking)
            if booking:
                booking.status = Booking.Status.ATTENDED
                booking.save(update_fields=["status", "updated_at"])
            # Si hoy repone otro día de su rutina, no suma puntos por asistir a su horario.
            swapped = is_swapped(member)
            awarded = [] if swapped else [podium.award(member, PointsLedger.Reason.CHECKIN)]
            # En clase hacen lo que la coach indique: asistir cuenta como entrenamiento completo.
            # (Una sola asistencia por día; los PR solo los suma quien registra sus series en piso libre.)
            if not swapped and booking and booking.session.schedule.type == Schedule.Type.CLASS:
                awarded.append(podium.award(member, PointsLedger.Reason.WORKOUT))
                # Bono de puntualidad: llegar a la clase a tiempo (con unos minutos de tolerancia).
                if ci.at <= booking.session.start_at + timedelta(minutes=podium.PUNCTUAL_GRACE_MIN):
                    awarded.append(podium.award(member, PointsLedger.Reason.PUNCTUAL))
            podium.check_weekly_streak(member)
    except IntegrityError:
        raise ServiceError("Ya registraste tu asistencia hoy.", "already", 409)

    session = booking.session if booking else open_session
    return {
        "checkin": ci,
        "session": (
            {"name": session.schedule.name, "start_at": session.start_at, "end_at": session.end_at} if session else None
        ),
        "points": sum(a.points for a in awarded if a),
        "warning": "Tu membresía está en días de gracia: renueva pronto." if status == "grace" else None,
    }
