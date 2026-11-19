"""Cron día 25: genera las Sessions del mes siguiente (abre la reserva)."""
from datetime import timedelta

from django.core.management.base import BaseCommand

from apps.common import month_key, parse_month, today
from apps.schedule.services import generate_sessions


class Command(BaseCommand):
    def handle(self, *args, **opts):
        nxt = (today().replace(day=1) + timedelta(days=32)).replace(day=1)
        first, last = parse_month(month_key(nxt))
        n = generate_sessions(first, last)
        # TODO fase 2: aviso push/correo "Ya puedes reservar tu mes".
        self.stdout.write(f"mes={month_key(nxt)} sesiones_nuevas={n}")
