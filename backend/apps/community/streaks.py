"""Rachas individuales y con gym sis / gym bro.

- Racha de kcal: días seguidos registrando comidas sin pasarse más de 10 % de su meta de kcal
  (si aún no tiene meta, basta con registrar).
- Racha de entrenamientos: días de entrenamiento seguidos registrados. Un día de entrenamiento es
  uno con reserva (o en el que de todos modos entrenó). Los días de descanso no rompen la racha.
  Plan con rutina: cuenta si registró su rutina. Plan Clases: cuenta si registró asistencia.
- Racha con su gym sis / gym bro: días seguidos en que los dos "cumplieron": registraron sus kcal
  dentro de su meta y, si les tocaba entrenar, entrenaron. Cuenta desde que aceptaron.

Hoy suma en cuanto se cumple; si todavía no, la racha no se rompe hasta que termine el día.

Comodín: si a las 10 p. m. no ha registrado su entrenamiento de hoy (o no lo hizo ayer), puede pedir
un comodín (1 por semana) diciendo por qué. La coach lo aprueba: ese día cuenta como entrenado.
Mientras está por aprobar, ese día no rompe la racha.
"""
from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q, Sum

from apps.accounts.models import Profile
from apps.accounts.services import ServiceError, ensure_member, get_profile
from apps.common import now, today, week_bounds

from .models import Buddy, Wildcard

KCAL_TOLERANCE = 1.10
LOOKBACK_DAYS = 400
MAX_PENDING_INVITES = 30
WILDCARD_HOUR = 22  # desde las 10 p. m. se ofrece el comodín del día


# ---------------- Cálculo ----------------

def _days_back(start: date, end: date) -> list[date]:
    n = (end - start).days
    return [end - timedelta(days=i) for i in range(n + 1)]


def _count(relevant_desc: list[date], ok: set[date], t: date, skip: set[date] = frozenset()) -> int:
    """Seguidos hacia atrás. Hoy (si aún no se cumple) y los comodines por aprobar no rompen."""
    n = 0
    for d in relevant_desc:
        if d in ok:
            n += 1
        elif d == t or d in skip:
            continue
        else:
            break
    return n


def _kcal_ok_days(member, start: date, end: date) -> set[date]:
    from apps.nutrition.models import FoodLog, NutritionGoal

    goal = NutritionGoal.objects.filter(member=member).values_list("kcal", flat=True).first()
    limit = goal * KCAL_TOLERANCE if goal else None
    rows = FoodLog.objects.filter(member=member, date__range=(start, end)).values("date").annotate(k=Sum("kcal"))
    return {r["date"] for r in rows if limit is None or (r["k"] or 0) <= limit}


def _wildcards(member, start: date, end: date) -> tuple[set[date], set[date]]:
    """(días con comodín aprobado, días con comodín por aprobar)."""
    rows = Wildcard.objects.filter(member=member, date__range=(start, end)).values_list("date", "status")
    return (
        {d for d, s in rows if s == Wildcard.Status.APPROVED},
        {d for d, s in rows if s == Wildcard.Status.PENDING},
    )


def _training(member, start: date, end: date) -> tuple[set[date], set[date], set[date]]:
    """(días de entrenamiento, días cumplidos —con comodín aprobado—, días con comodín por aprobar)."""
    training, done = _training_days(member, start, end)
    approved, pending = _wildcards(member, start, end)
    return training, done | approved, pending


def _training_days(member, start: date, end: date) -> tuple[set[date], set[date]]:
    """(días en que le tocaba entrenar, días en que registró su entrenamiento).
    Con rutina cuenta registrar la rutina aunque no haya escaneado el QR (p. ej. si entrenó fuera del gym)."""
    from apps.checkin.models import CheckIn
    from apps.memberships.services import current_membership
    from apps.schedule.models import Booking
    from apps.training.models import WorkoutSession

    booked = set(
        Booking.objects.filter(
            member=member,
            session__date__range=(start, end),
            session__cancelled=False,
            status__in=[Booking.Status.BOOKED, Booking.Status.ATTENDED, Booking.Status.MISSED],
        ).values_list("session__date", flat=True)
    )
    m = current_membership(member)
    if m and m.plan.includes_routine:
        done = set(WorkoutSession.objects.filter(member=member, date__range=(start, end)).values_list("date", flat=True))
    else:
        done = set(CheckIn.objects.filter(member=member, date__range=(start, end)).values_list("date", flat=True))
    return booked | done, done


