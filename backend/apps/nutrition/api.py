import datetime as dt
from typing import Literal

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.shortcuts import get_object_or_404
from ninja import Router, Schema
from ninja.errors import HttpError
from pydantic import Field

from apps.accounts.services import ensure_member
from apps.common import today
from config.permissions import coach_required

from . import services, sources
from .models import FavoriteFood, Food

User = get_user_model()
router = Router(tags=["nutrición"])
coach_router = Router(tags=["coach · nutrición"])

Meal = Literal["breakfast", "lunch", "dinner", "snack"]
SEARCH_PER_MIN = 20


class ResolveIn(Schema):
    source: Literal["usda", "off"]
    external_id: str = Field(min_length=1, max_length=40)


class CalcIn(Schema):
    amount: float | None = Field(None, gt=0, le=services.MAX_AMOUNT)
    kcal: float | None = Field(None, gt=0, le=services.MAX_KCAL)


class LogIn(CalcIn):
    food_id: int
    meal: Meal
    date: dt.date | None = None


class ManualIn(Schema):
    """Calorías sin alimento (por si no está en la lista)."""
    meal: Meal
    date: dt.date | None = None
    name: str | None = Field(None, max_length=200)
    kcal: float = Field(..., gt=0, le=services.MAX_KCAL)
    protein_g: float | None = Field(None, ge=0, le=1000)
    carbs_g: float | None = Field(None, ge=0, le=1000)
    fat_g: float | None = Field(None, ge=0, le=1000)


class ManualPatch(ManualIn):
    meal: Meal | None = None


class LogPatch(CalcIn):
    meal: Meal | None = None


class GoalIn(Schema):
    kcal: int | None = Field(None, gt=0, le=10000)
    protein_g: int | None = Field(None, gt=0, le=1000)
    carbs_g: int | None = Field(None, gt=0, le=1000)
    fat_g: int | None = Field(None, gt=0, le=1000)


def _member(request):
    ensure_member(request.user)
    return request.user


def _throttle(user_id: int):
    """Evita consultas innecesarias a las APIs externas (además del debounce y la caché)."""
    key = f"nutri:rl:{user_id}"
    n = cache.get(key, 0)
    if n >= SEARCH_PER_MIN:
        raise HttpError(429, "Demasiadas búsquedas seguidas. Espera un momento.")
    cache.set(key, n + 1, 60)


# ---------------- Búsqueda ----------------

@router.get("/nutrition/search", response=dict)
def search(request, q: str, source: Literal["all", "usda", "off"] = "all", page: int = 1):
    user = _member(request)
    _throttle(user.id)
    res = sources.search(q, source, max(1, min(page, 20)))
    known = dict(
        Food.objects.filter(source__in=["usda", "off"], external_id__in=[i["external_id"] for i in res["items"]]).values_list(
            "external_id", "id"
        )
    )
    fav = set(FavoriteFood.objects.filter(member=user).values_list("food_id", flat=True))
    items = []
    for i in res["items"]:
        ok, why = services.kcal_mode_available(i)
        fid = known.get(i["external_id"])
        items.append(
            {k: v for k, v in i.items() if k != "raw"}
            | {"food_id": fid, "favorite": fid in fav, "kcal_mode": ok, "kcal_mode_reason": why}
        )
    return {**res, "items": items}


@router.post("/nutrition/foods/resolve", response=dict)
def resolve(request, data: ResolveIn):
    user = _member(request)
    f = services.resolve(data.source, data.external_id)
    fav = set(FavoriteFood.objects.filter(member=user, food=f).values_list("food_id", flat=True))
    return services.food_payload(f, fav)


@router.get("/nutrition/barcode/{code}", response=dict)
def barcode(request, code: str):
    user = _member(request)
    _throttle(user.id)
    f = services.by_barcode(code)
    fav = set(FavoriteFood.objects.filter(member=user, food=f).values_list("food_id", flat=True))
    return services.food_payload(f, fav)


