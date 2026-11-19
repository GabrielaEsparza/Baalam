from datetime import date, time
from decimal import Decimal

from django.test import TestCase

from apps.accounts.models import Profile
from apps.accounts.services import birthdays_today
from apps.checkin.models import CheckIn
from apps.checkin.services import checkin
from apps.common import month_key, today
from apps.memberships.tests.test_services import make_member, make_plans, pay
from apps.podium.models import PointsLedger
from apps.progress import services as ps
from apps.schedule.models import Booking, Schedule, Session
from apps.schedule.services import generate_sessions
from apps.training import services as ts
from apps.training.models import Exercise


class DaySwapTests(TestCase):
    def setUp(self):
        rutina, _ = make_plans()
        self.member = make_member()
        pay(self.member, rutina)
        self.ex = Exercise.objects.create(name_es="Sentadilla", source="custom")
        self.wd = today().weekday()
        self.other = (self.wd + 2) % 7
        ts.save_day(self.member, self.other, label="Día B", focus="Pierna",
                    items=[{"exercise_id": self.ex.id, "sets": 2, "reps": 10, "rest_s": 60}])

    def test_rest_day_can_do_another_day(self):
        w = ts.today_workout(self.member)
        self.assertIsNone(w["day"])
        self.assertEqual([o["weekday"] for o in w["options"]], [self.other])
        w = ts.swap_day(self.member, self.other)
        self.assertEqual(w["day"]["label"], "Día B")
        self.assertEqual(w["swapped_from"], self.other)
        self.assertEqual(ts.today_workout_brief(self.member)["title"], "Día B")
        # registra y termina con la rutina cambiada
        item = w["day"]["items"][0]
        for n in (1, 2):
            ts.log_set(self.member, item_id=item["id"], set_number=n, weight_kg=Decimal("50"), reps=10)
        self.assertTrue(ts.finish_session(self.member)["completed"])
        # volver a la de hoy
        self.assertIsNone(ts.clear_swap(self.member)["day"])

    def test_swapped_day_gives_no_attendance_points(self):
        sch = Schedule.objects.create(name="Piso", type="open_gym", weekdays=list(range(7)),
                                      start_time=time(23, 0))
        generate_sessions(today(), today())
        Booking.objects.create(member=self.member, session=Session.objects.get(schedule=sch), month=month_key(today()))
        ts.swap_day(self.member, self.other)
        checkin(self.member, source="manual", manual_by=self.member)
        self.assertTrue(CheckIn.objects.filter(member=self.member).exists())
        self.assertFalse(PointsLedger.objects.filter(member=self.member, reason="checkin").exists())
        # al regresar a su día, recupera los puntos de asistencia
        ts.clear_swap(self.member)
        self.assertTrue(PointsLedger.objects.filter(member=self.member, reason="checkin").exists())
        # y si cambia después del check-in, se los quita
        ts.swap_day(self.member, self.other)
        self.assertFalse(PointsLedger.objects.filter(member=self.member, reason="checkin").exists())

    def test_cannot_swap_to_empty_day(self):
        from apps.accounts.services import ServiceError

        with self.assertRaises(ServiceError):
            ts.swap_day(self.member, (self.wd + 4) % 7)


class BmiAndBirthdayTests(TestCase):
    def setUp(self):
        self.member = make_member()
        self.p = self.member.profile

    def test_bmi_category_and_fat_range(self):
        self.p.height_cm = Decimal("165")
        self.p.sex = "f"
        self.p.birth_date = date(1995, 1, 1)
        self.p.save()
        b = ps.bmi(self.member, Decimal("85"))
        self.assertEqual(b["value"], Decimal("31.2"))
        self.assertEqual(b["category"], "obese1")
        self.assertEqual(b["fat_range"], {"min": 21, "max": 32})
        self.assertIsNone(ps.bmi(self.member, None)["value"])

    def test_birthdays_today(self):
        t = today()
        self.p.birth_date = date(1990, t.month, min(t.day, 28))
        self.p.status = Profile.Status.ACTIVE
        self.p.save()
        rows = birthdays_today(self.member)
        if t.day <= 28:
            self.assertEqual(rows[0]["first_name"], "Ana")
            self.assertTrue(rows[0]["is_me"])
