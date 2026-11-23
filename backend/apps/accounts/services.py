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


def is_owner(user) -> bool:
    """La cuenta principal del gym (settings.OWNER_EMAIL)."""
    from django.conf import settings

    email = (user.email or user.get_username() or "").strip().lower()
    return bool(settings.OWNER_EMAIL) and email == settings.OWNER_EMAIL and get_profile(user).role in (
        Profile.Role.COACH,
        Profile.Role.ADMIN,
    )


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
        "self_routine": bool(plan and plan.includes_routine and access and profile.self_routine),
        "access": access,
        "coach": profile.role in (Profile.Role.COACH, Profile.Role.ADMIN),
        "admin": profile.role in (Profile.Role.COACH, Profile.Role.ADMIN),
        "owner": is_owner(user),
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


DELETED_NAME = "Cuenta eliminada"


@transaction.atomic
def delete_account(user, password: str = "", *, by=None) -> None:
    """Elimina una cuenta: la persona desde la app (requisito de Google Play; pide su contraseña)
    o la coach desde la ficha del miembro (`by` = la coach; no pide contraseña).

    Se BORRAN sus datos personales y de uso: peso y medidas, fotos, comidas, agua, rutinas,
    entrenamientos, puntos, avisos y dispositivos. Se ANONIMIZA lo que el gym necesita conservar
    por contabilidad y estadística (pagos, membresías, asistencias y reservas): quedan a nombre de
    "Cuenta eliminada", sin correo, teléfono ni fecha de nacimiento. La cuenta queda inactiva.
    """
    from apps.checkin.models import CheckIn  # noqa: F401  (se conserva, anonimizada)
    from apps.memberships.models import MembershipRequest
    from apps.nutrition.models import FavoriteFood, FoodLog, NutritionGoal, QuickHide
    from apps.podium.models import PodiumMonth, PointsLedger
    from apps.progress.models import BodyLog, ProgressPhoto
    from apps.reminders.models import FcmDevice, PushSubscription, ReminderPrefs, SentReminder, WaterLog
    from apps.schedule.models import WaitlistEntry
    from apps.training.models import DaySwap, RoutineTemplate, ScheduledWorkout, WorkoutSession

    profile = get_profile(user)
    staff = profile.role in (Profile.Role.COACH, Profile.Role.ADMIN)
    if by is not None and not is_owner(by):
        raise ServiceError("Solo la cuenta principal puede eliminar cuentas.", "forbidden", 403)
    if staff and (by is None or is_owner(user)):
        raise ServiceError("La cuenta de la coach no se puede eliminar desde aquí.", "forbidden", 403)
    if not user.is_active:
        raise ServiceError("Esta cuenta ya estaba eliminada.", "already_deleted")
    if by is None and user.has_usable_password() and not user.check_password(password or ""):
        raise ServiceError("La contraseña no es correcta.", "bad_password")

    for photo in ProgressPhoto.objects.filter(member=user):
        photo.image.delete(save=False)
    if profile.avatar:
        profile.avatar.delete(save=False)
    for model, field in (
        (BodyLog, "member"), (ProgressPhoto, "member"), (FoodLog, "member"), (FavoriteFood, "member"),
        (QuickHide, "member"), (NutritionGoal, "member"), (WaterLog, "member"), (PushSubscription, "user"),
        (ReminderPrefs, "user"), (SentReminder, "user"), (FcmDevice, "user"), (PointsLedger, "member"), (DaySwap, "member"),
        (WorkoutSession, "member"), (ScheduledWorkout, "member"), (RoutineTemplate, "member"),
        (MembershipRequest, "member"), (WaitlistEntry, "member"),
    ):
        model.objects.filter(**{field: user}).delete()

    # Podios ya cerrados: el nombre deja de aparecer.
    for pm in PodiumMonth.objects.all():
        changed = False
        for row in pm.ranking:
            if row.get("member_id") == user.id:
                row.update(name=DELETED_NAME, avatar=None)
                changed = True
        if changed:
            pm.save(update_fields=["ranking", "updated_at"])

    profile.full_name = DELETED_NAME
    profile.phone = ""
    profile.avatar = ""
    profile.goal = ""
    profile.birth_date = None
    profile.sex = ""
    profile.height_cm = None
    profile.target_weight_kg = None
    profile.coach_notes = ""
    profile.show_in_podium = False
    profile.share_achievements = False
    profile.status = Profile.Status.BLOCKED
    profile.save()

    user.username = f"eliminada-{user.id}@cuenta.invalid"
    user.email = ""
    user.first_name = user.last_name = ""
    user.is_active = False
    user.is_staff = user.is_superuser = False  # si era coach, pierde también el panel /admin
    user.set_unusable_password()
    user.save()


GOOGLE_ISSUERS = ("accounts.google.com", "https://accounts.google.com")


def verify_google_credential(credential: str) -> dict:
    """Comprueba con las llaves públicas de Google que el token es auténtico, vigente y para esta app."""
    from django.conf import settings
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token

    if not settings.GOOGLE_CLIENT_ID:
        raise ServiceError("Entrar con Google aún no está disponible.", "google_disabled", 503)
    try:
        info = id_token.verify_oauth2_token(credential, google_requests.Request(), settings.GOOGLE_CLIENT_ID)
    except ValueError:
        raise ServiceError("No se pudo verificar tu cuenta de Google. Intenta de nuevo.", "google_invalid", 401)
    if info.get("iss") not in GOOGLE_ISSUERS or not info.get("email") or not info.get("email_verified"):
        raise ServiceError("Tu cuenta de Google no tiene un correo verificado.", "google_unverified", 401)
    return info


@transaction.atomic
def google_sign_in(info: dict):
    """Entra con la cuenta que tenga ese correo; si no existe, la crea (pendiente hasta su primer pago).
    Devuelve (user, creada)."""
    from apps.memberships.models import MembershipRequest

    email = info["email"].strip().lower()
    user = User.objects.filter(username=email).first()
    if user:
        if not user.is_active:
            raise ServiceError("Esta cuenta está desactivada. Habla con recepción.", "inactive", 403)
        if get_profile(user).status == Profile.Status.BLOCKED:
            raise ServiceError("Tu cuenta está bloqueada. Habla con tu coach.", "blocked", 403)
        return user, False
    user = User.objects.create_user(username=email, email=email)
    user.set_unusable_password()  # entra con Google; si quiere contraseña, usa "Olvidé mi contraseña"
    user.save()
    profile = get_profile(user)
    profile.full_name = (info.get("name") or email.split("@")[0]).strip()[:120]
    profile.save()
    MembershipRequest.objects.create(member=user, type=MembershipRequest.Type.SIGNUP)
    picture = info.get("picture")
    if picture:
        transaction.on_commit(lambda: _google_avatar(user, picture))
    return user, True


def _google_avatar(user, url: str):
    """Usa su foto de Google como foto de perfil (si falla, no pasa nada)."""
    import requests
    from django.core.files.uploadedfile import SimpleUploadedFile

    try:
        r = requests.get(url.replace("=s96-c", "=s512-c"), timeout=8)
        if r.ok and r.headers.get("Content-Type", "").startswith("image/"):
            save_avatar(user, SimpleUploadedFile("google.jpg", r.content, content_type=r.headers["Content-Type"]))
    except Exception:  # noqa: BLE001
        pass
