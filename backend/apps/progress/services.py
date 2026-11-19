from datetime import date
from decimal import Decimal

from apps.accounts.services import get_profile
from apps.common import today
from apps.podium import services as podium
from apps.podium.models import PointsLedger

from .models import BodyLog

MEASURES = ("arm_flexed_cm", "arm_cm", "wrist_cm", "waist_cm", "hip_cm", "leg_cm", "calf_cm", "chest_cm")
COMPOSITION = ("water_pct", "muscle_pct", "body_fat_pct")
FIELDS = ("weight_kg", *MEASURES, *COMPOSITION)


def log_body(member, on: date | None = None, **values) -> BodyLog:
    on = on or today()
    clean = {k: v for k, v in values.items() if k in FIELDS and v is not None}
    if not clean:
        from apps.accounts.services import ServiceError

        raise ServiceError("Escribe al menos un dato.")
    log, _ = BodyLog.objects.update_or_create(member=member, date=on, defaults=clean)
    podium.award(member, PointsLedger.Reason.BODY_LOG, on=on)
    return log


# Clasificación de la OMS para adultos (igual para mujeres y hombres).
BMI_BANDS = (
    (Decimal("18.5"), "under", "Bajo peso"),
    (Decimal("25"), "normal", "Peso saludable"),
    (Decimal("30"), "over", "Sobrepeso"),
    (Decimal("35"), "obese1", "Obesidad grado I"),
    (Decimal("40"), "obese2", "Obesidad grado II"),
    (None, "obese3", "Obesidad grado III"),
)

# Grasa corporal saludable por sexo y edad (Gallagher et al., 2000).
FAT_RANGES = {
    "f": ((39, 21, 32), (59, 23, 33), (200, 24, 35)),
    "m": ((39, 8, 19), (59, 11, 21), (200, 13, 24)),
}


def age_on(birth: date | None, on: date) -> int | None:
    if not birth:
        return None
    return on.year - birth.year - ((on.month, on.day) < (birth.month, birth.day))


def bmi(member, weight_kg: Decimal | None) -> dict:
    """IMC con la última báscula y la estatura del perfil, más el rango de grasa según sexo y edad."""
    p = get_profile(member)
    age = age_on(p.birth_date, today())
    fat = None
    if p.sex in FAT_RANGES and (age is None or age >= 20):
        for max_age, lo, hi in FAT_RANGES[p.sex]:
            if age is None or age <= max_age:
                fat = {"min": lo, "max": hi}
                break
    out = {
        "value": None,
        "category": None,
        "label": None,
        "height_cm": p.height_cm,
        "weight_kg": weight_kg,
        "sex": p.sex or None,
        "age": age,
        "minor": age is not None and age < 18,
        "fat_range": fat,
    }
    if not weight_kg or not p.height_cm:
        return out
    m = Decimal(p.height_cm) / 100
    value = (Decimal(weight_kg) / (m * m)).quantize(Decimal("0.1"))
    for limit, key, label in BMI_BANDS:
        if limit is None or value < limit:
            out.update(value=value, category=key, label=label)
            break
    # Rango de peso con IMC saludable para su estatura
    out["healthy_kg"] = {
        "min": (Decimal("18.5") * m * m).quantize(Decimal("0.1")),
        "max": (Decimal("24.9") * m * m).quantize(Decimal("0.1")),
    }
    return out


def summary(member) -> dict:
    logs = list(BodyLog.objects.filter(member=member, weight_kg__isnull=False).values("date", "weight_kg"))
    target = get_profile(member).target_weight_kg
    if not logs:
        return {
            "current": None, "start": None, "min": None, "change": None, "target": target, "series": [],
            "bmi": bmi(member, None),
        }
    weights = [l["weight_kg"] for l in logs]
    return {
        "bmi": bmi(member, weights[-1]),
        "current": weights[-1],
        "start": weights[0],
        "min": min(weights),
        "change": (weights[-1] - weights[0]).quantize(Decimal("0.1")),
        "target": target,
        "series": logs,
    }
