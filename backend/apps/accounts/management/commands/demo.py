"""Datos de prueba para desarrollo local. NUNCA correr en producción.

Crea: coach (admin) coach@demo.mx y miembros demo con pagos, reservas, peso y puntos.
Contraseña de todos: baalam-demo-2026
"""
import random
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError

from apps.accounts.services import approve_member, get_profile, register
from apps.checkin.models import CheckIn
from apps.common import month_key, now, today
from apps.community.models import Announcement
from apps.memberships.models import GymSettings, Plan
from apps.memberships.services import register_payment
from apps.podium.models import PointsLedger
from apps.progress.models import BodyLog
from apps.schedule.models import Booking, Schedule, Session
from apps.schedule.services import generate_sessions

PASSWORD = "baalam-demo-2026"
User = get_user_model()

MEMBERS = [
    ("Karen López", "karen@demo.mx", "Plan Rutina", "a"),
    ("Diego Ramírez", "diego@demo.mx", "Plan Rutina", "o"),
    ("Sofía Torres", "sofia@demo.mx", "Plan Clases", "a"),
    ("Alex Méndez", "alex@demo.mx", "Plan Rutina", "x"),
    ("Mariana Ruiz", "mariana@demo.mx", "Plan Clases", "a"),
]


class Command(BaseCommand):
    help = "Carga datos de prueba (solo DEBUG)"

    def handle(self, *args, **opts):
        if not settings.DEBUG:
            raise CommandError("Solo en desarrollo (DEBUG=1).")
        call_command("seed")
        s = GymSettings.load()
        s.whatsapp = s.whatsapp or "523841008315"
        s.address = s.address or "Dirección de ejemplo"
        s.save()

        coach = User.objects.filter(username="coach@demo.mx").first()
        if not coach:
            coach = User.objects.create_superuser("coach@demo.mx", "coach@demo.mx", PASSWORD)
            p = get_profile(coach)
            p.full_name = "Coach Demo"
            p.save()

        t = today()
        generate_sessions(t - timedelta(days=t.weekday()), t + timedelta(days=14))
        rnd = random.Random(7)
        for name, email, plan_name, greet in MEMBERS:
            if User.objects.filter(username=email).exists():
                continue
            u = register(full_name=name, email=email, phone="5500000000", password=PASSWORD)
            approve_member(u)
            prof = get_profile(u)
            prof.greeting, prof.target_weight_kg = greet, Decimal("68")
            prof.save()
            register_payment(member=u, plan=Plan.objects.get(name=plan_name), amount_mxn=Decimal("600"), method="cash", registered_by=coach)
            # peso de las últimas semanas
            w = Decimal(rnd.randint(70, 85))
            waist, fat, muscle, water = Decimal(rnd.randint(80, 95)), Decimal(rnd.randint(24, 32)), Decimal(rnd.randint(30, 36)), Decimal(rnd.randint(48, 54))
            for i in range(8, -1, -1):
                extra = {}
                if i % 2 == 0:  # medidas y báscula cada 2 semanas
                    extra = dict(
                        waist_cm=waist, hip_cm=waist + 12, chest_cm=waist + 8, arm_cm=Decimal("31.5"), leg_cm=Decimal("55"),
                        body_fat_pct=fat, muscle_pct=muscle, water_pct=water,
                    )
                    waist -= Decimal("0.8"); fat -= Decimal("0.6"); muscle += Decimal("0.4"); water += Decimal("0.3")
                BodyLog.objects.create(member=u, date=t - timedelta(days=i * 7), weight_kg=w, **extra)
                w -= Decimal(str(rnd.choice([0.2, 0.4, 0.6, 0, -0.2])))
            # reservas y asistencias de esta semana
            stype = "open_gym" if plan_name == "Plan Rutina" else "class"
            sched = Schedule.objects.filter(type=stype).first()
            for sess in Session.objects.filter(schedule=sched, date__gte=t - timedelta(days=t.weekday()), date__lte=t + timedelta(days=6))[:4]:
                b = Booking.objects.create(member=u, session=sess, month=month_key(sess.date))
                if sess.date < t and rnd.random() > 0.2:
                    b.status = "attended"
                    b.save()
                    CheckIn.objects.create(member=u, at=sess.start_at, date=sess.date, source="qr", booking=b)
                    PointsLedger.objects.create(member=u, points=100, reason="checkin", ref=f"checkin:{sess.date}", month=month_key(sess.date))
            PointsLedger.objects.create(member=u, points=rnd.randint(1, 8) * 30, reason="pr", ref=f"pr:demo{u.id}", month=month_key(t))

        if not Announcement.objects.exists():
            Announcement.objects.create(
                title="Horario especial el lunes",
                body="El lunes abrimos de 8:00 a 14:00. Reserva tu turno con tiempo.",
                pinned=True, publish_at=now(), author=coach,
            )
        self.stdout.write(self.style.SUCCESS(f"Demo listo. Usuarios: coach@demo.mx y {', '.join(m[1] for m in MEMBERS)} · contraseña {PASSWORD}"))
