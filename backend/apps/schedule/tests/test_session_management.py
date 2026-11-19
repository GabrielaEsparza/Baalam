from datetime import time, timedelta
from decimal import Decimal

from django.test import TestCase

from apps.accounts.services import ServiceError, coach_stats
from apps.checkin.models import CheckIn
from apps.common import month_key, now, today
from apps.memberships.tests.test_services import make_member, make_plans, pay
from apps.schedule import services as ss
from apps.schedule.models import Booking, Schedule, Session


class SessionManagementTests(TestCase):
    def setUp(self):
        _, clases = make_plans()
        self.member = make_member()
        pay(self.member, clases)
        self.sch = Schedule.objects.create(name="Funcional", type="class", weekdays=list(range(7)), start_time=time(19, 0))
        self.tomorrow = today() + timedelta(days=1)
        ss.generate_sessions(self.tomorrow, self.tomorrow + timedelta(days=7))
        self.s = Session.objects.get(schedule=self.sch, date=self.tomorrow)
        self.b = Booking.objects.create(member=self.member, session=self.s, month=month_key(self.tomorrow))

    def test_cancel_and_reopen_restores_bookings(self):
        ss.cancel_session(self.s.id)
        self.b.refresh_from_db()
        self.assertEqual(self.b.status, Booking.Status.CANCELLED)
        ss.reopen_session(self.s.id)
        self.b.refresh_from_db()
        self.s.refresh_from_db()
        self.assertFalse(self.s.cancelled)
        self.assertEqual(self.b.status, Booking.Status.BOOKED)

    def test_edit_only_that_date(self):
        ss.edit_session(self.s.id, start_time=time(20, 0), duration_min=45, capacity=5)
        self.s.refresh_from_db()
        self.assertEqual(self.s.capacity, 5)
        self.assertTrue(self.s.edited)
        other = Session.objects.get(schedule=self.sch, date=self.tomorrow + timedelta(days=1))
        self.assertEqual(other.capacity, 12)  # las demás fechas no cambian
        self.b.refresh_from_db()
        self.assertEqual(self.b.status, Booking.Status.BOOKED)  # la reserva sigue
        ss.edit_session(self.s.id, start_time=time(20, 0), duration_min=45, capacity=1)  # hay 1 reserva: cupo 1 sí
        with self.assertRaises(ServiceError):
            ss.edit_session(self.s.id, start_time=time(20, 0), duration_min=45, capacity=0)

    def test_extra_session_is_one_off(self):
        s = ss.create_extra_session(
            name="", type="class", on=self.tomorrow, start_time=time(9, 0), duration_min=60, capacity=10
        )
        self.assertTrue(s.schedule.one_off)
        self.assertEqual(s.schedule.name, "Clase extra")
        ss.generate_sessions(self.tomorrow, self.tomorrow + timedelta(days=14))
        self.assertEqual(Session.objects.filter(schedule=s.schedule).count(), 1)  # no se repite
        # aparece para reservar ese día
        ids = [x.id for x in ss.sessions_for(self.member, self.tomorrow, self.tomorrow)]
        self.assertIn(s.id, ids)

    def test_past_dates_locked(self):
        past = Session.objects.create(
            schedule=self.sch, date=today() - timedelta(days=1), start_at=now() - timedelta(days=1),
            end_at=now() - timedelta(days=1, hours=-1), capacity=12,
        )
        with self.assertRaises(ServiceError):
            ss.cancel_session(past.id)


class CoachStatsTests(TestCase):
    def test_months_and_same_period(self):
        rutina, _ = make_plans()
        m = make_member()
        pay(m, rutina)
        CheckIn.objects.create(member=m, at=now(), date=today(), source="manual")
        st = coach_stats(6)
        self.assertEqual(len(st["months"]), 6)
        cur = st["months"][-1]
        self.assertEqual(cur["month"], month_key(today()))
        self.assertEqual(cur["checkins"], 1)
        self.assertEqual(cur["payments_total"], Decimal("600"))
        self.assertEqual(st["prev_same_period"]["checkins"], 0)


class ExtraSessionApiTests(TestCase):
    def test_extra_route_is_not_swallowed_by_session_id(self):
        from apps.accounts.services import set_role

        coach = make_member("coach@t.mx")
        set_role(coach, "coach")
        self.client.force_login(coach)
        d = (today() + timedelta(days=1)).isoformat()
        r = self.client.post(
            "/api/coach/sessions/extra",
            {"type": "class", "date": d, "start_time": "09:00", "capacity": 8},
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 201, r.content)
        sid = r.json()["id"]
        r = self.client.patch(
            f"/api/coach/sessions/{sid}",
            {"start_time": "10:00", "duration_min": 45, "capacity": 6},
            content_type="application/json",
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.json()["edited"])
