from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import models, transaction

from .models import Profile

User = get_user_model()


class ServiceError(Exception):
    """Error de regla de negocio con mensaje para mostrar al usuario."""

    def __init__(self, message: str, code: str = "invalid", status: int = 400):
        super().__init__(message)
        self.message, self.code, self.status = message, code, status


def ensure_profile(user) -> Profile:
    profile = Profile.objects.filter(user=user).first()
    if profile:
        return profile
    is_super = user.is_superuser
    return Profile.objects.create(
        user=user,
        full_name=user.get_full_name() or user.get_username(),
        role=Profile.Role.ADMIN if is_super else Profile.Role.MEMBER,
        status=Profile.Status.ACTIVE if is_super else Profile.Status.PENDING,
    )


def ensure_member(user):
    """Las reservas, el check-in y la rutina son solo para miembros, nunca para el coach."""
    if get_profile(user).role != Profile.Role.MEMBER:
        raise ServiceError("Los coaches no reservan clases ni registran asistencia.", "coach_not_member", 403)


def get_profile(user) -> Profile:
    try:
        return user.profile
    except Profile.DoesNotExist:
        return ensure_profile(user)


@transaction.atomic
def register(*, full_name: str, email: str, phone: str, password: str):
    from apps.memberships.models import MembershipRequest

    email = email.strip().lower()
    if User.objects.filter(username=email).exists():
        raise ServiceError("Ya existe una cuenta con ese correo.", "email_taken")
    try:
        validate_password(password)
    except ValidationError as e:
        raise ServiceError(" ".join(e.messages), "weak_password")
    user = User.objects.create_user(username=email, email=email, password=password)
    profile = get_profile(user)
    profile.full_name = full_name.strip()
    profile.phone = phone.strip()
    profile.save()
    MembershipRequest.objects.create(member=user, type=MembershipRequest.Type.SIGNUP)
    return user


def approve_member(member) -> Profile:
    from apps.memberships.models import MembershipRequest

    profile = get_profile(member)
    profile.status = Profile.Status.ACTIVE
    profile.save(update_fields=["status", "updated_at"])
    MembershipRequest.objects.filter(
        member=member, type=MembershipRequest.Type.SIGNUP, status=MembershipRequest.Status.OPEN
    ).update(status=MembershipRequest.Status.DONE)
    return profile


def set_role(member, role: str) -> Profile:
    """Coach y admin entran también al panel de respaldo (/admin) con todos los permisos."""
    profile = get_profile(member)
    profile.role = role
    if role != Profile.Role.MEMBER:
        profile.status = Profile.Status.ACTIVE
    profile.save()
    staff = role in (Profile.Role.COACH, Profile.Role.ADMIN)
    member.is_staff = member.is_superuser = staff
    member.save(update_fields=["is_staff", "is_superuser"])
    return profile


def save_avatar(user, uploaded) -> Profile:
    """Recorta al centro en cuadrado, 512 px, JPEG. Rechaza lo que no sea imagen."""
    from io import BytesIO

    from django.core.files.base import ContentFile
    from PIL import Image, ImageOps, UnidentifiedImageError

    if uploaded.size > 12 * 1024 * 1024:
        raise ServiceError("La foto pesa demasiado (máximo 12 MB).")
    try:
        img = Image.open(uploaded)
        img = ImageOps.exif_transpose(img).convert("RGB")
    except (UnidentifiedImageError, OSError):
        raise ServiceError("Ese archivo no es una imagen válida.")
    img = ImageOps.fit(img, (512, 512), Image.LANCZOS)
    buf = BytesIO()
    img.save(buf, "JPEG", quality=85, optimize=True)
    profile = get_profile(user)
    old = profile.avatar.name if profile.avatar else None
    profile.avatar.save(f"u{user.id}.jpg", ContentFile(buf.getvalue()), save=True)
    if old and old != profile.avatar.name:
        profile.avatar.storage.delete(old)
    return profile


def features_for(user) -> dict:
    """Qué puede usar el usuario según su rol y su plan con acceso vigente."""
    from apps.memberships.services import current_membership, display_status, has_access

    profile = get_profile(user)
    is_staff_role = profile.role in (Profile.Role.COACH, Profile.Role.ADMIN)
    m = None if is_staff_role else current_membership(user)  # el coach no reserva ni entrena como miembro
    access = bool(m) and has_access(display_status(m))
    plan = m.plan if m else None
    return {
        "routine": bool(plan and plan.includes_routine),
        "open_gym": bool(plan and plan.includes_open_gym),
        "classes": bool(plan and plan.includes_classes),
        "access": access,
        "coach": profile.role in (Profile.Role.COACH, Profile.Role.ADMIN),
        "admin": profile.role in (Profile.Role.COACH, Profile.Role.ADMIN),
    }


