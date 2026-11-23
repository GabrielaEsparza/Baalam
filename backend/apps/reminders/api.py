from django.conf import settings
from ninja import Router, Schema

from . import services

router = Router(tags=["avisos y agua"])


class SubscriptionIn(Schema):
    endpoint: str
    p256dh: str
    auth: str


class EndpointIn(Schema):
    endpoint: str


class PrefsIn(Schema):
    water: bool | None = None
    water_goal_ml: int | None = None
    water_goal_auto: bool = False  # True = volver a la meta automática
    workout: bool | None = None
    workout_hour: int | None = None
    classes: bool | None = None
    measures: bool | None = None


class WaterIn(Schema):
    delta_ml: int


@router.get("/push/key", response=dict, auth=None)
def push_key(request):
    """Llave pública para suscribirse a los avisos (vacía si los avisos no están configurados)."""
    return {"key": settings.VAPID_PUBLIC_KEY or None}


@router.post("/push/subscriptions", response=dict)
def push_subscribe(request, data: SubscriptionIn):
    n = services.subscribe(request.user, **data.dict(), user_agent=request.headers.get("User-Agent", ""))
    return {"devices": n}


@router.delete("/push/subscriptions", response=dict)
def push_unsubscribe(request, data: EndpointIn):
    services.unsubscribe(request.user, data.endpoint)
    return {"ok": True}


@router.post("/push/test", response=dict)
def push_test(request):
    n = services.send(request.user, title="BÁALAM GYM", body="¡Listo! Así se verán tus avisos. 💪", tag="test")
    return {"sent": n}


@router.get("/me/reminders", response=dict)
def get_prefs(request):
    return services.prefs_payload(request.user)


@router.put("/me/reminders", response=dict)
def put_prefs(request, data: PrefsIn):
    values = data.dict(exclude_unset=True)
    if values.pop("water_goal_auto", False):
        values["water_goal_ml"] = None
    elif "water_goal_ml" in values and values["water_goal_ml"] is None:
        values.pop("water_goal_ml")
    return services.update_prefs(request.user, **values)


@router.get("/water/today", response=dict)
def water(request):
    return services.water_today(request.user)


@router.post("/water", response=dict)
def add_water(request, data: WaterIn):
    return services.add_water(request.user, data.delta_ml)