@router.get("/nutrition/foods/{food_id}", response=dict)
def food(request, food_id: int):
    user = _member(request)
    f = get_object_or_404(Food, id=food_id)
    fav = set(FavoriteFood.objects.filter(member=user, food=f).values_list("food_id", flat=True))
    return services.food_payload(f, fav)


@router.post("/nutrition/foods/{food_id}/calc", response=dict)
def calc(request, food_id: int, data: CalcIn):
    """Calculadora (el frontend calcula al instante; esto es la fuente de verdad)."""
    _member(request)
    return services.compute(get_object_or_404(Food, id=food_id), amount=data.amount, kcal=data.kcal)


# ---------------- Registro ----------------

@router.get("/nutrition/day", response=dict)
def day(request, date: dt.date | None = None):
    user = _member(request)
    d = date or today()
    return {**services.day_summary(user, d), "week": services.week_kcal(user, d)}


@router.post("/nutrition/logs", response={201: dict})  # con alimento
def add(request, data: LogIn):
    user = _member(request)
    log = services.add_log(user, food_id=data.food_id, meal=data.meal, on=data.date, amount=data.amount, kcal=data.kcal)
    return 201, services.log_payload(log)


@router.post("/nutrition/logs/manual", response={201: dict})
def add_manual(request, data: ManualIn):
    user = _member(request)
    d = data.dict()
    log = services.add_manual_log(user, on=d.pop("date"), **d)
    return 201, services.log_payload(log)


@router.patch("/nutrition/logs/{log_id}/manual", response=dict)
def edit_manual(request, log_id: int, data: ManualPatch):
    user = _member(request)
    return services.log_payload(services.update_manual_log(user, log_id, **data.dict(exclude={"date"})))


@router.patch("/nutrition/logs/{log_id}", response=dict)
def edit(request, log_id: int, data: LogPatch):
    user = _member(request)
    return services.log_payload(services.update_log(user, log_id, amount=data.amount, kcal=data.kcal, meal=data.meal))


@router.delete("/nutrition/logs/{log_id}")
def remove(request, log_id: int):
    services.delete_log(_member(request), log_id)
    return {"ok": True}


# ---------------- Rápidos ----------------

@router.get("/nutrition/quick", response=dict)
def quick(request):
    return services.quick_lists(_member(request))


@router.delete("/nutrition/quick/{food_id}")
def hide_quick(request, food_id: int):
    """Quitar de Recientes/Frecuentes."""
    services.hide_quick(_member(request), food_id)
    return {"ok": True}


@router.put("/nutrition/quick/{food_id}")
def unhide_quick(request, food_id: int):
    """Deshacer "quitar"."""
    services.unhide_quick(_member(request), food_id)
    return {"ok": True}


@router.put("/nutrition/favorites/{food_id}")
def fav_on(request, food_id: int):
    services.set_favorite(_member(request), food_id, True)
    return {"ok": True}


@router.delete("/nutrition/favorites/{food_id}")
def fav_off(request, food_id: int):
    services.set_favorite(_member(request), food_id, False)
    return {"ok": True}


# ---------------- Objetivos ----------------

@router.get("/nutrition/goals", response=dict)
def goals(request):
    return services.goal_for(_member(request))


@router.put("/nutrition/goals", response=dict)
def set_goals(request, data: GoalIn):
    user = _member(request)
    return services.set_goal(user, user, **data.dict())


@coach_router.get("/members/{member_id}/nutrition", response=dict)
@coach_required
def coach_member_nutrition(request, member_id: int, date: dt.date | None = None):
    member = get_object_or_404(User, id=member_id)
    d = date or today()
    return {**services.day_summary(member, d), "week": services.week_kcal(member, d)}


@coach_router.put("/members/{member_id}/nutrition-goals", response=dict)
@coach_required
def coach_set_goals(request, member_id: int, data: GoalIn):
    member = get_object_or_404(User, id=member_id)
    ensure_member(member)
    return services.set_goal(member, request.user, **data.dict())
