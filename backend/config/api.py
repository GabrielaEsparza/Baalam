from ninja import NinjaAPI
from ninja.security import django_auth

from apps.accounts.services import ServiceError

api = NinjaAPI(
    title="BÁALAM GYM API",
    version="1.0.0",
    auth=django_auth,  # sesión de Django + CSRF en todos los endpoints salvo los públicos
    urls_namespace="api",
)


@api.exception_handler(ServiceError)
def service_error(request, exc: ServiceError):
    return api.create_response(request, {"detail": exc.message, "code": exc.code}, status=exc.status)


from apps.accounts.api import auth_router, coach_router as coach_members_router, me_router  # noqa: E402
from apps.checkin.api import router as checkin_router, coach_router as coach_qr_router  # noqa: E402
from apps.community.api import router as community_router, coach_router as coach_ann_router  # noqa: E402
from apps.memberships.api import router as membership_router, coach_router as coach_pay_router  # noqa: E402
from apps.podium.api import router as podium_router  # noqa: E402
from apps.progress.api import router as progress_router  # noqa: E402
from apps.schedule.api import router as schedule_router, coach_router as coach_sched_router  # noqa: E402
from apps.training.api import router as training_router, coach_router as coach_training_router  # noqa: E402
from apps.nutrition.api import router as nutrition_router, coach_router as coach_nutrition_router  # noqa: E402

api.add_router("/auth", auth_router)
api.add_router("", me_router)
api.add_router("", membership_router)
api.add_router("", schedule_router)
api.add_router("", checkin_router)
api.add_router("", progress_router)
api.add_router("", podium_router)
api.add_router("", community_router)
api.add_router("", training_router)
api.add_router("", nutrition_router)
api.add_router("/coach", coach_members_router)
api.add_router("/coach", coach_pay_router)
api.add_router("/coach", coach_sched_router)
api.add_router("/coach", coach_qr_router)
api.add_router("/coach", coach_ann_router)
api.add_router("/coach", coach_training_router)
api.add_router("/coach", coach_nutrition_router)
