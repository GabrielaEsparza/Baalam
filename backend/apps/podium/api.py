from django.db.models import Sum
from ninja import Router

from apps.common import month_key, today

from . import services
from .models import PointsLedger

router = Router(tags=["podio"])


@router.get("/podium", response=dict)
def podium(request, month: str | None = None):
    month = month or month_key(today())
    rows = services.ranking(month)
    mine = next((r for r in rows if r["member_id"] == request.user.id), None)
    my_points = PointsLedger.objects.filter(member=request.user, month=month).aggregate(s=Sum("points"))["s"] or 0
    return {
        "month": month,
        "top": rows[:3],
        "rest": rows[3:50],
        "me": mine or {"position": None, "points": my_points},
        "rules": {k: services.points_for(k) for k in services.DEFAULT_POINTS},
    }