def _day_ok(member, start: date, end: date) -> tuple[set[date], set[date]]:
    """(días en que cumplió: kcal dentro de su meta y, si le tocaba, entrenó; días con comodín por aprobar)."""
    kcal = _kcal_ok_days(member, start, end)
    training, done, pending = _training(member, start, end)
    return {d for d in kcal if d not in training or d in done}, pending


def _week_used(member, d: date) -> bool:
    start, end = week_bounds(d)
    return Wildcard.objects.filter(
        member=member, date__range=(start, end), status__in=[Wildcard.Status.PENDING, Wildcard.Status.APPROVED]
    ).exists()


def _wildcard_day(member, training: set[date], done: set[date]) -> date | None:
    """Día que puede cubrir con comodín: hoy desde las 10 p. m., o ayer."""
    from django.utils import timezone

    t = today()
    candidates = ([t] if timezone.localtime(now()).hour >= WILDCARD_HOUR else []) + [t - timedelta(days=1)]
    taken = set(Wildcard.objects.filter(member=member, date__in=candidates).values_list("date", flat=True))
    for d in candidates:
        if d in training and d not in done and d not in taken and not _week_used(member, d):
            return d
    return None


def _wildcard_payload(member, training, done) -> dict:
    recent = Wildcard.objects.filter(member=member, date__gte=today() - timedelta(days=7)).first()
    return {
        "available_for": _wildcard_day(member, training, done),
        "recent": {"date": recent.date, "status": recent.status, "reason": recent.reason} if recent else None,
    }


def individual(member) -> dict:
    t = today()
    start = t - timedelta(days=LOOKBACK_DAYS)
    kcal = _kcal_ok_days(member, start, t)
    training, done, pending = _training(member, start, t)
    return {
        "kcal": {"days": _count(_days_back(start, t), kcal, t), "today_done": t in kcal},
        "training": {
            "days": _count(sorted(training, reverse=True), done, t, pending),
            "today_done": t in done,
            "today_is_training": t in training,
        },
        "wildcard": _wildcard_payload(member, training, done),
    }


def pair_streak(a, b, since: date | None) -> dict:
    t = today()
    start = max(since or t, t - timedelta(days=LOOKBACK_DAYS))
    (ok_a, pend_a), (ok_b, pend_b) = _day_ok(a, start, t), _day_ok(b, start, t)
    days = _count(_days_back(start, t), ok_a & ok_b, t, pend_a | pend_b)
    return {"days": days, "me_today": t in ok_a, "them_today": t in ok_b}


# ---------------- Gym sis / gym bro ----------------

def label(user) -> str:
    """Cómo se le dice a esa persona: gym sis, gym bro o gym buddy (según su saludo)."""
    g = get_profile(user).greeting
    return {"a": "gym sis", "o": "gym bro"}.get(g, "gym buddy")


def _first(user) -> str:
    return (get_profile(user).full_name or "").split(" ")[0] or "Tu compa"


def _person(user) -> dict:
    p = get_profile(user)
    return {"id": user.id, "full_name": p.full_name, "avatar_url": p.avatar.url if p.avatar else None, "label": label(user)}


def _pairs(user):
    return Buddy.objects.filter(Q(from_user=user) | Q(to_user=user)).select_related(
        "from_user__profile", "to_user__profile"
    )


def overview(member) -> dict:
    ensure_member(member)
    buddies, invites_in, invites_out = [], [], []
    for b in _pairs(member).order_by("created_at"):
        other = b.other(member)
        if b.status == Buddy.Status.ACCEPTED:
            buddies.append({"id": b.id, "person": _person(other), "streak": pair_streak(member, other, b.since)})
        elif b.to_user_id == member.id:
            invites_in.append({"id": b.id, "person": _person(other)})
        else:
            invites_out.append({"id": b.id, "person": _person(other)})
    buddies.sort(key=lambda r: -r["streak"]["days"])
    return {
        **individual(member),
        "my_label": label(member),
        "buddies": buddies,
        "invites_in": invites_in,
        "invites_out": invites_out,
    }


