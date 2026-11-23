from datetime import date, datetime, time, timedelta
from unittest import mock

from django.test import TestCase, override_settings

from apps.common import now, today
from apps.memberships.tests.test_services import make_member, make_plans, pay
from apps.progress.models import BodyLog
from apps.reminders import services as rs
from apps.reminders.models import PushSubscription, SentReminder
from apps.training import services as ts
from apps.training.models import Exercise


def at_hour(h, m=5):
    n = now()
    return n.replace(hour=h, minute=m, second=0, microsecond=0)


@override_settings(VAPID_PUBLIC_KEY="pub", VAPID_PRIVATE_KEY="priv")
class RemindersTests(TestCase):
    def setUp(self):
        rutina, _ = make_plans()
        self.m = make_member("avisos@t.mx")
        pay(self.m, rutina)
        PushSubscription.objects.create(user=self.m, endpoint="https://push.example/1", p256dh="k", auth="a")
        self.sent = []
        p = mock.patch.object(rs, "send", side_effect=lambda user, **msg: self.sent.append(msg) or 1)
        p.start()
        self.addCleanup(p.stop)

    def kinds(self, at):
        self.sent.clear()
        rs.run_due(at)
        return sorted(m["tag"].split("-")[0] for m in self.sent)

    def test_water_every_two_hours_until_goal_and_never_twice(self):
        BodyLog.objects.create(member=self.m, date=today(), weight_kg=80)  # meta 2,750 ml
        self.assertEqual(rs.water_today(self.m)["goal_ml"], 2750)
        self.assertIn("water", self.kinds(at_hour(12)))
        self.assertNotIn("water", self.kinds(at_hour(12, 25)))  # mismo turno: no se repite
        self.assertNotIn("water", self.kinds(at_hour(9)))  # antes de las 10 no
        rs.add_water(self.m, 2000)
        rs.add_water(self.m, 1000)
        self.assertNotIn("water", self.kinds(at_hour(14)))  # ya llegó a la meta

    def test_workout_only_if_not_registered_at_chosen_hour(self):
        ex = Exercise.objects.create(name_es="Sentadilla")
        ts.save_day(self.m, today().weekday(), label="Día A", focus="", items=[{"exercise_id": ex.id, "sets": 3, "reps": 10}])
        rs.update_prefs(self.m, workout_hour=18)
        self.assertNotIn("workout", self.kinds(at_hour(17)))
        self.assertIn("workout", self.kinds(at_hour(18)))
        self.assertNotIn("workout", self.kinds(at_hour(19)))  # ya se mandó hoy

    def test_measures_after_a_month_and_home_flag(self):
        BodyLog.objects.create(member=self.m, date=today() - timedelta(days=10), weight_kg=70)
        self.assertIsNone(rs.measures_due(self.m))
        self.assertNotIn("measures", self.kinds(at_hour(10)))
        BodyLog.objects.all().update(date=today() - timedelta(days=31))
        self.assertEqual(rs.measures_due(self.m), 31)
        self.assertIn("measures", self.kinds(at_hour(10)))
        self.assertNotIn("measures", self.kinds(at_hour(11)))
        self.client.force_login(self.m)
        self.assertEqual(self.client.get("/api/home").json()["measures_due_days"], 31)

    def test_prefs_turn_off_and_no_push_without_device(self):
        rs.update_prefs(self.m, water=False, measures=False)
        self.assertEqual(self.kinds(at_hour(12)), [])
        PushSubscription.objects.all().delete()
        rs.update_prefs(self.m, water=True)
        self.assertEqual(self.kinds(at_hour(14)), [])
        self.assertFalse(SentReminder.objects.filter(kind="water", ref__endswith=":14").exists())

    def test_water_api_and_validation(self):
        self.client.force_login(self.m)
        r = self.client.post("/api/water", {"delta_ml": 250}, content_type="application/json").json()
        self.assertEqual(r["ml"], 250)
        r = self.client.post("/api/water", {"delta_ml": -1000}, content_type="application/json").json()
        self.assertEqual(r["ml"], 0)  # nunca negativo
        self.assertEqual(self.client.post("/api/water", {"delta_ml": 9000}, content_type="application/json").status_code, 400)
        r = self.client.put("/api/me/reminders", {"water_goal_ml": 3000}, content_type="application/json").json()
        self.assertEqual(r["water_goal_ml"], 3000)
        r = self.client.put("/api/me/reminders", {"water_goal_auto": True}, content_type="application/json").json()
        self.assertIsNone(r["water_goal_ml"])

    def test_subscribe_api(self):
        self.client.force_login(self.m)
        body = {"endpoint": "https://push.example/2", "p256dh": "k", "auth": "a"}
        self.assertEqual(self.client.post("/api/push/subscriptions", body, content_type="application/json").json()["devices"], 2)
        self.client.delete("/api/push/subscriptions", {"endpoint": "https://push.example/2"}, content_type="application/json")
        self.assertEqual(PushSubscription.objects.filter(user=self.m).count(), 1)
