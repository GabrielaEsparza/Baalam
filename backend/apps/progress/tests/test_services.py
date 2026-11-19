from decimal import Decimal

from django.test import TestCase

from apps.accounts.services import ServiceError
from apps.memberships.tests.test_services import make_member
from apps.progress import services as ps
from apps.progress.models import BodyLog


class BodyLogTests(TestCase):
    def test_same_day_merges_without_erasing(self):
        m = make_member()
        ps.log_body(m, weight_kg=Decimal("80"))
        ps.log_body(m, waist_cm=Decimal("85"), hip_cm=Decimal("98"))
        ps.log_body(m, water_pct=Decimal("55"), muscle_pct=Decimal("38"), body_fat_pct=Decimal("22"))
        log = BodyLog.objects.get(member=m)
        self.assertEqual((log.weight_kg, log.waist_cm, log.water_pct, log.muscle_pct), (80, 85, 55, 38))

    def test_empty_rejected(self):
        with self.assertRaises(ServiceError):
            ps.log_body(make_member())
