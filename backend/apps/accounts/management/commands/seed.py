"""Datos iniciales: ajustes del gym, los dos planes y horarios de ejemplo."""
from datetime import time

from django.core.management.base import BaseCommand

from apps.memberships.models import GymSettings, Plan
from apps.schedule.models import Schedule


class Command(BaseCommand):
    help = "Carga planes, ajustes y horarios de ejemplo (idempotente)"

    def handle(self, *args, **opts):
        s = GymSettings.load()
        if not s.hours:
            s.hours = "Lunes a viernes 6:00–22:00 · Sábado 8:00–14:00"
            s.save()
        Plan.objects.get_or_create(
            name="Plan Rutina",
            defaults=dict(
                price_mxn=600, includes_routine=True, includes_open_gym=True,
                default_sessions_per_week=4,
                benefits=["Rutina personalizada por tu coach", "Turnos de piso libre", "Seguimiento de progreso"],
            ),
        )
        Plan.objects.get_or_create(
            name="Plan Clases",
            defaults=dict(
                price_mxn=300, includes_classes=True, default_sessions_per_week=3,
                benefits=["Clase grupal de la mañana", "Seguimiento de progreso"],
            ),
        )
        if not Schedule.objects.exists():
            Schedule.objects.create(
                name="Clase de la mañana", type="class", weekdays=[0, 1, 2, 3, 4],
                start_time=time(7, 0), duration_min=60, capacity=12,
            )
            for h in (6, 8, 17, 19):
                Schedule.objects.create(
                    name="Piso libre", type="open_gym", weekdays=[0, 1, 2, 3, 4, 5],
                    start_time=time(h, 0), duration_min=120, capacity=15,
                )
        self.stdout.write(self.style.SUCCESS("Seed listo"))
