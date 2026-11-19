from datetime import timedelta
from decimal import Decimal

from django.test import TestCase

from apps.accounts.services import ServiceError
from apps.common import add_months, today
from apps.memberships import services as ms
from apps.memberships.models import Payment
from apps.memberships.tests.test_services import make_member, make_plans


class PaymentDateTests(TestCase):
    def setUp(self):
        self.rutina, self.clases = make_plans()
        self.member = make_member()

    def pay(self, plan, on=None):
        return ms.register_payment(
            member=self.member, plan=plan, amount_mxn=Decimal("600"), method="cash", registered_by=None, paid_at=on
        )

    def test_forgotten_payment_starts_on_paid_date(self):
        paid = today() - timedelta(days=10)
        self.pay(self.rutina, paid)
        m = ms.current_membership(self.member)
        self.assertEqual(m.start_date, paid)
        self.assertEqual(m.end_date, add_months(paid, 1))
        self.assertEqual(Payment.objects.get().paid_at, paid)

    def test_renewal_paid_while_active_extends_from_end(self):
        first = today() - timedelta(days=40)
        self.pay(self.rutina, first)
        old_end = ms.current_membership(self.member).end_date  # venció hace ~10 días
        # Pagó a tiempo (antes de vencer) pero se registró hoy
        self.pay(self.rutina, old_end - timedelta(days=1))
        m = ms.current_membership(self.member)
        self.assertEqual(m.end_date, add_months(old_end, 1))

    def test_future_or_too_old_date_rejected(self):
        with self.assertRaises(ServiceError):
            self.pay(self.rutina, today() + timedelta(days=1))
        with self.assertRaises(ServiceError):
            self.pay(self.rutina, today() - timedelta(days=ms.MAX_BACKDATE_DAYS + 1))


class CorrectionTests(TestCase):
    def setUp(self):
        rutina, _ = make_plans()
        self.member = make_member()
        ms.register_payment(member=self.member, plan=rutina, amount_mxn=Decimal("600"), method="cash", registered_by=None)
        self.m = ms.current_membership(self.member)

    def test_remove_blocks_immediately_without_grace(self):
        ms.remove_membership(self.m)
        self.assertEqual(ms.display_status(ms.current_membership(self.member)), "expired")
        self.assertFalse(ms.has_access(ms.display_status(self.m)))

    def test_correct_dates_and_reactivate(self):
        ms.remove_membership(self.m)
        start = today() - timedelta(days=3)
        ms.correct_dates(self.m, start_date=start, end_date=start + timedelta(days=30))
        self.m.refresh_from_db()
        self.assertEqual(self.m.start_date, start)
        self.assertTrue(ms.has_access(ms.display_status(self.m)))
        with self.assertRaises(ServiceError):
            ms.correct_dates(self.m, start_date=start, end_date=start - timedelta(days=1))

    def test_delete_payment_keeps_dates(self):
        end = self.m.end_date
        ms.delete_payment(Payment.objects.get().id)
        self.assertFalse(Payment.objects.exists())
        self.m.refresh_from_db()
        self.assertEqual(self.m.end_date, end)
