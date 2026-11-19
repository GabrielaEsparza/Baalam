from django.test import TestCase

from apps.common import month_key, today
from apps.memberships.tests.test_services import make_member
from apps.podium import services as ps
from apps.podium.models import PointsLedger

R = PointsLedger.Reason


class PodiumTests(TestCase):
    def setUp(self):
        self.a = make_member("a@t.mx")
        self.b = make_member("b@t.mx")

    def test_checkin_once_per_day(self):
        self.assertIsNotNone(ps.award(self.a, R.CHECKIN))
        self.assertIsNone(ps.award(self.a, R.CHECKIN))

    def test_pr_limit_three_per_day(self):
        results = [ps.award(self.a, R.PR, ref=f"pr{i}") for i in range(5)]
        self.assertEqual(sum(1 for r in results if r), 3)

    def test_ranking_and_tiebreak_by_checkins(self):
        from apps.checkin.models import CheckIn
        from apps.common import now

        ps.award(self.a, R.MANUAL, points=100, note="x")
        ps.award(self.b, R.MANUAL, points=100, note="x")
        CheckIn.objects.create(member=self.b, at=now(), date=today(), source="manual")
        r = ps.ranking(month_key(today()))
        self.assertEqual([x["member_id"] for x in r], [self.b.id, self.a.id])
        self.assertEqual(r[0]["position"], 1)

    def test_hidden_from_podium(self):
        ps.award(self.a, R.MANUAL, points=10, note="x")
        self.a.profile.show_in_podium = False
        self.a.profile.save()
        self.assertEqual(ps.ranking(), [])

    def test_manual_requires_reason(self):
        with self.assertRaises(ValueError):
            ps.award(self.a, R.MANUAL, points=10)
