from django.test import TestCase

from apps.memberships.tests.test_services import make_member
from apps.training import services as ts
from apps.training.models import Exercise


class SupersetAndRepRangeTests(TestCase):
    def setUp(self):
        self.m = make_member("ss@t.mx")
        self.a, self.b, self.c = (Exercise.objects.create(name_es=n) for n in ("Sentadilla", "Lagartija", "Plancha"))

    def test_normalize_groups(self):
        n = ts.normalize_groups
        self.assertEqual(n(["x", "x", "", "y", "y", "y"]), ["A", "A", "", "B", "B", "B"])
        self.assertEqual(n(["x", "", "x"]), ["", "", ""])  # no seguidos: no es superserie
        self.assertEqual(n(["z", "z", "z2"]), ["A", "A", ""])  # marca suelta se borra
        self.assertEqual(n([]), [])

    def test_save_day_keeps_groups_ranges_and_zero_rest(self):
        items = [
            {"exercise_id": self.a.id, "sets": 3, "reps": 8, "reps_max": 10, "rest_s": 0, "superset_group": "q"},
            {"exercise_id": self.b.id, "sets": 3, "reps": 12, "reps_max": 12, "rest_s": 90, "superset_group": "q"},
            {"exercise_id": self.c.id, "sets": 2, "duration_s": 30, "reps_max": 9, "rest_s": 60},
        ]
        day = ts.save_day(self.m, 0, label="Día A", focus="", items=items)
        got = [(i["superset_group"], i["reps"], i["reps_max"], i["rest_s"]) for i in day["items"]]
        self.assertEqual(got, [("A", 8, 10, 0), ("A", 12, None, 90), ("", None, None, 60)])

        # Copiar a otro día conserva superserie y rango
        copied = ts.copy_day(self.m, 0, 2)
        self.assertEqual([(i["superset_group"], i["reps_max"]) for i in copied["items"]], [("A", 10), ("A", None), ("", None)])
