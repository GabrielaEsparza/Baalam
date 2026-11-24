from datetime import time, timedelta

from django.test import TestCase
from django.utils import timezone

from apps.accounts.services import ServiceError, delete_account, set_role
from apps.common import month_key, today
from apps.community import streaks
from apps.community.models import Buddy
from apps.memberships.tests.test_services import make_member, make_plans, pay
from apps.nutrition.models import FoodLog, NutritionGoal
from apps.reminders.models import SentReminder
from apps.schedule.models import Booking, Schedule, Session
from apps.schedule.services import generate_sessions
from apps.training.models import WorkoutSession


def eat(member, days_ago: int, kcal: float):
    FoodLog.objects.create(
        member=member, date=today() - timedelta(days=days_ago), meal="lunch", food_name="Comida", amount=1, kcal=kcal
    )


class IndividualStreakTests(TestCase):
    def setUp(self):
        self.rutina, _ = make_plans()
        self.m = make_member()
        pay(self.m, self.rutina)
        NutritionGoal.objects.create(member=self.m, kcal=2000)

    def test_kcal_streak_allows_10_percent_and_today_does_not_break(self):
        eat(self.m, 1, 2200)  # justo +10 %
        eat(self.m, 2, 1500)
        eat(self.m, 3, 2300)  # se pasó
        eat(self.m, 4, 1800)
        k = streaks.individual(self.m)["kcal"]
        self.assertEqual((k["days"], k["today_done"]), (2, False))
        eat(self.m, 0, 900)
        self.assertEqual(streaks.individual(self.m)["kcal"]["days"], 3)

    def test_training_streak_counts_booked_days_and_skips_rest_days(self):
        sch = Schedule.objects.create(name="Piso", type="open_gym", weekdays=list(range(7)), start_time=time(23, 0))
        t = today()
        generate_sessions(t - timedelta(days=6), t)
        for ago in (6, 4, 2):  # días con reserva; los demás son descanso
            s = Session.objects.get(schedule=sch, date=t - timedelta(days=ago))
            Booking.objects.create(member=self.m, session=s, month=month_key(s.date))
        for ago in (4, 2):
            WorkoutSession.objects.create(member=self.m, date=t - timedelta(days=ago), started_at=timezone.now())
        tr = streaks.individual(self.m)["training"]
        self.assertEqual(tr["days"], 2)  # el de hace 6 días no lo registró
        self.assertFalse(tr["today_is_training"])


class BuddyTests(TestCase):
    def setUp(self):
        rutina, _ = make_plans()
        self.a = make_member("gabriela@t.mx")
        self.b = make_member("sofia@t.mx")
        for u, g in ((self.a, "a"), (self.b, "o")):
            pay(u, rutina)
            u.profile.greeting = g
            u.profile.full_name = "Gabriela Ruiz" if u == self.a else "Sofío Torres"
            u.profile.status = "active"
            u.profile.save()

    def test_invite_accept_nudge_and_trained_notice(self):
        found = streaks.search(self.a, "sof")
        self.assertEqual([r["id"] for r in found], [self.b.id])
        inv = streaks.invite(self.a, self.b.id)
        self.assertEqual(streaks.overview(self.b)["invites_in"][0]["person"]["id"], self.a.id)
        with self.assertRaises(ServiceError):
            streaks.invite(self.a, self.b.id)  # ya la envió
        streaks.accept(self.b, inv["id"])
        ov = streaks.overview(self.a)
        self.assertEqual(ov["buddies"][0]["person"]["label"], "gym bro")
        self.assertEqual(streaks.label(self.a), "gym sis")

        streaks.nudge_kcal(self.a, inv["id"])
        with self.assertRaises(ServiceError):
            streaks.nudge_kcal(self.a, inv["id"])  # una vez al día
        streaks.notify_trained(self.a)
        streaks.notify_trained(self.a)
        self.assertEqual(SentReminder.objects.filter(user=self.b, kind="bud_train").count(), 1)

    def test_mutual_invite_accepts_and_more_than_one_buddy(self):
        c = make_member("tercera@t.mx")
        streaks.invite(self.b, self.a.id)
        streaks.invite(self.a, self.b.id)  # ya la había invitado: queda aceptada
        streaks.invite(self.a, c.id)
        ov = streaks.overview(self.a)
        self.assertEqual(len(ov["buddies"]), 1)
        self.assertEqual(len(ov["invites_out"]), 1)

    def test_pair_streak_needs_both_and_starts_when_accepted(self):
        inv = streaks.invite(self.a, self.b.id)
        streaks.accept(self.b, inv["id"])
        Buddy.objects.filter(id=inv["id"]).update(since=today() - timedelta(days=5))
        for days_ago in (1, 2, 3):
            eat(self.a, days_ago, 1000)
        for days_ago in (1, 2):
            eat(self.b, days_ago, 1000)
        s = streaks.overview(self.a)["buddies"][0]["streak"]
        self.assertEqual(s["days"], 2)
        eat(self.a, 0, 500)
        s = streaks.overview(self.a)["buddies"][0]["streak"]
        self.assertEqual((s["days"], s["me_today"], s["them_today"]), (2, True, False))

    def test_coaches_cannot_and_deleting_account_removes_links(self):
        coach = make_member("coach@t.mx")
        set_role(coach, "coach")
        with self.assertRaises(ServiceError):
            streaks.invite(coach, self.a.id)
        with self.assertRaises(ServiceError):
            streaks.invite(self.a, coach.id)
        streaks.invite(self.a, self.b.id)
        delete_account(self.b, "sentadilla-123")
        self.assertFalse(Buddy.objects.exists())
