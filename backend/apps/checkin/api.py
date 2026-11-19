from ninja import Router, Schema

from config.permissions import coach_required

from . import services

router = Router(tags=["check-in"])
coach_router = Router(tags=["coach"])


class CheckinIn(Schema):
    token: str | None = None
    code: str | None = None


@router.post("/checkin", response=dict)
def do_checkin(request, data: CheckinIn):
    res = services.checkin(
        request.user, token=data.token, code=data.code, source="qr" if data.token else "code"
    )
    return {
        "ok": True,
        "at": res["checkin"].at,
        "session": res["session"],
        "points": res["points"],
        "warning": res["warning"],
    }


@coach_router.get("/qr", response=dict)
@coach_required
def qr(request):
    """Pantalla de recepción: token actual, código de 6 dígitos, segundos para expirar,
    horarios abiertos ahora para check-in y últimas llegadas."""
    return {**services.current_qr_token(), **services.live_status()}
