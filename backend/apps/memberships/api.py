from datetime import date
from decimal import Decimal
from typing import Literal

from django.contrib.auth import get_user_model
from django.shortcuts import get_object_or_404
from ninja import Router, Schema
from pydantic import Field

from apps.accounts.api import membership_brief
from config.permissions import admin_required, coach_required

from . import services
from .models import GymSettings, Membership, MembershipRequest, Plan

User = get_user_model()
router = Router(tags=["membresía"])
coach_router = Router(tags=["coach"])


class PlanOut(Schema):
    id: int
    name: str
    price_mxn: Decimal
    duration_months: int
    includes_routine: bool
    includes_open_gym: bool
    includes_classes: bool
    default_sessions_per_week: int
    benefits: list[str]
    active: bool


class PlanIn(Schema):
    name: str
    price_mxn: Decimal = Field(gt=0)
    duration_months: int = Field(1, ge=1, le=12)
    includes_routine: bool = False
    includes_open_gym: bool = False
    includes_classes: bool = False
    default_sessions_per_week: int = Field(3, ge=1, le=7)
    benefits: list[str] = []
    active: bool = True


class PaymentOut(Schema):
    id: int
    amount_mxn: Decimal
    method: str
    paid_at: date
    note: str


class MembershipOut(Schema):
    membership: dict | None
    payments: list[PaymentOut]
    open_requests: list[dict]
    whatsapp: str


class RequestIn(Schema):
    type: Literal["renewal", "plan_change"]
    plan_id: int | None = None
    note: str = ""


class PaymentIn(Schema):
    member_id: int
    plan_id: int
    amount_mxn: Decimal = Field(gt=0)
    method: Literal["cash", "transfer", "other"]
    paid_at: date | None = None
    note: str = ""
    sessions_per_week: int | None = Field(None, ge=1, le=7)


class SettingsIO(Schema):
    name: str
    whatsapp: str
    address: str
    maps_url: str
    hours: str
    grace_days: int
    expiring_days: int
    change_deadline_hours: int
    checkin_early_min: int
    booking_open_day: int
    points_config: dict


class PublicGymOut(Schema):
    name: str
    whatsapp: str
    address: str
    maps_url: str
    hours: str
    plans: list[PlanOut]


# ---------- Público / miembro ----------

@router.get("/gym", auth=None, response=PublicGymOut)
def gym_info(request):
    """Para la landing: datos del gym y planes (informativo)."""
    s = GymSettings.load()
    return {
        "name": s.name,
        "whatsapp": s.whatsapp,
        "address": s.address,
        "maps_url": s.maps_url,
        "hours": s.hours,
        "plans": list(Plan.objects.filter(active=True)),
    }


@router.get("/membership", response=MembershipOut)
def my_membership(request):
    u = request.user
    return {
        "membership": membership_brief(u),
        "payments": list(u.payments.all()[:24]),
        "open_requests": list(u.requests.filter(status="open").values("id", "type", "plan__name", "created_at")),
        "whatsapp": GymSettings.load().whatsapp,
    }


@router.post("/membership/requests", response={201: dict})
def make_request(request, data: RequestIn):
    plan = get_object_or_404(Plan, id=data.plan_id, active=True) if data.plan_id else None
    r = services.create_request(request.user, data.type, plan, data.note)
    return 201, {"id": r.id, "status": r.status}


# ---------- Coach / admin ----------

@coach_router.post("/payments", response={201: dict})
@admin_required
def register_payment(request, data: PaymentIn):
    p = services.register_payment(
        member=get_object_or_404(User, id=data.member_id),
        plan=get_object_or_404(Plan, id=data.plan_id),
        amount_mxn=data.amount_mxn,
        method=data.method,
        paid_at=data.paid_at,
        note=data.note,
        sessions_per_week=data.sessions_per_week,
        registered_by=request.user,
    )
    return 201, {"payment_id": p.id, "membership": membership_brief(p.member)}


@coach_router.get("/plans", response=list[PlanOut])
@coach_required
def plans(request):
    return list(Plan.objects.all())


@coach_router.post("/plans", response={201: PlanOut})
@admin_required
def create_plan(request, data: PlanIn):
    return 201, Plan.objects.create(**data.dict())


@coach_router.put("/plans/{plan_id}", response=PlanOut)
@admin_required
def update_plan(request, plan_id: int, data: PlanIn):
    plan = get_object_or_404(Plan, id=plan_id)
    for k, v in data.dict().items():
        setattr(plan, k, v)
    plan.save()
    return plan


@coach_router.post("/memberships/{membership_id}/pause")
@admin_required
def pause(request, membership_id: int):
    services.pause(get_object_or_404(Membership, id=membership_id))
    return {"ok": True}


@coach_router.post("/memberships/{membership_id}/resume")
@admin_required
def resume(request, membership_id: int):
    services.resume(get_object_or_404(Membership, id=membership_id))
    return {"ok": True}


@coach_router.post("/requests/{request_id}/reject")
@coach_required
def reject_request(request, request_id: int):
    MembershipRequest.objects.filter(id=request_id).update(status=MembershipRequest.Status.REJECTED)
    return {"ok": True}


@coach_router.get("/settings", response=SettingsIO)
@admin_required
def get_settings(request):
    return GymSettings.load()


@coach_router.put("/settings", response=SettingsIO)
@admin_required
def put_settings(request, data: SettingsIO):
    s = GymSettings.load()
    for k, v in data.dict().items():
        setattr(s, k, v)
    s.save()
    return s
