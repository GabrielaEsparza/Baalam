from datetime import timedelta

from django.contrib.auth import authenticate, get_user_model, login, logout
from django.db.models import Max
from django.http import HttpRequest
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404
from ninja import File, Router, Schema
from ninja.files import UploadedFile
from ninja.errors import HttpError
from ninja.utils import check_csrf

from apps.common import now, today, week_bounds
from config.permissions import coach_required, member_required

from . import services
from .models import Profile
from .schemas import (
    DashboardOut,
    HomeOut,
    LoginIn,
    MeOut,
    MemberDetail,
    MemberPatch,
    MemberRow,
    MePatch,
    RegisterIn,
)

User = get_user_model()
auth_router = Router(tags=["auth"])
me_router = Router(tags=["miembro"])
coach_router = Router(tags=["coach"])

GREETINGS = {"a": "Bienvenida", "o": "Bienvenido", "x": "Bienvenidx"}


def _csrf(request: HttpRequest):
    if check_csrf(request):
        raise HttpError(403, "CSRF inválido. Recarga la página.")


def membership_brief(user):
    from apps.memberships.services import blocked_on, current_membership, days_left, display_status

    m = current_membership(user)
    if not m:
        return None
    return {
        "plan_name": m.plan.name,
        "status": display_status(m),
        "start_date": m.start_date,
        "end_date": m.end_date,
        "days_left": days_left(m),
        "blocked_on": blocked_on(m),
        "sessions_per_week": m.sessions_per_week,
    }


def me_payload(user):
    p = services.get_profile(user)
    return {
        "id": user.id,
        "email": user.email,
        "full_name": p.full_name,
        "phone": p.phone,
        "avatar_url": p.avatar.url if p.avatar else None,
        "role": p.role,
        "has_password": user.has_usable_password(),
        "status": p.status,
        "goal": p.goal,
        "birth_date": p.birth_date,
        "sex": p.sex,
        "height_cm": p.height_cm,
        "target_weight_kg": p.target_weight_kg,
        "greeting": p.greeting,
        "theme": p.theme,
        "show_in_podium": p.show_in_podium,
        "share_achievements": p.share_achievements,
        "features": services.features_for(user),
        "membership": membership_brief(user),
    }


# ---------------- Auth ----------------

@auth_router.get("/csrf", auth=None)
def csrf(request):
    """Pone la cookie CSRF."""
    return {"csrftoken": get_token(request)}


@auth_router.post("/register", auth=None, response={201: MeOut})
def register(request, data: RegisterIn):
    _csrf(request)
    user = services.register(**data.dict())
    login(request, user)
    return 201, me_payload(user)


@auth_router.post("/login", auth=None, response=MeOut)
def do_login(request, data: LoginIn):
    _csrf(request)
    user = authenticate(request, username=data.email.lower(), password=data.password)
    if not user:
        raise HttpError(401, "Correo o contraseña incorrectos.")
    if services.get_profile(user).status == Profile.Status.BLOCKED:
        raise HttpError(403, "Tu cuenta está bloqueada. Habla con tu coach.")
    login(request, user)
    return me_payload(user)


class GoogleIn(Schema):
    credential: str


@auth_router.post("/google", auth=None, response=MeOut)
def google_login(request, data: GoogleIn):
    """"Continuar con Google": entra con la cuenta de ese correo o la crea."""
    _csrf(request)
    info = services.verify_google_credential(data.credential)
    user, _ = services.google_sign_in(info)
    login(request, user, backend="django.contrib.auth.backends.ModelBackend")
    return me_payload(user)


@auth_router.post("/logout")
def do_logout(request):
    logout(request)
    return {"ok": True}


class DeleteAccountIn(Schema):
    password: str = ""


@me_router.post("/me/delete", response=dict)
def delete_account(request, data: DeleteAccountIn):
    """Elimina la cuenta de quien la pide (datos personales borrados; pagos y asistencias anonimizados)."""
    services.delete_account(request.user, data.password)
    logout(request)
    return {"ok": True}


class ResetIn(Schema):
    email: str


class ResetConfirmIn(Schema):
    uid: str
    token: str
    password: str


@auth_router.post("/password-reset", auth=None)
def password_reset(request, data: ResetIn):
    """Siempre responde ok (no revela si el correo existe)."""
    _csrf(request)
    from django.contrib.auth.tokens import default_token_generator
    from django.core.mail import send_mail
    from django.utils.encoding import force_bytes
    from django.utils.http import urlsafe_base64_encode

    user = User.objects.filter(username=data.email.strip().lower(), is_active=True).first()
    if user:
        uid = urlsafe_base64_encode(force_bytes(user.pk))
        token = default_token_generator.make_token(user)
        link = request.build_absolute_uri(f"/recuperar?uid={uid}&token={token}")
        send_mail(
            "Recupera tu acceso a BÁALAM GYM",
            f"Hola,\n\nPara crear una nueva contraseña abre este enlace:\n{link}\n\n"
            "Si no lo pediste, ignora este correo.",
            None,
            [user.email],
        )
    return {"ok": True}


