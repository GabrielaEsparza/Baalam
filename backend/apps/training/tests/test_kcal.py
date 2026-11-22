from datetime import date
from types import SimpleNamespace as NS

from django.test import TestCase

from apps.memberships.tests.test_services import make_member
from apps.progress.models import BodyLog
from apps.training import services as ts


def item(ex, sets=3, rest=90, group="", order=0, duration=None):
    return NS(exercise_id=ex, sets=sets, rest_s=rest, superset_group=group, order=order, id=ex, duration_s=duration)


def sets_for(items):
    return [NS(exercise_id=i.exercise_id) for i in items for _ in range(i.sets)]


class KcalEstimateTests(TestCase):
    def setUp(self):
        self.m = make_member("kcal@t.mx")

    def test_conservative_with_registered_weight(self):
        BodyLog.objects.create(member=self.m, date=date(2026, 1, 1), weight_kg=80)
        items = [item(1, order=0), item(2, order=1)]  # 6 series, 90 s de descanso → MET 3.5
        r = ts.estimate_kcal(self.m, items, sets_for(items), real_minutes=13)
        # 3.5 × 80 kg × (13/60 h) × 0.7 ≈ 42 → 40
        self.assertEqual((r["kcal"], r["met"], r["weight_kg"], r["weight_assumed"]), (40, 3.5, 80.0, False))

    def test_default_weight_and_time_is_capped(self):
        items = [item(1, rest=60)]  # 3 series → ~5 min planeados, MET 5
        r = ts.estimate_kcal(self.m, items, sets_for(items), real_minutes=300)  # olvidó terminar
        self.assertTrue(r["weight_assumed"])
        self.assertLessEqual(r["kcal"], round(5.0 * 70 * (5 * 1.5 / 60) * 0.7) + 5)
        quick = ts.estimate_kcal(self.m, items, sets_for(items), real_minutes=0.2)  # marcó todo de golpe
        self.assertGreater(quick["kcal"], 0)

    def test_supersets_are_more_intense(self):
        items = [item(1, rest=0, group="A", order=0), item(2, rest=60, group="A", order=1)]
        r = ts.estimate_kcal(self.m, items, sets_for(items), real_minutes=10)
        self.assertEqual(r["met"], 6.0)
        self.assertEqual(ts.estimate_kcal(self.m, items, [], 10)["kcal"], 0)