def birthdays_today(viewer=None) -> list[dict]:
    """Miembros y coaches activos que cumplen años hoy (para la notificación de Inicio)."""
    from apps.common import today

    t = today()
    qs = Profile.objects.filter(birth_date__month=t.month, birth_date__day=t.day).exclude(
        status=Profile.Status.BLOCKED
    )
    if t.month == 3 and t.day == 1 and not _is_leap(t.year):
        # Quien nació un 29 de febrero lo festeja el 1 de marzo en años no bisiestos.
        qs = Profile.objects.filter(
            models.Q(birth_date__month=3, birth_date__day=1) | models.Q(birth_date__month=2, birth_date__day=29)
        ).exclude(status=Profile.Status.BLOCKED)
    rows = [
        {
            "id": p.user_id,
            "first_name": (p.full_name or "").split(" ")[0],
            "avatar_url": p.avatar.url if p.avatar else None,
            "is_me": viewer is not None and p.user_id == viewer.id,
        }
        for p in qs.select_related("user").order_by("full_name")
    ]
    return sorted(rows, key=lambda r: not r["is_me"])


def _is_leap(y: int) -> bool:
    return y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)


def coach_stats(months: int = 6, on=None) -> dict:
    """Asistencias y pagos por mes (los últimos `months`, incluido el actual).

    Para comparar justo el mes en curso, también se da el mes anterior cortado
    al mismo día (p. ej. 1–18 de octubre contra 1–18 de noviembre).
    """
    from django.db.models import Count, Sum

    from apps.checkin.models import CheckIn
    from apps.common import add_months, month_key, parse_month, today
    from apps.memberships.models import Payment

    on = on or today()
    first = add_months(on.replace(day=1), -(months - 1))
    rows = []
    for i in range(months):
        start = add_months(first, i)
        _, end = parse_month(month_key(start))
        ci = CheckIn.objects.filter(date__range=(start, end))
        pays = Payment.objects.filter(paid_at__range=(start, end)).aggregate(total=Sum("amount_mxn"), n=Count("id"))
        rows.append(
            {
                "month": month_key(start),
                "checkins": ci.count(),
                "members": ci.values("member").distinct().count(),
                "payments_total": pays["total"] or 0,
                "payments_count": pays["n"],
            }
        )

    prev_start = add_months(on.replace(day=1), -1)
    _, prev_end = parse_month(month_key(prev_start))
    cut = prev_start.replace(day=min(on.day, prev_end.day))
    prev_pays = Payment.objects.filter(paid_at__range=(prev_start, cut)).aggregate(total=Sum("amount_mxn"))
    return {
        "months": rows,
        "day_of_month": on.day,
        "prev_same_period": {
            "checkins": CheckIn.objects.filter(date__range=(prev_start, cut)).count(),
            "payments_total": prev_pays["total"] or 0,
        },
    }


@transaction.atomic
def coach_create_member(*, full_name: str, email: str, phone: str = "", by=None):
    """La coach da de alta a alguien en recepción. La cuenta nace sin contraseña:
    la persona la crea con el enlace de acceso (access_link). Queda pendiente hasta el primer pago."""
    from django.core.validators import validate_email

    full_name = (full_name or "").strip()
    email = (email or "").strip().lower()
    if len(full_name) < 2:
        raise ServiceError("Escribe el nombre completo.")
    try:
        validate_email(email)
    except ValidationError:
        raise ServiceError("Escribe un correo válido.", "bad_email")
    if User.objects.filter(username=email).exists():
        raise ServiceError("Ya existe una cuenta con ese correo.", "email_taken")
    user = User.objects.create_user(username=email, email=email)
    user.set_unusable_password()
    user.save()
    profile = get_profile(user)
    profile.full_name = full_name
    profile.phone = (phone or "").strip()
    profile.save()
    return user


def access_link(user, base_url: str) -> str:
    """Enlace para crear (o cambiar) su contraseña. Vale PASSWORD_RESET_TIMEOUT y se invalida al usarse."""
    from django.contrib.auth.tokens import default_token_generator
    from django.utils.encoding import force_bytes
    from django.utils.http import urlsafe_base64_encode

    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = default_token_generator.make_token(user)
    return f"{base_url.rstrip('/')}/recuperar?uid={uid}&token={token}&nuevo=1"