@auth_router.post("/password-reset/confirm", auth=None)
def password_reset_confirm(request, data: ResetConfirmIn):
    _csrf(request)
    from django.contrib.auth.password_validation import validate_password
    from django.contrib.auth.tokens import default_token_generator
    from django.core.exceptions import ValidationError
    from django.utils.http import urlsafe_base64_decode

    try:
        user = User.objects.get(pk=urlsafe_base64_decode(data.uid).decode())
    except (User.DoesNotExist, ValueError, TypeError):
        user = None
    if not user or not default_token_generator.check_token(user, data.token):
        raise HttpError(400, "El enlace ya no es válido. Pide uno nuevo.")
    try:
        validate_password(data.password, user)
    except ValidationError as e:
        raise HttpError(400, " ".join(e.messages))
    user.set_password(data.password)
    user.save()
    return {"ok": True}


# ---------------- Miembro ----------------

@me_router.get("/me", response=MeOut)
def me(request):
    return me_payload(request.user)


@me_router.patch("/me", response=MeOut)
def patch_me(request, data: MePatch):
    p = services.get_profile(request.user)
    for k, v in data.dict(exclude_unset=True).items():
        setattr(p, k, v)
    p.save()
    return me_payload(request.user)


@me_router.post("/me/avatar", response=MeOut)
def upload_avatar(request, file: UploadedFile = File(...)):
    services.save_avatar(request.user, file)
    return me_payload(request.user)


@me_router.delete("/me/avatar", response=MeOut)
def delete_avatar(request):
    p = services.get_profile(request.user)
    if p.avatar:
        p.avatar.delete(save=True)
    return me_payload(request.user)


@me_router.get("/home", response=HomeOut)
@member_required
def home(request):
    from apps.checkin.models import CheckIn
    from apps.community.services import feed
    from apps.memberships.models import GymSettings
    from apps.schedule.models import Booking
    from apps.schedule.services import missing_days_this_week
    from apps.reminders.services import measures_due, measures_never, water_today
    from apps.training.services import today_workout_brief

    user, t = request.user, today()
    p = services.get_profile(user)
    start, end = week_bounds(t)
    days = set(CheckIn.objects.filter(member=user, date__range=(start, end)).values_list("date", flat=True))
    b = (
        Booking.objects.select_related("session__schedule")
        .filter(member=user, session__date=t, session__end_at__gte=now(), status__in=Booking.ACTIVE_STATUSES)
        .first()
    )
    feats = services.features_for(user)
    return {
        "greeting": GREETINGS[p.greeting],
        "first_name": (p.full_name or "").split(" ")[0],
        "membership": membership_brief(user),
        "checked_in_today": t in days,
        "today_booking": (
            {
                "booking_id": b.id,
                "name": b.session.schedule.name,
                "type": b.session.schedule.type,
                "start_at": b.session.start_at,
                "end_at": b.session.end_at,
            }
            if b
            else None
        ),
        "missing_days_week": missing_days_this_week(user) if feats["access"] else 0,
        "week_checkins": [start + timedelta(days=i) in days for i in range(7)],
        "today_workout": today_workout_brief(user) if feats["routine"] else None,
        "announcements": feed(),
        "birthdays": services.birthdays_today(user),
        "whatsapp": GymSettings.load().whatsapp,
        "water": water_today(user) if feats["access"] else None,
        "measures_due_days": measures_due(user) if feats["access"] else None,
        "measures_never": measures_never(user) if feats["access"] else False,
    }


# ---------------- Coach: miembros y panel ----------------

def _member_row(p: Profile, last_checkin=None):
    from apps.memberships.services import current_membership, display_status

    m = current_membership(p.user)
    return {
        "id": p.user_id,
        "full_name": p.full_name,
        "email": p.user.email,
        "phone": p.phone,
        "avatar_url": p.avatar.url if p.avatar else None,
        "role": p.role,
        "status": p.status,
        "membership_status": "pending" if p.status == "pending" and not m else display_status(m),
        "plan_name": m.plan.name if m else None,
        "end_date": m.end_date if m else None,
        "last_checkin": last_checkin,
    }


def _members_qs():
    return (
        Profile.objects.filter(role=Profile.Role.MEMBER)
        .select_related("user")
        .annotate(last=Max("user__checkins__date"))
        .order_by("full_name")
    )


@coach_router.get("/members", response=list[MemberRow])
@coach_required
def members(request, q: str = "", status: str = ""):
    qs = _members_qs()
    if q:
        from django.db.models import Q

        qs = qs.filter(Q(full_name__icontains=q) | Q(user__email__icontains=q) | Q(phone__icontains=q))
    rows = [_member_row(p, p.last) for p in qs]
    if status:
        rows = [r for r in rows if r["membership_status"] == status or r["status"] == status]
    return rows


