"""Nutrición: calculadora, registro diario, favoritos/frecuentes y objetivos.

Fórmulas (todas sobre valores por 100 de la unidad base del alimento):
  valor_consumido = valor_por_100 × cantidad / 100
  cantidad        = kcal_deseadas / kcal_por_100 × 100     (modo calorías)
"""
from datetime import date, timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.db.models import Count, Max, Sum

from apps.accounts.services import ServiceError, ensure_member
from apps.common import today

from . import sources
from .models import FavoriteFood, Food, FoodLog, NutritionGoal, QuickHide

NUTRIENTS = sources.NUTRIENTS
DECIMALS = {"kcal": 1, "protein_g": 2, "carbs_g": 2, "fat_g": 2, "fiber_g": 2, "sugars_g": 2, "sodium_mg": 0}
MAX_AMOUNT = 5000  # g o ml en un solo registro
MAX_KCAL = 5000
MEALS = [m.value for m in FoodLog.Meal]


# ---------------- Calculadora ----------------

def kcal_mode_available(food) -> tuple[bool, str]:
    k = food.kcal if isinstance(food, Food) else food.get("kcal")
    if k is None:
        return False, "Este alimento no reporta calorías, así que no se puede calcular por calorías. Usa gramos."
    if k <= 0:
        return False, "Este alimento tiene 0 kcal, así que no se puede calcular la cantidad a partir de calorías."
    return True, ""


def compute(food: Food, *, amount: float | None = None, kcal: float | None = None) -> dict:
    """Devuelve cantidad + nutrientes. Un nutriente sin dato queda en None (no en 0)."""
    if (amount is None) == (kcal is None):
        raise ServiceError("Indica la cantidad o las calorías, no ambas.")
    if kcal is not None:
        ok, why = kcal_mode_available(food)
        if not ok:
            raise ServiceError(why, "kcal_mode_unavailable")
        if not 0 < kcal <= MAX_KCAL:
            raise ServiceError("Escribe unas calorías entre 1 y 5000.")
        amount = kcal / food.kcal * 100
    if not 0 < amount <= MAX_AMOUNT:
        raise ServiceError(f"Escribe una cantidad entre 1 y {MAX_AMOUNT} {food.basis_unit}.")
    factor = amount / 100
    out = {"amount": round(amount, 1), "unit": food.basis_unit, "input_mode": "kcal" if kcal is not None else "amount"}
    for n in NUTRIENTS:
        per100 = getattr(food, n)
        out[n] = None if per100 is None else round(per100 * factor, DECIMALS[n])
    if kcal is not None:
        out["kcal"] = round(kcal, 1)  # lo que pidió, exacto
    return out


# ---------------- Alimentos (caché propia) ----------------

FOOD_FIELDS = (
    "barcode", "name", "brand", "image_url", "basis_unit", *NUTRIENTS, "serving_qty", "serving_label",
    "normalized_from", "suspicious", "is_mexican", "raw",
)


EMPTY = {"raw": {}, "suspicious": False, "is_mexican": False, "basis_unit": "g", "normalized_from": "100"}


def save_food(item: dict) -> Food:
    defaults = {}
    for k in FOOD_FIELDS:
        v = item.get(k)
        if v is None and k not in NUTRIENTS and k != "serving_qty":
            v = EMPTY.get(k, "")  # texto vacío, nunca None, en campos de texto
        defaults[k] = v
    food, _ = Food.objects.update_or_create(source=item["source"], external_id=item["external_id"], defaults=defaults)
    return food


def resolve(source: str, external_id: str) -> Food:
    """Al elegir un resultado: ficha fresca de la fuente (el índice de búsqueda puede estar viejo)."""
    if source not in ("usda", "off"):
        raise ServiceError("Fuente inválida.")
    item = None
    try:
        item = sources.off_barcode(external_id) if source == "off" else sources.usda_get(external_id)
    except ServiceError:
        item = None
    item = item or sources.recall(source, external_id)
    if not item:
        existing = Food.objects.filter(source=source, external_id=external_id).first()
        if existing:
            return existing
        raise ServiceError("No encontramos ese alimento. Búscalo de nuevo.", "not_found", 404)
    return save_food(item)


