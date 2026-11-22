from datetime import date
from types import SimpleNamespace as NS

from django.test import TestCase

from apps.memberships.tests.test_services import make_member
from apps.progress.models import BodyLog
from apps.training import services as ts

STRENGTH = NS(equipment="dumbbell", muscle_group="upper arms", name_es="Curl de bíceps", name_en="dumbbell curl")


def item(ex, sets=3, rest=90, group="", order=0, duration=None, exercise=STRENGTH):
    return NS(exercise_id=ex, sets=sets, rest_s=rest, superset_group=group, order=order, id=ex, duration_s=duration, exercise=exercise)


def sets_for(items, reps=None):
    return [NS(exercise_id=i.exercise_id, reps=reps) for i in items for _ in range(i.sets)]


class KcalEstimateTests(TestCase):
    def setUp(self):
        self.m = make_member("kcal@t.mx")

    def weigh(self, kg):
        BodyLog.objects.create(member=self.m, date=date(2026, 1, 1), weight_kg=kg)

    def test_no_weight_no_kcal(self):
        items = [item(1)]
        self.assertEqual(ts.estimate_kcal(self.m, items, sets_for(items), 10)["kcal"], 0)

    def test_strength_conservative(self):
        self.weigh(80)
        items = [item(1, order=0), item(2, order=1)]  # 6 series, 90 s de descanso → MET 3.5
        r = ts.estimate_kcal(self.m, items, sets_for(items), real_minutes=13)
        # 3.5 × 80 kg × (13/60 h) × 0.7 ≈ 42 → 40
        self.assertEqual((r["kcal"], r["met"]), (40, 3.5))

    def test_time_is_capped(self):
        self.weigh(70)
        items = [item(1, rest=60)]  # 3 series → ~5 min planeados, MET 5
        r = ts.estimate_kcal(self.m, items, sets_for(items), real_minutes=300)  # olvidó terminar
        self.assertLessEqual(r["kcal"], round(5.0 * 70 * (5 * 1.5 / 60) * 0.7) + 5)

    def test_supersets_are_more_intense(self):
        self.weigh(70)
        items = [item(1, rest=0, group="A", order=0), item(2, rest=60, group="A", order=1)]
        self.assertEqual(ts.estimate_kcal(self.m, items, sets_for(items), 10)["met"], 6.0)

    def test_cardio_uses_its_own_met_and_time(self):
        self.weigh(83)
        bike = NS(equipment="stationary bike", muscle_group="cardio", name_es="Bici fija", name_en="stationary bike walk")
        self.assertEqual(ts.cardio_met(bike), 7.0)
        self.assertEqual(ts.cardio_met(NS(equipment="", muscle_group="", name_es="Spinning", name_en="")), 8.5)
        self.assertIsNone(ts.cardio_met(NS(equipment="cable", muscle_group="back", name_es="Remo con cable", name_en="cable row")))
        items = [item(9, sets=1, duration=50 * 60, exercise=bike)]
        r = ts.estimate_kcal(self.m, items, sets_for(items, reps=50 * 60), real_minutes=52)
        # 7 × 83 × (50/60) × 0.7 ≈ 339 → 340
        self.assertEqual(r["kcal"], 340)
