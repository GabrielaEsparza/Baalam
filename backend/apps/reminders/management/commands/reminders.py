from django.core.management.base import BaseCommand

from apps.reminders.services import purge_old, run_due


class Command(BaseCommand):
    help = "Envía los avisos que tocan ahora (corre cada 10 min). Idempotente."

    def handle(self, *args, **opts):
        n = run_due()
        purge_old()
        self.stdout.write(f"avisos enviados: {n}")