def search(member, q: str) -> list[dict]:
    """Miembros activos para invitar (por nombre)."""
    ensure_member(member)
    q = (q or "").strip()
    if len(q) < 2:
        return []
    linked = {b.other(member).id: b.status for b in _pairs(member)}
    qs = (
        Profile.objects.filter(
            role=Profile.Role.MEMBER, status=Profile.Status.ACTIVE, user__is_active=True, full_name__icontains=q
        )
        .exclude(user=member)
        .select_related("user")
        .order_by("full_name")[:12]
    )
    return [{**_person(p.user), "status": linked.get(p.user_id)} for p in qs]


def _notify(user, **msg):
    from apps.reminders.services import send

    transaction.on_commit(lambda: _safe(send, user, **msg))


def _notify_once(user, kind: str, ref: str, **msg) -> bool:
    from apps.reminders.models import SentReminder
    from apps.reminders.services import send

    _, created = SentReminder.objects.get_or_create(user=user, kind=kind, ref=ref)
    if created:
        transaction.on_commit(lambda: _safe(send, user, **msg))
    return created


def _safe(fn, *a, **kw):
    import logging

    try:
        fn(*a, **kw)
    except Exception:  # noqa: BLE001  (un aviso fallido no debe romper nada)
        logging.getLogger(__name__).exception("aviso de gym buddy falló")


@transaction.atomic
def invite(member, user_id: int) -> dict:
    from django.contrib.auth import get_user_model

    ensure_member(member)
    other = get_user_model().objects.filter(id=user_id, is_active=True).first()
    if not other or other == member or get_profile(other).role != Profile.Role.MEMBER:
        raise ServiceError("No encontramos a esa persona.", "not_found", 404)
    existing = _pairs(member).filter(Q(from_user=other) | Q(to_user=other)).first()
    if existing:
        if existing.status == Buddy.Status.ACCEPTED:
            raise ServiceError(f"Ya es tu {label(other)}.", "already")
        if existing.to_user_id == member.id:  # ya te había invitado: se acepta
            return accept(member, existing.id)
        raise ServiceError("Ya le enviaste la invitación.", "already")
    if Buddy.objects.filter(from_user=member, status=Buddy.Status.PENDING).count() >= MAX_PENDING_INVITES:
        raise ServiceError("Tienes muchas invitaciones pendientes. Espera a que respondan.")
    b = Buddy.objects.create(from_user=member, to_user=other)
    _notify(
        other,
        title="¡Te invitaron! 🤝",
        body=f"{_first(member)} te invita a ser su {label(other)}.",
        url="/app/rachas",
        tag="buddy",
    )
    return {"id": b.id, "status": b.status}


@transaction.atomic
def accept(member, buddy_id: int) -> dict:
    b = Buddy.objects.filter(id=buddy_id, to_user=member, status=Buddy.Status.PENDING).first()
    if not b:
        raise ServiceError("Esa invitación ya no existe.", "not_found", 404)
    b.status, b.since = Buddy.Status.ACCEPTED, today()
    b.save(update_fields=["status", "since", "updated_at"])
    _notify(
        b.from_user,
        title="¡Aceptó! 🔥",
        body=f"{_first(member)} ahora es tu {label(member)}. Empiecen su racha hoy.",
        url="/app/rachas",
        tag="buddy",
    )
    return {"id": b.id, "status": b.status}


def remove(member, buddy_id: int) -> None:
    """Rechazar, cancelar la invitación o dejar de ser gym sis / bro."""
    deleted, _ = _pairs(member).filter(id=buddy_id).delete()
    if not deleted:
        raise ServiceError("No encontramos esa relación.", "not_found", 404)


