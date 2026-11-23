from datetime import date
from io import BytesIO

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from PIL import Image

from apps.accounts.services import set_role
from apps.checkin.models import CheckIn
from apps.memberships.models import Payment
from apps.memberships.tests.test_services import make_member, make_plans, pay
from apps.progress.models import BodyLog
from apps.reminders.models import WaterLog


def jpeg():
    buf = BytesIO()
    Image.new("RGB", (64, 64), "purple").save(buf, "JPEG")
    return SimpleUploadedFile("f.jpg", buf.getvalue(), content_type="image/jpeg")


class DeleteAccountTests(TestCase):
    def setUp(self):
        rutina, _ = make_plans()
        self.m = make_member("borrar@t.mx")
        pay(self.m, rutina)
        BodyLog.objects.create(member=self.m, date=date(2026, 1, 1), weight_kg=70)
        WaterLog.objects.create(member=self.m, date=date(2026, 1, 1), ml=500)
        self.client.force_login(self.m)

    def test_wrong_password_keeps_everything(self):
        r = self.client.post("/api/me/delete", {"password": "otra"}, content_type="application/json")
        self.assertEqual(r.status_code, 400)
        self.assertTrue(User.objects.get(id=self.m.id).is_active)

    def test_delete_wipes_personal_data_keeps_payments_anonymous(self):
        self.client.post("/api/me/avatar", {"file": jpeg()})
        r = self.client.post("/api/me/delete", {"password": "sentadilla-123"}, content_type="application/json")
        self.assertEqual(r.status_code, 200, r.content)
        u = User.objects.get(id=self.m.id)
        self.assertFalse(u.is_active)
        self.assertNotIn("borrar", u.username)
        self.assertEqual(u.email, "")
        self.assertEqual(u.profile.full_name, "Cuenta eliminada")
        self.assertEqual(u.profile.phone, "")
        self.assertFalse(u.profile.avatar)
        self.assertFalse(BodyLog.objects.filter(member=u).exists())
        self.assertFalse(WaterLog.objects.filter(member=u).exists())
        self.assertTrue(Payment.objects.filter(member=u).exists())  # contabilidad del gym
        # Ya no puede entrar y el correo queda libre para registrarse de nuevo
        self.assertEqual(self.client.get("/api/me").status_code, 401)
        r = self.client.post("/api/auth/login", {"email": "borrar@t.mx", "password": "sentadilla-123"}, content_type="application/json")
        self.assertNotEqual(r.status_code, 200)
        make_member("borrar@t.mx")

    def test_coach_cannot_delete_from_app(self):
        set_role(self.m, "coach")
        r = self.client.post("/api/me/delete", {"password": "sentadilla-123"}, content_type="application/json")
        self.assertEqual(r.status_code, 403)


class CoachDeleteMemberTests(TestCase):
    def setUp(self):
        rutina, _ = make_plans()
        self.m = make_member("miembro@t.mx")
        pay(self.m, rutina)
        self.coach = make_member("coach@t.mx")
        set_role(self.coach, "coach")
        self.client.force_login(self.coach)

    def test_requires_typing_eliminar(self):
        r = self.client.post(f"/api/coach/members/{self.m.id}/delete", {"confirm": "si"}, content_type="application/json")
        self.assertEqual(r.status_code, 400)
        self.assertTrue(User.objects.get(id=self.m.id).is_active)

    def test_coach_deletes_member_without_password_keeps_payments(self):
        r = self.client.post(f"/api/coach/members/{self.m.id}/delete", {"confirm": "eliminar"}, content_type="application/json")
        self.assertEqual(r.status_code, 200, r.content)
        u = User.objects.get(id=self.m.id)
        self.assertFalse(u.is_active)
        self.assertEqual(u.profile.full_name, "Cuenta eliminada")
        self.assertTrue(Payment.objects.filter(member=u).exists())
        ids = [r["id"] for r in self.client.get("/api/coach/members").json()]
        self.assertNotIn(self.m.id, ids)  # ya no aparece en la lista
        again = self.client.post(f"/api/coach/members/{self.m.id}/delete", {"confirm": "ELIMINAR"}, content_type="application/json")
        self.assertEqual(again.status_code, 400)

    def test_cannot_delete_coaches_or_self_and_members_cannot_use_it(self):
        other_coach = make_member("coach2@t.mx")
        set_role(other_coach, "coach")
        self.assertEqual(self.client.post(f"/api/coach/members/{other_coach.id}/delete", {"confirm": "ELIMINAR"}, content_type="application/json").status_code, 403)
        self.assertEqual(self.client.post(f"/api/coach/members/{self.coach.id}/delete", {"confirm": "ELIMINAR"}, content_type="application/json").status_code, 400)
        self.client.force_login(self.m)
        self.assertEqual(self.client.post(f"/api/coach/members/{self.coach.id}/delete", {"confirm": "ELIMINAR"}, content_type="application/json").status_code, 403)
