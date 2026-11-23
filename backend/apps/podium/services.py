from datetime import date

from django.conf import settings
from django.db.models import Count, Q, Sum

from apps.accounts.models import Profile
from apps.common import month_key, parse_month, today, week_bounds
from apps.memberships.models import GymSettings

from .models import PodiumMonth, PointsLedger

R = PointsLedger.Reason

DEFAULT_POINTS = {
    R.CHECKIN: 100,
    R.WORKOUT: 50,
    R.PR: 30,
    R.STREAK_WEEK: 150,
    R.BODY_LOG: 20,
}
PR_DAILY_LIMIT = 3


def points_for(reason: str) -> int:
    cfg = GymSettings.load().points_config or {}
    return int(cfg.get(reason, DEFAULT_POINTS.get(reason, 0)))


def _ref_for(reason: str, on: date, ref: str) -> str:
    if reason in (R.CHECKIN, R.WORKOUT):
        return f"{reason}:{on.isoformat()}"
    if reason in (R.STREAK_WEEK, R.BODY_LOG):
        y, w, _ = on.isocalendar()
        return f"{reason}:{y}-W{w:02d}"
    return f"{reason}:{ref}" if ref else ""


def award(member, reason: str, *, on: date | None = None, ref: str = "", points: int | None = None, note: str = ""):
    """Suma puntos respetando los límites. Devuelve el movimiento o None si no aplica."""
    on = on or today()
    if reason == R.MANUAL:
        if points is None or not note:
            raise ValueError("El ajuste manual necesita puntos y motivo.")
        return PointsLedger.objects.create(
            member=member, points=points, reason=reason, note=note, month=month_key(on)
        )
    key = _ref_for(reason, on, ref)
    if key and PointsLedger.objects.filter(member=member, ref=key).exists():
        return None
    if reason == R.PR:
        if PointsLedger.objects.filter(member=member, reason=R.PR, created_at__date=on).count() >= PR_DAILY_LIMIT:
            return None
    return PointsLedger.objects.create(
        member=member,
        points=points if points is not None else points_for(reason),
        reason=reason,
        ref=key,
        note=note,
        month=month_key(on),
    )


def check_weekly_streak(member, on: date | None = None):
    """Si la semana ya lleva 4+ asistencias, otorga el bono una sola vez."""
    from apps.checkin.models import CheckIn

    on = on or today()
    start, end = week_bounds(on)
    if CheckIn.objects.filter(member=member, date__range=(start, end)).count() >= 4:
        return award(member, R.STREAK_WEEK, on=on)
    return None


def ranking(month: str | None = None) -> list[dict]:
    month = month or month_key(today())
    frozen = PodiumMonth.objects.filter(month=month).first()
    if frozen:
        return frozen.ranking
    start, end = parse_month(month)
    rows = (
        Profile.objects.filter(show_in_podium=True, role=Profile.Role.MEMBER)
        .annotate(
            pts=Sum("user__points__points", filter=Q(user__points__month=month)),
        )
        .filter(pts__gt=0)
        .values("user_id", "full_name", "pts", "avatar")
    )
    from apps.checkin.models import CheckIn

    checkins = dict(
        CheckIn.objects.filter(date__range=(start, end))
        .values("member_id")
        .annotate(n=Count("id"))
        .values_list("member_id", "n")
    )
    data = [
        {
            "member_id": r["user_id"],
            "name": r["full_name"],
            "avatar_url": (settings.MEDIA_URL + r["avatar"]) if r["avatar"] else None,
            "points": r["pts"],
            "checkins": checkins.get(r["user_id"], 0),
        }
        for r in rows
    ]
    data.sort(key=lambda r: (-r["points"], -r["checkins"], r["name"]))
    for i, r in enumerate(data, start=1):
        r["position"] = i
    return data


def close_month(month: str) -> PodiumMonth:
    PodiumMonth.objects.filter(month=month).delete()
    return PodiumMonth.objects.create(month=month, ranking=ranking(month))
