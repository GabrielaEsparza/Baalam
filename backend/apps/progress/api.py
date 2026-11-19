import datetime as dt
from datetime import date
from decimal import Decimal

from ninja import Router, Schema
from pydantic import Field

from . import services
from .models import BodyLog

router = Router(tags=["progreso"])


class BodyIn(Schema):
    date: dt.date | None = None
    weight_kg: Decimal | None = Field(None, gt=20, lt=400)
    waist_cm: Decimal | None = Field(None, gt=10, lt=250)
    hip_cm: Decimal | None = Field(None, gt=10, lt=250)
    chest_cm: Decimal | None = Field(None, gt=10, lt=250)
    arm_cm: Decimal | None = Field(None, gt=10, lt=250)
    leg_cm: Decimal | None = Field(None, gt=10, lt=250)
    arm_flexed_cm: Decimal | None = Field(None, gt=10, lt=250)
    wrist_cm: Decimal | None = Field(None, gt=5, lt=250)
    calf_cm: Decimal | None = Field(None, gt=10, lt=250)
    body_fat_pct: Decimal | None = Field(None, ge=2, le=70)
    water_pct: Decimal | None = Field(None, ge=20, le=80)
    muscle_pct: Decimal | None = Field(None, ge=10, le=70)


class BodyOut(Schema):
    date: dt.date
    weight_kg: Decimal | None
    waist_cm: Decimal | None
    hip_cm: Decimal | None
    chest_cm: Decimal | None
    arm_cm: Decimal | None
    leg_cm: Decimal | None
    arm_flexed_cm: Decimal | None
    wrist_cm: Decimal | None
    calf_cm: Decimal | None
    body_fat_pct: Decimal | None
    water_pct: Decimal | None
    muscle_pct: Decimal | None


@router.get("/progress/body", response=dict)
def body(request):
    return {
        "summary": services.summary(request.user),
        "logs": [BodyOut.from_orm(l).dict() for l in BodyLog.objects.filter(member=request.user)],
    }


@router.post("/progress/body", response=BodyOut)
def log_body(request, data: BodyIn):
    d = data.dict()
    on = d.pop("date")
    return services.log_body(request.user, on=on, **d)
