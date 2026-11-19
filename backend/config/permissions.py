"""Permisos por rol y por plan. Las rutas /coach/* se protegen aquí, no solo en el menú."""
from functools import wraps

from ninja.errors import HttpError


def _profile(request):
    from apps.accounts.services import get_profile

    return get_profile(request.user)


def member_required(func):
    @wraps(func)
    def wrapper(request, *args, **kwargs):
        if _profile(request).status == "blocked":
            raise HttpError(403, "Tu cuenta está bloqueada. Habla con tu coach.")
        return func(request, *args, **kwargs)

    return wrapper


def coach_required(func):
    @wraps(func)
    def wrapper(request, *args, **kwargs):
        if _profile(request).role not in ("coach", "admin"):
            raise HttpError(403, "Solo para coaches.")
        return func(request, *args, **kwargs)

    return wrapper


def admin_required(func):
    @wraps(func)
    def wrapper(request, *args, **kwargs):
        # El coach también administra (pagos, planes, ajustes).
        if _profile(request).role not in ("coach", "admin"):
            raise HttpError(403, "Solo para administradores.")
        return func(request, *args, **kwargs)

    return wrapper


def feature_required(feature: str):
    """Exige que el plan activo incluya una función: routine, open_gym o classes."""

    def deco(func):
        @wraps(func)
        def wrapper(request, *args, **kwargs):
            from apps.accounts.services import features_for

            if not features_for(request.user).get(feature):
                raise HttpError(403, "Tu plan no incluye esta función.")
            return func(request, *args, **kwargs)

        return wrapper

    return deco
