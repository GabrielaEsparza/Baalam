from datetime import datetime, time, timedelta
from unittest import mock

from django.test import TestCase, override_settings
from django.utils import timezone

from apps.accounts.services import ServiceError
from apps.checkin import services as cs
from apps.checkin.models import CheckIn
from apps.common import today
from apps.memberships.tests.test_services import make_member, make_plans, pay
from apps.podium.models import PointsLedger
from apps.schedule.models import Booking, Schedule, Session
from apps.schedule.services import generate_sessions


@override_settings(QR_SECRET="test-secret")
class TokenTests(TestCase):
    def test_current_and_previous_window_valid(self):
        ts = 1_800_000_000.0
        tok = cs.current_qr_token(ts)
        self.assertTrue(cs.verify(token=tok["token"], ts=ts))
        self.assertTrue(cs.verify(token=tok["token"], ts=ts + 60))
        self.assertFalse(cs.verify(token=tok["token"], ts=ts + 120))
        self.assertTrue(cs.verify(code=tok["code"], ts=ts))
        self.assertEqual(len(tok["code"]), 6)

    def test_garbage_rejected(self):
        self.assertFalse(cs.verify(token="nope"))
        self.assertFalse(cs.verify(code="000000") and cs.verify(code="000001"))


class CheckinFlowTests(TestCase):
    def setUp(self):
        self.rutina, _ = make_plans()
        self.member = make_member()
        pay(self.member, self.rutina)
        start = (timezone.localtime() - timedelta(minutes=10)).time().replace(second=0, microsecond=0)
        self.sch = Schedule.objects.create(
            name="Piso", type="open_gym", weekdays=list(range(7)), start_time=start, duration_min=120
        )
        generate_sessions(today(), today())
        self.session = Session.objects.get(schedule=self.sch, date=today())
        self.token = cs.current_qr_token()["token"]

    def book(self):
        return Booking.objects.create(member=self.member, session=self.session, month=today().strftime("%Y-%m"))

    def test_requires_booking(self):
        with self.assertRaises(ServiceError) as e:
            cs.checkin(self.member, token=self.token)
        self.assertEqual(e.exception.code, "no_booking")

    def test_happy_path_marks_attended_and_awards_100(self):
        b = self.book()
        res = cs.checkin(self.member, token=self.token)
        b.refresh_from_db()
        self.assertEqual(b.status, "attended")
        self.assertEqual(res["points"], 100)
        self.assertEqual(PointsLedger.objects.filter(member=self.member).count(), 1)

    def test_one_per_day(self):
        self.book()
        cs.checkin(self.member, token=self.token)
        with self.assertRaises(ServiceError) as e:
            cs.checkin(self.member, token=self.token)
        self.assertEqual(e.exception.code, "already")

    def test_no_reservation_needed_when_switch_off(self):
        self.sch.requires_reservation = False
        self.sch.save()
        cs.checkin(self.member, token=self.token)
        self.assertEqual(CheckIn.objects.count(), 1)

    def test_bad_token(self):
        self.book()
        with self.assertRaises(ServiceError):
            cs.checkin(self.member, token="0" * 32)

    def test_expired_membership_blocked_but_grace_allowed(self):
        self.book()
        from apps.memberships.models import GymSettings

        s = GymSettings.load()
        s.grace_days = 3
        s.save()
        m = self.member.memberships.first()
        m.end_date = today() - timedelta(days=2)
        m.save()
        res = cs.checkin(self.member, token=self.token)
        self.assertIsNotNone(res["warning"])

    def test_expired_after_grace_blocked(self):
        self.book()
        m = self.member.memberships.first()
        m.end_date = today() - timedelta(days=10)
        m.save()
        with self.assertRaises(ServiceError) as e:
            cs.checkin(self.member, token=self.token)
        self.assertEqual(e.exception.code, "no_access")

    def test_too_early_says_when_it_opens(self):
        from apps.memberships.models import GymSettings

        if (timezone.localtime() + timedelta(hours=2)).date() != timezone.localtime().date():
            self.skipTest("cerca de medianoche: la clase 'de dentro de 2 h' caería mañana")
        later = Schedule.objects.create(
            name="Clase de la noche", type="open_gym", weekdays=list(range(7)),
            start_time=(timezone.localtime() + timedelta(hours=2)).time().replace(second=0, microsecond=0),
        )
        generate_sessions(today(), today())
        s = Session.objects.get(schedule=later, date=today())
        if s.date != today() or s.start_at.date() != timezone.localtime().date():
            self.skipTest("cerca de medianoche")
        Booking.objects.create(member=self.member, session=s, month=today().strftime("%Y-%m"))
        with self.assertRaises(ServiceError) as e:
            cs.checkin(self.member, token=self.token)
        self.assertEqual(e.exception.code, "too_early")
        opens = timezone.localtime(s.start_at - timedelta(minutes=GymSettings.load().checkin_early_min))
        self.assertIn(opens.strftime("%H:%M"), e.exception.message)

    def test_too_late_after_class_ended(self):
        ended = Schedule.objects.create(
            name="Temprano", type="open_gym", weekdays=list(range(7)),
            start_time=(timezone.localtime() - timedelta(hours=3)).time().replace(second=0, microsecond=0), duration_min=60,
        )
        generate_sessions(today(), today())
        s = Session.objects.get(schedule=ended, date=today())
        if s.start_at > timezone.localtime():
            self.skipTest("cerca de medianoche")
        Booking.objects.create(member=self.member, session=s, month=today().strftime("%Y-%m"))
        with self.assertRaises(ServiceError) as e:
            cs.checkin(self.member, token=self.token)
        self.assertEqual(e.exception.code, "too_late")

    def test_result_includes_class_and_live_status(self):
        self.book()
        res = cs.checkin(self.member, token=self.token)
        self.assertEqual(res["session"]["name"], "Piso")
        live = cs.live_status()
        self.assertEqual(live["open_sessions"][0]["attended"], 1)
        self.assertEqual(live["recent"][0]["name"], "Ana Pérez")

    def test_manual_checkin_marks_todays_booking(self):
        b = self.book()
        cs.checkin(self.member, source="manual", manual_by=self.member)
        b.refresh_from_db()
        self.assertEqual(b.status, "attended")

    def test_manual_checkin_skips_token_and_booking(self):
        cs.checkin(self.member, source="manual", manual_by=self.member)
        self.assertEqual(CheckIn.objects.get().source, "manual")
