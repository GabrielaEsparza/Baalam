from django.test import TestCase

from apps.accounts.services import set_role
from apps.memberships.tests.test_services import make_member, make_plans, pay
from apps.training.models import Exercise


class SelfRoutineTests(TestCase):
    """La cuenta principal decide si un miembro puede armarse su propia rutina."""

    def setUp(self):
        rutina, self.clases = make_plans()
        self.m = make_member("ana@t.mx")
        pay(self.m, rutina)
        self.other = make_member("otro@t.mx")
        pay(self.other, rutina)
        self.owner = make_member("baalamgymmz@gmail.com")
        set_role(self.owner, "admin")
        self.coach = make_member("coach2@t.mx")
        set_role(self.coach, "coach")
        self.ex = Exercise.objects.create(name_es="Sentadilla", source="custom")

    def allow(self, who, value=True):
        self.client.force_login(who)
        return self.client.patch(
            f"/api/coach/members/{self.m.id}", {"self_routine": value}, content_type="application/json"
        )

    def put_day(self, member_id):
        return self.client.put(
            f"/api/coach/routines/{member_id}/days/0",
            {"label": "Día A", "focus": "", "items": [{"exercise_id": self.ex.id, "sets": 3, "reps": 10}]},
            content_type="application/json",
        )

    def test_member_needs_permission(self):
        self.client.force_login(self.m)
        self.assertFalse(self.client.get("/api/me").json()["features"]["self_routine"])
        self.assertEqual(self.client.get(f"/api/coach/routines/{self.m.id}").status_code, 403)
        self.assertEqual(self.put_day(self.m.id).status_code, 403)
        self.assertEqual(self.client.get("/api/coach/exercises").status_code, 403)

    def test_only_owner_can_allow(self):
        self.assertEqual(self.allow(self.coach).status_code, 403)
        r = self.allow(self.owner)
        self.assertEqual(r.status_code, 200, r.content)
        self.assertTrue(r.json()["self_routine"])

    def test_allowed_member_edits_only_own_routine(self):
        self.allow(self.owner)
        self.client.force_login(self.m)
        self.assertTrue(self.client.get("/api/me").json()["features"]["self_routine"])
        self.assertEqual(self.put_day(self.m.id).status_code, 200)
        self.assertEqual(self.client.get(f"/api/coach/routines/{self.m.id}").json()["days"]["0"]["label"], "Día A")
        self.assertEqual(self.client.get("/api/coach/exercises").status_code, 200)
        # No puede tocar la rutina de otra persona ni crear ejercicios propios del gym
        self.assertEqual(self.put_day(self.other.id).status_code, 403)
        self.assertEqual(self.client.post("/api/coach/exercises", {"name": "Mi ejercicio"}, content_type="application/json").status_code, 403)

    def test_classes_plan_never_gets_it(self):
        pay(self.m, self.clases)
        self.allow(self.owner)
        self.client.force_login(self.m)
        self.assertFalse(self.client.get("/api/me").json()["features"]["self_routine"])