def nudge_kcal(member, buddy_id: int) -> None:
    """'No olvides registrar tus kcal': una vez al día por pareja."""
    b = _pairs(member).filter(id=buddy_id, status=Buddy.Status.ACCEPTED).first()
    if not b:
        raise ServiceError("No encontramos a tu compa.", "not_found", 404)
    other = b.other(member)
    if not _notify_once(
        other,
        "bud_kcal",
        f"{member.id}:{today().isoformat()}",
        title=f"Tu {label(member)} {_first(member)} te recuerda 🍽️",
        body="No olvides registrar tus kcal de hoy.",
        url="/app/nutricion",
        tag="buddy-kcal",
    ):
        raise ServiceError("Ya se lo recordaste hoy.", "already")


def notify_trained(member) -> None:
    """'Tu gym sis Gabriela ya entrenó hoy': a cada compa, una vez al día."""
    if get_profile(member).role != Profile.Role.MEMBER:
        return
    ref = f"{member.id}:{today().isoformat()}"
    for b in _pairs(member).filter(status=Buddy.Status.ACCEPTED):
        _notify_once(
            b.other(member),
            "bud_train",
            ref,
            title=f"Tu {label(member)} {_first(member)} ya entrenó hoy 💪",
            body="Te toca a ti. ¡No rompan la racha!",
            url="/app/rachas",
            tag="buddy-train",
        )


# ---------------- Comodín ----------------

def wildcard_offer_day(member) -> date | None:
    """El día que hoy podría cubrir con comodín (o None). También lo usa el aviso de las 10 p. m."""
    t = today()
    training, done, _ = _training(member, t - timedelta(days=1), t)
    return _wildcard_day(member, training, done)


@transaction.atomic
def request_wildcard(member, reason: str) -> dict:
    ensure_member(member)
    reason = (reason or "").strip()[:160]
    if len(reason) < 3:
        raise ServiceError("Cuéntale a tu coach por qué no pudiste entrenar.")
    day = wildcard_offer_day(member)
    if not day:
        raise ServiceError("Hoy no tienes comodín disponible (es 1 por semana).", "no_wildcard")
    w = Wildcard.objects.create(member=member, date=day, reason=reason)
    name = get_profile(member).full_name
    coaches = get_user_model().objects.filter(profile__role__in=[Profile.Role.COACH, Profile.Role.ADMIN], is_active=True)
    for c in coaches:
        _notify(
            c,
            title=f"🃏 {name} pidió un comodín",
            body=f"Motivo: {reason}. ¿Lo apruebas?",
            url="/coach",
            tag=f"wildcard-{w.id}",
        )
    return wildcard_row(w)


def wildcard_row(w: Wildcard) -> dict:
    p = get_profile(w.member)
    return {
        "id": w.id,
        "member": {"id": w.member_id, "full_name": p.full_name, "avatar_url": p.avatar.url if p.avatar else None},
        "date": w.date,
        "reason": w.reason,
        "status": w.status,
        "created_at": w.created_at,
    }


def pending_wildcards() -> list[dict]:
    qs = Wildcard.objects.filter(status=Wildcard.Status.PENDING, member__is_active=True).select_related("member__profile")
    return [wildcard_row(w) for w in qs.order_by("created_at")]


@transaction.atomic
def decide_wildcard(coach, wildcard_id: int, approve: bool) -> dict:
    w = Wildcard.objects.select_for_update().filter(id=wildcard_id).first()
    if not w:
        raise ServiceError("Ese comodín ya no existe.", "not_found", 404)
    if w.status != Wildcard.Status.PENDING:
        raise ServiceError("Ese comodín ya se había respondido.", "already")
    w.status = Wildcard.Status.APPROVED if approve else Wildcard.Status.REJECTED
    w.decided_by, w.decided_at = coach, now()
    w.save()
    _notify(
        w.member,
        title="Comodín aprobado ✅" if approve else "Comodín no aprobado",
        body="Tu racha sigue viva. ¡Recupérate!" if approve else "Tu coach no aprobó el comodín. Si tienes dudas, háblale.",
        url="/app/rachas",
        tag="wildcard",
    )
    return wildcard_row(w)
