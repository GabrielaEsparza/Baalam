"""Cron día 1: congela el ranking del mes anterior."""
from datetime import timedelta

from django.core.management.base import BaseCommand

from apps.common import month_key, today
from apps.podium.services import close_month


class Command(BaseCommand):
    def handle(self, *args, **opts):
        prev = month_key(today().replace(day=1) - timedelta(days=1))
        pm = close_month(prev)
        self.stdout.write(f"podio cerrado mes={prev} lugares={len(pm.ranking)}")
