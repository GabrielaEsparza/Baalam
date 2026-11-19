from datetime import date, datetime, time, timedelta
from unittest import mock

from django.test import TestCase
from django.utils import timezone

from apps.accounts.services import ServiceError
from apps.memberships.tests.test_services import make_member, make_plans, pay
from apps.schedule import services as ss
from apps.schedule.models import Booking, Schedule, Session, WaitlistEntry

# Fecha fija: lunes 2 de noviembre de 2026, 06:00 hora local.
FIXED_DAY = date(2026, 11, 2)


def fixed_now():
    return timezone.make_aware(datetime.combine(FIXED_DAY, time(6, 0)))


class FrozenTime(TestCase):
    """Congela today()/now() en todos los módulos que los usan."""

    def setUp(self):
        targets = [
            "apps.schedule.services",
            "apps.memberships.services",
        ]
        for t in targets:
            p1 = mock.patch(f"{t}.today", return_value=FIXED_DAY)
            p1.start()
            self.addCleanup(p1.stop)
        p2 = mock.patch("apps.schedule.services.now", side_effect=fixed_now)
        p2.start()
        self.addCleanup(p2.stop)
        p3 = mock.patch("apps.common.today", return_value=FIXED_DAY)
        p3.start()
        self.addCleanup(p3.stop)


class ScheduleBase(FrozenTime):
    def setUp(self):
        super().setUp()
        self.rutina, self.clases = make_plans()
        self.member = make_member()
        pay(self.member, self.rutina)
        m = self.member.memberships.first()
        m.start_date, m.end_date, m.sessions_per_week = FIXED_DAY, FIXED_DAY + timedelta(days=30), 3
        m.save()
        self.floor7 = Schedule.objects.create(
            name="Piso 7", type="open_gym", weekdays=[0, 1, 2, 3, 4], start_time=time(7), capacity=2
        )
        self.floor19 = Schedule.objects.create(
            name="Piso 19", type="open_gym", weekdays=[0, 1, 2, 3, 4], start_time=time(19), capacity=2
        )
        self.klass = Schedule.objects.create(
            name="Clase", type="class", weekdays=[0, 2, 4], start_time=time(7), capacity=10
        )

    def pattern(self, *wds, sch=None):
        return [{"weekday": wd, "schedule_id": (sch or self.floor7).id} for wd in wds]


class BookMonthTests(ScheduleBase):

    def test_books_every_matching_date_of_month(self):
        res = ss.book_month(self.member, "2026-11", self.pattern(0, 2, 4))
        # Noviembre 2026 desde el lunes 2: L(2,9,16,23,30)=5, X(4,11,18,25)=4, V(6,13,20,27)=4
        self.assertEqual(len(res["created"]), 13)
        self.assertEqual(res["conflicts"], [])

    def test_cannot_exceed_sessions_per_week(self):
        with self.assertRaises(ServiceError):
            ss.book_month(self.member, "2026-11", self.pattern(0, 1, 2, 3))

    def test_wrong_plan_type_rejected(self):
        with self.assertRaises(ServiceError):
            ss.book_month(self.member, "2026-11", self.pattern(0, sch=self.klass))

    def test_full_dates_come_back_as_conflicts(self):
        others = [make_member(f"o{i}@t.mx") for i in range(2)]
        for o in others:
            pay(o, self.rutina)
            ss.book_month(o, "2026-11", self.pattern(0))
        res = ss.book_month(self.member, "2026-11", self.pattern(0, 2))
        self.assertEqual(len(res["conflicts"]), 5)  # todos los lunes llenos
        self.assertEqual(len(res["created"]), 4)  # miércoles

    def test_next_month_opens_on_day_25(self):
        with self.assertRaises(ServiceError):
            ss.book_month(self.member, "2026-12", self.pattern(0))
        with mock.patch("apps.schedule.services.today", return_value=date(2026, 11, 25)):
            self.assertTrue(ss.booking_month_open("2026-12"))

    def test_no_access_without_membership(self):
        stranger = make_member("x@t.mx")
        with self.assertRaises(ServiceError):
            ss.book_month(stranger, "2026-11", self.pattern(0))


class ChangeBookingTests(ScheduleBase):
    def setUp(self):
        super().setUp()
        ss.book_month(self.member, "2026-11", self.pattern(2))  # miércoles 7:00
        self.wed = Booking.objects.get(member=self.member, session__date=date(2026, 11, 4))

    def session(self, sch, d):
        ss.generate_sessions(d, d)
        return Session.objects.get(schedule=sch, date=d)

    def test_change_same_week_with_room(self):
        target = self.session(self.floor19, date(2026, 11, 5))
        res = ss.change_booking(self.member, self.wed.id, target.id)
        self.assertEqual(res["status"], "changed")
        self.wed.refresh_from_db()
        self.assertEqual(self.wed.status, "moved")
        self.assertEqual(res["booking"].moved_from_id, self.wed.id)

    def test_cannot_change_to_other_week(self):
        target = self.session(self.floor19, date(2026, 11, 10))
        with self.assertRaises(ServiceError):
            ss.change_booking(self.member, self.wed.id, target.id)

    def test_cannot_change_less_than_2h_before(self):
        late = timezone.make_aware(datetime.combine(date(2026, 11, 4), time(5, 30)))
        target = self.session(self.floor19, date(2026, 11, 5))
        with mock.patch("apps.schedule.services.now", return_value=late):
            with self.assertRaises(ServiceError):
                ss.change_booking(self.member, self.wed.id, target.id)

    def test_full_target_goes_to_waitlist_and_keeps_spot(self):
        target = self.session(self.floor19, date(2026, 11, 5))
        blockers = []
        for i in range(2):
            o = make_member(f"b{i}@t.mx")
            pay(o, self.rutina)
            blockers.append(ss.book_single(o, target.id))
        res = ss.change_booking(self.member, self.wed.id, target.id)
        self.assertEqual(res["status"], "waitlisted")
        self.wed.refresh_from_db()
        self.assertEqual(self.wed.status, "booked")  # no pierde su lugar

        # Se libera un lugar -> el cambio se hace solo.
        ss.coach_cancel_booking(blockers[0].id)
        self.wed.refresh_from_db()
        self.assertEqual(self.wed.status, "moved")
        self.assertTrue(Booking.objects.filter(member=self.member, session=target, status="booked").exists())
        self.assertFalse(WaitlistEntry.objects.filter(member=self.member, active=True).exists())