def by_barcode(code: str) -> Food:
    item = sources.off_barcode(code)
    if not item:
        existing = Food.objects.filter(barcode=code).first()
        if existing:
            return existing
        raise ServiceError(
            "Ese producto no está en Open Food Facts o no tiene información nutricional. Búscalo por nombre.",
            "not_found",
            404,
        )
    return save_food(item)


# ---------------- Registro diario ----------------

@transaction.atomic
def oldest_day(ref: date | None = None) -> date:
    """Primer día que todavía se guarda (hoy menos NUTRITION_RETENTION_DAYS)."""
    return (ref or today()) - timedelta(days=settings.NUTRITION_RETENTION_DAYS)


def purge_old_logs(ref: date | None = None) -> int:
    """Borra los registros de comida más viejos que la retención. Los favoritos,
    el objetivo y el catálogo de alimentos no se tocan."""
    deleted, _ = FoodLog.objects.filter(date__lt=oldest_day(ref)).delete()
    return deleted


def _check_day(meal: str, on: date | None) -> date:
    if meal not in MEALS:
        raise ServiceError("Comida inválida.")
    on = on or today()
    if on > today() + timedelta(days=1):
        raise ServiceError("No puedes registrar días futuros.")
    if on < oldest_day():
        raise ServiceError(f"Solo se guardan los últimos {settings.NUTRITION_RETENTION_DAYS} días.", "too_old")
    return on


MANUAL_NAME = "Calorías rápidas"


def _manual_values(name: str | None, kcal, protein_g, carbs_g, fat_g) -> dict:
    """Registro sin alimento: kcal obligatorias; macros opcionales (vacío = sin dato, nunca 0)."""
    if kcal is None or not (0 < kcal <= MAX_KCAL):
        raise ServiceError(f"Escribe unas calorías entre 1 y {MAX_KCAL}.")
    macros = {"protein_g": protein_g, "carbs_g": carbs_g, "fat_g": fat_g}
    for v in macros.values():
        if v is not None and not (0 <= v <= 1000):
            raise ServiceError("Revisa los gramos de proteína, carbohidratos o grasa.")
    return {
        "food_name": (name or "").strip()[:200] or MANUAL_NAME,
        "kcal": round(kcal, DECIMALS["kcal"]),
        **{k: (round(v, DECIMALS[k]) if v is not None else None) for k, v in macros.items()},
    }


def add_manual_log(member, *, meal: str, on: date | None = None, name: str | None = None, kcal=None, protein_g=None, carbs_g=None, fat_g=None) -> FoodLog:
    ensure_member(member)
    on = _check_day(meal, on)
    return FoodLog.objects.create(
        member=member,
        food=None,
        date=on,
        meal=meal,
        input_mode=FoodLog.InputMode.MANUAL,
        amount=0,
        unit="",
        **_manual_values(name, kcal, protein_g, carbs_g, fat_g),
    )


def update_manual_log(member, log_id: int, *, meal: str | None = None, name: str | None = None, kcal=None, protein_g=None, carbs_g=None, fat_g=None) -> FoodLog:
    log = FoodLog.objects.filter(id=log_id, member=member, input_mode=FoodLog.InputMode.MANUAL).first()
    if not log:
        raise ServiceError("Registro no encontrado.", "not_found", 404)
    if meal:
        if meal not in MEALS:
            raise ServiceError("Comida inválida.")
        log.meal = meal
    for k, v in _manual_values(name, kcal, protein_g, carbs_g, fat_g).items():
        setattr(log, k, v)
    log.save()
    return log


def add_log(member, *, food_id: int, meal: str, on: date | None = None, amount=None, kcal=None) -> FoodLog:
    ensure_member(member)
    on = _check_day(meal, on)
    food = Food.objects.filter(id=food_id).first()
    if not food:
        raise ServiceError("Alimento no encontrado.", "not_found", 404)
    c = compute(food, amount=amount, kcal=kcal)
    return FoodLog.objects.create(
        member=member,
        food=food,
        date=on,
        meal=meal,
        food_name=food.name,
        brand=food.brand,
        input_mode=c["input_mode"],
        amount=c["amount"],
        unit=c["unit"],
        **{n: c[n] for n in NUTRIENTS},
    )


