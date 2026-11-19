"""Flujo completo por HTTP, con sesión y CSRF reales."""
import json
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import Client, TestCase
from django.utils import timezone

from apps.common import month_key, today
from apps.memberships.models import Plan
from apps.schedule.models import Schedule

User = get_user_model()


class ApiClient:
    def __init__(self):
        self.c = Client(enforce_csrf_checks=True)
        self.c.get("/api/auth/csrf")

    def _csrf(self):
        return self.c.cookies["csrftoken"].value

    def get(self, url, **params):
        return self.c.get(url, params)

    def send(self, method, url, data=None):
        fn = getattr(self.c, method)
        return fn(url, data=json.dumps(data or {}), content_type="application/json", HTTP_X_CSRFTOKEN=self._csrf())


class FullFlowTests(TestCase):
    def setUp(self):
        self.plan = Plan.objects.create(name="Plan Rutina", price_mxn=600, includes_routine=True, includes_open_gym=True)
        start = (timezone.localtime() - timedelta(minutes=5)).time().replace(second=0, microsecond=0)
        self.sch = Schedule.objects.create(
            name="Piso", type="open_gym", weekdays=list(range(7)), start_time=start, duration_min=180, capacity=10
        )
        self.coach = User.objects.create_superuser("coach@baalam.mx", "coach@baalam.mx", "jaguar-fuerte-1")

    def test_member_journey(self):
        member = ApiClient()
        r = member.send("post", "/api/auth/register", {
            "full_name": "Karen López", "email": "karen@test.mx", "phone": "6691234567", "password": "sentadilla-99",
        })
        self.assertEqual(r.status_code, 201, r.content)
        me = r.json()
        self.assertEqual(me["status"], "pending")
        self.assertFalse(me["features"]["access"])

        # Sin CSRF se rechaza
        raw = Client(enforce_csrf_checks=True)
        self.assertEqual(raw.post("/api/auth/login", data=json.dumps({"email": "karen@test.mx", "password": "sentadilla-99"}), content_type="application/json").status_code, 403)

        # Un miembro no entra a /coach
        self.assertEqual(member.get("/api/coach/dashboard").status_code, 403)

        coach = ApiClient()
        r = coach.send("post", "/api/auth/login", {"email": "coach@baalam.mx", "password": "jaguar-fuerte-1"})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.json()["features"]["admin"])

        dash = coach.get("/api/coach/dashboard").json()
        self.assertEqual(dash["requests"][0]["type"], "signup")

        r = coach.send("post", "/api/coach/payments", {
            "member_id": me["id"], "plan_id": self.plan.id, "amount_mxn": "600", "method": "cash",
        })
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.json()["membership"]["status"], "active")

        me = member.get("/api/me").json()
        self.assertTrue(me["features"]["routine"])
        self.assertTrue(me["features"]["access"])

        # Reserva el día de hoy
        wd = today().weekday()
        r = member.send("post", "/api/bookings/month", {
            "month": month_key(today()), "pattern": [{"weekday": wd, "schedule_id": self.sch.id}],
        })
        self.assertEqual(r.status_code, 200, r.content)
        # La sesión de hoy ya empezó, así que se reserva suelta (ya no entra al patrón)
        from apps.schedule.models import Session
        from apps.schedule.services import generate_sessions

        generate_sessions(today(), today())
        s_today = Session.objects.get(schedule=self.sch, date=today())
        from apps.schedule.models import Booking

        Booking.objects.get_or_create(member_id=me["id"], session=s_today, defaults={"month": month_key(today())})

        # Check-in con el token del QR
        qr = coach.get("/api/coach/qr").json()
        r = member.send("post", "/api/checkin", {"token": qr["token"]})
        self.assertEqual(r.status_code, 200, r.content)
        self.assertEqual(r.json()["points"], 100)

        r = member.send("post", "/api/checkin", {"code": qr["code"]})
        self.assertEqual(r.status_code, 409)

        home = member.get("/api/home").json()
        self.assertTrue(home["checked_in_today"])
        self.assertEqual(home["greeting"], "Bienvenidx")

        podium = member.get("/api/podium").json()
        self.assertEqual(podium["me"]["position"], 1)

        # Saludo y tema
        r = member.send("patch", "/api/me", {"greeting": "a", "theme": "dark"})
        self.assertEqual(r.json()["theme"], "dark")
        self.assertEqual(member.get("/api/home").json()["greeting"], "Bienvenida")

        # Solicitud de renovación
        r = member.send("post", "/api/membership/requests", {"type": "renewal"})
        self.assertEqual(r.status_code, 201)

    def test_public_gym_info(self):
        r = Client().get("/api/gym")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["plans"][0]["name"], "Plan Rutina")
