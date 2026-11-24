"""Avisos al celular (Web Push) y registro de agua.

`run_due()` corre cada 10 minutos (hilo de gunicorn.conf.py) y decide qué avisos tocan:
- agua: diario, cada 2 horas (10 a 20 h) mientras no llegue a su meta
- comida: diario, 15 h si no registró desayuno/comida y 21 h si no registró la cena
- entrenamiento: solo días de gym (L–V) con rutina, a la hora elegida, si aún no la registra
- sesión reservada: ~1 hora antes (L–V)
- viernes: si esa semana fue menos días de los que le tocan y hoy aún hay lugar en un horario
- medidas: diario mientras nunca las haya registrado; después, cada mes sin actualizarlas
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

from .models import FcmDevice, PushSubscription, ReminderPrefs, SentReminder, WaterLog

log = logging.getLogger(__name__)

WATER_HOURS = (10, 12, 14, 16, 18, 20)
WATER_ML_PER_KG = 35
WATER_DEFAULT_ML = 2000
MEASURE_EVERY_DAYS = 30
MEASURE_HOURS = (10, 13)  # ventana del día para ese aviso
GYM_WEEKDAYS = (0, 1, 2, 3, 4)  # lunes a viernes (sábado y domingo cerrado)
CATCHUP_WEEKDAY = 4  # viernes: último día para reponer la semana
CATCHUP_HOURS = (8, 10)
FOOD_SLOTS = {15: ("breakfast", "lunch"), 21: ("dinner",)}
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
        "food": p.food,
        "devices": PushSubscription.objects.filter(user=user).count() + FcmDevice.objects.filter(user=user).count(),
    }


def update_prefs(user, **values) -> dict:
    p = prefs_for(user)
    for k in ("water", "workout", "classes", "measures", "food"):
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


# ---------- Firebase (app de Android) ----------

def register_fcm(user, token: str) -> int:
    token = (token or "").strip()
    if not 20 <= len(token) <= 300:
        raise ServiceError("Identificador de avisos inválido.")
    FcmDevice.objects.update_or_create(token=token, defaults={"user": user})
    prefs_for(user)
    return FcmDevice.objects.filter(user=user).count()


def unregister_fcm(user, token: str):
    FcmDevice.objects.filter(user=user, token=(token or "").strip()).delete()


_fcm_cache: dict = {}


def _fcm_credentials():
    """(project_id, access_token) de la cuenta de servicio; el token se reutiliza hasta que vence."""
    if not settings.FCM_SERVICE_ACCOUNT:
        return None
    from google.auth.transport.requests import Request
    from google.oauth2 import service_account

    creds = _fcm_cache.get("creds")
    if creds is None:
        info = json.loads(settings.FCM_SERVICE_ACCOUNT)
        creds = service_account.Credentials.from_service_account_info(
            info, scopes=["https://www.googleapis.com/auth/firebase.messaging"]
        )
        _fcm_cache["creds"], _fcm_cache["project"] = creds, info["project_id"]
    if not creds.valid:
        creds.refresh(Request())
    return _fcm_cache["project"], creds.token


def send_fcm(user, *, title: str, body: str, url: str, tag: str) -> int:
    """Aviso nativo a los celulares con la app de Android. Borra los que ya no existen."""
    devices = list(FcmDevice.objects.filter(user=user))
    if not devices:
        return 0
    try:
        cred = _fcm_credentials()
    except Exception:  # noqa: BLE001
        log.exception("Firebase: no se pudieron obtener credenciales")
        return 0
    if not cred:
        return 0
    import requests

    project, access = cred
    sent = 0
    for d in devices:
        msg = {
            "message": {
                "token": d.token,
                # Solo datos: la app arma la notificación (ícono, canal y a dónde abre).
                "data": {"title": title, "body": body, "url": url, "tag": tag or ""},
                "android": {"priority": "HIGH", "ttl": "3600s"},
            }
        }
        try:
            r = requests.post(
                f"https://fcm.googleapis.com/v1/projects/{project}/messages:send",
                json=msg, headers={"Authorization": f"Bearer {access}"}, timeout=10,
            )
        except requests.RequestException as e:
            log.warning("Firebase sin conexión: %s", e)
            continue
        if r.ok:
            sent += 1
        elif r.status_code == 404 or "UNREGISTERED" in r.text or "registration-token-not-registered" in r.text:
            d.delete()  # desinstalaron la app
        else:
            log.warning("Firebase respondió %s: %s", r.status_code, r.text[:300])
    return sent


def send(user, *, title: str, body: str, url: str = "/app", tag: str = "") -> int:
    """Manda el aviso a todos los dispositivos de la persona (app de Android por Firebase; web por
    Web Push). Borra los que ya no existen."""
    sent = send_fcm(user, title=title, body=body, url=url, tag=tag)
    if not push_enabled():
        return sent
    from pywebpush import WebPushException, webpush

    payload = json.dumps({"title": title, "body": body, "url": url, "tag": tag})
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

def _last_measure_date(user):
    from apps.progress.models import BodyLog

    return BodyLog.objects.filter(member=user).order_by("-date").values_list("date", flat=True).first()


def measures_never(user) -> bool:
    """Nunca ha registrado peso ni medidas."""
    return _last_measure_date(user) is None


def measures_due(user) -> int | None:
    """Días sin actualizar peso/medidas si ya pasó un mes (None si no toca o si nunca las registró)."""
    last = _last_measure_date(user)
    if last is None:
        return None
    d = (today() - last).days
    return d if d >= MEASURE_EVERY_DAYS else None


def catchup_session(user, feats, at: datetime):
    """Viernes: si esa semana fue menos días de los que le tocan y hoy aún hay lugar en un horario
    de su plan (que no haya empezado), devuelve (sesión, días que le faltan). Si no, None."""
    from django.db.models import Count, Q

    from apps.checkin.models import CheckIn
    from apps.common import week_bounds
    from apps.memberships.services import current_membership
    from apps.schedule.models import Booking, Schedule, Session

    m = current_membership(user)
    if not m or not m.sessions_per_week:
        return None
    start, _ = week_bounds(at.date())
    attended = CheckIn.objects.filter(member=user, date__range=(start, at.date())).count()
    if attended >= m.sessions_per_week:
        return None
    if Booking.objects.filter(member=user, session__date=at.date(), status__in=Booking.ACTIVE_STATUSES).exists():
        return None  # ya tiene lugar hoy
    types = [t for t, ok in ((Schedule.Type.OPEN_GYM, feats["open_gym"]), (Schedule.Type.CLASS, feats["classes"])) if ok]
    sessions = (
        Session.objects.filter(date=at.date(), cancelled=False, start_at__gt=at, schedule__type__in=types)
        .select_related("schedule")
        .annotate(taken=Count("bookings", filter=Q(bookings__status__in=Booking.ACTIVE_STATUSES)))
        .order_by("start_at")
    )
    s = next((s for s in sessions if s.taken < s.capacity), None)
    return (s, m.sessions_per_week - attended) if s else None


# ---------------- Qué avisos tocan ----------------

def _fmt_hour(dt: datetime) -> str:
    h = dt.hour % 12 or 12
    return f"{h}:{dt.minute:02d} {'am' if dt.hour < 12 else 'pm'}"


def _members_with_push():
    from apps.accounts.services import features_for

    from django.db.models import Q

    users = (
        User.objects.filter(Q(push_subscriptions__isnull=False) | Q(fcm_devices__isnull=False), is_active=True)
        .distinct()
        .select_related("reminder_prefs")
    )
    for u in users:
        f = features_for(u)
        if f["access"] and not f["coach"]:
            yield u, f


def due_for(user, feats, at: datetime) -> list[tuple[str, str, dict]]:
    """Lista de (kind, ref, mensaje) que tocan ahora para esta persona."""
    from apps.schedule.models import Booking
    from apps.training.services import today_workout_brief

    from apps.nutrition.models import FoodLog

    p = prefs_for(user)
    t = at.date()
    gym_day = t.weekday() in GYM_WEEKDAYS
    out = []

    if p.classes and gym_day:
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

    if p.classes and t.weekday() == CATCHUP_WEEKDAY and CATCHUP_HOURS[0] <= at.hour < CATCHUP_HOURS[1]:
        found = catchup_session(user, feats, at)
        if found:
            s, missing = found
            start = s.start_at.astimezone(at.tzinfo)
            days = "1 día" if missing == 1 else f"{missing} días"
            year, week, _ = t.isocalendar()
            out.append((
                "catchup",
                f"{year}-W{week}",
                {
                    "title": "¡Aún puedes completar tu semana!",
                    "body": f"Te faltó {days} esta semana. Hoy hay lugar en {s.schedule.name} a las {_fmt_hour(start)}.",
                    "url": "/app/horarios",
                    "tag": "catchup",
                },
            ))

    if p.workout and gym_day and feats["routine"] and p.workout_hour <= at.hour < p.workout_hour + WORKOUT_WINDOW_H:
        brief = today_workout_brief(user)
        if brief and brief["status"] == "planned":
            out.append((
                "workout",
                t.isoformat(),
                {"title": "¿Ya entrenaste hoy?", "body": f"Aún no registras tu rutina: {brief['title']}. ¡Tú puedes!", "url": "/app/entrenar", "tag": "workout"},
            ))

    if at.hour >= 22:
        from apps.community.streaks import wildcard_offer_day

        if wildcard_offer_day(user) == t:
            out.append((
                "wildcard",
                t.isoformat(),
                {
                    "title": "¿No pudiste entrenar hoy? 🃏",
                    "body": "Pide tu comodín (1 por semana) y tu coach lo revisa. Así no pierdes tu racha.",
                    "url": "/app/rachas",
                    "tag": "wildcard",
                },
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

    if p.food:
        for hour, meals in FOOD_SLOTS.items():
            if hour <= at.hour < hour + 1 and not FoodLog.objects.filter(member=user, date=t, meal__in=meals).exists():
                what = "tu desayuno y tu comida" if hour == 15 else "tu cena"
                out.append((
                    "food",
                    f"{t.isoformat()}:{hour}",
                    {"title": "Registra lo que comiste 🍽️", "body": f"Aún no registras {what} de hoy.", "url": "/app/nutricion", "tag": "food"},
                ))

    if p.measures and MEASURE_HOURS[0] <= at.hour < MEASURE_HOURS[1] and measures_never(user):
        out.append((
            "measures",
            f"never:{t.isoformat()}",
            {
                "title": "Registra tu peso y medidas 📏",
                "body": "Anótalas una vez para ver tu avance y calcular tu meta de agua y tus calorías.",
                "url": "/app/progreso",
                "tag": "measures",
            },
        ))
    elif p.measures and MEASURE_HOURS[0] <= at.hour < MEASURE_HOURS[1]:
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