@transaction.atomic
def update_log(member, log_id: int, *, amount=None, kcal=None, meal: str | None = None) -> FoodLog:
    log = FoodLog.objects.select_related("food").filter(id=log_id, member=member).first()
    if not log:
        raise ServiceError("Registro no encontrado.", "not_found", 404)
    if meal:
        if meal not in MEALS:
            raise ServiceError("Comida inválida.")
        log.meal = meal
    if amount is not None or kcal is not None:
        if log.input_mode == FoodLog.InputMode.MANUAL:
            raise ServiceError("Este registro es manual; edítalo desde sus calorías.")
        if not log.food:
            raise ServiceError("Este alimento ya no está disponible; bórralo y agrégalo de nuevo.")
        c = compute(log.food, amount=amount, kcal=kcal)
        log.input_mode, log.amount, log.unit = c["input_mode"], c["amount"], c["unit"]
        for n in NUTRIENTS:
            setattr(log, n, c[n])
    log.save()
    return log


def delete_log(member, log_id: int):
    if not FoodLog.objects.filter(id=log_id, member=member).delete()[0]:
        raise ServiceError("Registro no encontrado.", "not_found", 404)


def _sum(logs, n):
    vals = [getattr(l, n) for l in logs if getattr(l, n) is not None]
    return round(sum(vals), DECIMALS[n]) if vals else 0


def day_summary(member, on: date) -> dict:
    logs = list(FoodLog.objects.filter(member=member, date=on).select_related("food"))
    goal = goal_for(member)
    totals = {n: _sum(logs, n) for n in NUTRIENTS}
    # Si algún registro no trae ese nutriente, el total es parcial
    partial = {n: any(getattr(l, n) is None for l in logs) for n in ("fiber_g", "sugars_g", "sodium_mg")}
    remaining = {
        k: (round(goal[k] - totals[k], 1) if goal.get(k) is not None else None) for k in ("kcal", "protein_g", "carbs_g", "fat_g")
    }
    return {
        "date": on,
        "oldest": oldest_day(),
        "retention_days": settings.NUTRITION_RETENTION_DAYS,
        "goal": goal,
        "totals": totals,
        "partial": partial,
        "remaining": remaining,
        "meals": {m: [log_payload(l) for l in logs if l.meal == m] for m in MEALS},
    }


def log_payload(l: FoodLog) -> dict:
    return {
        "id": l.id,
        "food_id": l.food_id,
        "name": l.food_name,
        "brand": l.brand,
        "image_url": l.food.image_url if l.food else "",
        "meal": l.meal,
        "input_mode": l.input_mode,
        "amount": l.amount,
        "unit": l.unit,
        "logged_at": l.logged_at,
        **{n: getattr(l, n) for n in NUTRIENTS},
    }


# ---------------- Favoritos y frecuentes ----------------

def food_payload(f: Food, fav_ids: set | None = None, last: dict | None = None) -> dict:
    ok, why = kcal_mode_available(f)
    return {
        "id": f.id,
        "source": f.source,
        "external_id": f.external_id,
        "barcode": f.barcode,
        "name": f.name,
        "brand": f.brand,
        "image_url": f.image_url,
        "basis_unit": f.basis_unit,
        **{n: getattr(f, n) for n in NUTRIENTS},
        "serving_qty": f.serving_qty,
        "serving_label": f.serving_label,
        "normalized_from": f.normalized_from,
        "suspicious": f.suspicious,
        "is_mexican": f.is_mexican,
        "kcal_mode": ok,
        "kcal_mode_reason": why,
        "favorite": f.id in fav_ids if fav_ids is not None else False,
        "last_amount": (last or {}).get("amount"),
        "last_meal": (last or {}).get("meal"),
    }


