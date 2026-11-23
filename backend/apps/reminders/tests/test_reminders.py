from contextlib import ExitStack
from datetime import date, datetime, time, timedelta
from unittest import mock

from django.test import TestCase, override_settings
from django.utils import timezone

from apps.checkin.models import CheckIn
from apps.memberships.tests.test_services import make_member, make_plans, pay
from apps.nutrition.models import FoodLog
from apps.progress.models import BodyLog
from apps.reminders import services as rs
from apps.reminders.models import PushSubscription, SentReminder
from apps.schedule.models import Booking, Schedule, Session
from apps.training import services as ts
from apps.training.models import Exercise

FRIDAY = date(2026, 11, 20)
SATURDAY = date(2026, 11, 21)


def at(d, h, m=5):
    return timezone.make_aware(datetime.combine(d, time(h, m)))


@override_settings(VAPID_PUBLIC_KEY="pub", VAPID_PRIVATE_KEY="priv")
class RemindersTests(TestCase):
    def setUp(self):
        self.rutina, _ = make_plans()
        self.m = make_member("avisos@t.mx")
        pay(self.m, self.rutina)
        PushSubscription.objects.create(user=self.m, endpoint="https://push.example/1", p256dh="k", auth="a")
        self.sent = []
        p = mock.patch.object(rs, "send", side_effect=lambda user, **msg: self.sent.append(msg) or 1)
        p.start()
        self.addCleanup(p.stop)

    def kinds(self, when):
        """Corre los avisos como si fuera `when` (fecha y hora)."""
        self.sent.clear()
        with ExitStack() as st:
            for mod in (rs, ts):
                st.enter_context(mock.patch.object(mod, "today", return_value=when.date()))
            rs.run_due(when)
        return sorted(m["tag"] for m in self.sent)

    def weigh(self, d=FRIDAY, kg=80):
        BodyLog.objects.create(member=self.m, date=d, weight_kg=kg)

    def test_water_every_two_hours_until_goal_also_weekends(self):
        self.weigh()
        self.assertIn("water", self.kinds(at(FRIDAY, 12)))
        self.assertNotIn("water", self.kinds(at(FRIDAY, 12, 25)))  # mismo turno: no se repite
        self.assertNotIn("water", self.kinds(at(FRIDAY, 9)))  # antes de las 10 no
        self.assertIn("water", self.kinds(at(SATURDAY, 12)))  # agua sí en fin de semana
        with mock.patch.object(rs, "today", return_value=FRIDAY):
            rs.add_water(self.m, 2000)
            rs.add_water(self.m, 1000)
        self.assertNotIn("water", self.kinds(at(FRIDAY, 14)))  # ya llegó a la meta

    def test_workout_only_gym_days_with_routine(self):
        self.weigh()
        ex = Exercise.objects.create(name_es="Sentadilla")
        for d in (FRIDAY, SATURDAY):
            ts.save_day(self.m, d.weekday(), label="Día A", focus="", items=[{"exercise_id": ex.id, "sets": 3, "reps": 10}])
        rs.update_prefs(self.m, workout_hour=18)
        self.assertNotIn("workout", self.kinds(at(FRIDAY, 17)))
        self.assertIn("workout", self.kinds(at(FRIDAY, 18)))
        self.assertNotIn("workout", self.kinds(at(FRIDAY, 19)))  # ya se mandó hoy
        self.assertNotIn("workout", self.kinds(at(SATURDAY, 18)))  # sábado el gym no abre
        self.assertNotIn("workout", self.kinds(at(FRIDAY + timedelta(days=3), 18)))  # lunes sin rutina = descanso

    def test_measures_daily_if_never_then_monthly(self):
        self.assertIn("measures", self.kinds(at(FRIDAY, 10)))
        self.assertIn("measures", self.kinds(at(SATURDAY, 10)))  # todos los días mientras no registre
        self.weigh(FRIDAY - timedelta(days=10))
        self.assertNotIn("measures", self.kinds(at(FRIDAY + timedelta(days=1), 11)))
        BodyLog.objects.all().update(date=FRIDAY - timedelta(days=31))
        self.assertIn("measures", self.kinds(at(FRIDAY + timedelta(days=7), 10)))
        self.assertNotIn("measures", self.kinds(at(FRIDAY + timedelta(days=7), 11)))

    def test_food_reminders(self):
        self.weigh()
        self.assertIn("food", self.kinds(at(FRIDAY, 15)))
        FoodLog.objects.create(member=self.m, date=FRIDAY, meal="dinner", food_name="Cena", amount=1, kcal=500)
        self.assertNotIn("food", self.kinds(at(FRIDAY, 21)))  # ya registró la cena
        rs.update_prefs(self.m, food=False)
        self.assertNotIn("food", self.kinds(at(SATURDAY, 15)))

    def test_friday_catchup_only_if_missing_days_and_spots(self):
        self.weigh()
        sch = Schedule.objects.create(name="Piso libre", type=Schedule.Type.OPEN_GYM, weekdays=[4], start_time=time(18), capacity=1)
        s = Session.objects.create(schedule=sch, date=FRIDAY, start_at=at(FRIDAY, 18, 0), end_at=at(FRIDAY, 19, 0), capacity=1)
        self.assertIn("catchup", self.kinds(at(FRIDAY, 8)))
        self.assertNotIn("catchup", self.kinds(at(FRIDAY, 9)))  # una vez por semana
        self.assertNotIn("catchup", self.kinds(at(FRIDAY - timedelta(days=1), 8)))  # solo viernes

        # Sin lugar: no llega
        SentReminder.objects.filter(kind="catchup").delete()
        other = make_member("otro@t.mx")
        Booking.objects.create(member=other, session=s, month="2026-11")
        self.assertNotIn("catchup", self.kinds(at(FRIDAY, 8)))

        # Ya fue los días que le tocan: no llega
        Booking.objects.all().delete()
        from apps.memberships.services import current_membership

        for k in range(current_membership(self.m).sessions_per_week):
            CheckIn.objects.create(member=self.m, date=FRIDAY - timedelta(days=k), at=at(FRIDAY - timedelta(days=k), 7), source="qr")
        self.assertNotIn("catchup", self.kinds(at(FRIDAY, 8)))

    def test_prefs_turn_off_and_no_push_without_device(self):
        rs.update_prefs(self.m, water=False, measures=False, food=False)
        self.assertEqual(self.kinds(at(FRIDAY, 12)), [])
        PushSubscription.objects.all().delete()
        rs.update_prefs(self.m, water=True)
        self.assertEqual(self.kinds(at(FRIDAY, 14)), [])
        self.assertFalse(SentReminder.objects.filter(kind="water").exists())

    def test_home_flags(self):
        self.client.force_login(self.m)
        h = self.client.get("/api/home").json()
        self.assertTrue(h["measures_never"])
        self.assertIsNone(h["measures_due_days"])

    def test_water_api_and_validation(self):
        self.client.force_login(self.m)
        r = self.client.post("/api/water", {"delta_ml": 250}, content_type="application/json").json()
        self.assertEqual(r["ml"], 250)
        r = self.client.post("/api/water", {"delta_ml": -1000}, content_type="application/json").json()
        self.assertEqual(r["ml"], 0)  # nunca negativo
        self.assertEqual(self.client.post("/api/water", {"delta_ml": 9000}, content_type="application/json").status_code, 400)
        r = self.client.put("/api/me/reminders", {"water_goal_ml": 3000, "food": False}, content_type="application/json").json()
        self.assertEqual((r["water_goal_ml"], r["food"]), (3000, False))
        r = self.client.put("/api/me/reminders", {"water_goal_auto": True}, content_type="application/json").json()
        self.assertIsNone(r["water_goal_ml"])

    def test_subscribe_api(self):
        self.client.force_login(self.m)
        body = {"endpoint": "https://push.example/2", "p256dh": "k", "auth": "a"}
        self.assertEqual(self.client.post("/api/push/subscriptions", body, content_type="application/json").json()["devices"], 2)
        self.client.delete("/api/push/subscriptions", {"endpoint": "https://push.example/2"}, content_type="application/json")
        self.assertEqual(PushSubscription.objects.filter(user=self.m).count(), 1)
