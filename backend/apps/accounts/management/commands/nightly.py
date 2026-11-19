"""Cron diario (02:00): el ÚNICO cron que necesita Railway.

- Vence membresías, marca faltas y entrenamientos perdidos.
- Genera las Sessions de las próximas 6 semanas y, desde el día 25, las del mes siguiente
  completo (abre la reserva del mes; antes era el cron `open_month`).
- Congela el podio del mes anterior si aún no está cerrado (antes era `close_podium`).
- Borra registros de comida de más de un mes.

Todo es idempotente: si corre dos veces el mismo día no duplica nada.
"""
from datetime import timedelta

from django.core.management.base import BaseCommand

from apps.common import month_key, parse_month, today
from apps.memberships.services import expire_memberships
from apps.nutrition.services import purge_old_logs
from apps.podium.models import PodiumMonth
from apps.podium.services import close_month
from apps.schedule.services import generate_sessions, mark_missed
from apps.training.models import ScheduledWorkout


class Command(BaseCommand):
    help = "Tareas nocturnas de BÁALAM"

    def handle(self, *args, **opts):
        t = today()
        expired = expire_memberships(t)
        missed = mark_missed(t)
        lost = ScheduledWorkout.objects.filter(date__lt=t, status=ScheduledWorkout.Status.PLANNED).update(
            status=ScheduledWorkout.Status.MISSED
        )
        end = t + timedelta(weeks=6)
        booking_open_day = 25
        try:
            from apps.memberships.models import GymSettings

            booking_open_day = GymSettings.load().booking_open_day
        except Exception:  # noqa: BLE001
            pass
        if t.day >= booking_open_day:
            nxt = (t.replace(day=1) + timedelta(days=32)).replace(day=1)
            end = max(end, parse_month(month_key(nxt))[1])
        sessions = generate_sessions(t, end)

        prev = month_key(t.replace(day=1) - timedelta(days=1))
        podium = ""
        if not PodiumMonth.objects.filter(month=prev).exists():
            podium = f" podio_cerrado={prev}"
            close_month(prev)

        food_logs = purge_old_logs(t)
        self.stdout.write(
            f"vencidas={expired} faltas={missed} entrenos_perdidos={lost} sesiones_nuevas={sessions} "
            f"comidas_borradas={food_logs}{podium}"
        )