def quick_lists(member) -> dict:
    fav_ids = set(FavoriteFood.objects.filter(member=member).values_list("food_id", flat=True))
    hidden = dict(QuickHide.objects.filter(member=member).values_list("food_id", "hidden_at"))
    visible = lambda l: l.food_id not in hidden or l.logged_at > hidden[l.food_id]  # noqa: E731

    last = {}
    for l in FoodLog.objects.filter(member=member, food__isnull=False).order_by("-logged_at")[:300]:
        if visible(l):
            last.setdefault(l.food_id, {"amount": l.amount, "meal": l.meal, "at": l.logged_at})
    recent_ids = list(last)[:10]

    # Frecuentes: 2+ registros en 60 días, contando solo los posteriores a "quitar"
    since = today() - timedelta(days=60)
    counts: dict[int, list] = {}
    for l in FoodLog.objects.filter(member=member, food__isnull=False, date__gte=since).only("food_id", "logged_at"):
        if visible(l):
            c = counts.setdefault(l.food_id, [0, l.logged_at])
            c[0] += 1
            c[1] = max(c[1], l.logged_at)
    frequent_ids = [fid for fid, (n, at) in sorted(counts.items(), key=lambda kv: (-kv[1][0], -kv[1][1].timestamp())) if n >= 2][:8]

    foods = {f.id: f for f in Food.objects.filter(id__in=set(recent_ids) | set(frequent_ids) | fav_ids)}
    pl = lambda ids: [food_payload(foods[i], fav_ids, last.get(i)) for i in ids if i in foods]  # noqa: E731
    return {"favorites": pl(sorted(fav_ids, key=lambda i: foods[i].name if i in foods else "")), "recent": pl(recent_ids), "frequent": pl(frequent_ids)}


def hide_quick(member, food_id: int):
    """Quita el alimento de Recientes y Frecuentes (vuelve si lo registras de nuevo)."""
    if not Food.objects.filter(id=food_id).exists():
        raise ServiceError("Alimento no encontrado.", "not_found", 404)
    QuickHide.objects.update_or_create(member=member, food_id=food_id, defaults={"hidden_at": timezone.now()})


def unhide_quick(member, food_id: int):
    QuickHide.objects.filter(member=member, food_id=food_id).delete()


def set_favorite(member, food_id: int, on: bool):
    if not Food.objects.filter(id=food_id).exists():
        raise ServiceError("Alimento no encontrado.", "not_found", 404)
    if on:
        FavoriteFood.objects.get_or_create(member=member, food_id=food_id)
    else:
        FavoriteFood.objects.filter(member=member, food_id=food_id).delete()


# ---------------- Objetivos ----------------

GOAL_KEYS = ("kcal", "protein_g", "carbs_g", "fat_g")


def goal_for(member) -> dict:
    g = NutritionGoal.objects.filter(member=member).select_related("updated_by__profile").first()
    if not g:
        return {k: None for k in GOAL_KEYS} | {"set_by": None, "updated_at": None}
    by = None
    if g.updated_by_id:
        by = "coach" if g.updated_by_id != member.id else "member"
    return {k: getattr(g, k) for k in GOAL_KEYS} | {"set_by": by, "updated_at": g.updated_at}


def set_goal(member, by, **values) -> dict:
    """Solo guarda lo que se escribe. No calcula ni sugiere objetivos."""
    for k, v in values.items():
        if v is not None and not (0 < v <= (10000 if k == "kcal" else 1000)):
            raise ServiceError("Revisa los valores del objetivo.")
    g, _ = NutritionGoal.objects.get_or_create(member=member)
    for k in GOAL_KEYS:
        if k in values:
            setattr(g, k, values[k])
    g.updated_by = by
    g.save()
    return goal_for(member)


def week_kcal(member, end: date) -> list[dict]:
    start = end - timedelta(days=6)
    rows = dict(
        FoodLog.objects.filter(member=member, date__range=(start, end))
        .values("date")
        .annotate(k=Sum("kcal"))
        .values_list("date", "k")
    )
    return [{"date": start + timedelta(days=i), "kcal": round(rows.get(start + timedelta(days=i)) or 0)} for i in range(7)]
