"""Avisos al celular (Web Push) y registro de agua.

`run_due()` corre cada 10 minutos (hilo de gunicorn.conf.py) y decide qué avisos tocan:
- clase/sesión reservada: ~1 hora antes
- entrenamiento: a la hora elegida, si hoy toca rutina y aún no la registra
- agua: cada 2 horas (10 a 20 h) mientras no llegue a su meta
- medidas: cuando pasa un mes (y cada mes) sin registrar peso o medidas
Cada aviso se anota en SentReminder antes de enviarse, así nunca se repite.
"""
import json
import logging
from datetime import datetime, time, timedelta

from django.conf import settings
from django.contrib.auth.models import User
from django.db import IntegrityError, transaction

from apps.accounts.services import ServiceError
from apps.common import now, today

from .models import PushSubscription, ReminderPrefs, SentReminder, WaterLog

log = logging.getLogger(__name__)

WATER_HOURS = (10, 12, 14, 16, 18, 20)
WATER_ML_PER_KG = 35
WATER_DEFAULT_ML = 2000
MEASURE_EVERY_DAYS = 30
MEASURE_HOURS = (10, 13)  # ventana del día para ese aviso
CLASS_LEAD_MIN = 70  # el aviso sale entre 70 y 0 minutos antes (revisión cada 10 min)
WORKOUT_WINDOW_H = 2


# ---------------- Preferencias y suscripciones ----------------

def prefs_for(user) -> ReminderPrefs:
    p, _ = ReminderPrefs.objects.get_or_create(user=user)
    return p


def prefs_payload(user) -> dict:
    p = prefs_for(user)
    return {
        "water": p.water,
        "water_goal_ml": p.water_goal_ml,
        "water_goal_auto_ml": auto_water_goal(user),
        "workout": p.workout,
        "workout_hour": p.workout_hour,
        "classes": p.classes,
        "measures": p.measures,
        "devices": PushSubscription.objects.filter(user=user).count(),
    }


def update_prefs(user, **values) -> dict:
    p = prefs_for(user)
    for k in ("water", "workout", "classes", "measures"):
        if values.get(k) is not None:
            setattr(p, k, bool(values[k]))
    if values.get("workout_hour") is not None:
        if not 5 <= values["workout_hour"] <= 22:
            raise ServiceError("Elige una hora entre 5 y 22.")
        p.workout_hour = values["workout_hour"]
    if "water_goal_ml" in values:
        v = values["water_goal_ml"]
        if v is not None and not 500 <= v <= 6000:
            raise ServiceError("La meta de agua debe estar entre 500 y 6,000 ml.")
        p.water_goal_ml = v
    p.save()
    return prefs_payload(user)


def subscribe(user, *, endpoint: str, p256dh: str, auth: str, user_agent: str = "") -> int:
    if not endpoint.startswith("https://"):
        raise ServiceError("Suscripción inválida.")
    PushSubscription.objects.update_or_create(
        endpoint=endpoint, defaults={"user": user, "p256dh": p256dh, "auth": auth, "user_agent": user_agent[:200]}
    )
    prefs_for(user)
    return PushSubscription.objects.filter(user=user).count()


def unsubscribe(user, endpoint: str):
    PushSubscription.objects.filter(user=user, endpoint=endpoint).delete()


def push_enabled() -> bool:
    return bool(settings.VAPID_PUBLIC_KEY and settings.VAPID_PRIVATE_KEY)


