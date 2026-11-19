from datetime import date, timedelta
from decimal import Decimal

from django.db import transaction

from apps.accounts.models import Profile
from apps.accounts.services import ServiceError, get_profile
from apps.common import add_months, today

from .models import GymSettings, Membership, MembershipRequest, Payment, Plan

ACCESS_STATUSES = {"active", "expiring", "grace"}


def current_membership(member) -> Membership | None:
    return Membership.objects.filter(member=member).select_related("plan").first()


def display_status(m: Membership | None, on: date | None = None) -> str:
    """pending | active | expiring | grace | expired | paused"""
    if m is None:
        return "pending"
    if m.status == Membership.Status.PAUSED:
        return "paused"
    on = on or today()
    s = GymSettings.load()
    if m.end_date >= on:
        return "expiring" if (m.end_date - on).days <= s.expiring_days else "active"
    if on <= m.end_date + timedelta(days=s.grace_days):
        return "grace"
    return "expired"


def blocked_on(m: Membership | None) -> date | None:
    """Primer día sin acceso a la app: vencimiento + días de gracia + 1."""
    if m is None or m.status == Membership.Status.PAUSED:
        return None
    return m.end_date + timedelta(days=GymSettings.load().grace_days + 1)


def has_access(status: str) -> bool:
    return status in ACCESS_STATUSES


def days_left(m: Membership | None, on: date | None = None) -> int | None:
    if m is None:
        return None
    if m.status == Membership.Status.PAUSED:
        return m.paused_days_left
    return (m.end_date - (on or today())).days


@transaction.atomic
def register_payment(
    *,
    member,
    plan: Plan,
    amount_mxn: Decimal,
    method: str,
    registered_by,
    paid_at: date | None = None,
    note: str = "",
    sessions_per_week: int | None = None,
) -> Payment:
    """Registra un pago manual y extiende la vigencia.

    - Mismo plan y aún vigente: +N meses desde el vencimiento anterior.
    - Vencida, sin membresía o cambio de plan: nueva membresía desde hoy.
    """
    if not plan.active:
        raise ServiceError("Ese plan no está activo.")
    if amount_mxn <= 0:
        raise ServiceError("El monto debe ser mayor a 0.")
    paid_at = paid_at or today()
    t = today()
    prev = Membership.objects.select_for_update().filter(member=member).select_related("plan").first()

    if prev and prev.plan_id == plan.id and prev.status != Membership.Status.PAUSED and prev.end_date >= t:
        prev.end_date = add_months(prev.end_date, plan.duration_months)
        prev.status = Membership.Status.ACTIVE
        if sessions_per_week:
            prev.sessions_per_week = sessions_per_week
        prev.save()
        membership = prev
    else:
        if prev and prev.status != Membership.Status.EXPIRED:
            # Cambio de plan o membresía pausada: la anterior se cierra hoy.
            prev.status = Membership.Status.EXPIRED
            prev.end_date = min(prev.end_date, t - timedelta(days=1)) if prev.end_date >= t else prev.end_date
            prev.paused_days_left = None
            prev.save()
        membership = Membership.objects.create(
            member=member,
            plan=plan,
            start_date=t,
            end_date=add_months(t, plan.duration_months),
            sessions_per_week=sessions_per_week
            or (prev.sessions_per_week if prev else plan.default_sessions_per_week),
        )

    payment = Payment.objects.create(
        member=member,
        membership=membership,
        amount_mxn=amount_mxn,
        method=method,
        paid_at=paid_at,
        note=note,
        registered_by=registered_by,
    )

    profile = get_profile(member)
    if profile.status == Profile.Status.PENDING:
        profile.status = Profile.Status.ACTIVE
        profile.save(update_fields=["status", "updated_at"])
    MembershipRequest.objects.filter(member=member, status=MembershipRequest.Status.OPEN).update(
        status=MembershipRequest.Status.DONE
    )
    return payment


def pause(m: Membership) -> Membership:
    if m.status == Membership.Status.PAUSED:
        raise ServiceError("La membresía ya está pausada.")
    left = (m.end_date - today()).days
    if left < 0:
        raise ServiceError("No se puede pausar una membresía vencida.")
    m.status, m.paused_days_left = Membership.Status.PAUSED, left
    m.save()
    return m


def resume(m: Membership) -> Membership:
    if m.status != Membership.Status.PAUSED:
        raise ServiceError("La membresía no está pausada.")
    m.end_date = today() + timedelta(days=m.paused_days_left or 0)
    m.status, m.paused_days_left = Membership.Status.ACTIVE, None
    m.save()
    return m


def create_request(member, type_: str, plan: Plan | None = None, note: str = "") -> MembershipRequest:
    """Solo crea la solicitud; nada cambia hasta que el coach registra el pago."""
    if type_ == MembershipRequest.Type.PLAN_CHANGE:
        raise ServiceError("Para cambiar de plan, acércate a recepción.", "plan_change_disabled", 403)
    existing = MembershipRequest.objects.filter(
        member=member, type=type_, status=MembershipRequest.Status.OPEN
    ).first()
    if existing:
        return existing
    return MembershipRequest.objects.create(member=member, type=type_, plan=plan, note=note)


def expire_memberships(on: date | None = None) -> int:
    """Cron nocturno: marca como vencidas las que ya pasaron la gracia."""
    on = on or today()
    limit = on - timedelta(days=GymSettings.load().grace_days)
    return Membership.objects.filter(status=Membership.Status.ACTIVE, end_date__lt=limit).update(
        status=Membership.Status.EXPIRED
    )