@coach_router.get("/members/{member_id}", response=MemberDetail)
@coach_required
def member_detail(request, member_id: int):
    from apps.memberships.services import current_membership

    p = get_object_or_404(
        Profile.objects.select_related("user").annotate(last=Max("user__checkins__date")), user_id=member_id
    )
    m = current_membership(p.user)
    row = _member_row(p, p.last)
    pays = services.features_for(request.user)["admin"]
    return {
        **row,
        "coach_notes": p.coach_notes,
        "goal": p.goal,
        "sessions_per_week": m.sessions_per_week if m else None,
        "membership_id": m.id if m else None,
        "start_date": m.start_date if m else None,
        "has_password": p.user.has_usable_password(),
        "payments": (
            list(p.user.payments.values("id", "amount_mxn", "method", "paid_at", "note")[:24]) if pays else []
        ),
        "recent_checkins": list(p.user.checkins.values_list("at", flat=True)[:30]),
    }


@coach_router.patch("/members/{member_id}", response=MemberDetail)
@coach_required
def member_patch(request, member_id: int, data: MemberPatch):
    from apps.memberships.services import current_membership

    p = get_object_or_404(Profile, user_id=member_id)
    d = data.dict(exclude_unset=True)
    if "role" in d:
        if d["role"] == Profile.Role.MEMBER and p.user_id == request.user.id:
            raise HttpError(400, "No puedes quitarte tu propio rol de coach.")
        services.set_role(p.user, d["role"])
        p.refresh_from_db()
    if "coach_notes" in d:
        p.coach_notes = d["coach_notes"]
    if "status" in d:
        p.status = d["status"]
    p.save()
    if d.get("sessions_per_week"):
        m = current_membership(p.user)
        if m:
            m.sessions_per_week = d["sessions_per_week"]
            m.save(update_fields=["sessions_per_week", "updated_at"])
    return member_detail(request, member_id)


class NewMemberIn(Schema):
    full_name: str
    email: str
    phone: str = ""


@coach_router.post("/members", response={201: dict})
@coach_required
def create_member(request, data: NewMemberIn):
    """Alta desde recepción: crea la cuenta y devuelve el enlace para que cree su contraseña."""
    user = services.coach_create_member(**data.dict(), by=request.user)
    return 201, {"id": user.id, "access_link": services.access_link(user, request.build_absolute_uri("/"))}


@coach_router.post("/members/{member_id}/access-link", response=dict)
@coach_required
def member_access_link(request, member_id: int):
    """Vuelve a generar el enlace (si caducó o se perdió) mientras no haya creado su contraseña."""
    user = get_object_or_404(User, id=member_id)
    if user.has_usable_password():
        raise HttpError(400, "Esta persona ya creó su contraseña. Si la olvidó, que use «¿Olvidaste tu contraseña?».")
    return {"access_link": services.access_link(user, request.build_absolute_uri("/"))}


@coach_router.post("/members/{member_id}/approve")
@coach_required
def approve(request, member_id: int):
    services.approve_member(get_object_or_404(User, id=member_id))
    return {"ok": True}


@coach_router.post("/members/{member_id}/checkin")
@coach_required
def manual_checkin(request, member_id: int):
    from apps.checkin.services import checkin

    res = checkin(get_object_or_404(User, id=member_id), source="manual", manual_by=request.user)
    return {"ok": True, "points": res["points"], "warning": res["warning"]}


@coach_router.get("/stats", response=dict)
@coach_required
def stats(request, months: int = 6):
    """Gráficas del panel: asistencias y pagos por mes."""
    data = services.coach_stats(max(2, min(months, 12)))
    if not services.features_for(request.user)["admin"]:
        for r in data["months"]:
            r["payments_total"] = None
            r["payments_count"] = None
        data["prev_same_period"]["payments_total"] = None
    return data


@coach_router.get("/dashboard", response=DashboardOut)
@coach_required
def dashboard(request):
    from apps.checkin.models import CheckIn
    from apps.memberships.models import MembershipRequest
    from apps.schedule.services import sessions_for  # noqa: F401
    from apps.schedule.models import Booking, Session

    t = today()
    rows = [_member_row(p, p.last) for p in _members_qs()]
    sessions = (
        Session.objects.filter(date=t, cancelled=False).select_related("schedule").order_by("start_at")
    )
    return {
        "checkins_today": [
            {"member_id": c.member_id, "name": c.member.profile.full_name, "at": c.at, "source": c.source}
            for c in CheckIn.objects.filter(date=t).select_related("member__profile")
        ],
        "expiring": [r for r in rows if r["membership_status"] == "expiring"],
        "expired": [r for r in rows if r["membership_status"] in ("grace", "expired")],
        "requests": [
            {
                "id": r.id,
                "member_id": r.member_id,
                "name": r.member.profile.full_name,
                "type": r.type,
                "plan": r.plan.name if r.plan else None,
                "created_at": r.created_at,
            }
            for r in MembershipRequest.objects.filter(status="open").select_related("member__profile", "plan")
        ],
        "sessions_today": [
            {
                "id": s.id,
                "name": s.schedule.name,
                "type": s.schedule.type,
                "start_at": s.start_at,
                "capacity": s.capacity,
                "booked": s.bookings.filter(status__in=Booking.ACTIVE_STATUSES).count(),
            }
            for s in sessions
        ],
    }