def send(user, *, title: str, body: str, url: str = "/app", tag: str = "") -> int:
    """Manda el aviso a todos los dispositivos de la persona. Borra los que ya no existen."""
    if not push_enabled():
        return 0
    from pywebpush import WebPushException, webpush

    payload = json.dumps({"title": title, "body": body, "url": url, "tag": tag})
    sent = 0
    for sub in PushSubscription.objects.filter(user=user):
        try:
            webpush(
                subscription_info={"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
                data=payload,
                vapid_private_key=settings.VAPID_PRIVATE_KEY,
                vapid_claims={"sub": settings.VAPID_SUBJECT},
                ttl=60 * 60,
                timeout=10,
            )
            sent += 1
        except WebPushException as e:
            status = getattr(e.response, "status_code", None)
            if status in (404, 410):  # el celular canceló el permiso o desinstaló
                sub.delete()
            else:
                log.warning("push falló (%s): %s", status, e)
        except Exception:  # noqa: BLE001
            log.exception("push falló")
    return sent


def send_once(user, kind: str, ref: str, **msg) -> bool:
    """Envía solo si este aviso (kind+ref) no se ha mandado antes."""
    try:
        with transaction.atomic():
            SentReminder.objects.create(user=user, kind=kind, ref=ref)
    except IntegrityError:
        return False
    send(user, **msg)
    return True


# ---------------- Agua ----------------

def _latest_weight(user):
    from apps.progress.models import BodyLog

    return BodyLog.objects.filter(member=user, weight_kg__isnull=False).order_by("-date").values_list("weight_kg", flat=True).first()


def auto_water_goal(user) -> int:
    w = _latest_weight(user)
    if not w:
        return WATER_DEFAULT_ML
    return int(min(4500, max(1500, round(float(w) * WATER_ML_PER_KG / 250) * 250)))


def water_goal(user) -> int:
    return prefs_for(user).water_goal_ml or auto_water_goal(user)


def water_today(user) -> dict:
    ml = WaterLog.objects.filter(member=user, date=today()).values_list("ml", flat=True).first() or 0
    return {"ml": ml, "goal_ml": water_goal(user)}


@transaction.atomic
def add_water(user, delta_ml: int) -> dict:
    if not -1000 <= delta_ml <= 2000 or delta_ml == 0:
        raise ServiceError("Cantidad inválida.")
    row, _ = WaterLog.objects.select_for_update().get_or_create(member=user, date=today())
    row.ml = max(0, min(15000, row.ml + delta_ml))
    row.save()
    return water_today(user)


# ---------------- Medidas ----------------

def days_without_measures(user) -> int:
    """Días desde el último registro de peso/medidas (o desde que se registró en la app)."""
    from apps.progress.models import BodyLog

    last = BodyLog.objects.filter(member=user).order_by("-date").values_list("date", flat=True).first()
    since = last or user.date_joined.date()
    return (today() - since).days


def measures_due(user) -> int | None:
    d = days_without_measures(user)
    return d if d >= MEASURE_EVERY_DAYS else None


# ---------------- Qué avisos tocan ----------------

def _fmt_hour(dt: datetime) -> str:
    h = dt.hour % 12 or 12
    return f"{h}:{dt.minute:02d} {'am' if dt.hour < 12 else 'pm'}"


def _members_with_push():
    from apps.accounts.services import features_for

    users = User.objects.filter(push_subscriptions__isnull=False, is_active=True).distinct().select_related("reminder_prefs")
    for u in users:
        f = features_for(u)
        if f["access"] and not f["coach"]:
            yield u, f


def due_for(user, feats, at: datetime) -> list[tuple[str, str, dict]]:
    """Lista de (kind, ref, mensaje) que tocan ahora para esta persona."""
    from apps.schedule.models import Booking
    from apps.training.services import today_workout_brief

    p = prefs_for(user)
    t = at.date()
    out = []

    if p.classes:
        bookings = Booking.objects.select_related("session__schedule").filter(
            member=user,
            status=Booking.Status.BOOKED,
            session__cancelled=False,
            session__start_at__gt=at,
            session__start_at__lte=at + timedelta(minutes=CLASS_LEAD_MIN),
        )
        for b in bookings:
            start = b.session.start_at.astimezone(at.tzinfo)
            out.append((
                "class",
                str(b.id),
                {"title": "Hoy tienes sesión 💪", "body": f"{b.session.schedule.name} a las {_fmt_hour(start)}. ¡Prepárate!", "url": "/app", "tag": f"class-{b.id}"},
            ))

    if p.workout and feats["routine"] and p.workout_hour <= at.hour < p.workout_hour + WORKOUT_WINDOW_H:
        brief = today_workout_brief(user)
        if brief and brief["status"] == "planned":
            out.append((
                "workout",
                t.isoformat(),
                {"title": "¿Ya entrenaste hoy?", "body": f"Aún no registras tu rutina: {brief['title']}. ¡Tú puedes!", "url": "/app/entrenar", "tag": "workout"},
            ))

    if p.water:
        slot = max((h for h in WATER_HOURS if h <= at.hour), default=None)
        if slot is not None and at - datetime.combine(t, time(slot), at.tzinfo) < timedelta(hours=1):
            w = water_today(user)
            if w["ml"] < w["goal_ml"]:
                out.append((
                    "water",
                    f"{t.isoformat()}:{slot}",
                    {"title": "Hora de tomar agua 💧", "body": f"Llevas {w['ml']:,} de {w['goal_ml']:,} ml hoy.", "url": "/app", "tag": "water"},
                ))

    if p.measures and MEASURE_HOURS[0] <= at.hour < MEASURE_HOURS[1]:
        d = measures_due(user)
        if d is not None:
            out.append((
                "measures",
                f"{t - timedelta(days=d)}:{d // MEASURE_EVERY_DAYS}",
                {"title": "Actualiza tu progreso 📏", "body": "Ya pasó un mes desde tu último registro. Anota tu peso y medidas para ver tu avance.", "url": "/app/progreso", "tag": "measures"},
            ))
    return out


def run_due(at: datetime | None = None) -> int:
    at = at or now()
    n = 0
    for user, feats in _members_with_push():
        for kind, ref, msg in due_for(user, feats, at):
            n += send_once(user, kind, ref, **msg)
    return n


def purge_old(days: int = 90):
    cutoff = now() - timedelta(days=days)
    SentReminder.objects.filter(sent_at__lt=cutoff).delete()
    WaterLog.objects.filter(date__lt=today() - timedelta(days=days)).delete()
