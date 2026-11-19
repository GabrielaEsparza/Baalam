from datetime import timedelta
from decimal import Decimal
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase

from apps.accounts.services import ServiceError, register
from apps.common import add_months, today
from apps.memberships import services as ms
from apps.memberships.models import Membership, MembershipRequest, Plan

User = get_user_model()


def make_plans():
    rutina = Plan.objects.create(name="Plan Rutina", price_mxn=600, includes_routine=True, includes_open_gym=True)
    clases = Plan.objects.create(name="Plan Clases", price_mxn=300, includes_classes=True)
    return rutina, clases


def make_member(email="ana@test.mx"):
    return register(full_name="Ana Pérez", email=email, phone="5512345678", password="sentadilla-123")


def pay(member, plan, coach=None):
    return ms.register_payment(
        member=member, plan=plan, amount_mxn=plan.price_mxn, method="cash", registered_by=coach
    )


class RegisterPaymentTests(TestCase):
    def setUp(self):
        self.rutina, self.clases = make_plans()
        self.member = make_member()

    def test_register_creates_pending_with_signup_request(self):
        self.assertEqual(self.member.profile.status, "pending")
        self.assertTrue(MembershipRequest.objects.filter(member=self.member, type="signup", status="open").exists())

    def test_duplicate_email_rejected(self):
        with self.assertRaises(ServiceError):
            make_member()

    def test_first_payment_activates_from_today(self):
        pay(self.member, self.rutina)
        m = ms.current_membership(self.member)
        self.assertEqual(m.start_date, today())
        self.assertEqual(m.end_date, add_months(today(), 1))
        self.member.profile.refresh_from_db()
        self.assertEqual(self.member.profile.status, "active")
        self.assertFalse(MembershipRequest.objects.filter(member=self.member, status="open").exists())

    def test_renewal_extends_from_previous_end(self):
        pay(self.member, self.rutina)
        end1 = ms.current_membership(self.member).end_date
        pay(self.member, self.rutina)
        self.assertEqual(ms.current_membership(self.member).end_date, add_months(end1, 1))
        self.assertEqual(Membership.objects.filter(member=self.member).count(), 1)

    def test_expired_restarts_from_today(self):
        pay(self.member, self.rutina)
        m = ms.current_membership(self.member)
        m.start_date, m.end_date = today() - timedelta(days=60), today() - timedelta(days=20)
        m.save()
        pay(self.member, self.rutina)
        self.assertEqual(ms.current_membership(self.member).end_date, add_months(today(), 1))

    def test_plan_change_creates_new_membership(self):
        pay(self.member, self.rutina)
        pay(self.member, self.clases)
        self.assertEqual(ms.current_membership(self.member).plan, self.clases)
        self.assertEqual(Membership.objects.filter(member=self.member).count(), 2)


class DisplayStatusTests(TestCase):
    def setUp(self):
        self.rutina, _ = make_plans()
        self.member = make_member()
        pay(self.member, self.rutina)
        self.m = ms.current_membership(self.member)

    def at(self, days_from_end):
        return ms.display_status(self.m, on=self.m.end_date + timedelta(days=days_from_end))

    def test_states(self):
        # Por defecto: aviso 7 días antes y 3 de gracia.
        self.assertEqual(self.at(-10), "active")
        self.assertEqual(self.at(-7), "expiring")
        self.assertEqual(self.at(0), "expiring")
        self.assertEqual(self.at(1), "grace")
        self.assertEqual(self.at(3), "grace")
        self.assertEqual(self.at(4), "expired")
        self.assertEqual(ms.blocked_on(self.m), self.m.end_date + timedelta(days=4))

    def test_states_with_grace_configured(self):
        from apps.memberships.models import GymSettings

        s = GymSettings.load()
        s.grace_days, s.expiring_days = 3, 5
        s.save()
        self.assertEqual(self.at(-6), "active")
        self.assertEqual(self.at(-5), "expiring")
        self.assertEqual(self.at(1), "grace")
        self.assertEqual(self.at(3), "grace")
        self.assertEqual(self.at(4), "expired")

    def test_member_cannot_request_plan_change(self):
        from apps.accounts.services import ServiceError

        _, clases = self.rutina, Plan.objects.get(name="Plan Clases")
        with self.assertRaises(ServiceError):
            ms.create_request(self.member, "plan_change", plan=clases)

    def test_pause_and_resume_keep_days(self):
        left = (self.m.end_date - today()).days
        ms.pause(self.m)
        self.assertEqual(ms.display_status(self.m), "paused")
        future = today() + timedelta(days=10)
        with mock.patch("apps.memberships.services.today", return_value=future):
            ms.resume(self.m)
        self.assertEqual(self.m.end_date, future + timedelta(days=left))

    def test_request_does_not_change_anything(self):
        end = self.m.end_date
        ms.create_request(self.member, "renewal")
        self.m.refresh_from_db()
        self.assertEqual(self.m.end_date, end)
        self.assertEqual(MembershipRequest.objects.filter(member=self.member, status="open").count(), 1)
