"""Utilidades compartidas de fecha (siempre en hora local del gym)."""
import calendar
from datetime import date, datetime, timedelta

from django.utils import timezone


def now() -> datetime:
    return timezone.localtime()


def today() -> date:
    return timezone.localdate()


def month_key(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def parse_month(key: str) -> tuple[date, date]:
    """'2026-12' -> (primer día, último día)."""
    year, month = (int(p) for p in key.split("-"))
    last = calendar.monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last)


def add_months(d: date, months: int) -> date:
    m = d.month - 1 + months
    year, month = d.year + m // 12, m % 12 + 1
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


def week_bounds(d: date) -> tuple[date, date]:
    """Lunes y domingo de la semana ISO de d."""
    start = d - timedelta(days=d.weekday())
    return start, start + timedelta(days=6)


def daterange(start: date, end: date):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)
